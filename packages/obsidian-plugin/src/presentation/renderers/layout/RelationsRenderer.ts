import { TFile, Keymap } from "obsidian";
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { MetadataHelpers, IVaultAdapter, IFile } from "exocortex";
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
 * F11 — user-facing copy for the Asset Relations empty-state.
 *
 * Shown (in place of silently omitting the whole section) when an asset has
 * zero relations, so a first-run user who just created their first
 * Area/Project/Task sees that the feature exists rather than a missing block.
 * Mirrors the intent of the cold-start COMMANDS skeleton (RFC 0002 §3.8 P13),
 * but this is a *settled* state — not a transient indexing placeholder.
 */
export const RELATIONS_EMPTY_TEXT = "No related assets yet";

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
  ) {}

  /**
   * Compose the `groupSpecificProperties` map consumed by
   * `AssetRelationsTable` — the legacy hardcoded per-group column overrides.
   *
   * @returns fresh plain object; never the LEGACY_HARDCODED constant itself.
   */
  buildGroupSpecificProperties(): Record<string, string[]> {
    const legacy: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(LEGACY_HARDCODED_GROUP_SPECIFIC_PROPERTIES)) {
      legacy[key] = [...value];
    }
    return legacy;
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

    // F11 — empty-state: render a muted "No related assets yet" affordance
    // instead of an early return, so the section is discoverable on a
    // freshly-created asset with no backlinks/children (a first-run tester's
    // very first Area/Project/Task). Consistent with the cold-start COMMANDS
    // skeleton, but settled (no pulse): this is a genuine empty result, not a
    // transient indexing placeholder.
    if (relations.length === 0) {
      contentContainer.createDiv({
        cls: "exocortex-relations-empty",
        text: RELATIONS_EMPTY_TEXT,
      });
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
        groupSpecificProperties: this.buildGroupSpecificProperties(),
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
