import type { MetadataCache, Vault } from "obsidian";
import type { ExoLayoutOntologyBootstrapperVault } from "./ExoLayoutOntologyBootstrapper";

/**
 * Obsidian-concrete `ExoLayoutOntologyBootstrapperVault` adapter — translates
 * the minimal bootstrapper API to `Vault` primitives.
 *
 * Mirrors `ObsidianUiOntologyBootstrapperVault` (since v15.121.1). See the
 * memory entry `reference_obsidian_metadataCache_getFirstLinkpathDest_onload.md`
 * for the O(1) early-onload UID lookup mechanism.
 *
 * `hasAssetWithUid` uses `MetadataCache.getFirstLinkpathDest`, which Obsidian
 * indexes on basename and resolves synchronously without requiring a full
 * `metadataCache.on("resolved")` — suitable for early `onload` invocation.
 * This catches legacy copies of the 18 files at non-default folders (e.g.
 * starter-kit `exo/` convention) and prevents the bootstrapper from creating
 * duplicate `exo__Asset_uid` assets on plugin upgrade.
 *
 * `fileExists` remains a fast path-level fallback against
 * `getAbstractFileByPath` — used after the UID scan as defence in depth.
 */
export class ObsidianExoLayoutOntologyBootstrapperVault
  implements ExoLayoutOntologyBootstrapperVault
{
  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
  ) {}

  hasAssetWithUid(uid: string): boolean {
    return this.metadataCache.getFirstLinkpathDest(uid, "") !== null;
  }

  fileExists(path: string): boolean {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  async createFile(path: string, content: string): Promise<void> {
    await this.vault.create(path, content);
  }

  async ensureFolder(path: string): Promise<void> {
    if (this.vault.getAbstractFileByPath(path) !== null) return;
    await this.vault.createFolder(path);
  }
}
