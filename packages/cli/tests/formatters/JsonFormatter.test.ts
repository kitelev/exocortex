import { describe, it, expect, beforeEach } from "@jest/globals";
import { JsonFormatter } from "../../src/formatters/JsonFormatter";
import { SolutionMapping } from "exocortex";
import { IRI } from "exocortex";
import { Literal } from "exocortex";

describe("JsonFormatter", () => {
  let formatter: JsonFormatter;

  beforeEach(() => {
    formatter = new JsonFormatter();
  });

  it("should format empty results as empty array", () => {
    const results: SolutionMapping[] = [];
    const output = formatter.format(results);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });

  it("should format single solution", () => {
    const solution = new SolutionMapping();
    solution.set("x", new IRI("http://example.org/resource1"));
    solution.set("y", new Literal("value1"));

    const output = formatter.format([solution]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].x).toBeDefined();
    expect(parsed[0].y).toBeDefined();
  });

  it("should format multiple solutions", () => {
    const solution1 = new SolutionMapping();
    solution1.set("task", new IRI("obsidian://vault/Task1.md"));

    const solution2 = new SolutionMapping();
    solution2.set("task", new IRI("obsidian://vault/Task2.md"));

    const output = formatter.format([solution1, solution2]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].task).toBeDefined();
    expect(parsed[1].task).toBeDefined();
  });

  it("should produce valid JSON", () => {
    const solution = new SolutionMapping();
    solution.set("x", new Literal("test"));

    const output = formatter.format([solution]);
    expect(() => JSON.parse(output)).not.toThrow();
  });
});
