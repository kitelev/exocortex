import { TFile, Keymap } from "obsidian";
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { MetadataHelpers, IVaultAdapter, IFile } from "exocortex";
import type { RelationColumnSetResolver } from "exocortex";
import { AssetRelationsTableWithToggle } from '@plugin/presentation/components/AssetRelationsTable';
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { AssetMetadataService } from "./helpers/AssetMetadataService";
import { AssetRelation } from "./types";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';

export interface UniversalLayoutConfig {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  showProperties?: string[];
}

/**
 * Legacy hardcoded fallback map for `groupSpecificProperties`.
 *
 * Captures the exact behaviour shipped pre-RFC be70f741 so that existing
 * snapshot tests on `AssetRelationsTable*.snap` stay green when the resolver
 * is disabled, absent, or returns `null` for a known key.
 *
 * Keep byte-identical to the pre-integration literal.
 */
export const LEGACY_HARDCODED_GROUP_SPECIFIC_PROPERTIES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  ems__Effort_parent: Object.freeze(["ems__Effort_status"]),
  ems__Effort_area: Object.freeze(["ems__Effort_status"]),
});

function toInstanceClassArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

export class RelationsRenderer {
  constructor(
    private app: ObsidianApp,
    private settings: ExocortexSettings,
    private reactRenderer: ReactRenderer,
    private backlinksCacheManager: BacklinksCacheManager,
    private metadataService: AssetMetadataService,
    private plugin: ExocortexPluginInterface,
    private refresh: () => Promise<void>,
    private vaultAdapter: IVaultAdapter,
    private relationColumnSetResolver: RelationColumnSetResolver | null = null,
  ) {}

  /**
   * Compose the `groupSpecificProperties` map consumed by
   * `AssetRelationsTable`.  Overlays resolver-backed per-group configs on top
   * of the legacy hardcoded map so that legacy behaviour survives missing
   * configs (RFC be70f741 v2 §"Интеграция", first non-null fallback chain).
   *
   * Algorithm
   * - Feature-flag `enableRelationColumnSetResolver` OR absent resolver →
   *   return the legacy map unchanged.
   * - Iterate relations once, dedup by `propertyName`; for each unique
   *   property consult the resolver using the row asset's
   *   `exo__Instance_class` array (RFC v2 §"Мульти-классовый row").
   *   First hit wins per resolver semantics (Phase 2 priority ladder).
   * - Resolver miss → legacy fallback for that key (if present).
   * - Legacy keys untouched by any relation are preserved in the output so
   *   the snapshot shape matches the pre-integration literal.
   *
   * @param relations — flat list produced by `getAssetRelations`.
   * @returns fresh plain object; never the LEGACY_HARDCODED constant itself.
   */
  buildGroupSpecificProperties(
    relations: readonly AssetRelation[],
  ): Record<string, string[]> {
    const legacy: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(LEGACY_HARDCODED_GROUP_SPECIFIC_PROPERTIES)) {
      legacy[key] = [...value];
    }

    if (!this.settings.enableRelationColumnSetResolver || !this.relationColumnSetResolver) {
      return legacy;
    }

    const out: Record<string, string[]> = {};
    const seen = new Set<string>();

    for (const relation of relations) {
      const propertyName = relation.propertyName;
      if (!propertyName || seen.has(propertyName)) continue;
      seen.add(propertyName);

      const rowClasses = toInstanceClassArray(
        (relation.metadata as Record<string, unknown> | undefined)?.exo__Instance_class,
      );
      const resolved = this.relationColumnSetResolver.resolve(rowClasses, propertyName);
      if (resolved) {
        out[propertyName] = [...resolved.columns];
      } else if (legacy[propertyName]) {
        out[propertyName] = legacy[propertyName];
      }
    }

    for (const [key, value] of Object.entries(legacy)) {
      if (!(key in out)) {
        out[key] = value;
      }
    }

