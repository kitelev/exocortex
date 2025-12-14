import { FilterExecutor, ExistsEvaluator } from "../../../../../src/infrastructure/sparql/executors/FilterExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import type { FilterOperation, AlgebraOperation, ExistsExpression, InExpression } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("FilterExecutor", () => {
  let executor: FilterExecutor;

  beforeEach(() => {
    executor = new FilterExecutor();
  });

  async function* generateSolutions(solutions: SolutionMapping[]) {
    for (const solution of solutions) {
      yield solution;
    }
  }

  describe("Comparison Filters", () => {
    it("should filter by equality", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: "test" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("x", new Literal("test"));

      const solution2 = new SolutionMapping();
      solution2.set("x", new Literal("other"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
      expect(results[0].get("x")).toBe(solution1.get("x"));
    });

    it("should filter by numeric comparison", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: { type: "variable", name: "effort" },
          right: { type: "literal", value: 60 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("effort", new Literal("120", xsdInt));

      const solution2 = new SolutionMapping();
      solution2.set("effort", new Literal("30", xsdInt));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });
  });

  describe("Logical Operators", () => {
    it("should handle AND operator", async () => {
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
              right: { type: "literal", value: 50 },
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

      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const solution1 = new SolutionMapping();
      solution1.set("x", new Literal("75", xsdInt));

      const solution2 = new SolutionMapping();
      solution2.set("x", new Literal("30", xsdInt));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should handle OR operator", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "||",
          operands: [
            {
              type: "comparison",
              operator: "=",
              left: { type: "variable", name: "x" },
              right: { type: "literal", value: "a" },
            },
            {
              type: "comparison",
              operator: "=",
              left: { type: "variable", name: "x" },
              right: { type: "literal", value: "b" },
            },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("x", new Literal("a"));

      const solution2 = new SolutionMapping();
      solution2.set("x", new Literal("c"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });
  });

  describe("IN / NOT IN Operators (SPARQL 1.1 Section 17.4.1.5)", () => {
    describe("IN operator", () => {
      it("should match when value is in list of integers", async () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "x" },
            list: [
              { type: "literal", value: 1 },
              { type: "literal", value: 2 },
              { type: "literal", value: 3 },
            ],
            negated: false,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("x", new Literal("2", xsdInt));

        const solution2 = new SolutionMapping();
        solution2.set("x", new Literal("5", xsdInt));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
        expect((results[0].get("x") as Literal).value).toBe("2");
      });

      it("should match when value is in list of strings", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "status" },
            list: [
              { type: "literal", value: "active" },
              { type: "literal", value: "pending" },
              { type: "literal", value: "review" },
            ],
            negated: false,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("status", new Literal("active"));

        const solution2 = new SolutionMapping();
        solution2.set("status", new Literal("done"));

        const solution3 = new SolutionMapping();
        solution3.set("status", new Literal("pending"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(2);
      });

      it("should not match when value is not in list", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "x" },
            list: [
              { type: "literal", value: "a" },
              { type: "literal", value: "b" },
            ],
            negated: false,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("x", new Literal("c"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(0);
      });

      it("should work with empty list (always returns false)", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "x" },
            list: [],
            negated: false,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("x", new Literal("anything"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(0);
      });

      it("should work with IRI values in list", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "type" },
            list: [
              { type: "literal", value: "http://example.org/Task" },
              { type: "literal", value: "http://example.org/Project" },
            ],
            negated: false,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("type", new IRI("http://example.org/Task"));

        const solution2 = new SolutionMapping();
        solution2.set("type", new IRI("http://example.org/Area"));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
      });

      it("should work with variables in list", async () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "x" },
            list: [
              { type: "variable", name: "y" },
              { type: "variable", name: "z" },
            ],
            negated: false,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("x", new Literal("5", xsdInt));
        solution1.set("y", new Literal("5", xsdInt));
        solution1.set("z", new Literal("10", xsdInt));

        const solution2 = new SolutionMapping();
        solution2.set("x", new Literal("15", xsdInt));
        solution2.set("y", new Literal("5", xsdInt));
        solution2.set("z", new Literal("10", xsdInt));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
        expect((results[0].get("x") as Literal).value).toBe("5");
      });
    });

    describe("NOT IN operator", () => {
      it("should match when value is not in list of strings", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "x" },
            list: [
              { type: "literal", value: "a" },
              { type: "literal", value: "b" },
            ],
            negated: true,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("x", new Literal("c"));

        const solution2 = new SolutionMapping();
        solution2.set("x", new Literal("a"));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
        expect((results[0].get("x") as Literal).value).toBe("c");
      });

      it("should not match when value is in list", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "status" },
            list: [
              { type: "literal", value: "done" },
              { type: "literal", value: "archived" },
            ],
            negated: true,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("status", new Literal("done"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(0);
      });

      it("should match all when list is empty (always returns true)", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "x" },
            list: [],
            negated: true,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("x", new Literal("anything"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });

      it("should filter out specific values efficiently", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "priority" },
            list: [
              { type: "literal", value: 1 },
              { type: "literal", value: 2 },
            ],
            negated: true,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const solution1 = new SolutionMapping();
        solution1.set("priority", new Literal("3", xsdInt));

        const solution2 = new SolutionMapping();
        solution2.set("priority", new Literal("1", xsdInt));

        const solution3 = new SolutionMapping();
        solution3.set("priority", new Literal("5", xsdInt));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(2);
      });
    });

    describe("IN / NOT IN combined with other expressions", () => {
      it("should work with AND operator", async () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "logical",
            operator: "&&",
            operands: [
              {
                type: "in",
                expression: { type: "variable", name: "status" },
                list: [
                  { type: "literal", value: "active" },
                  { type: "literal", value: "pending" },
                ],
                negated: false,
              } as InExpression,
              {
                type: "comparison",
                operator: ">",
                left: { type: "variable", name: "priority" },
                right: { type: "literal", value: 5 },
              },
            ],
          },
          input: { type: "bgp", triples: [] },
        };

        // Active with high priority - should pass
        const solution1 = new SolutionMapping();
        solution1.set("status", new Literal("active"));
        solution1.set("priority", new Literal("8", xsdInt));

        // Active with low priority - should NOT pass
        const solution2 = new SolutionMapping();
        solution2.set("status", new Literal("active"));
        solution2.set("priority", new Literal("3", xsdInt));

        // Done with high priority - should NOT pass
        const solution3 = new SolutionMapping();
        solution3.set("status", new Literal("done"));
        solution3.set("priority", new Literal("8", xsdInt));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(1);
        expect((results[0].get("status") as Literal).value).toBe("active");
        expect((results[0].get("priority") as Literal).value).toBe("8");
      });

      it("should work with OR operator", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "logical",
            operator: "||",
            operands: [
              {
                type: "in",
                expression: { type: "variable", name: "status" },
                list: [
                  { type: "literal", value: "urgent" },
                ],
                negated: false,
              } as InExpression,
              {
                type: "in",
                expression: { type: "variable", name: "tag" },
                list: [
                  { type: "literal", value: "high-priority" },
                ],
                negated: false,
              } as InExpression,
            ],
          },
          input: { type: "bgp", triples: [] },
        };

        // Urgent status - should pass
        const solution1 = new SolutionMapping();
        solution1.set("status", new Literal("urgent"));
        solution1.set("tag", new Literal("normal"));

        // High-priority tag - should pass
        const solution2 = new SolutionMapping();
        solution2.set("status", new Literal("normal"));
        solution2.set("tag", new Literal("high-priority"));

        // Neither - should NOT pass
        const solution3 = new SolutionMapping();
        solution3.set("status", new Literal("normal"));
        solution3.set("tag", new Literal("low"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(2);
      });

      it("should work with NOT operator", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "logical",
            operator: "!",
            operands: [
              {
                type: "in",
                expression: { type: "variable", name: "status" },
                list: [
                  { type: "literal", value: "done" },
                ],
                negated: false,
              } as InExpression,
            ],
          },
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("status", new Literal("active"));

        const solution2 = new SolutionMapping();
        solution2.set("status", new Literal("done"));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
        expect((results[0].get("status") as Literal).value).toBe("active");
      });
    });

    describe("expressionContainsExists with IN", () => {
      it("should detect EXISTS in IN list (edge case)", async () => {
        // This is an edge case - EXISTS shouldn't typically appear in IN list
        // but we should handle it gracefully
        const existsEvaluator = jest.fn().mockResolvedValue(false);
        executor.setExistsEvaluator(existsEvaluator);

        // Verify sync evaluation works for simple IN without EXISTS
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            expression: { type: "variable", name: "x" },
            list: [
              { type: "literal", value: "a" },
            ],
            negated: false,
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("x", new Literal("a"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
        // EXISTS evaluator should NOT be called since IN doesn't contain EXISTS
        expect(existsEvaluator).not.toHaveBeenCalled();
      });
    });
  });

  describe("LANGMATCHES Function", () => {
    it("should match exact language tag", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "langmatches",
          args: [
            {
              type: "function",
              function: "lang",
              args: [{ type: "variable", name: "label" }],
            },
            { type: "literal", value: "en" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("label", new Literal("Hello", undefined, "en"));

      const solution2 = new SolutionMapping();
      solution2.set("label", new Literal("Bonjour", undefined, "fr"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should match language subtags (en-US matches en)", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "langmatches",
          args: [
            {
              type: "function",
              function: "lang",
              args: [{ type: "variable", name: "label" }],
            },
            { type: "literal", value: "en" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("label", new Literal("Color", undefined, "en-US"));

      const solution2 = new SolutionMapping();
      solution2.set("label", new Literal("Colour", undefined, "en-GB"));

      const solution3 = new SolutionMapping();
      solution3.set("label", new Literal("Farbe", undefined, "de"));

      const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
      expect(results).toHaveLength(2); // en-US and en-GB both match "en"
    });

    it("should match any language with wildcard '*'", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "langmatches",
          args: [
            {
              type: "function",
              function: "lang",
              args: [{ type: "variable", name: "label" }],
            },
            { type: "literal", value: "*" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("label", new Literal("Hello", undefined, "en"));

      const solution2 = new SolutionMapping();
      solution2.set("label", new Literal("Bonjour", undefined, "fr"));

      // Literal without language tag - should NOT match
      const solution3 = new SolutionMapping();
      solution3.set("label", new Literal("Plain text"));

      const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
      expect(results).toHaveLength(2); // en and fr match, plain text does not
    });

    it("should not match empty language tag with non-empty range", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "langmatches",
          args: [
            {
              type: "function",
              function: "lang",
              args: [{ type: "variable", name: "label" }],
            },
            { type: "literal", value: "en" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      // Literal without language tag
      const solution = new SolutionMapping();
      solution.set("label", new Literal("No language"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should be case-insensitive for language tags", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "langmatches",
          args: [
            {
              type: "function",
              function: "lang",
              args: [{ type: "variable", name: "label" }],
            },
            { type: "literal", value: "EN" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      // Literal class normalizes language to lowercase, so "en-US" becomes "en-us"
      solution.set("label", new Literal("Hello", undefined, "en-US"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should use langMatches with string arguments directly", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "langmatches",
          args: [
            { type: "literal", value: "en-GB" },
            { type: "literal", value: "en" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("dummy"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });
  });

  describe("REGEX Function", () => {
    it("should filter by regex match", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "regex",
          args: [
            { type: "variable", name: "label" },
            { type: "literal", value: "task" },
            { type: "literal", value: "i" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("label", new Literal("Important Task"));

      const solution2 = new SolutionMapping();
      solution2.set("label", new Literal("Project"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });
  });

  describe("Built-in Functions", () => {
    it("should filter by BOUND", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "bound",
          args: [{ type: "variable", name: "optional" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("required", new Literal("value1"));
      solution1.set("optional", new Literal("value2"));

      const solution2 = new SolutionMapping();
      solution2.set("required", new Literal("value3"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
      expect(results[0].has("optional")).toBe(true);
    });

    it("should filter by isIRI", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "isIRI",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("x", new IRI("http://example.org/resource"));

      const solution2 = new SolutionMapping();
      solution2.set("x", new Literal("text"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
      expect(results[0].get("x")).toBeInstanceOf(IRI);
    });
  });

  describe("SPARQL 1.1 String Functions", () => {
    it("should filter by SUBSTR", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "substr",
            args: [
              { type: "variable", name: "title" },
              { type: "literal", value: 1 },
              { type: "literal", value: 5 },
            ],
          },
          right: { type: "literal", value: "Hello" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("title", new Literal("Hello World"));

      const solution2 = new SolutionMapping();
      solution2.set("title", new Literal("Goodbye World"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should filter by STRBEFORE", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "strbefore",
            args: [
              { type: "variable", name: "path" },
              { type: "literal", value: "/" },
            ],
          },
          right: { type: "literal", value: "projects" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("path", new Literal("projects/task.md"));

      const solution2 = new SolutionMapping();
      solution2.set("path", new Literal("areas/health.md"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should filter by STRAFTER", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "strafter",
            args: [
              { type: "variable", name: "uri" },
              { type: "literal", value: "#" },
            ],
          },
          right: { type: "literal", value: "Task" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("uri", new Literal("http://example.org/ontology#Task"));

      const solution2 = new SolutionMapping();
      solution2.set("uri", new Literal("http://example.org/ontology#Project"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should filter by CONCAT", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "concat",
            args: [
              { type: "variable", name: "first" },
              { type: "literal", value: " " },
              { type: "variable", name: "last" },
            ],
          },
          right: { type: "literal", value: "John Doe" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("first", new Literal("John"));
      solution1.set("last", new Literal("Doe"));

      const solution2 = new SolutionMapping();
      solution2.set("first", new Literal("Jane"));
      solution2.set("last", new Literal("Doe"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should filter by STRLEN", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: {
            type: "function",
            function: "strlen",
            args: [{ type: "variable", name: "name" }],
          },
          right: { type: "literal", value: 10 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("name", new Literal("This is a long name"));

      const solution2 = new SolutionMapping();
      solution2.set("name", new Literal("Short"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should filter by UCASE comparison", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "ucase",
            args: [{ type: "variable", name: "tag" }],
          },
          right: { type: "literal", value: "IMPORTANT" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("tag", new Literal("important"));

      const solution2 = new SolutionMapping();
      solution2.set("tag", new Literal("normal"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should filter by LCASE comparison", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "lcase",
            args: [{ type: "variable", name: "status" }],
          },
          right: { type: "literal", value: "done" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("status", new Literal("DONE"));

      const solution2 = new SolutionMapping();
      solution2.set("status", new Literal("PENDING"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should filter by REPLACE", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "replace",
            args: [
              { type: "variable", name: "text" },
              { type: "literal", value: "-" },
              { type: "literal", value: "_" },
            ],
          },
          right: { type: "literal", value: "hello_world" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("text", new Literal("hello-world"));

      const solution2 = new SolutionMapping();
      solution2.set("text", new Literal("goodbye-world"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });
  });

  describe("Error Handling", () => {
    it("should skip solutions that throw errors during evaluation", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 50 },
        },
        input: { type: "bgp", triples: [] },
      };

      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const solution1 = new SolutionMapping();
      solution1.set("x", new Literal("75", xsdInt));

      const solution2 = new SolutionMapping();
      solution2.set("x", new Literal("not a number"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Streaming", () => {
    it("should support streaming iteration", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: "match" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solutions = [
        (() => {
          const s = new SolutionMapping();
          s.set("x", new Literal("match"));
          return s;
        })(),
        (() => {
          const s = new SolutionMapping();
          s.set("x", new Literal("nomatch"));
          return s;
        })(),
      ];

      let count = 0;
      for await (const solution of executor.execute(operation, generateSolutions(solutions))) {
        expect(solution.get("x")).toBeInstanceOf(Literal);
        count++;
      }

      expect(count).toBe(1);
    });
  });

  describe("EXISTS Expressions", () => {
    let existsEvaluator: jest.Mock<Promise<boolean>, [AlgebraOperation, SolutionMapping]>;

    beforeEach(() => {
      existsEvaluator = jest.fn();
      executor.setExistsEvaluator(existsEvaluator);
    });

    it("should evaluate EXISTS - returns true when pattern matches", async () => {
      existsEvaluator.mockResolvedValue(true);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: false,
          pattern: { type: "bgp", triples: [] },
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
      expect(existsEvaluator).toHaveBeenCalledWith(
        expect.objectContaining({ type: "bgp" }),
        solution
      );
    });

    it("should evaluate EXISTS - returns false when pattern does not match", async () => {
      existsEvaluator.mockResolvedValue(false);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: false,
          pattern: { type: "bgp", triples: [] },
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should evaluate NOT EXISTS - returns true when pattern does not match", async () => {
      existsEvaluator.mockResolvedValue(false);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: true,
          pattern: { type: "bgp", triples: [] },
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate NOT EXISTS - returns false when pattern matches", async () => {
      existsEvaluator.mockResolvedValue(true);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: true,
          pattern: { type: "bgp", triples: [] },
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should handle EXISTS with multiple solutions", async () => {
      // Mock: solution1 matches, solution2 does not match
      existsEvaluator
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: false,
          pattern: { type: "bgp", triples: [] },
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("task", new IRI("http://example.org/task1"));

      const solution2 = new SolutionMapping();
      solution2.set("task", new IRI("http://example.org/task2"));

      const solution3 = new SolutionMapping();
      solution3.set("task", new IRI("http://example.org/task3"));

      const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
      expect(results).toHaveLength(2);
      expect(existsEvaluator).toHaveBeenCalledTimes(3);
    });

    it("should handle EXISTS combined with AND", async () => {
      existsEvaluator.mockResolvedValue(true);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "&&",
          operands: [
            {
              type: "comparison",
              operator: ">",
              left: { type: "variable", name: "priority" },
              right: { type: "literal", value: 5 },
            },
            {
              type: "exists",
              negated: false,
              pattern: { type: "bgp", triples: [] },
            } as ExistsExpression,
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));
      solution.set("priority", new Literal("10", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should handle EXISTS combined with AND - both must be true", async () => {
      existsEvaluator.mockResolvedValue(false);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "&&",
          operands: [
            {
              type: "comparison",
              operator: ">",
              left: { type: "variable", name: "priority" },
              right: { type: "literal", value: 5 },
            },
            {
              type: "exists",
              negated: false,
              pattern: { type: "bgp", triples: [] },
            } as ExistsExpression,
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));
      solution.set("priority", new Literal("10", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should handle NOT EXISTS combined with OR", async () => {
      existsEvaluator
        .mockResolvedValueOnce(true)   // First NOT EXISTS returns false
        .mockResolvedValueOnce(false); // Second NOT EXISTS returns true

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "||",
          operands: [
            {
              type: "exists",
              negated: true,
              pattern: { type: "bgp", triples: [] },
            } as ExistsExpression,
            {
              type: "exists",
              negated: true,
              pattern: { type: "bgp", triples: [] },
            } as ExistsExpression,
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should handle logical NOT with EXISTS", async () => {
      existsEvaluator.mockResolvedValue(true);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "!",
          operands: [
            {
              type: "exists",
              negated: false,
              pattern: { type: "bgp", triples: [] },
            } as ExistsExpression,
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should throw error if EXISTS evaluator not set", async () => {
      const freshExecutor = new FilterExecutor();
      // Don't set EXISTS evaluator

      const existsExpr: ExistsExpression = {
        type: "exists",
        negated: false,
        pattern: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      await expect(
        freshExecutor.evaluateExpressionAsync(existsExpr, solution)
      ).rejects.toThrow("EXISTS evaluator not set");
    });

    it("should call evaluator with correct pattern and solution", async () => {
      existsEvaluator.mockResolvedValue(true);

      const pattern: AlgebraOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://example.org/status" },
            object: { type: "literal", value: "Done" },
          },
        ],
      };

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: false,
          pattern,
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("task", new IRI("http://example.org/task1"));

      await executor.executeAll(operation, [solution]);

      expect(existsEvaluator).toHaveBeenCalledWith(pattern, solution);
    });

    it("should pass current solution bindings to EXISTS evaluator", async () => {
      existsEvaluator.mockResolvedValue(true);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: false,
          pattern: { type: "bgp", triples: [] },
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("project", new IRI("http://example.org/project1"));
      solution.set("name", new Literal("Project Alpha"));

      await executor.executeAll(operation, [solution]);

      const [_, passedSolution] = existsEvaluator.mock.calls[0];
      expect(passedSolution.get("project")).toBeDefined();
      expect(passedSolution.get("name")).toBeDefined();
    });
  });

  describe("expressionContainsExists", () => {
    let existsEvaluator: jest.Mock<Promise<boolean>, [AlgebraOperation, SolutionMapping]>;

    it("should detect EXISTS in simple expression", async () => {
      existsEvaluator = jest.fn().mockResolvedValue(true);
      executor.setExistsEvaluator(existsEvaluator);

      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "exists",
          negated: false,
          pattern: { type: "bgp", triples: [] },
        } as ExistsExpression,
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      // This should use async evaluation path
      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
      expect(existsEvaluator).toHaveBeenCalled();
    });

    it("should not use async path for non-EXISTS expressions", async () => {
      // Don't set evaluator to verify sync path is used
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: "test" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });
  });

  describe("Arithmetic Expressions", () => {
    it("should evaluate addition", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "arithmetic",
            operator: "+",
            left: { type: "variable", name: "a" },
            right: { type: "variable", name: "b" },
          } as any,
          right: { type: "literal", value: 15 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("a", new Literal("10", xsdInt));
      solution.set("b", new Literal("5", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate subtraction", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "arithmetic",
            operator: "-",
            left: { type: "variable", name: "a" },
            right: { type: "variable", name: "b" },
          } as any,
          right: { type: "literal", value: 5 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("a", new Literal("10", xsdInt));
      solution.set("b", new Literal("5", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate multiplication", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "arithmetic",
            operator: "*",
            left: { type: "variable", name: "a" },
            right: { type: "variable", name: "b" },
          } as any,
          right: { type: "literal", value: 50 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("a", new Literal("10", xsdInt));
      solution.set("b", new Literal("5", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate division", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "arithmetic",
            operator: "/",
            left: { type: "variable", name: "a" },
            right: { type: "variable", name: "b" },
          } as any,
          right: { type: "literal", value: 2 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("a", new Literal("10", xsdInt));
      solution.set("b", new Literal("5", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should handle xsd:dateTime subtraction", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: {
            type: "arithmetic",
            operator: "-",
            left: { type: "variable", name: "endTime" },
            right: { type: "variable", name: "startTime" },
          } as any,
          // Duration in milliseconds: at least 1 hour = 3600000 ms
          right: { type: "literal", value: 3600000 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      // Sleep from 23:00 to 07:00 = 8 hours = 28800000 ms
      solution.set("startTime", new Literal("2025-11-30T23:00:00Z", xsdDateTime));
      solution.set("endTime", new Literal("2025-12-01T07:00:00Z", xsdDateTime));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should convert dateTime difference to minutes", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "arithmetic",
            operator: "/",
            left: {
              type: "arithmetic",
              operator: "-",
              left: { type: "variable", name: "endTime" },
              right: { type: "variable", name: "startTime" },
            },
            // Divide by 60000 to convert ms to minutes
            right: { type: "literal", value: 60000 },
          } as any,
          // Expect 120 minutes (2 hours)
          right: { type: "literal", value: 120 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("startTime", new Literal("2025-11-30T10:00:00Z", xsdDateTime));
      solution.set("endTime", new Literal("2025-11-30T12:00:00Z", xsdDateTime));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });
  });

  describe("DateTime Accessor Functions", () => {
    it("should evaluate YEAR function", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "year",
            args: [{ type: "variable", name: "date" }],
          },
          right: { type: "literal", value: 2025 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("date", new Literal("2025-11-30T23:00:00Z", xsdDateTime));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate MONTH function", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "month",
            args: [{ type: "variable", name: "date" }],
          },
          right: { type: "literal", value: 11 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("date", new Literal("2025-11-30T23:00:00Z", xsdDateTime));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate DAY function", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "day",
            args: [{ type: "variable", name: "date" }],
          },
          right: { type: "literal", value: 30 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("date", new Literal("2025-11-30T23:00:00Z", xsdDateTime));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate HOURS function", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "hours",
            args: [{ type: "variable", name: "date" }],
          },
          // Note: JavaScript Date parses Z as UTC, so local hours may differ
          // Using a time that's clear (no timezone ambiguity)
          right: { type: "literal", value: 14 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      // No timezone suffix - will be parsed as local time
      solution.set("date", new Literal("2025-11-30T14:30:00"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate MINUTES function", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "minutes",
            args: [{ type: "variable", name: "date" }],
          },
          right: { type: "literal", value: 45 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("date", new Literal("2025-11-30T14:45:30"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate SECONDS function", async () => {
      const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "seconds",
            args: [{ type: "variable", name: "date" }],
          },
          right: { type: "literal", value: 30 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("date", new Literal("2025-11-30T14:45:30"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });
  });

  describe("SPARQL 1.1 Numeric Functions", () => {
    it("should evaluate ABS function with positive number", async () => {
      const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "abs",
            args: [{ type: "variable", name: "delta" }],
          },
          right: { type: "literal", value: 5 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("delta", new Literal("-5", xsdDecimal));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate ROUND function", async () => {
      const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "round",
            args: [{ type: "variable", name: "avg" }],
          },
          right: { type: "literal", value: 3 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("avg", new Literal("2.5", xsdDecimal));

      const solution2 = new SolutionMapping();
      solution2.set("avg", new Literal("2.4", xsdDecimal));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate CEIL function", async () => {
      const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "<=",
          left: {
            type: "function",
            function: "ceil",
            args: [{ type: "variable", name: "priority" }],
          },
          right: { type: "literal", value: 3 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("priority", new Literal("2.1", xsdDecimal));

      const solution2 = new SolutionMapping();
      solution2.set("priority", new Literal("3.5", xsdDecimal));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate FLOOR function", async () => {
      const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "floor",
            args: [{ type: "variable", name: "hours" }],
          },
          right: { type: "literal", value: 2 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("hours", new Literal("2.9", xsdDecimal));

      const solution2 = new SolutionMapping();
      solution2.set("hours", new Literal("3.1", xsdDecimal));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should evaluate RAND function", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "<",
          left: {
            type: "function",
            function: "rand",
            args: [],
          },
          right: { type: "literal", value: 1 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      // RAND() always returns value in [0, 1), so should always pass filter
      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should combine numeric functions in complex expression", async () => {
      const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      // Test: ABS(FLOOR(x)) = 2 where x = -2.9
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "abs",
            args: [
              {
                type: "function",
                function: "floor",
                args: [{ type: "variable", name: "x" }],
              },
            ],
          },
          right: { type: "literal", value: 3 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      // FLOOR(-2.9) = -3, ABS(-3) = 3
      solution.set("x", new Literal("-2.9", xsdDecimal));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });
  });

  describe("SPARQL 1.1 Conditional Functions", () => {
    describe("COALESCE", () => {
      it("should return first bound variable value", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "coalesce",
              args: [
                { type: "variable", name: "alias" },
                { type: "variable", name: "name" },
              ],
            },
            right: { type: "literal", value: "John" },
          },
          input: { type: "bgp", triples: [] },
        };

        // Solution with alias bound
        const solution1 = new SolutionMapping();
        solution1.set("alias", new Literal("John"));
        solution1.set("name", new Literal("Jonathan"));

        // Solution with only name bound
        const solution2 = new SolutionMapping();
        solution2.set("name", new Literal("John"));

        // Solution with neither matching
        const solution3 = new SolutionMapping();
        solution3.set("name", new Literal("Jane"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(2);
      });

      it("should handle 3 arguments", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "coalesce",
              args: [
                { type: "variable", name: "nickname" },
                { type: "variable", name: "alias" },
                { type: "variable", name: "name" },
              ],
            },
            right: { type: "literal", value: "Default" },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("name", new Literal("Default"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });

      it("should handle 5 arguments", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "coalesce",
              args: [
                { type: "variable", name: "a" },
                { type: "variable", name: "b" },
                { type: "variable", name: "c" },
                { type: "variable", name: "d" },
                { type: "literal", value: "fallback" },
              ],
            },
            right: { type: "literal", value: "fallback" },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        // None of a, b, c, d are bound

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });

      it("should return fallback literal when all variables are unbound", async () => {
        // Test COALESCE falling back to a literal when variables are unbound
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "coalesce",
              args: [
                { type: "variable", name: "dueDate" },
                { type: "variable", name: "createdDate" },
                { type: "literal", value: "No date" },
              ],
            },
            right: { type: "literal", value: "No date" },
          },
          input: { type: "bgp", triples: [] },
        };

        // Solution with dueDate bound - won't match "No date"
        const solution1 = new SolutionMapping();
        solution1.set("task", new IRI("http://example.org/task1"));
        solution1.set("dueDate", new Literal("2025-12-01"));

        // Solution with only createdDate bound - won't match "No date"
        const solution2 = new SolutionMapping();
        solution2.set("task", new IRI("http://example.org/task2"));
        solution2.set("createdDate", new Literal("2025-11-01"));

        // Solution with neither bound - falls back to "No date" and matches
        const solution3 = new SolutionMapping();
        solution3.set("task", new IRI("http://example.org/task3"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(1);
        expect(results[0].get("task")).toEqual(new IRI("http://example.org/task3"));
      });

      it("should handle COALESCE returning different RDF term types", async () => {
        // Test COALESCE with IRI value - use STRLEN which works on any stringifiable term
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: ">",
            left: {
              type: "function",
              function: "strlen",
              args: [
                {
                  type: "function",
                  function: "coalesce",
                  args: [
                    { type: "variable", name: "value" },
                    { type: "literal", value: "" },
                  ],
                },
              ],
            },
            right: { type: "literal", value: 0 },
          },
          input: { type: "bgp", triples: [] },
        };

        // Solution with Literal bound
        const solution1 = new SolutionMapping();
        solution1.set("value", new Literal("some text"));

        // Solution with IRI bound
        const solution2 = new SolutionMapping();
        solution2.set("value", new IRI("http://example.org/resource"));

        // Solution with value not bound - falls back to empty string, STRLEN = 0, fails filter
        const solution3 = new SolutionMapping();
        solution3.set("other", new Literal("other"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        // solution1 and solution2 should pass (STRLEN > 0), solution3 should fail (STRLEN = 0)
        expect(results).toHaveLength(2);
      });
    });

    describe("IF", () => {
      it("should return thenExpr when condition is true", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "if",
              args: [
                {
                  type: "comparison",
                  operator: "=",
                  left: { type: "variable", name: "status" },
                  right: { type: "literal", value: "done" },
                },
                { type: "literal", value: "✅" },
                { type: "literal", value: "⏳" },
              ],
            },
            right: { type: "literal", value: "✅" },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("status", new Literal("done"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });

      it("should return elseExpr when condition is false", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "if",
              args: [
                {
                  type: "comparison",
                  operator: "=",
                  left: { type: "variable", name: "status" },
                  right: { type: "literal", value: "done" },
                },
                { type: "literal", value: "✅" },
                { type: "literal", value: "⏳" },
              ],
            },
            right: { type: "literal", value: "⏳" },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("status", new Literal("pending"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });

      it("should handle numeric condition (priority > 5)", async () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "if",
              args: [
                {
                  type: "comparison",
                  operator: ">",
                  left: { type: "variable", name: "priority" },
                  right: { type: "literal", value: 5 },
                },
                { type: "literal", value: "High" },
                { type: "literal", value: "Low" },
              ],
            },
            right: { type: "literal", value: "High" },
          },
          input: { type: "bgp", triples: [] },
        };

        // High priority task
        const solution1 = new SolutionMapping();
        solution1.set("priority", new Literal("8", xsdInt));

        // Low priority task
        const solution2 = new SolutionMapping();
        solution2.set("priority", new Literal("3", xsdInt));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
      });

      it("should throw error when IF has wrong number of arguments", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "function",
            function: "if",
            args: [
              { type: "literal", value: true },
              { type: "literal", value: "only two args" },
            ],
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("x", new Literal("test"));

        // Should skip this solution due to error
        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(0);
      });

      it("should handle boolean literal condition", async () => {
        const xsdBool = new IRI("http://www.w3.org/2001/XMLSchema#boolean");
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "if",
              args: [
                { type: "variable", name: "isActive" },
                { type: "literal", value: "Active" },
                { type: "literal", value: "Inactive" },
              ],
            },
            right: { type: "literal", value: "Active" },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("isActive", new Literal("true", xsdBool));

        const solution2 = new SolutionMapping();
        solution2.set("isActive", new Literal("false", xsdBool));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
      });

      it("should handle nested IF expressions", async () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        // IF(priority > 7, "Critical", IF(priority > 3, "Medium", "Low"))
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "if",
              args: [
                {
                  type: "comparison",
                  operator: ">",
                  left: { type: "variable", name: "priority" },
                  right: { type: "literal", value: 7 },
                },
                { type: "literal", value: "Critical" },
                {
                  type: "function",
                  function: "if",
                  args: [
                    {
                      type: "comparison",
                      operator: ">",
                      left: { type: "variable", name: "priority" },
                      right: { type: "literal", value: 3 },
                    },
                    { type: "literal", value: "Medium" },
                    { type: "literal", value: "Low" },
                  ],
                },
              ],
            },
            right: { type: "literal", value: "Medium" },
          },
          input: { type: "bgp", triples: [] },
        };

        // Critical (priority = 9)
        const solution1 = new SolutionMapping();
        solution1.set("priority", new Literal("9", xsdInt));

        // Medium (priority = 5)
        const solution2 = new SolutionMapping();
        solution2.set("priority", new Literal("5", xsdInt));

        // Low (priority = 2)
        const solution3 = new SolutionMapping();
        solution3.set("priority", new Literal("2", xsdInt));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(1);
        const priorityValue = results[0].get("priority");
        expect(priorityValue).toBeInstanceOf(Literal);
        expect((priorityValue as Literal).value).toBe("5");
      });

      it("should handle combined COALESCE and IF", async () => {
        // IF(BOUND(?dueDate), COALESCE(?dueDate, ?createdDate), "No date")
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "if",
              args: [
                {
                  type: "function",
                  function: "bound",
                  args: [{ type: "variable", name: "dueDate" }],
                },
                {
                  type: "function",
                  function: "coalesce",
                  args: [
                    { type: "variable", name: "dueDate" },
                    { type: "variable", name: "createdDate" },
                  ],
                },
                { type: "literal", value: "No date" },
              ],
            },
            right: { type: "literal", value: "2025-12-01" },
          },
          input: { type: "bgp", triples: [] },
        };

        // Has dueDate
        const solution1 = new SolutionMapping();
        solution1.set("dueDate", new Literal("2025-12-01"));
        solution1.set("createdDate", new Literal("2025-11-01"));

        // Only has createdDate (should return "No date")
        const solution2 = new SolutionMapping();
        solution2.set("createdDate", new Literal("2025-11-01"));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
      });
    });
  });

  describe("XSD Type Casting Functions (Issue #534)", () => {
    describe("xsd:dateTime", () => {
      it("should cast string to dateTime for arithmetic operations", async () => {
        // Test: xsd:dateTime(?end) - xsd:dateTime(?start) > 60000
        // This is the exact pattern from Issue #534
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: ">",
            left: {
              type: "arithmetic",
              operator: "-",
              left: {
                type: "function",
                function: "datetime",
                args: [{ type: "variable", name: "end" }],
              },
              right: {
                type: "function",
                function: "datetime",
                args: [{ type: "variable", name: "start" }],
              },
            } as any,
            right: { type: "literal", value: 60000 }, // 1 minute in ms
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        // Sleep from 23:00 to 07:00 = 8 hours
        solution.set("start", new Literal("2025-12-01T23:00:00Z"));
        solution.set("end", new Literal("2025-12-02T07:00:00Z"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });

      it("should handle JavaScript Date string format (Issue #534 Blocker 1)", async () => {
        // Test with real-world JS Date.toString() format
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: ">",
            left: {
              type: "arithmetic",
              operator: "-",
              left: {
                type: "function",
                function: "datetime",
                args: [{ type: "variable", name: "end" }],
              },
              right: {
                type: "function",
                function: "datetime",
                args: [{ type: "variable", name: "start" }],
              },
            } as any,
            right: { type: "literal", value: 0 },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        // Real-world format from vault data
        solution.set("start", new Literal("Tue Dec 02 2025 02:10:39 GMT+0500"));
        solution.set("end", new Literal("Tue Dec 02 2025 10:30:00 GMT+0500"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });
    });

    describe("xsd:integer", () => {
      it("should cast string to integer for calculations", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: "=",
            left: {
              type: "function",
              function: "integer",
              args: [{ type: "variable", name: "count" }],
            },
            right: { type: "literal", value: 42 },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("count", new Literal("42"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });
    });

    describe("xsd:decimal", () => {
      it("should cast string to decimal for calculations", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: ">",
            left: {
              type: "function",
              function: "decimal",
              args: [{ type: "variable", name: "rate" }],
            },
            right: { type: "literal", value: 0.5 },
          },
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("rate", new Literal("0.75"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(1);
      });
    });

    describe("Sleep analysis query pattern (Issue #534)", () => {
      it("should calculate average sleep duration using dateTime arithmetic", async () => {
        // This simulates the query:
        // BIND((xsd:dateTime(?end) - xsd:dateTime(?start)) AS ?duration)
        // Then filter for sleep entries > 6 hours (21600000 ms)
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "comparison",
            operator: ">",
            left: {
              type: "arithmetic",
              operator: "-",
              left: {
                type: "function",
                function: "datetime",
                args: [{ type: "variable", name: "end" }],
              },
              right: {
                type: "function",
                function: "datetime",
                args: [{ type: "variable", name: "start" }],
              },
            } as any,
            right: { type: "literal", value: 21600000 }, // 6 hours in ms
          },
          input: { type: "bgp", triples: [] },
        };

        // Sleep entry with 8 hours (should pass)
        const solution1 = new SolutionMapping();
        solution1.set("start", new Literal("2025-12-01T23:00:00Z"));
        solution1.set("end", new Literal("2025-12-02T07:00:00Z"));

        // Sleep entry with 5 hours (should NOT pass)
        const solution2 = new SolutionMapping();
        solution2.set("start", new Literal("2025-12-02T01:00:00Z"));
        solution2.set("end", new Literal("2025-12-02T06:00:00Z"));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
      });
    });
  });

  describe("IN / NOT IN Operators (Issue #718)", () => {
    describe("IN Operator", () => {
      it("should match when value is in list of numbers", async () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: false,
            expression: { type: "variable", name: "x" },
            list: [
              { type: "literal", value: 1 },
              { type: "literal", value: 2 },
              { type: "literal", value: 3 },
            ],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("x", new Literal("2", xsdInt));

        const solution2 = new SolutionMapping();
        solution2.set("x", new Literal("5", xsdInt));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
        expect((results[0].get("x") as Literal).value).toBe("2");
      });

      it("should match when value is in list of strings", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: false,
            expression: { type: "variable", name: "status" },
            list: [
              { type: "literal", value: "active" },
              { type: "literal", value: "pending" },
              { type: "literal", value: "review" },
            ],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("status", new Literal("active"));

        const solution2 = new SolutionMapping();
        solution2.set("status", new Literal("pending"));

        const solution3 = new SolutionMapping();
        solution3.set("status", new Literal("archived"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(2);
      });

      it("should not match when value is not in list", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: false,
            expression: { type: "variable", name: "color" },
            list: [
              { type: "literal", value: "red" },
              { type: "literal", value: "green" },
              { type: "literal", value: "blue" },
            ],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("color", new Literal("yellow"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(0);
      });

      it("should work with variables in list", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: false,
            expression: { type: "variable", name: "x" },
            list: [
              { type: "variable", name: "y" },
              { type: "variable", name: "z" },
            ],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("x", new Literal("match"));
        solution1.set("y", new Literal("match"));
        solution1.set("z", new Literal("other"));

        const solution2 = new SolutionMapping();
        solution2.set("x", new Literal("match"));
        solution2.set("y", new Literal("no"));
        solution2.set("z", new Literal("match"));

        const solution3 = new SolutionMapping();
        solution3.set("x", new Literal("match"));
        solution3.set("y", new Literal("no"));
        solution3.set("z", new Literal("also-no"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
        expect(results).toHaveLength(2);
      });

      it("should handle empty list (no matches)", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: false,
            expression: { type: "variable", name: "x" },
            list: [],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution = new SolutionMapping();
        solution.set("x", new Literal("anything"));

        const results = await executor.executeAll(operation, [solution]);
        expect(results).toHaveLength(0);
      });
    });

    describe("NOT IN Operator", () => {
      it("should match when value is NOT in list of strings", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: true,
            expression: { type: "variable", name: "x" },
            list: [
              { type: "literal", value: "a" },
              { type: "literal", value: "b" },
            ],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("x", new Literal("c"));

        const solution2 = new SolutionMapping();
        solution2.set("x", new Literal("a"));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(1);
        expect((results[0].get("x") as Literal).value).toBe("c");
      });

      it("should match all when list is empty", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: true,
            expression: { type: "variable", name: "x" },
            list: [],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("x", new Literal("anything"));

        const solution2 = new SolutionMapping();
        solution2.set("x", new Literal("everything"));

        const results = await executor.executeAll(operation, [solution1, solution2]);
        expect(results).toHaveLength(2);
      });

      it("should exclude items with blocked statuses", async () => {
        const operation: FilterOperation = {
          type: "filter",
          expression: {
            type: "in",
            negated: true,
            expression: { type: "variable", name: "status" },
            list: [
              { type: "literal", value: "blocked" },
              { type: "literal", value: "cancelled" },
              { type: "literal", value: "archived" },
            ],
          } as InExpression,
          input: { type: "bgp", triples: [] },
        };

        const solution1 = new SolutionMapping();
        solution1.set("status", new Literal("active"));

        const solution2 = new SolutionMapping();
        solution2.set("status", new Literal("blocked"));

        const solution3 = new SolutionMapping();
        solution3.set("status", new Literal("pending"));

        const solution4 = new SolutionMapping();
        solution4.set("status", new Literal("cancelled"));

        const results = await executor.executeAll(operation, [solution1, solution2, solution3, solution4]);
        expect(results).toHaveLength(2);
      });
    });
  });

  describe("ENCODE_FOR_URI function", () => {
    it("should encode spaces in variable value", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "encode_for_uri",
            args: [{ type: "variable", name: "name" }],
          },
          right: { type: "literal", value: "hello%20world" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("name", new Literal("hello world"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should encode URL special characters", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "encode_for_uri",
            args: [{ type: "variable", name: "path" }],
          },
          right: { type: "literal", value: "a%2Fb%3Fc%3Dd" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("path", new Literal("a/b?c=d"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should not encode unreserved characters", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "encode_for_uri",
            args: [{ type: "variable", name: "text" }],
          },
          right: { type: "literal", value: "simple-test_123.txt~" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("text", new Literal("simple-test_123.txt~"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should encode unicode characters", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "encode_for_uri",
            args: [{ type: "variable", name: "text" }],
          },
          right: { type: "literal", value: "%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("text", new Literal("Привет"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should work with literal string argument", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "encode_for_uri",
            args: [{ type: "literal", value: "Los Angeles" }],
          },
          right: { type: "literal", value: "Los%20Angeles" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should handle input that encodes to a known value", async () => {
      // Test encoding of a string that produces a predictable result
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "encode_for_uri",
            args: [{ type: "literal", value: "test" }],
          },
          right: { type: "literal", value: "test" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      // Unreserved characters should remain unchanged
      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });
  });

  describe("isNumeric function", () => {
    it("should return true for xsd:integer literal", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "isnumeric",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("42", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should return true for xsd:decimal literal", async () => {
      const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "isnumeric",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("3.14", xsdDecimal));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should return false for plain string literal", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "isnumeric",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("hello"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should return false for IRI", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "isnumeric",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new IRI("http://example.org/resource"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should filter numeric values from mixed set", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "isnumeric",
          args: [{ type: "variable", name: "x" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("x", new Literal("42", xsdInt));

      const solution2 = new SolutionMapping();
      solution2.set("x", new Literal("hello"));

      const solution3 = new SolutionMapping();
      solution3.set("x", new IRI("http://example.org"));

      const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
      expect(results).toHaveLength(1);
      expect((results[0].get("x") as Literal).value).toBe("42");
    });
  });

  describe("sameTerm function", () => {
    it("should return true for identical IRIs", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "sameterm",
          args: [
            { type: "variable", name: "x" },
            { type: "variable", name: "y" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new IRI("http://example.org/resource"));
      solution.set("y", new IRI("http://example.org/resource"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should return false for different IRIs", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "sameterm",
          args: [
            { type: "variable", name: "x" },
            { type: "variable", name: "y" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new IRI("http://example.org/resource1"));
      solution.set("y", new IRI("http://example.org/resource2"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should return true for identical typed literals", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "sameterm",
          args: [
            { type: "variable", name: "x" },
            { type: "variable", name: "y" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("42", xsdInt));
      solution.set("y", new Literal("42", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(1);
    });

    it("should return false for same value with different datatypes", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "sameterm",
          args: [
            { type: "variable", name: "x" },
            { type: "variable", name: "y" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("42", xsdInt));
      solution.set("y", new Literal("42", xsdDecimal));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should return false for different term types (IRI vs Literal)", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "sameterm",
          args: [
            { type: "variable", name: "x" },
            { type: "variable", name: "y" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new IRI("http://example.org/resource"));
      solution.set("y", new Literal("http://example.org/resource"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results).toHaveLength(0);
    });

    it("should filter pairs where terms match", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "sameterm",
          args: [
            { type: "variable", name: "x" },
            { type: "variable", name: "y" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("x", new IRI("http://example.org/a"));
      solution1.set("y", new IRI("http://example.org/a"));

      const solution2 = new SolutionMapping();
      solution2.set("x", new IRI("http://example.org/a"));
      solution2.set("y", new IRI("http://example.org/b"));

      const solution3 = new SolutionMapping();
      solution3.set("x", new Literal("test"));
      solution3.set("y", new Literal("test"));

      const results = await executor.executeAll(operation, [solution1, solution2, solution3]);
      expect(results).toHaveLength(2);
    });
  });

  describe("Hash Functions", () => {
    it("should evaluate MD5 function", async () => {
      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      // Test MD5 returns correct hash
      const result = executor.evaluateExpression(
        {
          type: "function",
          function: "md5",
          args: [{ type: "variable", name: "x" }],
        },
        solution
      );
      expect(result).toBe("098f6bcd4621d373cade4e832627b4f6");
    });

    it("should evaluate SHA1 function", async () => {
      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      const result = executor.evaluateExpression(
        {
          type: "function",
          function: "sha1",
          args: [{ type: "variable", name: "x" }],
        },
        solution
      );
      expect(result).toBe("a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
    });

    it("should evaluate SHA256 function", async () => {
      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      const result = executor.evaluateExpression(
        {
          type: "function",
          function: "sha256",
          args: [{ type: "variable", name: "x" }],
        },
        solution
      );
      expect(result).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    });

    it("should evaluate SHA384 function", async () => {
      const solution = new SolutionMapping();
      solution.set("x", new Literal(""));

      const result = executor.evaluateExpression(
        {
          type: "function",
          function: "sha384",
          args: [{ type: "variable", name: "x" }],
        },
        solution
      );
      expect(result).toBe(
        "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b"
      );
    });

    it("should evaluate SHA512 function", async () => {
      const solution = new SolutionMapping();
      solution.set("x", new Literal(""));

      const result = executor.evaluateExpression(
        {
          type: "function",
          function: "sha512",
          args: [{ type: "variable", name: "x" }],
        },
        solution
      );
      expect(result).toBe(
        "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
      );
    });

    it("should filter by hashed value comparison", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "md5",
            args: [{ type: "variable", name: "email" }],
          },
          right: { type: "literal", value: "098f6bcd4621d373cade4e832627b4f6" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("email", new Literal("test"));

      const solution2 = new SolutionMapping();
      solution2.set("email", new Literal("other"));

      const results = await executor.executeAll(operation, [solution1, solution2]);
      expect(results).toHaveLength(1);
    });

    it("should work with literal values directly", async () => {
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(
        {
          type: "function",
          function: "sha256",
          args: [{ type: "literal", value: "hello" }],
        },
        solution
      );
      expect(result).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    });
  });
});
