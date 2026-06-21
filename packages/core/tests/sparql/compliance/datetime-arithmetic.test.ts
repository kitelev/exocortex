/**
 * SPARQL 1.1/1.2 Compliance Tests — DateTime/Date/Time × Duration arithmetic.
 *
 * Issue #3088: BIND with `dateTime ± duration` (или `date ± duration`,
 * `time − duration`) parses+executes но returns unbound result. Root cause —
 * `FilterExecutor.evaluateExpression` для AST-узлов type "literal" возвращал
 * только `value: string`, теряя `datatype`. Type-guards в evaluateArithmetic
 * (`isDateTimeValue`, `isDayTimeDurationValue`, ...) не срабатывали → fallback
 * в numeric branch → NaN → unbound.
 *
 * Fix: преобразовывать литералы с datatype в `Literal`-инстансы,
 * сохраняющие IRI datatype.
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";

const PREFIX = `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;

function getBoundValue(row: Record<string, unknown>, varName: string): string {
  const v = row[varName];
  if (v === undefined || v === null) {
    throw new Error(`?${varName} is unbound`);
  }
  return String(v);
}

describe("SPARQL DateTime/Date/Time × Duration arithmetic (Issue #3088)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let optimizer: AlgebraOptimizer;
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;

  async function runQuery(sparql: string): Promise<Record<string, unknown>[]> {
    const parsed = parser.parse(sparql);
    let alg = translator.translate(parsed);
    alg = optimizer.optimize(alg);
    const solutions = await executor.executeAll(alg);
    return solutions.map((s) => (typeof (s as { toJSON?: () => Record<string, unknown> }).toJSON === "function"
      ? (s as { toJSON: () => Record<string, unknown> }).toJSON()
      : (s as unknown as Record<string, unknown>)));
  }

  beforeEach(() => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    optimizer = new AlgebraOptimizer();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
  });

  describe("dateTime ± duration", () => {
    it("AC1: dateTime − dayTimeDuration produces correct dateTime", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?back WHERE {
        BIND("2026-05-08T00:00:00.000Z"^^xsd:dateTime - "P14D"^^xsd:dayTimeDuration AS ?back)
      }`);
      expect(r).toHaveLength(1);
      const back = getBoundValue(r[0], "back");
      expect(back).toContain("2026-04-24");
      expect(back).toContain("dateTime");
    });

    it("dateTime + dayTimeDuration produces correct dateTime", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?fwd WHERE {
        BIND("2026-05-08T00:00:00.000Z"^^xsd:dateTime + "P7D"^^xsd:dayTimeDuration AS ?fwd)
      }`);
      const fwd = getBoundValue(r[0], "fwd");
      expect(fwd).toContain("2026-05-15");
    });

    it("dateTime − yearMonthDuration produces correct dateTime", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?back WHERE {
        BIND("2026-05-08T00:00:00.000Z"^^xsd:dateTime - "P3M"^^xsd:yearMonthDuration AS ?back)
      }`);
      const back = getBoundValue(r[0], "back");
      expect(back).toContain("2026-02-08");
    });

    it("dateTime + yearMonthDuration produces correct dateTime", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?fwd WHERE {
        BIND("2026-05-08T00:00:00.000Z"^^xsd:dateTime + "P1Y"^^xsd:yearMonthDuration AS ?fwd)
      }`);
      const fwd = getBoundValue(r[0], "fwd");
      expect(fwd).toContain("2027-05-08");
    });

    it("AC2: NOW() − dayTimeDuration is bound and ~14 days back", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?cutoff WHERE {
        BIND(NOW() - "P14D"^^xsd:dayTimeDuration AS ?cutoff)
      }`);
      const cutoff = getBoundValue(r[0], "cutoff");
      const isoMatch = cutoff.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/);
      expect(isoMatch).not.toBeNull();
      const cutoffMs = Date.parse(isoMatch![1]);
      const expectedMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5000);
    });
  });

  describe("date ± duration", () => {
    it("date − dayTimeDuration produces correct date", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?back WHERE {
        BIND("2026-05-08"^^xsd:date - "P14D"^^xsd:dayTimeDuration AS ?back)
      }`);
      const back = getBoundValue(r[0], "back");
      expect(back).toContain("2026-04-24");
    });

    it("date + dayTimeDuration produces correct date", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?fwd WHERE {
        BIND("2026-05-08"^^xsd:date + "P14D"^^xsd:dayTimeDuration AS ?fwd)
      }`);
      const fwd = getBoundValue(r[0], "fwd");
      expect(fwd).toContain("2026-05-22");
    });

    it("date − yearMonthDuration produces correct date", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?back WHERE {
        BIND("2026-05-08"^^xsd:date - "P2M"^^xsd:yearMonthDuration AS ?back)
      }`);
      const back = getBoundValue(r[0], "back");
      expect(back).toContain("2026-03-08");
    });

    it("date + yearMonthDuration produces correct date", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?fwd WHERE {
        BIND("2026-05-08"^^xsd:date + "P1Y"^^xsd:yearMonthDuration AS ?fwd)
      }`);
      const fwd = getBoundValue(r[0], "fwd");
      expect(fwd).toContain("2027-05-08");
    });
  });

  describe("Edge cases", () => {
    it("leap year: 2024-02-29 + P1Y truncates correctly", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?fwd WHERE {
        BIND("2024-02-29"^^xsd:date + "P1Y"^^xsd:yearMonthDuration AS ?fwd)
      }`);
      const fwd = getBoundValue(r[0], "fwd");
      expect(fwd).toMatch(/2025-(02-28|03-01)/);
    });

    it("dateTime + P-1D (negative-style large back-shift via subtract path)", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?back WHERE {
        BIND("2026-05-08T00:00:00.000Z"^^xsd:dateTime - "P1D"^^xsd:dayTimeDuration AS ?back)
      }`);
      const back = getBoundValue(r[0], "back");
      expect(back).toContain("2026-05-07");
    });

    it("dateTime preserves sub-day precision through subtraction", async () => {
      const r = await runQuery(`${PREFIX} SELECT ?back WHERE {
        BIND("2026-05-08T12:34:56.000Z"^^xsd:dateTime - "PT1H"^^xsd:dayTimeDuration AS ?back)
      }`);
      const back = getBoundValue(r[0], "back");
      expect(back).toContain("2026-05-08");
      expect(back).toContain("11:34:56");
    });
  });
});
