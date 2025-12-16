import { ConstructExecutor } from "../../../../../src/infrastructure/sparql/executors/ConstructExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";
import { QuotedTriple } from "../../../../../src/domain/models/rdf/QuotedTriple";
import type {
  Triple as AlgebraTriple,
  QuotedTriple as AlgebraQuotedTriple,
} from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

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

  describe("RDF-Star CONSTRUCT with Quoted Triples", () => {
    it("should construct triples with quoted triple in subject position", async () => {
      // CONSTRUCT { <<( ?person :hasName ?name )>> :source :Database . }
      const quotedTripleSubject: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "person" },
        predicate: { type: "iri", value: "http://example.org/hasName" },
        object: { type: "variable", value: "name" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTripleSubject,
          predicate: { type: "iri", value: "http://example.org/source" },
          object: { type: "iri", value: "http://example.org/Database" },
        },
      ];

      const solution = new SolutionMapping();
      solution.set("person", new IRI("http://example.org/Alice"));
      solution.set("name", new Literal("Alice Smith"));

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(1);
      // Subject should be a QuotedTriple
      expect(triples[0].subject).toBeInstanceOf(QuotedTriple);
      const qt = triples[0].subject as QuotedTriple;
      expect(qt.subject).toBeInstanceOf(IRI);
      expect((qt.subject as IRI).value).toBe("http://example.org/Alice");
      expect(qt.predicate.value).toBe("http://example.org/hasName");
      expect(qt.object).toBeInstanceOf(Literal);
      expect((qt.object as Literal).value).toBe("Alice Smith");
      // Predicate and object of outer triple
      expect(triples[0].predicate.value).toBe("http://example.org/source");
      expect((triples[0].object as IRI).value).toBe("http://example.org/Database");
    });

    it("should construct triples with quoted triple in object position", async () => {
      // CONSTRUCT { :Observation :claims <<( ?s ?p ?o )>> . }
      const quotedTripleObject: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "s" },
        predicate: { type: "variable", value: "p" },
        object: { type: "variable", value: "o" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: { type: "iri", value: "http://example.org/Observation" },
          predicate: { type: "iri", value: "http://example.org/claims" },
          object: quotedTripleObject,
        },
      ];

      const solution = new SolutionMapping();
      solution.set("s", new IRI("http://example.org/Bob"));
      solution.set("p", new IRI("http://example.org/likes"));
      solution.set("o", new IRI("http://example.org/Pizza"));

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(1);
      expect((triples[0].subject as IRI).value).toBe("http://example.org/Observation");
      // Object should be a QuotedTriple
      expect(triples[0].object).toBeInstanceOf(QuotedTriple);
      const qt = triples[0].object as QuotedTriple;
      expect((qt.subject as IRI).value).toBe("http://example.org/Bob");
      expect(qt.predicate.value).toBe("http://example.org/likes");
      expect((qt.object as IRI).value).toBe("http://example.org/Pizza");
    });

    it("should construct triples with nested quoted triples", async () => {
      // CONSTRUCT { <<( <<( ?inner_s ?inner_p ?inner_o )>> :assertedBy ?source )>> :timestamp ?time . }
      const innerQuotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "inner_s" },
        predicate: { type: "iri", value: "http://example.org/knows" },
        object: { type: "variable", value: "inner_o" },
      };

      const outerQuotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: innerQuotedTriple,
        predicate: { type: "iri", value: "http://example.org/assertedBy" },
        object: { type: "variable", value: "source" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: outerQuotedTriple,
          predicate: { type: "iri", value: "http://example.org/timestamp" },
          object: { type: "variable", value: "time" },
        },
      ];

      const solution = new SolutionMapping();
      solution.set("inner_s", new IRI("http://example.org/Alice"));
      solution.set("inner_o", new IRI("http://example.org/Bob"));
      solution.set("source", new IRI("http://example.org/Wikipedia"));
      solution.set("time", new Literal("2025-01-01T00:00:00Z", new IRI("http://www.w3.org/2001/XMLSchema#dateTime")));

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(1);
      // Subject is a QuotedTriple
      expect(triples[0].subject).toBeInstanceOf(QuotedTriple);
      const outer = triples[0].subject as QuotedTriple;
      // Outer subject is also a QuotedTriple (nested)
      expect(outer.subject).toBeInstanceOf(QuotedTriple);
      const inner = outer.subject as QuotedTriple;
      expect((inner.subject as IRI).value).toBe("http://example.org/Alice");
      expect(inner.predicate.value).toBe("http://example.org/knows");
      expect((inner.object as IRI).value).toBe("http://example.org/Bob");
      // Outer predicate and object
      expect(outer.predicate.value).toBe("http://example.org/assertedBy");
      expect((outer.object as IRI).value).toBe("http://example.org/Wikipedia");
    });

    it("should construct multiple triples with quoted triples for provenance", async () => {
      // CONSTRUCT {
      //   <<( ?person :hasName ?name )>> :source :Database .
      //   <<( ?person :hasName ?name )>> :confidence "0.95"^^xsd:decimal .
      // }
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "person" },
        predicate: { type: "iri", value: "http://example.org/hasName" },
        object: { type: "variable", value: "name" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/source" },
          object: { type: "iri", value: "http://example.org/Database" },
        },
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/confidence" },
          object: {
            type: "literal",
            value: "0.95",
            datatype: "http://www.w3.org/2001/XMLSchema#decimal",
          },
        },
      ];

      const solution = new SolutionMapping();
      solution.set("person", new IRI("http://example.org/Alice"));
      solution.set("name", new Literal("Alice Smith"));

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(2);
      // Both triples should have the same quoted triple as subject
      expect(triples[0].subject).toBeInstanceOf(QuotedTriple);
      expect(triples[1].subject).toBeInstanceOf(QuotedTriple);
      // Verify predicates
      expect(triples[0].predicate.value).toBe("http://example.org/source");
      expect(triples[1].predicate.value).toBe("http://example.org/confidence");
    });

    it("should construct triples from multiple solutions with quoted triples", async () => {
      // CONSTRUCT { <<( ?person :hasName ?name )>> :source :Database . }
      // with two solutions
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "person" },
        predicate: { type: "iri", value: "http://example.org/hasName" },
        object: { type: "variable", value: "name" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/source" },
          object: { type: "iri", value: "http://example.org/Database" },
        },
      ];

      const solution1 = new SolutionMapping();
      solution1.set("person", new IRI("http://example.org/Alice"));
      solution1.set("name", new Literal("Alice Smith"));

      const solution2 = new SolutionMapping();
      solution2.set("person", new IRI("http://example.org/Bob"));
      solution2.set("name", new Literal("Bob Jones"));

      const triples = await executor.execute(template, [solution1, solution2]);

      expect(triples).toHaveLength(2);
      // First triple from Alice
      const qt1 = triples[0].subject as QuotedTriple;
      expect((qt1.subject as IRI).value).toBe("http://example.org/Alice");
      expect((qt1.object as Literal).value).toBe("Alice Smith");
      // Second triple from Bob
      const qt2 = triples[1].subject as QuotedTriple;
      expect((qt2.subject as IRI).value).toBe("http://example.org/Bob");
      expect((qt2.object as Literal).value).toBe("Bob Jones");
    });

    it("should eliminate duplicate quoted triples", async () => {
      // Two identical solutions should produce only one triple
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "person" },
        predicate: { type: "iri", value: "http://example.org/hasName" },
        object: { type: "variable", value: "name" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/source" },
          object: { type: "iri", value: "http://example.org/Database" },
        },
      ];

      const solution1 = new SolutionMapping();
      solution1.set("person", new IRI("http://example.org/Alice"));
      solution1.set("name", new Literal("Alice Smith"));

      const solution2 = new SolutionMapping();
      solution2.set("person", new IRI("http://example.org/Alice"));
      solution2.set("name", new Literal("Alice Smith"));

      const triples = await executor.execute(template, [solution1, solution2]);

      expect(triples).toHaveLength(1);
    });

    it("should skip quoted triples with unbound variables", async () => {
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "person" },
        predicate: { type: "iri", value: "http://example.org/hasName" },
        object: { type: "variable", value: "name" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/source" },
          object: { type: "iri", value: "http://example.org/Database" },
        },
      ];

      // Only person is bound, name is missing
      const solution = new SolutionMapping();
      solution.set("person", new IRI("http://example.org/Alice"));

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(0);
    });

    it("should handle quoted triples with blank nodes", async () => {
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "blank", value: "b1" },
        predicate: { type: "iri", value: "http://example.org/hasValue" },
        object: { type: "variable", value: "value" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/certainty" },
          object: { type: "literal", value: "high" },
        },
      ];

      const solution = new SolutionMapping();
      solution.set("value", new Literal("42"));

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(1);
      const qt = triples[0].subject as QuotedTriple;
      expect(qt.subject).toBeInstanceOf(BlankNode);
      expect((qt.subject as BlankNode).id).toBe("b1");
    });

    it("should handle concrete quoted triples without variables", async () => {
      // CONSTRUCT { <<( :Alice :knows :Bob )>> :source :Wikipedia . }
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "iri", value: "http://example.org/Alice" },
        predicate: { type: "iri", value: "http://example.org/knows" },
        object: { type: "iri", value: "http://example.org/Bob" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/source" },
          object: { type: "iri", value: "http://example.org/Wikipedia" },
        },
      ];

      const solution = new SolutionMapping(); // Empty solution - no variables needed

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(1);
      const qt = triples[0].subject as QuotedTriple;
      expect((qt.subject as IRI).value).toBe("http://example.org/Alice");
      expect(qt.predicate.value).toBe("http://example.org/knows");
      expect((qt.object as IRI).value).toBe("http://example.org/Bob");
    });

    it("should handle quoted triple predicate as variable", async () => {
      // CONSTRUCT { <<( ?s ?p ?o )>> :derived true . }
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "s" },
        predicate: { type: "variable", value: "p" },
        object: { type: "variable", value: "o" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/derived" },
          object: { type: "literal", value: "true", datatype: "http://www.w3.org/2001/XMLSchema#boolean" },
        },
      ];

      const solution = new SolutionMapping();
      solution.set("s", new IRI("http://example.org/Alice"));
      solution.set("p", new IRI("http://example.org/friend"));
      solution.set("o", new IRI("http://example.org/Bob"));

      const triples = await executor.execute(template, [solution]);

      expect(triples).toHaveLength(1);
      const qt = triples[0].subject as QuotedTriple;
      expect(qt.predicate.value).toBe("http://example.org/friend");
    });

    it("should reject non-IRI bound to quoted triple predicate variable", async () => {
      // Variable in predicate position bound to non-IRI should skip
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "s" },
        predicate: { type: "variable", value: "p" },
        object: { type: "variable", value: "o" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/derived" },
          object: { type: "literal", value: "true" },
        },
      ];

      const solution = new SolutionMapping();
      solution.set("s", new IRI("http://example.org/Alice"));
      solution.set("p", new Literal("not-an-iri")); // Invalid: predicate must be IRI
      solution.set("o", new IRI("http://example.org/Bob"));

      const triples = await executor.execute(template, [solution]);

      // Should skip this pattern due to invalid predicate
      expect(triples).toHaveLength(0);
    });

    it("should reject literal bound to quoted triple subject variable", async () => {
      // Variable in subject position bound to Literal should skip
      const quotedTriple: AlgebraQuotedTriple = {
        type: "quoted",
        subject: { type: "variable", value: "s" },
        predicate: { type: "iri", value: "http://example.org/prop" },
        object: { type: "variable", value: "o" },
      };

      const template: AlgebraTriple[] = [
        {
          subject: quotedTriple,
          predicate: { type: "iri", value: "http://example.org/meta" },
          object: { type: "literal", value: "value" },
        },
      ];

      const solution = new SolutionMapping();
      solution.set("s", new Literal("invalid-subject")); // Invalid: subject cannot be Literal
      solution.set("o", new IRI("http://example.org/object"));

      const triples = await executor.execute(template, [solution]);

      // Should skip this pattern due to invalid subject
      expect(triples).toHaveLength(0);
    });
  });
});
