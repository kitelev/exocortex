/**
 * Decide whether to run `ExocmdBindingsIndexer.runFullScan()` on cold start.
 *
 * # Why this is a separate function
 *
 * Issue #3250 — on iOS the indexer's per-startup full vault walk + per-class
 * `CommandResolver` pass caused Obsidian to restart every 15-30 seconds. The
 * exact kernel kill mechanism was not isolated from JetsamEvent logs (Obsidian
 * did not appear in the user's three sample events as a killed process); the
 * most likely candidates are memory-pressure-driven per-process-limit kills
 * and main-thread-block-driven watchdog kills, since both are consistent with
 * a synchronous full-vault scan on a memory-constrained device. The fix gates
 * the indexer behind a mobile-aware predicate so mobile users get a stable
 * plugin by default and can opt in if they have headroom (iPad Pro, etc).
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
