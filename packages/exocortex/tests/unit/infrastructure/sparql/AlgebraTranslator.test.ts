import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import {
  AlgebraTranslator,
  AlgebraTranslatorError,
} from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { AlgebraOptimizer } from "../../../../src/infrastructure/sparql/algebra/AlgebraOptimizer";
import { AlgebraSerializer } from "../../../../src/infrastructure/sparql/algebra/AlgebraSerializer";
import type { AlgebraOperation } from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("AlgebraTranslator", () => {
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

  describe("Basic Translation", () => {
    it("translates simple SELECT with BGP", () => {
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      expect((algebra as any).variables).toEqual(["s", "p", "o"]);
      expect((algebra as any).input.type).toBe("bgp");
      expect((algebra as any).input.triples).toHaveLength(1);
    });

    it("translates SELECT * with BGP", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("bgp");
      expect((algebra as any).triples).toHaveLength(1);
    });

    it("translates SELECT with multiple triples (implicit JOIN)", () => {
      const query = `
        SELECT ?s ?label
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
          ?s <http://example.org/label> ?label .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("bgp");
      expect(input.triples).toHaveLength(2);
    });

    it("translates SELECT with PREFIX declarations", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?task ?label
        WHERE {
          ?task rdf:type ems:Task .
          ?task ems:label ?label .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      expect((algebra as any).variables).toEqual(["task", "label"]);
    });
  });

  describe("FILTER Translation", () => {
    it("translates SELECT with FILTER", () => {
      const query = `
        SELECT ?task ?effort
        WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      // FILTER wraps the BGP, not joined with it
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("comparison");
      expect(input.expression.operator).toBe(">");
      expect(input.input.type).toBe("bgp");
    });

    it("translates FILTER with regex", () => {
      const query = `
        SELECT ?task ?label
        WHERE {
          ?task <http://example.org/label> ?label .
          FILTER(regex(?label, "bug", "i"))
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      // FILTER wraps the BGP, not joined with it
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("function");
      expect(input.expression.function).toBe("regex");
      expect(input.input.type).toBe("bgp");
    });

    it("translates FILTER with logical operators", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/effort> ?effort .
          ?task <http://example.org/status> ?status .
          FILTER(?effort > 60 && ?status = "Done")
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;

      // FILTER wraps the BGP (sparqljs combines adjacent triples into one BGP)
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("logical");
      expect(input.expression.operator).toBe("&&");
      // Input to filter is a single BGP with 2 triples
      expect(input.input.type).toBe("bgp");
      expect(input.input.triples).toHaveLength(2);
    });
  });

  describe("OPTIONAL Translation", () => {
    it("translates SELECT with OPTIONAL", () => {
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

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");

      const optionalOp = input.right;
      expect(optionalOp.type).toBe("leftjoin");
    });
  });

  describe("UNION Translation", () => {
    it("translates SELECT with UNION", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?asset
        WHERE {
          { ?asset rdf:type ems:Task }
          UNION
          { ?asset rdf:type ems:Project }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("union");
      expect(input.left.type).toBe("bgp");
      expect(input.right.type).toBe("bgp");
    });

    it("translates SELECT with 3-branch UNION (n-ary)", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?asset
        WHERE {
          { ?asset rdf:type ems:Task }
          UNION
          { ?asset rdf:type ems:Project }
          UNION
          { ?asset rdf:type ems:Area }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      // Should be left-associative: ((Task UNION Project) UNION Area)
      expect(input.type).toBe("union");
      expect(input.left.type).toBe("union"); // Nested union
      expect(input.right.type).toBe("bgp"); // Area branch
      // Verify the nested union
      expect(input.left.left.type).toBe("bgp"); // Task branch
      expect(input.left.right.type).toBe("bgp"); // Project branch
    });

    it("translates SELECT with 4-branch UNION", () => {
      const query = `
        SELECT ?s
        WHERE {
          { ?s <http://example.org/type> <http://example.org/A> }
          UNION
          { ?s <http://example.org/type> <http://example.org/B> }
          UNION
          { ?s <http://example.org/type> <http://example.org/C> }
          UNION
          { ?s <http://example.org/type> <http://example.org/D> }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      // Should be: (((A UNION B) UNION C) UNION D)
      expect(input.type).toBe("union");
      expect(input.right.type).toBe("bgp"); // D
      expect(input.left.type).toBe("union"); // ((A UNION B) UNION C)
      expect(input.left.right.type).toBe("bgp"); // C
      expect(input.left.left.type).toBe("union"); // (A UNION B)
      expect(input.left.left.left.type).toBe("bgp"); // A
      expect(input.left.left.right.type).toBe("bgp"); // B
    });

    it("translates UNION with multiple triples per branch", () => {
      const query = `
        SELECT ?entity ?label
        WHERE {
          {
            ?entity <http://example.org/type> <http://example.org/Task> .
            ?entity <http://example.org/label> ?label
          }
          UNION
          {
            ?entity <http://example.org/type> <http://example.org/Note> .
            ?entity <http://example.org/label> ?label
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("union");
      // Each branch should have 2 triples (joined)
      expect(input.left.type).toBe("bgp");
      expect(input.left.triples.length).toBe(2);
      expect(input.right.type).toBe("bgp");
      expect(input.right.triples.length).toBe(2);
    });

    it("translates UNION with FILTER in one branch", () => {
      const query = `
        SELECT ?s ?val
        WHERE {
          {
            ?s <http://example.org/value> ?val .
            FILTER(?val > 10)
          }
          UNION
          { ?s <http://example.org/default> ?val }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("union");
      // Left branch should have filter
      expect(input.left.type).toBe("filter");
      expect(input.left.input.type).toBe("bgp");
      // Right branch is just BGP
      expect(input.right.type).toBe("bgp");
    });

    it("translates nested UNION inside OPTIONAL", () => {
      const query = `
        SELECT ?s ?type
        WHERE {
          ?s <http://example.org/name> ?name .
          OPTIONAL {
            { ?s <http://example.org/type> <http://example.org/Task> . BIND("task" AS ?type) }
            UNION
            { ?s <http://example.org/type> <http://example.org/Project> . BIND("project" AS ?type) }
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.right.type).toBe("leftjoin");
      // The OPTIONAL right side should contain the UNION
      expect(input.right.right.type).toBe("union");
    });
  });

  describe("MINUS Translation", () => {
    it("translates SELECT with MINUS", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?label
        WHERE {
          ?task ems:label ?label .
          MINUS { ?task ems:status "done" }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");

      const minusOp = input.right;
      expect(minusOp.type).toBe("minus");
      expect(minusOp.right.type).toBe("bgp");
    });

    it("translates MINUS with multiple patterns", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task
        WHERE {
          ?task a ems:Task .
          MINUS {
            ?task ems:status "done" .
            ?task ems:archived "true" .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");

      const minusOp = input.right;
      expect(minusOp.type).toBe("minus");
      // The right side should be a BGP with 2 triples or a join of BGPs
      expect(minusOp.right).toBeDefined();
    });

    it("translates MINUS combined with OPTIONAL", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?priority
        WHERE {
          ?task a ems:Task .
          OPTIONAL { ?task ems:priority ?priority }
          MINUS { ?task ems:status "done" }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      // Should have join of (join(bgp, leftjoin)), minus)
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
    });
  });

  describe("Solution Modifiers", () => {
    it("translates SELECT DISTINCT", () => {
      const query = "SELECT DISTINCT ?status WHERE { ?task <http://example.org/status> ?status }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("distinct");
      const input = (algebra as any).input;
      expect(input.type).toBe("project");
    });

    it("translates SELECT REDUCED", () => {
      const query = "SELECT REDUCED ?status WHERE { ?task <http://example.org/status> ?status }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("reduced");
      const input = (algebra as any).input;
      expect(input.type).toBe("project");
    });

    it("translates SELECT REDUCED with ORDER BY", () => {
      const query = `
        SELECT REDUCED ?task ?effort
        WHERE { ?task <http://example.org/effort> ?effort }
        ORDER BY ASC(?effort)
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // ORDER BY wraps REDUCED
      expect(algebra.type).toBe("orderby");
      const reduced = (algebra as any).input;
      expect(reduced.type).toBe("reduced");
      expect(reduced.input.type).toBe("project");
    });

    it("translates SELECT REDUCED with LIMIT", () => {
      const query = "SELECT REDUCED ?status WHERE { ?task <http://example.org/status> ?status } LIMIT 10";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // LIMIT (slice) wraps REDUCED
      expect(algebra.type).toBe("slice");
      expect((algebra as any).limit).toBe(10);
      const reduced = (algebra as any).input;
      expect(reduced.type).toBe("reduced");
    });

    it("translates SELECT with ORDER BY ASC", () => {
      const query = `
        SELECT ?task ?effort
        WHERE { ?task <http://example.org/effort> ?effort }
        ORDER BY ASC(?effort)
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("orderby");
      expect((algebra as any).comparators).toHaveLength(1);
      expect((algebra as any).comparators[0].descending).toBe(false);
    });

    it("translates SELECT with ORDER BY DESC", () => {
      const query = `
        SELECT ?task ?effort
        WHERE { ?task <http://example.org/effort> ?effort }
        ORDER BY DESC(?effort)
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("orderby");
      expect((algebra as any).comparators[0].descending).toBe(true);
    });

    it("translates SELECT with LIMIT", () => {
      const query = `
        SELECT ?task WHERE { ?task <http://example.org/type> <http://example.org/Task> } LIMIT 10
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("slice");
      expect((algebra as any).limit).toBe(10);
      expect((algebra as any).offset).toBeUndefined();
    });

    it("translates SELECT with LIMIT and OFFSET", () => {
      const query = `
        SELECT ?task WHERE { ?task <http://example.org/type> <http://example.org/Task> } LIMIT 10 OFFSET 20
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("slice");
      expect((algebra as any).limit).toBe(10);
      expect((algebra as any).offset).toBe(20);
    });

    it("translates SELECT with multiple modifiers", () => {
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

      expect(algebra.type).toBe("slice");
      expect((algebra as any).limit).toBe(20);
      expect((algebra as any).offset).toBe(10);

      let current = (algebra as any).input;
      expect(current.type).toBe("orderby");

      current = current.input;
      expect(current.type).toBe("distinct");

      current = current.input;
      expect(current.type).toBe("project");
    });
  });

  describe("BIND Translation", () => {
    it("translates BIND with variable copy", () => {
      const query = `
        SELECT ?s ?copy WHERE {
          ?s <http://example.org/p> ?o .
          BIND(?o AS ?copy)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("extend");
      expect(input.variable).toBe("copy");
      expect(input.expression.type).toBe("variable");
      expect(input.expression.name).toBe("o");
      expect(input.input.type).toBe("bgp");
    });

    it("translates BIND with REPLACE function", () => {
      const query = `
        SELECT ?s ?clean WHERE {
          ?s <http://example.org/label> ?raw .
          BIND(REPLACE(?raw, "[[", "") AS ?clean)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("extend");
      expect(input.variable).toBe("clean");
      expect(input.expression.type).toBe("function");
      expect(input.expression.function).toBe("replace");
      expect(input.expression.args).toHaveLength(3);
    });

    it("translates BIND with STR function", () => {
      const query = `
        SELECT ?s ?strValue WHERE {
          ?s <http://example.org/p> ?o .
          BIND(STR(?o) AS ?strValue)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("extend");
      expect(input.variable).toBe("strValue");
      expect(input.expression.type).toBe("function");
      expect(input.expression.function).toBe("str");
    });

    it("translates BIND with nested REPLACE functions", () => {
      const query = `
        SELECT ?s ?clean WHERE {
          ?s <http://example.org/label> ?raw .
          BIND(REPLACE(REPLACE(?raw, "[[", ""), "]]", "") AS ?clean)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("extend");
      expect(input.variable).toBe("clean");
      expect(input.expression.type).toBe("function");
      expect(input.expression.function).toBe("replace");
      // First arg is another REPLACE function
      expect(input.expression.args[0].type).toBe("function");
      expect(input.expression.args[0].function).toBe("replace");
    });

    it("translates multiple BIND patterns", () => {
      const query = `
        SELECT ?s ?a ?b WHERE {
          ?s <http://example.org/p> ?o .
          BIND(?o AS ?a)
          BIND(STR(?o) AS ?b)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      let current = (algebra as any).input;

      // Second BIND wraps first
      expect(current.type).toBe("extend");
      expect(current.variable).toBe("b");

      current = current.input;
      expect(current.type).toBe("extend");
      expect(current.variable).toBe("a");

      current = current.input;
      expect(current.type).toBe("bgp");
    });

    it("translates BIND before FILTER", () => {
      const query = `
        SELECT ?s ?clean WHERE {
          ?s <http://example.org/label> ?raw .
          BIND(REPLACE(?raw, "prefix_", "") AS ?clean)
          FILTER(CONTAINS(?clean, "test"))
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;

      // FILTER should wrap the extend
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("function");
      expect(input.expression.function).toBe("contains");

      // extend is input to filter
      expect(input.input.type).toBe("extend");
      expect(input.input.variable).toBe("clean");
    });
  });

  describe("EXISTS Translation", () => {
    it("translates FILTER EXISTS with simple BGP", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER EXISTS { ?task <http://example.org/status> "Done" }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("exists");
      expect(input.expression.negated).toBe(false);
      expect(input.expression.pattern.type).toBe("bgp");
      expect(input.expression.pattern.triples).toHaveLength(1);
    });

    it("translates FILTER NOT EXISTS with simple BGP", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER NOT EXISTS { ?task <http://example.org/blocker> ?blocker }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("exists");
      expect(input.expression.negated).toBe(true);
      expect(input.expression.pattern.type).toBe("bgp");
    });

    it("translates EXISTS with multiple triples", () => {
      const query = `
        SELECT ?project
        WHERE {
          ?project <http://example.org/type> <http://example.org/Project> .
          FILTER EXISTS {
            ?task <http://example.org/parent> ?project .
            ?task <http://example.org/status> "Done"
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("exists");
      expect(input.expression.negated).toBe(false);
      expect(input.expression.pattern.type).toBe("bgp");
      expect(input.expression.pattern.triples).toHaveLength(2);
    });

    it("translates EXISTS combined with AND", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          ?task <http://example.org/priority> ?priority .
          FILTER(?priority > 5 && EXISTS { ?task <http://example.org/blocker> ?b })
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("logical");
      expect(input.expression.operator).toBe("&&");
      expect(input.expression.operands[0].type).toBe("comparison");
      expect(input.expression.operands[1].type).toBe("exists");
    });

    it("translates NOT EXISTS combined with OR", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER(
            NOT EXISTS { ?task <http://example.org/blocker> ?b } ||
            NOT EXISTS { ?task <http://example.org/dependency> ?d }
          )
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("logical");
      expect(input.expression.operator).toBe("||");
      expect(input.expression.operands[0].type).toBe("exists");
      expect(input.expression.operands[0].negated).toBe(true);
      expect(input.expression.operands[1].type).toBe("exists");
      expect(input.expression.operands[1].negated).toBe(true);
    });

    it("translates nested NOT with EXISTS", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER(!EXISTS { ?task <http://example.org/blocker> ?b })
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      // sparqljs may parse !EXISTS as logical NOT with EXISTS child
      // or as notexists directly depending on version
      if (input.expression.type === "logical") {
        expect(input.expression.operator).toBe("!");
        expect(input.expression.operands[0].type).toBe("exists");
      } else {
        expect(input.expression.type).toBe("exists");
      }
    });

    it("translates EXISTS with PREFIX declarations", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?task
        WHERE {
          ?task rdf:type ems:Task .
          FILTER EXISTS { ?task ems:assignee ?person }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("exists");
      expect(input.expression.pattern.type).toBe("bgp");
    });

    it("translates EXISTS with OPTIONAL inside", () => {
      const query = `
        SELECT ?project
        WHERE {
          ?project <http://example.org/type> <http://example.org/Project> .
          FILTER EXISTS {
            ?task <http://example.org/parent> ?project .
            OPTIONAL { ?task <http://example.org/assignee> ?person }
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("exists");
      // Pattern should contain join with leftjoin for OPTIONAL
      const pattern = input.expression.pattern;
      expect(pattern).toBeDefined();
    });

    it("translates EXISTS with FILTER inside", () => {
      const query = `
        SELECT ?project
        WHERE {
          ?project <http://example.org/type> <http://example.org/Project> .
          FILTER EXISTS {
            ?task <http://example.org/parent> ?project .
            ?task <http://example.org/effort> ?effort .
            FILTER(?effort > 60)
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.expression.type).toBe("exists");
      const pattern = input.expression.pattern;
      // Pattern should contain nested FILTER
      expect(pattern.type).toBe("filter");
    });
  });

  describe("Property Paths", () => {
    it("translates OneOrMore path (+)", () => {
      const query = `
        SELECT ?ancestor
        WHERE {
          <http://example.org/person> <http://example.org/parent>+ ?ancestor .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("bgp");
      expect(input.triples.length).toBe(1);
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("+");
      expect(predicate.items[0].type).toBe("iri");
      expect(predicate.items[0].value).toBe("http://example.org/parent");
    });

    it("translates ZeroOrMore path (*)", () => {
      const query = `
        SELECT ?node
        WHERE {
          <http://example.org/start> <http://example.org/next>* ?node .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("*");
    });

    it("translates ZeroOrOne path (?)", () => {
      const query = `
        SELECT ?node
        WHERE {
          <http://example.org/start> <http://example.org/next>? ?node .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("?");
    });

    it("translates Inverse path (^)", () => {
      const query = `
        SELECT ?child
        WHERE {
          <http://example.org/parent> ^<http://example.org/hasParent> ?child .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("^");
      expect(predicate.items[0].type).toBe("iri");
    });

    it("translates Sequence path (/)", () => {
      const query = `
        SELECT ?grandparent
        WHERE {
          ?person <http://example.org/parent>/<http://example.org/parent> ?grandparent .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("/");
      expect(predicate.items.length).toBe(2);
      expect(predicate.items[0].type).toBe("iri");
      expect(predicate.items[1].type).toBe("iri");
    });

    it("translates Alternative path (|)", () => {
      const query = `
        SELECT ?related
        WHERE {
          ?person (<http://example.org/knows>|<http://example.org/likes>) ?related .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("|");
      expect(predicate.items.length).toBe(2);
    });

    it("translates nested path expressions", () => {
      const query = `
        SELECT ?ancestor
        WHERE {
          ?person (<http://example.org/parent>/<http://example.org/parent>)+ ?ancestor .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("+");
      expect(predicate.items[0].type).toBe("path");
      expect(predicate.items[0].pathType).toBe("/");
    });

    it("translates path with PREFIX", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?ancestor
        WHERE {
          ?person ex:parent+ ?ancestor .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const predicate = input.triples[0].predicate;
      expect(predicate.type).toBe("path");
      expect(predicate.pathType).toBe("+");
      expect(predicate.items[0].value).toBe("http://example.org/parent");
    });
  });

  describe("Subqueries", () => {
    it("translates simple subquery", () => {
      const query = `
        SELECT ?name
        WHERE {
          {
            SELECT ?x
            WHERE { ?x <http://example.org/type> <http://example.org/Person> }
          }
          ?x <http://example.org/name> ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("subquery");
      expect(input.left.query.type).toBe("project");
      expect(input.right.type).toBe("bgp");
    });

    it("translates subquery with FILTER", () => {
      const query = `
        SELECT ?person ?age
        WHERE {
          {
            SELECT ?person
            WHERE {
              ?person <http://example.org/type> <http://example.org/Person> .
              ?person <http://example.org/age> ?a .
              FILTER(?a > 18)
            }
          }
          ?person <http://example.org/age> ?age .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("subquery");
      // Inner query should have filter
      const innerQuery = input.left.query;
      expect(innerQuery.type).toBe("project");
      expect(innerQuery.input.type).toBe("filter");
    });

    it("translates subquery with ORDER BY", () => {
      const query = `
        SELECT ?name
        WHERE {
          {
            SELECT ?x
            WHERE { ?x <http://example.org/score> ?score }
            ORDER BY DESC(?score)
          }
          ?x <http://example.org/name> ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.left.type).toBe("subquery");
      const innerQuery = input.left.query;
      // OrderBy wraps the project
      expect(innerQuery.type).toBe("orderby");
      expect(innerQuery.comparators[0].descending).toBe(true);
    });

    it("translates subquery with LIMIT", () => {
      const query = `
        SELECT ?name
        WHERE {
          {
            SELECT ?x
            WHERE { ?x <http://example.org/type> <http://example.org/Task> }
            LIMIT 10
          }
          ?x <http://example.org/name> ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.left.type).toBe("subquery");
      const innerQuery = input.left.query;
      expect(innerQuery.type).toBe("slice");
      expect(innerQuery.limit).toBe(10);
    });

    it("translates subquery with OFFSET", () => {
      const query = `
        SELECT ?name
        WHERE {
          {
            SELECT ?x
            WHERE { ?x <http://example.org/type> <http://example.org/Task> }
            OFFSET 5
            LIMIT 10
          }
          ?x <http://example.org/name> ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const innerQuery = input.left.query;
      expect(innerQuery.type).toBe("slice");
      expect(innerQuery.offset).toBe(5);
      expect(innerQuery.limit).toBe(10);
    });

    it("translates subquery with DISTINCT", () => {
      const query = `
        SELECT ?name
        WHERE {
          {
            SELECT DISTINCT ?x
            WHERE { ?x <http://example.org/type> <http://example.org/Task> }
          }
          ?x <http://example.org/name> ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const innerQuery = input.left.query;
      expect(innerQuery.type).toBe("distinct");
    });

    it("translates subquery with GROUP BY", () => {
      const query = `
        SELECT ?category ?count
        WHERE {
          {
            SELECT ?category (COUNT(?task) AS ?count)
            WHERE {
              ?task <http://example.org/category> ?category
            }
            GROUP BY ?category
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("subquery");
      const innerQuery = input.query;
      expect(innerQuery.type).toBe("project");
      // Group should be in the input chain
      const groupOp = innerQuery.input;
      expect(groupOp.type).toBe("group");
      expect(groupOp.variables).toContain("category");
    });

    it("translates subquery with aggregate COUNT", () => {
      const query = `
        SELECT ?category ?total
        WHERE {
          {
            SELECT ?category (COUNT(*) AS ?total)
            WHERE {
              ?task <http://example.org/category> ?category
            }
            GROUP BY ?category
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      const innerQuery = input.query;
      const groupOp = innerQuery.input;
      expect(groupOp.type).toBe("group");
      expect(groupOp.aggregates.length).toBeGreaterThan(0);
      expect(groupOp.aggregates[0].expression.aggregation).toBe("count");
    });

    it("translates subquery-only WHERE clause", () => {
      const query = `
        SELECT ?x ?score
        WHERE {
          {
            SELECT ?x ?score
            WHERE { ?x <http://example.org/score> ?score }
            ORDER BY DESC(?score)
            LIMIT 5
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("subquery");
    });

    it("translates subquery with PREFIX", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?name
        WHERE {
          {
            SELECT ?x
            WHERE { ?x ex:type ex:Person }
          }
          ?x ex:name ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("subquery");
    });

    it("translates subquery with inner subquery (nested)", () => {
      const query = `
        SELECT ?name
        WHERE {
          {
            SELECT ?x
            WHERE {
              {
                SELECT ?y
                WHERE { ?y <http://example.org/active> true }
              }
              ?y <http://example.org/related> ?x
            }
          }
          ?x <http://example.org/name> ?name
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("subquery");
      // Inner subquery structure
      const innerQuery = input.left.query;
      expect(innerQuery.type).toBe("project");
      expect(innerQuery.input.type).toBe("join");
      expect(innerQuery.input.left.type).toBe("subquery");
    });

    it("handles subquery projection of fewer variables", () => {
      const query = `
        SELECT ?name ?label
        WHERE {
          {
            SELECT ?x
            WHERE {
              ?x <http://example.org/type> <http://example.org/Task> .
              ?x <http://example.org/active> true
            }
          }
          ?x <http://example.org/name> ?name .
          ?x <http://example.org/label> ?label .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const outerVars = (algebra as any).variables;
      expect(outerVars).toContain("name");
      expect(outerVars).toContain("label");

      const input = (algebra as any).input;
      expect(input.left.type).toBe("subquery");
      const innerProject = input.left.query;
      expect(innerProject.variables).toEqual(["x"]);
    });

    it("translates subquery with UNION inside", () => {
      const query = `
        SELECT ?name
        WHERE {
          {
            SELECT ?x
            WHERE {
              { ?x <http://example.org/type> <http://example.org/Task> }
              UNION
              { ?x <http://example.org/type> <http://example.org/Project> }
            }
          }
          ?x <http://example.org/name> ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      expect(input.left.type).toBe("subquery");
      const innerQuery = input.left.query;
      expect(innerQuery.input.type).toBe("union");
    });

    it("translates subquery with OPTIONAL inside", () => {
      const query = `
        SELECT ?name ?email
        WHERE {
          {
            SELECT ?x ?email
            WHERE {
              ?x <http://example.org/type> <http://example.org/Person> .
              OPTIONAL { ?x <http://example.org/email> ?email }
            }
          }
          ?x <http://example.org/name> ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const input = (algebra as any).input;
      expect(input.left.type).toBe("subquery");
      const innerQuery = input.left.query;
      // Should contain leftjoin for OPTIONAL
      expect(innerQuery.input.type).toBe("join");
    });

    it("translates outer SELECT with arithmetic expression referencing subquery variables", () => {
      // Issue #609: Arithmetic expressions in outer SELECT with subqueries
      // Example: SELECT ?label (FLOOR(?avgSec / 60) AS ?avgMin) WHERE { { SELECT ?label (AVG(?d) AS ?avgSec) ... } }
      const query = `
        SELECT ?label (FLOOR(?avgSec / 60) AS ?avgMin)
        WHERE {
          {
            SELECT ?label (AVG(?duration) AS ?avgSec)
            WHERE {
              ?s <http://example.org/label> ?label .
              ?s <http://example.org/duration> ?duration .
            }
            GROUP BY ?label
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Outer query should have:
      // project(variables: [label, avgMin], input: extend(variable: avgMin, expression: FLOOR(...), input: subquery))
      expect(algebra.type).toBe("project");
      const outerVars = (algebra as any).variables;
      expect(outerVars).toContain("label");
      expect(outerVars).toContain("avgMin");

      // There should be an extend for the FLOOR expression
      const input = (algebra as any).input;
      expect(input.type).toBe("extend");
      expect(input.variable).toBe("avgMin");
      expect(input.expression.type).toBe("function");
      expect(input.expression.function).toBe("floor");

      // The extend's input should be the subquery
      expect(input.input.type).toBe("subquery");
    });

    it("translates outer SELECT with multiple arithmetic expressions from subquery", () => {
      // More complex case: multiple computed columns from subquery variables
      const query = `
        SELECT ?label (?totalSec / 60 AS ?totalMin) (?totalSec / 3600 AS ?totalHours)
        WHERE {
          {
            SELECT ?label (SUM(?duration) AS ?totalSec)
            WHERE {
              ?s <http://example.org/label> ?label .
              ?s <http://example.org/duration> ?duration .
            }
            GROUP BY ?label
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const outerVars = (algebra as any).variables;
      expect(outerVars).toContain("label");
      expect(outerVars).toContain("totalMin");
      expect(outerVars).toContain("totalHours");

      // Should have two extend operations (nested)
      let current = (algebra as any).input;
      expect(current.type).toBe("extend");
      expect(current.expression.type).toBe("arithmetic");

      current = current.input;
      expect(current.type).toBe("extend");
      expect(current.expression.type).toBe("arithmetic");

      // Finally the subquery
      current = current.input;
      expect(current.type).toBe("subquery");
    });
  });

  describe("VALUES Translation", () => {
    it("translates simple single-variable VALUES", () => {
      const query = `
        SELECT ?task ?status
        WHERE {
          VALUES ?status { "active" "pending" "blocked" }
          ?task <http://example.org/status> ?status .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("values");
      expect(input.left.variables).toEqual(["status"]);
      expect(input.left.bindings).toHaveLength(3);
      expect(input.left.bindings[0].status.type).toBe("literal");
      expect(input.left.bindings[0].status.value).toBe("active");
    });

    it("translates multi-variable VALUES", () => {
      const query = `
        SELECT ?name ?role
        WHERE {
          VALUES (?name ?role) {
            ("Alice" "admin")
            ("Bob" "editor")
          }
          ?person <http://example.org/name> ?name .
          ?person <http://example.org/role> ?role .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("values");
      expect(input.left.variables).toContain("name");
      expect(input.left.variables).toContain("role");
      expect(input.left.bindings).toHaveLength(2);
      expect(input.left.bindings[0].name.value).toBe("Alice");
      expect(input.left.bindings[0].role.value).toBe("admin");
    });

    it("translates VALUES with IRI values", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?proj ?name
        WHERE {
          VALUES ?proj { ex:proj1 ex:proj2 <http://example.org/proj3> }
          ?proj ex:name ?name .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("values");
      expect(input.left.bindings).toHaveLength(3);
      expect(input.left.bindings[0].proj.type).toBe("iri");
      expect(input.left.bindings[0].proj.value).toBe("http://example.org/proj1");
    });

    it("translates VALUES with UNDEF (missing values)", () => {
      const query = `
        SELECT ?x ?y
        WHERE {
          VALUES (?x ?y) {
            (1 2)
            (UNDEF 3)
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("values");
      expect(input.bindings).toHaveLength(2);
      // First row: both bound
      expect(input.bindings[0].x.value).toBe("1");
      expect(input.bindings[0].y.value).toBe("2");
      // Second row: x is UNDEF (not present in binding)
      expect(input.bindings[1].x).toBeUndefined();
      expect(input.bindings[1].y.value).toBe("3");
    });

    it("translates VALUES with typed literals", () => {
      const query = `
        SELECT ?count
        WHERE {
          VALUES ?count { 1 2 3 }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("values");
      expect(input.bindings).toHaveLength(3);
      expect(input.bindings[0].count.type).toBe("literal");
      expect(input.bindings[0].count.datatype).toContain("integer");
    });

    it("translates VALUES-only query (no other patterns)", () => {
      const query = `
        SELECT ?x ?y
        WHERE {
          VALUES (?x ?y) {
            ("a" "b")
            ("c" "d")
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("values");
      expect(input.variables).toContain("x");
      expect(input.variables).toContain("y");
    });

    it("translates multiple VALUES clauses", () => {
      const query = `
        SELECT ?year ?month
        WHERE {
          VALUES ?year { 2023 2024 }
          VALUES ?month { 1 2 3 }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      // Two VALUES clauses should be joined
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("values");
      expect(input.right.type).toBe("values");
    });

    it("translates VALUES combined with FILTER", () => {
      const query = `
        SELECT ?x ?y
        WHERE {
          VALUES ?x { 1 2 3 4 5 }
          BIND(?x * 2 AS ?y)
          FILTER(?y > 4)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("filter");
      expect(input.input.type).toBe("extend");
      expect(input.input.input.type).toBe("values");
    });

    it("translates VALUES combined with OPTIONAL", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?task ?status ?priority
        WHERE {
          VALUES ?status { "active" "pending" }
          ?task ex:status ?status .
          OPTIONAL { ?task ex:priority ?priority }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      // Should have join of (join(values, bgp), leftjoin)
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
    });

    it("translates VALUES with PREFIX declarations", () => {
      const query = `
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?task ?status
        WHERE {
          VALUES ?status { "active" "done" }
          ?task ems:status ?status .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");
      expect(input.left.type).toBe("values");
    });
  });

  describe("Error Handling", () => {
    it("throws error for empty WHERE clause", () => {
      const ast = parser.parse("SELECT ?s WHERE { }");
      expect(() => translator.translate(ast)).toThrow(AlgebraTranslatorError);
    });

    it("throws error for unsupported query types (DESCRIBE)", () => {
      const ast: any = {
        type: "query",
        queryType: "DESCRIBE",
        where: [{ type: "bgp", triples: [] }],
      };
      expect(() => translator.translate(ast)).toThrow(AlgebraTranslatorError);
    });
  });

  describe("CONSTRUCT Query Translation", () => {
    it("translates simple CONSTRUCT query", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/derived> "value" .
        }
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      expect((algebra as any).template).toHaveLength(1);
      expect((algebra as any).where.type).toBe("bgp");
    });

    it("translates CONSTRUCT with PREFIX declarations", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        CONSTRUCT {
          ?task ex:isProcessed "true" .
        }
        WHERE {
          ?task ex:type ex:Task .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      const template = (algebra as any).template;
      expect(template[0].predicate.value).toBe("http://example.org/isProcessed");
    });

    it("translates CONSTRUCT with multiple template patterns", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/p1> "v1" .
          ?s <http://example.org/p2> "v2" .
        }
        WHERE {
          ?s <http://example.org/type> <http://example.org/Thing> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      expect((algebra as any).template).toHaveLength(2);
    });

    it("translates CONSTRUCT with FILTER in WHERE", () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/completed> "true" .
        }
        WHERE {
          ?task <http://example.org/status> ?s .
          FILTER(?s = "done")
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      expect((algebra as any).where.type).toBe("filter");
    });

    it("translates CONSTRUCT with BIND in WHERE", () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/length> ?len .
        }
        WHERE {
          ?task <http://example.org/label> ?label .
          BIND(STRLEN(?label) AS ?len)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      expect((algebra as any).where.type).toBe("extend");
    });

    it("translates CONSTRUCT with OPTIONAL in WHERE", () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/hasStatus> ?status .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          OPTIONAL { ?task <http://example.org/status> ?status }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
    });

    it("throws error for CONSTRUCT without WHERE clause", () => {
      const ast: any = {
        type: "query",
        queryType: "CONSTRUCT",
        template: [],
        where: [],
      };
      expect(() => translator.translate(ast)).toThrow("CONSTRUCT query must have WHERE clause");
    });

    it("handles empty template gracefully", () => {
      const query = `
        CONSTRUCT { }
        WHERE {
          ?s <http://example.org/p> ?o .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      expect((algebra as any).template).toHaveLength(0);
    });
  });

  describe("Arithmetic on Aggregates (Issue #614)", () => {
    it("translates SELECT with division of two aggregates (SUM / COUNT)", () => {
      const query = `
        SELECT (SUM(?value) / COUNT(?value) AS ?avg)
        WHERE { ?s <http://example.org/value> ?value }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Should have: project -> extend -> group -> bgp
      expect(algebra.type).toBe("project");
      expect((algebra as any).variables).toContain("avg");

      const extend = (algebra as any).input;
      expect(extend.type).toBe("extend");
      expect(extend.variable).toBe("avg");

      // The extend expression should be arithmetic division of two variables
      const expr = extend.expression;
      expect(expr.type).toBe("arithmetic");
      expect(expr.operator).toBe("/");
      // Left and right should be variable references to computed aggregates
      expect(expr.left.type).toBe("variable");
      expect(expr.right.type).toBe("variable");

      const group = extend.input;
      expect(group.type).toBe("group");
      // Should have two aggregate bindings for SUM and COUNT
      expect(group.aggregates.length).toBe(2);
      expect(group.aggregates.some((a: any) => a.expression.aggregation === "sum")).toBe(true);
      expect(group.aggregates.some((a: any) => a.expression.aggregation === "count")).toBe(true);
    });

    it("translates nested arithmetic with aggregates (SUM / COUNT / 60)", () => {
      const query = `
        SELECT (SUM(?duration) / COUNT(?s) / 60 AS ?avgMinutes)
        WHERE { ?s <http://example.org/duration> ?duration }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const extend = (algebra as any).input;
      expect(extend.type).toBe("extend");
      expect(extend.variable).toBe("avgMinutes");

      // Expression should be nested arithmetic
      const expr = extend.expression;
      expect(expr.type).toBe("arithmetic");
      expect(expr.operator).toBe("/");
      // Right should be literal 60
      expect(expr.right.type).toBe("literal");
      expect(expr.right.value).toBe(60);
      // Left should be another division
      expect(expr.left.type).toBe("arithmetic");
      expect(expr.left.operator).toBe("/");
    });

    it("translates multiplication of aggregates (SUM * 100 / SUM as percentage)", () => {
      const query = `
        SELECT (SUM(?completed) * 100 / SUM(?total) AS ?percentage)
        WHERE {
          ?s <http://example.org/completed> ?completed .
          ?s <http://example.org/total> ?total .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const extend = (algebra as any).input;
      expect(extend.type).toBe("extend");
      expect(extend.variable).toBe("percentage");

      // Should have arithmetic expression
      const expr = extend.expression;
      expect(expr.type).toBe("arithmetic");
    });

    it("translates mixed simple aggregates and arithmetic on aggregates", () => {
      const query = `
        SELECT (COUNT(?s) AS ?total) (SUM(?value) / COUNT(?s) AS ?avg)
        WHERE { ?s <http://example.org/value> ?value }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      expect((algebra as any).variables).toContain("total");
      expect((algebra as any).variables).toContain("avg");

      // Should have extend for the arithmetic expression
      let current = (algebra as any).input;
      expect(current.type).toBe("extend");
      expect(current.variable).toBe("avg");

      // Group operation should exist
      const group = current.input;
      expect(group.type).toBe("group");
      // Should have aggregates including the simple COUNT bound to "total"
      expect(group.aggregates.some((a: any) => a.variable === "total")).toBe(true);
    });

    it("translates arithmetic on aggregates with GROUP BY", () => {
      const query = `
        SELECT ?category (SUM(?duration) / COUNT(?task) AS ?avgDuration)
        WHERE {
          ?task <http://example.org/category> ?category .
          ?task <http://example.org/duration> ?duration .
        }
        GROUP BY ?category
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const extend = (algebra as any).input;
      expect(extend.type).toBe("extend");

      const group = extend.input;
      expect(group.type).toBe("group");
      expect(group.variables).toContain("category");
    });

    it("preserves aggregate variable names in expressions correctly", () => {
      const query = `
        SELECT (SUM(?x) / COUNT(?x) AS ?result)
        WHERE { ?s <http://example.org/x> ?x }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const extend = (algebra as any).input;
      const group = extend.input;

      // Get the variable names assigned to the aggregates
      const sumVar = group.aggregates.find((a: any) => a.expression.aggregation === "sum").variable;
      const countVar = group.aggregates.find((a: any) => a.expression.aggregation === "count").variable;

      // The extend expression should reference these exact variables
      const expr = extend.expression;
      expect(expr.left.name).toBe(sumVar);
      expect(expr.right.name).toBe(countVar);
    });
  });

  describe("ASK Query Translation", () => {
    it("translates simple ASK query", () => {
      const query = `
        ASK WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("bgp");
      expect((algebra as any).where.triples).toHaveLength(1);
    });

    it("translates ASK with PREFIX declarations", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        ASK WHERE {
          ?task ex:type ex:Task .
          ?task ex:status "done" .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("bgp");
      expect((algebra as any).where.triples).toHaveLength(2);
    });

    it("translates ASK with FILTER", () => {
      const query = `
        ASK WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("filter");
      expect((algebra as any).where.input.type).toBe("bgp");
    });

    it("translates ASK with OPTIONAL", () => {
      const query = `
        ASK WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          OPTIONAL { ?task <http://example.org/priority> ?priority }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      const where = (algebra as any).where;
      expect(where.type).toBe("join");
    });

    it("translates ASK with UNION", () => {
      const query = `
        ASK WHERE {
          { ?s <http://example.org/type> <http://example.org/Task> }
          UNION
          { ?s <http://example.org/type> <http://example.org/Project> }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("union");
    });

    it("translates ASK with FILTER NOT EXISTS", () => {
      const query = `
        ASK WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER NOT EXISTS { ?task <http://example.org/blocker> ?blocker }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("filter");
      expect((algebra as any).where.expression.type).toBe("exists");
      expect((algebra as any).where.expression.negated).toBe(true);
    });

    it("translates ASK with BIND", () => {
      const query = `
        ASK WHERE {
          ?s <http://example.org/label> ?label .
          BIND(STRLEN(?label) AS ?len)
          FILTER(?len > 10)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("filter");
      expect((algebra as any).where.input.type).toBe("extend");
    });

    it("translates ASK with empty WHERE clause", () => {
      const ast: any = {
        type: "query",
        queryType: "ASK",
        where: [],
      };
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("bgp");
      expect((algebra as any).where.triples).toHaveLength(0);
    });

    it("translates ASK with VALUES", () => {
      const query = `
        ASK WHERE {
          VALUES ?status { "active" "pending" }
          ?task <http://example.org/status> ?status .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("ask");
      expect((algebra as any).where.type).toBe("join");
    });
  });

  describe("IN / NOT IN Operators (Issue #718)", () => {
    it("translates IN operator with literal list", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/status> ?status .
          FILTER(?status IN ("active", "pending", "review"))
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const filter = (algebra as any).input;
      expect(filter.type).toBe("filter");
      expect(filter.expression.type).toBe("in");
      expect(filter.expression.negated).toBe(false);
      expect(filter.expression.expression.type).toBe("variable");
      expect(filter.expression.expression.name).toBe("status");
      expect(filter.expression.list).toHaveLength(3);
      expect(filter.expression.list[0].type).toBe("literal");
      expect(filter.expression.list[0].value).toBe("active");
    });

    it("translates NOT IN operator", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/status> ?status .
          FILTER(?status NOT IN ("blocked", "archived"))
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const filter = (algebra as any).input;
      expect(filter.type).toBe("filter");
      expect(filter.expression.type).toBe("in");
      expect(filter.expression.negated).toBe(true);
      expect(filter.expression.list).toHaveLength(2);
    });

    it("translates IN with numeric values", () => {
      const query = `
        SELECT ?x
        WHERE {
          ?s ?p ?x .
          FILTER(?x IN (1, 2, 3))
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const filter = (algebra as any).input;
      expect(filter.expression.type).toBe("in");
      expect(filter.expression.list).toHaveLength(3);
      expect(filter.expression.list[0].value).toBe(1);
      expect(filter.expression.list[1].value).toBe(2);
      expect(filter.expression.list[2].value).toBe(3);
    });

    it("translates IN with variable in list", () => {
      const query = `
        SELECT ?x
        WHERE {
          ?s ?p ?x .
          ?s <http://example.org/allowed> ?y .
          FILTER(?x IN (?y, "fallback"))
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const filter = (algebra as any).input;
      expect(filter.expression.type).toBe("in");
      expect(filter.expression.list).toHaveLength(2);
      expect(filter.expression.list[0].type).toBe("variable");
      expect(filter.expression.list[0].name).toBe("y");
      expect(filter.expression.list[1].type).toBe("literal");
    });

    it("translates IN with empty list", () => {
      const query = `
        SELECT ?x
        WHERE {
          ?s ?p ?x .
          FILTER(?x IN ())
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const filter = (algebra as any).input;
      expect(filter.expression.type).toBe("in");
      expect(filter.expression.list).toHaveLength(0);
    });

    it("translates IN combined with AND", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/status> ?status .
          ?task <http://example.org/priority> ?priority .
          FILTER(?status IN ("active", "pending") && ?priority > 5)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const filter = (algebra as any).input;
      expect(filter.type).toBe("filter");
      expect(filter.expression.type).toBe("logical");
      expect(filter.expression.operator).toBe("&&");
      expect(filter.expression.operands[0].type).toBe("in");
      expect(filter.expression.operands[1].type).toBe("comparison");
    });

    it("translates IN combined with OR", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/type> ?type .
          FILTER(?type IN ("urgent") || ?type = "critical")
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const filter = (algebra as any).input;
      expect(filter.expression.type).toBe("logical");
      expect(filter.expression.operator).toBe("||");
      expect(filter.expression.operands[0].type).toBe("in");
    });

    it("translates NOT IN with complex filter", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task <http://example.org/status> ?status .
          ?task <http://example.org/priority> ?priority .
          FILTER(?status NOT IN ("blocked", "archived") && ?priority > 0)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const filter = (algebra as any).input;
      expect(filter.expression.type).toBe("logical");
      expect(filter.expression.operands[0].type).toBe("in");
      expect(filter.expression.operands[0].negated).toBe(true);
    });
  });

  describe("SERVICE clause (Federated Query)", () => {
    it("translates simple SERVICE clause", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?name
        WHERE {
          ?s ex:label ?label .
          SERVICE <http://remote.example.org/sparql> {
            ?s ex:name ?name .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find the SERVICE operation
      const findService = (op: AlgebraOperation): any => {
        if (op.type === "service") return op;
        if ("input" in op) return findService((op as any).input);
        if ("left" in op) {
          const left = findService((op as any).left);
          if (left) return left;
          return findService((op as any).right);
        }
        if ("right" in op) return findService((op as any).right);
        return null;
      };

      const service = findService(algebra);
      expect(service).not.toBeNull();
      expect(service.type).toBe("service");
      expect(service.endpoint).toBe("http://remote.example.org/sparql");
      expect(service.silent).toBe(false);
      expect(service.pattern.type).toBe("bgp");
    });

    it("translates SERVICE SILENT clause", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?name
        WHERE {
          ?s ex:type ex:Task .
          SERVICE SILENT <http://remote.example.org/sparql> {
            ?s ex:name ?name .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find the SERVICE operation
      const findService = (op: AlgebraOperation): any => {
        if (op.type === "service") return op;
        if ("input" in op) return findService((op as any).input);
        if ("left" in op) {
          const left = findService((op as any).left);
          if (left) return left;
          return findService((op as any).right);
        }
        if ("right" in op) return findService((op as any).right);
        return null;
      };

      const service = findService(algebra);
      expect(service).not.toBeNull();
      expect(service.type).toBe("service");
      expect(service.silent).toBe(true);
    });

    it("translates SERVICE with multiple inner triples", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?name ?age
        WHERE {
          ?s ex:id ?id .
          SERVICE <http://remote.example.org/sparql> {
            ?s ex:name ?name .
            ?s ex:age ?age .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find the SERVICE operation
      const findService = (op: AlgebraOperation): any => {
        if (op.type === "service") return op;
        if ("input" in op) return findService((op as any).input);
        if ("left" in op) {
          const left = findService((op as any).left);
          if (left) return left;
          return findService((op as any).right);
        }
        if ("right" in op) return findService((op as any).right);
        return null;
      };

      const service = findService(algebra);
      expect(service).not.toBeNull();

      // The inner pattern should be a join of two BGPs
      expect(service.pattern).toBeDefined();
      // Could be BGP with 2 triples or join of 2 BGPs depending on sparqljs parsing
      if (service.pattern.type === "bgp") {
        expect(service.pattern.triples.length).toBeGreaterThanOrEqual(2);
      } else if (service.pattern.type === "join") {
        expect(service.pattern.left).toBeDefined();
        expect(service.pattern.right).toBeDefined();
      }
    });

    it("translates SERVICE with inner FILTER", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?label
        WHERE {
          ?s ex:type ex:Person .
          SERVICE <http://dbpedia.org/sparql> {
            ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label .
            FILTER(LANG(?label) = "en")
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find the SERVICE operation
      const findService = (op: AlgebraOperation): any => {
        if (op.type === "service") return op;
        if ("input" in op) return findService((op as any).input);
        if ("left" in op) {
          const left = findService((op as any).left);
          if (left) return left;
          return findService((op as any).right);
        }
        if ("right" in op) return findService((op as any).right);
        return null;
      };

      const service = findService(algebra);
      expect(service).not.toBeNull();

      // Find filter inside service pattern
      const findFilter = (op: any): any => {
        if (op.type === "filter") return op;
        if ("input" in op) return findFilter(op.input);
        if ("left" in op) {
          const left = findFilter(op.left);
          if (left) return left;
          return findFilter(op.right);
        }
        return null;
      };

      const filter = findFilter(service.pattern);
      expect(filter).not.toBeNull();
      expect(filter.type).toBe("filter");
    });

    it("translates multiple SERVICE clauses", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?nameA ?nameB
        WHERE {
          ?s ex:id ?id .
          SERVICE <http://endpointA.example.org/sparql> {
            ?s ex:nameA ?nameA .
          }
          SERVICE <http://endpointB.example.org/sparql> {
            ?s ex:nameB ?nameB .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find all SERVICE operations
      const findAllServices = (op: AlgebraOperation, services: any[] = []): any[] => {
        if (op.type === "service") services.push(op);
        if ("input" in op) findAllServices((op as any).input, services);
        if ("left" in op) {
          findAllServices((op as any).left, services);
          findAllServices((op as any).right, services);
        }
        if ("right" in op && !("left" in op)) findAllServices((op as any).right, services);
        return services;
      };

      const services = findAllServices(algebra);
      expect(services.length).toBe(2);

      const endpoints = services.map((s) => s.endpoint).sort();
      expect(endpoints).toContain("http://endpointA.example.org/sparql");
      expect(endpoints).toContain("http://endpointB.example.org/sparql");
    });

    it("translates SERVICE within OPTIONAL", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?name ?remoteData
        WHERE {
          ?s ex:name ?name .
          OPTIONAL {
            SERVICE <http://remote.example.org/sparql> {
              ?s ex:remoteData ?remoteData .
            }
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find the SERVICE operation (should be inside a leftjoin)
      const findService = (op: AlgebraOperation): any => {
        if (op.type === "service") return op;
        if ("input" in op) return findService((op as any).input);
        if ("left" in op) {
          const left = findService((op as any).left);
          if (left) return left;
          return findService((op as any).right);
        }
        if ("right" in op) return findService((op as any).right);
        return null;
      };

      const service = findService(algebra);
      expect(service).not.toBeNull();
      expect(service.type).toBe("service");
    });
  });

  describe("GRAPH clause (Named Graphs)", () => {
    it("translates GRAPH with concrete IRI", () => {
      const query = `
        SELECT ?s ?p ?o
        WHERE {
          GRAPH <http://example.org/graph1> {
            ?s ?p ?o
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("graph");
      expect(input.name.type).toBe("iri");
      expect(input.name.value).toBe("http://example.org/graph1");
      expect(input.pattern.type).toBe("bgp");
    });

    it("translates GRAPH with variable", () => {
      const query = `
        SELECT ?g ?s ?p ?o
        WHERE {
          GRAPH ?g {
            ?s ?p ?o
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("graph");
      expect(input.name.type).toBe("variable");
      expect(input.name.value).toBe("g");
      expect(input.pattern.type).toBe("bgp");
    });

    it("translates GRAPH with PREFIX declarations", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?p ?o
        WHERE {
          GRAPH ex:myGraph {
            ?s ?p ?o
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("graph");
      expect(input.name.type).toBe("iri");
      expect(input.name.value).toBe("http://example.org/myGraph");
    });

    it("translates GRAPH with multiple inner triples", () => {
      const query = `
        SELECT ?s ?name ?age
        WHERE {
          GRAPH <http://example.org/data> {
            ?s <http://example.org/name> ?name .
            ?s <http://example.org/age> ?age .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("graph");
      expect(input.pattern.type).toBe("bgp");
      expect(input.pattern.triples).toHaveLength(2);
    });

    it("translates GRAPH with inner FILTER", () => {
      const query = `
        SELECT ?s ?value
        WHERE {
          GRAPH <http://example.org/data> {
            ?s <http://example.org/value> ?value .
            FILTER(?value > 10)
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("graph");
      expect(input.pattern.type).toBe("filter");
      expect(input.pattern.input.type).toBe("bgp");
    });

    it("translates GRAPH with inner OPTIONAL", () => {
      const query = `
        SELECT ?s ?name ?email
        WHERE {
          GRAPH <http://example.org/people> {
            ?s <http://example.org/name> ?name .
            OPTIONAL { ?s <http://example.org/email> ?email }
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("graph");
      expect(input.pattern.type).toBe("join");
    });

    it("translates multiple GRAPH clauses", () => {
      const query = `
        SELECT ?s ?name1 ?name2
        WHERE {
          GRAPH <http://example.org/graph1> {
            ?s <http://example.org/name> ?name1 .
          }
          GRAPH <http://example.org/graph2> {
            ?s <http://example.org/name> ?name2 .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find all GRAPH operations
      const findAllGraphs = (op: AlgebraOperation, graphs: any[] = []): any[] => {
        if (op.type === "graph") graphs.push(op);
        if ("input" in op) findAllGraphs((op as any).input, graphs);
        if ("left" in op) {
          findAllGraphs((op as any).left, graphs);
          findAllGraphs((op as any).right, graphs);
        }
        if ("right" in op && !("left" in op)) findAllGraphs((op as any).right, graphs);
        return graphs;
      };

      const graphs = findAllGraphs(algebra);
      expect(graphs.length).toBe(2);

      const graphNames = graphs.map((g) => g.name.value).sort();
      expect(graphNames).toContain("http://example.org/graph1");
      expect(graphNames).toContain("http://example.org/graph2");
    });

    it("translates GRAPH combined with default graph patterns", () => {
      const query = `
        SELECT ?s ?defaultValue ?graphValue
        WHERE {
          ?s <http://example.org/defaultProp> ?defaultValue .
          GRAPH <http://example.org/namedGraph> {
            ?s <http://example.org/graphProp> ?graphValue .
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("join");

      // One side should be BGP (default graph), other should be GRAPH
      const hasGraph = input.left?.type === "graph" || input.right?.type === "graph";
      const hasBGP = input.left?.type === "bgp" || input.right?.type === "bgp";
      expect(hasGraph).toBe(true);
      expect(hasBGP).toBe(true);
    });

    it("translates GRAPH within OPTIONAL", () => {
      const query = `
        SELECT ?s ?name ?remoteData
        WHERE {
          ?s <http://example.org/name> ?name .
          OPTIONAL {
            GRAPH <http://example.org/external> {
              ?s <http://example.org/remoteData> ?remoteData .
            }
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      // Find the GRAPH operation (should be inside a leftjoin)
      const findGraph = (op: AlgebraOperation): any => {
        if (op.type === "graph") return op;
        if ("input" in op) return findGraph((op as any).input);
        if ("left" in op) {
          const left = findGraph((op as any).left);
          if (left) return left;
          return findGraph((op as any).right);
        }
        if ("right" in op) return findGraph((op as any).right);
        return null;
      };

      const graph = findGraph(algebra);
      expect(graph).not.toBeNull();
      expect(graph.type).toBe("graph");
      expect(graph.name.value).toBe("http://example.org/external");
    });

    it("translates nested GRAPH within UNION", () => {
      const query = `
        SELECT ?s ?value
        WHERE {
          {
            GRAPH <http://example.org/graph1> {
              ?s <http://example.org/value> ?value .
            }
          }
          UNION
          {
            GRAPH <http://example.org/graph2> {
              ?s <http://example.org/value> ?value .
            }
          }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("project");
      const input = (algebra as any).input;
      expect(input.type).toBe("union");
      expect(input.left.type).toBe("graph");
      expect(input.right.type).toBe("graph");
    });

    it("throws error for GRAPH without name", () => {
      // Manually create an invalid AST to test error handling
      // sparqljs won't produce this, but our code should handle it gracefully
      const invalidAst: any = {
        type: "query",
        queryType: "SELECT",
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "graph",
            name: null, // Invalid: missing name
            patterns: [{ type: "bgp", triples: [] }],
          },
        ],
      };

      expect(() => translator.translate(invalidAst)).toThrow(AlgebraTranslatorError);
    });

    it("throws error for GRAPH without patterns", () => {
      // Manually create an invalid AST
      const invalidAst: any = {
        type: "query",
        queryType: "SELECT",
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "graph",
            name: { termType: "NamedNode", value: "http://example.org/g" },
            patterns: null, // Invalid: missing patterns
          },
        ],
      };

      expect(() => translator.translate(invalidAst)).toThrow(AlgebraTranslatorError);
    });
  });
});
