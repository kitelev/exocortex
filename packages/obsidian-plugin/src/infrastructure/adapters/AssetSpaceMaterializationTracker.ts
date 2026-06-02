import type { App } from "obsidian";

import { isAssetSpaceFrontmatter } from "./AssetSpaceFrontmatter";

/**
 * Snapshot record for one AssetSpace ABox + its current materialization status.
 *
 * - `asUid` — `exo__Asset_uid` of the AssetSpace ABox.
 * - `asFilePath` — vault-relative path of the AssetSpace ABox file (used to
 *   construct canonical `obsidian://vault/...` subject IRIs for SPARQL triple
 *   injection).
 * - `namespace` — `exo__AssetSpace_namespace`, e.g. `"ems"` →
 *   folder `assetspaces/ems/`.
 * - `materialized` — true when `assetspaces/<namespace>/` exists on disk
 *   at the time of the last {@link AssetSpaceMaterializationTracker.refresh}.
 */
export interface AssetSpaceMaterializationStatus {
  asUid: string;
  asFilePath: string;
  namespace: string;
  materialized: boolean;
}

/**
 * Runtime-derived materialization tracker for `exo__AssetSpace` assets
 * (RFC 22b50a17 Phase 5 Phase 4, Vision Lock #12).
 *
 * Walks the vault for AssetSpace ABox assets and checks whether each
 * AssetSpace's filesystem folder (`assetspaces/<namespace>/`) currently
 * exists on disk. Materialization status is **derived** at refresh time
 * from the filesystem — never persisted to frontmatter — so manual
 * `rm`/`cp` of assetspaces directories cannot create stale state.
 *
 * Wired in `ExocortexPlugin.onload`. Refreshed on plugin start and after
 * `metadataCache` resolves (AssetSpace ABox changes can shift which AS
 * folders are tracked). The walk is cheap (~13 folders typical for
 * vault-2025).
 *
 * Read by:
 *  - `SPARQLApi.injectMaterializationTriples` — injects
 *    `<as-iri> exo:AssetSpace_materialized "true|false"^^xsd:boolean`
 *    so SPARQL can filter AS by status.
 *  - Markdown post-processor — renders ✅/⏸ icon on AssetSpace pages.
 */
export class AssetSpaceMaterializationTracker {
  private statuses: AssetSpaceMaterializationStatus[] = [];
  private materializedSet: Set<string> = new Set();

  constructor(private readonly app: App) {}

  /**
   * Re-scan vault for AssetSpace ABox assets and refresh the materialized
   * set. Cheap walk — iterates `vault.getMarkdownFiles()` filtered to AS
   * ABox + one `vault.adapter.exists` per AS folder.
   *
   * Best-effort: filesystem errors on individual `exists` probes are
   * treated as not-materialized (fail-closed — UI renders the ⏸
   * "available" icon).
   */
  async refresh(): Promise<void> {
    const nextStatuses: AssetSpaceMaterializationStatus[] = [];
    const nextMaterialized = new Set<string>();
    const seen = new Set<string>(); // dedupe across vault-2025/vault-exodev clones

    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      if (!fm) continue;
      if (!isAssetSpaceFrontmatter(fm)) continue;

      const asUid = typeof fm["exo__Asset_uid"] === "string"
        ? (fm["exo__Asset_uid"] as string).trim()
        : "";
      if (asUid.length === 0) continue;
      if (seen.has(asUid)) continue;
      seen.add(asUid);

      const namespace = typeof fm["exo__AssetSpace_namespace"] === "string"
        ? (fm["exo__AssetSpace_namespace"] as string).trim()
        : "";
      if (namespace.length === 0) {
        // No namespace declared — can't compute folder path. Skip.
        continue;
      }

      const folderPath = `assetspaces/${namespace}`;
      let materialized = false;
      try {
        materialized = await this.app.vault.adapter.exists(folderPath);
      } catch {
        // Best-effort: adapter error → treat as not-materialized.
      }
      nextStatuses.push({
        asUid,
        asFilePath: file.path,
        namespace,
        materialized,
      });
      if (materialized) nextMaterialized.add(asUid);
    }
    this.statuses = nextStatuses;
    this.materializedSet = nextMaterialized;
  }

  /** Snapshot of currently-materialized AssetSpace UIDs. */
  getMaterializedSet(): ReadonlySet<string> {
    return this.materializedSet;
  }

  /** True if the AssetSpace UID's folder exists on disk per latest refresh. */
  isMaterialized(asUid: string): boolean {
    return this.materializedSet.has(asUid);
  }

  /**
   * Snapshot of all known AssetSpace ABox assets + their current
   * materialization status. Consumers (SPARQL triple injection, UI status
   * icon rendering) iterate this list.
   */
  getStatuses(): ReadonlyArray<AssetSpaceMaterializationStatus> {
    return this.statuses;
  }
}
