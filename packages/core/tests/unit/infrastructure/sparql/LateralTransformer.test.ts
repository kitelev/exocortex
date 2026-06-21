import {
  LateralTransformer,
  LateralTransformerError,
} from "../../../../src/infrastructure/sparql/LateralTransformer";

describe("LateralTransformer", () => {
  let transformer: LateralTransformer;

  beforeEach(() => {
    transformer = new LateralTransformer();
  });

  describe("transform", () => {
    it("should return unchanged query when no LATERAL is present", () => {
      const query = `
        SELECT ?person ?name WHERE {
          ?person a <http://example.org/Person> .
          ?person <http://example.org/name> ?name .
        }
      `;

      const result = transformer.transform(query);

      expect(result).toBe(query);
    });

    it("should transform LATERAL with SELECT subquery", () => {
      const query = `
        SELECT ?person ?topFriend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
            LIMIT 1
          }
        }
      `;

      const result = transformer.transform(query);

      // The LATERAL keyword should be removed
      expect(result).not.toContain("LATERAL {");
      // The subquery should have the marker variable added
      expect(result).toContain(`?${LateralTransformer.LATERAL_MARKER}`);
      // The SELECT keyword should still be present
      expect(result).toContain("SELECT");
      // The braces should be preserved as a group
      expect(result).toContain("{ SELECT");
    });

    it("should preserve subquery ORDER BY and LIMIT", () => {
      const query = `
        SELECT ?person ?topFriend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
              ?friend <http://example.org/score> ?score .
            }
            ORDER BY DESC(?score)
            LIMIT 1
          }
        }
      `;

      const result = transformer.transform(query);

      expect(result).toContain("ORDER BY DESC(?score)");
      expect(result).toContain("LIMIT 1");
    });

    it("should handle LATERAL with multiple variables in SELECT", () => {
      const query = `
        SELECT ?person ?friend ?score
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend ?score WHERE {
              ?person <http://example.org/knows> ?friend .
              ?friend <http://example.org/score> ?score .
            }
            ORDER BY DESC(?score)
            LIMIT 3
          }
        }
      `;

      const result = transformer.transform(query);

      expect(result).toContain(`?${LateralTransformer.LATERAL_MARKER}`);
      expect(result).toContain("?friend ?score");
    });

    it("should handle multiple LATERAL patterns in sequence", () => {
      const query = `
        SELECT ?person ?friend ?project
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
            LIMIT 1
          }
          LATERAL {
            SELECT ?project WHERE {
              ?person <http://example.org/worksOn> ?project .
            }
            LIMIT 1
          }
        }
      `;

      const result = transformer.transform(query);

      // Both LATERAL keywords should be transformed
      expect(result).not.toContain("LATERAL {");
      // Should have two occurrences of the marker
      const markerCount = (result.match(new RegExp(`\\?${LateralTransformer.LATERAL_MARKER}`, "g")) || []).length;
      expect(markerCount).toBe(2);
    });

    it("should handle LATERAL with OFFSET", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
            ORDER BY ?friend
            LIMIT 5
            OFFSET 10
          }
        }
      `;

      const result = transformer.transform(query);

      expect(result).toContain("LIMIT 5");
      expect(result).toContain("OFFSET 10");
    });

    it("should handle LATERAL with DISTINCT", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT DISTINCT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
            }
            LIMIT 3
          }
        }
      `;

      const result = transformer.transform(query);

      expect(result).toContain("SELECT DISTINCT");
    });
  });

  describe("hasLateral", () => {
    it("should return true when query contains LATERAL", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE { ?person <http://example.org/knows> ?friend }
          }
        }
      `;

      expect(transformer.hasLateral(query)).toBe(true);
    });

    it("should return false when query does not contain LATERAL", () => {
      const query = `
        SELECT ?person ?name WHERE {
          ?person a <http://example.org/Person> .
          ?person <http://example.org/name> ?name .
        }
      `;

      expect(transformer.hasLateral(query)).toBe(false);
    });

    it("should return false for LATERAL inside string literal", () => {
      const query = `
        SELECT ?s WHERE { ?s <http://example.org/note> "Use LATERAL for correlated subqueries" }
      `;

      expect(transformer.hasLateral(query)).toBe(false);
    });

    it("should return false for partial LATERAL match (LATERALLY)", () => {
      const query = `
        SELECT ?s WHERE { ?s <http://example.org/LATERALLY> "value" }
      `;

      expect(transformer.hasLateral(query)).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should throw error when LATERAL is not followed by opening brace", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL SELECT ?friend WHERE { ?person <http://example.org/knows> ?friend }
        }
      `;

      expect(() => transformer.transform(query)).toThrow(LateralTransformerError);
      expect(() => transformer.transform(query)).toThrow(/Expected '{' after LATERAL/);
    });

    it("should throw error when LATERAL block is unclosed", () => {
      // Note: This query is missing the closing brace for the LATERAL block
      // The final } closes the WHERE clause, not the LATERAL block
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE { ?person <http://example.org/knows> ?friend
        }
      `;

      expect(() => transformer.transform(query)).toThrow(LateralTransformerError);
      expect(() => transformer.transform(query)).toThrow(/Unclosed LATERAL block/);
    });

    it("should throw error when LATERAL block does not contain SELECT", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            ?person <http://example.org/knows> ?friend .
          }
        }
      `;

      expect(() => transformer.transform(query)).toThrow(LateralTransformerError);
      expect(() => transformer.transform(query)).toThrow(/must contain a SELECT subquery/);
    });
  });

  describe("edge cases", () => {
    it("should not transform LATERAL inside string literals", () => {
      const query = `
        SELECT ?s WHERE { ?s <http://example.org/note> "LATERAL { SELECT ?x WHERE {} }" }
      `;

      const result = transformer.transform(query);

      // The string content should be unchanged
      expect(result).toBe(query);
    });

    it("should not transform LATERAL inside single-line comments", () => {
      const query = `
        SELECT ?person ?name WHERE {
          ?person a <http://example.org/Person> .
          # LATERAL { SELECT ?x WHERE {} }
          ?person <http://example.org/name> ?name .
        }
      `;

      const result = transformer.transform(query);

      // The comment should be unchanged
      expect(result).toContain("# LATERAL");
    });

    it("should handle empty query", () => {
      const result = transformer.transform("");
      expect(result).toBe("");
    });

    it("should handle query with only whitespace", () => {
      const result = transformer.transform("   \n\t  ");
      expect(result).toBe("   \n\t  ");
    });

    it("should handle LATERAL with nested braces in subquery", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL {
            SELECT ?friend WHERE {
              ?person <http://example.org/knows> ?friend .
              {
                ?friend <http://example.org/active> true .
              }
            }
            LIMIT 1
          }
        }
      `;

      const result = transformer.transform(query);

      expect(result).not.toContain("LATERAL {");
      expect(result).toContain(`?${LateralTransformer.LATERAL_MARKER}`);
      // The nested braces should be preserved
      expect(result).toContain("<http://example.org/active>");
    });

    it("should handle LATERAL case-insensitively", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          lateral {
            SELECT ?friend WHERE { ?person <http://example.org/knows> ?friend }
            LIMIT 1
          }
        }
      `;

      const result = transformer.transform(query);

      expect(result).not.toContain("lateral {");
      expect(result).toContain(`?${LateralTransformer.LATERAL_MARKER}`);
    });

    it("should handle LATERAL with whitespace before brace", () => {
      const query = `
        SELECT ?person ?friend
        WHERE {
          ?person a <http://example.org/Person> .
          LATERAL    {
            SELECT ?friend WHERE { ?person <http://example.org/knows> ?friend }
            LIMIT 1
          }
        }
      `;

      const result = transformer.transform(query);

      // The LATERAL keyword (with or without following whitespace before brace) should be removed
      expect(result).not.toContain("LATERAL {");
      expect(result).not.toContain("LATERAL    {");
      expect(result).toContain(`?${LateralTransformer.LATERAL_MARKER}`);
    });
  });

  describe("isLateralJoin static method", () => {
    it("should return true for pattern with lateral marker variable", () => {
      const pattern = {
        type: "query",
        queryType: "SELECT",
        variables: [
          { termType: "Variable", value: LateralTransformer.LATERAL_MARKER },
          { termType: "Variable", value: "friend" },
        ],
      };

      expect(LateralTransformer.isLateralJoin(pattern)).toBe(true);
    });

    it("should return false for regular subquery without marker", () => {
      const pattern = {
        type: "query",
        queryType: "SELECT",
        variables: [
          { termType: "Variable", value: "friend" },
          { termType: "Variable", value: "name" },
        ],
      };

      expect(LateralTransformer.isLateralJoin(pattern)).toBe(false);
    });

    it("should return true for group containing lateral subquery", () => {
      const pattern = {
        type: "group",
        patterns: [
          {
            type: "query",
            queryType: "SELECT",
            variables: [
              { termType: "Variable", value: LateralTransformer.LATERAL_MARKER },
              { termType: "Variable", value: "friend" },
            ],
          },
        ],
      };

      expect(LateralTransformer.isLateralJoin(pattern)).toBe(true);
    });

    it("should return false for empty pattern", () => {
      expect(LateralTransformer.isLateralJoin({})).toBe(false);
    });
  });
});
