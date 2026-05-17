import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { IFileOpener } from "exocortex";

/**
 * Obsidian-side adapter for {@link IFileOpener} (Issue #3184 B5).
 *
 * Opens a vault-relative path in a new tab and focuses it. Mirrors the
 * established `getLeaf("tab").openFile(tfile)` + `setActiveLeaf(...,
 * {focus: true})` pattern used by `createRelatedTask` / `createNarrowerConcept`
 * / `createSubclass` in `ServiceRegistryPopulator.ts` so create_instance and
 * service_call-driven creation flows feel identical to the user.
 *
 * Robust to a brief race between `createFile` resolving and Obsidian's vault
 * cache surfacing the new file: we poll the abstract-file lookup a few times
 * before falling back to the legacy `openLinkText` API, which performs its
 * own resolution against the metadataCache.
 */
export class ObsidianFileOpener implements IFileOpener {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  async open(path: string): Promise<void> {
    if (!path) return;

    const tfile = await this.resolveTFile(path);
    if (tfile) {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(tfile);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      return;
    }

    // Fallback: lookup miss (vault cache lag, unusual path encoding) —
    // delegate to `openLinkText` which resolves via metadataCache. The
    // second arg is the source path; empty string means "from vault root".
    await this.app.workspace.openLinkText(path, "");
  }

  /**
   * Poll the vault for the freshly-written file. Obsidian's `createFile`
   * resolves before the vault index sees the new file in some cases, so
   * a short poll is more reliable than a single synchronous lookup.
   */
  private async resolveTFile(path: string): Promise<TFile | null> {
    const MAX_ATTEMPTS = 5;
    const DELAY_MS = 20;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const af = this.app.vault.getAbstractFileByPath(path);
      if (af instanceof TFile) return af;
      if (i < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }
    return null;
  }
}
