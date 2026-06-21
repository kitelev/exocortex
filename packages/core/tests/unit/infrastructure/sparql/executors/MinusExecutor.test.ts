import { MinusExecutor } from "../../../../../src/infrastructure/sparql/executors/MinusExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("MinusExecutor", () => {
  let executor: MinusExecutor;

  beforeEach(() => {
    executor = new MinusExecutor();
  });

  describe("Basic MINUS operations", () => {
    it("should remove matching solutions from left", async () => {
      // Left: task1, task2, task3
      // Right: task2 (done)
      // Result: task1, task3
      const left = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
        createSolution({ task: "http://example.org/task3" }),
      ];

      const right = [createSolution({ task: "http://example.org/task2" })];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(2);
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task1");
      expect((results[1].get("task") as IRI).value).toBe("http://example.org/task3");
    });

    it("should preserve all left solutions when right is empty", async () => {
      const left = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
      ];

      const right: SolutionMapping[] = [];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(2);
    });

    it("should return empty when all left solutions match right", async () => {
      const left = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
      ];

      const right = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
      ];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(0);
    });

    it("should handle empty left side", async () => {
      const left: SolutionMapping[] = [];

      const right = [createSolution({ task: "http://example.org/task1" })];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(0);
    });
  });

  describe("MINUS with no shared variables (disjoint domains)", () => {
    it("should preserve all left solutions when no variables are shared", async () => {
      // SPARQL 1.1 spec: MINUS with disjoint domains removes nothing
      // Left has ?task, Right has ?project (different variables)
      const left = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
      ];

      const right = [
        createSolution({ project: "http://example.org/project1" }),
        createSolution({ project: "http://example.org/project2" }),
      ];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(2);
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task1");
      expect((results[1].get("task") as IRI).value).toBe("http://example.org/task2");
    });
  });

  describe("MINUS with multiple shared variables", () => {
    it("should only exclude when ALL shared variables match", async () => {
      // Left: (task1, labelA), (task2, labelB)
      // Right: (task1, labelA) - exact match
      // Result: (task2, labelB) - task1/labelA excluded
      const left = [
        createSolutionMulti({ task: "http://example.org/task1", label: "Label A" }),
        createSolutionMulti({ task: "http://example.org/task2", label: "Label B" }),
      ];

      const right = [
        createSolutionMulti({ task: "http://example.org/task1", label: "Label A" }),
      ];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(1);
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task2");
    });

    it("should preserve when shared variables have different values", async () => {
      // Left: (task1, labelA)
      // Right: (task1, labelB) - task matches, but label differs
      // Result: (task1, labelA) preserved because label doesn't match
      const left = [
        createSolutionMulti({ task: "http://example.org/task1", label: "Label A" }),
      ];

      const right = [
        createSolutionMulti({ task: "http://example.org/task1", label: "Label B" }),
      ];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(1);
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task1");
    });
  });

  describe("MINUS with partial variable overlap", () => {
    it("should check only shared variables for compatibility", async () => {
      // Left: {task, label}
      // Right: {task, status} - only task is shared
      // Compatibility is based on shared variable (task) only
      const left = [
        createSolutionMulti({ task: "http://example.org/task1", label: "Label A" }),
        createSolutionMulti({ task: "http://example.org/task2", label: "Label B" }),
      ];

      const right = [
        createSolutionMulti({ task: "http://example.org/task1", status: "done" }),
      ];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(1);
      // task1 excluded (shared var 'task' matches), task2 preserved
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task2");
    });
  });

  describe("MINUS with literals", () => {
    it("should correctly compare literal values", async () => {
      const left = [
        createLiteralSolution({ status: "active" }),
        createLiteralSolution({ status: "done" }),
        createLiteralSolution({ status: "pending" }),
      ];

      const right = [createLiteralSolution({ status: "done" })];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(2);
      expect((results[0].get("status") as Literal).value).toBe("active");
      expect((results[1].get("status") as Literal).value).toBe("pending");
    });
  });

  describe("MINUS with multiple right solutions", () => {
    it("should exclude if compatible with ANY right solution", async () => {
      // Left: task1, task2, task3, task4
      // Right: task1 (done), task3 (done)
      // Result: task2, task4
      const left = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
        createSolution({ task: "http://example.org/task3" }),
        createSolution({ task: "http://example.org/task4" }),
      ];

      const right = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task3" }),
      ];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(2);
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task2");
      expect((results[1].get("task") as IRI).value).toBe("http://example.org/task4");
    });
  });

  describe("Streaming execution via AsyncIterator", () => {
    it("should work correctly with async iteration", async () => {
      const left = [
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
        createSolution({ task: "http://example.org/task3" }),
      ];

      const right = [createSolution({ task: "http://example.org/task2" })];

      async function* leftGen(): AsyncIterableIterator<SolutionMapping> {
        for (const s of left) yield s;
      }

      async function* rightGen(): AsyncIterableIterator<SolutionMapping> {
        for (const s of right) yield s;
      }

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(leftGen(), rightGen())) {
        results.push(solution);
      }

      expect(results).toHaveLength(2);
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task1");
      expect((results[1].get("task") as IRI).value).toBe("http://example.org/task3");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty solution mappings", async () => {
      // Empty solution on left should be preserved if right has variables
      const left = [new SolutionMapping()];
      const right = [createSolution({ task: "http://example.org/task1" })];

      const results = await executor.executeAll(left, right);
      // No shared variables -> not compatible -> preserved
      expect(results).toHaveLength(1);
    });

    it("should handle both sides having empty solutions", async () => {
      const left = [new SolutionMapping()];
      const right = [new SolutionMapping()];

      // No shared variables (both empty) -> not compatible -> preserved
      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(1);
    });

    it("should preserve order of left solutions", async () => {
      const left = [
        createSolution({ task: "http://example.org/task3" }),
        createSolution({ task: "http://example.org/task1" }),
        createSolution({ task: "http://example.org/task2" }),
      ];

      const right: SolutionMapping[] = [];

      const results = await executor.executeAll(left, right);
      expect(results).toHaveLength(3);
      expect((results[0].get("task") as IRI).value).toBe("http://example.org/task3");
      expect((results[1].get("task") as IRI).value).toBe("http://example.org/task1");
      expect((results[2].get("task") as IRI).value).toBe("http://example.org/task2");
    });
  });
});

// Helper functions to create solution mappings
function createSolution(bindings: Record<string, string>): SolutionMapping {
  const s = new SolutionMapping();
  for (const [key, value] of Object.entries(bindings)) {
    s.set(key, new IRI(value));
  }
  return s;
}

function createSolutionMulti(bindings: {
  task: string;
  label?: string;
  status?: string;
}): SolutionMapping {
  const s = new SolutionMapping();
  s.set("task", new IRI(bindings.task));
  if (bindings.label) {
    s.set("label", new Literal(bindings.label));
  }
  if (bindings.status) {
    s.set("status", new Literal(bindings.status));
  }
  return s;
}

function createLiteralSolution(bindings: { status: string }): SolutionMapping {
  const s = new SolutionMapping();
  s.set("status", new Literal(bindings.status));
  return s;
}
