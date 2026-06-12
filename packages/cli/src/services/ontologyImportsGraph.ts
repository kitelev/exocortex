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
 * but recursion depth must not depend on data). Returns EVERY component,
 * including the size-1 components of acyclic / leaf nodes, in reverse
 * topological order (a component is emitted after all components reachable
 * from it). This is the building block for both the DAG check ({@link
 * tarjanSCC}, which filters size ≥ 2) and the condensation ({@link condense}).
 */
export function stronglyConnectedComponents(
  nodes: string[],
  edges: AdjacencyMap,
): string[][] {
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
          sccs.push(component);
        }
      }
    }
  }

  return sccs;
}

/**
 * Cycles in a directed graph: only the strongly-connected components of size
 * ≥ 2. In a graph without self-loops those are exactly the cycles, which is
 * what the imports DAG check reports.
 */
export function tarjanSCC(nodes: string[], edges: AdjacencyMap): string[][] {
  return stronglyConnectedComponents(nodes, edges).filter(
    (component) => component.length >= 2,
  );
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

/**
 * Condensation of a directed graph: every strongly-connected component is
 * collapsed into one super-node. The resulting super-graph is always a DAG —
 * this is what makes a "transitive reduction of the condensation"
 * (RFC df39007b §Решение Шаг 1b) well-defined even when the underlying derived
 * graph is full of cycles.
 */
export interface Condensation {
  /** Components, `components[i]` = the node uids in super-node `i`. */
  components: string[][];
  /** node uid → its super-node index. */
  componentOf: Map<string, number>;
  /** DAG edges between distinct super-nodes (`i → {j, …}`, `i ≠ j`). */
  condensedEdges: Map<number, Set<number>>;
}

export function condense(nodes: string[], edges: AdjacencyMap): Condensation {
  const components = stronglyConnectedComponents(nodes, edges);
  const componentOf = new Map<string, number>();
  components.forEach((component, i) => {
    for (const node of component) componentOf.set(node, i);
  });

  const condensedEdges = new Map<number, Set<number>>();
  for (const [from, tos] of edges) {
    const ci = componentOf.get(from);
    if (ci === undefined) continue;
    for (const to of tos) {
      const cj = componentOf.get(to);
      if (cj === undefined || ci === cj) continue;
      let set = condensedEdges.get(ci);
      if (!set) {
        set = new Set();
        condensedEdges.set(ci, set);
      }
      set.add(cj);
    }
  }

  return { components, componentOf, condensedEdges };
}

/**
 * Transitive reduction of a DAG: the unique minimal edge set with identical
 * reachability. Edge `a → b` is kept iff `b` is NOT reachable from `a` via any
 * path of length ≥ 2 (i.e. no other direct successor of `a` already reaches
 * `b`).
 *
 * Precondition: `edges` is acyclic. Callers run this only on the acyclic part
 * of the derived graph (cross-SCC edges) and on the condensation — both DAGs.
 * On a cyclic input the result is unspecified (cycle edges may be dropped),
 * never throws.
 */
export function transitiveReduction(
  nodes: string[],
  edges: AdjacencyMap,
): AdjacencyMap {
  const closure = transitiveClosure(nodes, edges);
  const reduced: AdjacencyMap = new Map();
  for (const [from, tos] of edges) {
    for (const to of tos) {
      let redundant = false;
      for (const via of tos) {
        if (via === to) continue;
        if (closure.get(via)?.has(to)) {
          redundant = true;
          break;
        }
      }
      if (!redundant) {
        let set = reduced.get(from);
        if (!set) {
          set = new Set();
          reduced.set(from, set);
        }
        set.add(to);
      }
    }
  }
  return reduced;
}

export interface WeightedEdge {
  source: string;
  target: string;
  weight: number;
}

/**
 * Greedy feedback-arc-set heuristic (Eades–Lin–Smyth GR), weighted by edge
 * occurrence count. Returns the set of edges whose removal makes the subgraph
 * acyclic, preferring to cut LOW-weight (low link-count) edges — the
 * RFC df39007b R1 heuristic «backward-рёбра с минимальным link-count».
 *
 * Minimum-weight FAS is NP-hard; GR is the standard linear-arrangement
 * heuristic: build a vertex sequence by repeatedly peeling sinks (appended to
 * the tail) and sources (appended to the head), then the node maximising
 * (weighted out-degree − weighted in-degree); the feedback arcs are the edges
 * that point backwards in that sequence. High (out−in) nodes land early, so
 * the backward edges that remain are dominated by low-weight links.
 *
 * Deterministic: every "pick a node" step breaks ties by ascending node id so
 * repeated runs (and tests) are stable. Self-loops are ignored.
 */
export function greedyFeedbackArcSet(
  nodes: string[],
  weightedEdges: WeightedEdge[],
): WeightedEdge[] {
  const outW = new Map<string, Map<string, number>>();
  const inW = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    outW.set(node, new Map());
    inW.set(node, new Map());
  }
  for (const edge of weightedEdges) {
    if (edge.source === edge.target) continue;
    const out = outW.get(edge.source);
    const inc = inW.get(edge.target);
    if (!out || !inc) continue; // edge referencing an unknown node
    out.set(edge.target, (out.get(edge.target) ?? 0) + edge.weight);
    inc.set(edge.source, (inc.get(edge.source) ?? 0) + edge.weight);
  }

  const remaining = new Set(nodes);
  const s1: string[] = [];
  const s2: string[] = [];

  const removeNode = (u: string): void => {
    remaining.delete(u);
    for (const v of outW.get(u)!.keys()) inW.get(v)?.delete(u);
    for (const v of inW.get(u)!.keys()) outW.get(v)?.delete(u);
    outW.get(u)!.clear();
    inW.get(u)!.clear();
  };
  const sumWeights = (m: Map<string, number>): number => {
    let total = 0;
    for (const w of m.values()) total += w;
    return total;
  };
  const sortedRemaining = (): string[] => [...remaining].sort();

  while (remaining.size > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const u of sortedRemaining()) {
        if (!remaining.has(u)) continue;
        if (outW.get(u)!.size === 0) {
          s2.unshift(u); // sinks build the tail
          removeNode(u);
          changed = true;
        }
      }
      for (const u of sortedRemaining()) {
        if (!remaining.has(u)) continue;
        if (inW.get(u)!.size === 0) {
          s1.push(u); // sources build the head
          removeNode(u);
          changed = true;
        }
      }
    }
    if (remaining.size > 0) {
      let best: string | null = null;
      let bestDelta = -Infinity;
      for (const u of sortedRemaining()) {
        const delta = sumWeights(outW.get(u)!) - sumWeights(inW.get(u)!);
        if (delta > bestDelta) {
          bestDelta = delta;
          best = u;
        }
      }
      if (best !== null) {
        s1.push(best);
        removeNode(best);
      }
    }
  }

  const order = [...s1, ...s2];
  const pos = new Map(order.map((node, i) => [node, i] as const));
  // Feedback arcs = edges pointing backwards in the linear arrangement.
  return weightedEdges.filter(
    (edge) =>
      edge.source !== edge.target &&
      (pos.get(edge.source) ?? 0) > (pos.get(edge.target) ?? 0),
  );
}
