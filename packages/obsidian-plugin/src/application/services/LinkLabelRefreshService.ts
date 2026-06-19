/**
 * Re-resolve wikilink display labels (and triple-store-backed relation
 * labels) without an Obsidian restart — the heart of the «Exocortex: Refresh
 * link labels» command (Веха 1 / MVP, WBS `bb1c98af`).
 *
 * ## Why this exists (AS-IS bug, root-cause)
 *
 * A bare `[[uid]]` wikilink whose target `B` lives in a NOT-yet-materialised
 * AssetSpace renders as the raw `uid`:
 * `WikilinkLabelViewPlugin.resolveDisplayName` → `metadataCache
 * .getFirstLinkpathDest(uid)` → `null` (file absent) → no `Decoration.replace`
 * → Obsidian draws the raw `[[uid]]`.
 *
 * After the user materialises B's AssetSpace, B exists on disk, BUT the label
 * STILL shows `uid` until an Obsidian restart, because:
 *  - `WikilinkLabelViewPlugin.update()` rebuilds its `DecorationSet` only on
 *    `docChanged / viewportChanged / selectionSet / geometryChanged`. It is
 *    NOT subscribed to `metadataCache` events, so an already-open note holds a
 *    stale `DecorationSet` (no decoration for `[[uid]]`).
 *  - The materialize/apply path refreshes the triple store + re-renders
 *    dynamic layouts, but never touches the CodeMirror editor views.
 *
 * A restart recreates the editor views → fresh `buildDecorations` already sees
 * the indexed B → the label resolves.
 *
 * ## What this service does (without a restart)
 *
 * 1. **Ensure the index is fresh** (`ensureIndexFresh`) — re-run the same
 *    vault index rebuild the apply path uses (`sparql.refresh()` →
 *    `convertVault()`), so the triple store reflects the now-materialised B,
 *    and new editor views (opened after this runs) resolve against an
 *    up-to-date vault tree. This is the «index sees B» guarantee — the
 *    requirement that even NEW tabs show fresh labels, not just a repaint of
 *    the open ones.
 * 2. **Force-rebuild open editor views** (`rebuildEditorViews`) — reconfigure
 *    every open Markdown view (`app.workspace.updateOptions()`), which
 *    recreates the `WikilinkLabelViewPlugin` instances and re-runs
 *    `buildDecorations` against the current `metadataCache`. This is what a
 *    restart does to the open views, minus the restart.
 * 3. **Re-render dynamic layouts** (`rerenderLayouts`) — `autoRenderLayout()`,
 *    for triple-store-backed relation labels in reading-mode layouts.
 *
 * ## Graceful by contract
 *
 * Each step is isolated: a failure in one is logged (debug/warn) and never
 * aborts the others, never throws out of `refresh()`, and never shows a
 * Notice. Links whose target is still unresolvable simply stay as their raw
 * `uid` — the `WikilinkLabelViewPlugin` already degrades that way (no label →
 * no decoration → raw text). There is no error path for the user.
 *
 * ## Reuse (Веха 2 — auto re-resolve on profile-apply)
 *
 * The same `refresh()` is the unit the auto-hook (`createProfileApplyRefresh\
 * Hook`) will call so that materialise/apply re-resolves labels automatically,
 * with no manual command. Keeping the orchestration here (deps injected) lets
 * both the manual command and the future auto-hook share one implementation.
 */

/**
 * Minimal structural logger — keeps this service free of a concrete logger
 * import and trivially unit-testable. Both methods are optional; the plugin
 * wires its `ILogger` (whose `debug`/`warn` accept `(message, ...args)`).
 */
export interface LinkLabelRefreshLogger {
  debug?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
}

export interface LinkLabelRefreshDeps {
  /**
   * Ensure the RDF index reflects the current on-disk vault state so a
   * newly-materialised target resolves (including in NEW tabs). Maps to
   * `sparql.refresh()` in production (the same rebuild the apply path runs).
   * May be async + store-touching.
   */
  ensureIndexFresh: () => Promise<void> | void;
  /**
   * Force every open Markdown editor view to reconfigure its editor
   * extensions — recreates the `WikilinkLabelViewPlugin` instances → fresh
   * `buildDecorations` against the current `metadataCache`. Maps to
   * `app.workspace.updateOptions()`.
   */
  rebuildEditorViews: () => void;
  /**
   * Re-render the triple-store-backed dynamic layouts (relation labels). Maps
   * to `autoRenderLayout()`.
   */
  rerenderLayouts: () => void;
  /** Optional logger for graceful per-step failure visibility. */
  logger?: LinkLabelRefreshLogger;
}

export class LinkLabelRefreshService {
  constructor(private readonly deps: LinkLabelRefreshDeps) {}

  /**
   * Re-resolve wikilink + relation display labels in place. Graceful: each
   * step is isolated, nothing throws, nothing shows a Notice. Steps run in
   * order — index-fresh first (so the subsequent view rebuild resolves
   * against an up-to-date index), then editor-view rebuild, then layouts.
   */
  async refresh(): Promise<void> {
    // (1) Ensure the index is fresh — async + store-touching. Isolated so a
    // refresh failure still lets the open views + layouts rebuild against
    // whatever the index currently holds.
    try {
      await this.deps.ensureIndexFresh();
    } catch (err) {
      this.deps.logger?.warn?.(
        "[LinkLabelRefresh] ensureIndexFresh failed (continuing)",
        err,
      );
    }

    // (2) Force-rebuild open editor views → fresh wikilink-label decorations.
    try {
      this.deps.rebuildEditorViews();
    } catch (err) {
      this.deps.logger?.warn?.(
        "[LinkLabelRefresh] rebuildEditorViews failed (continuing)",
        err,
      );
    }

    // (3) Re-render dynamic layouts → fresh triple-store-backed relation
    // labels.
    try {
      this.deps.rerenderLayouts();
    } catch (err) {
      this.deps.logger?.warn?.(
        "[LinkLabelRefresh] rerenderLayouts failed (continuing)",
        err,
      );
    }
  }
}
