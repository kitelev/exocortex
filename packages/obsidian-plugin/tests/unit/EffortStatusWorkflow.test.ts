import {
  EffortStatusWorkflow,
} from "exocortex";

describe("EffortStatusWorkflow", () => {
  let workflow: EffortStatusWorkflow;

  beforeEach(() => {
    workflow = new EffortStatusWorkflow();
  });

  describe("getPreviousStatus", () => {
    it("should return null for Draft status (start of workflow)", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusDraft]]"',
        null,
      );
      expect(result).toBeNull();
    });

    it("should return Draft for Backlog status", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusBacklog]]"',
        null,
      );
      expect(result).toBe('"[[ems__EffortStatusDraft]]"');
    });

    it("should return Backlog for Analysis status", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusAnalysis]]"',
        null,
      );
      expect(result).toBe('"[[ems__EffortStatusBacklog]]"');
    });

    it("should return Analysis for ToDo status", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusToDo]]"',
        null,
      );
      expect(result).toBe('"[[ems__EffortStatusAnalysis]]"');
    });

    it("should return Backlog for Doing status when Task", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusDoing]]"',
        '"[[ems__Task]]"',
      );
      expect(result).toBe('"[[ems__EffortStatusBacklog]]"');
    });

    it("should return ToDo for Doing status when Project", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusDoing]]"',
        '"[[ems__Project]]"',
      );
      expect(result).toBe('"[[ems__EffortStatusToDo]]"');
    });

    it("should return Doing for Done status", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusDone]]"',
        null,
      );
      expect(result).toBe('"[[ems__EffortStatusDoing]]"');
    });

    it("should return undefined for Trashed status (cannot rollback)", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusTrashed]]"',
        null,
      );
      expect(result).toBeUndefined();
    });

    it("should handle array of instance classes for Project", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusDoing]]"',
        ['"[[ems__Project]]"', '"[[ems__Effort]]"'],
      );
      expect(result).toBe('"[[ems__EffortStatusToDo]]"');
    });

    it("should handle array of instance classes for Task", () => {
      const result = workflow.getPreviousStatus(
        '"[[ems__EffortStatusDoing]]"',
        ['"[[ems__Task]]"', '"[[ems__Effort]]"'],
      );
      expect(result).toBe('"[[ems__EffortStatusBacklog]]"');
    });
  });

  describe("normalizeStatus", () => {
    it("should remove quotes and brackets from status", () => {
      const result = workflow.normalizeStatus('"[[ems__EffortStatusDraft]]"');
      expect(result).toBe("ems__EffortStatusDraft");
    });

    it("should handle status without quotes", () => {
      const result = workflow.normalizeStatus("[[ems__EffortStatusDone]]");
      expect(result).toBe("ems__EffortStatusDone");
    });

    it("should handle status with single quotes", () => {
      const result = workflow.normalizeStatus("'[[ems__EffortStatusBacklog]]'");
      expect(result).toBe("ems__EffortStatusBacklog");
    });

    it("should trim whitespace", () => {
      const result = workflow.normalizeStatus(
        '  "[[ems__EffortStatusToDo]]"  ',
      );
      expect(result).toBe("ems__EffortStatusToDo");
    });
  });

  describe("wrapStatus", () => {
    it("should wrap status with quotes and brackets", () => {
      const result = workflow.wrapStatus("ems__EffortStatusDraft");
      expect(result).toBe('"[[ems__EffortStatusDraft]]"');
    });

    it("should wrap any string", () => {
      const result = workflow.wrapStatus("CustomStatus");
      expect(result).toBe('"[[CustomStatus]]"');
    });
  });
});
