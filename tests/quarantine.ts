/**
 * Flaky Test Quarantine Configuration
 *
 * This file contains the list of known flaky tests that are temporarily
 * quarantined while being investigated or fixed.
 *
 * RULES FOR QUARANTINE:
 * 1. Every quarantined test MUST have an associated issue
 * 2. Quarantine should be temporary (max 30 days by default)
 * 3. Tests must be fixed or removed, not left in quarantine indefinitely
 * 4. Add clear reason explaining why the test is flaky
 *
 * @example
 * {
 *   file: 'packages/obsidian-plugin/tests/unit/services/MyService.test.ts',
 *   name: 'should handle async operation',
 *   issue: 'https://github.com/kitelev/exocortex/issues/123',
 *   reason: 'Race condition when network is slow',
 *   quarantinedAt: '2025-01-15',
 *   owner: 'developer-name',
 * }
 */

import type { QuarantinedTest } from "@exocortex/test-utils";

export const QUARANTINED_TESTS: QuarantinedTest[] = [
  // Add flaky tests here as they are identified
  // Example:
  // {
  //   file: 'packages/obsidian-plugin/tests/unit/example.test.ts',
  //   name: 'test name that is flaky',
  //   issue: 'https://github.com/kitelev/exocortex/issues/XXX',
  //   reason: 'Timing-dependent assertion that fails intermittently',
  //   quarantinedAt: '2025-12-11',
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
