import { SPARQLGenerator } from "../../../../../src/infrastructure/sparql/algebra/SPARQLGenerator";
import type {
  BGPOperation,
  FilterOperation,
  JoinOperation,
  LeftJoinOperation,
  ValuesOperation,
  ExtendOperation,
} from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("SPARQLGenerator", () => {
  let generator: SPARQLGenerator;

  beforeEach(() => {
    generator = new SPARQLGenerator();
  });

  describe("generateSelect", () => {
    it("should generate SELECT query from BGP", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/name" },
            object: { type: "variable", value: "name" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("SELECT");
      expect(result).toContain("?s");
      expect(result).toContain("?name");
      expect(result).toContain("WHERE");
      expect(result).toContain("<http://example.org/name>");
    });

    it("should generate SELECT * for operations with no variables", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("SELECT *");
    });
  });

  describe("BGP generation", () => {
    it("should generate simple triple pattern", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Person" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Person>");
    });

    it("should generate multiple triple patterns", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/name" },
            object: { type: "variable", value: "name" },
          },
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/age" },
            object: { type: "variable", value: "age" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("<http://example.org/name>");
      expect(result).toContain("<http://example.org/age>");
    });

    it("should escape special characters in literals", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "literal", value: 'Hello "World"\nNew Line' },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain('\\"'); // Escaped quote
      expect(result).toContain('\\n'); // Escaped newline
    });

    it("should generate language-tagged literals", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "literal", value: "Bonjour", language: "fr" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain('"Bonjour"@fr');
    });

    it("should generate typed literals", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/count" },
            object: { type: "literal", value: "42", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain('"42"^^<http://www.w3.org/2001/XMLSchema#integer>');
    });

    it("should generate blank nodes", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "blank", value: "b0" },
            predicate: { type: "iri", value: "http://example.org/name" },
            object: { type: "variable", value: "name" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("_:b0");
    });
  });

  describe("FILTER generation", () => {
    it("should generate comparison filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: { type: "variable", name: "age" },
          right: { type: "literal", value: 18 },
        },
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/age" },
              object: { type: "variable", value: "age" },
            },
          ],
        },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("FILTER");
      expect(result).toContain("?age");
      expect(result).toContain(">");
      expect(result).toContain("18");
    });

    it("should generate logical AND filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "&&",
          operands: [
            {
              type: "comparison",
              operator: ">",
              left: { type: "variable", name: "x" },
              right: { type: "literal", value: 0 },
            },
            {
              type: "comparison",
              operator: "<",
              left: { type: "variable", name: "x" },
              right: { type: "literal", value: 100 },
            },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("&&");
    });

    it("should generate NOT filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "!",
          operands: [
            {
              type: "comparison",
              operator: "=",
              left: { type: "variable", name: "x" },
              right: { type: "literal", value: "test" },
            },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("!(");
    });

    it("should generate function call in filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "bound",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("BOUND(?x)");
    });
  });

  describe("OPTIONAL (LeftJoin) generation", () => {
    it("should generate OPTIONAL clause", () => {
      const operation: LeftJoinOperation = {
        type: "leftjoin",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/name" },
              object: { type: "variable", value: "name" },
            },
          ],
        },
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/email" },
              object: { type: "variable", value: "email" },
            },
          ],
        },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("OPTIONAL");
      expect(result).toContain("?email");
    });
  });

  describe("VALUES generation", () => {
    it("should generate single-variable VALUES", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["status"],
        bindings: [
          { status: { type: "literal", value: "active" } },
          { status: { type: "literal", value: "pending" } },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("VALUES ?status");
      expect(result).toContain('"active"');
      expect(result).toContain('"pending"');
    });

    it("should generate multi-variable VALUES", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x", "y"],
        bindings: [
          { x: { type: "literal", value: "1" }, y: { type: "literal", value: "2" } },
          { x: { type: "literal", value: "3" }, y: { type: "literal", value: "4" } },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("VALUES (?x ?y)");
      expect(result).toMatch(/\("1"\s+"2"\)/);
      expect(result).toMatch(/\("3"\s+"4"\)/);
    });

    it("should generate UNDEF for missing bindings", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x", "y"],
        bindings: [
          { x: { type: "literal", value: "1" } }, // y is UNDEF
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("UNDEF");
    });
  });

  describe("BIND generation", () => {
    it("should generate BIND clause", () => {
      const operation: ExtendOperation = {
        type: "extend",
        variable: "doubled",
        expression: {
          type: "arithmetic",
          operator: "*",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 2 },
        },
        input: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/value" },
              object: { type: "variable", value: "x" },
            },
          ],
        },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("BIND");
      expect(result).toContain("?doubled");
      expect(result).toContain("*");
    });
  });

  describe("JOIN generation", () => {
    it("should generate joined patterns", () => {
      const operation: JoinOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/name" },
              object: { type: "variable", value: "name" },
            },
          ],
        },
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/age" },
              object: { type: "variable", value: "age" },
            },
          ],
        },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("<http://example.org/name>");
      expect(result).toContain("<http://example.org/age>");
    });
  });

  describe("Variable collection", () => {
    it("should collect variables from BGP", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/prop" },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const variables = generator.collectVariables(operation);

      expect(variables).toContain("s");
      expect(variables).toContain("o");
      expect(variables.size).toBe(2);
    });

    it("should collect variables from nested operations", () => {
      const operation: JoinOperation = {
        type: "join",
        left: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "a" },
              predicate: { type: "iri", value: "http://example.org/prop" },
              object: { type: "variable", value: "b" },
            },
          ],
        },
        right: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "b" },
              predicate: { type: "iri", value: "http://example.org/prop" },
              object: { type: "variable", value: "c" },
            },
          ],
        },
      };

      const variables = generator.collectVariables(operation);

      expect(variables).toContain("a");
      expect(variables).toContain("b");
      expect(variables).toContain("c");
      expect(variables.size).toBe(3);
    });
  });

  describe("Property paths", () => {
    it("should generate sequence path", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: {
              type: "path",
              pathType: "/",
              items: [
                { type: "iri", value: "http://example.org/a" },
                { type: "iri", value: "http://example.org/b" },
              ],
            },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("<http://example.org/a>/<http://example.org/b>");
    });

    it("should generate alternative path", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: {
              type: "path",
              pathType: "|",
              items: [
                { type: "iri", value: "http://example.org/a" },
                { type: "iri", value: "http://example.org/b" },
              ],
            },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("<http://example.org/a>|<http://example.org/b>");
    });

    it("should generate inverse path", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: {
              type: "path",
              pathType: "^",
              items: [{ type: "iri", value: "http://example.org/prop" }],
            },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("^<http://example.org/prop>");
    });

    it("should generate oneOrMore path", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: {
              type: "path",
              pathType: "+",
              items: [{ type: "iri", value: "http://example.org/subClassOf" }],
            },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("<http://example.org/subClassOf>+");
    });
  });

  describe("IN expression", () => {
    it("should generate IN filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "in",
          expression: { type: "variable", name: "status" },
          list: [
            { type: "literal", value: "active" },
            { type: "literal", value: "pending" },
          ],
          negated: false,
        },
        input: { type: "bgp", triples: [] },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("?status IN");
      expect(result).toContain('"active"');
      expect(result).toContain('"pending"');
    });

    it("should generate NOT IN filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "in",
          expression: { type: "variable", name: "status" },
          list: [
            { type: "literal", value: "deleted" },
          ],
          negated: true,
        },
        input: { type: "bgp", triples: [] },
      };

      const result = generator.generateSelect(operation);

      expect(result).toContain("NOT IN");
    });
  });
});