    return out;
  }

  async getAssetRelations(
    file: TFile,
    config: UniversalLayoutConfig,
  ): Promise<AssetRelation[]> {
    const relations: AssetRelation[] = [];

    const backlinks = this.backlinksCacheManager.getBacklinks(file.path);
    if (!backlinks) {
      return relations;
    }

    for (const sourcePath of backlinks) {
      const sourceFile = this.vaultAdapter.getAbstractFileByPath(sourcePath);
      if (sourceFile && sourcePath.endsWith(".md")) {
        const iFile = sourceFile as IFile;
        const metadata = this.vaultAdapter.getFrontmatter(iFile) || {};

        const isArchived = MetadataHelpers.isAssetArchived(metadata);

        // Match by basename first; also match by UID for files where
        // the filename doesn't equal the UUID (e.g. human-readable names).
        let referencingProperties =
          MetadataHelpers.findAllReferencingProperties(metadata, file.basename);

        if (referencingProperties.length === 0) {
          const targetFm = this.vaultAdapter.getFrontmatter(file as unknown as IFile);
          const uid = targetFm?.exo__Asset_uid;
          if (uid && typeof uid === "string") {
            referencingProperties =
              MetadataHelpers.findAllReferencingProperties(metadata, uid);
          }
        }

        const enrichedMetadata = { ...metadata };
        const resolvedLabel = this.metadataService.getAssetLabel(sourcePath);
        if (resolvedLabel) {
          enrichedMetadata.exo__Asset_label = resolvedLabel;
        }

        const isBlocked = BlockerHelpers.isEffortBlocked(this.app, metadata);

        if (referencingProperties.length > 0) {
          for (const propertyName of referencingProperties) {
            const displayLabel = (enrichedMetadata.exo__Asset_label as string) || iFile.basename;
            const relation: AssetRelation = {
              file: { path: sourcePath, basename: iFile.basename },
              path: sourcePath,
              title: displayLabel,
              metadata: enrichedMetadata,
              propertyName: propertyName,
              isBodyLink: false,
              isArchived: isArchived,
              isBlocked: isBlocked,
              created: iFile.stat?.ctime || 0,
              modified: iFile.stat?.mtime || 0,
            };
            relations.push(relation);
          }
        } else {
          const displayLabel = (enrichedMetadata.exo__Asset_label as string) || iFile.basename;
          const relation: AssetRelation = {
            file: { path: sourcePath, basename: iFile.basename },
            path: sourcePath,
            title: displayLabel,
            metadata: enrichedMetadata,
            propertyName: undefined,
            isBodyLink: true,
            isArchived: isArchived,
            isBlocked: isBlocked,
            created: iFile.stat?.ctime || 0,
            modified: iFile.stat?.mtime || 0,
          };
          relations.push(relation);
        }
      }
    }

    if (config.sortBy) {
      const sortBy = config.sortBy;
      relations.sort((a, b) => {
        const aVal = MetadataHelpers.getPropertyValue(a, sortBy) as string | number;
        const bVal = MetadataHelpers.getPropertyValue(b, sortBy) as string | number;
        const order = config.sortOrder === "desc" ? -1 : 1;
        return aVal > bVal ? order : -order;
      });
    }

    return relations;
  }

  async render(
    el: HTMLElement,
    relations: AssetRelation[],
    config: UniversalLayoutConfig,
    renderHeader?: (container: HTMLElement, sectionId: string, title: string) => void,
    isCollapsed?: boolean,
  ): Promise<void> {
    if (relations.length === 0) {
      return;
    }

    const container = el.createDiv({ cls: "exocortex-assets-relations" });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(container, "relations", "Asset Relations");
    }

    // Create content container
    const contentContainer = container.createDiv({
      cls: "exocortex-section-content",
      attr: {
        "data-collapsed": (isCollapsed || false).toString(),
      },
    });

    // Only render content if not collapsed
    if (isCollapsed) {
      return;
    }

    this.reactRenderer.render(
      contentContainer,
      React.createElement(AssetRelationsTableWithToggle, {
        relations,
        groupByProperty: true,
        sortBy: config.sortBy || "title",
        sortOrder: config.sortOrder || "asc",
        showProperties: config.showProperties || [],
        groupSpecificProperties: this.buildGroupSpecificProperties(relations),
        showEffortVotes: this.settings.showEffortVotes,
        onToggleEffortVotes: async () => {
          this.settings.showEffortVotes = !this.settings.showEffortVotes;
          await this.plugin.saveSettings();
          await this.refresh();
        },
        showArchived: this.settings.showArchivedAssets,
        onToggleArchived: async () => {
          this.settings.showArchivedAssets = !this.settings.showArchivedAssets;
          await this.plugin.saveSettings();
          await this.refresh();
        },
        onAssetClick: async (path: string, event: React.MouseEvent) => {
          const isModPressed = Keymap.isModEvent(
            event.nativeEvent as MouseEvent,
          );

          if (isModPressed) {
            await this.app.workspace.openLinkText(path, "", "tab");
          } else {
            await this.app.workspace.openLinkText(path, "", false);
          }
        },
        getAssetLabel: (path: string) => this.metadataService.getAssetLabel(path),
        resolveAccent: (classRef: string) =>
          this.plugin.themeResolver?.resolveAccent(classRef) ?? null,
      }),
    );
  }
}
