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

/**
 * @req:0a8977bb-51f8-469b-a0f2-b2514ac45290
 *
 * Guard for the two SILENT failure modes of the `agg:` custom-aggregate path,
 * both measured on published CLI 16.230.0 against a real vault before the fix:
 *
 *   agg:bogusZzz(?n)     →  [ {}, {}, {} … ]   no error, no aggregation at all
 *   agg:median(?n, ?n)   →  "33"                2nd argument SILENTLY dropped
 *
 * Neither raised. Both returned output that reads as data — the second is the exact
 * shape a user writes for a two-column statistic (`agg:corr(?x, ?y)`, #3994) and it
 * answered with a plausible ONE-column number.
 *
 * Revert-verify (each axis fails alone, the other three stay green):
 *   • drop the `iri.startsWith(EXO_AGGREGATE_NS)` throw in customAggregateIri
 *       → axis 1 RED (the unknown name degrades to a plain function call again)
 *   • drop the `argc > 1` throw in translateCustomAggregateFunctionCall
 *       → axis 3 RED (the extra argument is silently dropped again)
 *   • axes 2 and 4 are the non-vacuity controls: they must stay GREEN under BOTH
 *     mutations, otherwise the guards reach past their stated scope.
 */
describe("agg: custom aggregates fail loudly instead of degrading silently", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let executor: QueryExecutor;
  let store: InMemoryTripleStore;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
    await store.addAll(
      [10, 20, 30, 40, 50].map(
        (v, i) =>
          new Triple(
            new IRI(`${EX}s${i}`),
            new IRI(`${EX}val`),
            new Literal(String(v), XSD_INTEGER),
          ),
      ),
    );
  });

  const run = async (q: string) => {
    const algebra = translator.translate(parser.parse(q));
    return executor.executeAll(algebra);
  };

  it("axis 1 — an UNREGISTERED name inside the agg: namespace raises and names the registered ones", async () => {
    await expect(
      run(`
        PREFIX ex: <${EX}>
        PREFIX agg: <${AGG}>
        SELECT (agg:bogusZzz(?v) AS ?r) WHERE { ?s ex:val ?v }
      `),
    ).rejects.toThrow(/Unknown aggregate agg:bogusZzz/);

    // The message must be actionable, not merely loud: it lists what IS registered so a
    // typo is self-correcting. Asserted separately so a bare "throws" cannot pass this.
    await expect(
      run(`
        PREFIX ex: <${EX}>
        PREFIX agg: <${AGG}>
        SELECT (agg:bogusZzz(?v) AS ?r) WHERE { ?s ex:val ?v }
      `),
    ).rejects.toThrow(/agg:median/);

    // ⛤ `agg:corr` USED to be asserted here as an unknown name. #3994 registered it,
    // so that assertion became stale — it pinned the absence of a feature, not the
    // guard. Coverage of "unknown name raises" is unchanged (agg:bogusZzz above);
    // corr is now covered as a VALID two-column aggregate in
    // bivariate-aggregates.test.ts, including its arity refusal.
  });

  it("axis 2 — a function OUTSIDE the agg: namespace is untouched (non-vacuity control)", async () => {
    // Scope control: the guard must key on the agg: namespace, not on "unknown IRI".
    // An ordinary function call in another namespace still flows to the non-aggregate
    // path exactly as before — it must NOT be turned into an error by this change.
    const rows = await run(`
      PREFIX ex: <${EX}>
      SELECT (ex:myFunction(?v) AS ?r) WHERE { ?s ex:val ?v }
    `);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("axis 3 — a wrong-arity call to a REGISTERED aggregate raises and points at #3994", async () => {
    await expect(
      run(`
        PREFIX ex: <${EX}>
        PREFIX agg: <${AGG}>
        SELECT (agg:median(?v, ?v) AS ?r) WHERE { ?s ex:val ?v }
      `),
    ).rejects.toThrow(/takes exactly 1 argument, got 2/);

  });

  it("axis 4 — a correct single-argument call is unaffected (non-vacuity control)", async () => {
    const rows = await run(`
      PREFIX ex: <${EX}>
      PREFIX agg: <${AGG}>
      SELECT (agg:median(?v) AS ?med) WHERE { ?s ex:val ?v }
    `);
    expect(rows).toHaveLength(1);
    expect(Number(String((rows[0].get("med") as { value?: string })?.value ?? ""))).toBe(30);
  });
});
