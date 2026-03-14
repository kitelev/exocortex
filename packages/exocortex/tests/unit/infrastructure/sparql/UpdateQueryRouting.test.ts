import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { UpdateExecutor } from "../../../../src/infrastructure/sparql/executors/UpdateExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import type { Update } from "../../../../src/infrastructure/sparql/SPARQLParser";

/**
 * Tests for UPDATE query routing — verifying that INSERT DATA and DELETE DATA
 * can be parsed and executed without going through AlgebraTranslator.
 *
 * This matches the CLI routing pattern where ast.type === "update" bypasses
 * the AlgebraTranslator and routes directly to UpdateExecutor.
 */
describe("UPDATE Query Routing (CLI pattern)", () => {
  let parser: SPARQLParser;
  let tripleStore: InMemoryTripleStore;

  beforeEach(() => {
    parser = new SPARQLParser();
    tripleStore = new InMemoryTripleStore();
  });

  it("should parse INSERT DATA and detect ast.type === 'update'", () => {
    const query = `
      INSERT DATA {
        <http://example.org/s> <http://example.org/p> "value" .
      }
    `;
    const ast = parser.parse(query);
    expect(ast.type).toBe("update");
  });

  it("should parse DELETE DATA and detect ast.type === 'update'", () => {
    const query = `
      DELETE DATA {
        <http://example.org/s> <http://example.org/p> "value" .
      }
    `;
    const ast = parser.parse(query);
    expect(ast.type).toBe("update");
  });

  it("should execute INSERT DATA via UpdateExecutor (bypassing AlgebraTranslator)", async () => {
    const query = `
      INSERT DATA {
        <http://example.org/s1> <http://example.org/p1> "hello" .
        <http://example.org/s2> <http://example.org/p2> "world" .
      }
    `;
    const ast = parser.parse(query);
    expect(ast.type).toBe("update");

    const executor = new UpdateExecutor(tripleStore);
    const results = await executor.execute(ast as Update);

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("insert");
    expect(results[0].inserted).toBe(2);
    expect(results[0].success).toBe(true);

    // Verify triples were added
    const triples = await tripleStore.match(
      new IRI("http://example.org/s1"),
      new IRI("http://example.org/p1")
    );
    expect(triples).toHaveLength(1);
  });

  it("should execute DELETE DATA via UpdateExecutor (bypassing AlgebraTranslator)", async () => {
    // First insert some data
    const insertQuery = `
      INSERT DATA {
        <http://example.org/s1> <http://example.org/p1> "hello" .
        <http://example.org/s2> <http://example.org/p2> "world" .
      }
    `;
    const insertAst = parser.parse(insertQuery) as Update;
    const insertExecutor = new UpdateExecutor(tripleStore);
    await insertExecutor.execute(insertAst);

    // Then delete one triple
    const deleteQuery = `
      DELETE DATA {
        <http://example.org/s1> <http://example.org/p1> "hello" .
      }
    `;
    const deleteAst = parser.parse(deleteQuery);
    expect(deleteAst.type).toBe("update");

    const deleteExecutor = new UpdateExecutor(tripleStore);
    const results = await deleteExecutor.execute(deleteAst as Update);

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("delete");
    expect(results[0].deleted).toBe(1);
    expect(results[0].success).toBe(true);

    // Verify only one triple remains
    const remaining = await tripleStore.match(
      new IRI("http://example.org/s1"),
      new IRI("http://example.org/p1")
    );
    expect(remaining).toHaveLength(0);

    const stillThere = await tripleStore.match(
      new IRI("http://example.org/s2"),
      new IRI("http://example.org/p2")
    );
    expect(stillThere).toHaveLength(1);
  });

  it("should NOT detect SELECT queries as updates", () => {
    const query = `SELECT ?s WHERE { ?s ?p ?o }`;
    const ast = parser.parse(query);
    expect(ast.type).toBe("query");
    expect(ast.type).not.toBe("update");
  });

  it("should NOT detect CONSTRUCT queries as updates", () => {
    const query = `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }`;
    const ast = parser.parse(query);
    expect(ast.type).toBe("query");
    expect(ast.type).not.toBe("update");
  });
});
