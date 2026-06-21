/**
 * Regression tests for #2836 and #2837 — BIND/UNION/EXISTS interactions.
 *
 * #2837: `BIND(IF(EXISTS {...}, ..., ...))` previously hung at algebra
 *        translation in v15.31.2 and silently produced unbound variables
 *        in v15.101.0. The fix threads async EXISTS evaluation through
 *        BIND execution and the IF special form.
 *
 * #2836: `UNION` with `BIND` inside each branch was reported as a
 *        "CASE WHEN transformation error" in v15.31.2. That crash is no
 *        longer reproducible; this test is a regression guard for the
 *        documented query shapes.
 */
import { SPARQLParser } from "../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";

const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const EMS = "https://exocortex.my/ontology/ems#";

function termValue(term: unknown): unknown {
  if (term === undefined || term === null) return undefined;
  if (term instanceof Literal) return term.value;
  if (term instanceof IRI) return term.value;
  if (typeof term === "object" && term !== null && "value" in (term as object)) {
    return (term as { value: unknown }).value;
  }
  return term;
}

async function execQuery(
  executor: QueryExecutor,
  query: string,
): Promise<Record<string, unknown>[]> {
  const parser = new SPARQLParser();
  const translator = new AlgebraTranslator();
  const parsed = parser.parse(query);
  const algebra = translator.translate(parsed);
  const results: Record<string, unknown>[] = [];
  for await (const solution of executor.execute(algebra)) {
    const obj: Record<string, unknown> = {};
    for (const variable of solution.variables()) {
      obj[variable] = termValue(solution.get(variable));
    }
    results.push(obj);
  }
  return results;
}

describe("SPARQL BIND regression: #2837 BIND(IF(EXISTS)) and #2836 UNION+BIND", () => {
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
  });

  describe("#2837: BIND(IF(EXISTS {...}, ..., ...))", () => {
    it("binds labels without hanging or losing the BIND result", async () => {
      await store.add(new Triple(new IRI("urn:s1"), RDF_TYPE, new IRI(`${EMS}Task`)));
      await store.add(
        new Triple(new IRI("urn:s1"), new IRI(`${EMS}Effort_status`), new IRI("urn:done")),
      );
      await store.add(new Triple(new IRI("urn:s2"), RDF_TYPE, new IRI(`${EMS}Task`)));

      const query = `
        PREFIX ems: <${EMS}>
        SELECT ?s ?label WHERE {
          ?s a ems:Task .
          BIND(IF(EXISTS { ?s ems:Effort_status ?x }, "has_status", "no_status") AS ?label)
        }`;

      const rows = await execQuery(executor, query);
      expect(rows).toHaveLength(2);

      const s1 = rows.find((r) => r.s === "urn:s1");
      const s2 = rows.find((r) => r.s === "urn:s2");
      expect(s1?.label).toBe("has_status");
      expect(s2?.label).toBe("no_status");
    }, 5000);

    it("binds via NOT EXISTS inside IF as well", async () => {
      await store.add(new Triple(new IRI("urn:a"), RDF_TYPE, new IRI(`${EMS}Task`)));
      await store.add(
        new Triple(new IRI("urn:a"), new IRI(`${EMS}Effort_status`), new IRI("urn:s")),
      );
      await store.add(new Triple(new IRI("urn:b"), RDF_TYPE, new IRI(`${EMS}Task`)));

      const query = `
        PREFIX ems: <${EMS}>
        SELECT ?s ?missing WHERE {
          ?s a ems:Task .
          BIND(IF(NOT EXISTS { ?s ems:Effort_status ?x }, "yes", "no") AS ?missing)
        }`;

      const rows = await execQuery(executor, query);
      expect(rows).toHaveLength(2);
      const a = rows.find((r) => r.s === "urn:a");
      const b = rows.find((r) => r.s === "urn:b");
      expect(a?.missing).toBe("no");
      expect(b?.missing).toBe("yes");
    }, 5000);
  });

  describe("#2836: UNION with BIND inside each branch", () => {
    it("binds ?issue per branch without crashing", async () => {
      await store.add(new Triple(new IRI("urn:missing"), RDF_TYPE, new IRI(`${EMS}Task`)));
      await store.add(new Triple(new IRI("urn:dupe"), RDF_TYPE, new IRI(`${EMS}Task`)));
      await store.add(
        new Triple(new IRI("urn:dupe"), new IRI(`${EMS}Effort_status`), new IRI("urn:a")),
      );
      await store.add(
        new Triple(new IRI("urn:dupe"), new IRI(`${EMS}Effort_status`), new IRI("urn:b")),
      );

      const query = `
        PREFIX ems: <${EMS}>
        SELECT ?s ?issue WHERE {
          {
            ?s a ems:Task .
            FILTER NOT EXISTS { ?s ems:Effort_status ?x }
            BIND("missing" AS ?issue)
          } UNION {
            ?s ems:Effort_status ?s1, ?s2 . FILTER(STR(?s1) < STR(?s2))
            BIND("duplicate" AS ?issue)
          }
        }`;

      const rows = await execQuery(executor, query);
      const pairs = rows.map((r) => ({ s: r.s, issue: r.issue }));
      expect(pairs).toContainEqual({ s: "urn:missing", issue: "missing" });
      expect(pairs.some((p) => p.s === "urn:dupe" && p.issue === "duplicate")).toBe(true);
    });
  });
});
