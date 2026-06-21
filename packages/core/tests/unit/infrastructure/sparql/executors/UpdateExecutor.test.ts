import { UpdateExecutor, UpdateExecutorError } from "../../../../../src/infrastructure/sparql/executors/UpdateExecutor";
import { SPARQLParser } from "../../../../../src/infrastructure/sparql/SPARQLParser";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import type { Update } from "../../../../../src/infrastructure/sparql/SPARQLParser";

describe("UpdateExecutor", () => {
  let executor: UpdateExecutor;
  let tripleStore: InMemoryTripleStore;
  let parser: SPARQLParser;

  beforeEach(() => {
    tripleStore = new InMemoryTripleStore();
    executor = new UpdateExecutor(tripleStore);
    parser = new SPARQLParser();
  });

  describe("INSERT DATA", () => {
    it("should insert a single triple into default graph", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/subject> <http://example.org/predicate> "value" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("insert");
      expect(results[0].inserted).toBe(1);
      expect(results[0].success).toBe(true);

      // Verify triple was added
      const triples = await tripleStore.match(
        new IRI("http://example.org/subject"),
        new IRI("http://example.org/predicate")
      );
      expect(triples).toHaveLength(1);
      expect(triples[0].object.toString()).toContain("value");
    });

    it("should insert multiple triples into default graph", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/s1> <http://example.org/p1> "value1" .
          <http://example.org/s2> <http://example.org/p2> "value2" .
          <http://example.org/s3> <http://example.org/p3> "value3" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results).toHaveLength(1);
      expect(results[0].inserted).toBe(3);

      // Verify all triples were added
      const count = await tripleStore.count();
      expect(count).toBe(3);
    });

    it("should insert triple with IRI object", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/subject> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Class> .
        }
      `;

      const parsed = parser.parse(query) as Update;
      await executor.execute(parsed);

      const triples = await tripleStore.match(
        new IRI("http://example.org/subject"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
      );
      expect(triples).toHaveLength(1);
      expect(triples[0].object).toBeInstanceOf(IRI);
    });

    it("should insert triple with typed literal", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/subject> <http://example.org/age> "25"^^<http://www.w3.org/2001/XMLSchema#integer> .
        }
      `;

      const parsed = parser.parse(query) as Update;
      await executor.execute(parsed);

      const triples = await tripleStore.match(
        new IRI("http://example.org/subject"),
        new IRI("http://example.org/age")
      );
      expect(triples).toHaveLength(1);
      expect(triples[0].object.toString()).toContain("25");
    });

    it("should insert triple with language-tagged literal", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/subject> <http://example.org/label> "Hello"@en .
        }
      `;

      const parsed = parser.parse(query) as Update;
      await executor.execute(parsed);

      const triples = await tripleStore.match(
        new IRI("http://example.org/subject"),
        new IRI("http://example.org/label")
      );
      expect(triples).toHaveLength(1);
      expect(triples[0].object.toString()).toContain("@en");
    });

    it("should insert triples into named graph", async () => {
      const query = `
        INSERT DATA {
          GRAPH <http://example.org/graph1> {
            <http://example.org/s> <http://example.org/p> "value" .
          }
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results).toHaveLength(1);
      expect(results[0].inserted).toBe(1);

      // Verify triple was added to named graph
      const triples = await tripleStore.matchInGraph(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        undefined,
        new IRI("http://example.org/graph1")
      );
      expect(triples).toHaveLength(1);

      // Verify triple is NOT in default graph
      const defaultTriples = await tripleStore.match(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p")
      );
      expect(defaultTriples).toHaveLength(0);
    });

    it("should insert triples into multiple named graphs", async () => {
      const query = `
        INSERT DATA {
          GRAPH <http://example.org/g1> {
            <http://example.org/s1> <http://example.org/p1> "v1" .
          }
          GRAPH <http://example.org/g2> {
            <http://example.org/s2> <http://example.org/p2> "v2" .
          }
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results[0].inserted).toBe(2);

      // Verify triples in respective graphs
      const g1Triples = await tripleStore.matchInGraph(
        new IRI("http://example.org/s1"),
        undefined,
        undefined,
        new IRI("http://example.org/g1")
      );
      expect(g1Triples).toHaveLength(1);

      const g2Triples = await tripleStore.matchInGraph(
        new IRI("http://example.org/s2"),
        undefined,
        undefined,
        new IRI("http://example.org/g2")
      );
      expect(g2Triples).toHaveLength(1);
    });

    it("should handle prefixed URIs", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        INSERT DATA {
          ex:subject ex:predicate "value" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      await executor.execute(parsed);

      const triples = await tripleStore.match(
        new IRI("http://example.org/subject"),
        new IRI("http://example.org/predicate")
      );
      expect(triples).toHaveLength(1);
    });

    it("should handle blank nodes", async () => {
      const query = `
        INSERT DATA {
          _:b1 <http://example.org/predicate> "value" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results[0].inserted).toBe(1);

      // Verify triple was added (blank node subject)
      const count = await tripleStore.count();
      expect(count).toBe(1);
    });

    it("should not duplicate existing triples", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/s> <http://example.org/p> "value" .
        }
      `;

      const parsed = parser.parse(query) as Update;

      // Insert twice
      await executor.execute(parsed);
      await executor.execute(parsed);

      // Should still have only 1 triple (InMemoryTripleStore deduplicates)
      const count = await tripleStore.count();
      expect(count).toBe(1);
    });
  });

  describe("DELETE DATA", () => {
    beforeEach(async () => {
      // Pre-populate the store
      const insertQuery = `
        INSERT DATA {
          <http://example.org/s1> <http://example.org/p1> "v1" .
          <http://example.org/s2> <http://example.org/p2> "v2" .
          <http://example.org/s3> <http://example.org/p3> "v3" .
        }
      `;
      const parsed = parser.parse(insertQuery) as Update;
      await executor.execute(parsed);
    });

    it("should delete a single triple from default graph", async () => {
      const query = `
        DELETE DATA {
          <http://example.org/s1> <http://example.org/p1> "v1" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("delete");
      expect(results[0].deleted).toBe(1);
      expect(results[0].success).toBe(true);

      // Verify triple was removed
      const triples = await tripleStore.match(
        new IRI("http://example.org/s1")
      );
      expect(triples).toHaveLength(0);

      // Verify other triples still exist
      const count = await tripleStore.count();
      expect(count).toBe(2);
    });

    it("should delete multiple triples from default graph", async () => {
      const query = `
        DELETE DATA {
          <http://example.org/s1> <http://example.org/p1> "v1" .
          <http://example.org/s2> <http://example.org/p2> "v2" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results[0].deleted).toBe(2);

      const count = await tripleStore.count();
      expect(count).toBe(1);
    });

    it("should handle deletion of non-existent triple (returns 0 deleted)", async () => {
      const query = `
        DELETE DATA {
          <http://example.org/nonexistent> <http://example.org/p> "value" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results[0].deleted).toBe(0);
      expect(results[0].success).toBe(true);

      // Verify no triples were removed
      const count = await tripleStore.count();
      expect(count).toBe(3);
    });

    it("should delete triples from named graph", async () => {
      // First insert into named graph
      const insertQuery = `
        INSERT DATA {
          GRAPH <http://example.org/g1> {
            <http://example.org/ns> <http://example.org/np> "nv" .
          }
        }
      `;
      const insertParsed = parser.parse(insertQuery) as Update;
      await executor.execute(insertParsed);

      // Then delete from named graph
      const deleteQuery = `
        DELETE DATA {
          GRAPH <http://example.org/g1> {
            <http://example.org/ns> <http://example.org/np> "nv" .
          }
        }
      `;
      const deleteParsed = parser.parse(deleteQuery) as Update;
      const results = await executor.execute(deleteParsed);

      expect(results[0].deleted).toBe(1);

      // Verify triple was removed from named graph
      const triples = await tripleStore.matchInGraph(
        undefined,
        undefined,
        undefined,
        new IRI("http://example.org/g1")
      );
      expect(triples).toHaveLength(0);
    });
  });

  describe("Error handling", () => {
    it("should throw error for non-update query", async () => {
      const selectQuery = parser.parse("SELECT * WHERE { ?s ?p ?o }");

      await expect(executor.execute(selectQuery as any)).rejects.toThrow(
        UpdateExecutorError
      );
    });

    it("should throw error for unsupported INSERT/DELETE with WHERE", async () => {
      // Note: sparqljs parses this differently, but we test the error path
      const query = `
        DELETE { ?s <http://example.org/p> ?o }
        INSERT { ?s <http://example.org/p> "new" }
        WHERE { ?s <http://example.org/p> ?o }
      `;

      const parsed = parser.parse(query) as Update;
      await expect(executor.execute(parsed)).rejects.toThrow(
        "INSERT/DELETE with WHERE clause not yet implemented"
      );
    });

    it("should throw error for DELETE WHERE", async () => {
      const query = `
        DELETE WHERE { ?s <http://example.org/p> ?o }
      `;

      const parsed = parser.parse(query) as Update;
      await expect(executor.execute(parsed)).rejects.toThrow(
        "DELETE WHERE not yet implemented"
      );
    });

    it("should throw error for CLEAR operation", async () => {
      const query = `
        CLEAR GRAPH <http://example.org/g1>
      `;

      const parsed = parser.parse(query) as Update;
      await expect(executor.execute(parsed)).rejects.toThrow(
        "CLEAR operation not yet implemented"
      );
    });

    it("should throw error for DROP operation", async () => {
      const query = `
        DROP GRAPH <http://example.org/g1>
      `;

      const parsed = parser.parse(query) as Update;
      await expect(executor.execute(parsed)).rejects.toThrow(
        "DROP operation not yet implemented"
      );
    });

    it("should throw error for LOAD operation", async () => {
      const query = `
        LOAD <http://example.org/data.ttl>
      `;

      const parsed = parser.parse(query) as Update;
      await expect(executor.execute(parsed)).rejects.toThrow(
        "LOAD operation not yet implemented"
      );
    });

    it("should throw error for CREATE operation", async () => {
      const query = `
        CREATE GRAPH <http://example.org/newgraph>
      `;

      const parsed = parser.parse(query) as Update;
      await expect(executor.execute(parsed)).rejects.toThrow(
        "CREATE operation not yet implemented"
      );
    });
  });

  describe("Multiple operations in single update", () => {
    it("should execute multiple operations sequentially", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/s1> <http://example.org/p1> "v1" .
        } ;
        INSERT DATA {
          <http://example.org/s2> <http://example.org/p2> "v2" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe("insert");
      expect(results[0].inserted).toBe(1);
      expect(results[1].type).toBe("insert");
      expect(results[1].inserted).toBe(1);

      const count = await tripleStore.count();
      expect(count).toBe(2);
    });

    it("should execute INSERT then DELETE", async () => {
      const query = `
        INSERT DATA {
          <http://example.org/s> <http://example.org/p> "initial" .
        } ;
        DELETE DATA {
          <http://example.org/s> <http://example.org/p> "initial" .
        } ;
        INSERT DATA {
          <http://example.org/s> <http://example.org/p> "updated" .
        }
      `;

      const parsed = parser.parse(query) as Update;
      const results = await executor.execute(parsed);

      expect(results).toHaveLength(3);

      // Verify final state
      const triples = await tripleStore.match(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p")
      );
      expect(triples).toHaveLength(1);
      expect(triples[0].object.toString()).toContain("updated");
    });
  });
});

