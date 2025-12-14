import { WikiLinkHelpers } from "../../src/utilities/WikiLinkHelpers";

describe("WikiLinkHelpers", () => {
  describe("normalize", () => {
    it("should remove brackets", () => {
      expect(WikiLinkHelpers.normalize("[[Note]]")).toBe("Note");
    });
    
    it("should handle null", () => {
      expect(WikiLinkHelpers.normalize(null)).toBe("");
    });
  });

  describe("normalizeArray", () => {
    it("should normalize array", () => {
      expect(WikiLinkHelpers.normalizeArray(["[[A]]", "[[B]]"])).toEqual(["A", "B"]);
    });
    
    it("should handle single string", () => {
      expect(WikiLinkHelpers.normalizeArray("[[Note]]")).toEqual(["Note"]);
    });
  });

  describe("equals", () => {
    it("should compare normalized", () => {
      expect(WikiLinkHelpers.equals("[[A]]", "A")).toBe(true);
    });
  });

  describe("includes", () => {
    it("should find in array", () => {
      expect(WikiLinkHelpers.includes(["[[A]]", "[[B]]"], "A")).toBe(true);
    });
  });
});
