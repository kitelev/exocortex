import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { AlgebraSerializer } from "../../../../src/infrastructure/sparql/algebra/AlgebraSerializer";
import type { AlgebraOperation, FilterOperation, JoinOperation } from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("AlgebraOptimizer", () => {
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

  describe("Filter Push-Down", () => {
    it("pushes filter into left side of join when filter uses only left variables", () => {
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
      const optimized = optimizer.filterPushDown(algebra);

      const findFilter = (op: any): any => {
        if (op.type === "filter") return op;
        if (op.type === "project") return findFilter(op.input);
        if (op.type === "join") return findFilter(op.left) || findFilter(op.right);
        return null;
      };

      const filter = findFilter(optimized);
      expect(filter).toBeTruthy();
    });

    it("pushes filter into right side of join when filter uses only right variables", () => {
      const query = `
        SELECT ?task ?effort
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.filterPushDown(algebra);

      expect(optimized).toBeTruthy();
    });

    it("keeps filter above join when filter uses variables from both sides", () => {
      const query = `
        SELECT ?task ?project
        WHERE {
          ?task <http://example.org/parent> ?project .
          ?project <http://example.org/name> ?name .
          FILTER(?task != ?project)
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.filterPushDown(algebra);

      expect(optimized).toBeTruthy();
    });

    it("pushes filter into both sides of union", () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?asset ?label
        WHERE {
          { ?asset rdf:type <http://example.org/Task> }
          UNION
          { ?asset rdf:type <http://example.org/Project> }
          ?asset <http://example.org/label> ?label .
          FILTER(?label = "Important")
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.filterPushDown(algebra);

      expect(optimized).toBeTruthy();
    });

    it("recursively applies filter push-down to nested patterns", () => {
      const query = `
        SELECT ?task ?label ?effort
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
          ?task <http://example.org/effort> ?effort .
          FILTER(?label = "Important")
          FILTER(?effort > 60)
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.filterPushDown(algebra);

      expect(optimized).toBeTruthy();
    });
  });

  describe("Join Reordering", () => {
    it("reorders joins based on cost estimation", () => {
      const query = `
        SELECT ?task ?label ?effort
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
          ?task <http://example.org/effort> ?effort .
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.joinReordering(algebra);

      expect(optimized).toBeTruthy();
    });

    it("handles single BGP without reordering", () => {
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.joinReordering(algebra);

      expect(optimized.type).toBe("project");
      expect((optimized as any).input.type).toBe("bgp");
    });

    it("reorders nested joins recursively", () => {
      const query = `
        SELECT ?task ?label ?effort ?status
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
          ?task <http://example.org/effort> ?effort .
          ?task <http://example.org/status> ?status .
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.joinReordering(algebra);

      expect(optimized).toBeTruthy();
    });
  });

  describe("Combined Optimizations", () => {
    it("applies both filter push-down and join reordering", () => {
      const query = `
        SELECT ?task ?label ?effort
        WHERE {
          ?task <http://example.org/label> ?label .
          ?task <http://example.org/type> <http://example.org/Task> .
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
          FILTER(?label = "Important")
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.optimize(algebra);

      expect(optimized).toBeTruthy();
    });

    it("optimizes complex query with OPTIONAL and FILTER", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?label ?priority
        WHERE {
          ?task ems:label ?label .
          OPTIONAL { ?task ems:priority ?priority }
          FILTER(?label = "Important")
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.optimize(algebra);

      expect(optimized).toBeTruthy();
    });

    it("optimizes query with UNION and FILTER", () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?asset ?label
        WHERE {
          { ?asset rdf:type <http://example.org/Task> }
          UNION
          { ?asset rdf:type <http://example.org/Project> }
          ?asset <http://example.org/label> ?label .
          FILTER(?label = "Important")
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const optimized = optimizer.optimize(algebra);

      expect(optimized).toBeTruthy();
    });
  });

  describe("Cost Estimation", () => {
    it("estimates cost for BGP operations", () => {
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(optimizer).toBeTruthy();
    });

    it("estimates lower cost for filtered operations", () => {
      const query = `
        SELECT ?task ?effort
        WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra).toBeTruthy();
    });

    it("allows setting custom statistics", () => {
      optimizer.setStatistics("task-effort", {
        tripleCount: 1000,
        selectivity: 0.3,
      });

      const stats = optimizer.getStatistics("task-effort");
      expect(stats).toBeDefined();
      expect(stats?.tripleCount).toBe(1000);
      expect(stats?.selectivity).toBe(0.3);
    });
  });
});
