/**
 * Kanban Types Utility Tests
 *
 * Tests for the utility functions in the kanban/types module.
 */

import {
  extractLabelFromWikilink,
  extractPathFromWikilink,
} from "@plugin/presentation/renderers/kanban/types";

describe("Kanban Types Utilities", () => {
  describe("extractLabelFromWikilink", () => {
    it("extracts label from piped wikilink", () => {
      expect(extractLabelFromWikilink("[[path/to/file|Display Label]]")).toBe("Display Label");
    });

    it("extracts filename from simple wikilink", () => {
      expect(extractLabelFromWikilink("[[path/to/filename]]")).toBe("filename");
    });

    it("extracts filename from single-segment wikilink", () => {
      expect(extractLabelFromWikilink("[[filename]]")).toBe("filename");
    });

    it("removes .md extension from filename", () => {
      expect(extractLabelFromWikilink("[[path/to/file.md]]")).toBe("file");
    });

    it("returns original string if not a wikilink", () => {
      expect(extractLabelFromWikilink("not a wikilink")).toBe("not a wikilink");
    });

    it("handles wikilink with nested path", () => {
      expect(extractLabelFromWikilink("[[deep/nested/path/to/myfile]]")).toBe("myfile");
    });

    it("handles wikilink with special characters in label", () => {
      expect(extractLabelFromWikilink("[[file|Label with spaces & symbols!]]")).toBe("Label with spaces & symbols!");
    });
  });

  describe("extractPathFromWikilink", () => {
    it("extracts path from piped wikilink", () => {
      expect(extractPathFromWikilink("[[path/to/file|Label]]")).toBe("path/to/file");
    });

    it("extracts path from simple wikilink", () => {
      expect(extractPathFromWikilink("[[path/to/file]]")).toBe("path/to/file");
    });

    it("extracts path from single-segment wikilink", () => {
      expect(extractPathFromWikilink("[[filename]]")).toBe("filename");
    });

    it("returns original string if not a wikilink", () => {
      expect(extractPathFromWikilink("not a wikilink")).toBe("not a wikilink");
    });

    it("handles wikilink with .md extension", () => {
      expect(extractPathFromWikilink("[[path/to/file.md|Label]]")).toBe("path/to/file.md");
    });
  });
});
