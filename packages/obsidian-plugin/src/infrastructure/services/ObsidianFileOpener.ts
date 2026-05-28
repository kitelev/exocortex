import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { IFileOpener } from "exocortex";

/**
 * Obsidian-side adapter for {@link IFileOpener} (Issue #3184 B5).
 *
 * Opens a vault-relative path and focuses it. Default mode is "new tab"
 * (`getLeaf("tab")`) — mirrors the legacy `createRelatedTask` /
 * `createNarrowerConcept` / `createSubclass` pattern from `ServiceRegistryPopulator`.
 *
 * RFC ce27e55d: when `opts.sameTab` is true the opener calls
 * `getLeaf(false)` instead — navigates the CURRENT active leaf to the new
 * file. Implements `exocmd__Command_openInSameTab` semantics for one-click
 * supervision-style flows where the user expects the prototype tab to
 * become the new instance immediately.
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

  async open(
    path: string,
    opts?: { readonly sameTab?: boolean },
  ): Promise<void> {
    if (!path) return;

    const tfile = await this.resolveTFile(path);
    if (tfile) {
      // RFC ce27e55d: branch on `opts.sameTab` — `false` argument to
      // `getLeaf` requests the CURRENT active leaf (Obsidian API contract),
      // `"tab"` requests a fresh tab.
      const leafArg: false | "tab" = opts?.sameTab ? false : "tab";
      const leaf = this.app.workspace.getLeaf(leafArg);
      await leaf.openFile(tfile);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      return;
    }

    // Fallback: lookup miss (vault cache lag, unusual path encoding) —
    // delegate to `openLinkText` which resolves via metadataCache. The
    // second arg is the source path; empty string means "from vault root".
    // `openLinkText` does not expose a tab/leaf preference; same-tab callers
    // accept fallback to default behaviour when the polled-file path failed.
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
