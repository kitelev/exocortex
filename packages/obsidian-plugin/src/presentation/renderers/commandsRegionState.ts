/**
 * Cold-start COMMANDS region state (RFC 0002 §3.8 P13, GitHub #3588).
 *
 * Decides what the layout's COMMANDS region should render, given how many
 * command button groups resolved and whether the triple store has finished its
 * initial indexing.
 *
 * During the initial-indexing window the store is only partially populated, so
 * a create-instance command can resolve to ZERO buttons purely because its
 * binding/precondition triples have not landed yet (the #3588 partial-store
 * race). Showing a transient "indexing…" skeleton there beats a blank layout.
 * Once indexing completes we trust an empty result as genuine (no skeleton),
 * so assets that legitimately have no commands render nothing rather than a
 * permanent placeholder.
 *
 * Best-effort by design: this covers the big initial-`convertVault()` window
 * (the 10–20 s the "Lazy bootstrap folders" setting warns about); the narrow
 * residual where the store reports ready but a specific asset's commands still
 * lag remains blocked on #3588 engine timing.
 */
export type CommandsRegionState = "buttons" | "skeleton" | "empty";

/** User-facing skeleton copy (RFC §3.8 wording). */
export const COMMANDS_SKELETON_TEXT = "indexing… buttons will appear shortly";

/**
 * @param resolvedGroupCount number of command button groups the builder
 *   resolved for the active asset (0 when the COMMANDS region is empty).
 * @param storeReady whether the triple store finished initial indexing
 *   (`SPARQLApi.isReady()` — flips true after the first `convertVault()`).
 */
export function resolveCommandsRegionState(
  resolvedGroupCount: number,
  storeReady: boolean,
): CommandsRegionState {
  if (resolvedGroupCount > 0) return "buttons";
  if (!storeReady) return "skeleton";
  return "empty";
}
