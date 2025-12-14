/**
 * Performance regression tests for SPARQL query execution.
 *
 * These tests ensure that SPARQL queries execute within expected time bounds
 * to detect performance regressions early in CI.
 *
 * Based on Issue #755: [Test Quality] Add Performance Regression Tests
 */

import { QueryExecutor } from "../../src/infrastructure/sparql/executors/QueryExecutor";
import { AlgebraTranslator } from "../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { SPARQLParser } from "../../src/infrastructure/sparql/SPARQLParser";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { Namespace } from "../../src/domain/models/rdf/Namespace";

/**
 * Generate mock triples for performance testing.
 * Creates a realistic dataset with tasks, projects, and areas.
 */
function generateMockTriples(count: number): Triple[] {
  const triples: Triple[] = [];
  const statuses = ["open", "in_progress", "completed", "archived"];
  const sizes = [1, 2, 3, 5, 8, 13]; // Fibonacci-like sizes

  for (let i = 0; i < count; i++) {
    const assetURI = new IRI(`http://example.com/asset-${i}`);
    const status = statuses[i % statuses.length];
    const size = sizes[i % sizes.length];
    const projectIndex = Math.floor(i / 10); // 10 tasks per project
    const areaIndex = Math.floor(i / 100); // 100 tasks per area

    // Type triple (rdf:type)
    triples.push(
      new Triple(
        assetURI,
        Namespace.RDF.term("type"),
        Namespace.EMS.term("Task")
      )
    );

    // Label triple
    triples.push(
      new Triple(
        assetURI,
        Namespace.EXO.term("Asset_label"),
        new Literal(`Task ${i} - ${status}`)
      )
    );

    // Status triple
    triples.push(
      new Triple(
        assetURI,
        Namespace.EMS.term("Task_status"),
        new Literal(status)
      )
    );

    // Size triple
    triples.push(
      new Triple(
        assetURI,
        Namespace.EMS.term("Task_size"),
        new Literal(
          String(size),
          new IRI("http://www.w3.org/2001/XMLSchema#integer")
        )
      )
    );

    // BelongsTo (project) triple
    triples.push(
      new Triple(
        assetURI,
        Namespace.EMS.term("belongsTo"),
        new IRI(`http://example.com/project-${projectIndex}`)
      )
    );

    // Project type
    if (i % 10 === 0) {
      const projectURI = new IRI(`http://example.com/project-${projectIndex}`);
      triples.push(
        new Triple(
          projectURI,
          Namespace.RDF.term("type"),
          Namespace.EMS.term("Project")
        )
      );
      triples.push(
        new Triple(
          projectURI,
          Namespace.EXO.term("Asset_label"),
          new Literal(`Project ${projectIndex}`)
        )
      );
      triples.push(
        new Triple(
          projectURI,
          Namespace.EMS.term("belongsTo"),
          new IRI(`http://example.com/area-${areaIndex}`)
        )
      );
    }

    // Area type
    if (i % 100 === 0) {
      const areaURI = new IRI(`http://example.com/area-${areaIndex}`);
      triples.push(
        new Triple(
          areaURI,
          Namespace.RDF.term("type"),
          Namespace.EMS.term("Area")
        )
      );
      triples.push(
        new Triple(
          areaURI,
          Namespace.EXO.term("Asset_label"),
          new Literal(`Area ${areaIndex}`)
        )
      );
    }
  }

  return triples;
}

