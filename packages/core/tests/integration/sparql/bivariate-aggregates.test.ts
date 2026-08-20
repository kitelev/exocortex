import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

const EX = "http://example.org/";
const AGG = "https://exocortex.my/ontology/agg#";
const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");

const val = (t: unknown): string | undefined =>
  t && typeof t === "object" && "value" in t ? (t as { value: string }).value : undefined;
const num = (t: unknown): number => Number(val(t));

/**
 * @req:6609ac35-4f62-41e9-9b3c-1efdec1fefa8
 *
 * Two-column aggregates (#3994). Fixtures carry a KNOWN closed-form answer, so an
 * assertion cannot pass on a plausible-but-wrong number:
 *
 *   y = 2x + 1 exactly  →  corr = 1,  slope = 2,  intercept = 1
 *   y = -x + 10 exactly →  corr = -1, slope = -1, intercept = 10
 *
 * Revert-verify — each mutant drops EXACTLY its own axis:
 *   • make bivariateStep ignore value2 (the pre-#3994 shape) → axes 1-3 RED
 *   • drop the `vx <= 0` guard                              → axis 5 RED (0/0 = NaN)
 *   • drop the `n < 2` guard                                → axis 4 RED
 *   • axis 6 is the non-vacuity control: single-column aggregates unchanged.
 */
describe("bivariate aggregates: corr / slope / intercept (#3994)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let executor: QueryExecutor;
  let store: InMemoryTripleStore;

  const pair = (i: number, x: number, y: number): Triple[] => [
    new Triple(new IRI(`${EX}s${i}`), new IRI(`${EX}x`), new Literal(String(x), XSD_INTEGER)),
    new Triple(new IRI(`${EX}s${i}`), new IRI(`${EX}y`), new Literal(String(y), XSD_INTEGER)),
  ];

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
  });

  const run = async (q: string) => executor.executeAll(translator.translate(parser.parse(q)));

  const q = (fn: string) => `
    PREFIX ex: <${EX}>
    PREFIX agg: <${AGG}>
    SELECT (${fn} AS ?r) WHERE { ?s ex:x ?x . ?s ex:y ?y }
  `;

  const seedPerfect = async () => {
    // y = 2x + 1 on x = 1..5
    for (let i = 0; i < 5; i++) await store.addAll(pair(i, i + 1, 2 * (i + 1) + 1));
  };

  it("axis 1 — agg:corr returns exactly 1 on a perfectly increasing line", async () => {
    await seedPerfect();
    const rows = await run(q("agg:corr(?x, ?y)"));
    expect(rows).toHaveLength(1);
    expect(num(rows[0].get("r"))).toBeCloseTo(1, 10);
  });

  it("axis 2 — agg:slope and agg:intercept recover y = 2x + 1", async () => {
    await seedPerfect();
    expect(num((await run(q("agg:slope(?x, ?y)")))[0].get("r"))).toBeCloseTo(2, 10);
    expect(num((await run(q("agg:intercept(?x, ?y)")))[0].get("r"))).toBeCloseTo(1, 10);
  });

  it("axis 3 — a DECREASING line gives corr = -1, slope = -1, intercept = 10", async () => {
    // Sign is the half a one-column fallback cannot fake: ignoring ?y would make all
    // three depend on ?x alone and lose the direction entirely.
    for (let i = 0; i < 5; i++) await store.addAll(pair(i, i + 1, 10 - (i + 1)));
    expect(num((await run(q("agg:corr(?x, ?y)")))[0].get("r"))).toBeCloseTo(-1, 10);
    expect(num((await run(q("agg:slope(?x, ?y)")))[0].get("r"))).toBeCloseTo(-1, 10);
    expect(num((await run(q("agg:intercept(?x, ?y)")))[0].get("r"))).toBeCloseTo(10, 10);
  });

  it("axis 4 — a single pair yields NaN, not 0 (n < 2 is undefined, not 'no correlation')", async () => {
    await store.addAll(pair(0, 1, 3));
    const r = (await run(q("agg:corr(?x, ?y)")))[0].get("r");
    expect(val(r)).toBe("NaN");
  });

  it("axis 5 — a CONSTANT column yields NaN, not 0 (zero variance is unanswerable)", async () => {
    // Reporting 0 here would read as "measured, no correlation" — a different and
    // false claim than "the question has no answer".
    for (let i = 0; i < 4; i++) await store.addAll(pair(i, 7, i + 1));
    expect(val((await run(q("agg:corr(?x, ?y)")))[0].get("r"))).toBe("NaN");
    expect(val((await run(q("agg:slope(?x, ?y)")))[0].get("r"))).toBe("NaN");
  });

  it("axis 6 — single-column aggregates are unaffected (non-vacuity control)", async () => {
    await seedPerfect();
    const rows = await run(`
      PREFIX ex: <${EX}>
      PREFIX agg: <${AGG}>
      SELECT (agg:median(?x) AS ?m) WHERE { ?s ex:x ?x }
    `);
    expect(num(rows[0].get("m"))).toBe(3);
  });

  it("axis 7 — wrong arity still raises, now against the aggregate's own arity", async () => {
    await seedPerfect();
    await expect(run(q("agg:corr(?x)"))).rejects.toThrow(/takes exactly 2 arguments, got 1/);
    await expect(run(q("agg:median(?x, ?y)"))).rejects.toThrow(/takes exactly 1 argument, got 2/);
  });
});
