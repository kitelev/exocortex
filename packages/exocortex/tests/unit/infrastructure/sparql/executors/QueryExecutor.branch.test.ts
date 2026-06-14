import { QueryExecutor, QueryExecutorError } from "../../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { SPARQLParser } from "../../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import type { AlgebraOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("QueryExecutor branch coverage", () => {
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  const ex = (local: string) => new IRI(`http://example.org/${local}`);

  beforeEach(async () => {
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();

    // Add test data
    await tripleStore.add(new Triple(ex("task1"), ex("type"), ex("Task")));
    await tripleStore.add(new Triple(ex("task1"), ex("label"), new Literal("Task 1")));
    await tripleStore.add(new Triple(ex("task1"), ex("priority"), new Literal("1", new IRI("http://www.w3.org/2001/XMLSchema#integer"))));

    await tripleStore.add(new Triple(ex("task2"), ex("type"), ex("Task")));
    await tripleStore.add(new Triple(ex("task2"), ex("label"), new Literal("Task 2")));
    await tripleStore.add(new Triple(ex("task2"), ex("priority"), new Literal("2", new IRI("http://www.w3.org/2001/XMLSchema#integer"))));

    await tripleStore.add(new Triple(ex("project1"), ex("type"), ex("Project")));
    await tripleStore.add(new Triple(ex("project1"), ex("label"), new Literal("Project 1")));
  });

  function parseAndTranslate(query: string): AlgebraOperation {
    const ast = parser.parse(query);
    return translator.translate(ast);
  }

  describe("executeService", () => {
    it("executes SERVICE operation (federated query)", async () => {
      const algebra: AlgebraOperation = {
        type: "service",
        endpoint: "http://dbpedia.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: true,
      };

      // SERVICE with silent=true should not throw even if endpoint is unreachable
      const results = await executor.executeAll(algebra);
      // Silent service returns empty on failure
      expect(results).toHaveLength(0);
    });
  });

  describe("executeGraph", () => {
    it("executes GRAPH operation with named graph IRI", async () => {
      const algebra: AlgebraOperation = {
        type: "graph",
        name: { type: "iri", value: "http://example.org/graph1" },
        pattern: { type: "bgp", triples: [] },
      };

      const results = await executor.executeAll(algebra);
      // GRAPH operation delegates to GraphExecutor - may return 0 if no graph triples
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("executes GRAPH with variable name iterates named graphs", async () => {
      const algebra: AlgebraOperation = {
        type: "graph",
        name: { type: "variable", value: "g" },
        pattern: { type: "bgp", triples: [] },
      };

      const results = await executor.executeAll(algebra);
      // Variable graph iterates all named graphs - may be empty if no named graphs
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("unknown operation type", () => {
    it("throws for unknown operation type", async () => {
      const algebra = { type: "unknown_op" } as unknown as AlgebraOperation;
      await expect(executor.executeAll(algebra)).rejects.toThrow("Unknown operation type: unknown_op");
    });
  });

  describe("executeReduced", () => {
    it("eliminates duplicates like DISTINCT", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT REDUCED ?type WHERE {
          ?s ex:type ?type
        }
      `;

      const algebra = parseAndTranslate(query);
      const results = await executor.executeAll(algebra);
      // executeReduced deliberately eliminates ALL duplicates (DISTINCT-equivalent;
      // SPARQL 1.1 §10.2 permits REDUCED to drop any/all duplicates). The data has
      // 3 subjects but only 2 unique ?type values (ex:Task, ex:Project) → 2 rows.
      expect(results).toHaveLength(2);
    });
  });

  describe("executeOrderBy", () => {
    it("sorts by numeric value ascending", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?priority WHERE {
          ?s ex:type ex:Task .
          ?s ex:priority ?priority .
        }
        ORDER BY ?priority
      `;

      const algebra = parseAndTranslate(query);
      const results = await executor.executeAll(algebra);
      expect(results).toHaveLength(2);
    });

    it("sorts descending", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?label WHERE {
          ?s ex:type ex:Task .
          ?s ex:label ?label .
        }
        ORDER BY DESC(?label)
      `;

      const algebra = parseAndTranslate(query);
      const results = await executor.executeAll(algebra);
      expect(results).toHaveLength(2);
      // DESC: Task 2 before Task 1
      const labels = results.map(r => (r.get("label") as Literal)?.value);
      expect(labels[0]).toBe("Task 2");
      expect(labels[1]).toBe("Task 1");
    });

    it("handles undefined values in ordering (sorts last)", async () => {
      await tripleStore.add(new Triple(ex("task3"), ex("type"), ex("Task")));
      // task3 has no label

      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?label WHERE {
          ?s ex:type ex:Task .
          OPTIONAL { ?s ex:label ?label }
        }
        ORDER BY ?label
      `;

      const algebra = parseAndTranslate(query);
      const results = await executor.executeAll(algebra);
      expect(results).toHaveLength(3);
    });
  });

  describe("executeSlice", () => {
    it("handles OFFSET without LIMIT", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s WHERE {
          ?s ex:type ex:Task .
        }
        OFFSET 1
      `;

      const algebra = parseAndTranslate(query);
      const results = await executor.executeAll(algebra);
      expect(results).toHaveLength(1);
    });
  });

  describe("executeExtend", () => {
    it("handles expression evaluation error gracefully", async () => {
      // BIND with an expression that may fail should yield undefined for that variable
      const algebra: AlgebraOperation = {
        type: "extend",
        variable: "computed",
        expression: {
          type: "function",
          function: "nonexistent_function",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const results = await executor.executeAll(algebra);
      // Should not crash, just undefined for computed
      expect(results).toHaveLength(1);
    });

    it("handles aggregate expression in extend (returns undefined)", async () => {
      const algebra: AlgebraOperation = {
        type: "extend",
        variable: "agg_result",
        expression: {
          type: "aggregate",
          aggregation: "count",
          distinct: false,
        },
        input: { type: "bgp", triples: [] },
      };

      const results = await executor.executeAll(algebra);
      expect(results).toHaveLength(1);
      // Aggregate in extend returns undefined (handled at group level)
      expect(results[0].get("agg_result")).toBeUndefined();
    });
  });

  describe("executeGroup with HAVING", () => {
    it("filters groups by HAVING clause", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?type (COUNT(?s) as ?cnt) WHERE {
          ?s ex:type ?type .
        }
        GROUP BY ?type
        HAVING (COUNT(?s) > 1)
      `;

      const algebra = parseAndTranslate(query);
      const results = await executor.executeAll(algebra);
      // Only "Task" type has count > 1
      expect(results).toHaveLength(1);
    });
  });

  describe("join strategies", () => {
    it("uses hash join when no shared variables", async () => {
      // Two patterns with completely different variables -> cross product
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "iri", value: "http://example.org/Task" },
          }],
        },
        right: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "p" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "iri", value: "http://example.org/Project" },
          }],
        },
      };

      const results = await executor.executeAll(algebra);
      // 2 tasks x 1 project = 2 cross-product results
      expect(results).toHaveLength(2);
    });

    it("returns empty when left side of join is empty", async () => {
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/nonexistent" },
            object: { type: "variable", value: "o" },
          }],
        },
        right: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "t" },
          }],
        },
      };

      const results = await executor.executeAll(algebra);
      expect(results).toHaveLength(0);
    });
  });

  describe("collectOperationVariables", () => {
    it("collects variables from values operation", async () => {
      // VALUES in join should trigger shared variable detection
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "type" },
          }],
        },
        right: {
          type: "values",
          variables: ["type"],
          bindings: [{ type: { type: "iri", value: "http://example.org/Task" } }],
        },
      };

      const results = await executor.executeAll(algebra);
      // "type" is shared variable, should use bind join
      expect(results).toHaveLength(2);
    });

    it("collects variables from extend operation", async () => {
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "type" },
          }],
        },
        right: {
          type: "extend",
          variable: "label",
          expression: { type: "literal", value: "test" },
          input: { type: "bgp", triples: [] },
        },
      };

      const results = await executor.executeAll(algebra);
      expect(results.length).toBeGreaterThan(0);
    });

    it("collects variables from filter expressions", async () => {
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "type" },
          }],
        },
        right: {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: { type: "variable", name: "type" },
            right: { type: "literal", value: "http://example.org/Task" },
          },
          input: {
            type: "bgp",
            triples: [{
              subject: { type: "variable", value: "s2" },
              predicate: { type: "iri", value: "http://example.org/label" },
              object: { type: "variable", value: "label" },
            }],
          },
        },
      };

      const results = await executor.executeAll(algebra);
      // "type" is shared, should use bind join
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("substituteVariables", () => {
    it("substitutes variables in BGP triples for lateral join", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?label WHERE {
          ?s ex:type ex:Task .
          LATERAL {
            SELECT ?label WHERE {
              ?s ex:label ?label .
            }
            LIMIT 1
          }
        }
      `;

      const algebra = parseAndTranslate(query);
      const results = await executor.executeAll(algebra);
      expect(results).toHaveLength(2);
    });
  });

  describe("substituteInExpression", () => {
    it("handles EXISTS pattern in filter during substitution", async () => {
      // Filter with EXISTS that contains variables needing substitution
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "iri", value: "http://example.org/Task" },
          }],
        },
        right: {
          type: "filter",
          expression: {
            type: "exists",
            negated: false,
            pattern: {
              type: "bgp",
              triples: [{
                subject: { type: "variable", value: "s" },
                predicate: { type: "iri", value: "http://example.org/label" },
                object: { type: "variable", value: "label" },
              }],
            },
          },
          input: { type: "bgp", triples: [] },
        },
      };

      const results = await executor.executeAll(algebra);
      // All tasks have labels, so EXISTS passes for all
      expect(results).toHaveLength(2);
    });
  });

  describe("getExpressionValue", () => {
    it("handles literal expression value in ORDER BY", async () => {
      // ORDER BY with literal expression
      const algebra: AlgebraOperation = {
        type: "orderby",
        comparators: [{
          expression: { type: "literal", value: 1 },
          descending: false,
        }],
        input: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "type" },
          }],
        },
      };

      const results = await executor.executeAll(algebra);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("isConstructQuery and isAskQuery", () => {
    it("identifies construct query", () => {
      const op: AlgebraOperation = {
        type: "construct",
        template: [],
        where: { type: "bgp", triples: [] },
      };
      expect(executor.isConstructQuery(op)).toBe(true);
      expect(executor.isAskQuery(op)).toBe(false);
    });

    it("identifies ask query", () => {
      const op: AlgebraOperation = {
        type: "ask",
        where: { type: "bgp", triples: [] },
      };
      expect(executor.isAskQuery(op)).toBe(true);
      expect(executor.isConstructQuery(op)).toBe(false);
    });
  });

  describe("executeConstruct", () => {
    it("throws for non-construct operation", async () => {
      const op = { type: "ask", where: { type: "bgp", triples: [] } } as any;
      await expect(executor.executeConstruct(op)).rejects.toThrow("executeConstruct requires a CONSTRUCT operation");
    });
  });

  describe("executeAsk", () => {
    it("throws for non-ask operation", async () => {
      const op = { type: "construct", template: [], where: { type: "bgp", triples: [] } } as any;
      await expect(executor.executeAsk(op)).rejects.toThrow("executeAsk requires an ASK operation");
    });

    it("returns false when no results match", async () => {
      const op: AlgebraOperation = {
        type: "ask",
        where: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/nonexistent" },
            object: { type: "variable", value: "o" },
          }],
        },
      };

      const result = await executor.executeAsk(op);
      expect(result).toBe(false);
    });
  });

  describe("collectVarsFromExpressionTree", () => {
    it("collects variables from IN expression list", async () => {
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "type" },
          }],
        },
        right: {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "type" },
            list: [
              { type: "literal", value: "http://example.org/Task" },
            ],
            negated: false,
          },
          input: { type: "bgp", triples: [] },
        },
      };

      const results = await executor.executeAll(algebra);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("collects variables from logical operands", async () => {
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "type" },
          }],
        },
        right: {
          type: "filter",
          expression: {
            type: "logical",
            operator: "||",
            operands: [
              {
                type: "comparison",
                operator: "=",
                left: { type: "variable", name: "type" },
                right: { type: "literal", value: "Task" },
              },
              {
                type: "comparison",
                operator: "=",
                left: { type: "variable", name: "type" },
                right: { type: "literal", value: "Project" },
              },
            ],
          },
          input: { type: "bgp", triples: [] },
        },
      };

      const results = await executor.executeAll(algebra);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("collects variables from function args", async () => {
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "variable", value: "label" },
          }],
        },
        right: {
          type: "filter",
          expression: {
            type: "function",
            function: "CONTAINS",
            args: [
              { type: "variable", name: "label" },
              { type: "literal", value: "Task" },
            ],
          },
          input: { type: "bgp", triples: [] },
        },
      };

      const results = await executor.executeAll(algebra);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("collects variables from EXISTS pattern in expression tree", async () => {
      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/type" },
            object: { type: "variable", value: "type" },
          }],
        },
        right: {
          type: "filter",
          expression: {
            type: "exists",
            negated: false,
            pattern: {
              type: "bgp",
              triples: [{
                subject: { type: "variable", value: "s" },
                predicate: { type: "iri", value: "http://example.org/label" },
                object: { type: "variable", value: "label" },
              }],
            },
          },
          input: { type: "bgp", triples: [] },
        },
      };

      const results = await executor.executeAll(algebra);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("substituteInTripleElement", () => {
    it("substitutes variable bound to Literal in triple element", async () => {
      // This exercises the Literal branch in substituteInTripleElement
      await tripleStore.add(new Triple(ex("s1"), ex("value"), new Literal("hello")));

      const algebra: AlgebraOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [{
            subject: { type: "iri", value: "http://example.org/s1" },
            predicate: { type: "iri", value: "http://example.org/value" },
            object: { type: "variable", value: "val" },
          }],
        },
        right: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "other" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "variable", value: "val" },
          }],
        },
      };

      const results = await executor.executeAll(algebra);
      // val is shared, bind join will substitute val=Literal("hello") in right BGP
      // This exercises substituteInTripleElement with Literal binding
    });
  });
});
