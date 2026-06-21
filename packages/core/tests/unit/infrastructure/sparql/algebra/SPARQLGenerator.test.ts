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

  describe("UNION generation", () => {
    it("should generate UNION clause", () => {
      const operation = {
        type: "union" as const,
        left: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/type" },
            object: { type: "iri" as const, value: "http://example.org/Task" },
          }],
        },
        right: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/type" },
            object: { type: "iri" as const, value: "http://example.org/Project" },
          }],
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("UNION");
    });
  });

  describe("EXISTS expression", () => {
    it("should generate EXISTS filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          pattern: {
            type: "bgp",
            triples: [{
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/done" },
              object: { type: "variable", value: "d" },
            }],
          },
          negated: false,
        },
        input: { type: "bgp", triples: [] },
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("EXISTS");
      expect(result).not.toContain("NOT EXISTS");
    });

    it("should generate NOT EXISTS filter", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          pattern: {
            type: "bgp",
            triples: [{
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/done" },
              object: { type: "variable", value: "d" },
            }],
          },
          negated: true,
        },
        input: { type: "bgp", triples: [] },
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("NOT EXISTS");
    });
  });

  describe("literal types in expressions", () => {
    it("should generate boolean true literal", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: true },
        },
        input: { type: "bgp", triples: [] },
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("true");
    });

    it("should generate boolean false literal", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: false },
        },
        input: { type: "bgp", triples: [] },
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("false");
    });

    it("should generate string literal with special characters", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 'he said "hi\\n"' },
        },
        input: { type: "bgp", triples: [] },
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain('\\"');
      expect(result).toContain('\\\\');
    });
  });

  describe("subquery generation", () => {
    it("should generate subquery", () => {
      const operation = {
        type: "subquery" as const,
        query: {
          type: "project" as const,
          variables: ["s"],
          input: {
            type: "bgp" as const,
            triples: [{
              subject: { type: "variable" as const, value: "s" },
              predicate: { type: "iri" as const, value: "http://example.org/type" },
              object: { type: "iri" as const, value: "http://example.org/Task" },
            }],
          },
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("SELECT");
    });
  });

  describe("error handling", () => {
    it("should throw for unsupported operation type", () => {
      const operation = { type: "unsupported_type" } as any;
      expect(() => generator.generateSelect(operation)).toThrow("Unsupported operation type");
    });

    it("should throw for unknown element type", () => {
      const operation = {
        type: "bgp" as const,
        triples: [{
          subject: { type: "unknown_thing" as any, value: "x" },
          predicate: { type: "iri" as const, value: "http://example.org/p" },
          object: { type: "variable" as const, value: "o" },
        }],
      };
      expect(() => generator.generateSelect(operation as any)).toThrow("Unknown element type");
    });

    it("should throw for unknown expression type", () => {
      const operation = {
        type: "filter",
        expression: { type: "custom_unknown" },
        input: { type: "bgp", triples: [] },
      } as any;
      expect(() => generator.generateSelect(operation)).toThrow("Unknown expression type");
    });
  });

  describe("functionCall expression", () => {
    it("should generate functionCall with string function name", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "functionCall" as any,
          function: "custom_fn",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("CUSTOM_FN(?x)");
    });

    it("should generate functionCall with IRI function name", () => {
      const operation = {
        type: "filter",
        expression: {
          type: "functionCall",
          function: { termType: "NamedNode", value: "myFunc" },
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      } as any;
      const result = generator.generateSelect(operation);
      expect(result).toContain("MYFUNC");
    });
  });

  describe("VALUES edge cases", () => {
    it("should return empty string for VALUES with empty variables", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: [],
        bindings: [],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("SELECT");
    });

    it("should handle UNDEF in single variable VALUES", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x"],
        bindings: [
          { x: { type: "iri" as any, value: "http://example.org/a" } },
          {}, // x is UNDEF
        ],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("UNDEF");
      expect(result).toContain("<http://example.org/a>");
    });

    it("should handle IRI values in VALUES", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x"],
        bindings: [
          { x: { type: "iri" as any, value: "http://example.org/a" } },
        ],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("<http://example.org/a>");
    });

    it("should handle literal with language in VALUES", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x"],
        bindings: [
          { x: { type: "literal" as any, value: "hello", language: "en" } },
        ],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain('"hello"@en');
    });

    it("should handle literal with datatype in VALUES", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x"],
        bindings: [
          { x: { type: "literal" as any, value: "42", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
        ],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain('^^<http://www.w3.org/2001/XMLSchema#integer>');
    });
  });

  describe("property path edge cases", () => {
    it("should generate zeroOrMore path (*)", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: {
            type: "path" as any,
            pathType: "*",
            items: [{ type: "iri", value: "http://example.org/subClassOf" }],
          },
          object: { type: "variable", value: "o" },
        }],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("<http://example.org/subClassOf>*");
    });

    it("should generate zeroOrOne path (?)", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: {
            type: "path" as any,
            pathType: "?",
            items: [{ type: "iri", value: "http://example.org/label" }],
          },
          object: { type: "variable", value: "o" },
        }],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("<http://example.org/label>?");
    });

    it("should generate nested property path", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: {
            type: "path" as any,
            pathType: "/",
            items: [
              { type: "path" as any, pathType: "^", items: [{ type: "iri", value: "http://example.org/parent" }] },
              { type: "iri", value: "http://example.org/name" },
            ],
          },
          object: { type: "variable", value: "o" },
        }],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("(^");
    });
  });

  describe("variable collection edge cases", () => {
    it("should collect variables from FILTER expression", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 10 },
        },
        input: {
          type: "bgp",
          triples: [{
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/x" },
            object: { type: "variable", value: "x" },
          }],
        },
      };
      const vars = generator.collectVariables(operation);
      expect(vars.has("x")).toBe(true);
      expect(vars.has("s")).toBe(true);
    });

    it("should collect variables from EXTEND operation", () => {
      const operation: ExtendOperation = {
        type: "extend",
        variable: "doubled",
        expression: {
          type: "arithmetic",
          operator: "*",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 2 },
        },
        input: { type: "bgp", triples: [] },
      };
      const vars = generator.collectVariables(operation);
      expect(vars.has("doubled")).toBe(true);
    });

    it("should collect variables from VALUES", () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["a", "b"],
        bindings: [],
      };
      const vars = generator.collectVariables(operation);
      expect(vars.has("a")).toBe(true);
      expect(vars.has("b")).toBe(true);
    });

    it("should collect variables from logical expression", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "&&",
          operands: [
            { type: "variable", name: "x" },
            { type: "variable", name: "y" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };
      const vars = generator.collectVariables(operation);
      expect(vars.has("x")).toBe(true);
      expect(vars.has("y")).toBe(true);
    });

    it("should collect variables from EXISTS pattern", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          pattern: {
            type: "bgp",
            triples: [{
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/p" },
              object: { type: "variable", value: "inner" },
            }],
          },
          negated: false,
        },
        input: { type: "bgp", triples: [] },
      };
      const vars = generator.collectVariables(operation);
      expect(vars.has("s")).toBe(true);
      expect(vars.has("inner")).toBe(true);
    });

    it("should collect variables from IN expression", () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "in",
          expression: { type: "variable", name: "status" },
          list: [
            { type: "literal", value: "active" },
            { type: "variable", name: "other" },
          ],
          negated: false,
        },
        input: { type: "bgp", triples: [] },
      };
      const vars = generator.collectVariables(operation);
      expect(vars.has("status")).toBe(true);
      expect(vars.has("other")).toBe(true);
    });

    it("should collect variables from GROUP operation", () => {
      const operation = {
        type: "group" as const,
        variables: ["status"],
        aggregates: [{ variable: "cnt", expression: { aggregation: "count", distinct: false } }],
        input: { type: "bgp" as const, triples: [] },
      };
      const vars = generator.collectVariables(operation as any);
      expect(vars.has("status")).toBe(true);
      expect(vars.has("cnt")).toBe(true);
    });

    it("should collect variables from subquery", () => {
      const operation = {
        type: "subquery" as const,
        query: {
          type: "project" as const,
          variables: ["inner"],
          input: { type: "bgp" as const, triples: [] },
        },
      };
      const vars = generator.collectVariables(operation as any);
      expect(vars.has("inner")).toBe(true);
    });

    it("should collect variables from predicate variable", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "variable", value: "p" },
          object: { type: "variable", value: "o" },
        }],
      };
      const vars = generator.collectVariables(operation);
      expect(vars.has("p")).toBe(true);
    });
  });

  describe("literal escape in element generation", () => {
    it("should escape backslash and tab in literals", () => {
      const operation: BGPOperation = {
        type: "bgp",
        triples: [{
          subject: { type: "variable", value: "s" },
          predicate: { type: "iri", value: "http://example.org/p" },
          object: { type: "literal", value: "a\\b\tc\rd" },
        }],
      };
      const result = generator.generateSelect(operation);
      expect(result).toContain("\\\\");
      expect(result).toContain("\\t");
      expect(result).toContain("\\r");
    });
  });

  describe("where clause pass-through operations", () => {
    it("should handle project in where clause", () => {
      const operation = {
        type: "project" as const,
        variables: ["s"],
        input: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/p" },
            object: { type: "variable" as const, value: "o" },
          }],
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("?s");
    });

    it("should handle distinct in where clause", () => {
      const operation = {
        type: "distinct" as const,
        input: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/p" },
            object: { type: "variable" as const, value: "o" },
          }],
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("?s");
    });

    it("should handle orderby in where clause", () => {
      const operation = {
        type: "orderby" as const,
        comparators: [],
        input: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/p" },
            object: { type: "variable" as const, value: "o" },
          }],
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("?s");
    });

    it("should handle slice in where clause", () => {
      const operation = {
        type: "slice" as const,
        offset: 0,
        limit: 10,
        input: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/p" },
            object: { type: "variable" as const, value: "o" },
          }],
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("?s");
    });

    it("should handle group in where clause", () => {
      const operation = {
        type: "group" as const,
        variables: ["s"],
        aggregates: [],
        input: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/p" },
            object: { type: "variable" as const, value: "o" },
          }],
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("?s");
    });

    it("should handle reduced in where clause", () => {
      const operation = {
        type: "reduced" as const,
        input: {
          type: "bgp" as const,
          triples: [{
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/p" },
            object: { type: "variable" as const, value: "o" },
          }],
        },
      };
      const result = generator.generateSelect(operation as any);
      expect(result).toContain("?s");
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
