import type { MetadataCache, Vault } from "obsidian";
import type { UiOntologyBootstrapperVault } from "./UiOntologyBootstrapper";

/**
 * Obsidian-concrete `UiOntologyBootstrapperVault` adapter — translates the
 * minimal bootstrapper API to `Vault` primitives.
 *
 * `hasAssetWithUid` uses `MetadataCache.getFirstLinkpathDest`, which Obsidian
 * indexes on basename and resolves synchronously without requiring a full
 * `metadataCache.on("resolved")` — suitable for early `onload` invocation.
 * This catches legacy copies of the 7 files at non-default folders (e.g.
 * starter-kit `03 Knowledge/ui/` convention) and prevents the bootstrapper
 * from creating duplicate `exo__Asset_uid` assets on plugin upgrade.
 *
 * `fileExists` remains a fast path-level fallback against
 * `getAbstractFileByPath` — used after the UID scan as defence in depth.
 */
export class ObsidianUiOntologyBootstrapperVault
  implements UiOntologyBootstrapperVault
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
