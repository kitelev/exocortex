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
  iriToVaultPath,
  iriToObsidianName,
} from "@kitelev/exocortex-core";
import { AssetRelationsTableWithToggle } from '@plugin/presentation/components/AssetRelationsTable';
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { AssetMetadataService } from "./helpers/AssetMetadataService";
import { AssetRelation } from "./types";
import {
  getReifiedRelations,
  labelToSymbolicIRI,
  symbolicIriToPropertyKey,
  ReifiedRelation,
} from "./getReifiedRelations";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { DisplayNameResolver } from '@plugin/domain/display-name/DisplayNameResolver';
import { DEFAULT_DISPLAY_NAME_SETTINGS } from '@plugin/domain/settings/ExocortexSettings';
import { ObsidianApp, ExocortexPluginInterface, MetadataRecord } from '@plugin/types';

/** RFC 93a0b2ee Task 1.3 — Exocortex ontology IRI base (`…/ontology/`). */
const EXOCORTEX_ONTOLOGY_BASE = "https://exocortex.my/ontology/";

/**
 * RFC `93a0b2ee` Task 1.3 — convert a symbolic predicate IRI to its frontmatter
 * property-key form (`<prefix>__<localName>`) for dedup + grouping. Unlike
 * `Namespace.fromPropertyKey` / `iriToObsidianName`, this handles dash-bearing
 * prefixes (`exo-ims#relatesToConcept` → `exo-ims__relatesToConcept`) since the
 * dedup key must canonicalise the inline frontmatter key and the reified
 * predicate IRI to the SAME token. Non-ontology IRIs pass through unchanged.
 */
export function predicateIriToKey(iri: string): string {
  if (iri.startsWith(EXOCORTEX_ONTOLOGY_BASE)) {
    const rest = iri.slice(EXOCORTEX_ONTOLOGY_BASE.length); // e.g. "ems#Effort_area"
    const hash = rest.indexOf("#");
    if (hash >= 0) {
      return `${rest.slice(0, hash)}__${rest.slice(hash + 1)}`;
    }
  }
  return iri;
}

/**
 * RFC `93a0b2ee` Task 1.3 — frontmatter keys that are reification PLUMBING: a
 * backlink referencing the open asset via one of these is an `exo__Statement`
 * asset surfacing as a raw backlink, NOT a logical relation. Its logical edge is
 * rendered via the reified path (`mergeReifiedRelations`), so the plumbing
 * backlink is suppressed to avoid double-representing the same edge (the
 * "statement asset shows under exo__Statement_object" noise).
 */
const REIFICATION_PLUMBING_KEYS: ReadonlySet<string> = new Set([
  "exo__Statement_subject",
  "exo__Statement_predicate",
  "exo__Statement_object",
]);

/**
 * RFC `93a0b2ee` Task 1.2 — non-relation predicate filter ("predicate-whitelist"
 * by exclusion) applied to reified relations sourced via {@link getReifiedRelations}.
 *
 * A reified `exo__Statement` reifies an arbitrary `<subject> <predicate> <object>`
 * triple. The Relations block only wants genuine relation predicates (user-defined
 * object properties such as `ems#Effort_area`, `exo-ims#relatesToConcept`); a
 * statement whose `_predicate` is a SYSTEM / metadata / plumbing predicate
 * (`rdf:type`, the literal `exo:Asset_*` frontmatter metadata, the TBox-structural
 * `exo:Instance_*` and the literal `exo:Class_*` subset, or the `exo:Statement_*`
 * reification slots themselves) is noise, not a relation, and must be dropped.
 * RDFS / OWL schema predicates (inferred noise) are likewise excluded.
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
 * `exo#` local-name prefixes dropped WHOLESALE from the reified path.
 *
 * Note `Instance_class` / `Instance_prototype` are themselves `exo#ObjectProperty`
 * — so `Instance_` is kept wholesale NOT on the "its members are literals" grounds
 * that motivate the enumerated `Class_*` set below, but on VOLUME grounds: every
 * instance of a class backlinks to it, and those class-membership / prototype edges
 * are already surfaced by the inline path at a scale that would swamp the block.
 * The `Statement_` slots are pure reification plumbing.
 *
 * ⛔ `Class_` is deliberately NOT a wholesale prefix here (ems__Bug `2c7b99a3`):
 * the `exo#Class_*` family, like `exo#Asset_*`, mixes LITERAL definition metadata
 * with genuine OBJECT relations — `Class_superClass` is an `exo#ObjectProperty`
 * modelling a real class-to-class edge. Dropping the whole prefix made a manually
 * reified `Class_superClass` statement invisible EVERYWHERE: the raw backlink is
 * suppressed as reification plumbing (see {@link REIFICATION_PLUMBING_KEYS}) in
 * the expectation that the reified path renders the logical edge — and the
 * reified path then discarded it here. Only the literal / definition-metadata
 * `Class_*` properties are dropped, mirroring the `Asset_*` treatment below.
 */
