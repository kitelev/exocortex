import { TFile, Keymap } from "obsidian";
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import {
  MetadataHelpers,
  IVaultAdapter,
  IFile,
  ITripleStore,
  IRI,
  Namespace,
} from "@kitelev/exocortex-core";
import { AssetRelationsTableWithToggle } from '@plugin/presentation/components/AssetRelationsTable';
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { AssetMetadataService } from "./helpers/AssetMetadataService";
import { AssetRelation } from "./types";
import { getReifiedRelations, ReifiedRelation } from "./getReifiedRelations";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';

/**
 * RFC `93a0b2ee` Task 1.2 — non-relation predicate filter ("predicate-whitelist"
 * by exclusion) applied to reified relations sourced via {@link getReifiedRelations}.
 *
 * A reified `exo__Statement` reifies an arbitrary `<subject> <predicate> <object>`
 * triple. The Relations block only wants genuine relation predicates (user-defined
 * object properties such as `ems#Effort_area`, `exo-ims#relatesToConcept`); a
 * statement whose `_predicate` is a SYSTEM / metadata / plumbing predicate
 * (`rdf:type`, the literal `exo:Asset_*` frontmatter metadata, the TBox-structural
 * `exo:Instance_*` / `exo:Class_*`, or the `exo:Statement_*` reification slots
 * themselves) is noise, not a relation, and must be dropped. RDFS / OWL schema
 * predicates (inferred noise) are likewise excluded.
 *
 * The exclusion is deliberately a CLOSED, narrow set — NOT a coarse `exo#Asset_`
 * prefix. The `exo:Asset_*` family contains genuine OBJECT relations the inline
 * relation path already surfaces — `exo:Asset_relates` (canonical relates),
 * `exo:Asset_prototype`, `exo:Asset_createdBy`, `exo:Asset_isDefinedBy`,
 * `exo:Asset_source` — which MUST stay visible (else Task 1.3 would render a
 * reified `Asset_relates` invisible while an inline one shows: an inline/reified
 * asymmetry). Only the LITERAL Asset metadata properties (label / uid / timestamps /
 * isArchived / description) are dropped. So RFC §C1's "отсечь … exo:Asset_<x>" is
 * read as its system-metadata subset, mirrored against the inline path's behaviour.
 *
 * Implemented as a denylist (not an allowlist) because relation predicates are
 * open-ended (user-defined): we exclude the closed set of known non-relation
 * predicates and let everything else through.
 */
const RDF_TYPE_IRI: string = Namespace.RDF.term("type").value;
const EXO_BASE: string = Namespace.EXO.iri.value;
const RDFS_BASE: string = Namespace.RDFS.iri.value;
const OWL_BASE: string = Namespace.OWL.iri.value;
/**
 * `exo#` local-name prefixes that are purely TBox-structural / reification-plumbing
 * — never user-data relations (`Instance_class`, `Class_superClass`, the three
 * `Statement_` slots). Safe to drop wholesale by prefix.
 */
const EXO_NON_RELATION_LOCALNAME_PREFIXES = [
  "Instance_",
  "Class_",
  "Statement_",
];
/**
 * The LITERAL `exo#Asset_*` metadata properties (string / datetime / boolean
 * values) — dropped explicitly. The OBJECT `exo:Asset_*` relations
 * (`Asset_relates`, `Asset_prototype`, `Asset_createdBy`, `Asset_isDefinedBy`,
 * `Asset_source`) are intentionally ABSENT here so they pass as relations,
 * matching what the inline path surfaces.
 */
const EXO_NON_RELATION_ASSET_LOCALNAMES: ReadonlySet<string> = new Set([
  "Asset_label",
  "Asset_uid",
  "Asset_createdAt",
  "Asset_updatedAt",
  "Asset_isArchived",
  "Asset_description",
]);

/**
 * True when `predicateIri` is a SYSTEM / metadata / plumbing predicate that must
 * NOT be surfaced as a relation in the Relations block (RFC `93a0b2ee` Task 1.2).
 */
