/**
 * `$today` executor local-timezone revert-verify (req 26d79c70 / #3809,
 * follow-up to #3808 which fixed the two SubstitutionToken resolution paths).
 *
 * `GroundingExecutor.resolveInstanceDate` feeds the executor's `$today` /
 * `$todayStart` in `substituteVariables` (labelTemplate / serviceCallPayload /
 * property_set) AND the created instance's nominal date + prototype-time planned
 * timestamps. It formerly sliced `clock.now().toISOString()` (UTC), mis-firing
 * to yesterday's LOCAL day just after local midnight in a UTC+N timezone — while
 * the `$today` SubstitutionToken resolvers (#3808) and `$date` were already
 * local, so `$today` was split-basis across surfaces at the boundary. The fix
 * slices the LOCAL calendar day (`DateFormatter.toDateString`).
 *
 * Revert-verify ([[integration-test-revert-verify]]): reverting
 * `resolveInstanceDate` to `(isoNow ?? clock.now().toISOString()).slice(0, 10)`
 * makes `$today` resolve to "2026-07-02" (the UTC day) → RED; the local form →
 * GREEN ("2026-07-03").
 *
 * CI-robustness ([[jest-timezone-sensitive-tests]]): `process.env.TZ` cannot be
 * re-tzset at runtime under jest (V8 caches the worker timezone), and the fix
 * has NO observable effect in a UTC runner — so a `Date` subclass (shared
 * `installFakeOffsetDate` helper) simulates a fixed UTC+5 (Asia/Almaty, no DST)
 * offset at 2026-07-02T19:27:00Z = 2026-07-03T00:27 local (local day 03, UTC day
 * 02), independent of the runner's real timezone. A guard proves the simulated
 * tz is active so the assertion can never silently pass both ways in a UTC-tz
 * CI runner.
 *
 * @req:26d79c70-8e39-454c-b07e-a8d9d0ea2b66
 */
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { installFakeOffsetDate } from "../../helpers/installFakeOffsetDate";

function createMockReader() {
  return {
    readFile: jest.fn().mockResolvedValue("---\nfoo: bar\n---\nBody"),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
}

function createMockWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    updateFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

describe("GroundingExecutor $today = LOCAL calendar day (req 26d79c70 / #3809)", () => {
  const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";

  it("substituteVariables interpolates $today as today's LOCAL day just after local midnight (UTC still previous day) @req:26d79c70-8e39-454c-b07e-a8d9d0ea2b66", () => {
    const restore = installFakeOffsetDate(5, "2026-07-02T19:27:00Z");
    try {
      // Guard: prove the simulated tz is active (else the assertion below would
      // be vacuous in a UTC-tz runner and silently pass both ways — fail loud).
      expect(new Date().getHours()).toBe(0); // 00:27 local (Almaty)
      expect(new Date().getUTCDate()).toBe(2); // still July 2 in UTC

      const executor = new GroundingExecutor(
        createMockReader(),
        createMockWriter(),
        new ServiceRegistry(),
      );

      // `$today` in a label-template / property value. Local today = 2026-07-03;
      // the former UTC form returned "2026-07-02" (yesterday's local date).
      const label = executor.substituteVariables("due $today", TARGET_IRI);
      expect(label).toBe("due 2026-07-03");

      // `$todayStart` = today's LOCAL day at midnight (timezone-naive) — now
      // local-day-consistent since it derives from the same `$today`.
      const planned = executor.substituteVariables("$todayStart", TARGET_IRI);
      expect(planned).toBe("2026-07-03T00:00:00");
    } finally {
      restore();
    }
  });
});