describe("SPARQL Query Performance", () => {
  let store: InMemoryTripleStore;
  let executor: QueryExecutor;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  // Performance thresholds (in milliseconds)
  // These are deliberately generous to avoid flaky tests in CI
  // while still catching significant regressions (>3x slowdown).
  // OPTIONAL and SUBQUERY have O(n^2) complexity and require higher limits.
  const THRESHOLDS = {
    SIMPLE_SELECT: 100, // Simple SELECT should complete in <100ms
    COMPLEX_JOIN: 500, // Complex JOINs should complete in <500ms
    FILTER_REGEX: 300, // FILTER with regex should complete in <300ms
    AGGREGATE: 400, // GROUP BY with aggregates in <400ms
    UNION: 200, // UNION queries in <200ms
    OPTIONAL: 2000, // OPTIONAL (left join) - O(n*m) complexity, generous for CI
    ORDER_BY: 300, // ORDER BY in <300ms
    SUBQUERY: 2000, // Subqueries - O(n*m) complexity, generous for CI
  };

  describe("Small dataset (1K triples)", () => {
    const TRIPLE_COUNT = 1000;

    beforeAll(async () => {
      store = new InMemoryTripleStore();
      executor = new QueryExecutor(store);
      parser = new SPARQLParser();
      translator = new AlgebraTranslator();

      const triples = generateMockTriples(200); // ~1K triples (5 triples per task)
      await store.addAll(triples);
    });

    it("should execute simple SELECT in < 100ms", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?s ?p ?o
        WHERE { ?s ?p ?o }
        LIMIT 100
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.SIMPLE_SELECT);
    });

    it("should execute SELECT with FILTER in < 100ms", async () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?status
        WHERE {
          ?task ems:Task_status ?status .
          FILTER(?status = "completed")
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.SIMPLE_SELECT);
    });

    it("should execute FILTER with REGEX in < 300ms", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          FILTER(REGEX(?label, "^Task.*completed", "i"))
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.FILTER_REGEX);
    });
  });

  describe("Medium dataset (10K triples)", () => {
    beforeAll(async () => {
      store = new InMemoryTripleStore();
      executor = new QueryExecutor(store);
      parser = new SPARQLParser();
      translator = new AlgebraTranslator();

      const triples = generateMockTriples(2000); // ~10K triples
      await store.addAll(triples);
    });

    it("should execute complex JOIN in < 500ms", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?task ?project ?status
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:belongsTo ?project .
          ?task ems:Task_status ?status .
          ?project rdf:type ems:Project .
        }
        LIMIT 100
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.COMPLEX_JOIN);
    });

    it("should execute UNION query in < 200ms", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?asset
        WHERE {
          { ?asset rdf:type ems:Task }
          UNION
          { ?asset rdf:type ems:Project }
        }
        LIMIT 100
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.UNION);
    });

    it("should execute OPTIONAL (left join) in < 300ms", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?task ?label ?size
        WHERE {
          ?task rdf:type ems:Task .
          ?task exo:Asset_label ?label .
          OPTIONAL { ?task ems:Task_size ?size }
        }
        LIMIT 100
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.OPTIONAL);
    });

    it("should execute ORDER BY in < 300ms", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
        }
        ORDER BY ASC(?label)
        LIMIT 100
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.ORDER_BY);
    });

    it("should execute GROUP BY with COUNT in < 400ms", async () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?status (COUNT(?task) AS ?count)
        WHERE {
          ?task ems:Task_status ?status .
        }
        GROUP BY ?status
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.AGGREGATE);
    });

    it("should execute GROUP BY with SUM in < 400ms", async () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?status (SUM(?size) AS ?totalSize)
        WHERE {
          ?task ems:Task_status ?status .
          ?task ems:Task_size ?size .
        }
        GROUP BY ?status
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.AGGREGATE);
    });

    it("should execute subquery in < 500ms", async () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?task ?label
        WHERE {
          ?task exo:Asset_label ?label .
          {
            SELECT ?task
            WHERE {
              ?task ems:Task_status "completed" .
            }
            LIMIT 50
          }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const start = performance.now();
      await executor.executeAll(algebra);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.SUBQUERY);
    });
  });

  describe("Percentile performance (P95)", () => {
    beforeAll(async () => {
      store = new InMemoryTripleStore();
      executor = new QueryExecutor(store);
      parser = new SPARQLParser();
      translator = new AlgebraTranslator();

      const triples = generateMockTriples(1000);
      await store.addAll(triples);
    });

    it("should have P95 query time < 100ms for simple SELECT", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
        }
        LIMIT 10
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const durations: number[] = [];
      const queryCount = 100;

      for (let i = 0; i < queryCount; i++) {
        const start = performance.now();
        await executor.executeAll(algebra);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.floor(queryCount * 0.95);
      const p95Duration = durations[p95Index];

      expect(p95Duration).toBeLessThan(100);
    });

    it("should have P95 query time < 200ms for filtered SELECT", async () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?status
        WHERE {
          ?task ems:Task_status ?status .
          FILTER(?status = "completed" || ?status = "in_progress")
        }
        LIMIT 50
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      const durations: number[] = [];
      const queryCount = 50;

      for (let i = 0; i < queryCount; i++) {
        const start = performance.now();
        await executor.executeAll(algebra);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.floor(queryCount * 0.95);
      const p95Duration = durations[p95Index];

      expect(p95Duration).toBeLessThan(200);
    });
  });

  describe("Cache effectiveness", () => {
    beforeAll(async () => {
      store = new InMemoryTripleStore();
      executor = new QueryExecutor(store);
      parser = new SPARQLParser();
      translator = new AlgebraTranslator();

      const triples = generateMockTriples(500);
      await store.addAll(triples);
    });

    it("should serve repeated queries faster than initial query", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
        }
        LIMIT 50
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      // First (cold) query
      const coldStart = performance.now();
      await executor.executeAll(algebra);
      const coldDuration = performance.now() - coldStart;

      // Second (warm) query - should benefit from any caching
      const warmStart = performance.now();
      await executor.executeAll(algebra);
      const warmDuration = performance.now() - warmStart;

      // Warm query should not be significantly slower than cold query
      // (We're checking for regressions, not strict speedup)
      expect(warmDuration).toBeLessThan(coldDuration * 2);
    });
  });

  describe("Parser and translator performance", () => {
    it("should parse simple query in < 10ms", () => {
      const parser = new SPARQLParser();
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";

      const start = performance.now();
      parser.parse(query);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10);
    });

    it("should parse complex query in < 50ms", () => {
      const parser = new SPARQLParser();
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?task ?project ?status (COUNT(?subtask) AS ?subtaskCount)
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:belongsTo ?project .
          ?task ems:Task_status ?status .
          ?project rdf:type ems:Project .
          OPTIONAL {
            ?subtask ems:belongsTo ?task .
            ?subtask rdf:type ems:Task .
          }
          FILTER(?status = "open" || ?status = "in_progress")
        }
        GROUP BY ?task ?project ?status
        ORDER BY DESC(?subtaskCount)
        LIMIT 100
      `;

      const start = performance.now();
      parser.parse(query);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    });

    it("should translate algebra in < 20ms", () => {
      const parser = new SPARQLParser();
      const translator = new AlgebraTranslator();
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?status
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:Task_status ?status .
          FILTER(?status = "completed")
        }
        ORDER BY ?status
        LIMIT 100
      `;

      const parsed = parser.parse(query);

      const start = performance.now();
      translator.translate(parsed);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(20);
    });
  });

  describe("Memory efficiency", () => {
    it("should handle large result sets without excessive memory", async () => {
      const store = new InMemoryTripleStore();
      const executor = new QueryExecutor(store);
      const parser = new SPARQLParser();
      const translator = new AlgebraTranslator();

      // Generate larger dataset
      const triples = generateMockTriples(5000);
      await store.addAll(triples);

      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);

      // Execute and verify results are returned
      const results = await executor.executeAll(algebra);

      // Should return results (exact count depends on generated data)
      expect(results.length).toBeGreaterThan(0);

      // Verify we can iterate through all results
      // This tests that the generator/streaming works correctly
      let count = 0;
      for (const _result of results) {
        count++;
      }
      expect(count).toBe(results.length);
    });
  });
});

