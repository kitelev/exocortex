import { OptionalExecutor } from "../../../../../src/infrastructure/sparql/executors/OptionalExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("OptionalExecutor", () => {
  let executor: OptionalExecutor;

  beforeEach(() => {
    executor = new OptionalExecutor();
  });

  it("should preserve left solutions when right matches", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("task", new IRI("http://example.org/task1"));
        s.set("label", new Literal("Task 1"));
        return s;
      })(),
    ];

    const right = [
      (() => {
        const s = new SolutionMapping();
        s.set("task", new IRI("http://example.org/task1"));
        s.set("priority", new Literal("high"));
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(1);
    expect(results[0].has("task")).toBe(true);
    expect(results[0].has("label")).toBe(true);
    expect(results[0].has("priority")).toBe(true);
  });

  it("should preserve left solutions when right does not match", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("task", new IRI("http://example.org/task1"));
        return s;
      })(),
    ];

    const right = [
      (() => {
        const s = new SolutionMapping();
        s.set("task", new IRI("http://example.org/task2"));
        s.set("priority", new Literal("high"));
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(1);
    expect(results[0].has("task")).toBe(true);
    expect(results[0].has("priority")).toBe(false);
  });

  it("should handle empty right (all left solutions preserved)", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("value"));
        return s;
      })(),
    ];

    const right: SolutionMapping[] = [];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(1);
    expect(results[0].get("x")).toBeDefined();
  });

  it("should handle multiple matches", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("a"));
        return s;
      })(),
    ];

    const right = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("a"));
        s.set("y", new Literal("1"));
        return s;
      })(),
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("a"));
        s.set("y", new Literal("2"));
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(2);
  });

  it("should handle cross-join when no shared variables", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("a"));
        return s;
      })(),
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("b"));
        return s;
      })(),
    ];

    const right = [
      (() => {
        const s = new SolutionMapping();
        s.set("y", new Literal("1"));
        return s;
      })(),
      (() => {
        const s = new SolutionMapping();
        s.set("y", new Literal("2"));
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    // Cross-join: 2 × 2 = 4, all compatible
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.has("x")).toBe(true);
      expect(r.has("y")).toBe(true);
    }
  });

  describe("hash-join correctness", () => {
    it("should produce identical results to nested-loop for mixed match/no-match", async () => {
      const left = [
        (() => { const s = new SolutionMapping(); s.set("s", new IRI("http://example.org/a")); s.set("p", new Literal("1")); return s; })(),
        (() => { const s = new SolutionMapping(); s.set("s", new IRI("http://example.org/b")); s.set("p", new Literal("2")); return s; })(),
        (() => { const s = new SolutionMapping(); s.set("s", new IRI("http://example.org/c")); s.set("p", new Literal("3")); return s; })(),
      ];

      const right = [
        (() => { const s = new SolutionMapping(); s.set("s", new IRI("http://example.org/a")); s.set("q", new Literal("x")); return s; })(),
        (() => { const s = new SolutionMapping(); s.set("s", new IRI("http://example.org/c")); s.set("q", new Literal("z")); return s; })(),
      ];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(3);

      // a matches → merged with q
      const a = results.find(r => r.get("p")?.toString() === '"1"');
      expect(a).toBeDefined();
      expect(a!.get("q")?.toString()).toBe('"x"');

      // b has no match → preserved without q
      const b = results.find(r => r.get("p")?.toString() === '"2"');
      expect(b).toBeDefined();
      expect(b!.has("q")).toBe(false);

      // c matches → merged with q
      const c = results.find(r => r.get("p")?.toString() === '"3"');
      expect(c).toBeDefined();
      expect(c!.get("q")?.toString()).toBe('"z"');
    });
  });

  describe("performance regression", () => {
    it("should complete 1000×1000 hash-join with shared variable in <1s", async () => {
      const N = 1000;
      const left: SolutionMapping[] = [];
      const right: SolutionMapping[] = [];

      for (let i = 0; i < N; i++) {
        const s = new SolutionMapping();
        s.set("task", new IRI(`http://example.org/task${i}`));
        s.set("label", new Literal(`Task ${i}`));
        left.push(s);
      }

      for (let i = 0; i < N; i++) {
        const s = new SolutionMapping();
        s.set("task", new IRI(`http://example.org/task${i}`));
        s.set("priority", new Literal(`prio-${i}`));
        right.push(s);
      }

      const start = performance.now();
      const results = await executor.executeAll(left, right);
      const elapsed = performance.now() - start;

      // Each left has exactly 1 match → N results
      expect(results).toHaveLength(N);
      expect(elapsed).toBeLessThan(1000);

      // Verify correctness: each result has all 3 bindings
      for (const r of results) {
        expect(r.has("task")).toBe(true);
        expect(r.has("label")).toBe(true);
        expect(r.has("priority")).toBe(true);
      }
    });

    it("should complete 1000×1000 with partial matches in <1s", async () => {
      const N = 1000;
      const left: SolutionMapping[] = [];
      const right: SolutionMapping[] = [];

      for (let i = 0; i < N; i++) {
        const s = new SolutionMapping();
        s.set("task", new IRI(`http://example.org/task${i}`));
        left.push(s);
      }

      // Only even-numbered tasks have matches
      for (let i = 0; i < N; i += 2) {
        const s = new SolutionMapping();
        s.set("task", new IRI(`http://example.org/task${i}`));
        s.set("extra", new Literal(`val-${i}`));
        right.push(s);
      }

      const start = performance.now();
      const results = await executor.executeAll(left, right);
      const elapsed = performance.now() - start;

      // 500 matched + 500 unmatched = 1000
      expect(results).toHaveLength(N);
      expect(elapsed).toBeLessThan(1000);

      // Verify matched solutions have "extra", unmatched don't
      const withExtra = results.filter(r => r.has("extra"));
      const withoutExtra = results.filter(r => !r.has("extra"));
      expect(withExtra).toHaveLength(500);
      expect(withoutExtra).toHaveLength(500);
    });
  });
});
