/**
 * Install a global `Date` subclass simulating a FIXED whole-hour UTC offset (no
 * DST) at a FIXED instant — the CI-robust technique for timezone-sensitive
 * revert-verify tests ([[jest-timezone-sensitive-tests]]).
 *
 * Why not `process.env.TZ`: it cannot be re-tzset at runtime under jest (V8
 * caches the worker timezone on first `Date` use), so a runtime `TZ` assignment
 * is a silent no-op. And a local-vs-UTC date fix has NO observable effect in a
 * UTC runner (local === UTC there), so a test that only sets `TZ` passes both
 * with AND without the fix in CI — a false-positive.
 *
 * This subclass instead makes the LOCAL getters
 * (`getFullYear/getMonth/getDate/getHours/getMinutes/getSeconds/getDay`) report
 * the chosen offset's wall-clock, while the UTC getters (`getUTC*`,
 * `toISOString`, `getTime`) stay true — independent of the runner's real
 * timezone. Local constructor components `(y, mo, d, …)` are interpreted in the
 * simulated zone. `new Date()` (no args) returns the fixed instant.
 *
 * Usage (revert-verify at the local/UTC midnight boundary):
 * ```ts
 * const restore = installFakeOffsetDate(5, "2026-07-02T19:27:00Z"); // UTC+5, 00:27 local
 * try {
 *   expect(new Date().getHours()).toBe(0);    // guard: simulated tz active
 *   expect(new Date().getUTCDate()).toBe(2);  // still previous day in UTC
 *   // ...exercise the code under test; local day = 03, UTC day = 02
 * } finally {
 *   restore();
 * }
 * ```
 *
 * @param offsetHours whole-hour offset east of UTC (Asia/Almaty = +5)
 * @param fixedIso    the UTC ISO instant that `new Date()` (no args) returns
 * @returns a restore function that reinstates the real global `Date`
 */
export function installFakeOffsetDate(
  offsetHours: number,
  fixedIso: string,
): () => void {
  const RealDate = Date;
  const OFFSET_MS = offsetHours * 60 * 60 * 1000;
  const FIXED_EPOCH = RealDate.parse(fixedIso);
  class FakeOffsetDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(FIXED_EPOCH); // "now" = the fixed boundary instant
      } else if (args.length === 1) {
        super(args[0] as number | string | Date);
      } else {
        // (y, mo, d, …) are LOCAL (simulated-zone) components → shift to UTC.
        const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = args as number[];
        super(RealDate.UTC(y, mo, d, h, mi, s, ms) - OFFSET_MS);
      }
    }
    // Local getters = UTC getters of (epoch + offset); UTC getters inherited.
    private shifted(): Date {
      return new RealDate(this.getTime() + OFFSET_MS);
    }
    override getFullYear(): number {
      return this.shifted().getUTCFullYear();
    }
    override getMonth(): number {
      return this.shifted().getUTCMonth();
    }
    override getDate(): number {
      return this.shifted().getUTCDate();
    }
    override getHours(): number {
      return this.shifted().getUTCHours();
    }
    override getMinutes(): number {
      return this.shifted().getUTCMinutes();
    }
    override getSeconds(): number {
      return this.shifted().getUTCSeconds();
    }
    override getDay(): number {
      return this.shifted().getUTCDay();
    }
  }
  (globalThis as { Date: DateConstructor }).Date =
    FakeOffsetDate as unknown as DateConstructor;
  return () => {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  };
}
