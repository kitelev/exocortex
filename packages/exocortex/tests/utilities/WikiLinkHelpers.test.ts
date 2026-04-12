import { WikiLinkHelpers } from "../../src/utilities/WikiLinkHelpers";

describe("WikiLinkHelpers", () => {
  describe("normalize", () => {
    it("should remove brackets", () => {
      expect(WikiLinkHelpers.normalize("[[Note]]")).toBe("Note");
    });

    it("should handle null", () => {
      expect(WikiLinkHelpers.normalize(null)).toBe("");
    });

    it("should handle undefined", () => {
      expect(WikiLinkHelpers.normalize(undefined)).toBe("");
    });

    it("should handle empty string", () => {
      expect(WikiLinkHelpers.normalize("")).toBe("");
    });

    it("should trim whitespace after removing brackets", () => {
      // Kills mutant 880: MethodExpression replacing trim() result
      // If .replace returns value without trim, whitespace would remain
      expect(WikiLinkHelpers.normalize("  [[Note]]  ")).toBe("Note");
    });

    it("should return trimmed plain text without brackets", () => {
      // Kills mutant 880: if replace returns just "" instead of stripping brackets,
      // result would be "" instead of the actual text
      expect(WikiLinkHelpers.normalize("PlainText")).toBe("PlainText");
    });

    it("should handle value with only brackets", () => {
      expect(WikiLinkHelpers.normalize("[[]]")).toBe("");
    });

    describe("UUID-alias wikilinks (issue #2764)", () => {
      it("should prefer alias when target is a UUID", () => {
        expect(
          WikiLinkHelpers.normalize("[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]"),
        ).toBe("ems__Area");
      });

      it("should handle UUID-alias with uppercase hex", () => {
        expect(
          WikiLinkHelpers.normalize("[[82C74542-1B14-4217-B852-D84730484B25|ems__Project]]"),
        ).toBe("ems__Project");
      });

      it("should fall back to UUID when alias is empty", () => {
        expect(
          WikiLinkHelpers.normalize("[[82c74542-1b14-4217-b852-d84730484b25|]]"),
        ).toBe("82c74542-1b14-4217-b852-d84730484b25");
      });

      it("should prefer target (not alias) when target is non-UUID", () => {
        // For non-UUID targets, the target is the canonical file basename
        // and the alias is just display text — keep the target.
        expect(WikiLinkHelpers.normalize("[[Some Note|Display Label]]")).toBe(
          "Some Note",
        );
      });

      it("should keep working for plain class wikilinks without alias", () => {
        expect(WikiLinkHelpers.normalize("[[ems__Area]]")).toBe("ems__Area");
      });

      it("should handle UUID-alias where alias contains special chars", () => {
        expect(
          WikiLinkHelpers.normalize("[[82c74542-1b14-4217-b852-d84730484b25|ems__Class Name]]"),
        ).toBe("ems__Class Name");
      });

      it("should reject malformed UUID targets (fall through to target)", () => {
        // "not-a-uuid" doesn't match the UUID pattern, so target (non-UUID branch) is returned
        expect(WikiLinkHelpers.normalize("[[not-a-uuid|alias]]")).toBe("not-a-uuid");
      });

      it("should treat a UUID target with multi-pipe alias correctly", () => {
        expect(
          WikiLinkHelpers.normalize("[[82c74542-1b14-4217-b852-d84730484b25|label|extra]]"),
        ).toBe("label|extra");
      });
    });
  });

  describe("normalizeArray", () => {
    it("should normalize array", () => {
      expect(WikiLinkHelpers.normalizeArray(["[[A]]", "[[B]]"])).toEqual(["A", "B"]);
    });

    it("should handle single string", () => {
      expect(WikiLinkHelpers.normalizeArray("[[Note]]")).toEqual(["Note"]);
    });

    it("should handle null input", () => {
      // Kills mutant 885: ConditionalExpression 'false' for !values check
      expect(WikiLinkHelpers.normalizeArray(null)).toEqual([]);
    });

    it("should handle undefined input", () => {
      expect(WikiLinkHelpers.normalizeArray(undefined)).toEqual([]);
    });

    it("should filter out empty strings after normalization", () => {
      // Kills mutant 888: MethodExpression removing .filter()
      // Kills mutant 891: ConditionalExpression 'true' for v.length > 0
      // Kills mutant 893: EqualityOperator v.length >= 0 instead of > 0
      expect(WikiLinkHelpers.normalizeArray(["[[A]]", "", "[[B]]"])).toEqual(["A", "B"]);
    });

    it("should filter out whitespace-only strings", () => {
      // After normalize, "  " becomes "" which should be filtered out
      expect(WikiLinkHelpers.normalizeArray(["[[A]]", "  ", "[[B]]"])).toEqual(["A", "B"]);
    });

    it("should filter out bracket-only strings", () => {
      // [[]] normalizes to "" which should be filtered
      expect(WikiLinkHelpers.normalizeArray(["[[A]]", "[[]]", "[[B]]"])).toEqual(["A", "B"]);
    });

    it("should return empty array when all elements normalize to empty", () => {
      expect(WikiLinkHelpers.normalizeArray(["", "  ", "[[]]"])).toEqual([]);
    });
  });

  describe("equals", () => {
    it("should compare normalized", () => {
      expect(WikiLinkHelpers.equals("[[A]]", "A")).toBe(true);
    });

    it("should return false for different values", () => {
      expect(WikiLinkHelpers.equals("[[A]]", "B")).toBe(false);
    });

    it("should handle both null values", () => {
      expect(WikiLinkHelpers.equals(null, null)).toBe(true);
    });

    it("should handle null vs non-empty", () => {
      expect(WikiLinkHelpers.equals(null, "A")).toBe(false);
    });
  });

  describe("includes", () => {
    it("should find in array", () => {
      expect(WikiLinkHelpers.includes(["[[A]]", "[[B]]"], "A")).toBe(true);
    });

    it("should return false when not found", () => {
      // Kills mutant 896: ConditionalExpression 'true' for includes check
      expect(WikiLinkHelpers.includes(["[[A]]", "[[B]]"], "C")).toBe(false);
    });

    it("should handle null array", () => {
      expect(WikiLinkHelpers.includes(null, "A")).toBe(false);
    });

    it("should handle string input instead of array", () => {
      expect(WikiLinkHelpers.includes("[[A]]", "A")).toBe(true);
    });

    it("should handle string input that does not match", () => {
      expect(WikiLinkHelpers.includes("[[A]]", "B")).toBe(false);
    });
  });
});
