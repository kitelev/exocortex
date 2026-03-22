import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { AlgebraSerializer } from "../../../../src/infrastructure/sparql/algebra/AlgebraSerializer";

describe("AlgebraSerializer", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let optimizer: AlgebraOptimizer;
  let serializer: AlgebraSerializer;

  beforeEach(() => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    optimizer = new AlgebraOptimizer();
    serializer = new AlgebraSerializer();
  });

  describe("toString", () => {
    it("serializes BGP operation", () => {
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Project");
      expect(str).toContain("BGP");
      expect(str).toContain("?s");
      expect(str).toContain("?p");
      expect(str).toContain("?o");
    });

    it("serializes FILTER operation", () => {
      const query = `
        SELECT ?task ?effort
        WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Filter");
      expect(str).toContain("?effort");
      expect(str).toContain(">");
      expect(str).toContain("60");
    });

    it("serializes JOIN operation", () => {
      const query = `
        SELECT ?task ?label
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Project");
      expect(str).toContain("BGP");
    });

    it("serializes OPTIONAL (LeftJoin) operation", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?label ?priority
        WHERE {
          ?task ems:label ?label .
          OPTIONAL { ?task ems:priority ?priority }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Project");
      expect(str).toContain("LeftJoin");
    });

    it("serializes UNION operation", () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?asset
        WHERE {
          { ?asset rdf:type <http://example.org/Task> }
          UNION
          { ?asset rdf:type <http://example.org/Project> }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Project");
      expect(str).toContain("Union");
    });

    it("serializes ORDER BY operation", () => {
      const query = `
        SELECT ?task ?effort
        WHERE { ?task <http://example.org/effort> ?effort }
        ORDER BY DESC(?effort)
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("OrderBy");
      expect(str).toContain("DESC");
      expect(str).toContain("?effort");
    });

    it("serializes LIMIT/OFFSET (Slice) operation", () => {
      const query = `
        SELECT ?task WHERE { ?task <http://example.org/type> <http://example.org/Task> } LIMIT 10 OFFSET 20
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Slice");
      expect(str).toContain("LIMIT 10");
      expect(str).toContain("OFFSET 20");
    });

    it("serializes DISTINCT operation", () => {
      const query = "SELECT DISTINCT ?status WHERE { ?task <http://example.org/status> ?status }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Distinct");
    });

    it("serializes complex nested operation", () => {
      const query = `
        SELECT DISTINCT ?task ?effort
        WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
        ORDER BY DESC(?effort)
        LIMIT 20
        OFFSET 10
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      expect(str).toContain("Slice");
      expect(str).toContain("OrderBy");
      expect(str).toContain("Distinct");
      expect(str).toContain("Project");
      expect(str).toContain("Filter");
    });

    it("properly indents nested operations", () => {
      const query = `
        SELECT ?task ?label
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER(?label = "Important")
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);

      const lines = str.split("\n");
      expect(lines.length).toBeGreaterThan(3);
    });
  });

  describe("toJSON", () => {
    it("exports algebra as JSON", () => {
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const json = serializer.toJSON(algebra);

      expect(json).toBeTruthy();
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe("project");
    });

    it("exports complex algebra as JSON", () => {
      const query = `
        SELECT ?task ?effort
        WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
        ORDER BY DESC(?effort)
        LIMIT 10
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const json = serializer.toJSON(algebra);

      const parsed = JSON.parse(json);
      expect(parsed.type).toBe("slice");
      expect(parsed.limit).toBe(10);
    });
  });

  describe("direct operation serialization", () => {
    it("serializes MINUS operation", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
          MINUS { ?s <http://example.org/type> <http://example.org/Done> }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("Minus");
    });

    it("serializes GROUP BY with aggregates", () => {
      const query = `
        SELECT ?status (COUNT(?task) AS ?count)
        WHERE { ?task <http://example.org/status> ?status }
        GROUP BY ?status
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("Group");
      expect(str).toContain("count");
    });

    it("serializes EXTEND (BIND) operation", () => {
      const query = `
        SELECT ?s ?label
        WHERE {
          ?s <http://example.org/name> ?name .
          BIND(CONCAT("prefix-", ?name) AS ?label)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("Extend");
    });

    it("serializes subquery operation", () => {
      const query = `
        SELECT ?s ?count
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
          {
            SELECT ?s (COUNT(?p) AS ?count) WHERE {
              ?s ?p ?o .
            } GROUP BY ?s
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("Subquery");
    });

    it("serializes unknown operation type gracefully", () => {
      const unknown = { type: "foobar" } as any;
      const str = serializer.toString(unknown);
      expect(str).toContain("Unknown(foobar)");
    });

    it("serializes LIMIT only (no offset) in Slice", () => {
      const query = `SELECT ?s WHERE { ?s ?p ?o } LIMIT 5`;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("LIMIT 5");
      expect(str).not.toContain("OFFSET");
    });

    it("serializes ASC in OrderBy", () => {
      const query = `
        SELECT ?s ?name
        WHERE { ?s <http://example.org/name> ?name }
        ORDER BY ASC(?name)
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("ASC");
    });

    it("serializes logical NOT expression", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/active> ?active .
          FILTER(!(?active))
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("!");
    });

    it("serializes logical AND expression", () => {
      const query = `
        SELECT ?s ?a ?b WHERE {
          ?s <http://example.org/a> ?a .
          ?s <http://example.org/b> ?b .
          FILTER(?a > 1 && ?b < 10)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("&&");
    });

    it("serializes function call expression", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/name> ?name .
          FILTER(STRLEN(?name) > 5)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("strlen");
    });

    it("serializes EXISTS expression", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
          FILTER EXISTS { ?s <http://example.org/done> ?d }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("EXISTS");
    });

    it("serializes NOT EXISTS expression", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
          FILTER NOT EXISTS { ?s <http://example.org/done> ?d }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const str = serializer.toString(algebra);
      expect(str).toContain("NOT EXISTS");
    });

    it("serializes literal element with language tag", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "iri", value: "http://example.org/p" },
          object: { type: "literal", value: "hello", language: "en" },
        }],
      } as any);
      expect(result).toContain('"hello"@en');
    });

    it("serializes literal element with datatype", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "iri", value: "http://example.org/p" },
          object: { type: "literal", value: "42", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
        }],
      } as any);
      expect(result).toContain('^^<http://www.w3.org/2001/XMLSchema#integer>');
    });

    it("serializes blank node element", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "blank", value: "b0" },
          predicate: { type: "iri", value: "http://example.org/p" },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("_:b0");
    });

    it("serializes unknown element type as string", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "unknown_type", value: "42", toString: () => "custom42" },
          predicate: { type: "iri", value: "http://example.org/p" },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("custom42");
    });

    it("serializes LeftJoin with expression", () => {
      const result = serializer.toString({
        type: "leftjoin",
        expression: { type: "variable", name: "x" },
        left: { type: "bgp", triples: [{ subject: { type: "variable", value: "s" }, predicate: { type: "iri", value: "http://example.org/p" }, object: { type: "variable", value: "o" } }] },
        right: { type: "bgp", triples: [{ subject: { type: "variable", value: "s" }, predicate: { type: "iri", value: "http://example.org/q" }, object: { type: "variable", value: "x" } }] },
      } as any);
      expect(result).toContain("LeftJoin");
      expect(result).toContain("?x");
    });

    it("serializes Group with no aggregates", () => {
      const result = serializer.toString({
        type: "group",
        variables: ["status"],
        aggregates: [],
        input: { type: "bgp", triples: [{ subject: { type: "variable", value: "s" }, predicate: { type: "iri", value: "http://example.org/p" }, object: { type: "variable", value: "status" } }] },
      } as any);
      expect(result).toContain("Group [?status]");
    });

    it("serializes Group with DISTINCT aggregate", () => {
      const result = serializer.toString({
        type: "group",
        variables: ["status"],
        aggregates: [{
          variable: "cnt",
          expression: { aggregation: "count", distinct: true, expression: { type: "variable", name: "s" } },
        }],
        input: { type: "bgp", triples: [{ subject: { type: "variable", value: "s" }, predicate: { type: "iri", value: "http://example.org/p" }, object: { type: "variable", value: "status" } }] },
      } as any);
      expect(result).toContain("DISTINCT");
    });

    it("serializes Group with * (no expression) aggregate", () => {
      const result = serializer.toString({
        type: "group",
        variables: [],
        aggregates: [{
          variable: "cnt",
          expression: { aggregation: "count", distinct: false, expression: null },
        }],
        input: { type: "bgp", triples: [{ subject: { type: "variable", value: "s" }, predicate: { type: "iri", value: "http://example.org/p" }, object: { type: "variable", value: "o" } }] },
      } as any);
      expect(result).toContain("*");
    });

    it("serializes property path with / (sequence)", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "path", pathType: "/", items: [{ type: "iri", value: "http://example.org/a" }, { type: "iri", value: "http://example.org/b" }] },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("<http://example.org/a>/<http://example.org/b>");
    });

    it("serializes property path with | (alternative)", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "path", pathType: "|", items: [{ type: "iri", value: "http://example.org/a" }, { type: "iri", value: "http://example.org/b" }] },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("|");
    });

    it("serializes property path with ^ (inverse)", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "path", pathType: "^", items: [{ type: "iri", value: "http://example.org/a" }] },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("^");
    });

    it("serializes property path with + (oneOrMore)", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "path", pathType: "+", items: [{ type: "iri", value: "http://example.org/a" }] },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("+");
    });

    it("serializes property path with * (zeroOrMore)", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "path", pathType: "*", items: [{ type: "iri", value: "http://example.org/a" }] },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("*");
    });

    it("serializes property path with ? (zeroOrOne)", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "path", pathType: "?", items: [{ type: "iri", value: "http://example.org/a" }] },
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("?");
    });

    it("serializes nested property path", () => {
      const result = serializer.toString({
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "path", pathType: "/", items: [
            { type: "path", pathType: "^", items: [{ type: "iri", value: "http://example.org/a" }] },
            { type: "iri", value: "http://example.org/b" },
          ]},
          object: { type: "variable", value: "o" },
        }],
      } as any);
      expect(result).toContain("(^");
    });

    it("serializes arithmetic expression", () => {
      const result = serializer.toString({
        type: "filter",
        expression: { type: "comparison", operator: ">", left: { type: "arithmetic", operator: "+", left: { type: "variable", name: "a" }, right: { type: "literal", value: 1 } }, right: { type: "literal", value: 5 } },
        input: { type: "bgp", triples: [{ subject: { type: "variable", value: "s" }, predicate: { type: "iri", value: "http://example.org/a" }, object: { type: "variable", value: "a" } }] },
      } as any);
      expect(result).toContain("+");
    });

    it("serializes literal number expression", () => {
      const result = serializer.toString({
        type: "filter",
        expression: { type: "comparison", operator: ">", left: { type: "variable", name: "x" }, right: { type: "literal", value: 42 } },
        input: { type: "bgp", triples: [{ subject: { type: "variable", value: "s" }, predicate: { type: "iri", value: "http://example.org/x" }, object: { type: "variable", value: "x" } }] },
      } as any);
      expect(result).toContain("42");
    });

    it("serializes unknown expression type as 'unknown'", () => {
      const result = serializer.toString({
        type: "filter",
        expression: { type: "weird_expr" } as any,
        input: { type: "bgp", triples: [] },
      } as any);
      expect(result).toContain("unknown");
    });
  });

  describe("Round-trip: optimize → serialize → visualize", () => {
    it("serializes optimized algebra", () => {
      const query = `
        SELECT ?task ?label ?effort
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.optimize(algebra);
      const str = serializer.toString(optimized);

      expect(str).toBeTruthy();
      expect(str).toContain("Project");
      expect(str).toContain("Filter");
    });

    it("compares unoptimized vs optimized plans", () => {
      const query = `
        SELECT ?task ?label
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER(?label = "Important")
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const unoptimized = serializer.toString(algebra);

      const optimized = optimizer.optimize(algebra);
      const optimizedStr = serializer.toString(optimized);

      expect(unoptimized).toBeTruthy();
      expect(optimizedStr).toBeTruthy();
    });
  });
});
