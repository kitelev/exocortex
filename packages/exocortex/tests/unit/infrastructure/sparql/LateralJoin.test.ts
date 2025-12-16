/**
 * End-to-end tests for SPARQL LATERAL join (SPARQL 1.2, Issue #980)
 *
 * LATERAL joins enable correlated subqueries where the inner query can
 * reference variables from the outer query. This enables patterns like
 * "top N per group" that are not possible with regular subqueries.
 *
 * SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
 */
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

describe("LATERAL Join Execution (Issue #980)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);

    // Add test data: People with friends and scores
    // Alice knows Bob (score 80), Charlie (score 95), David (score 70)
    // Eve knows Frank (score 60), Grace (score 90)

    // People
    await tripleStore.addAll([
      new Triple(
        new IRI("http://example.org/alice"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/Person")
      ),
      new Triple(
        new IRI("http://example.org/eve"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/Person")
      ),

      // Alice's friends
      new Triple(
        new IRI("http://example.org/alice"),
        new IRI("http://example.org/knows"),
        new IRI("http://example.org/bob")
      ),
      new Triple(
        new IRI("http://example.org/bob"),
        new IRI("http://example.org/score"),
        new Literal("80", Namespace.XSD.term("integer"))
      ),
      new Triple(
        new IRI("http://example.org/alice"),
        new IRI("http://example.org/knows"),
        new IRI("http://example.org/charlie")
      ),
      new Triple(
        new IRI("http://example.org/charlie"),
        new IRI("http://example.org/score"),
        new Literal("95", Namespace.XSD.term("integer"))
      ),
      new Triple(
        new IRI("http://example.org/alice"),
        new IRI("http://example.org/knows"),
        new IRI("http://example.org/david")
      ),
      new Triple(
        new IRI("http://example.org/david"),
        new IRI("http://example.org/score"),
        new Literal("70", Namespace.XSD.term("integer"))
      ),

      // Eve's friends
      new Triple(
        new IRI("http://example.org/eve"),
        new IRI("http://example.org/knows"),
        new IRI("http://example.org/frank")
      ),
      new Triple(
        new IRI("http://example.org/frank"),
        new IRI("http://example.org/score"),
        new Literal("60", Namespace.XSD.term("integer"))
      ),
      new Triple(
        new IRI("http://example.org/eve"),
        new IRI("http://example.org/knows"),
        new IRI("http://example.org/grace")
      ),
      new Triple(
        new IRI("http://example.org/grace"),
        new IRI("http://example.org/score"),
        new Literal("90", Namespace.XSD.term("integer"))
      ),
    ]);
  });

  describe("Basic LATERAL Parsing", () => {
    it("should parse LATERAL keyword", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
            LIMIT 1
          }
        }
      `;

      // Should not throw
      const ast = parser.parse(query);
      expect(ast.type).toBe("query");
    });

    it("should translate LATERAL to lateraljoin operation", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
            LIMIT 1
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // The algebra tree should contain a lateraljoin operation
      expect(algebra).toBeDefined();
      // Check that we have a lateraljoin somewhere in the tree
      const containsLateralJoin = JSON.stringify(algebra).includes('"type":"lateraljoin"');
      expect(containsLateralJoin).toBe(true);
    });
  });

  describe("Correlated Subquery Execution", () => {
    it("should execute LATERAL with correlated reference to outer variable", async () => {
      // This query finds all friend relationships - ?person references outer context
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Alice knows 3 friends, Eve knows 2 = 5 total
      expect(results).toHaveLength(5);

      const personFriendPairs = results.map((r) => ({
        person: (r.get("person") as IRI).value,
        friend: (r.get("friend") as IRI).value,
      }));

      // Check Alice's friends
      expect(personFriendPairs).toContainEqual({
        person: "http://example.org/alice",
        friend: "http://example.org/bob",
      });
      expect(personFriendPairs).toContainEqual({
        person: "http://example.org/alice",
        friend: "http://example.org/charlie",
      });
      expect(personFriendPairs).toContainEqual({
        person: "http://example.org/alice",
        friend: "http://example.org/david",
      });

      // Check Eve's friends
      expect(personFriendPairs).toContainEqual({
        person: "http://example.org/eve",
        friend: "http://example.org/frank",
      });
      expect(personFriendPairs).toContainEqual({
        person: "http://example.org/eve",
        friend: "http://example.org/grace",
      });
    });
  });

  describe("Top N Per Group Pattern", () => {
    it("should get top 1 friend per person using LATERAL with ORDER BY and LIMIT", async () => {
      const query = `
        SELECT ?person ?friend ?score
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend ?score WHERE {
              ?person <http://example.org/knows> ?friend .
              ?friend <http://example.org/score> ?score .
            }
            ORDER BY DESC(?score)
            LIMIT 1
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Should get top 1 for each person = 2 results
      expect(results).toHaveLength(2);

      const resultMap = new Map(
        results.map((r) => [
          (r.get("person") as IRI).value,
          {
            friend: (r.get("friend") as IRI).value,
            score: Number((r.get("score") as Literal).value),
          },
        ])
      );

      // Alice's top friend should be Charlie (score 95)
      expect(resultMap.get("http://example.org/alice")).toEqual({
        friend: "http://example.org/charlie",
        score: 95,
      });

      // Eve's top friend should be Grace (score 90)
      expect(resultMap.get("http://example.org/eve")).toEqual({
        friend: "http://example.org/grace",
        score: 90,
      });
    });

    it("should get top 2 friends per person using LATERAL", async () => {
      const query = `
        SELECT ?person ?friend ?score
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend ?score WHERE {
              ?person <http://example.org/knows> ?friend .
              ?friend <http://example.org/score> ?score .
            }
            ORDER BY DESC(?score)
            LIMIT 2
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Alice has 3 friends, top 2 = 2
      // Eve has 2 friends, top 2 = 2
      // Total = 4
      expect(results).toHaveLength(4);

      // Group by person
      const aliceResults = results.filter(
        (r) => (r.get("person") as IRI).value === "http://example.org/alice"
      );
      const eveResults = results.filter(
        (r) => (r.get("person") as IRI).value === "http://example.org/eve"
      );

      expect(aliceResults).toHaveLength(2);
      expect(eveResults).toHaveLength(2);

      // Alice's top 2: Charlie (95), Bob (80)
      const aliceFriends = aliceResults.map((r) => (r.get("friend") as IRI).value);
      expect(aliceFriends).toContain("http://example.org/charlie");
      expect(aliceFriends).toContain("http://example.org/bob");
      expect(aliceFriends).not.toContain("http://example.org/david");
    });
  });

  describe("Edge Cases", () => {
    it("should handle LATERAL when inner query returns no results for some outer bindings", async () => {
      // Add a person with no friends
      await tripleStore.add(
        new Triple(
          new IRI("http://example.org/lonely"),
          new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          new IRI("http://example.org/Person")
        )
      );

      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Lonely person should be excluded (inner join semantics)
      // Only Alice (3 friends) and Eve (2 friends) should be in results = 5
      expect(results).toHaveLength(5);

      const persons = new Set(results.map((r) => (r.get("person") as IRI).value));
      expect(persons.has("http://example.org/lonely")).toBe(false);
    });

    it("should handle multiple LATERAL patterns", async () => {
      // Add projects
      await tripleStore.addAll([
        new Triple(
          new IRI("http://example.org/alice"),
          new IRI("http://example.org/worksOn"),
          new IRI("http://example.org/projectA")
        ),
        new Triple(
          new IRI("http://example.org/projectA"),
          new IRI("http://example.org/priority"),
          new Literal("high")
        ),
        new Triple(
          new IRI("http://example.org/eve"),
          new IRI("http://example.org/worksOn"),
          new IRI("http://example.org/projectB")
        ),
        new Triple(
          new IRI("http://example.org/projectB"),
          new IRI("http://example.org/priority"),
          new Literal("medium")
        ),
      ]);

      const query = `
        SELECT ?person ?friend ?project
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
            LIMIT 1
          }
          LATERAL {
            SELECT ?project WHERE {
              ?person <http://example.org/worksOn> ?project .
            }
            LIMIT 1
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Each person gets 1 friend and 1 project = 2 results
      expect(results).toHaveLength(2);

      // Each result should have all three variables bound
      for (const result of results) {
        expect(result.get("person")).toBeDefined();
        expect(result.get("friend")).toBeDefined();
        expect(result.get("project")).toBeDefined();
      }
    });
  });
});
