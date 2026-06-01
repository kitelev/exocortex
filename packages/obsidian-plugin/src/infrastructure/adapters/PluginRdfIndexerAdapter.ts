import type { IRdfIndexer } from "./FocusProfileSwitchManager";
import type { VaultRDFIndexer } from "../VaultRDFIndexer";

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
  constructor(private readonly indexer: VaultRDFIndexer) {
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
  }
}