const EXO_NON_RELATION_LOCALNAME_PREFIXES = ["Instance_", "Statement_"];
/**
 * The LITERAL / definition-metadata `exo#Class_*` properties — dropped explicitly.
 * The OBJECT relation `Class_superClass` is intentionally ABSENT so it passes as a
 * relation (ems__Bug `2c7b99a3`): a hand-authored `exo__Statement` reifying it is a
 * deliberate user act of surfacing that edge.
 *
 * This denylist gates ONLY the reified path ({@link getReifiedRelationsGated}) —
 * the inline backlink path applies no predicate denylist at all, so an inline
 * `exo__Class_superClass` is surfaced there regardless of this set.
 *
 * `Class_ontology` is denied on a "TBD-semantics stub → deny until defined" basis,
 * NOT because it is literal: in the live TBox it is an auto-generated ABox stub with
 * no declared range. Were its semantics defined as a class→ontology OBJECT relation
 * it would be the analogue of `exo:Asset_isDefinedBy` (allowed below) and should move
 * out of this set. `Class_name` / `Class_description` are literal-valued, so a real
 * reified statement of them is dropped by the `objectIsLiteral` guard anyway.
 */
const EXO_NON_RELATION_CLASS_LOCALNAMES: ReadonlySet<string> = new Set([
  "Class_name",
  "Class_description",
  "Class_ontology",
]);
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
    if (EXO_NON_RELATION_CLASS_LOCALNAMES.has(localName)) return true;
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
 * PDD `4d7decb9` — user-facing copy for the empty-state «+ Add relation»
 * affordance.
 *
 * Shown inside the Relations empty-state (a zero-relations / first-run asset)
 * when the renderer knows the asset (`currentFile`). The block-level
 * «✎ Edit relations» affordance (PDD `dccff87b`) only renders in the ≥1-relation
 * branch, so on a zero-relations asset the FIRST relation was reachable only via
 * Cmd+P — a discoverability gap for the exact new-user empty-state. This
 * affordance closes it, opening the SAME relations editor as the ≥1-branch and
 * Cmd+P (single source of truth: {@link RelationsRenderer.openRelationsEditor}).
 */
