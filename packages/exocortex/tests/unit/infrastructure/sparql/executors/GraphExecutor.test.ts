import { GraphExecutor, GraphExecutorError } from "../../../../../src/infrastructure/sparql/executors/GraphExecutor";
import { GraphOperation, AlgebraOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";

describe("GraphExecutor", () => {
  let tripleStore: InMemoryTripleStore;
  let executor: GraphExecutor;

  // Helper to create pattern executor that simulates BGP execution
  const createMockPatternExecutor = (solutions: SolutionMapping[]) => {
    return async function* (_pattern: AlgebraOperation, _graphContext?: IRI): AsyncIterableIterator<SolutionMapping> {
      for (const solution of solutions) {
        yield solution;
      }
    };
  };

  beforeEach(async () => {
    tripleStore = new InMemoryTripleStore();
    executor = new GraphExecutor(tripleStore);

    // Set up test data in default graph
    await tripleStore.add(
      new Triple(
        new IRI("http://example.org/subject1"),
        new IRI("http://example.org/predicate"),
        new Literal("Default graph value")
      )
    );

    // Set up test data in named graph 1
    await tripleStore.addToGraph(
      new Triple(
        new IRI("http://example.org/s1"),
        new IRI("http://example.org/p1"),
        new Literal("Graph 1 value 1")
      ),
      new IRI("http://example.org/graph1")
    );
    await tripleStore.addToGraph(
      new Triple(
        new IRI("http://example.org/s2"),
        new IRI("http://example.org/p1"),
        new Literal("Graph 1 value 2")
      ),
      new IRI("http://example.org/graph1")
    );

    // Set up test data in named graph 2
    await tripleStore.addToGraph(
      new Triple(
        new IRI("http://example.org/s3"),
        new IRI("http://example.org/p2"),
        new Literal("Graph 2 value")
      ),
      new IRI("http://example.org/graph2")
    );
  });

  describe("GRAPH with concrete IRI", () => {
    it("should execute pattern against specific named graph", async () => {
      // Create solutions that would come from the named graph
      const expectedSolutions: SolutionMapping[] = [
        (() => {
          const s = new SolutionMapping();
          s.set("s", new IRI("http://example.org/s1"));
          s.set("o", new Literal("Graph 1 value 1"));
          return s;
        })(),
        (() => {
          const s = new SolutionMapping();
          s.set("s", new IRI("http://example.org/s2"));
          s.set("o", new Literal("Graph 1 value 2"));
          return s;
        })(),
      ];

      const operation: GraphOperation = {
        type: "graph",
        name: { type: "iri", value: "http://example.org/graph1" },
        pattern: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/p1" },
              object: { type: "variable", value: "o" },
            },
          ],
        },
      };

      const patternExecutor = createMockPatternExecutor(expectedSolutions);

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, patternExecutor)) {
        results.push(solution);
      }

      expect(results).toHaveLength(2);
      expect((results[0].get("s") as IRI).value).toBe("http://example.org/s1");
      expect((results[1].get("s") as IRI).value).toBe("http://example.org/s2");
    });

    it("should return empty results for non-existent named graph", async () => {
      const operation: GraphOperation = {
        type: "graph",
        name: { type: "iri", value: "http://example.org/nonexistent" },
        pattern: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "variable", value: "p" },
              object: { type: "variable", value: "o" },
            },
          ],
        },
      };

      const patternExecutor = createMockPatternExecutor([]);

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, patternExecutor)) {
        results.push(solution);
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("GRAPH with variable", () => {
    it("should iterate over all named graphs and bind graph variable", async () => {
      // Track which graph context is being used
      let graphContextsUsed: string[] = [];

      const patternExecutor = async function* (
        _pattern: AlgebraOperation,
        graphContext?: IRI
      ): AsyncIterableIterator<SolutionMapping> {
        if (graphContext) {
          graphContextsUsed.push(graphContext.value);

          // Simulate returning data from each graph
          const solution = new SolutionMapping();
          solution.set("s", new IRI(`http://example.org/subject-in-${graphContext.value.split('/').pop()}`));
          yield solution;
        }
      };

      const operation: GraphOperation = {
        type: "graph",
        name: { type: "variable", value: "g" },
        pattern: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "variable", value: "p" },
              object: { type: "variable", value: "o" },
            },
          ],
        },
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, patternExecutor)) {
        results.push(solution);
      }

      // Should have one result per named graph (2 named graphs)
      expect(results).toHaveLength(2);

      // Each result should have the ?g variable bound to the graph IRI
      const graphBindings = results.map((r) => (r.get("g") as IRI).value).sort();
      expect(graphBindings).toContain("http://example.org/graph1");
      expect(graphBindings).toContain("http://example.org/graph2");
    });

    it("should use bound graph variable value when already in solution", async () => {
      // Create a solution with ?g already bound
      const boundSolution = new SolutionMapping();
      boundSolution.set("g", new IRI("http://example.org/graph1"));

      // Track if pattern was executed with correct graph context
      let graphContextUsed: string | undefined;

      const patternExecutor = async function* (
        _pattern: AlgebraOperation,
        graphContext?: IRI
      ): AsyncIterableIterator<SolutionMapping> {
        graphContextUsed = graphContext?.value;
        const solution = new SolutionMapping();
        solution.set("s", new IRI("http://example.org/subject"));
        yield solution;
      };

      const operation: GraphOperation = {
        type: "graph",
        name: { type: "variable", value: "g" },
        pattern: {
          type: "bgp",
          triples: [],
        },
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, patternExecutor, boundSolution)) {
        results.push(solution);
      }

      // Should only execute against the bound graph
      expect(graphContextUsed).toBe("http://example.org/graph1");
      expect(results).toHaveLength(1);
    });
  });

  describe("Error handling", () => {
    it("should throw error for invalid graph name type", async () => {
      const operation: GraphOperation = {
        type: "graph",
        name: { type: "literal" as any, value: "invalid" },
        pattern: {
          type: "bgp",
          triples: [],
        },
      };

      const patternExecutor = createMockPatternExecutor([]);

      await expect(async () => {
        const results: SolutionMapping[] = [];
        for await (const solution of executor.execute(operation, patternExecutor)) {
          results.push(solution);
        }
      }).rejects.toThrow(GraphExecutorError);
    });
  });

  describe("Integration with InMemoryTripleStore", () => {
    it("should correctly query named graph storage", async () => {
      // Verify named graphs exist
      const graphs = await tripleStore.getNamedGraphs();
      expect(graphs).toHaveLength(2);

      // Verify triples in graph1
      const graph1Triples = await tripleStore.matchInGraph(
        undefined,
        undefined,
        undefined,
        new IRI("http://example.org/graph1")
      );
      expect(graph1Triples).toHaveLength(2);

      // Verify triples in graph2
      const graph2Triples = await tripleStore.matchInGraph(
        undefined,
        undefined,
        undefined,
        new IRI("http://example.org/graph2")
      );
      expect(graph2Triples).toHaveLength(1);

      // Verify default graph is separate
      const defaultTriples = await tripleStore.match();
      expect(defaultTriples).toHaveLength(1);
    });
  });
});

