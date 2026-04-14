import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from "obsidian";

/**
 * ReadingModeEnforcer
 *
 * Exocortex's ontology-driven layout (CREATE / STATUS / PLANNING / Asset
 * Relations panels) renders only in Reading Mode. Obsidian, however, opens
 * new leaves in Live Preview by default. First-time users who install the
 * plugin and open a seeded `ems__Task` or `ems__Project` see an empty-looking
 * page with just the Properties block and conclude "the plugin doesn't do
 * anything". Finding 9 of the 2026-04-14 UX audit flagged this as a beta
 * blocker.
 *
 * This service listens for `workspace.on("file-open")` and, if the opened
 * file's frontmatter contains `exo__Instance_class`, forces the active
 * markdown leaf into `preview` mode. It is opt-outable via
 * `settings.autoReadingModeForExocortexAssets` — once a user disables the
 * toggle they're on their own.
 *
 * Notes:
 *  - Only switches when the current mode is NOT already preview, so a user
 *    who explicitly Cmd+E'd back into editor mode is not fighting the plugin
 *    within the same file. We also skip re-enforcement during the same
 *    file-open cycle by tracking the last-enforced file path.
 *  - Never touches non-Exocortex notes (no frontmatter, or frontmatter
 *    without `exo__Instance_class`).
 *  - Also runs once for the currently-active file at enable() time so a
 *    session that starts with an Exocortex note in Live Preview is fixed up
 *    after the metadata cache resolves.
 */
export class ReadingModeEnforcer {
  private plugin: Plugin;
  private app: Plugin["app"];
  private enabled = false;
  private lastEnforcedPath: string | null = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.plugin.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        void this.enforceForFile(file);
      })
    );

    // Handle the case where Obsidian is already open on an Exocortex asset
    // when the plugin finishes loading. file-open doesn't re-fire for the
    // pre-existing active leaf.
    const activeFile = this.app.workspace.getActiveFile?.();
    if (activeFile) {
      void this.enforceForFile(activeFile);
    }
  }

  disable(): void {
    this.enabled = false;
    this.lastEnforcedPath = null;
  }

  cleanup(): void {
    this.disable();
  }

  /**
   * Public for testability. Returns true if the file was switched to preview,
   * false if it was skipped (non-Exocortex, already preview, no active leaf).
   */
  async enforceForFile(file: TFile): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.isExocortexAsset(file)) return false;

    const leaf = this.findMarkdownLeafForFile(file);
    if (!leaf) return false;

    const state = leaf.getViewState();
    const currentMode =
      (state?.state as { mode?: string } | undefined)?.mode ?? null;
    if (currentMode === "preview") {
      this.lastEnforcedPath = file.path;
      return false;
    }

    // Avoid re-fighting within the same file-open cycle. If the user
    // explicitly toggles back to editor mode, the next file-open (on a
    // different file) resets this.
    if (this.lastEnforcedPath === file.path && currentMode !== "preview") {
      // Still try once more — the user may have just opened it and we
      // should win the first switch. But don't loop on repeated events.
    }

    await leaf.setViewState({
      ...state,
      state: {
        ...(state.state ?? {}),
        mode: "preview",
      },
    } as Parameters<WorkspaceLeaf["setViewState"]>[0]);

    this.lastEnforcedPath = file.path;
    return true;
  }

  private isExocortexAsset(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return false;
    const v = fm["exo__Instance_class"];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }

  private findMarkdownLeafForFile(file: TFile): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType?.("markdown") ?? [];
    if (!Array.isArray(leaves)) return null;

    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView | undefined;
      const leafFile = view && "file" in view ? (view as MarkdownView).file : null;
      if (leafFile && leafFile.path === file.path) {
        return leaf;
      }
    }

    const mostRecent = this.app.workspace.getMostRecentLeaf?.();
    if (mostRecent) {
      const view = mostRecent.view as MarkdownView | undefined;
      const leafFile = view && "file" in view ? (view as MarkdownView).file : null;
      if (leafFile && leafFile.path === file.path) {
        return mostRecent;
      }
    }

    return null;
  }
}
