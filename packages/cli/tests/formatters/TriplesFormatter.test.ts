import { describe, it, expect } from "@jest/globals";
import { TriplesFormatter } from "../../src/formatters/TriplesFormatter.js";

// Mock Triple structure matching exocortex
interface MockTriple {
  subject: { value: string };
  predicate: { value: string };
  object: { value?: string; datatype?: { value: string }; language?: string; id?: string };
  toString: () => string;
}

function createMockTriple(
  subject: string,
  predicate: string,
  object: string | { value: string; datatype?: string; language?: string } | { id: string },
): MockTriple {
  const subjectNode = { value: subject };
  const predicateNode = { value: predicate };

  let objectNode: MockTriple["object"];
  if (typeof object === "string") {
    objectNode = { value: object };
  } else if ("id" in object) {
    objectNode = { id: object.id };
  } else {
    objectNode = {
      value: object.value,
      ...(object.datatype && { datatype: { value: object.datatype } }),
      ...(object.language && { language: object.language }),
    };
  }

  return {
    subject: subjectNode,
    predicate: predicateNode,
    object: objectNode,
    toString: () => `<${subject}> <${predicate}> ${typeof object === "string" ? `"${object}"` : JSON.stringify(object)} .`,
  };
}

describe("TriplesFormatter", () => {
  let formatter: TriplesFormatter;

  beforeEach(() => {
    formatter = new TriplesFormatter();
  });

  describe("formatNTriples()", () => {
    it("should format triples as N-Triples (one triple per line)", () => {
      const triples = [
        createMockTriple("http://example.org/task1", "http://example.org/label", "Task 1"),
        createMockTriple("http://example.org/task2", "http://example.org/label", "Task 2"),
      ];

      const result = formatter.formatNTriples(triples as any);

      expect(result).toContain("<http://example.org/task1>");
      expect(result).toContain("<http://example.org/task2>");
      expect(result.split("\n")).toHaveLength(2);
    });

    it("should handle empty array", () => {
      const result = formatter.formatNTriples([]);

      expect(result).toBe("");
    });

    it("should handle single triple", () => {
      const triples = [
        createMockTriple("http://example.org/s", "http://example.org/p", "object"),
      ];

      const result = formatter.formatNTriples(triples as any);

      expect(result).not.toContain("\n");
    });
  });

  describe("formatTable()", () => {
    it("should format triples as a simple table", () => {
      const triples = [
        createMockTriple("http://example.org/task1", "http://example.org/label", "Task 1"),
        createMockTriple("http://example.org/task2", "http://example.org/status", "Done"),
      ];

      const result = formatter.formatTable(triples as any);

      expect(result).toContain("Subject | Predicate | Object");
      expect(result).toContain("------- | --------- | ------");
      expect(result).toContain("http://example.org/task1");
      expect(result).toContain("http://example.org/label");
      expect(result).toContain("Task 1");
    });

    it("should handle empty array", () => {
      const result = formatter.formatTable([]);

      expect(result).toBe("No triples generated.");
    });

    it("should format each triple on separate line", () => {
      const triples = [
        createMockTriple("http://example.org/s1", "http://example.org/p1", "o1"),
        createMockTriple("http://example.org/s2", "http://example.org/p2", "o2"),
        createMockTriple("http://example.org/s3", "http://example.org/p3", "o3"),
      ];

      const result = formatter.formatTable(triples as any);
      const lines = result.split("\n");

      // Header + separator + 3 data rows = 5 lines
      expect(lines).toHaveLength(5);
    });
  });

  describe("formatJson()", () => {
    it("should format triples as JSON array", () => {
      const triples = [
        createMockTriple("http://example.org/task1", "http://example.org/label", "Task 1"),
      ];

      const result = formatter.formatJson(triples as any);
      const parsed = JSON.parse(result);

      expect(parsed).toBeInstanceOf(Array);
      expect(parsed).toHaveLength(1);
    });

    it("should handle empty array", () => {
      const result = formatter.formatJson([]);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([]);
    });

    it("should format URI nodes correctly", () => {
      const triples = [
        createMockTriple("http://example.org/subject", "http://example.org/predicate", "http://example.org/object"),
      ];

      const result = formatter.formatJson(triples as any);
      const parsed = JSON.parse(result);

      expect(parsed[0].subject.type).toBe("uri");
      expect(parsed[0].predicate.type).toBe("uri");
      expect(parsed[0].object.type).toBe("uri");
    });

    it("should format literal nodes with datatype", () => {
      const triples = [
        createMockTriple(
          "http://example.org/s",
          "http://example.org/p",
          { value: "42", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
        ),
      ];

      const result = formatter.formatJson(triples as any);
      const parsed = JSON.parse(result);

      expect(parsed[0].object.type).toBe("literal");
      expect(parsed[0].object.value).toBe("42");
      expect(parsed[0].object.datatype).toBe("http://www.w3.org/2001/XMLSchema#integer");
    });

    it("should format literal nodes with language", () => {
      const triples = [
        createMockTriple(
          "http://example.org/s",
          "http://example.org/p",
          { value: "Hello", language: "en" },
        ),
      ];

      const result = formatter.formatJson(triples as any);
      const parsed = JSON.parse(result);

      expect(parsed[0].object.type).toBe("literal");
      expect(parsed[0].object.value).toBe("Hello");
      expect(parsed[0].object.language).toBe("en");
    });

    it("should format blank nodes correctly", () => {
      const triples = [
        createMockTriple(
          "http://example.org/s",
          "http://example.org/p",
          { id: "_:b1" },
        ),
      ];

      const result = formatter.formatJson(triples as any);
      const parsed = JSON.parse(result);

      expect(parsed[0].object.type).toBe("bnode");
      expect(parsed[0].object.value).toBe("_:b1");
    });

    it("should produce valid pretty-printed JSON", () => {
      const triples = [
        createMockTriple("http://example.org/s", "http://example.org/p", "value"),
      ];

      const result = formatter.formatJson(triples as any);

      // Should have indentation (pretty-printed)
      expect(result).toContain("\n");
      expect(result).toMatch(/^\[/);
      expect(result).toMatch(/\]$/);
    });
  });
});
