import type { Vault } from "obsidian";
import type { UiOntologyBootstrapperVault } from "./UiOntologyBootstrapper";

/**
 * Obsidian-concrete `UiOntologyBootstrapperVault` adapter — translates the
 * minimal bootstrapper API to `Vault` primitives.
 *
 * `fileExists` is a fast path-level check against `getAbstractFileByPath`.
 * It does NOT scan the whole vault for a file with the same
 * `exo__Asset_uid`; if a user manually copied the 7 files to a non-default
 * folder, calling bootstrap still installs them at `_exocortex-ui-ontology/`.
 * Rationale: scanning by UID requires a resolved `metadataCache`, and
 * bootstrap runs early in `onload` before resolution.
 */
export class ObsidianUiOntologyBootstrapperVault
  implements UiOntologyBootstrapperVault
{
  constructor(private readonly vault: Vault) {}

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
