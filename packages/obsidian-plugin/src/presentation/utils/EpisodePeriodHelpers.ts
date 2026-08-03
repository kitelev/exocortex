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
   * when it is absent, empty or not a well-formed date. Takes the first element of an
   * array and strips wikilink brackets / quotes defensively, mirroring
   * `PrintNameRuleService.resolveHostFunctionName`. A value carrying a time component
   * (`2026-07-23T10:00:00`) therefore compares by its calendar day.
   */
  private static toDayKey(value: unknown): string | null {
    let raw = value;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      raw = raw[0];
    }
    if (typeof raw !== "string" && typeof raw !== "number") return null;

    const cleaned = String(raw)
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"|"$/g, "")
      .trim();
    const key = cleaned.slice(0, DAY_KEY_LENGTH);
    return DAY_KEY_RE.test(key) ? key : null;
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
