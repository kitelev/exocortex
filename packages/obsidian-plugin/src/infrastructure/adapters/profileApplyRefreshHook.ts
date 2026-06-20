/**
 * Post-refresh duties that MUST run after a profile apply / mount-state
 * change rebuilds the triple store.
 *
 * A profile apply (or any `ProfileApplyManager.reindexMountState` /
 * `applyProfile` / `applyProfileViaRest` path) calls
 * `rdfIndexer.refresh()`, which clears the store and re-runs
 * `convertVault()` over the AssetSpace folders that are now materialised
 * on disk. The store is therefore COMPLETE for the new mount-state — but
 * three in-memory follow-ups are needed for the UI to reflect it, exactly
 * mirroring the cold-start (`metadataCache.on("resolved")`) and
 * hot-reindex (`scheduleHotReindex`) paths:
 *
 *  1. **Re-inject derived materialization triples.** The runtime-derived
 *     `exo:AssetSpace_materialized` triples live only in memory and are
 *     wiped by the store rebuild — `refreshAndInject` re-adds them
 *     (RFC 22b50a17 Phase 4 H1).
 *  2. **Invalidate resolver caches + lazy-loader marks.** The
 *     `CommandResolver` / `PreconditionEvaluator` caches and the
 *     `LazyAssetGraphLoader` load-marks are keyed by subject/class and
 *     persist across the rebuild. Without invalidation, inline command
 *     buttons resolved (and CACHED — frequently as an EMPTY result)
 *     against the PRE-mount store stay stale: a `ems__Project` /
 *     `ems__MeetingPrototype` opened before its class AssetSpace was
 *     mounted caches zero buttons and never recovers until a full plugin
 *     reload. This is GUI-smoke defect D1 — create-buttons render only
 *     after the registry/full mount + reload.
 *  3. **Re-render active layouts.** Even with clean caches the layout DOM
 *     is not refreshed by the store rebuild; `rerenderLayouts` makes the
 *     freshly-resolvable buttons appear without an Obsidian restart.
 *  4. **Re-resolve wikilink labels in open editor views.** A bare
 *     `[[uid]]` whose target lived in a previously-unmounted AssetSpace
 *     renders as the raw `uid`; the open CodeMirror editor views hold a
 *     stale `DecorationSet` and are NOT subscribed to `metadataCache`
 *     events, so the label keeps showing `uid` until an Obsidian restart.
 *     `refreshEditorLabels` reconfigures the open editor views
 *     (`app.workspace.updateOptions()`), recreating the
 *     `WikilinkLabelViewPlugin` instances → fresh `buildDecorations`
 *     against the now-fresh `metadataCache`. This is the Веха 2 auto-hook
 *     for the link-label MVP (`LinkLabelRefreshService`, WBS `f01836c1`):
 *     what the manual «Exocortex: Refresh link labels» command does, now
 *     fired automatically on every profile apply. The index is already
 *     fresh here (the `rdfIndexer.refresh()` that triggered this hook ran
 *     `convertVault()`), so — unlike the manual command — no extra
 *     `ensureIndexFresh` / `rerenderLayouts` is needed; only the open
 *     editor views still need the reconfigure.
 *
 * The cold-start + hot-reindex paths already perform (2)+(3); the
 * apply path previously did only (1), which is the D1 root cause. Step (4)
 * closes the link-label gap so already-open notes re-resolve labels too.
 *
 * Returned as an `async () => Promise<void>` so it can be wired directly
 * as the `PluginRdfIndexerAdapter` `onAfterRefresh` hook. The materialize
 * re-injection is awaited (it is async + store-touching); the cache
 * invalidations + re-render + editor-label refresh are synchronous
 * fire-after.
 */
export interface ProfileApplyRefreshDeps {
  /** Re-inject `exo:AssetSpace_materialized` triples (async, store-touching). */
  refreshAndInject: () => Promise<void>;
  /** Drop the `LazyAssetGraphLoader` monotonic load-marks. */
  clearLazyLoader: () => void;
  /** Clear `CommandResolver` resolution + ancestor caches. */
  invalidateCommandResolverCache: () => void;
  /** Clear `PreconditionEvaluator` evaluation cache. */
  invalidatePreconditionCache: () => void;
  /** Re-render active layouts so refreshed button visibility shows. */
  rerenderLayouts: () => void;
  /**
   * Re-resolve wikilink display labels in open editor views — reconfigure
   * the open Markdown views (`app.workspace.updateOptions()`) so the
   * `WikilinkLabelViewPlugin` instances are recreated and re-run
   * `buildDecorations` against the now-fresh `metadataCache`. Maps to the
   * same editor-view rebuild the manual «Refresh link labels» command uses
   * (`LinkLabelRefreshService.rebuildEditorViews`). Synchronous + isolated
   * (Веха 2 auto re-resolve, WBS `f01836c1`).
   */
  refreshEditorLabels: () => void;
  /**
   * Optional logger for graceful per-step failure visibility. Mirrors
   * `LinkLabelRefreshService` so an `refreshEditorLabels` failure on the
   * auto path leaves the same breadcrumb the manual command would.
   */
  logger?: { warn?(message: string, ...args: unknown[]): void };
}

export function createProfileApplyRefreshHook(
  deps: ProfileApplyRefreshDeps,
): () => Promise<void> {
  return async () => {
    // (1) Re-inject derived materialization triples first — it is the
    // only async, store-touching step and the badge/status surfaces
    // depend on it.
    await deps.refreshAndInject();

    // (2) Invalidate caches that survived the store rebuild. Order
    // mirrors the cold-start chain (lazy-loader marks → resolver caches)
    // so a concurrent render cannot re-populate a cache from a
    // half-cleared state.
    deps.clearLazyLoader();
    deps.invalidateCommandResolverCache();
    deps.invalidatePreconditionCache();

    // (3) Re-render so the now-resolvable buttons appear without a reload.
    deps.rerenderLayouts();

    // (4) Re-resolve wikilink labels in the open editor views (Веха 2).
    // Last + isolated: reconfiguring the editor views is best-effort UI
    // polish, and its failure must not reject the post-refresh chain whose
    // earlier duties (materialization re-injection, cache invalidation,
    // layout render) have already succeeded. The index is already fresh
    // (the refresh that triggered this hook ran convertVault), so the
    // recreated decorations resolve against the up-to-date metadataCache.
    try {
      deps.refreshEditorLabels();
    } catch (err) {
      // Graceful by contract — unresolvable links simply stay as their raw
      // `uid` (the WikilinkLabelViewPlugin already degrades that way). Log
      // a breadcrumb so a regression here is not invisible, mirroring the
      // manual command's `LinkLabelRefreshService.rebuildEditorViews` path.
      deps.logger?.warn?.(
        "[ProfileApplyRefresh] refreshEditorLabels failed (continuing)",
        err,
      );
    }
  };
}