describe("SPARQLParser UPDATE support", () => {
  let parser: SPARQLParser;

  beforeEach(() => {
    parser = new SPARQLParser();
  });

  it("should parse INSERT DATA query", () => {
    const query = `
      INSERT DATA {
        <http://example.org/s> <http://example.org/p> "value" .
      }
    `;

    const parsed = parser.parse(query);
    expect(parser.isUpdateQuery(parsed)).toBe(true);
  });

  it("should parse DELETE DATA query", () => {
    const query = `
      DELETE DATA {
        <http://example.org/s> <http://example.org/p> "value" .
      }
    `;

    const parsed = parser.parse(query);
    expect(parser.isUpdateQuery(parsed)).toBe(true);
  });

  it("should distinguish UPDATE from SELECT", () => {
    const selectQuery = parser.parse("SELECT * WHERE { ?s ?p ?o }");
    const updateQuery = parser.parse("INSERT DATA { <http://example.org/s> <http://example.org/p> 'o' . }");

    expect(parser.isUpdateQuery(selectQuery)).toBe(false);
    expect(parser.isSelectQuery(selectQuery)).toBe(true);
    expect(parser.isUpdateQuery(updateQuery)).toBe(true);
    expect(parser.isSelectQuery(updateQuery)).toBe(false);
  });

  it("should identify INSERT DATA operation type", () => {
    const query = `INSERT DATA { <http://example.org/s> <http://example.org/p> 'o' . }`;
    const parsed = parser.parse(query);

    expect(parser.isUpdateQuery(parsed)).toBe(true);
    if (parser.isUpdateQuery(parsed)) {
      expect(parsed.updates).toHaveLength(1);
      expect(parser.isInsertDataOperation(parsed.updates[0])).toBe(true);
      expect(parser.isDeleteDataOperation(parsed.updates[0])).toBe(false);
    }
  });

  it("should identify DELETE DATA operation type", () => {
    const query = `DELETE DATA { <http://example.org/s> <http://example.org/p> 'o' . }`;
    const parsed = parser.parse(query);

    expect(parser.isUpdateQuery(parsed)).toBe(true);
    if (parser.isUpdateQuery(parsed)) {
      expect(parsed.updates).toHaveLength(1);
      expect(parser.isDeleteDataOperation(parsed.updates[0])).toBe(true);
      expect(parser.isInsertDataOperation(parsed.updates[0])).toBe(false);
    }
  });
});
