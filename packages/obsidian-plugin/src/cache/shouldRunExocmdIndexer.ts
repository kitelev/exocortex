/**
 * Decide whether to run `ExocmdBindingsIndexer.runFullScan()` on cold start.
 *
 * # Why this is a separate function
 *
 * Issue #3250 — on iOS the indexer's per-startup full vault scan tipped the
 * plugin process over the jetsam memory budget, causing Obsidian to restart
 * every 15-30 seconds. The fix gates the indexer behind a mobile-aware
 * predicate so mobile users get a stable plugin by default and can opt in
 * if they have headroom (iPad Pro, etc).
 *
 * The predicate is extracted as a pure function so the four-branch decision
 * table (mobile × toggle) can be unit-tested without instantiating the
 * plugin or mocking the Obsidian `Platform` module.
 *
 * @param isMobile      Value of `Platform.isMobile` at call site.
 * @param enabledOnMobile  User setting `exocmdBindingsCacheEnabledOnMobile`.
 *                      Ignored when `isMobile === false` (desktop always runs).
 * @returns `true` if `runFullScan()` should execute, `false` if it should skip.
 */
export function shouldRunExocmdIndexer(
  isMobile: boolean,
  enabledOnMobile: boolean,
): boolean {
  if (!isMobile) return true;
  return enabledOnMobile;
}
