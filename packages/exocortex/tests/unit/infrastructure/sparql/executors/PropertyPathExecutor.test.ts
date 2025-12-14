import { PropertyPathExecutor, PropertyPathExecutorError } from "../../../../../src/infrastructure/sparql/executors/PropertyPathExecutor";
import type { ITripleStore } from "../../../../../src/interfaces/ITripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import type { TripleElement, PropertyPath, IRI as AlgebraIRI } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";

describe("PropertyPathExecutor", () => {
  let executor: PropertyPathExecutor;
  let mockTripleStore: jest.Mocked<ITripleStore>;
  let triples: Triple[];

  // Helper to create IRI
  const iri = (value: string): IRI => new IRI(value);
  const literal = (value: string): Literal => new Literal(value);

  // Helper to create algebra elements
  const algebraIri = (value: string): AlgebraIRI => ({ type: "iri", value });
  const algebraVar = (name: string): TripleElement => ({ type: "variable", value: name });

  // Helper to create property paths
  const simplePath = (predicate: string): PropertyPath => ({
    type: "path",
    pathType: "+",
    items: [algebraIri(predicate)],
  });

  beforeEach(() => {
    triples = [];
    mockTripleStore = {
      add: jest.fn(),
      match: jest.fn().mockImplementation((s, p, o) => {
        return Promise.resolve(
          triples.filter((t) => {
            if (s !== undefined && t.subject.toString() !== s.toString()) return false;
            if (p !== undefined && t.predicate.toString() !== p.toString()) return false;
            if (o !== undefined && t.object.toString() !== o.toString()) return false;
            return true;
          })
        );
      }),
      clear: jest.fn(),
      size: jest.fn().mockReturnValue(triples.length),
      getTriples: jest.fn().mockReturnValue(triples),
    };

    executor = new PropertyPathExecutor(mockTripleStore);
  });

  // Helper to collect results
  async function collectResults(
    subject: TripleElement,
    path: PropertyPath,
    object: TripleElement
  ): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];
    for await (const mapping of executor.execute(subject, path, object)) {
      results.push(mapping);
    }
    return results;
  }

  describe("Simple IRI path (single step)", () => {
    it("should match single predicate step", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:knows"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:knows"), iri("ex:c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:knows")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(2);
      const targets = results.map((r) => r.get("target")?.toString());
      expect(targets).toContain("<ex:b>");
      expect(targets).toContain("<ex:c>");
    });
  });

  describe("OneOrMore path (+)", () => {
    it("should find transitive closure with depth 1", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:parent"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:parent")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("ancestor"));

      expect(results.length).toBe(1);
      expect(results[0].get("ancestor")?.toString()).toBe("<ex:b>");
    });

    it("should find transitive closure with depth 3", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:parent"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:parent"), iri("ex:c")),
        new Triple(iri("ex:c"), iri("ex:parent"), iri("ex:d")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:parent")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("ancestor"));

      expect(results.length).toBe(3);
      const ancestors = results.map((r) => r.get("ancestor")?.toString());
      expect(ancestors).toContain("<ex:b>");
      expect(ancestors).toContain("<ex:c>");
      expect(ancestors).toContain("<ex:d>");
    });

    it("should handle cycles without infinite loop", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:next"), iri("ex:c")),
        new Triple(iri("ex:c"), iri("ex:next"), iri("ex:a")), // Cycle back to a
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("node"));

      expect(results.length).toBe(3);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("<ex:a>");
      expect(nodes).toContain("<ex:b>");
      expect(nodes).toContain("<ex:c>");
    });

    it("should not include start node (one or more steps required)", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("node"));

      expect(results.length).toBe(1);
      expect(results[0].get("node")?.toString()).toBe("<ex:b>");
    });
  });

  describe("ZeroOrMore path (*)", () => {
    it("should include start node (zero steps)", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("node"));

      expect(results.length).toBe(2);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("<ex:a>"); // Zero steps
      expect(nodes).toContain("<ex:b>"); // One step
    });

    it("should return only start when no matching predicates", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:other"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("node"));

      expect(results.length).toBe(1);
      expect(results[0].get("node")?.toString()).toBe("<ex:a>");
    });
  });

  describe("ZeroOrOne path (?)", () => {
    it("should include start node and one step", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "?",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("node"));

      expect(results.length).toBe(2);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("<ex:a>"); // Zero steps
      expect(nodes).toContain("<ex:b>"); // One step
    });

    it("should not include nodes at depth 2", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:next"), iri("ex:c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "?",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("node"));

      expect(results.length).toBe(2);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("<ex:a>");
      expect(nodes).toContain("<ex:b>");
      expect(nodes).not.toContain("<ex:c>"); // Too far
    });
  });

  describe("Inverse path (^)", () => {
    it("should traverse in reverse direction", async () => {
      triples = [
        new Triple(iri("ex:child"), iri("ex:parent"), iri("ex:adult")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("ex:parent")],
      };

      const results = await collectResults(algebraIri("ex:adult"), path, algebraVar("child"));

      expect(results.length).toBe(1);
      expect(results[0].get("child")?.toString()).toBe("<ex:child>");
    });

    it("should find multiple inverse matches", async () => {
      triples = [
        new Triple(iri("ex:child1"), iri("ex:parent"), iri("ex:adult")),
        new Triple(iri("ex:child2"), iri("ex:parent"), iri("ex:adult")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("ex:parent")],
      };

      const results = await collectResults(algebraIri("ex:adult"), path, algebraVar("child"));

      expect(results.length).toBe(2);
      const children = results.map((r) => r.get("child")?.toString());
      expect(children).toContain("<ex:child1>");
      expect(children).toContain("<ex:child2>");
    });
  });

  describe("Sequence path (/)", () => {
    it("should match two predicates in sequence", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:knows"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:likes"), iri("ex:c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("ex:knows"), algebraIri("ex:likes")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("<ex:c>");
    });

    it("should match three predicates in sequence", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:p1"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:p2"), iri("ex:c")),
        new Triple(iri("ex:c"), iri("ex:p3"), iri("ex:d")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("ex:p1"), algebraIri("ex:p2"), algebraIri("ex:p3")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("<ex:d>");
    });

    it("should return empty when sequence breaks", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:p1"), iri("ex:b")),
        // Missing: ex:b ex:p2 ?
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("ex:p1"), algebraIri("ex:p2")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });
  });

  describe("Alternative path (|)", () => {
    it("should match either predicate", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:knows"), iri("ex:b")),
        new Triple(iri("ex:a"), iri("ex:likes"), iri("ex:c")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("ex:knows"), algebraIri("ex:likes")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(2);
      const targets = results.map((r) => r.get("target")?.toString());
      expect(targets).toContain("<ex:b>");
      expect(targets).toContain("<ex:c>");
    });

    it("should match only one when other has no results", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:knows"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("ex:knows"), algebraIri("ex:likes")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("<ex:b>");
    });
  });

  describe("Nested paths", () => {
    it("should handle sequence inside oneOrMore", async () => {
      // Pattern: (ex:parent/ex:parent)+ - find ancestors at even depths
      triples = [
        new Triple(iri("ex:a"), iri("ex:parent"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:parent"), iri("ex:c")),
        new Triple(iri("ex:c"), iri("ex:parent"), iri("ex:d")),
        new Triple(iri("ex:d"), iri("ex:parent"), iri("ex:e")),
      ];

      const innerPath: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("ex:parent"), algebraIri("ex:parent")],
      };

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [innerPath],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("ancestor"));

      // Should reach c (2 steps) and e (4 steps)
      expect(results.length).toBe(2);
      const ancestors = results.map((r) => r.get("ancestor")?.toString());
      expect(ancestors).toContain("<ex:c>");
      expect(ancestors).toContain("<ex:e>");
    });

    it("should handle alternative inside zeroOrMore", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:knows"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:likes"), iri("ex:c")),
      ];

      const innerPath: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("ex:knows"), algebraIri("ex:likes")],
      };

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [innerPath],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("node"));

      expect(results.length).toBe(3);
      const nodes = results.map((r) => r.get("node")?.toString());
      expect(nodes).toContain("<ex:a>"); // Zero steps
      expect(nodes).toContain("<ex:b>"); // One step via knows
      expect(nodes).toContain("<ex:c>"); // Two steps via knows/likes
    });
  });

  describe("With bound target", () => {
    it("should filter results to match target", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b")),
        new Triple(iri("ex:b"), iri("ex:next"), iri("ex:c")),
        new Triple(iri("ex:c"), iri("ex:next"), iri("ex:d")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:next")],
      };

      // Look for path from a to c specifically
      const results = await collectResults(algebraIri("ex:a"), path, algebraIri("ex:c"));

      expect(results.length).toBe(1);
    });

    it("should return empty when target not reachable", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b")),
      ];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraIri("ex:c"));

      expect(results.length).toBe(0);
    });
  });

  describe("executeWithBindings", () => {
    it("should use existing bindings for subject", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:next"), iri("ex:b"))];

      const existingSolution = new SolutionMapping();
      existingSolution.set("start", iri("ex:a"));

      const pattern = {
        subject: { type: "variable" as const, value: "start" },
        predicate: {
          type: "path" as const,
          pathType: "+" as const,
          items: [algebraIri("ex:next")],
        },
        object: { type: "variable" as const, value: "end" },
      };

      const results: SolutionMapping[] = [];
      for await (const mapping of executor.executeWithBindings(pattern, existingSolution)) {
        results.push(mapping);
      }

      expect(results.length).toBe(1);
      expect(results[0].get("start")?.toString()).toBe("<ex:a>");
      expect(results[0].get("end")?.toString()).toBe("<ex:b>");
    });
  });

  describe("Edge Cases", () => {
    it("should return empty for path with no matches", async () => {
      // No triples at all
      triples = [];

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:nonexistent")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });

    it("should return only self for ZeroOrMore when no matches exist", async () => {
      triples = [];

      const path: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [algebraIri("ex:nonexistent")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(1);
      expect(results[0].get("target")?.toString()).toBe("<ex:a>");
    });

    it("should respect MAX_DEPTH limit for very deep paths", async () => {
      // Create a chain of 150 nodes (exceeds MAX_DEPTH = 100)
      triples = [];
      for (let i = 0; i < 150; i++) {
        triples.push(new Triple(iri(`ex:node${i}`), iri("ex:next"), iri(`ex:node${i + 1}`)));
      }

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [algebraIri("ex:next")],
      };

      const results = await collectResults(algebraIri("ex:node0"), path, algebraVar("target"));

      // Should stop at MAX_DEPTH (100) and not traverse all 150 nodes
      expect(results.length).toBeLessThanOrEqual(100);
      expect(results.length).toBeGreaterThan(50); // Should still find many nodes
    });

    it("should handle alternative path with both alternatives failing", async () => {
      triples = [new Triple(iri("ex:a"), iri("ex:other"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("ex:knows"), algebraIri("ex:likes")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });

    it("should handle sequence path with missing intermediate nodes", async () => {
      // Only has first step, missing second step
      triples = [new Triple(iri("ex:a"), iri("ex:p1"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [algebraIri("ex:p1"), algebraIri("ex:p2"), algebraIri("ex:p3")],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      expect(results.length).toBe(0);
    });

    it("should handle inverse path with no reverse matches", async () => {
      // Triple goes from a to b, inverse looks from b backwards
      triples = [new Triple(iri("ex:a"), iri("ex:knows"), iri("ex:b"))];

      const path: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [algebraIri("ex:knows")],
      };

      // Starting from 'a' with inverse - should find nothing since 'a' is not an object
      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("subject"));

      expect(results.length).toBe(0);
    });

    it("should handle deeply nested path expression", async () => {
      triples = [
        new Triple(iri("ex:a"), iri("ex:p1"), iri("ex:b")),
        new Triple(iri("ex:a"), iri("ex:p2"), iri("ex:c")),
        new Triple(iri("ex:b"), iri("ex:p1"), iri("ex:d")),
        new Triple(iri("ex:c"), iri("ex:p2"), iri("ex:e")),
      ];

      // Complex: ((p1|p2)/p1)+ - alternative followed by p1, one or more times
      const innerAlt: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [algebraIri("ex:p1"), algebraIri("ex:p2")],
      };

      const sequence: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [innerAlt, algebraIri("ex:p1")],
      };

      const path: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [sequence],
      };

      const results = await collectResults(algebraIri("ex:a"), path, algebraVar("target"));

      // Should reach 'd' (via a->b->d)
      expect(results.length).toBeGreaterThanOrEqual(1);
      const targets = results.map((r) => r.get("target")?.toString());
      expect(targets).toContain("<ex:d>");
    });
  });
});