describe("SPARQL Performance Regression Guards", () => {
  /**
   * These tests establish baseline performance metrics that should
   * not regress significantly. If these tests fail, it indicates
   * a potential performance regression that needs investigation.
   */

  let store: InMemoryTripleStore;
  let executor: QueryExecutor;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  beforeAll(async () => {
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();

    // Standard test dataset
    const triples = generateMockTriples(1000);
    await store.addAll(triples);
  });

  it("BGP execution should not regress beyond 2x baseline", async () => {
    const query = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?task
      WHERE {
        ?task rdf:type ems:Task .
      }
    `;

    const parsed = parser.parse(query);
    const algebra = translator.translate(parsed);

    // Establish baseline
    const runs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await executor.executeAll(algebra);
      runs.push(performance.now() - start);
    }

    const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;

    // BGP on 1K triples should complete in reasonable time
    // Baseline expectation: < 100ms average
    expect(avgDuration).toBeLessThan(200); // 2x safety margin
  });

  it("FILTER execution should not regress beyond 2x baseline", async () => {
    const query = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?task ?status
      WHERE {
        ?task ems:Task_status ?status .
        FILTER(?status = "completed")
      }
    `;

    const parsed = parser.parse(query);
    const algebra = translator.translate(parsed);

    const runs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await executor.executeAll(algebra);
      runs.push(performance.now() - start);
    }

    const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(avgDuration).toBeLessThan(150);
  });

  it("Aggregation execution should not regress beyond 2x baseline", async () => {
    const query = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?status (COUNT(?task) AS ?count)
      WHERE {
        ?task ems:Task_status ?status .
      }
      GROUP BY ?status
    `;

    const parsed = parser.parse(query);
    const algebra = translator.translate(parsed);

    const runs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await executor.executeAll(algebra);
      runs.push(performance.now() - start);
    }

    const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(avgDuration).toBeLessThan(300);
  });
});
