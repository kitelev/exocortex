import {
  isEpisodeOngoing as coreIsEpisodeOngoing,
  localToday as coreLocalToday,
} from "@kitelev/exocortex-core";

/**
 * Obsidian-side wrapper over the core episode-period predicates (req 5cd9fffe).
 *
 * The logic moved to `packages/core` so the CLI naming oracle runs the SAME predicate. Unlike its
 * sibling {@link BlockerHelpers}, nothing here ever touched Obsidian — the predicate reads only
 * the rendered instance's own `life__Episode_start` / `life__Episode_end`, which is why the move
 * needed no port at all. It is still a host function rather than a value-equality matcher because
 * the comparand — TODAY — is ambient: no frontmatter carries it, so `matchPath`/`matchValue`
 * cannot express "this period contains now".
 *
 * The class survives only to keep the existing import path and static-method shape working.
 */
export class EpisodePeriodHelpers {
  /**
   * The LOCAL calendar day as `YYYY-MM-DD`.
   *
   * Deliberately local rather than `toISOString()`: the UTC form names the wrong day for roughly
   * a fifth of the local 24h in UTC+5 — exactly the window where "is this episode happening now"
   * flips. Same local basis as the `$today` date-token line.
   */
  static localToday(now: Date = new Date()): string {
    return coreLocalToday(now);
  }

  /**
   * True iff the episode's period contains today, boundaries INCLUSIVE. An episode that has
   * started and carries no end counts as ongoing indefinitely — intended, since the marker
   * doubles as a "you forgot to close this" signal. Absent or malformed dates → false
   * (fail-closed): an asset that cannot be judged must not claim to be happening now.
   */
  static isEpisodeOngoing(
    metadata: Record<string, unknown>,
    now: Date = new Date(),
  ): boolean {
    return coreIsEpisodeOngoing(metadata, now);
  }
}
