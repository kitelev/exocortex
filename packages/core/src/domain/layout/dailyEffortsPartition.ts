/**
 * dailyEffortsPartition — pure single-scan split of a day's efforts into the
 * three class partitions used by the daily-note Layout (RL#1 / RL#4b / VL#4,
 * RFC pn__DailyNote toggles):
 *
 *   - `projects` — `ems__Project` instances of the day.
 *   - `actions`  — `ems__Action` instances of the day (Action is a subclass of
 *                  `ems__Effort`, RL#3 — already declared in TBox).
 *   - `tasks`    — every other effort of the day (RL#1 inclusive carve-out):
 *                  `ems__Task`, `ems__Meeting`, `ems__Initiative`, … — anything
 *                  that is neither Action nor Project. Meetings deliberately
 *                  stay here so the default view does not lose them.
 *
 * Each effort is placed in exactly one bucket; the scan is O(n) over the
 * efforts (one pass, no per-class re-scan) per the review perf note.
 *
 * Class matching is dual-form aware (per `sparql-iri-form-pre-verify`): a class
 * ref is treated as Action/Project if it contains the symbolic IRI
 * (`ems__Action` / `ems__Project`, e.g. `[[ems__Project]]`,
 * `[[uid|ems__Project]]`) OR normalises to the class UID (UID-canon
 * `[[<uid>]]`). This keeps the carve-out correct whether instances carry
 * symbolic, aliased, or UID-only `exo__Instance_class` references.
 *
 * @module domain/layout
 * @since RFC pn__DailyNote toggles (req a38ac95b)
 */

import { AssetClass } from "../constants/AssetClass";
import { WikiLinkHelpers } from "../../utilities/WikiLinkHelpers";

/** TBox UID of `ems__Action` (UID-canon `exo__Instance_class` form). */
export const EMS_ACTION_CLASS_UID = "6a99d2ca-d402-4734-a10b-33f5f1a1aa42";
/** TBox UID of `ems__Project` (UID-canon `exo__Instance_class` form). */
export const EMS_PROJECT_CLASS_UID = "7db5eeff-718a-49b0-8d2b-39b084a356e3";

export interface DailyEffortsPartitioned<T> {
  readonly actions: readonly T[];
  readonly tasks: readonly T[];
  readonly projects: readonly T[];
  /**
   * Efforts CLOSED on the note's day (req b2a33efc / issue #3781). This axis is
   * ORTHOGONAL to the three class buckets: `partitionDailyEffortsByClass` fills
   * only the class buckets and leaves `closed` empty; the `closed` list is
   * supplied by the caller (the renderer), which computes it from a local-tz
   * closure-date match (`ExoLayoutRenderer.computeDailyPartition`). An effort
   * can appear in BOTH its class bucket and `closed` (Done tasks) or ONLY in
   * `closed` (Trashed-only closures with no start/end/planned timestamp).
   */
  readonly closed: readonly T[];
}

function toClassArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") return [value];
  return [];
}

/**
 * Whether any class ref in the list denotes `symbolicIRI`/`uid`. Matches the
 * symbolic IRI by substring (catching `[[ems__Project]]` and
 * `[[uid|ems__Project]]`, same semantics as the legacy DailyTasksRenderer
 * project skip) OR the normalised UID exactly (catching UID-canon `[[uid]]`).
 */
function classListMatches(
  classes: readonly string[],
  symbolicIRI: string,
  uid: string,
): boolean {
  for (const raw of classes) {
    if (typeof raw !== "string") continue;
    if (raw.includes(symbolicIRI)) return true;
    if (WikiLinkHelpers.normalize(raw) === uid) return true;
  }
  return false;
}

/**
 * Partition a list of day-scoped efforts into actions / tasks / projects.
 *
 * @param efforts   the day's efforts (already filtered by `isEffortInDay`).
 * @param classesOf extracts a list of raw `exo__Instance_class` refs for an
 *                  effort (defaults to reading `exo__Instance_class` off a
 *                  `{ metadata }` shape).
 */
export function partitionDailyEffortsByClass<
  T extends { metadata?: Record<string, unknown> },
>(
  efforts: readonly T[],
  classesOf: (e: T) => readonly string[] = defaultClassesOf,
): DailyEffortsPartitioned<T> {
  const actions: T[] = [];
  const tasks: T[] = [];
  const projects: T[] = [];

  for (const effort of efforts) {
    const classes = classesOf(effort);
    // Project takes precedence, then Action; everything else is a Task (RL#1
    // inclusive carve-out — meetings and other Effort subclasses land here).
    if (classListMatches(classes, AssetClass.PROJECT, EMS_PROJECT_CLASS_UID)) {
      projects.push(effort);
    } else if (
      classListMatches(classes, AssetClass.ACTION, EMS_ACTION_CLASS_UID)
    ) {
      actions.push(effort);
    } else {
      tasks.push(effort);
    }
  }

  // `closed` is an orthogonal axis filled by the caller (the renderer computes
  // it from a local-tz closure-date match); this class-partition function only
  // fills the class buckets. Default empty keeps existing callers/tests intact.
  return { actions, tasks, projects, closed: [] };
}

function defaultClassesOf(e: { metadata?: Record<string, unknown> }): string[] {
  return toClassArray(e.metadata?.["exo__Instance_class"]);
}
