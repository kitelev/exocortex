import {
  EffortStatus,
  EFFORT_STATUS_CONFIG,
  STATUS_NAME_TO_ENUM,
  STATUS_NAME_TO_WIKILINK,
  EFFORT_STATUS_OPTIONS,
  normalizeEffortStatus,
  isDoneStatus,
  isTrashedStatus,
  getEffortStatusLabel,
} from "../../../src/domain/constants";

describe("EffortStatusConfig (Issue #2463)", () => {
  describe("EFFORT_STATUS_CONFIG", () => {
    it("should have 7 status entries", () => {
      expect(EFFORT_STATUS_CONFIG).toHaveLength(7);
    });

    it("should map each name to correct enum and wikilink", () => {
      const draft = EFFORT_STATUS_CONFIG.find((c) => c.name === "Draft");
      expect(draft?.status).toBe(EffortStatus.DRAFT);
      expect(draft?.wikilink).toBe("[[ems__EffortStatusDraft]]");

      const todo = EFFORT_STATUS_CONFIG.find((c) => c.name === "To Do");
      expect(todo?.status).toBe(EffortStatus.TODO);
      expect(todo?.wikilink).toBe("[[ems__EffortStatusToDo]]");
    });
  });

  describe("STATUS_NAME_TO_ENUM", () => {
    it("should map all human-readable names to EffortStatus", () => {
      expect(STATUS_NAME_TO_ENUM["Draft"]).toBe(EffortStatus.DRAFT);
      expect(STATUS_NAME_TO_ENUM["Backlog"]).toBe(EffortStatus.BACKLOG);
      expect(STATUS_NAME_TO_ENUM["Analysis"]).toBe(EffortStatus.ANALYSIS);
      expect(STATUS_NAME_TO_ENUM["To Do"]).toBe(EffortStatus.TODO);
      expect(STATUS_NAME_TO_ENUM["Doing"]).toBe(EffortStatus.DOING);
      expect(STATUS_NAME_TO_ENUM["Done"]).toBe(EffortStatus.DONE);
      expect(STATUS_NAME_TO_ENUM["Trashed"]).toBe(EffortStatus.TRASHED);
    });
  });

  describe("STATUS_NAME_TO_WIKILINK", () => {
    it("should produce wikilink format", () => {
      expect(STATUS_NAME_TO_WIKILINK["Doing"]).toBe("[[ems__EffortStatusDoing]]");
      expect(STATUS_NAME_TO_WIKILINK["To Do"]).toBe("[[ems__EffortStatusToDo]]");
    });
  });

  describe("EFFORT_STATUS_OPTIONS", () => {
    it("should have 7 options with value and label", () => {
      expect(EFFORT_STATUS_OPTIONS).toHaveLength(7);
      for (const opt of EFFORT_STATUS_OPTIONS) {
        expect(opt.value).toMatch(/^\[\[ems__EffortStatus\w+\]\]$/);
        expect(opt.label).toBeTruthy();
      }
    });

    it("should have correct label-value pairs", () => {
      const draft = EFFORT_STATUS_OPTIONS.find((o) => o.label === "Draft");
      expect(draft?.value).toBe("[[ems__EffortStatusDraft]]");
    });
  });

  describe("normalizeEffortStatus", () => {
    it("should return ems__ format for name input", () => {
      expect(normalizeEffortStatus("To Do")).toBe(EffortStatus.TODO);
      expect(normalizeEffortStatus("Doing")).toBe(EffortStatus.DOING);
    });

    it("should pass through ems__ format", () => {
      expect(normalizeEffortStatus("ems__EffortStatusDone")).toBe(EffortStatus.DONE);
    });

    it("should return fallback for unknown input", () => {
      expect(normalizeEffortStatus("Unknown")).toBe(EffortStatus.DRAFT);
      expect(normalizeEffortStatus("Unknown", EffortStatus.BACKLOG)).toBe(EffortStatus.BACKLOG);
    });
  });

  describe("isDoneStatus", () => {
    it("should return true for Done", () => {
      expect(isDoneStatus(EffortStatus.DONE)).toBe(true);
    });

    it("should return false for non-Done", () => {
      expect(isDoneStatus(EffortStatus.DOING)).toBe(false);
      expect(isDoneStatus(EffortStatus.DRAFT)).toBe(false);
    });
  });

  describe("isTrashedStatus", () => {
    it("should return true for Trashed", () => {
      expect(isTrashedStatus(EffortStatus.TRASHED)).toBe(true);
    });

    it("should return false for non-Trashed", () => {
      expect(isTrashedStatus(EffortStatus.DONE)).toBe(false);
    });
  });

  describe("getEffortStatusLabel", () => {
    it("should resolve raw URI to label", () => {
      expect(getEffortStatusLabel("ems__EffortStatusDoing")).toBe("Doing");
      expect(getEffortStatusLabel("ems__EffortStatusDone")).toBe("Done");
      expect(getEffortStatusLabel("ems__EffortStatusToDo")).toBe("To Do");
    });

    it("should resolve wikilink to label", () => {
      expect(getEffortStatusLabel("[[ems__EffortStatusDoing]]")).toBe("Doing");
      expect(getEffortStatusLabel("[[ems__EffortStatusToDo]]")).toBe("To Do");
    });

    it("should handle already human-readable labels", () => {
      expect(getEffortStatusLabel("Doing")).toBe("Doing");
      expect(getEffortStatusLabel("To Do")).toBe("To Do");
    });

    it("should handle case-insensitive labels", () => {
      expect(getEffortStatusLabel("doing")).toBe("Doing");
      expect(getEffortStatusLabel("DONE")).toBe("Done");
      expect(getEffortStatusLabel("to do")).toBe("To Do");
    });

    it("should return dash for null/undefined/empty", () => {
      expect(getEffortStatusLabel(null)).toBe("-");
      expect(getEffortStatusLabel(undefined)).toBe("-");
      expect(getEffortStatusLabel("")).toBe("-");
    });

    it("should return original value for unknown status", () => {
      expect(getEffortStatusLabel("unknown_status")).toBe("unknown_status");
      expect(getEffortStatusLabel("CustomStatus")).toBe("CustomStatus");
    });
  });
});
