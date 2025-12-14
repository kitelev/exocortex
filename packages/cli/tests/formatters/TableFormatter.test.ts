import { describe, it, expect, beforeEach } from "@jest/globals";
import { TableFormatter } from "../../src/formatters/TableFormatter";
import { SolutionMapping } from "exocortex";
import { IRI } from "exocortex";
import { Literal } from "exocortex";

describe("TableFormatter", () => {
  let formatter: TableFormatter;

  beforeEach(() => {
    formatter = new TableFormatter();
  });

  it("should format empty results", () => {
    const results: SolutionMapping[] = [];
    const output = formatter.format(results);
    expect(output).toBe("No results");
  });

  it("should format single solution with one variable", () => {
    const solution = new SolutionMapping();
    solution.set("x", new IRI("http://example.org/resource1"));

    const output = formatter.format([solution]);
    expect(output).toContain("?x");
    expect(output).toContain("http://example.org/resource1");
  });

  it("should format multiple solutions", () => {
    const solution1 = new SolutionMapping();
    solution1.set("task", new IRI("obsidian://vault/Task1.md"));
    solution1.set("label", new Literal("Task 1"));

    const solution2 = new SolutionMapping();
    solution2.set("task", new IRI("obsidian://vault/Task2.md"));
    solution2.set("label", new Literal("Task 2"));

    const output = formatter.format([solution1, solution2]);
    expect(output).toContain("?task");
    expect(output).toContain("?label");
    expect(output).toContain("Task1.md");
    expect(output).toContain("Task2.md");
  });

  it("should handle missing bindings", () => {
    const solution1 = new SolutionMapping();
    solution1.set("x", new IRI("http://example.org/r1"));
    solution1.set("y", new Literal("value1"));

    const solution2 = new SolutionMapping();
    solution2.set("x", new IRI("http://example.org/r2"));

    const output = formatter.format([solution1, solution2]);
    expect(output).toContain("?x");
    expect(output).toContain("?y");
  });

  it("should truncate long values", () => {
    const solution = new SolutionMapping();
    const longValue = "a".repeat(100);
    solution.set("x", new Literal(longValue));

    const output = formatter.format([solution]);
    expect(output).toContain("...");
    expect(output).not.toContain(longValue);
  });
});
