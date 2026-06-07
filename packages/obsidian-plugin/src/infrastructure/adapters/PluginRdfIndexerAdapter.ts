import type { IRdfIndexer } from "./ProfileApplyManager";
import type { IRdfIndexerHandle } from "@plugin/application/api/SPARQLApi";

/**
 * `IRdfIndexer` adapter wrapping the plugin's live `VaultRDFIndexer`.
 * The B.4 `ProfileApplyManager` calls `refresh()` after persisting
 * `activeProfileUid`; this adapter forwards to the indexer's `refresh()`
 * path so the existing cold-start pipeline runs identically.
 *
 * RFC 01a83de8 Phase 3 — the query-time soft-filter was removed; profile
 * switching is mount-state based, so `refresh()` rebuilds from whatever
 * AssetSpace folders are currently materialised on disk.
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
   * `ProfileApplyManager` use this adapter, so the hook fires
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

  async refresh(): Promise<void> {
    await this.indexer.refresh();
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
