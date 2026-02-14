/**
 * Integration tests for Issue #2120: Table column misalignment in Asset Relations
 *
 * These tests verify that the .exocortex-relations-table CSS class uses
 * table-layout: fixed to ensure proper column alignment and colgroup widths.
 *
 * Root cause: CSS had `table-layout: auto` which ignores colgroup width definitions.
 * Fix: Change to `table-layout: fixed` so colgroup widths are respected.
 */

import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

describe("Issue #2120: Table column alignment", () => {
  // Read the actual CSS file
  const cssFilePath = path.join(__dirname, "../../styles.css");
  const cssContent = fs.readFileSync(cssFilePath, "utf-8");

  describe("regression test", () => {
    it("should use table-layout: fixed for .exocortex-relations-table", () => {
      // This test validates that the CSS file contains the correct table-layout rule
      // for the Asset Relations table class.
      //
      // The table-layout: fixed is REQUIRED for:
      // 1. colgroup column widths to be respected
      // 2. Consistent column alignment between header and body tables in virtualized mode
      // 3. Proper visual separation between columns (no merged appearance)

      // Find the .exocortex-relations-table rule block that sets table-layout
      // The CSS structure should have:
      // .exocortex-relations-table {
      //   ...
      //   table-layout: fixed;
      //   ...
      // }

      // Parse CSS to find the table-layout value for .exocortex-relations-table
      // We look for the rule that sets table-layout for this class specifically
      const tableLayoutRegex =
        /\.exocortex-relations-table\s*\{[^}]*table-layout:\s*(auto|fixed)[^}]*\}/;
      const match = cssContent.match(tableLayoutRegex);

      expect(match).not.toBeNull();

      if (match) {
        const tableLayoutValue = match[1];
        expect(tableLayoutValue).toBe("fixed");
      }
    });

    it("should not override table-layout with !important in the CSS", () => {
      // Ensure there's no !important override that could break inline styles
      const importantOverrideRegex =
        /\.exocortex-relations-table[^{]*\{[^}]*table-layout:\s*auto\s*!important/;
      const hasImportantOverride = importantOverrideRegex.test(cssContent);

      expect(hasImportantOverride).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should have border-collapse: collapse for proper cell borders", () => {
      // border-collapse: collapse is required for cell borders to merge properly
      const borderCollapseRegex =
        /\.exocortex-relations-table[^{]*\{[^}]*border-collapse:\s*collapse/;
      const hasBorderCollapse = borderCollapseRegex.test(cssContent);

      expect(hasBorderCollapse).toBe(true);
    });

    it("should define max-width for cells to prevent overflow", () => {
      // Cells should have max-width to prevent content from breaking layout
      const maxWidthRegex =
        /\.exocortex-relations-table\s+(?:td|th)[^{]*\{[^}]*max-width:/;
      const hasMaxWidth = maxWidthRegex.test(cssContent);

      expect(hasMaxWidth).toBe(true);
    });
  });

  describe("integration", () => {
    it("should have consistent table styling for Reading View", () => {
      // Reading View uses .markdown-preview-view context
      const readingViewRegex =
        /\.markdown-preview-view\s+\.exocortex-relations-table[^{]*\{[^}]*border-collapse:\s*collapse/;
      const hasReadingViewStyles = readingViewRegex.test(cssContent);

      expect(hasReadingViewStyles).toBe(true);
    });

    it("should have consistent table styling for Edit mode", () => {
      // Edit mode uses .cm-content or .cm-scroller context
      const editModeRegex =
        /\.cm-(?:content|scroller)\s+\.exocortex-relations-table[^{]*\{/;
      const hasEditModeStyles = editModeRegex.test(cssContent);

      expect(hasEditModeStyles).toBe(true);
    });
  });
});
