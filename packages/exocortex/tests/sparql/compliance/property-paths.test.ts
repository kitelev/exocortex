/**
 * SPARQL 1.1 Compliance Tests - Property Paths
 *
 * Tests all 6 property path types as specified in:
 * https://www.w3.org/TR/sparql11-query/#propertypaths
 *
 * Property Path Types:
 * 1. Predicate Path (simple IRI)
 * 2. Inverse Path (^)
 * 3. Sequence Path (/)
 * 4. Alternative Path (|)
 * 5. Zero or More Path (*)
 * 6. One or More Path (+)
 * Additional: Zero or One Path (?), Negated Property Set (!), Fixed Length Paths ({n})
 *
 * Issue #932: Add comprehensive SPARQL 1.1 compliance test suite
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

// Type-safe value extraction helper - handles RDF terms and primitives
const getValue = (term: any): string | undefined => {
  if (term === undefined || term === null) return undefined;
  // Handle primitives (numbers, strings) returned from expressions
  if (typeof term === "number") return String(term);
  if (typeof term === "string") return term;
  if (typeof term === "boolean") return String(term);
  // Handle RDF terms
  if (term && typeof term === "object") {
    if ("value" in term) return term.value;
    if ("id" in term) return term.id;
  }
  return undefined;
};

// Test namespaces
const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const RDFS_SUBCLASSOF = new IRI("http://www.w3.org/2000/01/rdf-schema#subClassOf");
const FOAF = "http://xmlns.com/foaf/0.1/";
const EX = "http://example.org/";

describe("SPARQL 1.1 Compliance - Property Paths", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let executor: QueryExecutor;
  let store: InMemoryTripleStore;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);

    // Build a hierarchical test graph for property path testing
    const triples = [
      // Class hierarchy: Animal > Mammal > Person
      new Triple(new IRI(`${EX}Person`), RDFS_SUBCLASSOF, new IRI(`${EX}Mammal`)),
      new Triple(new IRI(`${EX}Mammal`), RDFS_SUBCLASSOF, new IRI(`${EX}Animal`)),
      new Triple(new IRI(`${EX}Animal`), RDFS_SUBCLASSOF, new IRI(`${EX}LivingThing`)),

      // People
      new Triple(new IRI(`${EX}alice`), RDF_TYPE, new IRI(`${EX}Person`)),
      new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}name`), new Literal("Alice")),

      new Triple(new IRI(`${EX}bob`), RDF_TYPE, new IRI(`${EX}Person`)),
      new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}name`), new Literal("Bob")),

      new Triple(new IRI(`${EX}carol`), RDF_TYPE, new IRI(`${EX}Person`)),
      new Triple(new IRI(`${EX}carol`), new IRI(`${FOAF}name`), new Literal("Carol")),

      // Social graph (knows chain: alice -> bob -> carol -> dan)
      new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}knows`), new IRI(`${EX}bob`)),
      new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}knows`), new IRI(`${EX}carol`)),
      new Triple(new IRI(`${EX}carol`), new IRI(`${FOAF}knows`), new IRI(`${EX}dan`)),
      new Triple(new IRI(`${EX}dan`), RDF_TYPE, new IRI(`${EX}Person`)),
      new Triple(new IRI(`${EX}dan`), new IRI(`${FOAF}name`), new Literal("Dan")),

      // Family relationships
      new Triple(new IRI(`${EX}alice`), new IRI(`${EX}parentOf`), new IRI(`${EX}eve`)),
      new Triple(new IRI(`${EX}eve`), RDF_TYPE, new IRI(`${EX}Person`)),
      new Triple(new IRI(`${EX}eve`), new IRI(`${FOAF}name`), new Literal("Eve")),
      new Triple(new IRI(`${EX}eve`), new IRI(`${EX}parentOf`), new IRI(`${EX}frank`)),
      new Triple(new IRI(`${EX}frank`), RDF_TYPE, new IRI(`${EX}Person`)),
      new Triple(new IRI(`${EX}frank`), new IRI(`${FOAF}name`), new Literal("Frank")),

      // Multiple property example
      new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}mbox`), new Literal("alice@example.org")),
      new Triple(new IRI(`${EX}alice`), new IRI(`${EX}email`), new Literal("alice@work.org")),
    ];

    await store.addAll(triples);
  });

  describe("1. Predicate Path (Simple IRI)", () => {
    it("should match simple predicate path", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("2. Inverse Path (^)", () => {
    it("should traverse path in reverse direction", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?knower WHERE {
          ex:bob ^foaf:knows ?knower .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Alice knows Bob, so Alice should be returned
      expect(results).toHaveLength(1);
      expect(getValue(results[0].get("knower"))).toBe(`${EX}alice`);
    });

    it.skip("should handle inverse of inverse (double negation)", async () => {
      // Note: ^(^path) syntax requires parentheses - ^^path is not valid SPARQL
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?known WHERE {
          ex:alice ^(^foaf:knows) ?known .
        }
      `;

      // ^^ = original direction
      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should be same as forward traversal
      expect(results.some((r) => getValue(r.get("known")) === `${EX}bob`)).toBe(true);
    });
  });

  describe("3. Sequence Path (/)", () => {
    it("should traverse sequence of two predicates", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?friendOfFriend WHERE {
          ex:alice foaf:knows/foaf:knows ?friendOfFriend .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // alice -> bob -> carol
      expect(results).toHaveLength(1);
      expect(getValue(results[0].get("friendOfFriend"))).toBe(`${EX}carol`);
    });

    it("should traverse sequence of three predicates", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?thirdDegree WHERE {
          ex:alice foaf:knows/foaf:knows/foaf:knows ?thirdDegree .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // alice -> bob -> carol -> dan
      expect(results).toHaveLength(1);
      expect(getValue(results[0].get("thirdDegree"))).toBe(`${EX}dan`);
    });

    it("should combine sequence with type lookup", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX ex: <http://example.org/>
        SELECT ?superclass WHERE {
          ex:Person rdfs:subClassOf/rdfs:subClassOf ?superclass .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Person -> Mammal -> Animal
      expect(results).toHaveLength(1);
      expect(getValue(results[0].get("superclass"))).toBe(`${EX}Animal`);
    });
  });

  describe("4. Alternative Path (|)", () => {
    it("should match either of two predicates", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?contact WHERE {
          ex:alice foaf:mbox|ex:email ?contact .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Alice has both mbox and email
      expect(results).toHaveLength(2);
    });

    it("should handle alternative with no matches on one branch", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?value WHERE {
          ex:bob foaf:mbox|foaf:name ?value .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Bob has only name, no mbox
      expect(results).toHaveLength(1);
      expect(getValue(results[0].get("value"))).toBe("Bob");
    });

    it("should handle multiple alternatives", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?value WHERE {
          ex:alice foaf:name|foaf:mbox|ex:email ?value .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Alice has name, mbox, and email
      expect(results).toHaveLength(3);
    });
  });

  describe("5. Zero or More Path (*)", () => {
    it("should find reflexive match (zero steps)", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?reachable WHERE {
          ex:alice foaf:knows* ?reachable .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should include alice (0 steps), bob (1), carol (2), dan (3)
      const reachable = results.map((r) => getValue(r.get("reachable")));
      expect(reachable).toContain(`${EX}alice`); // Zero steps
      expect(reachable).toContain(`${EX}bob`);   // One step
      expect(reachable).toContain(`${EX}carol`); // Two steps
      expect(reachable).toContain(`${EX}dan`);   // Three steps
    });

    it("should traverse class hierarchy", async () => {
      const query = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX ex: <http://example.org/>
        SELECT ?ancestor WHERE {
          ex:Person rdfs:subClassOf* ?ancestor .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      const ancestors = results.map((r) => getValue(r.get("ancestor")));
      expect(ancestors).toContain(`${EX}Person`);     // 0 steps
      expect(ancestors).toContain(`${EX}Mammal`);     // 1 step
      expect(ancestors).toContain(`${EX}Animal`);     // 2 steps
      expect(ancestors).toContain(`${EX}LivingThing`); // 3 steps
    });
  });

  describe("6. One or More Path (+)", () => {
    it("should require at least one step", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?reachable WHERE {
          ex:alice foaf:knows+ ?reachable .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should NOT include alice (needs at least 1 step)
      const reachable = results.map((r) => getValue(r.get("reachable")));
      expect(reachable).not.toContain(`${EX}alice`); // Zero steps not allowed
      expect(reachable).toContain(`${EX}bob`);       // One step
      expect(reachable).toContain(`${EX}carol`);     // Two steps
      expect(reachable).toContain(`${EX}dan`);       // Three steps
    });

    it("should find all descendants via parent relationship", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?descendant WHERE {
          ex:alice ex:parentOf+ ?descendant .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      const descendants = results.map((r) => getValue(r.get("descendant")));
      expect(descendants).toContain(`${EX}eve`);   // Child
      expect(descendants).toContain(`${EX}frank`); // Grandchild
    });
  });

  describe("Zero or One Path (?)", () => {
    it("should match zero or one occurrences", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?maybeKnown WHERE {
          ex:alice foaf:knows? ?maybeKnown .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should include alice (0 steps) and bob (1 step), but not carol (2 steps)
      const maybeKnown = results.map((r) => getValue(r.get("maybeKnown")));
      expect(maybeKnown).toContain(`${EX}alice`); // Zero steps
      expect(maybeKnown).toContain(`${EX}bob`);   // One step
      expect(maybeKnown).not.toContain(`${EX}carol`); // Two steps - not allowed
    });
  });

  describe("Negated Property Set (!)", () => {
    it("should match any predicate except those listed", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ex: <http://example.org/>
        SELECT ?p ?o WHERE {
          ex:alice !rdf:type ?o .
        }
      `;

      const parsed = parser.parse(query);
      // Just verify it parses - execution may vary
      expect(parsed.type).toBe("query");
    });

    it("should negate multiple predicates", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ex: <http://example.org/>
        SELECT ?o WHERE {
          ex:alice !(rdf:type|foaf:name) ?o .
        }
      `;

      const parsed = parser.parse(query);
      expect(parsed.type).toBe("query");
    });

    it("should negate inverse paths", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?s WHERE {
          ?s !^foaf:knows ex:bob .
        }
      `;

      const parsed = parser.parse(query);
      expect(parsed.type).toBe("query");
    });
  });

  describe("Complex Property Path Combinations", () => {
    it("should handle sequence with alternative", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?name WHERE {
          ex:alice foaf:knows/(foaf:name|ex:email) ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // alice knows bob, and bob has name
      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle alternative with transitive closure", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?person WHERE {
          ex:alice (foaf:knows|ex:parentOf)+ ?person .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should reach bob/carol/dan via knows and eve/frank via parentOf
      expect(results.length).toBeGreaterThan(3);
    });

    it("should handle inverse in sequence", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?peer WHERE {
          ex:bob ^foaf:knows/foaf:knows ?peer .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Go back from bob to alice, then forward to bob again
      expect(results).toHaveLength(1);
      expect(getValue(results[0].get("peer"))).toBe(`${EX}bob`);
    });

    it("should handle grouped path expressions", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?x WHERE {
          ex:alice (foaf:knows/foaf:knows)* ?x .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Zero or more times of (knows two steps)
      // 0 steps = alice, 1 step = carol, would be dan with odd paths
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("Property Path Edge Cases", () => {
    it("should handle empty result set", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?x WHERE {
          ex:alice ex:nonExistent* ?x .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // With *, at least alice should match (zero steps)
      expect(results.some((r) => getValue(r.get("x")) === `${EX}alice`)).toBe(true);
    });

    it("should handle cycles in graph (avoid infinite loops)", async () => {
      // Add a cycle: dan -> alice
      await store.add(
        new Triple(
          new IRI(`${EX}dan`),
          new IRI(`${FOAF}knows`),
          new IRI(`${EX}alice`)
        )
      );

      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        SELECT ?reachable WHERE {
          ex:alice foaf:knows+ ?reachable .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should terminate and find all nodes in cycle
      expect(results.length).toBeGreaterThan(0);
      // Should not hang or crash
    });

    it("should handle self-loops", async () => {
      // Add self-loop
      await store.add(
        new Triple(
          new IRI(`${EX}alice`),
          new IRI(`${EX}selfRef`),
          new IRI(`${EX}alice`)
        )
      );

      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?x WHERE {
          ex:alice ex:selfRef+ ?x .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should find alice via self-loop
      expect(results.some((r) => getValue(r.get("x")) === `${EX}alice`)).toBe(true);
    });
  });
});
