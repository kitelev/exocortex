import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getValue = (term: any): string | undefined => {
  if (term === undefined || term === null) return undefined;
  if (typeof term === "number") return String(term);
  if (typeof term === "string") return term;
  if (term && typeof term === "object") {
    if ("value" in term) return term.value;
    if ("id" in term) return term.id;
  }
  return undefined;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const num = (term: any): number => Number(getValue(term));

const EX = "http://example.org/";
const AGG = "https://exocortex.my/ontology/agg#";
const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");

/**
 * Regression guard for issue #3942 — the built-in statistical aggregates
 * (`agg:median` / `agg:stddev` / `agg:variance` / `agg:mode` / `agg:percentileNN`)
 * are implemented in BUILT_IN_AGGREGATES and computed by AggregateExecutor, but
 * were UNREACHABLE from SPARQL: sparqljs parses `agg:median(?x)` as a plain
 * `functionCall` (not an `aggregate` node), so AggregateTranslator never created an
 * aggregate binding and the projection variable silently vanished from the group
 * row (the median/σ/quartile columns were absent — forcing analytics to Python).
 * AggregateTranslator now recognizes a function-call to a registered custom
 * aggregate and wires it into the aggregation path.
 *
 * Revert-verify: remove the `customAggregateIri` wiring in AggregateTranslator and
 * the `agg:*` columns disappear from the group row → `?med`/`?sd`/`?q1`/`?q3`
 * become undefined → `num(...)` is NaN → these assertions go RED.
 */
describe("ExoQL custom statistical aggregates reachable from SPARQL (#3942)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let executor: QueryExecutor;
  let store: InMemoryTripleStore;

  const val = (i: number, v: number): Triple =>
    new Triple(
      new IRI(`${EX}s${i}`),
      new IRI(`${EX}val`),
      new Literal(String(v), XSD_INTEGER),
    );

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
    // values 10,20,30,40,50 → median 30, population σ = √200 ≈ 14.142, p25 20, p75 40
    await store.addAll([10, 20, 30, 40, 50].map((v, i) => val(i, v)));
  });

  const run = async (q: string) => {
    const algebra = translator.translate(parser.parse(q));
    return executor.executeAll(algebra);
  };

  it("agg:median / agg:stddev / agg:percentileNN produce result columns in an aggregation query", async () => {
    const rows = await run(`
      PREFIX ex: <${EX}>
      PREFIX agg: <${AGG}>
      SELECT (COUNT(?v) AS ?n) (agg:median(?v) AS ?med) (agg:stddev(?v) AS ?sd)
             (agg:percentile25(?v) AS ?q1) (agg:percentile75(?v) AS ?q3)
      WHERE { ?s ex:val ?v }
    `);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(num(r.get("n"))).toBe(5);
    expect(num(r.get("med"))).toBe(30);
    expect(num(r.get("sd"))).toBeCloseTo(Math.sqrt(200), 6);
    expect(num(r.get("q1"))).toBe(20);
    expect(num(r.get("q3"))).toBe(40);
  });

  it("agg:median composes with GROUP BY (per-group medians)", async () => {
    await store.addAll([
      new Triple(new IRI(`${EX}s0`), new IRI(`${EX}cat`), new Literal("A")),
      new Triple(new IRI(`${EX}s1`), new IRI(`${EX}cat`), new Literal("A")),
      new Triple(new IRI(`${EX}s2`), new IRI(`${EX}cat`), new Literal("A")),
      new Triple(new IRI(`${EX}s3`), new IRI(`${EX}cat`), new Literal("B")),
      new Triple(new IRI(`${EX}s4`), new IRI(`${EX}cat`), new Literal("B")),
    ]);
    const rows = await run(`
      PREFIX ex: <${EX}>
      PREFIX agg: <${AGG}>
      SELECT ?cat (agg:median(?v) AS ?med)
      WHERE { ?s ex:val ?v ; ex:cat ?cat } GROUP BY ?cat ORDER BY ?cat
    `);
    expect(rows).toHaveLength(2);
    expect(getValue(rows[0].get("cat"))).toBe("A"); // 10,20,30 → 20
    expect(num(rows[0].get("med"))).toBe(20);
    expect(getValue(rows[1].get("cat"))).toBe("B"); // 40,50 → 45
    expect(num(rows[1].get("med"))).toBe(45);
  });

  it("agg:mode returns the most frequent value", async () => {
    const s = new InMemoryTripleStore();
    const ex2 = new QueryExecutor(s);
    await s.addAll([5, 5, 7, 5, 9].map((v, i) => val(i, v)));
    const algebra = translator.translate(
      parser.parse(`
        PREFIX ex: <${EX}>
        PREFIX agg: <${AGG}>
        SELECT (agg:mode(?v) AS ?mode) (COUNT(?v) AS ?n) WHERE { ?s ex:val ?v }
      `),
    );
    const rows = await ex2.executeAll(algebra);
    expect(rows).toHaveLength(1);
    expect(num(rows[0].get("mode"))).toBe(5);
  });
});
