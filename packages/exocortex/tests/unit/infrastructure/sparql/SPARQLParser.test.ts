import { SPARQLParser, SPARQLParseError, SelectQuery, ConstructQuery } from "../../../../src/infrastructure/sparql/SPARQLParser";

describe("SPARQLParser", () => {
  let parser: SPARQLParser;

  beforeEach(() => {
    parser = new SPARQLParser();
  });

  describe("SELECT queries", () => {
    const selectQueries = [
      {
        name: "simple SELECT query",
        query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o }",
      },
      {
        name: "SELECT * query",
        query: "SELECT * WHERE { ?s ?p ?o }",
      },
      {
        name: "SELECT with PREFIX declarations",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?task ?label
          WHERE {
            ?task rdf:type ems:Task .
            ?task <http://example.org/label> ?label .
          }
        `,
      },
      {
        name: "SELECT with FILTER regex",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?task ?label
          WHERE {
            ?task rdf:type ems:Task .
            ?task <http://example.org/label> ?label .
            FILTER(regex(?label, "bug", "i"))
          }
        `,
      },
      {
        name: "SELECT with FILTER comparison",
        query: `
          SELECT ?task ?effort
          WHERE {
            ?task <http://example.org/effort> ?effort .
            FILTER(?effort > 60)
          }
        `,
      },
      {
        name: "SELECT with FILTER logical operators",
        query: `
          SELECT ?task
          WHERE {
            ?task <http://example.org/effort> ?effort .
            ?task <http://example.org/status> ?status .
            FILTER(?effort > 60 && ?status = "Done")
          }
        `,
      },
      {
        name: "SELECT with OPTIONAL",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?task ?label ?priority
          WHERE {
            ?task rdf:type ems:Task .
            ?task <http://example.org/label> ?label .
            OPTIONAL { ?task <http://example.org/priority> ?priority }
          }
        `,
      },
      {
        name: "SELECT with UNION",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?asset
          WHERE {
            { ?asset rdf:type ems:Task }
            UNION
            { ?asset rdf:type ems:Project }
          }
        `,
      },
      {
        name: "SELECT with ORDER BY ASC",
        query: `
          SELECT ?task ?effort
          WHERE {
            ?task <http://example.org/effort> ?effort .
          }
          ORDER BY ASC(?effort)
        `,
      },
      {
        name: "SELECT with ORDER BY DESC",
        query: `
          SELECT ?task ?effort
          WHERE {
            ?task <http://example.org/effort> ?effort .
          }
          ORDER BY DESC(?effort)
        `,
      },
      {
        name: "SELECT with LIMIT",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?task WHERE { ?task rdf:type ems:Task } LIMIT 10
        `,
      },
      {
        name: "SELECT with LIMIT and OFFSET",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?task WHERE { ?task rdf:type ems:Task } LIMIT 10 OFFSET 20
        `,
      },
      {
        name: "SELECT DISTINCT",
        query: "SELECT DISTINCT ?status WHERE { ?task <http://example.org/status> ?status }",
      },
      {
        name: "SELECT REDUCED",
        query: "SELECT REDUCED ?status WHERE { ?task <http://example.org/status> ?status }",
      },
      {
        name: "SELECT with nested graph patterns",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?task ?label
          WHERE {
            {
              SELECT ?task WHERE { ?task rdf:type ems:Task }
            }
            ?task <http://example.org/label> ?label .
          }
        `,
      },
      {
        name: "SELECT with BIND",
        query: `
          SELECT ?task ?fullLabel
          WHERE {
            ?task <http://example.org/label> ?label .
            BIND(CONCAT("Task: ", ?label) AS ?fullLabel)
          }
        `,
      },
      {
        name: "SELECT with VALUES",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          SELECT ?task
          WHERE {
            ?task rdf:type ?type .
            VALUES ?type { ems:Task ems:Project }
          }
        `,
      },
      {
        name: "SELECT with string literal",
        query: 'SELECT ?task WHERE { ?task <http://example.org/label> "Important Task" }',
      },
      {
        name: "SELECT with integer literal",
        query: "SELECT ?task WHERE { ?task <http://example.org/effort> 60 }",
      },
      {
        name: "SELECT with boolean literal",
        query: "SELECT ?task WHERE { ?task <http://example.org/completed> true }",
      },
      {
        name: "SELECT with typed literal",
        query: 'SELECT ?task WHERE { ?task <http://example.org/effort> "60"^^<http://www.w3.org/2001/XMLSchema#integer> }',
      },
      {
        name: "SELECT with language tag",
        query: 'SELECT ?task WHERE { ?task <http://example.org/label> "Важная задача"@ru }',
      },
      {
        name: "SELECT with blank nodes",
        query: `
          SELECT ?task
          WHERE {
            ?task <http://example.org/hasSubtask> _:b1 .
            _:b1 <http://example.org/label> ?sublabel .
          }
        `,
      },
    ];

    selectQueries.forEach(({ name, query }) => {
      it(`parses ${name}`, () => {
        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
        expect(parser.getQueryType(ast)).toBe("SELECT");
      });
    });
  });

  describe("CONSTRUCT queries", () => {
    const constructQueries = [
      {
        name: "simple CONSTRUCT query",
        query: `
          CONSTRUCT {
            ?task <http://example.org/hasLabel> ?label .
          }
          WHERE {
            ?task <http://example.org/label> ?label .
          }
        `,
      },
      {
        name: "CONSTRUCT with PREFIX",
        query: `
          PREFIX ex: <http://example.org/>
          CONSTRUCT {
            ?task ex:hasLabel ?label .
          }
          WHERE {
            ?task ex:label ?label .
          }
        `,
      },
      {
        name: "CONSTRUCT with complex template",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX ex: <http://example.org/>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          CONSTRUCT {
            ?task rdf:type ex:EnhancedTask .
            ?task ex:label ?label .
            ?task ex:effort ?effort .
          }
          WHERE {
            ?task rdf:type ems:Task .
            ?task ex:label ?label .
            ?task ex:effort ?effort .
          }
        `,
      },
      {
        name: "CONSTRUCT with FILTER",
        query: `
          PREFIX ex: <http://example.org/>
          CONSTRUCT {
            ?task ex:isLongRunning true .
          }
          WHERE {
            ?task ex:effort ?effort .
            FILTER(?effort > 120)
          }
        `,
      },
    ];

    constructQueries.forEach(({ name, query }) => {
      it(`parses ${name}`, () => {
        const ast = parser.parse(query);
        expect(parser.isConstructQuery(ast)).toBe(true);
        expect(parser.getQueryType(ast)).toBe("CONSTRUCT");
      });
    });
  });

  describe("ASK queries", () => {
    const askQueries = [
      {
        name: "simple ASK query",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          ASK {
            ?task rdf:type ems:Task .
          }
        `,
      },
      {
        name: "ASK with FILTER",
        query: `
          ASK {
            ?task <http://example.org/effort> ?effort .
            FILTER(?effort > 180)
          }
        `,
      },
    ];

    askQueries.forEach(({ name, query }) => {
      it(`parses ${name}`, () => {
        const ast = parser.parse(query);
        expect(parser.isAskQuery(ast)).toBe(true);
        expect(parser.getQueryType(ast)).toBe("ASK");
      });
    });
  });

  describe("DESCRIBE queries", () => {
    const describeQueries = [
      {
        name: "simple DESCRIBE query",
        query: `
          PREFIX ems: <https://exocortex.my/ontology/ems#>
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          DESCRIBE ?task
          WHERE {
            ?task rdf:type ems:Task .
          }
        `,
      },
      {
        name: "DESCRIBE with IRI",
        query: "DESCRIBE <http://example.org/task/123>",
      },
      {
        name: "DESCRIBE with multiple variables",
        query: `
          DESCRIBE ?task ?project
          WHERE {
            ?task <http://example.org/parent> ?project .
          }
        `,
      },
    ];

    describeQueries.forEach(({ name, query }) => {
      it(`parses ${name}`, () => {
        const ast = parser.parse(query);
        expect(parser.isDescribeQuery(ast)).toBe(true);
        expect(parser.getQueryType(ast)).toBe("DESCRIBE");
      });
    });
  });

  describe("Error handling", () => {
    it("throws SPARQLParseError for syntax error with line/column", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task>
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
      try {
        parser.parse(query);
      } catch (error) {
        expect(error).toBeInstanceOf(SPARQLParseError);
        const parseError = error as SPARQLParseError;
        expect(parseError.message).toContain("SPARQL syntax error");
      }
    });

    it("throws SPARQLParseError for invalid query type", () => {
      const query = "INVALID ?task WHERE { ?task ?p ?o }";
      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("throws SPARQLParseError for incomplete query", () => {
      const query = "SELECT ?task";
      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("throws SPARQLParseError for malformed FILTER", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task ?p ?o .
          FILTER()
        }
      `;
      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Round-trip serialization", () => {
    it("serializes and re-parses SELECT query", () => {
      const original = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task <http://example.org/label> ?label .
        }
        LIMIT 10
      `;

      const ast = parser.parse(original);
      const serialized = parser.toString(ast);
      const reparsed = parser.parse(serialized);

      expect(parser.isSelectQuery(reparsed)).toBe(true);
      expect(parser.getQueryType(reparsed)).toBe("SELECT");
    });

    it("serializes and re-parses CONSTRUCT query", () => {
      const original = `
        CONSTRUCT {
          ?s ?p ?o .
        }
        WHERE {
          ?s ?p ?o .
        }
      `;

      const ast = parser.parse(original);
      const serialized = parser.toString(ast);
      const reparsed = parser.parse(serialized);

      expect(parser.isConstructQuery(reparsed)).toBe(true);
      expect(parser.getQueryType(reparsed)).toBe("CONSTRUCT");
    });

    it("serializes and re-parses complex query", () => {
      const original = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT DISTINCT ?task ?effort
        WHERE {
          ?task rdf:type ems:Task .
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
        ORDER BY DESC(?effort)
        LIMIT 20
        OFFSET 10
      `;

      const ast = parser.parse(original);
      const serialized = parser.toString(ast);
      const reparsed = parser.parse(serialized);

      expect(parser.isSelectQuery(reparsed)).toBe(true);
      expect(parser.getQueryType(reparsed)).toBe("SELECT");
      expect((reparsed as SelectQuery).distinct).toBe(true);
      expect((reparsed as SelectQuery).limit).toBe(20);
      expect((reparsed as SelectQuery).offset).toBe(10);
    });
  });

  describe("Performance", () => {
    it("parses simple query in <10ms", () => {
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";

      const start = performance.now();
      parser.parse(query);
      const end = performance.now();

      expect(end - start).toBeLessThan(10);
    });

    it("parses medium complexity query in <10ms", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?task ?label ?effort
        WHERE {
          ?task rdf:type ems:Task .
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
        ORDER BY DESC(?effort)
        LIMIT 10
      `;

      const start = performance.now();
      parser.parse(query);
      const end = performance.now();

      expect(end - start).toBeLessThan(10);
    });
  });

  describe("Query type detection", () => {
    it("correctly identifies SELECT query type", () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      expect(parser.getQueryType(ast)).toBe("SELECT");
    });

    it("correctly identifies CONSTRUCT query type", () => {
      const query = "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      expect(parser.getQueryType(ast)).toBe("CONSTRUCT");
    });

    it("correctly identifies ASK query type", () => {
      const query = "ASK { ?s ?p ?o }";
      const ast = parser.parse(query);
      expect(parser.getQueryType(ast)).toBe("ASK");
    });

    it("correctly identifies DESCRIBE query type", () => {
      const query = "DESCRIBE ?s WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      expect(parser.getQueryType(ast)).toBe("DESCRIBE");
    });
  });
});
