/** Length of a `YYYY-MM-DD` calendar-day key. */
const DAY_KEY_LENGTH = 10;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Temporal predicates over a `life__Episode`'s period (req 8a47ff93).
 *
 * Unlike {@link BlockerHelpers.isEffortBlocked} — the other display-matcher host
 * function — nothing here resolves ANOTHER asset: the predicate reads only the
 * rendered instance's own `life__Episode_start` / `life__Episode_end`. It is still a
 * host function rather than a value-equality matcher because the comparand — TODAY —
 * is ambient: no frontmatter carries it, so `matchPath`/`matchValue` cannot express
 * "this period contains now".
 */
export class EpisodePeriodHelpers {
  /**
   * The LOCAL calendar day as `YYYY-MM-DD`.
   *
   * Deliberately built from the local getters rather than `toISOString()`: the UTC
   * form names the wrong day for roughly a fifth of the local 24h in UTC+5, which is
   * exactly the window where "is this episode happening now" flips. Same local basis
   * as the `$today` date-token line (reqs 5c47471a / 26d79c70 / 96be4042).
   */
  static localToday(now: Date = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Normalise a frontmatter date value to its `YYYY-MM-DD` calendar-day key, or null
   * when it is absent, empty or not a well-formed date.
   *
   * ⚠ An UNQUOTED `life__Episode_start: 2026-04-02` — which is how every real episode
   * stores it — is a YAML **timestamp**, so the parser hands us a `Date`, not a string.
   * Handling only strings makes this predicate return false for 100% of production
   * assets while string-fixture tests stay green. A zone-less YAML timestamp is parsed
   * as UTC midnight, so the calendar day comes from the UTC getters — the same reading
   * `DisplayNameTemplateEngine.applyValueFormat` uses for frontmatter dates.
   *
   * A quoted value arrives as a string; a value carrying a time component
   * (`2026-07-23T10:00:00`) compares by its calendar day. The array unwrap and
   * bracket/quote stripping mirror `PrintNameRuleService.resolveHostFunctionName`.
   */
  private static toDayKey(value: unknown): string | null {
    let raw = value;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      raw = raw[0];
    }

    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) return null;
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${String(raw.getUTCFullYear()).padStart(4, "0")}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
    }
    if (typeof raw !== "string") return null;

    const cleaned = raw
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"|"$/g, "")
      .trim();
    const key = cleaned.slice(0, DAY_KEY_LENGTH);
    if (!DAY_KEY_RE.test(key)) return null;
    // The regex checks SHAPE only — "2026-13-45" and "2026-02-31" match it. Round-tripping
    // through Date.UTC rejects them, so "malformed → not ongoing" holds for quoted values
    // too (an unquoted typo never reaches here: YAML rolls it over into a Date).
    const [year, month, day] = key.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return null;
    }
    return key;
  }

  /**
   * True iff the episode's period contains today, boundaries INCLUSIVE.
   *
   * - `start` on or before today AND (`end` absent OR on or after today) → ongoing.
   * - An episode that has started and carries NO end counts as ongoing indefinitely.
   *   That is intended: the marker doubles as a "you forgot to close this" signal.
   * - Absent / malformed `start`, or a malformed `end`, → false (fail-closed). An
   *   asset that cannot be judged must not claim to be happening now.
   *
   * Day keys are `YYYY-MM-DD`, so lexicographic comparison is exact calendar order.
   */
  static isEpisodeOngoing(
    metadata: Record<string, unknown>,
    now: Date = new Date(),
  ): boolean {
    const start = this.toDayKey(metadata.life__Episode_start);
    if (start === null) return false;

    const today = this.localToday(now);
    if (start > today) return false;

    const rawEnd = metadata.life__Episode_end;
    const endIsAbsent =
      rawEnd === undefined ||
      rawEnd === null ||
      (Array.isArray(rawEnd) && rawEnd.length === 0) ||
      String(rawEnd).trim() === "";
    if (endIsAbsent) return true;

    const end = this.toDayKey(rawEnd);
    if (end === null) return false;
    return end >= today;
  }
}
