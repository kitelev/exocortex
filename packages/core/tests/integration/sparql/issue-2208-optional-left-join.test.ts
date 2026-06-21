/**
 * Issue #2208: OPTIONAL should use LEFT JOIN semantics
 *
 * Problem: OPTIONAL clause behaves like INNER JOIN instead of LEFT JOIN.
 * When optional pattern doesn't match, results are filtered out.
 *
 * Expected: All tasks returned, with ?project bound only when exists.
 * Actual (before fix): Only tasks WITH projects returned.
 *
 * SPARQL Spec Reference:
 * > If the optional part does not match, it does not eliminate the solution,
 * > it just means the optional variables are unbound.
 *
 * Acceptance Criteria:
 * - [x] OPTIONAL returns all LHS results
 * - [x] Unmatched optional bindings are unbound (not filtered)
 * - [x] Nested OPTIONAL works correctly
 * - [x] Multiple OPTIONAL patterns work correctly
 * - [x] OPTIONAL with FILTER works correctly
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

// Standard namespace URIs
const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");

// Example namespaces
const EMS = "http://exocortex.kitelev.xyz/ems/";
const EX = "http://example.org/";
const FOAF = "http://xmlns.com/foaf/0.1/";

/**
 * Helper to execute SPARQL and return simplified results
 */
async function executeQuery(
  executor: QueryExecutor,
  query: string
): Promise<Record<string, unknown>[]> {
  const parser = new SPARQLParser();
  const translator = new AlgebraTranslator();

  const parsed = parser.parse(query);
  const algebra = translator.translate(parsed);
  const results: Record<string, unknown>[] = [];

  for await (const solution of executor.execute(algebra)) {
    const obj: Record<string, unknown> = {};
    for (const variable of solution.variables()) {
      const term = solution.get(variable);
      if (term) {
        const value = (term as any).value;
        const datatype = (term as any).datatype?.value || (term as any)._datatype?.value;
        if (datatype && (datatype.includes("integer") || datatype.includes("decimal"))) {
          obj[variable] = parseFloat(value);
        } else {
          obj[variable] = value;
        }
      }
    }
    results.push(obj);
  }

  return results;
}

