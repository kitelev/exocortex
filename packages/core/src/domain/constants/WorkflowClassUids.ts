import { AssetClass } from "./AssetClass";

/**
 * RFC 36347daf Phase 2 — UID → AssetClass label map for the built-in status
 * workflows. These are the classes that ship with a default workflow
 * (Task + Project + Meeting) so a `workflow_transition` grounding can resolve
 * them even when their `exo__Instance_class` is stored in UID-canon strip-form
 * (`"[[<uid>]]"`, no alias) — the canonical vault representation post-#3165.
 *
 * NOT an exhaustive class registry: any *other* effort-bearing class gets a
 * workflow purely from vault data — a per-asset `ems__Effort_workflow` override
 * or a per-class `ems__Workflow` ABox (Homoiconicity Invariant). Classes with
 * no applicable workflow resolve to `null` (graceful no-op) rather than
 * crashing. See {@link WorkflowResolver.resolveForAssetOrNull}.
 *
 * Drift guards (defense in depth):
 *   1. `GroundingExecutor.status_uid_integrity.test.ts` — UUID-shape + uniqueness.
 *   2. Vault `validate-wikilinks` hook blocks writes to renamed class TBox files.
 */
export const CLASS_UID_TO_LABEL: Readonly<Record<string, string>> =
  Object.freeze({
    "1b20a8f0-d745-4e93-91db-4531b3df120e": AssetClass.TASK,
    "7db5eeff-718a-49b0-8d2b-39b084a356e3": AssetClass.PROJECT,
    "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca": AssetClass.MEETING,
  });
