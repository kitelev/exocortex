import { UnionExecutor } from "../../../../../src/infrastructure/sparql/executors/UnionExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("UnionExecutor", () => {
  let executor: UnionExecutor;

  beforeEach(() => {
    executor = new UnionExecutor();
  });

  it("should combine left and right solutions", async () => {
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
        s.set("x", new Literal("b"));
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(2);
  });

  it("should eliminate duplicates", async () => {
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
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(1);
  });

  it("should handle empty left", async () => {
    const left: SolutionMapping[] = [];
    const right = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("a"));
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(1);
  });

  it("should handle empty right", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("a"));
        return s;
      })(),
    ];
    const right: SolutionMapping[] = [];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(1);
  });

  it("should handle multiple variables", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("a"));
        s.set("y", new Literal("1"));
        return s;
      })(),
    ];

    const right = [
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

  it("should maintain order (left first, then right)", async () => {
    const left = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("from-left"));
        return s;
      })(),
    ];

    const right = [
      (() => {
        const s = new SolutionMapping();
        s.set("x", new Literal("from-right"));
        return s;
      })(),
    ];

    const results = await executor.executeAll(left, right);
    expect(results).toHaveLength(2);
    expect((results[0].get("x") as Literal).value).toBe("from-left");
    expect((results[1].get("x") as Literal).value).toBe("from-right");
  });
});
