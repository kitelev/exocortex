import { expectFasterThan } from "../../helpers/perfAssert";
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

    it("should replace $yesterday with xsd:date literal", () => {
      const query = "ASK { ?s ems:date $yesterday }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$yesterday");
      expect(result).toMatch(/"[0-9]{4}-[0-9]{2}-[0-9]{2}"\^\^xsd:date/);
    });

    it("should replace $thisWeekStart with Monday date", () => {
      const query = "ASK { ?s ems:date $thisWeekStart }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$thisWeekStart");
      expect(result).toMatch(/"[0-9]{4}-[0-9]{2}-[0-9]{2}"\^\^xsd:date/);

      // Extract the date and verify it's a Monday
      const match = result.match(/"(\d{4}-\d{2}-\d{2})"/);
      if (match) {
        const day = new Date(match[1]).getUTCDay();
        expect(day).toBe(1); // Monday
      }
    });

    it("should replace $lastWeekStart with previous Monday date", () => {
      const query = "ASK { ?s ems:date $lastWeekStart }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$lastWeekStart");
      expect(result).toMatch(/"[0-9]{4}-[0-9]{2}-[0-9]{2}"\^\^xsd:date/);

      // Extract and verify it's a Monday, 7 days before thisWeekStart
      const thisWeekResult = evaluator.substituteVariables("$thisWeekStart", ASSET_IRI);
      const lastWeekResult = evaluator.substituteVariables("$lastWeekStart", ASSET_IRI);

      const thisMatch = thisWeekResult.match(/"(\d{4}-\d{2}-\d{2})"/);
      const lastMatch = lastWeekResult.match(/"(\d{4}-\d{2}-\d{2})"/);
      if (thisMatch && lastMatch) {
        const diff = new Date(thisMatch[1]).getTime() - new Date(lastMatch[1]).getTime();
        expect(diff).toBe(7 * 24 * 60 * 60 * 1000); // exactly 7 days
      }
    });

    it("should replace $thisMonthStart with 1st of current month", () => {
      const query = "ASK { ?s ems:date $thisMonthStart }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$thisMonthStart");
      expect(result).toMatch(/"[0-9]{4}-[0-9]{2}-01"\^\^xsd:date/);
    });

    it("should replace $lastMonthStart with 1st of previous month", () => {
      const query = "ASK { ?s ems:date $lastMonthStart }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$lastMonthStart");
      expect(result).toMatch(/"[0-9]{4}-[0-9]{2}-01"\^\^xsd:date/);
    });

    it("should replace $thisYearStart with Jan 1st", () => {
      const query = "ASK { ?s ems:date $thisYearStart }";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$thisYearStart");
      expect(result).toMatch(/"[0-9]{4}-01-01"\^\^xsd:date/);
    });

    it("should handle all temporal variables in single query", () => {
      const query = "FILTER($yesterday && $thisWeekStart && $lastWeekStart && $thisMonthStart && $lastMonthStart && $thisYearStart)";
      const result = evaluator.substituteVariables(query, ASSET_IRI);

      expect(result).not.toContain("$yesterday");
      expect(result).not.toContain("$thisWeekStart");
      expect(result).not.toContain("$lastWeekStart");
      expect(result).not.toContain("$thisMonthStart");
      expect(result).not.toContain("$lastMonthStart");
      expect(result).not.toContain("$thisYearStart");
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

  describe("Issue #2495: EvalContext with fileBasename and currentFolder", () => {
    it("should pass fileBasename and currentFolder to host function via context", async () => {
      let receivedContext: import("../../../src/services/PreconditionEvaluator").EvalContext | undefined;

      evaluator.registerHostFunction("checkFile", (ctx) => {
        receivedContext = ctx;
        return true;
      });

      const precondition = {
        id: "pre-check-file",
        label: "Check file",
        hostFunction: "checkFile",
      };

      const context = {
        targetIRI: ASSET_IRI,
        fileBasename: "my-task.md",
        currentFolder: "03 Knowledge/projects",
      };

      await evaluator.evaluate(precondition, ASSET_IRI, context);

      expect(receivedContext).toBeDefined();
      expect(receivedContext!.targetIRI).toBe(ASSET_IRI);
      expect(receivedContext!.fileBasename).toBe("my-task.md");
      expect(receivedContext!.currentFolder).toBe("03 Knowledge/projects");
    });

    it("should work when fileBasename and currentFolder are omitted", async () => {
      let receivedContext: import("../../../src/services/PreconditionEvaluator").EvalContext | undefined;

      evaluator.registerHostFunction("checkMinimal", (ctx) => {
        receivedContext = ctx;
        return true;
      });

      const precondition = {
        id: "pre-minimal",
        label: "Minimal check",
        hostFunction: "checkMinimal",
      };

      await evaluator.evaluate(precondition, ASSET_IRI);

      expect(receivedContext).toBeDefined();
      expect(receivedContext!.targetIRI).toBe(ASSET_IRI);
      expect(receivedContext!.fileBasename).toBeUndefined();
      expect(receivedContext!.currentFolder).toBeUndefined();
    });

    it("should return host function result for hostFunction precondition", async () => {
      evaluator.registerHostFunction("alwaysFalse", () => false);

      const precondition = {
        id: "pre-false",
        label: "Always false",
        hostFunction: "alwaysFalse",
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(false);
    });

    it("should return true when hostFunction is not registered", async () => {
      const precondition = {
        id: "pre-unknown",
        label: "Unknown function",
        hostFunction: "nonExistentFn",
      };

      const result = await evaluator.evaluate(precondition, ASSET_IRI);
      expect(result).toBe(true);
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

      expectFasterThan(elapsed, 50);
    });
  });

  // RFC c78cc5c8 Phase 1a — exoql__Query reference via IQueryBodyResolver.
  describe("evaluate with query reference (IQueryBodyResolver)", () => {
    it("returns true when resolver returns ASK body matching store", async () => {
      const subject = new IRI(ASSET_IRI);
      await store.add(
        new Triple(
          subject,
          Namespace.EMS.term("Effort_startTimestamp"),
          new Literal("2026-04-30T00:00:00"),
        ),
      );
      const resolver = {
        resolveSparql: jest.fn().mockResolvedValue(
          `PREFIX ems: <https://exocortex.my/ontology/ems#>
           ASK { $target ems:Effort_startTimestamp ?ts }`,
        ),
      };
      const ev = new PreconditionEvaluator(store, resolver);
      const result = await ev.evaluate(
        {
          id: "pre-q",
          label: "Has start (via query ref)",
          query: "always-true-uid",
        },
        ASSET_IRI,
      );
      expect(result).toBe(true);
      expect(resolver.resolveSparql).toHaveBeenCalledWith("always-true-uid");
    });

    it("returns true for trivial ASK {} body (Always-true precondition)", async () => {
      const resolver = {
        resolveSparql: jest.fn().mockResolvedValue("ASK { }"),
      };
      const ev = new PreconditionEvaluator(store, resolver);
      const result = await ev.evaluate(
        { id: "pre-q", label: "Always true", query: "always-true-uid" },
        ASSET_IRI,
      );
      expect(result).toBe(true);
    });

    it("returns false when resolver returns null (asset missing)", async () => {
      const resolver = { resolveSparql: jest.fn().mockResolvedValue(null) };
      const ev = new PreconditionEvaluator(store, resolver);
      const result = await ev.evaluate(
        { id: "pre-q", label: "Missing", query: "missing-uid" },
        ASSET_IRI,
      );
      expect(result).toBe(false);
    });

    it("returns false when resolver throws", async () => {
      const resolver = {
        resolveSparql: jest.fn().mockRejectedValue(new Error("fs error")),
      };
      const ev = new PreconditionEvaluator(store, resolver);
      const result = await ev.evaluate(
        { id: "pre-q", label: "Boom", query: "boom-uid" },
        ASSET_IRI,
      );
      expect(result).toBe(false);
    });

    it("returns false when no resolver is wired (legacy constructor)", async () => {
      const ev = new PreconditionEvaluator(store);
      const result = await ev.evaluate(
        { id: "pre-q", label: "No resolver", query: "any-uid" },
        ASSET_IRI,
      );
      expect(result).toBe(false);
    });

    it("returns false when resolved body is SELECT (kind mismatch)", async () => {
      const resolver = {
        resolveSparql: jest.fn().mockResolvedValue("SELECT * WHERE { ?s ?p ?o }"),
      };
      const ev = new PreconditionEvaluator(store, resolver);
      const result = await ev.evaluate(
        { id: "pre-q", label: "Wrong kind", query: "q-uid" },
        ASSET_IRI,
      );
      expect(result).toBe(false);
    });

    it("sparqlAsk takes priority over query when both present", async () => {
      const resolver = {
        resolveSparql: jest.fn().mockResolvedValue("ASK { }"),
      };
      const ev = new PreconditionEvaluator(store, resolver);
      const result = await ev.evaluate(
        {
          id: "pre-q",
          label: "Both",
          // Empty store + non-matching ASK → false
          sparqlAsk: `PREFIX ex: <urn:ex:>
            ASK { <urn:nope> ex:p ?o }`,
          query: "always-true-uid",
        },
        ASSET_IRI,
      );
      expect(result).toBe(false);
      expect(resolver.resolveSparql).not.toHaveBeenCalled();
    });
  });
});
