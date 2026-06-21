/**
 * Flaky Test Quarantine Configuration
 *
 * This file lists tests that are temporarily disabled (quarantined) while
 * being investigated/fixed. The quarantine machinery itself lives in
 * `@kitelev/exocortex-test-utils` (see `packages/test-utils/src/reporters/quarantine.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RFC Phase 3.3 — Quarantine activation (T3.2 deliverable, 2026-05-01)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Per the T3.1 decision matrix
 * (`packages/obsidian-plugin/docs/phase3/T3_1_QUARANTINE_DECISION_MATRIX.md`),
 * the post-cutover N=41 cohort yielded **0 quarantine candidates** out of 9
 * unique failing specs. Bucket distribution:
 *
 *   - quarantine: 0
 *   - track:      3   (single-incident, flake-vs-regression unresolvable at N=41)
 *   - fix:        2   (recurrent ≥2 incidents, root cause hypothesised in T0.2/T0.3)
 *   - stabilize:  5   (rely on existing `retry(1)` + Phase 3.1 cold-start helpers)
 *
 * Justification (T3.1 §6): measurement is the dominant problem (T0.3 K-finding).
 * The Phase 3.4 flaky-reporter dashboard now accumulates rerun-rate evidence
 * that will inform future quarantine decisions once incident counts cross the
 * "single incident" threshold (re-evaluate at N≥100 or on incident #2 per spec).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULES FOR QUARANTINE (Charter §4 Risk 4 — anti-rot policy)
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Every quarantined test MUST link a tracking GitHub issue.
 *  2. Quarantine is temporary — default 30-day expiry; QuarantineManager
 *     auto-warns past `quarantinedAt + maxQuarantineDays` (see manager impl).
 *  3. Add a clear `reason` (root cause hypothesis or symptom).
 *  4. Tests must be fixed or removed — never left in quarantine indefinitely.
 *  5. Adding a quarantine entry requires a corresponding flaky-reporter
 *     dashboard cross-reference (Phase 3.4 rerun-rate snapshot).
 *
 * @see packages/obsidian-plugin/docs/phase3/T3_1_QUARANTINE_DECISION_MATRIX.md
 * @see packages/test-utils/src/reporters/quarantine.ts (QuarantinedTest type)
 *
 * @example
 * {
 *   file: 'packages/obsidian-plugin/tests/unit/services/MyService.test.ts',
 *   name: 'should handle async operation',
 *   issue: 'https://github.com/kitelev/exocortex/issues/123',
 *   reason: 'Race condition when network is slow',
 *   quarantinedAt: '2026-05-01',
 *   owner: 'AI-agent',
 * }
 */

import type { QuarantinedTest } from "@kitelev/exocortex-test-utils";

/**
 * Quarantined specs.
 *
 * Currently EMPTY by design (T3.1 decision matrix, 2026-05-01).
 * Future entries should be appended here whenever a spec promotes from
 * "track"/"fix" to "quarantine" — only after the Phase 3.4 flaky-reporter
 * dashboard provides ≥2 incidents AND retry(1) has proven insufficient.
 */
export const QUARANTINED_TESTS: QuarantinedTest[] = [
  // No quarantines as of T3.2 (RFC Phase 3.3, 2026-05-01).
  //
  // Append new entries via this template:
  // {
  //   file: 'packages/obsidian-plugin/tests/unit/example.test.ts',
  //   name: 'test name that is flaky',
  //   issue: 'https://github.com/kitelev/exocortex/issues/XXX',
  //   reason: 'Timing-dependent assertion that fails intermittently',
  //   quarantinedAt: '2026-05-01',
  //   expiresAt: '2026-05-31',
  //   owner: 'AI-agent',
  // },
];

/**
 * Quarantine configuration
 */
export const QUARANTINE_CONFIG = {
  tests: QUARANTINED_TESTS,
  /** Skip quarantined tests entirely (false = run but don't fail on them) */
  skipQuarantined: false,
  /** Maximum days a test can stay quarantined before it must be fixed */
  maxQuarantineDays: 30,
  /** Warn when quarantine expires */
  warnOnExpired: true,
};
