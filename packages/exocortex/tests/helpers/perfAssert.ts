/**
 * Wall-clock micro-benchmark assertion that is SKIPPED under CI.
 *
 * Wall-clock timing assertions (`expect(elapsed).toBeLessThan(ms)`) flake on
 * shared CI runners: under parallel-jest-worker contention + GC pauses a single
 * measurement spikes 1.3-2x over its quiet-machine time, intermittently
 * reddening the whole `test-coverage-exocortex` hard gate. Empirical: main CI
 * run 27632043481 (post-#3589) failed solely because
 * `QueryOptimization.test.ts` `expect(elapsed).toBeLessThan(100)` spiked — a
 * timing flake unrelated to the merged change.
 *
 * The fix is NOT to relax thresholds one-by-one (whack-a-mole — every relax just
 * reveals the next-tightest assertion). It is to stop wall-clock micro-benchmarks
 * from hard-gating CI. This helper keeps the perf signal for LOCAL runs (quiet
 * machine), and no-ops under CI — while the test still EXECUTES the operation
 * (smoke coverage) and any correctness assertions (result counts/shape) run
 * everywhere.
 *
 * Dedicated wall-clock perf suites live under `tests/performance/**`, which the
 * CI gate already excludes via `--testPathIgnorePatterns`; this helper is for the
 * stray timing assertions embedded inside logic suites under `tests/unit/**` and
 * `tests/integration/**` that leaked past that exclusion.
 */
export function expectFasterThan(elapsedMs: number, budgetMs: number): void {
  if (process.env.CI) return;
  expect(elapsedMs).toBeLessThan(budgetMs);
}