describe("InMemoryTripleStore Named Graph Support", () => {
  let store: InMemoryTripleStore;

  beforeEach(() => {
    store = new InMemoryTripleStore();
  });

  describe("addToGraph", () => {
    it("should add triple to default graph when graph is undefined", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new Literal("value")
      );

      await store.addToGraph(triple, undefined);

      const results = await store.match();
      expect(results).toHaveLength(1);
      expect(results[0].subject).toEqual(triple.subject);
    });

    it("should add triple to named graph when graph IRI provided", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new Literal("value")
      );
      const graphIRI = new IRI("http://example.org/graph1");

      await store.addToGraph(triple, graphIRI);

      // Should not be in default graph
      const defaultResults = await store.match();
      expect(defaultResults).toHaveLength(0);

      // Should be in named graph
      const graphResults = await store.matchInGraph(undefined, undefined, undefined, graphIRI);
      expect(graphResults).toHaveLength(1);
      expect(graphResults[0].subject).toEqual(triple.subject);
    });
  });

  describe("matchInGraph", () => {
    it("should match triples only in the specified named graph", async () => {
      const triple1 = new Triple(
        new IRI("http://example.org/s1"),
        new IRI("http://example.org/p"),
        new Literal("value1")
      );
      const triple2 = new Triple(
        new IRI("http://example.org/s2"),
        new IRI("http://example.org/p"),
        new Literal("value2")
      );
      const graph1 = new IRI("http://example.org/graph1");
      const graph2 = new IRI("http://example.org/graph2");

      await store.addToGraph(triple1, graph1);
      await store.addToGraph(triple2, graph2);

      // Query graph1
      const graph1Results = await store.matchInGraph(undefined, undefined, undefined, graph1);
      expect(graph1Results).toHaveLength(1);
      expect((graph1Results[0].object as Literal).value).toBe("value1");

      // Query graph2
      const graph2Results = await store.matchInGraph(undefined, undefined, undefined, graph2);
      expect(graph2Results).toHaveLength(1);
      expect((graph2Results[0].object as Literal).value).toBe("value2");
    });

    it("should return empty results for non-existent graph", async () => {
      const results = await store.matchInGraph(
        undefined,
        undefined,
        undefined,
        new IRI("http://example.org/nonexistent")
      );
      expect(results).toHaveLength(0);
    });
  });

  describe("getNamedGraphs", () => {
    it("should return all named graph IRIs", async () => {
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s1"), new IRI("http://example.org/p"), new Literal("v1")),
        new IRI("http://example.org/graph1")
      );
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s2"), new IRI("http://example.org/p"), new Literal("v2")),
        new IRI("http://example.org/graph2")
      );
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s3"), new IRI("http://example.org/p"), new Literal("v3")),
        new IRI("http://example.org/graph3")
      );

      const graphs = await store.getNamedGraphs();
      expect(graphs).toHaveLength(3);

      const graphNames = graphs.map((g) => g.value).sort();
      expect(graphNames).toEqual([
        "http://example.org/graph1",
        "http://example.org/graph2",
        "http://example.org/graph3",
      ]);
    });

    it("should not include default graph", async () => {
      await store.add(
        new Triple(new IRI("http://example.org/s"), new IRI("http://example.org/p"), new Literal("default"))
      );
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s"), new IRI("http://example.org/p"), new Literal("named")),
        new IRI("http://example.org/graph1")
      );

      const graphs = await store.getNamedGraphs();
      expect(graphs).toHaveLength(1);
      expect(graphs[0].value).toBe("http://example.org/graph1");
    });
  });

  describe("hasGraph", () => {
    it("should return true for existing graph with triples", async () => {
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s"), new IRI("http://example.org/p"), new Literal("v")),
        new IRI("http://example.org/graph1")
      );

      const exists = await store.hasGraph(new IRI("http://example.org/graph1"));
      expect(exists).toBe(true);
    });

    it("should return false for non-existent graph", async () => {
      const exists = await store.hasGraph(new IRI("http://example.org/nonexistent"));
      expect(exists).toBe(false);
    });
  });

  describe("clearGraph", () => {
    it("should clear only the specified named graph", async () => {
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s1"), new IRI("http://example.org/p"), new Literal("v1")),
        new IRI("http://example.org/graph1")
      );
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s2"), new IRI("http://example.org/p"), new Literal("v2")),
        new IRI("http://example.org/graph2")
      );

      await store.clearGraph(new IRI("http://example.org/graph1"));

      // Graph1 should be empty
      const graph1Results = await store.matchInGraph(
        undefined,
        undefined,
        undefined,
        new IRI("http://example.org/graph1")
      );
      expect(graph1Results).toHaveLength(0);

      // Graph2 should still have data
      const graph2Results = await store.matchInGraph(
        undefined,
        undefined,
        undefined,
        new IRI("http://example.org/graph2")
      );
      expect(graph2Results).toHaveLength(1);
    });
  });

  describe("countInGraph", () => {
    it("should return correct count for named graph", async () => {
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s1"), new IRI("http://example.org/p"), new Literal("v1")),
        new IRI("http://example.org/graph1")
      );
      await store.addToGraph(
        new Triple(new IRI("http://example.org/s2"), new IRI("http://example.org/p"), new Literal("v2")),
        new IRI("http://example.org/graph1")
      );

      const count = await store.countInGraph(new IRI("http://example.org/graph1"));
      expect(count).toBe(2);
    });

    it("should return 0 for non-existent graph", async () => {
      const count = await store.countInGraph(new IRI("http://example.org/nonexistent"));
      expect(count).toBe(0);
    });
  });

  describe("removeFromGraph", () => {
    it("should remove triple from specific named graph", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new Literal("value")
      );
      const graphIRI = new IRI("http://example.org/graph1");

      await store.addToGraph(triple, graphIRI);
      expect(await store.countInGraph(graphIRI)).toBe(1);

      const removed = await store.removeFromGraph(triple, graphIRI);
      expect(removed).toBe(true);
      expect(await store.countInGraph(graphIRI)).toBe(0);
    });

    it("should return false when removing non-existent triple", async () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new Literal("value")
      );

      const removed = await store.removeFromGraph(triple, new IRI("http://example.org/graph1"));
      expect(removed).toBe(false);
    });
  });
});
