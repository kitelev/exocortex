/**
 * Fan-in adapters for the activity log (#3540) — pure mappers translating
 * existing producer events into {@link ActivityRecordInput} so the wiring sites
 * in `ExocortexPlugin.onload()` stay one-liners and the mapping is unit-testable
 * without standing up the whole plugin.
 */
import type { SwitchJournalEntry } from "../../infrastructure/adapters/ProfileApplyManager";
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
  "recovery-restoring": "Recovering interrupted switch",
  "recovery-completed": "Recovery complete",
};

function levelForPhase(phase: SwitchJournalEntry["phase"]): ActivityLevel {
  if (phase.includes("failed") || phase.includes("aborted")) return "error";
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
