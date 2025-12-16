/**
 * LayoutActions Domain Model Tests
 *
 * Tests for LayoutActions, CommandRef, and related helper functions.
 */
import {
  isValidActionPosition,
  createLayoutActionsFromFrontmatter,
  createCommandRefFromFrontmatter,
  isLayoutActionsFrontmatter,
  isCommandFrontmatter,
  isPreconditionFrontmatter,
  isSparqlGroundingFrontmatter,
} from "../../../../src/domain/layout/LayoutActions";

describe("LayoutActions Domain Model", () => {
  describe("isValidActionPosition", () => {
    it("should return true for valid action positions", () => {
      expect(isValidActionPosition("column")).toBe(true);
      expect(isValidActionPosition("inline")).toBe(true);
      expect(isValidActionPosition("hover")).toBe(true);
      expect(isValidActionPosition("contextMenu")).toBe(true);
    });

    it("should return false for invalid action positions", () => {
      expect(isValidActionPosition("invalid")).toBe(false);
      expect(isValidActionPosition("")).toBe(false);
      expect(isValidActionPosition(null)).toBe(false);
      expect(isValidActionPosition(undefined)).toBe(false);
      expect(isValidActionPosition(123)).toBe(false);
    });
  });

  describe("createLayoutActionsFromFrontmatter", () => {
    it("should create LayoutActions from valid frontmatter", () => {
      const frontmatter = {
        exo__Asset_uid: "test-uid",
        exo__Asset_label: "Test Actions",
        exo__LayoutActions_position: "column",
        exo__LayoutActions_showLabels: true,
      };

      const result = createLayoutActionsFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result?.uid).toBe("test-uid");
      expect(result?.label).toBe("Test Actions");
      expect(result?.position).toBe("column");
      expect(result?.showLabels).toBe(true);
      expect(result?.commands).toEqual([]);
    });

    it("should use default position when not specified", () => {
      const frontmatter = {
        exo__Asset_uid: "test-uid",
        exo__Asset_label: "Test Actions",
      };

      const result = createLayoutActionsFromFrontmatter(frontmatter);

      expect(result?.position).toBe("column");
    });

    it("should default showLabels to false", () => {
      const frontmatter = {
        exo__Asset_uid: "test-uid",
        exo__Asset_label: "Test Actions",
      };

      const result = createLayoutActionsFromFrontmatter(frontmatter);

      expect(result?.showLabels).toBe(false);
    });

    it("should return null when uid is missing", () => {
      const frontmatter = {
        exo__Asset_label: "Test Actions",
      };

      const result = createLayoutActionsFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when label is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "test-uid",
      };

      const result = createLayoutActionsFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should handle invalid position gracefully", () => {
      const frontmatter = {
        exo__Asset_uid: "test-uid",
        exo__Asset_label: "Test Actions",
        exo__LayoutActions_position: "invalid",
      };

      const result = createLayoutActionsFromFrontmatter(frontmatter);

      expect(result?.position).toBe("column"); // Falls back to default
    });
  });

  describe("createCommandRefFromFrontmatter", () => {
    it("should create CommandRef from valid frontmatter", () => {
      const frontmatter = {
        exo__Asset_uid: "cmd-uid",
        exo__Asset_label: "Start Task",
        exo__Command_icon: "play-circle",
      };

      const result = createCommandRefFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result?.uid).toBe("cmd-uid");
      expect(result?.label).toBe("Start Task");
      expect(result?.icon).toBe("play-circle");
    });

    it("should return null when uid is missing", () => {
      const frontmatter = {
        exo__Asset_label: "Start Task",
      };

      const result = createCommandRefFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when label is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "cmd-uid",
      };

      const result = createCommandRefFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should allow optional icon", () => {
      const frontmatter = {
        exo__Asset_uid: "cmd-uid",
        exo__Asset_label: "Start Task",
      };

      const result = createCommandRefFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result?.icon).toBeUndefined();
    });
  });

  describe("isLayoutActionsFrontmatter", () => {
    it("should return true for LayoutActions frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exo__LayoutActions]]"],
      };

      expect(isLayoutActionsFrontmatter(frontmatter)).toBe(true);
    });

    it("should return true for single string instance class", () => {
      const frontmatter = {
        exo__Instance_class: "[[exo__LayoutActions]]",
      };

      expect(isLayoutActionsFrontmatter(frontmatter)).toBe(true);
    });

    it("should return true when LayoutActions is among multiple classes", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exo__Asset]]", "[[exo__LayoutActions]]"],
      };

      expect(isLayoutActionsFrontmatter(frontmatter)).toBe(true);
    });

    it("should return false for non-LayoutActions frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exo__TableLayout]]"],
      };

      expect(isLayoutActionsFrontmatter(frontmatter)).toBe(false);
    });

    it("should return false for empty frontmatter", () => {
      const frontmatter = {};

      expect(isLayoutActionsFrontmatter(frontmatter)).toBe(false);
    });

    it("should handle class name without wikilink brackets", () => {
      const frontmatter = {
        exo__Instance_class: "exo__LayoutActions",
      };

      expect(isLayoutActionsFrontmatter(frontmatter)).toBe(true);
    });
  });

  describe("isCommandFrontmatter", () => {
    it("should return true for Command frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exocmd__Command]]"],
      };

      expect(isCommandFrontmatter(frontmatter)).toBe(true);
    });

    it("should return false for non-Command frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exo__LayoutActions]]"],
      };

      expect(isCommandFrontmatter(frontmatter)).toBe(false);
    });
  });

  describe("isPreconditionFrontmatter", () => {
    it("should return true for Precondition frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exocmd__Precondition]]"],
      };

      expect(isPreconditionFrontmatter(frontmatter)).toBe(true);
    });

    it("should return false for non-Precondition frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exocmd__Command]]"],
      };

      expect(isPreconditionFrontmatter(frontmatter)).toBe(false);
    });
  });

  describe("isSparqlGroundingFrontmatter", () => {
    it("should return true for SparqlGrounding frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exocmd__SparqlGrounding]]"],
      };

      expect(isSparqlGroundingFrontmatter(frontmatter)).toBe(true);
    });

    it("should return false for non-SparqlGrounding frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exocmd__Command]]"],
      };

      expect(isSparqlGroundingFrontmatter(frontmatter)).toBe(false);
    });
  });
});
