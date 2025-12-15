import { describe, it, expect } from "@jest/globals";
import {
  createLayoutGroupFromFrontmatter,
  isValidGroupSortOrder,
  type LayoutGroup,
  type GroupSortOrder,
} from "../../../../src/domain/layout/LayoutGroup";

describe("LayoutGroup", () => {
  describe("createLayoutGroupFromFrontmatter", () => {
    it("should create a LayoutGroup from valid frontmatter", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Group by Project",
        exo__Asset_description: "Group tasks by their parent project",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
        exo__LayoutGroup_collapsed: false,
        exo__LayoutGroup_showCount: true,
        exo__LayoutGroup_sortGroups: "asc",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.uid).toBe("group-001");
      expect(result!.label).toBe("Group by Project");
      expect(result!.description).toBe("Group tasks by their parent project");
      expect(result!.property).toBe("[[ems__Task_project]]");
      expect(result!.collapsed).toBe(false);
      expect(result!.showCount).toBe(true);
      expect(result!.sortGroups).toBe("asc");
    });

    it("should return null when uid is missing", () => {
      const frontmatter = {
        exo__Asset_label: "Group by Project",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when label is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when property is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Group by Project",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should default collapsed to false when not specified", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Default Collapsed Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.collapsed).toBe(false);
    });

    it("should set collapsed to true when specified", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Collapsed Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
        exo__LayoutGroup_collapsed: true,
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.collapsed).toBe(true);
    });

    it("should default showCount to true when not specified", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Default ShowCount Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.showCount).toBe(true);
    });

    it("should set showCount to false when explicitly set", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "No Count Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
        exo__LayoutGroup_showCount: false,
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.showCount).toBe(false);
    });

    it('should default sortGroups to "asc" when not specified', () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Default Sort Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.sortGroups).toBe("asc");
    });

    it('should handle sortGroups "desc"', () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Descending Sort Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
        exo__LayoutGroup_sortGroups: "desc",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.sortGroups).toBe("desc");
    });

    it('should handle sortGroups "custom"', () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Custom Sort Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
        exo__LayoutGroup_sortGroups: "custom",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.sortGroups).toBe("custom");
    });

    it('should default sortGroups to "asc" for invalid value', () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "Invalid Sort Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
        exo__LayoutGroup_sortGroups: "invalid",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.sortGroups).toBe("asc");
    });

    it("should handle description being undefined", () => {
      const frontmatter = {
        exo__Asset_uid: "group-001",
        exo__Asset_label: "No Description Group",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
      };

      const result = createLayoutGroupFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
    });
  });

  describe("isValidGroupSortOrder", () => {
    it('should return true for "asc"', () => {
      expect(isValidGroupSortOrder("asc")).toBe(true);
    });

    it('should return true for "desc"', () => {
      expect(isValidGroupSortOrder("desc")).toBe(true);
    });

    it('should return true for "custom"', () => {
      expect(isValidGroupSortOrder("custom")).toBe(true);
    });

    it("should return false for invalid string values", () => {
      expect(isValidGroupSortOrder("ascending")).toBe(false);
      expect(isValidGroupSortOrder("descending")).toBe(false);
      expect(isValidGroupSortOrder("")).toBe(false);
      expect(isValidGroupSortOrder("ASC")).toBe(false);
      expect(isValidGroupSortOrder("DESC")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isValidGroupSortOrder(null)).toBe(false);
      expect(isValidGroupSortOrder(undefined)).toBe(false);
      expect(isValidGroupSortOrder(123)).toBe(false);
      expect(isValidGroupSortOrder(true)).toBe(false);
      expect(isValidGroupSortOrder({})).toBe(false);
    });
  });

  describe("type safety", () => {
    it("should allow creating LayoutGroup with all fields", () => {
      const group: LayoutGroup = {
        uid: "group-001",
        label: "Full Group",
        description: "A fully specified group",
        property: "[[ems__Task_project]]",
        collapsed: true,
        showCount: true,
        sortGroups: "desc",
      };

      expect(group.uid).toBe("group-001");
      expect(group.sortGroups).toBe("desc");
    });

    it("should allow creating LayoutGroup with minimal fields", () => {
      const group: LayoutGroup = {
        uid: "group-001",
        label: "Minimal Group",
        property: "[[ems__Task_project]]",
      };

      expect(group.uid).toBe("group-001");
      expect(group.collapsed).toBeUndefined();
    });
  });
});
