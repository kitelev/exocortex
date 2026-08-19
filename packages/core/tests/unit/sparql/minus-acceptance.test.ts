/**
 * End-to-end acceptance for MINUS (vault-exodev task 0c24668f, defect 2).
 *
 * The translator-level axes in
 * `algebra/PatternTranslator.minusLeftOperand.test.ts` lock the SHAPE
 * (`Minus(P, Q)` instead of `Join(P, Minus(∅, Q))`). These axes lock the
 * OBSERVABLE: how many rows the engine actually returns.
 *
 * ⛔ The measurement that exposed the defect, on a live 303k-triple vault:
 * `SELECT ?s WHERE { ?s exo:Asset_uid ?u . MINUS { ?s ?y ?z } }` returned all
 * 17025 subjects. Every subject has at least one triple, so the right side
 * subsumes the left and the answer had to be 0. MINUS was a silent no-op.
 *
 * ⛤ The two-form probe is what made it conclusive: with NO shared variable
 * (`MINUS { ?x ?y ?z }`) returning everything is CORRECT per SPARQL 1.1 §18.5,
 * and that form alone would have "confirmed" the engine was fine. Only the
 * shared-variable form discriminates — so both are kept below, the disjoint one
 * as a canary that the fix did not overcorrect into removing rows it must keep.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("MINUS — subtracts from the preceding group (defect 0c24668f-2)", () => {
  let store: InMemoryTripleStore;
  let parser: SPARQLParser;
  let translator: ExoQLAlgebraTranslator;

  const task1 = new IRI("urn:exo:task-1");
  const task2 = new IRI("urn:exo:task-2");
  const task3 = new IRI("urn:exo:task-3");
  const other = new IRI("urn:exo:unrelated");

  const hasLabel = Namespace.EXO.term("Asset_label");
  const hasStatus = Namespace.EMS.term("Effort_status");
  const hasNote = Namespace.EXO.term("Asset_note");
  const statusDone = new IRI("urn:exo:status-done");

  async function executeQuery(sparql: string) {
    const ast = parser.parse(sparql);
    const algebra = translator.translate(ast);
    return new ExoQLQueryExecutor(store).executeAll(algebra);
  }

  const PREFIXES = `
    PREFIX exo: <https://exocortex.my/ontology/exo#>
    PREFIX ems: <https://exocortex.my/ontology/ems#>
  `;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    parser = new SPARQLParser();
    translator = new ExoQLAlgebraTranslator();

    await store.addAll([
      new Triple(task1, hasLabel, new Literal("One")),
      new Triple(task2, hasLabel, new Literal("Two")),
      new Triple(task3, hasLabel, new Literal("Three")),
      // task2 is the one MINUS must remove
      new Triple(task2, hasStatus, statusDone),
      // A subject that is NOT in the left side at all — present so the
      // "subtract everything" axis cannot pass by the store being trivial.
      new Triple(other, hasNote, new Literal("noise")),
    ]);
  });

  it("removes the matching subject (the textbook case)", async () => {
    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_label ?label .
        MINUS { ?task ems:Effort_status ?st }
      }`);

    // ⛔ Before the fix this returned all THREE — MINUS removed nothing.
    const got = rows.map((r) => (r.get("task") as IRI).value).sort();
    expect(got).toEqual(["urn:exo:task-1", "urn:exo:task-3"]);
  });

  it("returns nothing when the right side subsumes the left", async () => {
    // This is the live-vault measurement in miniature: every ?task has at
    // least one triple, so the whole left side must be subtracted.
    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_label ?label .
        MINUS { ?task ?p ?o }
      }`);

    expect(rows).toHaveLength(0);
  });

  it("subtracts from EVERYTHING that precedes it, not just the nearest group", async () => {
    // { label . status . MINUS { … } } — the left operand is the join of both.
    await store.addAll([new Triple(task1, hasStatus, statusDone)]);

    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_label ?label .
        ?task ems:Effort_status ?st .
        MINUS { ?task ems:Effort_status <urn:exo:status-done> }
      }`);

    // task1 and task2 are both done → both removed; nothing survives.
    expect(rows).toHaveLength(0);
  });

  it("CANARY: MINUS with NO shared variable removes nothing (SPARQL 1.1 §18.5)", async () => {
    // Green in BOTH states. Its job is to catch an overcorrection — a fix that
    // made MINUS subtract unconditionally would turn this to 0 and be wrong.
    const rows = await executeQuery(`${PREFIXES}
      SELECT ?task WHERE {
        ?task exo:Asset_label ?label .
        MINUS { ?x ?y ?z }
      }`);

    expect(rows).toHaveLength(3);
  });
});
