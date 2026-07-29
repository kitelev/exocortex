import { BuiltInFunctions } from "../../../../../src/infrastructure/sparql/filters/BuiltInFunctions";
import { installFakeOffsetDate } from "../../../../helpers/installFakeOffsetDate";

/**
 * Regression guard for issue #3941 — ExoQL time accessors double-shifted the
 * timezone offset for naive-local timestamps. The vault stores timestamps as
 * naive-local (Asia/Almaty, no tz suffix); a naive-local "11:36", surfaced as
 * "…11:36:12Z" by the emission path, returned HOURS=16 on a UTC+5 host instead
 * of 11 (the offset was applied twice via host-local `Date.getHours()`).
 *
 * tz contract (SPARQL 1.1 §17.4.5): YEAR/MONTH/DAY/HOURS/MINUTES/SECONDS return
 * the components of the value's OWN lexical representation — no UTC / host-local
 * conversion. A naive timestamp yields its wall-clock components; a tz-annotated
 * timestamp yields the components in its stated timezone.
 *
 * These tests install a simulated UTC+5 zone via installFakeOffsetDate so the
 * bug (host-local `.getHours()`/`.getDate()` shift) is reproducible even on a
 * UTC CI runner, where local === UTC would otherwise hide it, causing the
 * revert-verify to pass both with AND without the fix
 * ([[jest-timezone-sensitive-tests]]). The primary discriminators use explicit
 * `Z` values so RED reproduces on every runner regardless of its real zone.
 */
describe("ExoQL time accessors — naive-local tz contract (#3941)", () => {
  it("HOURS/MINUTES/SECONDS return lexical components (no double tz shift)", () => {
    // Simulate Asia/Almaty (UTC+5); fixed instant 06:36:12Z → local 11:36:12.
    const restore = installFakeOffsetDate(5, "2026-07-05T06:36:12Z");
    try {
      // guard: the simulated UTC+5 zone is active under the fake Date
      expect(new Date().getHours()).toBe(11);
      expect(new Date().getUTCHours()).toBe(6);

      // Primary repro from the issue — naive-local value surfaced UTC-labeled.
      // With the bug, host-local getHours() would return 16 under UTC+5.
      expect(BuiltInFunctions.hours("2026-07-05T11:36:12.000Z")).toBe(11);
      expect(BuiltInFunctions.minutes("2026-07-05T11:36:12.000Z")).toBe(36);
      expect(BuiltInFunctions.seconds("2026-07-05T11:36:12.000Z")).toBe(12);

      // Bare naive form (no tz suffix) — same wall-clock components.
      expect(BuiltInFunctions.hours("2026-07-05T11:36:12")).toBe(11);

      // Explicit −03:00 offset — lexical hour as written, not UTC-normalized.
      // (bug path would resolve the instant then read it in the simulated zone.)
      expect(BuiltInFunctions.hours("2026-07-05T23:00:00-03:00")).toBe(23);

      // Fractional seconds preserved.
      expect(BuiltInFunctions.seconds("2026-07-05T11:36:12.815Z")).toBeCloseTo(
        12.815,
      );
    } finally {
      restore();
    }
  });

  it("YEAR/MONTH/DAY return lexical components (no boundary rollover for a late-UTC value)", () => {
    // Under a naive host-local read, a 23:30Z value + 5h crosses the day/month/
    // year boundary (the latent YEAR/MONTH/DAY variant of the same bug).
    const restore = installFakeOffsetDate(5, "2026-07-05T06:00:00Z");
    try {
      expect(new Date().getHours()).toBe(11); // guard: simulated UTC+5 active

      // Bug path: +5h rolls to 2027-01-01 → YEAR would be 2027.
      expect(BuiltInFunctions.year("2026-12-31T23:30:00Z")).toBe(2026);
      // Bug path: +5h rolls to Aug 1 → MONTH would be 8.
      expect(BuiltInFunctions.month("2026-07-31T23:30:00Z")).toBe(7);
      // Bug path: +5h rolls to Jul 6 → DAY would be 6.
      expect(BuiltInFunctions.day("2026-07-05T23:30:00Z")).toBe(5);
    } finally {
      restore();
    }
  });
});
