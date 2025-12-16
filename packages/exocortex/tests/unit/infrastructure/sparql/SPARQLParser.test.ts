import { SPARQLParser, SPARQLParseError, SelectQuery } from "../../../../src/infrastructure/sparql/SPARQLParser";

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

    describe("SPARQL 1.2 DESCRIBE options", () => {
      it("parses DESCRIBE with DEPTH option", () => {
        const query = `
          DESCRIBE ?task DEPTH 2
          WHERE {
            ?task a <http://example.org/Task> .
          }
        `;
        const result = parser.parseWithOptions(query);
        expect(parser.isDescribeQuery(result.query)).toBe(true);
        expect(result.describeOptions?.depth).toBe(2);
      });

      it("parses DESCRIBE with SYMMETRIC option", () => {
        const query = `
          DESCRIBE ?task SYMMETRIC
          WHERE {
            ?task a <http://example.org/Task> .
          }
        `;
        const result = parser.parseWithOptions(query);
        expect(parser.isDescribeQuery(result.query)).toBe(true);
        expect(result.describeOptions?.symmetric).toBe(true);
      });

      it("parses DESCRIBE with both DEPTH and SYMMETRIC options", () => {
        const query = `
          DESCRIBE ?task DEPTH 3 SYMMETRIC
          WHERE {
            ?task a <http://example.org/Task> .
          }
        `;
        const result = parser.parseWithOptions(query);
        expect(parser.isDescribeQuery(result.query)).toBe(true);
        expect(result.describeOptions?.depth).toBe(3);
        expect(result.describeOptions?.symmetric).toBe(true);
      });

      it("returns undefined options for DESCRIBE without options", () => {
        const query = `
          DESCRIBE ?task
          WHERE {
            ?task a <http://example.org/Task> .
          }
        `;
        const result = parser.parseWithOptions(query);
        expect(parser.isDescribeQuery(result.query)).toBe(true);
        expect(result.describeOptions).toBeUndefined();
      });

      it("attaches options to parsed query AST", () => {
        const query = "DESCRIBE ?x DEPTH 2 SYMMETRIC";
        const ast = parser.parse(query) as any;
        expect(ast.describeOptions?.depth).toBe(2);
        expect(ast.describeOptions?.symmetric).toBe(true);
      });

      it("hasDescribeOptions returns true for query with DEPTH", () => {
        const query = "DESCRIBE ?x DEPTH 2";
        expect(parser.hasDescribeOptions(query)).toBe(true);
      });

      it("hasDescribeOptions returns true for query with SYMMETRIC", () => {
        const query = "DESCRIBE ?x SYMMETRIC";
        expect(parser.hasDescribeOptions(query)).toBe(true);
      });

      it("hasDescribeOptions returns false for query without options", () => {
        const query = "DESCRIBE ?x WHERE { ?x a :Person }";
        expect(parser.hasDescribeOptions(query)).toBe(false);
      });

      it("getLastDescribeOptions returns options after parse", () => {
        const query = "DESCRIBE ?x DEPTH 5";
        parser.parse(query);
        expect(parser.getLastDescribeOptions()?.depth).toBe(5);
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

  describe("PREFIX* detection (hasPrefixStar)", () => {
    it("detects PREFIX* at start of query", () => {
      const query = "PREFIX* <http://schema.org/> SELECT ?s WHERE { ?s ?p ?o }";
      expect(parser.hasPrefixStar(query)).toBe(true);
    });

    it("detects PREFIX * with space", () => {
      const query = "PREFIX * <http://schema.org/> SELECT ?s WHERE { ?s ?p ?o }";
      expect(parser.hasPrefixStar(query)).toBe(true);
    });

    it("detects prefix* (lowercase)", () => {
      const query = "prefix* <http://schema.org/> SELECT ?s WHERE { ?s ?p ?o }";
      expect(parser.hasPrefixStar(query)).toBe(true);
    });

    it("returns false for regular PREFIX", () => {
      const query = "PREFIX schema: <http://schema.org/> SELECT ?s WHERE { ?s ?p ?o }";
      expect(parser.hasPrefixStar(query)).toBe(false);
    });

    it("returns false for query without PREFIX", () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      expect(parser.hasPrefixStar(query)).toBe(false);
    });
  });

  describe("PREFIX* async parsing (parseAsync)", () => {
    it("parses query with PREFIX* using schema.org", async () => {
      const query = `
        PREFIX* <http://schema.org/>
        SELECT ?s WHERE { ?s schema:name "Test" }
      `;

      const ast = await parser.parseAsync(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("parses query with multiple PREFIX* declarations", async () => {
      const query = `
        PREFIX* <http://schema.org/>
        PREFIX* <http://xmlns.com/foaf/0.1/>
        SELECT ?s WHERE { ?s schema:name ?name . ?s foaf:knows ?friend }
      `;

      const ast = await parser.parseAsync(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("parses query without PREFIX* (backward compatible)", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name WHERE { ?person foaf:name ?name }
      `;

      const ast = await parser.parseAsync(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("supports CASE WHEN combined with PREFIX*", async () => {
      const query = `
        PREFIX* <http://schema.org/>
        SELECT ?s (
          CASE
            WHEN ?price > 100 THEN "expensive"
            ELSE "cheap"
          END AS ?category
        )
        WHERE { ?s schema:price ?price }
      `;

      const ast = await parser.parseAsync(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("throws SPARQLParseError for malformed PREFIX*", async () => {
      const query = `
        PREFIX* <http://unclosed
        SELECT ?s WHERE { ?s ?p ?o }
      `;

      await expect(parser.parseAsync(query)).rejects.toThrow("PREFIX* transformation error");
    });

    it("includes resolved prefixes in parsed AST", async () => {
      const query = `
        PREFIX* <http://schema.org/>
        SELECT ?s WHERE { ?s schema:name "Test" }
      `;

      const ast = await parser.parseAsync(query);

      // Check that prefixes are included in the parsed query
      if ("prefixes" in ast) {
        expect(ast.prefixes).toHaveProperty("schema");
      }
    });
  });

  describe("Annotation syntax (SPARQL 1.2)", () => {
    describe("parsing", () => {
      it("parses simple annotation syntax {| ... |}", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?doc WHERE {
            ?s :knows ?o {| :source ?doc |} .
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("parses annotation with multiple predicates using semicolon", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?doc ?conf WHERE {
            ?s :knows ?o {| :source ?doc ; :confidence ?conf |} .
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("parses annotation with literal values", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o WHERE {
            ?s :knows ?o {| :certainty 0.95 |} .
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("parses annotation with IRI values", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o WHERE {
            ?s :knows ?o {| :source :Wikipedia |} .
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("parses multiple annotated triple patterns", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o1 ?o2 ?doc1 ?doc2 WHERE {
            ?s :knows ?o1 {| :source ?doc1 |} .
            ?s :likes ?o2 {| :source ?doc2 |} .
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("parses annotation on triple with blank node subject", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?o ?doc WHERE {
            _:b1 :knows ?o {| :source ?doc |} .
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });
    });

    describe("expansion to quoted triples", () => {
      it("expands annotation to base triple plus quoted triple pattern", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?doc WHERE {
            ?s :knows ?o {| :source ?doc |} .
          }
        `;

        const ast = parser.parse(query) as SelectQuery;

        // The BGP should contain:
        // 1. The base triple: ?s :knows ?o
        // 2. The annotation triple: <<( ?s :knows ?o )>> :source ?doc
        expect(ast.where).toBeDefined();
        expect(ast.where!.length).toBeGreaterThan(0);

        const bgp = ast.where![0] as { type: string; triples: any[] };
        expect(bgp.type).toBe("bgp");
        expect(bgp.triples.length).toBe(2);

        // First triple: base triple
        const baseTriple = bgp.triples[0];
        expect(baseTriple.subject.termType).toBe("Variable");
        expect(baseTriple.subject.value).toBe("s");
        expect(baseTriple.predicate.termType).toBe("NamedNode");
        expect(baseTriple.predicate.value).toBe("http://example.org/knows");
        expect(baseTriple.object.termType).toBe("Variable");
        expect(baseTriple.object.value).toBe("o");

        // Second triple: annotation with quoted triple as subject
        const annotationTriple = bgp.triples[1];
        expect(annotationTriple.subject.termType).toBe("Quad");
        expect(annotationTriple.predicate.termType).toBe("NamedNode");
        expect(annotationTriple.predicate.value).toBe("http://example.org/source");
        expect(annotationTriple.object.termType).toBe("Variable");
        expect(annotationTriple.object.value).toBe("doc");
      });

      it("expands multiple annotations to multiple quoted triple patterns", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?doc ?conf WHERE {
            ?s :knows ?o {| :source ?doc ; :confidence ?conf |} .
          }
        `;

        const ast = parser.parse(query) as SelectQuery;

        const bgp = ast.where![0] as { type: string; triples: any[] };
        expect(bgp.type).toBe("bgp");
        // Should have: base triple + source annotation + confidence annotation = 3 triples
        expect(bgp.triples.length).toBe(3);

        // All annotation triples should have the same quoted triple as subject
        const quotedSubject1 = bgp.triples[1].subject;
        const quotedSubject2 = bgp.triples[2].subject;
        expect(quotedSubject1.termType).toBe("Quad");
        expect(quotedSubject2.termType).toBe("Quad");

        // Both quoted triples should reference the same base triple
        expect(quotedSubject1.subject.value).toBe("s");
        expect(quotedSubject2.subject.value).toBe("s");
        expect(quotedSubject1.predicate.value).toBe("http://example.org/knows");
        expect(quotedSubject2.predicate.value).toBe("http://example.org/knows");
        expect(quotedSubject1.object.value).toBe("o");
        expect(quotedSubject2.object.value).toBe("o");
      });
    });

    describe("round-trip serialization", () => {
      it("serializes annotation back to valid SPARQL (quoted triple syntax)", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?doc WHERE {
            ?s :knows ?o {| :source ?doc |} .
          }
        `;

        const ast = parser.parse(query);
        const serialized = parser.toString(ast);
        // Should be re-parseable
        const reparsed = parser.parse(serialized);
        expect(parser.isSelectQuery(reparsed)).toBe(true);
      });

      it("serializes multiple annotations correctly", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?doc ?conf WHERE {
            ?s :knows ?o {| :source ?doc ; :confidence ?conf |} .
          }
        `;

        const ast = parser.parse(query);
        const serialized = parser.toString(ast);
        const reparsed = parser.parse(serialized);
        expect(parser.isSelectQuery(reparsed)).toBe(true);
      });
    });

    describe("combined with other SPARQL features", () => {
      it("works with FILTER on annotated triples", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?confidence WHERE {
            ?s :knows ?o {| :confidence ?confidence |} .
            FILTER(?confidence > 0.8)
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("works with OPTIONAL containing annotated triples", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?doc WHERE {
            ?s :knows ?o .
            OPTIONAL {
              ?s :likes ?x {| :source ?doc |} .
            }
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("works with ORDER BY on annotation values", () => {
        const query = `
          PREFIX : <http://example.org/>
          SELECT ?s ?o ?confidence WHERE {
            ?s :knows ?o {| :confidence ?confidence |} .
          }
          ORDER BY DESC(?confidence)
        `;

        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });

      it("works in CONSTRUCT queries", () => {
        const query = `
          PREFIX : <http://example.org/>
          CONSTRUCT {
            ?s :trustedKnowledge ?o .
          }
          WHERE {
            ?s :knows ?o {| :confidence ?conf |} .
            FILTER(?conf > 0.9)
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isConstructQuery(ast)).toBe(true);
      });

      it("works in ASK queries", () => {
        const query = `
          PREFIX : <http://example.org/>
          ASK {
            :Alice :knows :Bob {| :source :Wikipedia |} .
          }
        `;

        const ast = parser.parse(query);
        expect(parser.isAskQuery(ast)).toBe(true);
      });

      it("works with PREFIX* and annotations combined", async () => {
        const query = `
          PREFIX* <http://schema.org/>
          PREFIX : <http://example.org/>
          SELECT ?s ?name ?source WHERE {
            ?s schema:name ?name {| :source ?source |} .
          }
        `;

        const ast = await parser.parseAsync(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      });
    });
  });
});
