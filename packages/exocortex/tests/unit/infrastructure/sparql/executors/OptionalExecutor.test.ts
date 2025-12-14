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
});
