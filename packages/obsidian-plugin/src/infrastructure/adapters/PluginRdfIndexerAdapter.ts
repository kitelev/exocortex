import type { IRdfIndexer } from "./FocusProfileSwitchManager";
import type { IRdfIndexerHandle } from "@plugin/application/api/SPARQLApi";

/**
 * `IRdfIndexer` adapter wrapping the plugin's live `VaultRDFIndexer`
 * (Issue #3321 wiring). The B.4 `FocusProfileSwitchManager` calls
 * `refresh(effectiveOntologies)` after persisting `activeProfileUid`;
 * this adapter threads the set into the indexer и forwards к the
 * indexer's no-arg `refresh()` path so the existing cold-start
 * pipeline runs identically.
 *
 * Folder-map ownership: per VaultRDFIndexer line 111, the effective-
 * ontology filter engages only when BOTH the set is non-empty AND
 * `setAssetSpaceFolderToUid` has been called с a non-null map. This
 * adapter is agnostic — the plugin's onload is responsible для wiring
 * the folder map при construction (AssetSpaceManager scan, or vault-
 * scan fallback). Passing through here would couple the SwitchManager
 * к AssetSpace topology, which it deliberately stays out of.
 */
export class PluginRdfIndexerAdapter implements IRdfIndexer {
  /**
   * Optional post-refresh hook fired after each successful `refresh()`.
   *
   * RFC 22b50a17 Phase 4 (H1 cascade catch — advisor round-2): a
   * `sparql.refresh()` / `rdfIndexer.refresh()` clears the store and
   * rebuilds it from frontmatter alone. Any **derived** triples (like
   * `exo:AssetSpace_materialized` produced by
   * `injectAssetSpaceMaterializationTriples`) must be re-added after
   * the refresh completes, or SPARQL filters referencing them return
   * empty until the next `metadataCache.resolved` event.
   *
   * The plugin wires this to a closure that re-runs the AssetSpace
   * materialization injection. Soft+hard switch paths via
   * `FocusProfileSwitchManager` use this adapter, so the hook fires
   * automatically without each switch callsite knowing about the
   * derived-triple discipline.
   *
   * Best-effort: hook errors are swallowed so a hook regression cannot
   * brick a profile switch. The hook is responsible for its own logging.
   */
  constructor(
    private readonly indexer: IRdfIndexerHandle,
    private readonly onAfterRefresh?: () => Promise<void>,
  ) {
    if (!indexer) {
      throw new Error("PluginRdfIndexerAdapter: indexer is required");
    }
  }

  async refresh(effectiveOntologies: ReadonlySet<string>): Promise<void> {
    // `VaultRDFIndexer.refresh` accepts the set as its single argument
    // and persists it via `setEffectiveOntologies` before reindexing.
    // R15 fall-back (empty set / missing folder map) is handled inside
    // the converter — surfacing it through this adapter would risk
    // double-warn, so we let the indexer log once.
    await this.indexer.refresh(effectiveOntologies);
    if (this.onAfterRefresh !== undefined) {
      try {
        await this.onAfterRefresh();
      } catch {
        // Best-effort — hook failure must not propagate to the switch
        // pipeline (which has already mutated state successfully).
      }
    }
  }
}
