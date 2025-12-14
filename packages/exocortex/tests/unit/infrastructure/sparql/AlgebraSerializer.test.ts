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
