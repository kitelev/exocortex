/**
 * Transitive `exo__AssetSpace_dependsOn` closure (EKA Alpha D18 DAG, issue #3511).
 *
 * In the EKA Alpha 16-repo topology a profile declares only **leaf** AssetSpaces
 * in `exo__Profile_includes`; the full effective set is the transitive closure
 * over each AssetSpace's `exo__AssetSpace_dependsOn` edges. Example chain:
 *
 *   exoas-exodev → exoas-shared-private → exoas-public → exoas-exo → exoas-w3c
 *
 * so a profile declaring only `exoas-exodev` resolves to all five. Both the CLI
 * resolver (`CliProfileResolver`) and the plugin (`ProfileApplyManager`) consume
 * this single helper to keep the resolution logic identical
 * (`multi-parser-predicate-migration` parity rule).
 *
 * Pure + cycle-safe: a `visited` set makes a malformed cyclic DAG terminate
 * instead of looping. Self-edges and duplicate edges are idempotent.
 */

/**
 * Expand a set of root AssetSpace UIDs to the transitive closure over their
 * `dependsOn` edges (BFS, cycle-guarded).
 *
 * @param roots The directly-declared AssetSpace UIDs (a profile's `_includes`
 *   chain). Each root is included in the result.
 * @param dependsOn Map of AssetSpace UID → the UIDs it directly depends on.
 *   AssetSpaces with no edge may be absent from the map (treated as no deps).
 * @returns The closure: every root plus every transitively-reachable dependency.
 */
export function transitiveDependsOnClosure(
  roots: Iterable<string>,
  dependsOn: ReadonlyMap<string, ReadonlyArray<string>>,
): Set<string> {
  const closure = new Set<string>();
  const queue: string[] = [];
  for (const root of roots) {
    if (!closure.has(root)) {
      closure.add(root);
      queue.push(root);
    }
  }
  while (queue.length > 0) {
    const uid = queue.shift();
    if (uid === undefined) break;
    const deps = dependsOn.get(uid);
    if (deps === undefined) continue;
    for (const dep of deps) {
      if (!closure.has(dep)) {
        closure.add(dep);
        queue.push(dep);
      }
    }
  }
  return closure;
}