describe("Issue #2208: OPTIONAL should use LEFT JOIN semantics", () => {
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
  });

  describe("regression test - reproduces the exact bug scenario", () => {
    it("should return all tasks, with project bound only when exists", async () => {
      // Task 1: has a project
      await store.add(new Triple(
        new IRI(`${EX}task1`),
        RDF_TYPE,
        new IRI(`${EMS}Task`)
      ));
      await store.add(new Triple(
        new IRI(`${EX}task1`),
        new IRI(`${EMS}Task_project`),
        new IRI(`${EX}project1`)
      ));

      // Task 2: does NOT have a project
      await store.add(new Triple(
        new IRI(`${EX}task2`),
        RDF_TYPE,
        new IRI(`${EMS}Task`)
      ));

      // Task 3: has a different project
      await store.add(new Triple(
        new IRI(`${EX}task3`),
        RDF_TYPE,
        new IRI(`${EMS}Task`)
      ));
      await store.add(new Triple(
        new IRI(`${EX}task3`),
        new IRI(`${EMS}Task_project`),
        new IRI(`${EX}project2`)
      ));

      const query = `
        PREFIX ems: <${EMS}>
        SELECT ?task ?project WHERE {
          ?task a ems:Task .
          OPTIONAL { ?task ems:Task_project ?project }
        }
      `;

      const results = await executeQuery(executor, query);

      // CRITICAL: Should return ALL 3 tasks, not just the 2 with projects
      expect(results.length).toBe(3);

      // task1 should have project bound
      const task1 = results.find((r) => String(r.task).endsWith("task1"));
      expect(task1).toBeDefined();
      expect(task1?.project).toBeDefined();
      expect(String(task1?.project)).toContain("project1");

      // task2 should have NO project bound (optional didn't match)
      const task2 = results.find((r) => String(r.task).endsWith("task2"));
      expect(task2).toBeDefined();
      expect(task2?.project).toBeUndefined(); // This is the key assertion!

      // task3 should have project bound
      const task3 = results.find((r) => String(r.task).endsWith("task3"));
      expect(task3).toBeDefined();
      expect(task3?.project).toBeDefined();
      expect(String(task3?.project)).toContain("project2");
    });
  });

  describe("edge cases - LEFT JOIN semantics", () => {
    it("should return all persons with optional mbox", async () => {
      // Alice has mbox
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}name`), new Literal("Alice")));
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}mbox`), new IRI("mailto:alice@example.org")));

      // Bob does NOT have mbox
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}name`), new Literal("Bob")));

      // Charlie does NOT have mbox
      await store.add(new Triple(new IRI(`${EX}charlie`), new IRI(`${FOAF}name`), new Literal("Charlie")));

      const query = `
        PREFIX foaf: <${FOAF}>
        SELECT ?person ?name ?mbox WHERE {
          ?person foaf:name ?name
          OPTIONAL { ?person foaf:mbox ?mbox }
        }
      `;

      const results = await executeQuery(executor, query);

      // Must return all 3 persons
      expect(results.length).toBe(3);

      // Alice should have mbox
      const alice = results.find((r) => r.name === "Alice");
      expect(alice).toBeDefined();
      expect(alice?.mbox).toBeDefined();

      // Bob should NOT have mbox (but should be in results!)
      const bob = results.find((r) => r.name === "Bob");
      expect(bob).toBeDefined();
      expect(bob?.mbox).toBeUndefined();

      // Charlie should NOT have mbox (but should be in results!)
      const charlie = results.find((r) => r.name === "Charlie");
      expect(charlie).toBeDefined();
      expect(charlie?.mbox).toBeUndefined();
    });

    it("should handle multiple OPTIONAL patterns", async () => {
      // Alice has both age and mbox
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}name`), new Literal("Alice")));
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}age`), new Literal("30", XSD_INTEGER)));
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}mbox`), new IRI("mailto:alice@example.org")));

      // Bob has age but no mbox
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}name`), new Literal("Bob")));
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}age`), new Literal("25", XSD_INTEGER)));

      // Charlie has neither age nor mbox
      await store.add(new Triple(new IRI(`${EX}charlie`), new IRI(`${FOAF}name`), new Literal("Charlie")));

      const query = `
        PREFIX foaf: <${FOAF}>
        SELECT ?name ?age ?email WHERE {
          ?person foaf:name ?name
          OPTIONAL { ?person foaf:age ?age }
          OPTIONAL { ?person foaf:mbox ?email }
        }
      `;

      const results = await executeQuery(executor, query);

      // Must return all 3 persons
      expect(results.length).toBe(3);

      // Alice has both
      const alice = results.find((r) => r.name === "Alice");
      expect(alice).toBeDefined();
      expect(alice?.age).toBe(30);
      expect(alice?.email).toBeDefined();

      // Bob has age but no email
      const bob = results.find((r) => r.name === "Bob");
      expect(bob).toBeDefined();
      expect(bob?.age).toBe(25);
      expect(bob?.email).toBeUndefined();

      // Charlie has neither
      const charlie = results.find((r) => r.name === "Charlie");
      expect(charlie).toBeDefined();
      expect(charlie?.age).toBeUndefined();
      expect(charlie?.email).toBeUndefined();
    });

    it("should handle nested OPTIONAL patterns", async () => {
      // Alice knows Bob who has an age
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}name`), new Literal("Alice")));
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}knows`), new IRI(`${EX}bob`)));
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}name`), new Literal("Bob")));
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}age`), new Literal("25", XSD_INTEGER)));

      // Charlie knows nobody
      await store.add(new Triple(new IRI(`${EX}charlie`), new IRI(`${FOAF}name`), new Literal("Charlie")));

      // Dave knows Eve but Eve has no age
      await store.add(new Triple(new IRI(`${EX}dave`), new IRI(`${FOAF}name`), new Literal("Dave")));
      await store.add(new Triple(new IRI(`${EX}dave`), new IRI(`${FOAF}knows`), new IRI(`${EX}eve`)));
      await store.add(new Triple(new IRI(`${EX}eve`), new IRI(`${FOAF}name`), new Literal("Eve")));

      const query = `
        PREFIX foaf: <${FOAF}>
        SELECT ?name ?friend ?friendAge WHERE {
          ?person foaf:name ?name
          OPTIONAL {
            ?person foaf:knows ?friendResource .
            ?friendResource foaf:name ?friend .
            OPTIONAL { ?friendResource foaf:age ?friendAge }
          }
        }
      `;

      const results = await executeQuery(executor, query);

      // Should return all people (Alice, Bob, Charlie, Dave, Eve)
      const names = results.map((r) => r.name);
      expect(names).toContain("Alice");
      expect(names).toContain("Charlie");
      expect(names).toContain("Dave");
      expect(names).toContain("Bob");
      expect(names).toContain("Eve");

      // Alice knows Bob who has age 25
      const alice = results.find((r) => r.name === "Alice");
      expect(alice).toBeDefined();
      expect(alice?.friend).toBe("Bob");
      expect(alice?.friendAge).toBe(25);

      // Charlie doesn't know anyone
      const charlie = results.find((r) => r.name === "Charlie");
      expect(charlie).toBeDefined();
      expect(charlie?.friend).toBeUndefined();
      expect(charlie?.friendAge).toBeUndefined();

      // Dave knows Eve but Eve has no age
      const dave = results.find((r) => r.name === "Dave");
      expect(dave).toBeDefined();
      expect(dave?.friend).toBe("Eve");
      expect(dave?.friendAge).toBeUndefined();
    });

    it("should handle OPTIONAL with FILTER", async () => {
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}name`), new Literal("Alice")));
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}age`), new Literal("30", XSD_INTEGER)));
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}name`), new Literal("Bob")));
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}age`), new Literal("15", XSD_INTEGER)));
      await store.add(new Triple(new IRI(`${EX}charlie`), new IRI(`${FOAF}name`), new Literal("Charlie")));

      const query = `
        PREFIX foaf: <${FOAF}>
        SELECT ?name ?age WHERE {
          ?person foaf:name ?name
          OPTIONAL {
            ?person foaf:age ?age .
            FILTER(?age > 20)
          }
        }
      `;

      const results = await executeQuery(executor, query);

      // All 3 people should be in results
      expect(results.length).toBe(3);

      // Alice has age 30 > 20, should have age
      const alice = results.find((r) => r.name === "Alice");
      expect(alice?.age).toBe(30);

      // Bob has age 15 < 20, filter fails, should NOT have age
      const bob = results.find((r) => r.name === "Bob");
      expect(bob).toBeDefined();
      expect(bob?.age).toBeUndefined();

      // Charlie has no age, should NOT have age
      const charlie = results.find((r) => r.name === "Charlie");
      expect(charlie).toBeDefined();
      expect(charlie?.age).toBeUndefined();
    });

    it("should handle empty right side (all left solutions preserved)", async () => {
      // Two people, neither has a phone
      await store.add(new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}name`), new Literal("Alice")));
      await store.add(new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}name`), new Literal("Bob")));

      const query = `
        PREFIX foaf: <${FOAF}>
        SELECT ?name ?phone WHERE {
          ?person foaf:name ?name
          OPTIONAL { ?person foaf:phone ?phone }
        }
      `;

      const results = await executeQuery(executor, query);

      // Both people should be in results, neither has phone
      expect(results.length).toBe(2);

      const names = results.map((r) => r.name);
      expect(names).toContain("Alice");
      expect(names).toContain("Bob");

      // Neither should have phone
      results.forEach((r) => {
        expect(r.phone).toBeUndefined();
      });
    });
  });
});
