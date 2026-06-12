import { describe, it, expect } from "@jest/globals";
import {
  tarjanSCC,
  stronglyConnectedComponents,
  transitiveClosure,
  condense,
  transitiveReduction,
  greedyFeedbackArcSet,
  type AdjacencyMap,
  type WeightedEdge,
} from "../../../src/services/ontologyImportsGraph.js";

function adjacency(edges: Array<[string, string]>): AdjacencyMap {
  const map: AdjacencyMap = new Map();
  for (const [from, to] of edges) {
    let set = map.get(from);
    if (!set) {
      set = new Set();
      map.set(from, set);
    }
    set.add(to);
  }
  return map;
}

describe("tarjanSCC", () => {
  it("returns no components for an empty graph", () => {
    expect(tarjanSCC([], new Map())).toEqual([]);
  });

  it("returns no components for a DAG (chain + diamond)", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = adjacency([
      ["a", "b"],
      ["a", "c"],
      ["b", "d"],
      ["c", "d"],
    ]);
    expect(tarjanSCC(nodes, edges)).toEqual([]);
  });

  it("detects a simple 2-cycle", () => {
    const sccs = tarjanSCC(["a", "b"], adjacency([["a", "b"], ["b", "a"]]));
    expect(sccs).toHaveLength(1);
    expect([...sccs[0]].sort()).toEqual(["a", "b"]);
  });

  it("detects a 3-cycle and leaves the tail out of the component", () => {
    // a → b → c → a, plus c → d (tail)
    const sccs = tarjanSCC(
      ["a", "b", "c", "d"],
      adjacency([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["c", "d"],
      ]),
    );
    expect(sccs).toHaveLength(1);
    expect([...sccs[0]].sort()).toEqual(["a", "b", "c"]);
  });

  it("detects multiple independent cycles", () => {
    const sccs = tarjanSCC(
      ["a", "b", "x", "y", "z", "lone"],
      adjacency([
        ["a", "b"],
        ["b", "a"],
        ["x", "y"],
        ["y", "z"],
        ["z", "x"],
      ]),
    );
    expect(sccs).toHaveLength(2);
    const sorted = sccs.map((c) => [...c].sort()).sort((a, b) => a.length - b.length);
    expect(sorted).toEqual([
      ["a", "b"],
      ["x", "y", "z"],
    ]);
  });

  it("ignores self-loops (caller excludes them per R7, but a stray one is not a cycle of size ≥2)", () => {
    // Even if a self-edge leaks into the adjacency map, a single node is not
    // reported: components of size 1 are filtered.
    const sccs = tarjanSCC(["a", "b"], adjacency([["a", "a"], ["a", "b"]]));
    expect(sccs).toEqual([]);
  });

  it("handles a large chain iteratively (no recursion-depth blowup)", () => {
    const nodes = Array.from({ length: 10_000 }, (_, i) => `n${i}`);
    const edges = adjacency(
      nodes.slice(0, -1).map((n, i) => [n, `n${i + 1}`] as [string, string]),
    );
    expect(tarjanSCC(nodes, edges)).toEqual([]);
  });
});

describe("transitiveClosure", () => {
  it("computes reachability over a chain (transitive imports, VL#2)", () => {
    const closure = transitiveClosure(
      ["a", "b", "c"],
      adjacency([
        ["a", "b"],
        ["b", "c"],
      ]),
    );
    expect(closure.get("a")).toEqual(new Set(["b", "c"]));
    expect(closure.get("b")).toEqual(new Set(["c"]));
    expect(closure.get("c")).toEqual(new Set());
  });

  it("does not include the node itself when not on a cycle", () => {
    const closure = transitiveClosure(["a", "b"], adjacency([["a", "b"]]));
    expect(closure.get("a")!.has("a")).toBe(false);
  });

  it("includes the node itself when it lies on a cycle", () => {
    const closure = transitiveClosure(
      ["a", "b"],
      adjacency([
        ["a", "b"],
        ["b", "a"],
      ]),
    );
    expect(closure.get("a")!.has("a")).toBe(true);
    expect(closure.get("a")!.has("b")).toBe(true);
  });

  it("merges reachability across a diamond", () => {
    const closure = transitiveClosure(
      ["a", "b", "c", "d"],
      adjacency([
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ]),
    );
    expect(closure.get("a")).toEqual(new Set(["b", "c", "d"]));
  });

  it("returns empty sets for isolated nodes", () => {
    const closure = transitiveClosure(["a", "b"], new Map());
    expect(closure.get("a")).toEqual(new Set());
    expect(closure.get("b")).toEqual(new Set());
  });
});

describe("stronglyConnectedComponents", () => {
  it("returns a size-1 component for every node of a DAG", () => {
    const comps = stronglyConnectedComponents(
      ["a", "b", "c"],
      adjacency([
        ["a", "b"],
        ["b", "c"],
      ]),
    );
    expect(comps.map((c) => c.length).sort()).toEqual([1, 1, 1]);
    expect(comps.flat().sort()).toEqual(["a", "b", "c"]);
  });

  it("groups a cycle into one component and keeps the tail separate", () => {
    const comps = stronglyConnectedComponents(
      ["a", "b", "c", "d"],
      adjacency([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["c", "d"],
      ]),
    );
    const cycle = comps.find((c) => c.length > 1)!;
    expect([...cycle].sort()).toEqual(["a", "b", "c"]);
    expect(comps.find((c) => c.length === 1)).toEqual(["d"]);
  });
});

