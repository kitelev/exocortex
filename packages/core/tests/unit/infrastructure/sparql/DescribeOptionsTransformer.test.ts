import {
  DescribeOptionsTransformer,
  DescribeOptionsTransformerError,
} from "../../../../src/infrastructure/sparql/DescribeOptionsTransformer";

describe("DescribeOptionsTransformer", () => {
  let transformer: DescribeOptionsTransformer;

  beforeEach(() => {
    transformer = new DescribeOptionsTransformer();
  });

  describe("transform", () => {
    describe("DEPTH option parsing", () => {
      it("should extract DEPTH option from DESCRIBE query", () => {
        const query = "DESCRIBE ?x DEPTH 2 WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options).toBeDefined();
        expect(result.options?.depth).toBe(2);
      });

      it("should remove DEPTH from query string", () => {
        const query = "DESCRIBE ?x DEPTH 2 WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.query).not.toContain("DEPTH");
        expect(result.query).not.toContain("2");
        expect(result.query).toContain("DESCRIBE");
        expect(result.query).toContain("WHERE");
      });

      it("should handle DEPTH 0", () => {
        const query = "DESCRIBE ?x DEPTH 0 WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(0);
      });

      it("should handle DEPTH 1", () => {
        const query = "DESCRIBE ?x DEPTH 1";
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(1);
      });

      it("should handle large DEPTH values", () => {
        const query = "DESCRIBE ?x DEPTH 100";
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(100);
      });

      it("should be case-insensitive for DEPTH keyword", () => {
        const queries = [
          "DESCRIBE ?x depth 2",
          "DESCRIBE ?x Depth 2",
          "DESCRIBE ?x DEPTH 2",
        ];

        for (const query of queries) {
          const result = transformer.transform(query);
          expect(result.options?.depth).toBe(2);
        }
      });
    });

    describe("SYMMETRIC option parsing", () => {
      it("should extract SYMMETRIC option from DESCRIBE query", () => {
        const query = "DESCRIBE ?x SYMMETRIC WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options).toBeDefined();
        expect(result.options?.symmetric).toBe(true);
      });

      it("should remove SYMMETRIC from query string", () => {
        const query = "DESCRIBE ?x SYMMETRIC WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.query).not.toContain("SYMMETRIC");
        expect(result.query).toContain("DESCRIBE");
        expect(result.query).toContain("WHERE");
      });

      it("should be case-insensitive for SYMMETRIC keyword", () => {
        const queries = [
          "DESCRIBE ?x symmetric",
          "DESCRIBE ?x Symmetric",
          "DESCRIBE ?x SYMMETRIC",
        ];

        for (const query of queries) {
          const result = transformer.transform(query);
          expect(result.options?.symmetric).toBe(true);
        }
      });
    });

    describe("combined options", () => {
      it("should extract both DEPTH and SYMMETRIC", () => {
        const query = "DESCRIBE ?x DEPTH 2 SYMMETRIC WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(2);
        expect(result.options?.symmetric).toBe(true);
      });

      it("should handle SYMMETRIC before DEPTH", () => {
        const query = "DESCRIBE ?x SYMMETRIC DEPTH 3 WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(3);
        expect(result.options?.symmetric).toBe(true);
      });

      it("should remove both options from query string", () => {
        const query = "DESCRIBE ?x DEPTH 2 SYMMETRIC WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.query).not.toContain("DEPTH");
        expect(result.query).not.toContain("SYMMETRIC");
        expect(result.query).toContain("DESCRIBE");
      });
    });

    describe("queries without options", () => {
      it("should return undefined options for basic DESCRIBE", () => {
        const query = "DESCRIBE ?x WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options).toBeUndefined();
        expect(result.query).toBe(query);
      });

      it("should return undefined options for DESCRIBE with IRI", () => {
        const query = "DESCRIBE <http://example.org/resource>";
        const result = transformer.transform(query);

        expect(result.options).toBeUndefined();
      });

      it("should not modify non-DESCRIBE queries", () => {
        const query = "SELECT ?x WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options).toBeUndefined();
        expect(result.query).toBe(query);
      });
    });

    describe("edge cases", () => {
      it("should handle multiline queries", () => {
        const query = `
          DESCRIBE ?x
          DEPTH 2
          SYMMETRIC
          WHERE {
            ?x a :Person
          }
        `;
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(2);
        expect(result.options?.symmetric).toBe(true);
      });

      it("should handle DESCRIBE *", () => {
        const query = "DESCRIBE * DEPTH 1 WHERE { ?x a :Person }";
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(1);
      });

      it("should handle multiple resources", () => {
        const query = "DESCRIBE ?x ?y DEPTH 2 WHERE { ?x :knows ?y }";
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(2);
      });

      it("should handle DESCRIBE with prefix", () => {
        const query = `
          PREFIX ex: <http://example.org/>
          DESCRIBE ?x DEPTH 2 WHERE { ?x a ex:Person }
        `;
        const result = transformer.transform(query);

        expect(result.options?.depth).toBe(2);
        expect(result.query).toContain("PREFIX");
      });
    });
  });

  describe("hasDescribeOptions", () => {
    it("should return true when DEPTH is present", () => {
      expect(transformer.hasDescribeOptions("DESCRIBE ?x DEPTH 2")).toBe(true);
    });

    it("should return true when SYMMETRIC is present", () => {
      expect(transformer.hasDescribeOptions("DESCRIBE ?x SYMMETRIC")).toBe(true);
    });

    it("should return true when both are present", () => {
      expect(transformer.hasDescribeOptions("DESCRIBE ?x DEPTH 2 SYMMETRIC")).toBe(true);
    });

    it("should return false for basic DESCRIBE", () => {
      expect(transformer.hasDescribeOptions("DESCRIBE ?x WHERE { ?x a :Person }")).toBe(false);
    });

    it("should return false for SELECT query", () => {
      expect(transformer.hasDescribeOptions("SELECT ?x WHERE { ?x a :Person }")).toBe(false);
    });
  });
});
