import { describe, it, expect } from "@jest/globals";
import {
  createLayoutColumnFromFrontmatter,
  isValidColumnRenderer,
  getDefaultColumnHeader,
  type LayoutColumn,
  type ColumnRenderer,
} from "../../../../src/domain/layout/LayoutColumn";

describe("LayoutColumn", () => {
  describe("createLayoutColumnFromFrontmatter", () => {
    it("should create a LayoutColumn from valid frontmatter", () => {
      const frontmatter = {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000010",
        exo__Asset_label: "Task Label Column",
        exo__Asset_description: "Column showing task label",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
        exo__LayoutColumn_header: "Задача",
        exo__LayoutColumn_width: "1fr",
        exo__LayoutColumn_renderer: "link",
        exo__LayoutColumn_editable: true,
        exo__LayoutColumn_sortable: true,
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.uid).toBe("60000000-0000-0000-0000-000000000010");
      expect(result!.label).toBe("Task Label Column");
      expect(result!.description).toBe("Column showing task label");
      expect(result!.property).toBe("[[exo__Asset_label]]");
      expect(result!.header).toBe("Задача");
      expect(result!.width).toBe("1fr");
      expect(result!.renderer).toBe("link");
      expect(result!.editable).toBe(true);
      expect(result!.sortable).toBe(true);
    });

    it("should return null when uid is missing", () => {
      const frontmatter = {
        exo__Asset_label: "Task Label Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when label is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "col-001",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when property is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "col-001",
        exo__Asset_label: "Task Label Column",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it('should default renderer to "text" when not specified', () => {
      const frontmatter = {
        exo__Asset_uid: "col-001",
        exo__Asset_label: "Text Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.renderer).toBe("text");
    });

    it('should default renderer to "text" for invalid renderer value', () => {
      const frontmatter = {
        exo__Asset_uid: "col-001",
        exo__Asset_label: "Invalid Renderer Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
        exo__LayoutColumn_renderer: "invalid_renderer",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.renderer).toBe("text");
    });

    it("should default editable to false when not specified", () => {
      const frontmatter = {
        exo__Asset_uid: "col-001",
        exo__Asset_label: "Non-editable Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.editable).toBe(false);
    });

    it("should default sortable to false when not specified", () => {
      const frontmatter = {
        exo__Asset_uid: "col-001",
        exo__Asset_label: "Non-sortable Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.sortable).toBe(false);
    });

    it("should handle all valid renderer types", () => {
      const renderers: ColumnRenderer[] = [
        "text",
        "link",
        "badge",
        "progress",
        "datetime",
        "duration",
        "number",
        "boolean",
        "tags",
        "image",
        "custom",
      ];

      for (const renderer of renderers) {
        const frontmatter = {
          exo__Asset_uid: `col-${renderer}`,
          exo__Asset_label: `${renderer} Column`,
          exo__LayoutColumn_property: "[[some_property]]",
          exo__LayoutColumn_renderer: renderer,
        };

        const result = createLayoutColumnFromFrontmatter(frontmatter);
        expect(result).not.toBeNull();
        expect(result!.renderer).toBe(renderer);
      }
    });

    it("should handle optional fields being undefined", () => {
      const frontmatter = {
        exo__Asset_uid: "col-001",
        exo__Asset_label: "Minimal Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
      };

      const result = createLayoutColumnFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
      expect(result!.header).toBeUndefined();
      expect(result!.width).toBeUndefined();
    });
  });

  describe("isValidColumnRenderer", () => {
    it("should return true for all valid renderers", () => {
      const validRenderers = [
        "text",
        "link",
        "badge",
        "progress",
        "datetime",
        "duration",
        "number",
        "boolean",
        "tags",
        "image",
        "custom",
      ];

      for (const renderer of validRenderers) {
        expect(isValidColumnRenderer(renderer)).toBe(true);
      }
    });

    it("should return false for invalid renderer strings", () => {
      expect(isValidColumnRenderer("invalid")).toBe(false);
      expect(isValidColumnRenderer("")).toBe(false);
      expect(isValidColumnRenderer("TEXT")).toBe(false);
      expect(isValidColumnRenderer("Link")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isValidColumnRenderer(null)).toBe(false);
      expect(isValidColumnRenderer(undefined)).toBe(false);
      expect(isValidColumnRenderer(123)).toBe(false);
      expect(isValidColumnRenderer(true)).toBe(false);
      expect(isValidColumnRenderer({})).toBe(false);
      expect(isValidColumnRenderer([])).toBe(false);
    });
  });

  describe("getDefaultColumnHeader", () => {
    it("should extract header from simple property wikilink", () => {
      expect(getDefaultColumnHeader("[[exo__Asset_label]]")).toBe("Label");
    });

    it("should extract header from compound property name", () => {
      expect(getDefaultColumnHeader("[[ems__Effort_startTimestamp]]")).toBe(
        "Start Timestamp",
      );
    });

    it("should handle camelCase in property name", () => {
      expect(getDefaultColumnHeader("[[ems__Task_currentEffort]]")).toBe(
        "Current Effort",
      );
    });

    it("should handle property without wikilink brackets", () => {
      expect(getDefaultColumnHeader("exo__Asset_label")).toBe("Label");
    });

    it("should handle single-part property name", () => {
      expect(getDefaultColumnHeader("[[exo__Asset]]")).toBe("Asset");
    });

    it("should capitalize first letter", () => {
      expect(getDefaultColumnHeader("[[some__lowercase_property]]")).toBe(
        "Lowercase Property",
      );
    });
  });

  describe("type safety", () => {
    it("should allow creating LayoutColumn with all fields", () => {
      const column: LayoutColumn = {
        uid: "col-001",
        label: "Full Column",
        description: "A fully specified column",
        property: "[[exo__Asset_label]]",
        header: "Custom Header",
        width: "200px",
        renderer: "link",
        editable: true,
        sortable: true,
      };

      expect(column.uid).toBe("col-001");
      expect(column.renderer).toBe("link");
    });

    it("should allow creating LayoutColumn with minimal fields", () => {
      const column: LayoutColumn = {
        uid: "col-001",
        label: "Minimal Column",
        property: "[[exo__Asset_label]]",
      };

      expect(column.uid).toBe("col-001");
      expect(column.header).toBeUndefined();
    });
  });
});
