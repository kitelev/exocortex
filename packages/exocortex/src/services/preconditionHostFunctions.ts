import type {
  EvalContext,
  HostFunction,
  PreconditionEvaluator,
} from "./PreconditionEvaluator";

/**
 * Host function: returns `true` when the target asset's filename does not
 * match its `exo__Asset_uid`. Used by the "Rename to UID" exocmd command
 * (vault asset `b610b0e5-beb2-43b0-b2fd-1601c7a5d160`) to hide the inline
 * button on assets that are already named to their UID.
 *
 * Returns `false` (don't show rename) when:
 *  - the context has no `assetUid` — nothing to rename to
 *  - the file basename already equals the asset's UID
 */
export const hasNonUidFilename: HostFunction = (ctx: EvalContext): boolean => {
  const uid = ctx.assetUid;
  if (typeof uid !== "string" || uid.trim() === "") return false;
  const basename = ctx.fileBasename;
  if (typeof basename !== "string") return false;
  return basename !== uid;
};

/**
 * Register all built-in host functions on a `PreconditionEvaluator`. Call
 * this once per evaluator instance so the same well-known functions are
 * available from every code path (plugin runtime, cold-start fast resolver,
 * CLI, tests).
 */
export function registerDefaultHostFunctions(
  evaluator: PreconditionEvaluator,
): void {
  evaluator.registerHostFunction("hasNonUidFilename", hasNonUidFilename);
}