export const RELATIONS_EMPTY_ADD_TEXT = "+ Add relation";

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

  /**
   * req `3f65eb4a` — build a {@link DisplayNameResolver} the SAME way the native-link
   * patches (BodyLinkPatch, InlineTitlePatch, …) and the DailyNote tasks table
   * (DailyTasksRenderer, req a577316f) do, so a relation-table task-link label is
   * produced by the homoiconic `exo__DisplayNameSpec` system — the status/class prefix
   * (🔄/✅/❌/👥) comes from vault data, not a hardcoded map. Degrades to a label-only
   * resolver when `printNameRuleService` / `displayNameSettings` are unavailable (e.g. a
   * unit-test mock) → the tables keep the plain-label fallback (no regression).
   */
  private createDisplayNameResolver(): DisplayNameResolver {
    const ruleService = this.plugin.printNameRuleService ?? null;
    const settings =
      this.plugin.settings?.displayNameSettings ?? DEFAULT_DISPLAY_NAME_SETTINGS;
    const metadataResolver = ruleService?.createMetadataResolver() ?? null;
    return new DisplayNameResolver(settings, ruleService, metadataResolver);
  }

  /**
   * req `3f65eb4a` — attach the homoiconic `displayName` to each relation, resolved
   * through the vault `exo__DisplayNameSpec` system (one resolver per call, carrying the
   * compiled vault specs). Mutates each `AssetRelation` in place: `displayName` is the
   * resolver output, or `undefined` when the resolver is unavailable / yields nothing —
   * in which case the tables fall back to the plain `exo__Asset_label` / title.
   *
   * The related asset's own `exo__Asset_label` is defaulted to the relation title (which
   * already resolves label→basename), so a labelless asset keeps its basename fallback
   * INSIDE the resolved prefix (mirrors DailyTasksRenderer). The resolver reads the
   * related asset's `exo__Instance_class` + status from `rel.metadata` to select and
   * evaluate its (possibly conditional) spec.
   */
  private applyHomoiconicDisplayNames(relations: AssetRelation[]): void {
    const resolver = this.createDisplayNameResolver();
    for (const rel of relations) {
      // Guard the label to a non-empty STRING (a non-string exo__Asset_label falls through
      // to the title) — byte-identical to the plain-label fallback in getRelationDisplayLabel.
      const rawLabel = rel.metadata?.exo__Asset_label;
      const label =
        (typeof rawLabel === "string" && rawLabel.trim() !== ""
          ? rawLabel
          : undefined) ??
        rel.title ??
        rel.file.basename;
      rel.displayName =
        resolver.resolve({
          metadata: { ...rel.metadata, exo__Asset_label: label },
          basename: rel.file.basename,
        }) ?? undefined;
    }
  }

  async getAssetRelations(
    file: TFile,
    config: UniversalLayoutConfig,
  ): Promise<AssetRelation[]> {
    const relations: AssetRelation[] = [];

    // Inline relations (frontmatter / backlinks — the legacy path). RFC 93a0b2ee
    // Task 1.3: this is no longer an early-return on absent backlinks, because
    // reified relations (sourced from the triple store below) must surface even
    // when the asset has zero inline backlinks.
    const backlinks = this.backlinksCacheManager.getBacklinks(file.path);
    if (backlinks) {
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

          // RFC 93a0b2ee Task 1.3 — drop reification-plumbing backlinks: a source
          // referencing the asset ONLY via exo__Statement_* slots is a statement
          // asset surfacing as raw plumbing; its logical edge is rendered via the
          // reified path, so showing the plumbing backlink would double-represent
          // the edge. (A source with a real relation property too keeps that one.)
          if (referencingProperties.length > 0) {
            const withoutPlumbing = referencingProperties.filter(
              (p) => !REIFICATION_PLUMBING_KEYS.has(p),
            );
            if (withoutPlumbing.length === 0) {
              continue; // pure plumbing → skip this backlink entirely
            }
            referencingProperties = withoutPlumbing;
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
                provenance: "inline",
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
              provenance: "inline",
            };
            relations.push(relation);
          }
        }
      }
    }

    // RFC 93a0b2ee Task 1.3 — merge reified relations (from exo__Statement
    // instances, gated + whitelisted by Task 1.2) into the unified list,
    // deduplicating against the inline set (inline-wins on collision).
    await this.mergeReifiedRelations(file, relations);

    // req `3f65eb4a` — resolve each related asset's HOMOICONIC display name through
    // the vault `exo__DisplayNameSpec` system (the SAME stack as native links + the
    // DailyNote tasks table). Attaches `displayName` so the relation/children/query
    // table cell carries the status/class prefix (🔄 while Doing, …) from vault data,
    // consistently with those surfaces — replacing the plain `exo__Asset_label` text.
    // Single injection point: this list is the ONE source that feeds the Relations
    // block (AssetRelationsTable) AND the exo__Layout backlinks/children/query tables
    // (ExoLayoutRenderer → BacklinksTableBlockView). Null-safe: no printNameRuleService
    // or no matching spec → `displayName` stays undefined and the tables fall back to
    // the plain label (byte-identical to pre-3f65eb4a, no regression).
    this.applyHomoiconicDisplayNames(relations);

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

  /**
   * RFC `93a0b2ee` Task 1.3 — merge the asset's reified relations (from its
   * `exo__Statement` instances, fetched gated + whitelisted by Task 1.2) into
   * the unified `relations` list, deduplicating against the already-collected
   * inline relations.
   *
   * # Dedup (inline-wins)
   *
   * Each relation is canonicalised to `(subjectToken, predicateKey, objectToken)`
   * where an entity token is its `exo__Asset_uid` (`uid:…`), falling back to its
   * vault path (`path:…`) or the raw IRI (`iri:…`); the predicate is its
   * frontmatter-key form via {@link predicateIriToKey}. Both IRI forms of an
   * entity resolve to the same `uid:` token (R5 dual-IRI), and the open asset A's
   * path-form AND symbolic-form both canonicalise to A's token. A reified relation
   * whose key already appears among the inline relations is DROPPED: the inline
   * representation wins (it is the one that travels when the asset is shared, so a
   * reified duplicate does not make the edge private — RFC §C1 collision rule).
   *
   * Outgoing reified relations (A is the statement subject) never collide with an
   * inline backlink (whose object is always A), so they are purely additive.
   * Literal-object statements are property values, not relations (RFC R6), and are
   * skipped here (routed to a future Properties UX).
   *
   * @param file - The open asset A.
   * @param relations - The inline relations collected so far; mutated in place
   *                    with the non-duplicate reified relations appended.
   */
  private async mergeReifiedRelations(
    file: TFile,
    relations: AssetRelation[],
  ): Promise<void> {
    const reified = await this.getReifiedRelationsGated(file);
    if (reified.length === 0) return;

    // A's identity — its canonical token + symbolic IRI form (so a statement
    // that references A via either IRI form canonicalises to the same token).
    const aFm = this.vaultAdapter.getFrontmatter(file as unknown as IFile);
    const aUid = aFm?.exo__Asset_uid;
    const aToken =
      typeof aUid === "string" && aUid ? `uid:${aUid}` : `path:${file.path}`;
    const aLabel =
      this.metadataService.getAssetLabel(file.path) ??
      (aFm?.exo__Asset_label as string | undefined) ??
      null;
    const aSymbolic = labelToSymbolicIRI(aLabel)?.value;
    const exoAssetLabel = Namespace.EXO.term("Asset_label");

    // Resolve a path-form (`obsidian://vault/…/<uid>.md`) IRI to a canonical
    // dedup token via the referenced asset's vault frontmatter uid — the SAME
    // source the inline seed reads (`rel.metadata.exo__Asset_uid`), so the two
    // are guaranteed to canonicalise identically. `null` when `iri` is not a
    // vault path IRI (e.g. a symbolic ontology IRI).
    const pathIriToToken = (iri: string): string | null => {
      const path = iriToVaultPath(iri);
      if (!path) return null;
      if (path === file.path) return aToken;
      const f = this.vaultAdapter.getAbstractFileByPath(path);
      const uid = f
        ? this.vaultAdapter.getFrontmatter(f as IFile)?.exo__Asset_uid
        : undefined;
      return typeof uid === "string" && uid ? `uid:${uid}` : `path:${path}`;
    };

    const tokenFor = async (iri: string): Promise<string> => {
      if (iri === aSymbolic) return aToken;
      const pathToken = pathIriToToken(iri);
      if (pathToken !== null) return pathToken;
      // ems__Bug `2c7b99a3` sibling (#3924) — a symbolic ontology IRI (a
      // class / property def whose label is a `prefix__LocalName` reference)
      // belonging to the OTHER end of the edge. The inline seed keys that same
      // endpoint as a `uid:` / `path:` token, so resolve the symbolic form back
      // to its vault asset (the inverse of `labelToSymbolicIRI`: the RDF
      // converter emits such a label as a SYMBOLIC-IRI `exo:Asset_label` object,
      // dual-IRI — `sparql-iri-form-pre-verify`) so both forms canonicalise to
      // the SAME `uid:` token and the inline-wins collision rule fires. Without
      // this the symbolic endpoint falls through to `iri:<symbolic>` and never
      // matches the inline `uid:` seed → the edge renders twice (display-only,
      // but a duplicate row). Only attempted for a clean symbolic ontology IRI
      // (guarded by `symbolicIriToPropertyKey`) so arbitrary non-vault IRIs
      // don't trigger a pointless store scan.
      if (this.store && symbolicIriToPropertyKey(iri)) {
        const labelHits = await this.store.match(
          undefined,
          exoAssetLabel,
          new IRI(iri),
        );
        for (const t of labelHits) {
          if (t.subject instanceof IRI) {
            const token = pathIriToToken(t.subject.value);
            if (token !== null) return token;
          }
        }
      }
      return `iri:${iri}`;
    };

    // Canonical keys already represented. Seeded with the inline relations so a
    // reified duplicate of an inline edge is dropped (inline-wins); each emitted
    // reified relation's key is added too, so two distinct statements reifying
    // the SAME logical edge surface only once. An inline relation is
    // "sourceFile --propertyName--> A": subject = sourceFile (its uid lives in
    // the relation's enriched metadata), object = A. Body links carry no
    // predicate → not dedup-eligible.
    const seenKeys = new Set<string>();
    for (const rel of relations) {
      if (rel.provenance !== "inline" || !rel.propertyName) continue;
      const srcUid = rel.metadata?.exo__Asset_uid;
      const srcToken =
        typeof srcUid === "string" && srcUid
          ? `uid:${srcUid}`
          : `path:${rel.path}`;
      seenKeys.add(`${srcToken}|${rel.propertyName}|${aToken}`);
    }

    for (const r of reified) {
      // Literal object = a property value, not a relation (RFC R6).
      if (r.objectIsLiteral) continue;

      const subjToken = await tokenFor(r.subject);
      const objToken = await tokenFor(r.object);
      const key = `${subjToken}|${predicateIriToKey(r.predicate)}|${objToken}`;
      if (seenKeys.has(key)) continue; // inline-wins + reified-vs-reified dedup
      seenKeys.add(key);

      // The displayed "related asset" is the OTHER end of the edge.
      const otherIri = r.direction === "outgoing" ? r.object : r.subject;
      const otherPath = iriToVaultPath(otherIri);
      let basename: string;
      let title: string;
      let metadata: MetadataRecord;
      let created = 0;
      let modified = 0;
      if (otherPath) {
        const f = this.vaultAdapter.getAbstractFileByPath(otherPath);
        basename =
          otherPath.split("/").pop()?.replace(/\.md$/, "") ?? otherPath;
        const fm = f ? this.vaultAdapter.getFrontmatter(f as IFile) : null;
        metadata = fm ? { ...fm } : {};
        const lbl = this.metadataService.getAssetLabel(otherPath);
        title =
          lbl ?? (metadata.exo__Asset_label as string | undefined) ?? basename;
        const stat = (f as IFile | null)?.stat;
        created = stat?.ctime ?? 0;
        modified = stat?.mtime ?? 0;
      } else {
        // Symbolic / non-vault other end (e.g. a class IRI) — best-effort name.
        const name = iriToObsidianName(otherIri) ?? otherIri;
        basename = name;
        title = name;
        metadata = {};
      }

      relations.push({
        file: { path: otherPath ?? otherIri, basename },
        path: otherPath ?? otherIri,
        title,
        metadata,
        propertyName: predicateIriToKey(r.predicate),
        isBodyLink: false,
        isArchived: MetadataHelpers.isAssetArchived(metadata),
        isBlocked: BlockerHelpers.isEffortBlocked(this.app, metadata),
        created,
        modified,
        provenance: "reified",
        statementPath: r.statementPath ?? undefined,
        assetSpace: r.assetSpace ?? undefined,
      });
    }
  }

  /**
   * PDD `dccff87b` — open the relations editor for the read-view «Edit relations»
   * affordance. Reuses the already-registered `exocortex:edit-properties`
   * command (the SAME flow as Cmd+P and the ribbon — single source of truth)
   * via Obsidian-core `app.commands.executeCommandById`; the command operates on
   * the active file, which IS the asset whose Relations block this is. Parity-
   * safe: Obsidian-core API only, no Node fs, no platform gate → identical on
   * desktop AND mobile (Desktop↔Mobile Command Parity invariant).
   */
  private openRelationsEditor(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commands = (this.app as any).commands;
    if (typeof commands?.executeCommandById === "function") {
      commands.executeCommandById("exocortex:edit-properties");
    }
  }

  async render(
    el: HTMLElement,
    relations: AssetRelation[],
    config: UniversalLayoutConfig,
    renderHeader?: (container: HTMLElement, sectionId: string, title: string) => void,
    isCollapsed?: boolean,
    // PDD `dccff87b` — the asset whose read-view Relations block this is. When
    // provided, a block-level «Edit relations» affordance is wired (opens this
    // asset's property-editor). Optional → legacy callers render no affordance
    // (additive, zero read-view regression).
    currentFile?: TFile,
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
      const emptyEl = contentContainer.createDiv({
        cls: "exocortex-relations-empty",
        text: RELATIONS_EMPTY_TEXT,
      });
      // PDD `4d7decb9` — empty-state «+ Add relation» affordance. The ≥1-branch
      // block-level «Edit relations» button never renders here (no relations to
      // attach it to), so on a zero-relations asset — exactly the new-user /
      // first-run empty-state — the only path to the FIRST relation was Cmd+P.
      // When the renderer knows the asset (currentFile), surface a clickable
      // «+ Add relation» button INSIDE the empty-state section, right under the
      // muted "No related assets yet" text (placement decision per AC #3: it
      // lives in the empty-state block since there is no Relations table to host
      // a block-level affordance). It opens the SAME relations editor as the
      // ≥1-branch affordance and Cmd+P via openRelationsEditor() (single source
      // of truth → exocortex:edit-properties command). currentFile-gated →
      // legacy callers render no affordance (additive, zero read-view
      // regression). Parity-safe: Obsidian-core executeCommandById only, no
      // platform gate (Desktop↔Mobile Command Parity invariant).
      if (currentFile) {
        const addRelationBtn = emptyEl.createEl("button", {
          cls: "exocortex-relations-empty-add",
          text: RELATIONS_EMPTY_ADD_TEXT,
          attr: {
            type: "button",
            "aria-label": "Add relation",
            title: "Add relation",
          },
        });
        addRelationBtn.addEventListener("click", () =>
          this.openRelationsEditor(),
        );
      }
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
        // PDD `dccff87b` — block-level «Edit relations» affordance, wired only
        // when the renderer knows the asset (currentFile). Opens this asset's
        // property-editor via the registered edit-properties command.
        onEditRelations: currentFile
          ? () => this.openRelationsEditor()
          : undefined,
      }),
    );
  }
}
