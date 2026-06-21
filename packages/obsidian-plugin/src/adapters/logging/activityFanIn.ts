/**
 * Fan-in adapters for the activity log (#3540) — pure mappers translating
 * existing producer events into {@link ActivityRecordInput} so the wiring sites
 * in `ExocortexPlugin.onload()` stay one-liners and the mapping is unit-testable
 * without standing up the whole plugin.
 */
import type {
  ApplyProgressEvent,
  SwitchJournalEntry,
} from "../../infrastructure/adapters/ProfileApplyManager";
import type { ActivityLevel, ActivityRecordInput } from "./ActivityLogService";

/** Human-friendly labels for ProfileApplyManager journal phases. */
const PHASE_LABELS: Record<SwitchJournalEntry["phase"], string> = {
  starting: "Apply starting",
  completed: "Apply completed",
  failed: "Apply failed",
  "apply-starting": "Apply starting",
  "phase1-pulling": "Pulling AssetSpaces",
  "phase1-pulled": "Pulled AssetSpaces",
  "phase1-done": "Staging complete (phase 1)",
  "aborted-phase1": "Aborted before mutation (phase 1)",
  "phase2-start": "Materialization started (phase 2)",
  "phase2-destroy-cached": "Cached before unmount",
  "phase2-destroyed": "Unmounted",
  "phase2-materializing": "Materializing",
  "phase2-materialized": "Mounted",
  "phase2-done": "Materialization complete (phase 2)",
  "git-commit-done": "Committed submodule pointers",
  "apply-completed": "Apply completed",
  "apply-failed": "Apply failed",
  "rest-rollback-unmounted": "Rolled back mount (apply failed)",
  "recovery-restoring": "Recovering interrupted switch",
  "recovery-resuming": "Resuming interrupted apply",
  "recovery-completed": "Recovery complete",
};

function levelForPhase(phase: SwitchJournalEntry["phase"]): ActivityLevel {
  if (phase.includes("failed") || phase.includes("aborted")) return "error";
  // #3548 — a rollback unmount is a recovery action on a failure path: surface
  // it above plain "info" (the paired `apply-failed` entry carries "error").
  if (phase === "rest-rollback-unmounted") return "warn";
  return "info";
}

/**
 * Map a ProfileApplyManager journal entry to an activity record.
 *
 * Per-AssetSpace phases (those carrying an `as` UID — mount/unmount/cache of a
 * single AssetSpace) become `category:"mount"`; the overall apply lifecycle
 * (starting / phase boundaries / completed / failed) becomes `category:"profile"`.
 * The 8-char AssetSpace prefix, elapsed time, and error (when present) are
 * appended to keep each line self-describing.
 */
export function journalEntryToActivity(
  entry: SwitchJournalEntry,
): ActivityRecordInput {
  const category = entry.as ? "mount" : "profile";
  const label = PHASE_LABELS[entry.phase] ?? entry.phase;
  const asPart = entry.as ? ` ${entry.as.slice(0, 8)}` : "";
  const elapsedPart =
    entry.elapsedMs !== undefined ? ` (${entry.elapsedMs}ms)` : "";
  const errorPart = entry.error ? `: ${entry.error}` : "";
  return {
    category,
    level: levelForPhase(entry.phase),
    message: `${label}${asPart}${elapsedPart}${errorPart}`,
  };
}

/** Present-tense verbs for the live per-AssetSpace progress feed. */
const PROGRESS_VERBS: Record<"pull" | "mount" | "unmount", string> = {
  pull: "Pulling",
  mount: "Mounting",
  unmount: "Unmounting",
};

/**
 * Present-tense verbs for the finer within-AS sub-phases
 * (#al-activitylog-progress) surfaced by the mount core during a slow mount.
 */
const SUBSTEP_VERBS: Record<"fetch" | "extract" | "materialize", string> = {
  fetch: "Fetching",
  extract: "Extracting",
  materialize: "Installing",
};

/**
 * Map a live {@link ApplyProgressEvent} to a `category:"progress"` activity
 * record so the log shows a long apply is actively progressing. Cases:
 *  - per-AS op WITHOUT `step` — the 4b2bc60f baseline start marker, e.g.
 *    `Mounting kpc abc12345 (2 of 5)`;
 *  - per-AS op WITH `step` — a finer within-AS sub-phase, e.g.
 *    `Fetching kpc abc12345 (2 of 5)` (#al-activitylog-progress);
 *  - `reindex` — the apply-tail RDF rebuild, e.g. `Reindexing vault after apply`.
 * Always `info` level (progress is not a failure signal); the 8-char AssetSpace
 * prefix and N-of-M count keep each per-AS line self-describing.
 */
export function progressToActivity(
  event: ApplyProgressEvent,
): ActivityRecordInput {
  if (event.op === "reindex") {
    return {
      category: "progress",
      level: "info",
      message: "Reindexing vault after apply",
    };
  }
  const verb =
    event.step !== undefined
      ? SUBSTEP_VERBS[event.step]
      : (PROGRESS_VERBS[event.op] ?? event.op);
  const asPrefix = event.as.slice(0, 8);
  // Avoid a redundant prefix when the label IS just the UID prefix.
  const labelPart =
    event.label && event.label !== asPrefix
      ? `${event.label} ${asPrefix}`
      : asPrefix;
  return {
    category: "progress",
    level: "info",
    message: `${verb} ${labelPart} (${event.index} of ${event.total})`,
  };
}

/**
 * Map a periodic indexing-progress tick to a `category:"progress"` record
 * (#al-activitylog-progress). The {@link VaultRDFIndexer} full walk (cold-start
 * init AND profile-apply reindex) emits `(processed, total)` every N files so a
 * long index visibly advances — e.g. `Indexing vault: 400 of 5123 assets` —
 * instead of going silent until the one-shot completion notice (#3472).
 * Always `info` level.
 */
export function indexProgressToActivity(
  processed: number,
  total: number,
): ActivityRecordInput {
  return {
    category: "progress",
    level: "info",
    message: `Indexing vault: ${processed} of ${total} assets`,
  };
}
