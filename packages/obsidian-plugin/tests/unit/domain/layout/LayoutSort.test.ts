import { describe, it, expect } from "@jest/globals";
import {
  createLayoutSortFromFrontmatter,
  isValidSortDirection,
  isValidNullsPosition,
  type LayoutSort,
  type SortDirection,
  type NullsPosition,
} from "../../../../src/domain/layout/LayoutSort";

describe("LayoutSort", () => {
  describe("createLayoutSortFromFrontmatter", () => {
    it("should create a LayoutSort from valid frontmatter", () => {
      const frontmatter = {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000020",
        exo__Asset_label: "Sort by Start Time",
        exo__Asset_description: "Sort by start timestamp descending",
        exo__LayoutSort_property: "[[ems__Effort_startTimestamp]]",
        exo__LayoutSort_direction: "desc",
        exo__LayoutSort_nullsPosition: "last",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.uid).toBe("60000000-0000-0000-0000-000000000020");
      expect(result!.label).toBe("Sort by Start Time");
      expect(result!.description).toBe("Sort by start timestamp descending");
      expect(result!.property).toBe("[[ems__Effort_startTimestamp]]");
      expect(result!.direction).toBe("desc");
      expect(result!.nullsPosition).toBe("last");
    });

    it("should return null when uid is missing", () => {
      const frontmatter = {
        exo__Asset_label: "Sort by Start Time",
        exo__LayoutSort_property: "[[ems__Effort_startTimestamp]]",
        exo__LayoutSort_direction: "desc",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when label is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000020",
        exo__LayoutSort_property: "[[ems__Effort_startTimestamp]]",
        exo__LayoutSort_direction: "desc",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when property is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000020",
        exo__Asset_label: "Sort by Start Time",
        exo__LayoutSort_direction: "desc",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should default direction to asc when not specified", () => {
      const frontmatter = {
        exo__Asset_uid: "sort-001",
        exo__Asset_label: "Default Sort",
        exo__LayoutSort_property: "[[exo__Asset_label]]",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.direction).toBe("asc");
    });

    it("should default direction to asc when invalid value", () => {
      const frontmatter = {
        exo__Asset_uid: "sort-001",
        exo__Asset_label: "Invalid Direction Sort",
        exo__LayoutSort_property: "[[exo__Asset_label]]",
        exo__LayoutSort_direction: "invalid",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.direction).toBe("asc");
    });

    it("should default nullsPosition to last when not specified", () => {
      const frontmatter = {
        exo__Asset_uid: "sort-001",
        exo__Asset_label: "Default Nulls Sort",
        exo__LayoutSort_property: "[[exo__Asset_label]]",
        exo__LayoutSort_direction: "asc",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.nullsPosition).toBe("last");
    });

    it("should set nullsPosition to first when specified", () => {
      const frontmatter = {
        exo__Asset_uid: "sort-001",
        exo__Asset_label: "Nulls First Sort",
        exo__LayoutSort_property: "[[exo__Asset_label]]",
        exo__LayoutSort_direction: "asc",
        exo__LayoutSort_nullsPosition: "first",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.nullsPosition).toBe("first");
    });

    it("should handle description being undefined", () => {
      const frontmatter = {
        exo__Asset_uid: "sort-001",
        exo__Asset_label: "No Description Sort",
        exo__LayoutSort_property: "[[exo__Asset_label]]",
        exo__LayoutSort_direction: "asc",
      };

      const result = createLayoutSortFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
    });
  });

  describe("isValidSortDirection", () => {
    it('should return true for "asc"', () => {
      expect(isValidSortDirection("asc")).toBe(true);
    });

    it('should return true for "desc"', () => {
      expect(isValidSortDirection("desc")).toBe(true);
    });

    it("should return false for invalid string", () => {
      expect(isValidSortDirection("ascending")).toBe(false);
      expect(isValidSortDirection("descending")).toBe(false);
      expect(isValidSortDirection("")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isValidSortDirection(null)).toBe(false);
      expect(isValidSortDirection(undefined)).toBe(false);
      expect(isValidSortDirection(123)).toBe(false);
      expect(isValidSortDirection(true)).toBe(false);
      expect(isValidSortDirection({})).toBe(false);
    });
  });

  describe("isValidNullsPosition", () => {
    it('should return true for "first"', () => {
      expect(isValidNullsPosition("first")).toBe(true);
    });

    it('should return true for "last"', () => {
      expect(isValidNullsPosition("last")).toBe(true);
    });

    it("should return false for invalid string", () => {
      expect(isValidNullsPosition("beginning")).toBe(false);
      expect(isValidNullsPosition("end")).toBe(false);
      expect(isValidNullsPosition("")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isValidNullsPosition(null)).toBe(false);
      expect(isValidNullsPosition(undefined)).toBe(false);
      expect(isValidNullsPosition(123)).toBe(false);
      expect(isValidNullsPosition(true)).toBe(false);
    });
  });

  describe("type safety", () => {
    it("should allow creating LayoutSort with all fields", () => {
      const sort: LayoutSort = {
        uid: "sort-001",
        label: "Test Sort",
        description: "A test sort definition",
        property: "[[exo__Asset_label]]",
        direction: "asc",
        nullsPosition: "last",
      };

      expect(sort.uid).toBe("sort-001");
      expect(sort.label).toBe("Test Sort");
      expect(sort.direction).toBe("asc");
    });

    it("should allow creating LayoutSort with minimal fields", () => {
      const sort: LayoutSort = {
        uid: "sort-001",
        label: "Minimal Sort",
        property: "[[exo__Asset_label]]",
        direction: "desc",
      };

      expect(sort.uid).toBe("sort-001");
      expect(sort.direction).toBe("desc");
      expect(sort.nullsPosition).toBeUndefined();
    });
  });
});