describe("condense", () => {
  it("collapses a cycle into one super-node and keeps the rest as a DAG", () => {
    // a → b → c → a (SCC) ; c → d ; d → e
    const nodes = ["a", "b", "c", "d", "e"];
    const edges = adjacency([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["c", "d"],
      ["d", "e"],
    ]);
    const { components, componentOf, condensedEdges } = condense(nodes, edges);

    // Three super-nodes: {a,b,c}, {d}, {e}.
    expect(components).toHaveLength(3);
    const cycleComp = componentOf.get("a")!;
    expect(componentOf.get("b")).toBe(cycleComp);
    expect(componentOf.get("c")).toBe(cycleComp);
    const dComp = componentOf.get("d")!;
    const eComp = componentOf.get("e")!;
    expect(new Set([cycleComp, dComp, eComp]).size).toBe(3);

    // Condensed DAG edges: cycle → d, d → e ; no intra-cycle edge survives.
    expect(condensedEdges.get(cycleComp)).toEqual(new Set([dComp]));
    expect(condensedEdges.get(dComp)).toEqual(new Set([eComp]));
    expect(condensedEdges.has(eComp)).toBe(false);
  });

  it("dedups parallel cross-SCC edges into a single super-edge", () => {
    // Two distinct edges from the {a,b} cycle into c collapse to one super-edge.
    const { componentOf, condensedEdges } = condense(
      ["a", "b", "c"],
      adjacency([
        ["a", "b"],
        ["b", "a"],
        ["a", "c"],
        ["b", "c"],
      ]),
    );
    const ab = componentOf.get("a")!;
    const c = componentOf.get("c")!;
    expect(condensedEdges.get(ab)).toEqual(new Set([c]));
  });
});

describe("transitiveReduction", () => {
  it("drops a shortcut edge already implied by a path", () => {
    // a → b → c plus a → c (redundant).
    const reduced = transitiveReduction(
      ["a", "b", "c"],
      adjacency([
        ["a", "b"],
        ["b", "c"],
        ["a", "c"],
      ]),
    );
    expect(reduced.get("a")).toEqual(new Set(["b"]));
    expect(reduced.get("b")).toEqual(new Set(["c"]));
  });

  it("keeps every edge of a diamond (none redundant)", () => {
    const reduced = transitiveReduction(
      ["a", "b", "c", "d"],
      adjacency([
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ]),
    );
    expect(reduced.get("a")).toEqual(new Set(["b", "c"]));
    expect(reduced.get("b")).toEqual(new Set(["d"]));
    expect(reduced.get("c")).toEqual(new Set(["d"]));
  });

  it("drops the long shortcut but keeps both parallel paths", () => {
    // a→b, a→c, a→d, b→d, c→d : a→d is redundant (via b or c); a→b, a→c stay.
    const reduced = transitiveReduction(
      ["a", "b", "c", "d"],
      adjacency([
        ["a", "b"],
        ["a", "c"],
        ["a", "d"],
        ["b", "d"],
        ["c", "d"],
      ]),
    );
    expect(reduced.get("a")).toEqual(new Set(["b", "c"]));
    expect(reduced.get("a")!.has("d")).toBe(false);
  });
});

describe("greedyFeedbackArcSet", () => {
  function weighted(edges: Array<[string, string, number]>): WeightedEdge[] {
    return edges.map(([source, target, weight]) => ({ source, target, weight }));
  }

  it("returns no arcs for an acyclic subgraph", () => {
    expect(
      greedyFeedbackArcSet(
        ["a", "b", "c"],
        weighted([
          ["a", "b", 3],
          ["b", "c", 3],
        ]),
      ),
    ).toEqual([]);
  });

  it("cuts the cheapest edge of a 2-cycle", () => {
    const fas = greedyFeedbackArcSet(
      ["a", "b"],
      weighted([
        ["a", "b", 3],
        ["b", "a", 1],
      ]),
    );
    expect(fas).toHaveLength(1);
    expect(fas[0]).toEqual({ source: "b", target: "a", weight: 1 });
  });

  it("breaks a 3-cycle by cutting the minimal-weight backward edge", () => {
    // a→b (5), b→c (5), c→a (1): GR orders [a,b,c]; the cheap c→a is the arc.
    const fas = greedyFeedbackArcSet(
      ["a", "b", "c"],
      weighted([
        ["a", "b", 5],
        ["b", "c", 5],
        ["c", "a", 1],
      ]),
    );
    expect(fas).toHaveLength(1);
    expect(fas[0]).toEqual({ source: "c", target: "a", weight: 1 });
  });

  it("is deterministic across runs (stable tie-break by node id)", () => {
    const edges = weighted([
      ["x", "y", 2],
      ["y", "z", 2],
      ["z", "x", 2],
    ]);
    const a = greedyFeedbackArcSet(["x", "y", "z"], edges);
    const b = greedyFeedbackArcSet(["x", "y", "z"], edges);
    expect(a).toEqual(b);
    // A single cut suffices to make a 3-cycle acyclic.
    expect(a).toHaveLength(1);
  });

  it("makes the subgraph acyclic once the returned arcs are removed", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = weighted([
      ["a", "b", 4],
      ["b", "c", 3],
      ["c", "d", 2],
      ["d", "a", 1],
      ["c", "a", 1],
    ]);
    const fas = greedyFeedbackArcSet(nodes, edges);
    const cut = new Set(fas.map((e) => `${e.source} ${e.target}`));
    const remaining: AdjacencyMap = new Map();
    for (const e of edges) {
      if (cut.has(`${e.source} ${e.target}`)) continue;
      let set = remaining.get(e.source);
      if (!set) {
        set = new Set();
        remaining.set(e.source, set);
      }
      set.add(e.target);
    }
    expect(tarjanSCC(nodes, remaining)).toEqual([]);
  });
});
