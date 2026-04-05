/**
 * Unit tests for RFC-013 temporal built-in functions.
 *
 * Issue #2597: 6 temporal built-in functions — DAYS_BETWEEN, MINUTES_BETWEEN, etc.
 *
 * Custom functions use IRI syntax: exo:days_between(?a, ?b)
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("RFC-013 Temporal Functions", () => {
  let store: InMemoryTripleStore;
  let parser: SPARQLParser;
  let translator: ExoQLAlgebraTranslator;

  const task = new IRI("urn:exo:task-1");

  const PREFIXES = `
    PREFIX ems: <https://exocortex.my/ontology/ems#>
    PREFIX exo: <https://exocortex.my/ontology/exo#>
  `;

  async function queryValue(sparql: string, variable: string): Promise<string | undefined> {
    const ast = parser.parse(sparql);
    const algebra = translator.translate(ast);
    const executor = new ExoQLQueryExecutor(store);
    const solutions = await executor.executeAll(algebra);
    if (solutions.length === 0) return undefined;
    const val = solutions[0].get(variable);
    if (val instanceof Literal) return val.value;
    if (typeof val === "number") return String(val);
    if (typeof val === "string") return val;
    return undefined;
  }

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    parser = new SPARQLParser();
    translator = new ExoQLAlgebraTranslator();

    await store.addAll([
      new Triple(task, Namespace.EMS.term("Effort_startTimestamp"), new Literal("2026-01-15T10:00:00Z")),
      new Triple(task, Namespace.EMS.term("Effort_endTimestamp"), new Literal("2026-01-15T12:30:00Z")),
      new Triple(task, Namespace.EXO.term("Asset_createdAt"), new Literal("2026-01-01T00:00:00Z")),
      new Triple(task, Namespace.EMS.term("Effort_plannedEndTimestamp"), new Literal("2026-01-25T10:00:00Z")),
    ]);
  });

  describe("exo:days_between(a, b)", () => {
    it("should return days between two dateTimes (same day = 0)", async () => {
      const result = await queryValue(`${PREFIXES}
        SELECT (exo:days_between(?start, ?end) AS ?days) WHERE {
          <urn:exo:task-1> ems:Effort_startTimestamp ?start .
          <urn:exo:task-1> ems:Effort_endTimestamp ?end .
        }
      `, "days");

      expect(result).toBe("0");
    });

    it("should return 10 for 10-day gap", async () => {
      const result = await queryValue(`${PREFIXES}
        SELECT (exo:days_between(?start, ?end) AS ?days) WHERE {
          <urn:exo:task-1> ems:Effort_startTimestamp ?start .
          <urn:exo:task-1> ems:Effort_plannedEndTimestamp ?end .
        }
      `, "days");

      expect(result).toBe("10");
    });
  });

  describe("exo:minutes_between(a, b)", () => {
    it("should return 150 for 2h30m gap", async () => {
      const result = await queryValue(`${PREFIXES}
        SELECT (exo:minutes_between(?start, ?end) AS ?mins) WHERE {
          <urn:exo:task-1> ems:Effort_startTimestamp ?start .
          <urn:exo:task-1> ems:Effort_endTimestamp ?end .
        }
      `, "mins");

      expect(result).toBe("150");
    });
  });

  describe("exo:hours_between(a, b)", () => {
    it("should return 2.5 for 2h30m gap", async () => {
      const result = await queryValue(`${PREFIXES}
        SELECT (exo:hours_between(?start, ?end) AS ?hours) WHERE {
          <urn:exo:task-1> ems:Effort_startTimestamp ?start .
          <urn:exo:task-1> ems:Effort_endTimestamp ?end .
        }
      `, "hours");

      expect(Number(result)).toBe(2.5);
    });
  });

  describe("exo:age_days(dateTime)", () => {
    it("should return positive age in days", async () => {
      const result = await queryValue(`${PREFIXES}
        SELECT (exo:age_days(?created) AS ?age) WHERE {
          <urn:exo:task-1> exo:Asset_createdAt ?created .
        }
      `, "age");

      expect(Number(result)).toBeGreaterThan(0);
    });
  });

  describe("exo:week_number(dateTime)", () => {
    it("should return ISO week 3 for 2026-01-15", async () => {
      const result = await queryValue(`${PREFIXES}
        SELECT (exo:week_number(?start) AS ?week) WHERE {
          <urn:exo:task-1> ems:Effort_startTimestamp ?start .
        }
      `, "week");

      expect(result).toBe("3");
    });
  });

  describe("exo:format_date(dateTime, pattern)", () => {
    it("should format date with YYYY-MM-DD pattern", async () => {
      const result = await queryValue(`${PREFIXES}
        SELECT (exo:format_date(?start, "YYYY-MM-DD") AS ?formatted) WHERE {
          <urn:exo:task-1> ems:Effort_startTimestamp ?start .
        }
      `, "formatted");

      expect(result).toBe("2026-01-15");
    });
  });
});
