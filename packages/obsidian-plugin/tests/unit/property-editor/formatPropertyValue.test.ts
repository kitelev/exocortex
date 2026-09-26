import { formatPropertyValue } from "../../../src/domain/property-editor/formatPropertyValue";

describe("formatPropertyValue", () => {
  describe("null and undefined values", () => {
    it("should return empty string for null", () => {
      expect(formatPropertyValue(null)).toBe("");
    });

    it("should return empty string for undefined", () => {
      expect(formatPropertyValue(undefined)).toBe("");
    });
  });

  describe("boolean values", () => {
    it("should return 'true' for boolean true", () => {
      expect(formatPropertyValue(true)).toBe("true");
    });

    it("should return 'false' for boolean false", () => {
      expect(formatPropertyValue(false)).toBe("false");
    });
  });

  describe("number values", () => {
    it("should return string representation of positive number", () => {
      expect(formatPropertyValue(42)).toBe("42");
    });

    it("should return string representation of zero", () => {
      expect(formatPropertyValue(0)).toBe("0");
    });

    it("should return string representation of negative number", () => {
      expect(formatPropertyValue(-10)).toBe("-10");
    });

    it("should return string representation of decimal number", () => {
      expect(formatPropertyValue(3.14)).toBe("3.14");
    });
  });

  describe("array values", () => {
    it("should format single element array as YAML list", () => {
      const result = formatPropertyValue(["item1"]);
      expect(result).toBe("\n  - item1");
    });

    it("should format multiple element array as YAML list", () => {
      const result = formatPropertyValue(["item1", "item2", "item3"]);
      expect(result).toBe("\n  - item1\n  - item2\n  - item3");
    });

    it("should format empty array", () => {
      const result = formatPropertyValue([]);
      expect(result).toBe("\n");
    });

    // #4405 changed this expectation, and the reason is a measurement, not a
    // preference: `- [[Page1]]` is not a wikilink to YAML, it is a flow
    // sequence inside a flow sequence, and js-yaml reads the item back as the
    // nested array `[["Page1"]]` — never as the string the editor wrote. The
    // quoted form round-trips to `"[[Page1]]"`, which is also how every writer
    // in this codebase (and `quoteRelationValueForYaml` right next to the
    // editor's own call sites) already stores relation values.
    it("should format array with wikilinks, quoted so they read back as strings", () => {
      const result = formatPropertyValue(["[[Page1]]", "[[Page2]]"]);
      expect(result).toBe('\n  - "[[Page1]]"\n  - "[[Page2]]"');
    });
  });

  describe("string values", () => {
    it("should return string as-is", () => {
      expect(formatPropertyValue("hello")).toBe("hello");
    });

    it("should return empty string as-is", () => {
      expect(formatPropertyValue("")).toBe("");
    });

    // Same measurement as the array case above: bare `[[wikilink]]` reads back
    // as `[["wikilink"]]`, so "as-is" was never what the file actually held.
    it("should quote a wikilink so it reads back as a string", () => {
      expect(formatPropertyValue("[[wikilink]]")).toBe('"[[wikilink]]"');
    });
  });

  describe("object values", () => {
    it("should convert object to string", () => {
      const result = formatPropertyValue({ key: "value" });
      expect(result).toBe("[object Object]");
    });
  });
});
