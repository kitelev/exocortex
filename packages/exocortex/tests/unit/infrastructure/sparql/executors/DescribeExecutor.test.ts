import { DescribeExecutor, type DescribeExecutorOptions } from "../../../../../src/infrastructure/sparql/executors/DescribeExecutor";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("DescribeExecutor", () => {
  let tripleStore: InMemoryTripleStore;
  let executor: DescribeExecutor;

  const rdfType = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const ex = (local: string) => new IRI(`http://example.org/${local}`);

  beforeEach(async () => {
    tripleStore = new InMemoryTripleStore();
    executor = new DescribeExecutor(tripleStore);

    await tripleStore.add(new Triple(ex("task1"), rdfType, ex("Task")));
    await tripleStore.add(new Triple(ex("task1"), ex("label"), new Literal("Task 1")));
    await tripleStore.add(new Triple(ex("task1"), ex("parent"), ex("project1")));

    await tripleStore.add(new Triple(ex("project1"), rdfType, ex("Project")));
    await tripleStore.add(new Triple(ex("project1"), ex("label"), new Literal("Project 1")));
  });

  describe("basic DESCRIBE functionality", () => {
    it("should describe resource as subject", async () => {
      const triples = await executor.execute([ex("task1")]);
      expect(triples.length).toBeGreaterThanOrEqual(3);
    });

    it("should describe resource as object", async () => {
      const triples = await executor.execute([ex("project1")]);
      const hasAsObject = triples.some(
        (t) => t.object.toString() === "http://example.org/project1"
      );
      expect(hasAsObject).toBe(true);
    });

    it("should eliminate duplicate triples", async () => {
      const triples = await executor.execute([ex("task1"), ex("task1")]);
      const unique = new Set(triples.map((t) => t.toString()));
      expect(triples.length).toBe(unique.size);
    });

    it("should describe by IRI string", async () => {
      const triples = await executor.describeByIRI("http://example.org/task1");
      expect(triples.length).toBeGreaterThanOrEqual(3);
    });

    it("should handle empty resource list", async () => {
      const triples = await executor.execute([]);
      expect(triples).toHaveLength(0);
    });
  });

  describe("SPARQL 1.2 DEPTH option", () => {
    beforeEach(async () => {
      // Create a deeper graph for testing depth
      // alice -> bob -> carol -> dave
      await tripleStore.add(new Triple(ex("alice"), ex("knows"), ex("bob")));
      await tripleStore.add(new Triple(ex("bob"), ex("knows"), ex("carol")));
      await tripleStore.add(new Triple(ex("carol"), ex("knows"), ex("dave")));
      await tripleStore.add(new Triple(ex("dave"), ex("label"), new Literal("Dave")));
    });

    it("should limit description to depth 1 (direct triples only)", async () => {
      const options: DescribeExecutorOptions = { depth: 1 };
      const triples = await executor.execute([ex("alice")], options);

      // Should include alice's direct triple (alice knows bob)
      const hasAliceKnowsBob = triples.some(
        (t) => t.subject.toString() === "http://example.org/alice" &&
               t.object.toString() === "http://example.org/bob"
      );
      expect(hasAliceKnowsBob).toBe(true);

      // Should NOT include bob's triple (bob knows carol) at depth 1
      const hasBobKnowsCarol = triples.some(
        (t) => t.subject.toString() === "http://example.org/bob" &&
               t.object.toString() === "http://example.org/carol"
      );
      expect(hasBobKnowsCarol).toBe(false);
    });

    it("should follow 2 hops with depth 2", async () => {
      const options: DescribeExecutorOptions = { depth: 2 };
      const triples = await executor.execute([ex("alice")], options);

      // Should include alice's direct triple
      const hasAliceKnowsBob = triples.some(
        (t) => t.subject.toString() === "http://example.org/alice" &&
               t.object.toString() === "http://example.org/bob"
      );
      expect(hasAliceKnowsBob).toBe(true);

      // Should include bob's triple (one hop from alice)
      const hasBobKnowsCarol = triples.some(
        (t) => t.subject.toString() === "http://example.org/bob" &&
               t.object.toString() === "http://example.org/carol"
      );
      expect(hasBobKnowsCarol).toBe(true);

      // Should NOT include carol's triple at depth 2
      const hasCarolKnowsDave = triples.some(
        (t) => t.subject.toString() === "http://example.org/carol" &&
               t.object.toString() === "http://example.org/dave"
      );
      expect(hasCarolKnowsDave).toBe(false);
    });

    it("should follow 3 hops with depth 3", async () => {
      const options: DescribeExecutorOptions = { depth: 3 };
      const triples = await executor.execute([ex("alice")], options);

      // Should include carol's triple at depth 3
      const hasCarolKnowsDave = triples.some(
        (t) => t.subject.toString() === "http://example.org/carol" &&
               t.object.toString() === "http://example.org/dave"
      );
      expect(hasCarolKnowsDave).toBe(true);
    });

    it("should return no triples with depth 0", async () => {
      const options: DescribeExecutorOptions = { depth: 0 };
      const triples = await executor.execute([ex("alice")], options);

      // Depth 0 should return nothing (no hops allowed)
      expect(triples).toHaveLength(0);
    });
  });

  describe("SPARQL 1.2 SYMMETRIC option", () => {
    beforeEach(async () => {
      // Add incoming links
      await tripleStore.add(new Triple(ex("manager"), ex("manages"), ex("project1")));
    });

    it("should include incoming triples by default (symmetric=true)", async () => {
      const triples = await executor.execute([ex("project1")]);

      // Should include the incoming triple (manager manages project1)
      const hasIncoming = triples.some(
        (t) => t.predicate.toString() === "http://example.org/manages" &&
               t.object.toString() === "http://example.org/project1"
      );
      expect(hasIncoming).toBe(true);
    });

    it("should include incoming triples when symmetric=true explicitly", async () => {
      const options: DescribeExecutorOptions = { symmetric: true };
      const triples = await executor.execute([ex("project1")], options);

      const hasIncoming = triples.some(
        (t) => t.predicate.toString() === "http://example.org/manages"
      );
      expect(hasIncoming).toBe(true);
    });

    it("should exclude incoming triples when symmetric=false", async () => {
      const options: DescribeExecutorOptions = { symmetric: false };
      const triples = await executor.execute([ex("project1")], options);

      // Should NOT include the incoming triple when symmetric is false
      const hasIncoming = triples.some(
        (t) => t.predicate.toString() === "http://example.org/manages"
      );
      expect(hasIncoming).toBe(false);

      // Should still include outgoing triples
      const hasOutgoing = triples.some(
        (t) => t.subject.toString() === "http://example.org/project1"
      );
      expect(hasOutgoing).toBe(true);
    });
  });

  describe("combined DEPTH and SYMMETRIC options", () => {
    beforeEach(async () => {
      // Create bidirectional relationships
      await tripleStore.add(new Triple(ex("alice"), ex("knows"), ex("bob")));
      await tripleStore.add(new Triple(ex("bob"), ex("likes"), ex("alice"))); // Incoming to alice
      await tripleStore.add(new Triple(ex("bob"), ex("knows"), ex("carol")));
    });

    it("should respect both depth and symmetric options", async () => {
      const options: DescribeExecutorOptions = { depth: 1, symmetric: true };
      const triples = await executor.execute([ex("alice")], options);

      // Should include alice's outgoing
      const hasAliceKnowsBob = triples.some(
        (t) => t.subject.toString() === "http://example.org/alice" &&
               t.object.toString() === "http://example.org/bob"
      );
      expect(hasAliceKnowsBob).toBe(true);

      // Should include incoming to alice
      const hasBobLikesAlice = triples.some(
        (t) => t.subject.toString() === "http://example.org/bob" &&
               t.object.toString() === "http://example.org/alice"
      );
      expect(hasBobLikesAlice).toBe(true);

      // Should NOT include bob's outgoing to carol (beyond depth 1 from alice)
      const hasBobKnowsCarol = triples.some(
        (t) => t.subject.toString() === "http://example.org/bob" &&
               t.object.toString() === "http://example.org/carol"
      );
      expect(hasBobKnowsCarol).toBe(false);
    });

    it("should follow depth with symmetric=false", async () => {
      const options: DescribeExecutorOptions = { depth: 2, symmetric: false };
      const triples = await executor.execute([ex("alice")], options);

      // Should include alice's outgoing
      const hasAliceKnowsBob = triples.some(
        (t) => t.subject.toString() === "http://example.org/alice"
      );
      expect(hasAliceKnowsBob).toBe(true);

      // Should NOT include incoming to alice when symmetric=false
      const hasBobLikesAlice = triples.some(
        (t) => t.predicate.toString() === "http://example.org/likes" &&
               t.object.toString() === "http://example.org/alice"
      );
      expect(hasBobLikesAlice).toBe(false);
    });
  });

  describe("describeByIRI with options", () => {
    it("should accept options when describing by IRI string", async () => {
      await tripleStore.add(new Triple(ex("alice"), ex("knows"), ex("bob")));
      await tripleStore.add(new Triple(ex("bob"), ex("knows"), ex("carol")));

      const options: DescribeExecutorOptions = { depth: 1 };
      const triples = await executor.describeByIRI("http://example.org/alice", options);

      const hasAliceKnowsBob = triples.some(
        (t) => t.subject.toString() === "http://example.org/alice"
      );
      expect(hasAliceKnowsBob).toBe(true);

      // Should not follow to carol at depth 1
      const hasBobKnowsCarol = triples.some(
        (t) => t.object.toString() === "http://example.org/carol"
      );
      expect(hasBobKnowsCarol).toBe(false);
    });
  });
});
