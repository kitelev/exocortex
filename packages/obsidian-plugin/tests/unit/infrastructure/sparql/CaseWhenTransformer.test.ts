import { CaseWhenTransformer, CaseWhenTransformerError } from "exocortex";

describe("CaseWhenTransformer", () => {
  let transformer: CaseWhenTransformer;

  beforeEach(() => {
    transformer = new CaseWhenTransformer();
  });

  describe("basic transformation", () => {
    it("should transform simple CASE WHEN with two branches", () => {
      const input = `CASE WHEN ?x > 10 THEN "high" ELSE "low" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?x > 10, "high", "low")`);
    });

    it("should transform CASE WHEN without ELSE clause", () => {
      const input = `CASE WHEN ?x > 10 THEN "high" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?x > 10, "high", "")`);
    });

    it("should transform multiple WHEN clauses", () => {
      const input = `CASE WHEN ?x > 100 THEN "very high" WHEN ?x > 50 THEN "high" WHEN ?x > 10 THEN "medium" ELSE "low" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?x > 100, "very high", IF(?x > 50, "high", IF(?x > 10, "medium", "low")))`);
    });

    it("should handle whitespace and newlines", () => {
      const input = `
        CASE
          WHEN ?x > 10 THEN "high"
          ELSE "low"
        END
      `;
      const result = transformer.transform(input);
      expect(result).toContain(`IF(?x > 10, "high", "low")`);
    });

    it("should be case-insensitive for keywords", () => {
      const input = `case when ?x > 10 then "high" else "low" end`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?x > 10, "high", "low")`);

      const input2 = `CASE When ?x > 10 Then "high" Else "low" End`;
      const result2 = transformer.transform(input2);
      expect(result2).toBe(`IF(?x > 10, "high", "low")`);
    });
  });

  describe("complex expressions", () => {
    it("should handle complex conditions", () => {
      const input = `CASE WHEN ?hours > 8 && ?type = "work" THEN "overtime" ELSE "normal" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?hours > 8 && ?type = "work", "overtime", "normal")`);
    });

    it("should handle function calls in conditions", () => {
      const input = `CASE WHEN BOUND(?x) THEN ?x ELSE "unbound" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(BOUND(?x), ?x, "unbound")`);
    });

    it("should handle arithmetic expressions in results", () => {
      const input = `CASE WHEN ?hours > 8 THEN ?hours - 8 ELSE 0 END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?hours > 8, ?hours - 8, 0)`);
    });

    it("should handle string literals with special characters", () => {
      const input = `CASE WHEN ?status = "done" THEN "completed!" ELSE "in progress..." END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?status = "done", "completed!", "in progress...")`);
    });
  });

  describe("nested CASE expressions", () => {
    it("should handle nested CASE in THEN clause", () => {
      const input = `CASE WHEN ?priority > 5 THEN CASE WHEN ?urgent = true THEN "critical" ELSE "high" END ELSE "low" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?priority > 5, IF(?urgent = true, "critical", "high"), "low")`);
    });

    it("should handle nested CASE in ELSE clause", () => {
      const input = `CASE WHEN ?priority > 5 THEN "high" ELSE CASE WHEN ?priority > 2 THEN "medium" ELSE "low" END END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?priority > 5, "high", IF(?priority > 2, "medium", "low"))`);
    });

    it("should handle deeply nested CASE expressions", () => {
      const input = `CASE WHEN ?a > 3 THEN CASE WHEN ?b > 2 THEN CASE WHEN ?c > 1 THEN "deep" ELSE "c" END ELSE "b" END ELSE "a" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?a > 3, IF(?b > 2, IF(?c > 1, "deep", "c"), "b"), "a")`);
    });
  });

  describe("integration with SPARQL queries", () => {
    it("should transform CASE in SELECT clause", () => {
      const input = `
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
        SELECT ?task (CASE WHEN ?priority > 5 THEN "high" ELSE "low" END AS ?level)
        WHERE { ?task :priority ?priority }
      `;
      const result = transformer.transform(input);
      expect(result).toContain(`IF(?priority > 5, "high", "low")`);
      expect(result).toContain(`SELECT ?task`);
      expect(result).toContain(`AS ?level`);
    });

    it("should transform CASE in BIND", () => {
      const input = `
        SELECT ?task ?category
        WHERE {
          ?task :hours ?hours .
          BIND(CASE WHEN ?hours > 8 THEN "overtime" ELSE "normal" END AS ?category)
        }
      `;
      const result = transformer.transform(input);
      expect(result).toContain(`BIND(IF(?hours > 8, "overtime", "normal") AS ?category)`);
    });

    it("should transform CASE in FILTER", () => {
      const input = `
        SELECT ?task
        WHERE {
          ?task :status ?status .
          FILTER(CASE WHEN ?status = "active" THEN true ELSE false END)
        }
      `;
      const result = transformer.transform(input);
      expect(result).toContain(`FILTER(IF(?status = "active", true, false))`);
    });

    it("should transform multiple CASE expressions in one query", () => {
      const input = `
        SELECT ?task
          (CASE WHEN ?priority > 5 THEN "high" ELSE "low" END AS ?priorityLevel)
          (CASE WHEN ?status = "done" THEN "completed" ELSE "pending" END AS ?statusLabel)
        WHERE { ?task :priority ?priority . ?task :status ?status }
      `;
      const result = transformer.transform(input);
      expect(result).toContain(`IF(?priority > 5, "high", "low")`);
      expect(result).toContain(`IF(?status = "done", "completed", "pending")`);
    });
  });

  describe("real-world use case: overnight duration calculation", () => {
    it("should handle midnight crossing duration calculation", () => {
      const input = `
        SELECT ?label ?start ?end
          (CASE
            WHEN HOURS(?end) < HOURS(?start)
            THEN (24 - HOURS(?start) + HOURS(?end)) + (MINUTES(?end) - MINUTES(?start)) / 60
            ELSE (HOURS(?end) - HOURS(?start)) + (MINUTES(?end) - MINUTES(?start)) / 60
          END AS ?durationHours)
        WHERE {
          ?s exo:Asset_label ?label .
          ?s ems:Effort_startTimestamp ?start .
          ?s ems:Effort_endTimestamp ?end .
        }
      `;
      const result = transformer.transform(input);
      expect(result).toContain(`IF(HOURS(?end) < HOURS(?start),`);
      expect(result).toContain(`(24 - HOURS(?start) + HOURS(?end))`);
      expect(result).toContain(`AS ?durationHours`);
    });
  });

  describe("error handling", () => {
    it("should throw error for unclosed CASE", () => {
      const input = `CASE WHEN ?x > 10 THEN "high"`;
      expect(() => transformer.transform(input)).toThrow(CaseWhenTransformerError);
      expect(() => transformer.transform(input)).toThrow(/Unclosed CASE/);
    });

    it("should throw error for CASE without WHEN", () => {
      const input = `CASE ELSE "default" END`;
      expect(() => transformer.transform(input)).toThrow(CaseWhenTransformerError);
      expect(() => transformer.transform(input)).toThrow(/at least one WHEN/);
    });

    it("should throw error for WHEN without THEN", () => {
      const input = `CASE WHEN ?x > 10 ELSE "low" END`;
      expect(() => transformer.transform(input)).toThrow(CaseWhenTransformerError);
      expect(() => transformer.transform(input)).toThrow(/missing THEN/);
    });

    it("should throw error for WHEN with empty condition", () => {
      const input = `CASE WHEN THEN "value" END`;
      expect(() => transformer.transform(input)).toThrow(CaseWhenTransformerError);
      expect(() => transformer.transform(input)).toThrow(/empty condition/);
    });

    it("should throw error for WHEN with empty result", () => {
      const input = `CASE WHEN ?x > 10 THEN ELSE "low" END`;
      expect(() => transformer.transform(input)).toThrow(CaseWhenTransformerError);
      expect(() => transformer.transform(input)).toThrow(/empty result/);
    });
  });

  describe("edge cases", () => {
    it("should not modify queries without CASE", () => {
      const input = `SELECT ?x WHERE { ?s ?p ?o }`;
      const result = transformer.transform(input);
      expect(result).toBe(input);
    });

    it("should not match CASE as part of another word", () => {
      const input = `SELECT ?uppercase WHERE { ?s :UPPERCASE ?uppercase }`;
      const result = transformer.transform(input);
      expect(result).toBe(input);
    });

    it("should not match END as part of another word", () => {
      const input = `CASE WHEN ?x > 10 THEN "high" ELSE "low" END ?appendix`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?x > 10, "high", "low") ?appendix`);
    });

    it("should handle single-quoted strings", () => {
      const input = `CASE WHEN ?x > 10 THEN 'high' ELSE 'low' END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?x > 10, 'high', 'low')`);
    });

    it("should preserve string content with CASE keyword inside", () => {
      const input = `CASE WHEN ?type = "CASE study" THEN "match" ELSE "no match" END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?type = "CASE study", "match", "no match")`);
    });

    it("should handle numeric results", () => {
      const input = `CASE WHEN ?x > 10 THEN 100 ELSE 0 END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(?x > 10, 100, 0)`);
    });

    it("should handle variable results", () => {
      const input = `CASE WHEN BOUND(?x) THEN ?x ELSE ?default END`;
      const result = transformer.transform(input);
      expect(result).toBe(`IF(BOUND(?x), ?x, ?default)`);
    });
  });
});