export function isNonRelationPredicate(predicateIri: string): boolean {
  if (predicateIri === RDF_TYPE_IRI) return true;
  if (predicateIri.startsWith(RDFS_BASE) || predicateIri.startsWith(OWL_BASE)) {
    return true;
  }
  if (predicateIri.startsWith(EXO_BASE)) {
    const localName = predicateIri.slice(EXO_BASE.length);
    if (EXO_NON_RELATION_ASSET_LOCALNAMES.has(localName)) return true;
    return EXO_NON_RELATION_LOCALNAME_PREFIXES.some((p) =>
      localName.startsWith(p),
    );
  }
  return false;
}

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
    // RFC `93a0b2ee` Task 1.2 — reified-relation read-path dependencies, all
    // OPTIONAL so existing callers (and back-compat) behave exactly as before
    // when absent (reified sourcing is simply skipped). Wired in production at
    // `UniversalLayoutRenderer.initializeRenderers()` from the live triple store,
    // the `SPARQLApi.isReady` probe, and the lazy loader's `notePathToIRI`.
    /** Live triple store the reified `exo__Statement` instances are queried from. */
    private store?: ITripleStore,
    /**
     * Cold-start readiness probe (`() => sparql.isReady()`). The reified query is
     * GATED on this so a partially-indexed store never yields an UNDER-count of
     * reified relations (RFC R4 / pattern #3587): while it returns false the
     * reified fetch yields `[]`, and the post-refresh `autoRenderLayout()`
     * re-render (self-heal) surfaces them once indexing settles. Omit → assume
     * ready (back-compat: no gate).
     */
    private isStoreReady?: () => boolean,
    /**
     * The indexer's `notePathToIRI` (same `subjectIriPrefix`) — reused so the
     * reified query keys an asset by the EXACT IRI form the converter emitted
     * (R5 dual-IRI). Injected (not hand-rolled) so a mounted / prefix-labeled
     * subject resolves instead of silently matching nothing.
     */
    private notePathToIRI?: (path: string) => IRI,
  ) {}

  /**
   * Fetch the asset's reified relations from its `exo__Statement` instances —
   * GATED on store readiness and FILTERED to genuine relation predicates
   * (RFC `93a0b2ee` §C1, Task 1.2). This is the cold-start-safe, whitelisted
   * wrapper over the pure {@link getReifiedRelations} helper (Task 1.1). The
   * integration of these into the unified relation list (dedup vs inline +
   * provenance tagging) is Task 1.3 — this method has no caller in
   * `getAssetRelations` yet.
   *
   * Returns `[]` (a no-op, never a partial set) when:
   *  - the triple store or `notePathToIRI` dependency is absent (back-compat);
   *  - the store is not ready (`isStoreReady?.() === false`) — the cold-start
   *    gate that prevents an UNDER-count; the next post-refresh re-render fills
   *    them in (self-heal).
   *
   * Otherwise it queries the helper and drops any reified relation whose
   * `_predicate` is a non-relation system/plumbing predicate
   * ({@link isNonRelationPredicate}).
   *
   * @param file - The asset whose reified relations to fetch.
   * @returns the filtered reified relations; `[]` when gated off or none exist.
   */
  async getReifiedRelationsGated(file: TFile): Promise<ReifiedRelation[]> {
    const store = this.store;
    const notePathToIRI = this.notePathToIRI;
    if (!store || !notePathToIRI) return [];
    // Cold-start gate: never source reified relations from a not-yet-ready store
    // (would under-count). `isStoreReady` absent → assume ready (back-compat).
    if (this.isStoreReady && !this.isStoreReady()) return [];

    const label =
      this.metadataService.getAssetLabel(file.path) ??
      (this.vaultAdapter.getFrontmatter(file as unknown as IFile)
        ?.exo__Asset_label as string | undefined) ??
      null;

    const reified = await getReifiedRelations({
      file: { path: file.path, label },
      store,
      notePathToIRI,
    });
    // Predicate-whitelist: keep only genuine relation predicates.
    return reified.filter((r) => !isNonRelationPredicate(r.predicate));
  }

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
