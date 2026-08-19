/**
 * NOT EXISTS / EXISTS must see the OUTER solution's bindings inside their
 * pattern — including inside a nested FILTER.
 *
 * SPARQL 1.1 §8.1.1: EXISTS is evaluated by SUBSTITUTING the current solution
 * into the pattern and asking whether the result is non-empty. The substitution
 * is the whole mechanism; without it the inner group is evaluated against the
 * bare store and any reference to an outer variable is unbound.
 *
 * ⛔ The defect (vault-exodev task 0c24668f, defect 1): `evaluateExistsPattern`
 * executed the pattern FIRST and only then merged each result with the outer
 * solution. For a plain BGP that accidentally works — `merge` filters the
 * incompatible rows after the fact. For an inner FILTER comparing against an
 * OUTER variable it does not: that variable is unbound while the filter runs,
 * so the filter drops everything, EXISTS is false, and `NOT EXISTS` is
 * unconditionally TRUE. The live measurement was 519 of 519 rows surviving a
 * filter that should have kept 116.
 *
 * ⛤ Why this shape and not a bare `NOT EXISTS { ?s ?p ?o }`: the post-hoc merge
 * makes the simple cases pass, which is exactly why the defect survived. Only a
 * comparison against an outer variable discriminates.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("EXISTS / NOT EXISTS — outer variables inside the pattern", () => {
  let store: InMemoryTripleStore;
  let parser: SPARQLParser;
  let translator: ExoQLAlgebraTranslator;

  const taskA = new IRI("urn:exo:task-a");
  const taskB = new IRI("urn:exo:task-b");
  const taskC = new IRI("urn:exo:task-c");

  const hasScore = Namespace.EXO.term("Asset_score");
  const hasLimit = Namespace.EXO.term("Asset_limit");
  const hasLabel = Namespace.EXO.term("Asset_label");
  const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");

  const PREFIXES = `
    PREFIX exo: <https://exocortex.my/ontology/exo#>
  `;

  async function executeQuery(sparql: string) {
    const ast = parser.parse(sparql);
    const algebra = translator.translate(ast);
    return new ExoQLQueryExecutor(store).executeAll(algebra);
  }

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    parser = new SPARQLParser();
    translator = new ExoQLAlgebraTranslator();

    // Each task carries a score and a limit. "Over limit" = score > limit.
    // taskA: 10 > 5  → over        taskB: 3 > 5 → not over
    // taskC: 8 > 5  → over
    await store.addAll([
      new Triple(taskA, hasLabel, new Literal("A")),
      new Triple(taskA, hasScore, new Literal("10", xsdInteger)),
      new Triple(taskA, hasLimit, new Literal("5", xsdInteger)),

      new Triple(taskB, hasLabel, new Literal("B")),
      new Triple(taskB, hasScore, new Literal("3", xsdInteger)),
      new Triple(taskB, hasLimit, new Literal("5", xsdInteger)),

      new Triple(taskC, hasLabel, new Literal("C")),
      new Triple(taskC, hasScore, new Literal("8", xsdInteger)),
      new Triple(taskC, hasLimit, new Literal("5", xsdInteger)),
    ]);
  });

  it("EXISTS sees an outer variable used inside a nested FILTER", async () => {
    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_limit ?limit .
        FILTER EXISTS { ?task exo:Asset_score ?score . FILTER(?score > ?limit) }
      }`);

    const got = rows.map((r) => (r.get("task") as IRI).value).sort();
    expect(got).toEqual(["urn:exo:task-a", "urn:exo:task-c"]);
  });

  it("NOT EXISTS is not unconditionally true when the inner FILTER uses an outer variable", async () => {
    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_limit ?limit .
        FILTER NOT EXISTS { ?task exo:Asset_score ?score . FILTER(?score > ?limit) }
      }`);

    // ⛔ Before the fix this returned ALL THREE — the inner filter saw ?limit
    // unbound, matched nothing, so NOT EXISTS was true for every row.
    const got = rows.map((r) => (r.get("task") as IRI).value);
    expect(got).toEqual(["urn:exo:task-b"]);
  });

  it("CANARY: plain NOT EXISTS over a BGP (no inner FILTER) keeps working", async () => {
    // Green in BOTH states — the post-hoc merge already handled this shape.
    // It is here so that a fix which broke the simple path could not hide.
    await store.addAll([new Triple(taskB, Namespace.EXO.term("Asset_flag"), new Literal("x"))]);

    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_limit ?limit .
        FILTER NOT EXISTS { ?task exo:Asset_flag ?f }
      }`);

    const got = rows.map((r) => (r.get("task") as IRI).value).sort();
    expect(got).toEqual(["urn:exo:task-a", "urn:exo:task-c"]);
  });

  it("CANARY: EXISTS over a BGP correlated only by the shared subject keeps working", async () => {
    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_limit ?limit .
        FILTER EXISTS { ?task exo:Asset_score ?score }
      }`);

    expect(rows).toHaveLength(3);
  });
});
