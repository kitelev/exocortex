/**
 * BuiltInFunctions Error Scenario and Edge Case Tests
 *
 * Tests error handling for:
 * - Type coercion errors
 * - Invalid arguments
 * - Edge cases in string/date/numeric functions
 * - Boundary conditions
 *
 * Issue: #758 - Add Error Scenario and Edge Case Test Suite
 */

import { BuiltInFunctions } from "../../../../../src/infrastructure/sparql/filters/BuiltInFunctions";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";

describe("BuiltInFunctions Error Scenarios", () => {
  describe("STR function errors", () => {
    it("should throw for undefined argument", () => {
      expect(() => BuiltInFunctions.str(undefined)).toThrow(
        "STR: argument is undefined"
      );
    });
  });

  describe("LANG function errors", () => {
    it("should throw for undefined argument", () => {
      expect(() => BuiltInFunctions.lang(undefined)).toThrow(
        "LANG: argument is undefined"
      );
    });
  });

  describe("DATATYPE function errors", () => {
    it("should throw for undefined argument", () => {
      expect(() => BuiltInFunctions.datatype(undefined)).toThrow(
        "DATATYPE: argument is undefined"
      );
    });

    it("should throw for IRI argument", () => {
      const iri = new IRI("http://example.org/");
      expect(() => BuiltInFunctions.datatype(iri)).toThrow(
        "DATATYPE: argument must be a literal"
      );
    });

    it("should throw for blank node argument", () => {
      const blank = new BlankNode("b1");
      expect(() => BuiltInFunctions.datatype(blank)).toThrow(
        "DATATYPE: argument must be a literal"
      );
    });
  });

  describe("REGEX function errors", () => {
    it("should throw for invalid regex pattern", () => {
      expect(() => BuiltInFunctions.regex("test", "[invalid")).toThrow(
        /REGEX: invalid pattern/
      );
    });

    it("should throw for invalid regex flags", () => {
      expect(() => BuiltInFunctions.regex("test", "test", "xyz")).toThrow(
        /REGEX: invalid pattern/
      );
    });

    it("should handle empty pattern", () => {
      // Empty pattern matches every position
      expect(BuiltInFunctions.regex("test", "")).toBe(true);
    });

    it("should handle empty string", () => {
      expect(BuiltInFunctions.regex("", "pattern")).toBe(false);
    });
  });

  describe("REPLACE function errors", () => {
    it("should throw for invalid regex pattern", () => {
      expect(() =>
        BuiltInFunctions.replace("test", "[invalid", "replacement")
      ).toThrow(/REPLACE: invalid pattern/);
    });

    it("should handle empty pattern", () => {
      // Empty pattern replaces at every position
      const result = BuiltInFunctions.replace("abc", "", "x");
      expect(result).toBe("xaxbxcx");
    });

    it("should handle empty replacement", () => {
      expect(BuiltInFunctions.replace("hello world", "world", "")).toBe("hello ");
    });
  });

  describe("Compare function errors", () => {
    it("should throw for unknown operator", () => {
      expect(() => BuiltInFunctions.compare("a", "b", "===")).toThrow(
        "Unknown comparison operator: ==="
      );
    });

    it("should throw for invalid operator", () => {
      expect(() => BuiltInFunctions.compare("a", "b", "<>")).toThrow(
        "Unknown comparison operator: <>"
      );
    });
  });

  describe("Date function errors", () => {
    describe("parseDate", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.parseDate("not-a-date")).toThrow(
          "PARSEDATE: invalid date string"
        );
      });

      it("should throw for empty date string", () => {
        expect(() => BuiltInFunctions.parseDate("")).toThrow(
          "PARSEDATE: invalid date string"
        );
      });

      it("should handle edge case dates", () => {
        // Valid edge cases
        expect(BuiltInFunctions.parseDate("1970-01-01T00:00:00Z")).toBe(0);
        expect(BuiltInFunctions.parseDate("2000-01-01")).toBeGreaterThan(0);
      });
    });

    describe("dateDiffMinutes", () => {
      it("should throw for invalid first date", () => {
        expect(() =>
          BuiltInFunctions.dateDiffMinutes("invalid", "2025-01-01")
        ).toThrow("PARSEDATE: invalid date string");
      });

      it("should throw for invalid second date", () => {
        expect(() =>
          BuiltInFunctions.dateDiffMinutes("2025-01-01", "invalid")
        ).toThrow("PARSEDATE: invalid date string");
      });

      it("should return 0 for same dates", () => {
        const date = "2025-01-01T12:00:00Z";
        expect(BuiltInFunctions.dateDiffMinutes(date, date)).toBe(0);
      });
    });

    describe("YEAR function", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.year("not-a-date")).toThrow(
          "YEAR: invalid date string"
        );
      });
    });

    describe("MONTH function", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.month("not-a-date")).toThrow(
          "MONTH: invalid date string"
        );
      });
    });

    describe("DAY function", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.day("not-a-date")).toThrow(
          "DAY: invalid date string"
        );
      });
    });

    describe("HOURS function", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.hours("not-a-date")).toThrow(
          "HOURS: invalid date string"
        );
      });
    });

    describe("MINUTES function", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.minutes("not-a-date")).toThrow(
          "MINUTES: invalid date string"
        );
      });
    });

    describe("SECONDS function", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.seconds("not-a-date")).toThrow(
          "SECONDS: invalid date string"
        );
      });
    });

    describe("TIMEZONE function", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.timezone("not-a-date")).toThrow(
          "TIMEZONE: invalid date string"
        );
      });
    });
  });

  describe("Type casting function errors", () => {
    describe("xsdDateTime", () => {
      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.xsdDateTime("not-a-date")).toThrow(
          "xsd:dateTime: invalid date string"
        );
      });

      it("should throw for empty string", () => {
        expect(() => BuiltInFunctions.xsdDateTime("")).toThrow(
          "xsd:dateTime: invalid date string"
        );
      });
    });

    describe("xsdInteger", () => {
      it("should throw for non-numeric string", () => {
        expect(() => BuiltInFunctions.xsdInteger("not-a-number")).toThrow(
          "xsd:integer: cannot convert"
        );
      });

      it("should throw for empty string", () => {
        expect(() => BuiltInFunctions.xsdInteger("")).toThrow(
          "xsd:integer: cannot convert"
        );
      });

      it("should truncate decimal values", () => {
        const result = BuiltInFunctions.xsdInteger("42.9");
        expect(result.value).toBe("42");
      });
    });

    describe("xsdDecimal", () => {
      it("should throw for non-numeric string", () => {
        expect(() => BuiltInFunctions.xsdDecimal("not-a-number")).toThrow(
          "xsd:decimal: cannot convert"
        );
      });

      it("should throw for empty string", () => {
        expect(() => BuiltInFunctions.xsdDecimal("")).toThrow(
          "xsd:decimal: cannot convert"
        );
      });
    });
  });

  describe("Constructor function errors", () => {
    describe("IRI constructor", () => {
      it("should throw for undefined argument", () => {
        expect(() => BuiltInFunctions.iri(undefined)).toThrow(
          "IRI: argument is undefined"
        );
      });

      it("should throw for blank node argument", () => {
        const blank = new BlankNode("b1");
        expect(() => BuiltInFunctions.iri(blank)).toThrow(
          "IRI: cannot convert blank node to IRI"
        );
      });

      it("should return same IRI for IRI input", () => {
        const iri = new IRI("http://example.org/");
        const result = BuiltInFunctions.iri(iri);
        expect(result.value).toBe("http://example.org/");
      });
    });

    describe("BNODE constructor", () => {
      it("should throw for IRI argument", () => {
        const iri = new IRI("http://example.org/");
        expect(() => BuiltInFunctions.bnode(iri)).toThrow(
          "BNODE: argument must be a string literal or omitted"
        );
      });

      it("should create unique blank nodes for each call without argument", () => {
        const b1 = BuiltInFunctions.bnode();
        const b2 = BuiltInFunctions.bnode();
        expect(b1.id).not.toBe(b2.id);
      });

      it("should use literal value as blank node ID", () => {
        const literal = new Literal("mynode");
        const blank = BuiltInFunctions.bnode(literal);
        expect(blank.id).toBe("mynode");
      });
    });

    describe("STRDT constructor", () => {
      it("should throw for undefined lexical form", () => {
        const datatype = new IRI("http://www.w3.org/2001/XMLSchema#string");
        expect(() => BuiltInFunctions.strdt(undefined, datatype)).toThrow(
          "STRDT: lexical form is undefined"
        );
      });

      it("should throw for undefined datatype", () => {
        const literal = new Literal("test");
        expect(() => BuiltInFunctions.strdt(literal, undefined)).toThrow(
          "STRDT: datatype IRI is undefined"
        );
      });

      it("should throw for literal with language tag", () => {
        const literal = new Literal("hello", undefined, "en");
        const datatype = new IRI("http://www.w3.org/2001/XMLSchema#string");
        expect(() => BuiltInFunctions.strdt(literal, datatype)).toThrow(
          "STRDT: lexical form must not have a language tag"
        );
      });
    });

    describe("STRLANG constructor", () => {
      it("should throw for undefined lexical form", () => {
        const langTag = new Literal("en");
        expect(() => BuiltInFunctions.strlang(undefined, langTag)).toThrow(
          "STRLANG: lexical form is undefined"
        );
      });

      it("should throw for undefined language tag", () => {
        const literal = new Literal("test");
        expect(() => BuiltInFunctions.strlang(literal, undefined)).toThrow(
          "STRLANG: language tag is undefined"
        );
      });

      it("should throw for empty language tag passed as string", () => {
        const literal = new Literal("test");
        // Pass empty string directly - strlang can accept string type
        expect(() => BuiltInFunctions.strlang(literal, "" as any)).toThrow(
          "STRLANG: language tag cannot be empty"
        );
      });

      it("should throw for literal with existing language tag", () => {
        const literal = new Literal("hello", undefined, "en");
        const langTag = new Literal("de");
        expect(() => BuiltInFunctions.strlang(literal, langTag)).toThrow(
          "STRLANG: lexical form must not already have a language tag"
        );
      });
    });
  });

  describe("String function edge cases", () => {
    describe("SUBSTR", () => {
      it("should handle negative start index", () => {
        // SPARQL uses 1-based indexing
        expect(BuiltInFunctions.substr("hello", 0)).toBe("hello");
        expect(BuiltInFunctions.substr("hello", -1)).toBe("hello");
      });

      it("should handle start beyond string length", () => {
        expect(BuiltInFunctions.substr("hello", 100)).toBe("");
      });

      it("should handle empty string", () => {
        expect(BuiltInFunctions.substr("", 1)).toBe("");
      });

      it("should handle length of 0", () => {
        expect(BuiltInFunctions.substr("hello", 1, 0)).toBe("");
      });

      it("should handle length exceeding remaining string", () => {
        expect(BuiltInFunctions.substr("hello", 3, 100)).toBe("llo");
      });
    });

    describe("STRBEFORE", () => {
      it("should return empty for not found", () => {
        expect(BuiltInFunctions.strBefore("hello", "x")).toBe("");
      });

      it("should return empty for empty separator", () => {
        expect(BuiltInFunctions.strBefore("hello", "")).toBe("");
      });

      it("should return empty when separator at start", () => {
        expect(BuiltInFunctions.strBefore("hello", "h")).toBe("");
      });
    });

    describe("STRAFTER", () => {
      it("should return empty for not found", () => {
        expect(BuiltInFunctions.strAfter("hello", "x")).toBe("");
      });

      it("should return full string for empty separator", () => {
        expect(BuiltInFunctions.strAfter("hello", "")).toBe("hello");
      });

      it("should return empty when separator at end", () => {
        expect(BuiltInFunctions.strAfter("hello", "o")).toBe("");
      });
    });

    describe("CONTAINS edge cases", () => {
      it("should return true for empty substring", () => {
        expect(BuiltInFunctions.contains("hello", "")).toBe(true);
      });

      it("should return true for exact match", () => {
        expect(BuiltInFunctions.contains("hello", "hello")).toBe(true);
      });

      it("should return false when substring is longer", () => {
        expect(BuiltInFunctions.contains("hi", "hello")).toBe(false);
      });
    });

    describe("STRLEN edge cases", () => {
      it("should return 0 for empty string", () => {
        expect(BuiltInFunctions.strlen("")).toBe(0);
      });

      it("should handle Unicode correctly", () => {
        expect(BuiltInFunctions.strlen("日本語")).toBe(3);
        expect(BuiltInFunctions.strlen("👍")).toBe(2); // Emoji is 2 UTF-16 code units
      });
    });
  });

  describe("Numeric function edge cases", () => {
    describe("ABS", () => {
      it("should handle zero", () => {
        expect(BuiltInFunctions.abs(0)).toBe(0);
      });

      it("should handle negative zero", () => {
        expect(BuiltInFunctions.abs(-0)).toBe(0);
      });

      it("should handle Infinity", () => {
        expect(BuiltInFunctions.abs(Infinity)).toBe(Infinity);
        expect(BuiltInFunctions.abs(-Infinity)).toBe(Infinity);
      });

      it("should handle NaN", () => {
        expect(BuiltInFunctions.abs(NaN)).toBeNaN();
      });
    });

    describe("ROUND", () => {
      it("should round half to nearest even (banker's rounding behavior in JS)", () => {
        // Note: JavaScript Math.round doesn't do banker's rounding
        // It rounds 0.5 up
        expect(BuiltInFunctions.round(0.5)).toBe(1);
        expect(BuiltInFunctions.round(1.5)).toBe(2);
        expect(BuiltInFunctions.round(-0.5)).toBe(-0);
      });

      it("should handle very large numbers", () => {
        expect(BuiltInFunctions.round(1e20)).toBe(1e20);
      });
    });

    describe("CEIL", () => {
      it("should handle negative numbers", () => {
        expect(BuiltInFunctions.ceil(-1.5)).toBe(-1);
      });

      it("should handle integers", () => {
        expect(BuiltInFunctions.ceil(5)).toBe(5);
      });
    });

    describe("FLOOR", () => {
      it("should handle negative numbers", () => {
        expect(BuiltInFunctions.floor(-1.5)).toBe(-2);
      });

      it("should handle integers", () => {
        expect(BuiltInFunctions.floor(5)).toBe(5);
      });
    });
  });

  describe("Type checking function edge cases", () => {
    describe("BOUND", () => {
      it("should return false for undefined", () => {
        expect(BuiltInFunctions.bound(undefined)).toBe(false);
      });

      it("should return true for any defined value", () => {
        expect(BuiltInFunctions.bound(new IRI("http://example.org/"))).toBe(true);
        expect(BuiltInFunctions.bound(new Literal("value"))).toBe(true);
        expect(BuiltInFunctions.bound(new BlankNode("b1"))).toBe(true);
      });
    });

    describe("isIRI", () => {
      it("should return false for undefined", () => {
        expect(BuiltInFunctions.isIRI(undefined)).toBe(false);
      });
    });

    describe("isBlank", () => {
      it("should return false for undefined", () => {
        expect(BuiltInFunctions.isBlank(undefined)).toBe(false);
      });
    });

    describe("isLiteral", () => {
      it("should return false for undefined", () => {
        expect(BuiltInFunctions.isLiteral(undefined)).toBe(false);
      });
    });

    describe("isNumeric", () => {
      it("should return false for undefined", () => {
        expect(BuiltInFunctions.isNumeric(undefined)).toBe(false);
      });

      it("should return false for non-literal", () => {
        expect(BuiltInFunctions.isNumeric(new IRI("http://example.org/"))).toBe(
          false
        );
      });

      it("should return false for literal without datatype", () => {
        expect(BuiltInFunctions.isNumeric(new Literal("42"))).toBe(false);
      });

      it("should return true for integer literal", () => {
        const literal = new Literal(
          "42",
          new IRI("http://www.w3.org/2001/XMLSchema#integer")
        );
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });
    });
  });

  describe("sameTerm edge cases", () => {
    it("should return true for both undefined", () => {
      expect(BuiltInFunctions.sameTerm(undefined, undefined)).toBe(true);
    });

    it("should return false for one undefined", () => {
      const iri = new IRI("http://example.org/");
      expect(BuiltInFunctions.sameTerm(iri, undefined)).toBe(false);
      expect(BuiltInFunctions.sameTerm(undefined, iri)).toBe(false);
    });

    it("should return false for different term types", () => {
      const iri = new IRI("http://example.org/");
      const literal = new Literal("http://example.org/");
      expect(BuiltInFunctions.sameTerm(iri, literal)).toBe(false);
    });

    it("should compare literals strictly (including datatype)", () => {
      const lit1 = new Literal(
        "42",
        new IRI("http://www.w3.org/2001/XMLSchema#integer")
      );
      const lit2 = new Literal(
        "42",
        new IRI("http://www.w3.org/2001/XMLSchema#decimal")
      );
      expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(false);
    });
  });

  describe("COALESCE edge cases", () => {
    it("should return undefined for empty array", () => {
      expect(BuiltInFunctions.coalesce([])).toBeUndefined();
    });

    it("should return undefined for all undefined values", () => {
      expect(BuiltInFunctions.coalesce([undefined, undefined])).toBeUndefined();
    });

    it("should return undefined for all null values", () => {
      expect(BuiltInFunctions.coalesce([null, null])).toBeUndefined();
    });

    it("should return first non-null/undefined value", () => {
      expect(BuiltInFunctions.coalesce([undefined, null, "value"])).toBe("value");
    });

    it("should return first value even if falsy but defined", () => {
      expect(BuiltInFunctions.coalesce([0, 1, 2])).toBe(0);
      expect(BuiltInFunctions.coalesce(["", "a", "b"])).toBe("");
      expect(BuiltInFunctions.coalesce([false, true])).toBe(false);
    });
  });

  describe("Logical function edge cases", () => {
    describe("logicalAnd", () => {
      it("should return true for empty array", () => {
        expect(BuiltInFunctions.logicalAnd([])).toBe(true);
      });

      it("should return true for all true", () => {
        expect(BuiltInFunctions.logicalAnd([true, true, true])).toBe(true);
      });

      it("should return false if any false", () => {
        expect(BuiltInFunctions.logicalAnd([true, false, true])).toBe(false);
      });
    });

    describe("logicalOr", () => {
      it("should return false for empty array", () => {
        expect(BuiltInFunctions.logicalOr([])).toBe(false);
      });

      it("should return true if any true", () => {
        expect(BuiltInFunctions.logicalOr([false, true, false])).toBe(true);
      });

      it("should return false for all false", () => {
        expect(BuiltInFunctions.logicalOr([false, false, false])).toBe(false);
      });
    });

    describe("logicalNot", () => {
      it("should invert true to false", () => {
        expect(BuiltInFunctions.logicalNot(true)).toBe(false);
      });

      it("should invert false to true", () => {
        expect(BuiltInFunctions.logicalNot(false)).toBe(true);
      });
    });
  });
});
