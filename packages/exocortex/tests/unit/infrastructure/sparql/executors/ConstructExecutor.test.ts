import { ConstructExecutor } from "../../../../../src/infrastructure/sparql/executors/ConstructExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import type { Triple as AlgebraTriple } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("ConstructExecutor", () => {
  let executor: ConstructExecutor;

  beforeEach(() => {
    executor = new ConstructExecutor();
  });

  it("should construct triples from template with variables", async () => {
    const template: AlgebraTriple[] = [
      {
        subject: { type: "variable", value: "task" },
        predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
        object: { type: "iri", value: "http://example.org/CompletedTask" },
      },
    ];

    const solution = new SolutionMapping();
    solution.set("task", new IRI("http://example.org/task1"));

    const triples = await executor.execute(template, [solution]);
    expect(triples).toHaveLength(1);
    expect(triples[0].subject.toString()).toContain("task1");
  });

  it("should construct multiple triples from template", async () => {
    const template: AlgebraTriple[] = [
      {
        subject: { type: "variable", value: "task" },
        predicate: { type: "iri", value: "http://example.org/label" },
        object: { type: "variable", value: "label" },
      },
      {
        subject: { type: "variable", value: "task" },
        predicate: { type: "iri", value: "http://example.org/status" },
        object: { type: "literal", value: "completed" },
      },
    ];

    const solution = new SolutionMapping();
    solution.set("task", new IRI("http://example.org/task1"));
    solution.set("label", new Literal("Task 1"));

    const triples = await executor.execute(template, [solution]);
    expect(triples).toHaveLength(2);
  });

  it("should eliminate duplicate triples", async () => {
    const template: AlgebraTriple[] = [
      {
        subject: { type: "variable", value: "x" },
        predicate: { type: "iri", value: "http://example.org/prop" },
        object: { type: "literal", value: "value" },
      },
    ];

    const solution1 = new SolutionMapping();
    solution1.set("x", new IRI("http://example.org/r1"));

    const solution2 = new SolutionMapping();
    solution2.set("x", new IRI("http://example.org/r1"));

    const triples = await executor.execute(template, [solution1, solution2]);
    expect(triples).toHaveLength(1);
  });

  it("should skip patterns with unbound variables", async () => {
    const template: AlgebraTriple[] = [
      {
        subject: { type: "variable", value: "task" },
        predicate: { type: "iri", value: "http://example.org/priority" },
        object: { type: "variable", value: "priority" },
      },
    ];

    const solution = new SolutionMapping();
    solution.set("task", new IRI("http://example.org/task1"));

    const triples = await executor.execute(template, [solution]);
    expect(triples).toHaveLength(0);
  });
});
