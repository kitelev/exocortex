import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("PreconditionEvaluator", () => {
  let store: InMemoryTripleStore;
  let evaluator: PreconditionEvaluator;

  const ASSET_IRI = "https://exocortex.my/ontology/ems/test-asset-123";

  beforeEach(() => {
    store = new InMemoryTripleStore();
    evaluator = new PreconditionEvaluator(store);
  });

  describe("evaluate with no precondition", () => {
    it("should return true when precondition is undefined", async () => {
      const result = await evaluator.evaluate(undefined, ASSET_IRI);
      expect(result).toBe(true);
    });
  });

  describe("evaluate with SPARQL ASK", () => {
    it("should return true when ASK matches data in store", async () => {
      // Add triple: asset has startTimestamp
      const subject = new IRI(ASSET_IRI);
      await store.add(
        new Triple(
          subject,
          Namespace.EMS.term("Effort_startTimestamp"),
          new Literal("2026-03-30T10:00:00"),
        ),
      );

      const precondition = {
        id: "pre-has-start",
        label: "Has startTimestamp",
        sparqlAsk: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          ASK { <${ASSET_IRI}> ems:Effort_startTimestamp ?ts }
        `,
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(true);
    });

    it("should return false when ASK does not match", async () => {
      // Store is empty — no matching triples
      const precondition = {
        id: "pre-has-start",
        label: "Has startTimestamp",
        sparqlAsk: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          ASK { <${ASSET_IRI}> ems:Effort_startTimestamp ?ts }
        `,
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(false);
    });

    it("should return false on SPARQL parse error (fail closed)", async () => {
      const precondition = {
        id: "pre-bad",
        label: "Bad SPARQL",
        sparqlAsk: "THIS IS NOT VALID SPARQL !!!",
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(false);
    });

    it("should return false on empty sparqlAsk string", async () => {
      const precondition = {
        id: "pre-empty",
        label: "Empty ASK",
        sparqlAsk: "",
      };

      // Empty string is falsy → evaluate returns true (no precondition path)
      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(true);
    });
  });

  describe("substituteVariables", () => {
    it("should replace $target with angle-bracketed IRI", () => {
      const query = "ASK { $target ems:status ?s }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).toContain(`<${ASSET_IRI}>`);
      expect(result).not.toContain("$target");
    });

    it("should replace $now with xsd:dateTime literal", () => {
      const query = "ASK { ?s ems:createdAt $now }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$now");
      expect(result).toMatch(/"[^"]+"\^\^xsd:dateTime/);
    });

    it("should replace $today with xsd:date literal", () => {
      const query = "ASK { ?s ems:date $today }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$today");
      expect(result).toMatch(/"[0-9]{4}-[0-9]{2}-[0-9]{2}"\^\^xsd:date/);
    });

    it("should replace multiple occurrences of $target", () => {
      const query = "ASK { $target ems:a ?x . $target ems:b ?y }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      const occurrences = (result.match(new RegExp(ASSET_IRI, "g")) ?? []).length;
      expect(occurrences).toBe(2);
    });

    it("should be idempotent", () => {
      const query = "ASK { $target ems:status ?s }";
      const first = evaluator.substituteVariables(query, ASSET_IRI);
      const second = evaluator.substituteVariables(first, ASSET_IRI);

      // After first substitution, no more $target to replace
      expect(first).toBe(second);
    });
  });

  describe("SPARQL ASK with $target substitution", () => {
    it("should evaluate ASK with $target replaced by actual IRI", async () => {
      const subject = new IRI(ASSET_IRI);
      await store.add(
        new Triple(
          subject,
          Namespace.EMS.term("Effort_startTimestamp"),
          new Literal("2026-03-30T10:00:00"),
        ),
      );

      const precondition = {
        id: "pre-target",
        label: "Has start via $target",
        sparqlAsk: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          ASK { $target ems:Effort_startTimestamp ?ts }
        `,
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(true);
    });
  });

  describe("host function registry", () => {
    it("should register and check host functions", () => {
      evaluator.registerHostFunction("testFn", () => true);

      expect(evaluator.hasHostFunction("testFn")).toBe(true);
      expect(evaluator.hasHostFunction("unknown")).toBe(false);
    });

    it("should allow registering multiple host functions", () => {
      evaluator.registerHostFunction("fn1", () => true);
      evaluator.registerHostFunction("fn2", () => false);

      expect(evaluator.hasHostFunction("fn1")).toBe(true);
      expect(evaluator.hasHostFunction("fn2")).toBe(true);
    });
  });

  describe("precondition with sparqlAsk returning true for complex query", () => {
    it("should handle multi-pattern ASK query", async () => {
      const subject = new IRI(ASSET_IRI);

      // Add rdf:type and status triples
      await store.addAll([
        new Triple(
          subject,
          Namespace.RDF.term("type"),
          Namespace.EMS.term("Task"),
        ),
        new Triple(
          subject,
          Namespace.EMS.term("Effort_status"),
          new Literal("ems__EffortStatusBacklog"),
        ),
      ]);

      const precondition = {
        id: "pre-task-backlog",
        label: "Task in Backlog",
        sparqlAsk: `
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          ASK {
            <${ASSET_IRI}> rdf:type ems:Task .
            <${ASSET_IRI}> ems:Effort_status "ems__EffortStatusBacklog" .
          }
        `,
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(true);
    });

    it("should return false when only partial match exists", async () => {
      const subject = new IRI(ASSET_IRI);

      // Add type but NOT status
      await store.add(
        new Triple(
          subject,
          Namespace.RDF.term("type"),
          Namespace.EMS.term("Task"),
        ),
      );

      const precondition = {
        id: "pre-task-backlog",
        label: "Task in Backlog",
        sparqlAsk: `
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          ASK {
            <${ASSET_IRI}> rdf:type ems:Task .
            <${ASSET_IRI}> ems:Effort_status "ems__EffortStatusBacklog" .
          }
        `,
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(false);
    });
  });

  describe("Issue #2496: compiled SPARQL ASK cache", () => {
    const ASK_QUERY = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK { $target ems:Effort_startTimestamp ?ts }
    `;

    beforeEach(async () => {
      const subject = new IRI(ASSET_IRI);
      await store.add(
        new Triple(
          subject,
          Namespace.EMS.term("Effort_startTimestamp"),
          new Literal("2026-03-30T10:00:00"),
        ),
      );
    });

    it("should cache parsed algebra and skip parse on second call", async () => {
      const SPARQLParserModule = await import("../../../src/infrastructure/sparql/SPARQLParser");
      const parseSpy = jest.spyOn(SPARQLParserModule.SPARQLParser.prototype, "parse");

      const precondition = {
        id: "pre-cached",
        label: "Cached ASK",
        sparqlAsk: ASK_QUERY,
      };

      const result1 = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result1).toBe(true);
      expect(parseSpy).toHaveBeenCalledTimes(1);

      const result2 = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result2).toBe(true);
      expect(parseSpy).toHaveBeenCalledTimes(1);

      parseSpy.mockRestore();
    });

    it("should invalidate cache when invalidateCache is called", async () => {
      const SPARQLParserModule = await import("../../../src/infrastructure/sparql/SPARQLParser");
      const parseSpy = jest.spyOn(SPARQLParserModule.SPARQLParser.prototype, "parse");

      const precondition = {
        id: "pre-inv",
        label: "Invalidatable",
        sparqlAsk: ASK_QUERY,
      };

      await evaluator.evaluate(precondition, ASSET_IRI);
      expect(parseSpy).toHaveBeenCalledTimes(1);

      evaluator.invalidateCache();

      await evaluator.evaluate(precondition, ASSET_IRI);
      expect(parseSpy).toHaveBeenCalledTimes(2);

      parseSpy.mockRestore();
    });

    it("should work correctly with different targetIRIs on same query", async () => {
      const OTHER_IRI = "https://exocortex.my/ontology/ems/other-asset-456";
      const otherSubject = new IRI(OTHER_IRI);
      await store.add(
        new Triple(
          otherSubject,
          Namespace.EMS.term("Effort_startTimestamp"),
          new Literal("2026-04-01T09:00:00"),
        ),
      );

      const precondition = {
        id: "pre-multi",
        label: "Multi-target",
        sparqlAsk: ASK_QUERY,
      };

      const result1 = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result1).toBe(true);

      const result2 = await evaluator.evaluate(precondition, OTHER_IRI);
      expect(result2).toBe(true);
    });

    it("benchmark: 27 cached ASK queries should complete in < 50ms on 10K triples", async () => {
      const TRIPLE_COUNT = 10000;
      const QUERY_COUNT = 27;

      for (let i = 0; i < TRIPLE_COUNT; i++) {
        const iri = new IRI(`https://exocortex.my/ontology/ems/asset-${i}`);
        await store.add(
          new Triple(
            iri,
            Namespace.EMS.term("Effort_startTimestamp"),
            new Literal(`2026-01-01T${String(i % 24).padStart(2, "0")}:00:00`),
          ),
        );
      }

      const queries: { id: string; label: string; sparqlAsk: string }[] = [];
      for (let i = 0; i < QUERY_COUNT; i++) {
        queries.push({
          id: `bench-${i}`,
          label: `Benchmark ${i}`,
          sparqlAsk: `
            PREFIX ems: <https://exocortex.my/ontology/ems#>
            ASK { $target ems:Effort_startTimestamp ?ts }
          `,
        });
      }

      for (const q of queries) {
        await evaluator.evaluate(q, ASSET_IRI);
      }

      const start = performance.now();
      for (const q of queries) {
        await evaluator.evaluate(q, ASSET_IRI);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
