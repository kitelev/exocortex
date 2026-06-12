/**
 * Pure graph algorithms for the ontology-imports audit
 * (RFC df39007b §Решение Шаг 1): Tarjan strongly-connected components for the
 * DAG check on the declared `exo__Ontology_imports` graph, and per-node
 * transitive closure (reachability) used to classify cross-ontology links as
 * valid (target ∈ closure of source's imports) vs violating.
 *
 * Self-loops are the caller's concern: per RFC R7 a self-import is a warning
 * and must be excluded from the edge set BEFORE SCC detection, so a node
 * importing itself does not register as a cycle.
 */

export type AdjacencyMap = Map<string, Set<string>>;

/**
 * Tarjan's strongly-connected components (iterative — vault graphs are small,
 * but recursion depth must not depend on data). Returns ONLY components of
 * size ≥ 2: in a graph without self-loops those are exactly the cycles, which
 * is what the DAG check reports.
 */
export function tarjanSCC(nodes: string[], edges: AdjacencyMap): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    // Iterative DFS with an explicit work stack of [node, neighborIterator].
    const work: Array<[string, Iterator<string>]> = [];
    const pushNode = (v: string): void => {
      index.set(v, counter);
      lowlink.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      work.push([v, (edges.get(v) ?? new Set()).values()]);
    };
    pushNode(root);

    while (work.length > 0) {
      const [v, neighbors] = work[work.length - 1];
      const next = neighbors.next();
      if (!next.done) {
        const w = next.value;
        if (!index.has(w)) {
          pushNode(w);
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1][0];
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(v)!));
        }
        if (lowlink.get(v) === index.get(v)) {
          const component: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            component.push(w);
          } while (w !== v);
          if (component.length >= 2) {
            sccs.push(component);
          }
        }
      }
    }
  }

  return sccs;
}

/**
 * Per-node transitive closure: `closure.get(a)` = every node reachable from
 * `a` via one or more edges (NOT including `a` itself unless `a` lies on a
 * cycle through itself). BFS per node — O(V·(V+E)), trivial at vault scale
 * (≤ ~100 ontologies).
 *
 * The imports invariant check is then: link a→b is valid ⟺
 * `a === b || closure.get(a)?.has(b)`.
 */
export function transitiveClosure(
  nodes: string[],
  edges: AdjacencyMap,
): Map<string, Set<string>> {
  const closure = new Map<string, Set<string>>();
  for (const start of nodes) {
    const reachable = new Set<string>();
    const queue: string[] = [...(edges.get(start) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of edges.get(current) ?? []) {
        if (!reachable.has(next)) queue.push(next);
      }
    }
    closure.set(start, reachable);
  }
  return closure;
}
