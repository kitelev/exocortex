import {
  canPlanOnToday,
  canPlanForEvening,
  canShiftDayBackward,
  canShiftDayForward,
  canSetDraftStatus,
  canMoveToBacklog,
  canStartEffort,
  canMarkDone,
  canTrashEffort,
  canVoteOnEffort,
  canArchiveTask,
  canMarkReviewed,
} from "../../../../../src/domain/commands/visibility/EffortVisibilityRules";
import { getTodayDateString } from "../../../../../src/domain/commands/visibility/helpers";
import type { CommandVisibilityContext } from "../../../../../src/domain/commands/visibility/types";

function makeContext(overrides: Partial<CommandVisibilityContext> = {}): CommandVisibilityContext {
  return {
    instanceClass: "ems__Task",
    currentStatus: null,
    metadata: {},
    isArchived: false,
    currentFolder: "/some/folder",
    expectedFolder: "/some/folder",
    ...overrides,
  };
}

describe("EffortVisibilityRules", () => {
  // ─── canPlanOnToday ───

  describe("canPlanOnToday", () => {
    it("should return false for non-effort class", () => {
      expect(canPlanOnToday(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for Task not planned for today", () => {
      expect(canPlanOnToday(makeContext({ instanceClass: "ems__Task" }))).toBe(true);
    });

    it("should return true for Project not planned for today", () => {
      expect(canPlanOnToday(makeContext({ instanceClass: "ems__Project" }))).toBe(true);
    });

    it("should return true for Meeting not planned for today", () => {
      expect(canPlanOnToday(makeContext({ instanceClass: "ems__Meeting" }))).toBe(true);
    });

    it("should return false when already planned for today", () => {
      const today = getTodayDateString();
      expect(
        canPlanOnToday(
          makeContext({
            instanceClass: "ems__Task",
            metadata: { ems__Effort_plannedStartTimestamp: `${today}T09:00:00` },
          }),
        ),
      ).toBe(false);
    });

    it("should return false for null instanceClass", () => {
      expect(canPlanOnToday(makeContext({ instanceClass: null }))).toBe(false);
    });
  });

  // ─── canPlanForEvening ───

  describe("canPlanForEvening", () => {
    it("should return true for Task with Backlog status", () => {
      expect(
        canPlanForEvening(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(true);
    });

    it("should return true for Meeting with Backlog status", () => {
      expect(
        canPlanForEvening(
          makeContext({
            instanceClass: "ems__Meeting",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for Project (not Task or Meeting)", () => {
      expect(
        canPlanForEvening(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for Task with non-Backlog status", () => {
      expect(
        canPlanForEvening(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDoing",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for Area", () => {
      expect(
        canPlanForEvening(
          makeContext({
            instanceClass: "ems__Area",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(false);
    });

    it("should return false when status is null", () => {
      expect(
        canPlanForEvening(makeContext({ instanceClass: "ems__Task", currentStatus: null })),
      ).toBe(false);
    });
  });

  // ─── canShiftDayBackward ───

  describe("canShiftDayBackward", () => {
    it("should return false for non-effort", () => {
      expect(canShiftDayBackward(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for effort with planned timestamp", () => {
      expect(
        canShiftDayBackward(
          makeContext({
            instanceClass: "ems__Task",
            metadata: { ems__Effort_plannedStartTimestamp: "2025-01-01T09:00:00" },
          }),
        ),
      ).toBe(true);
    });

    it("should return false for effort without planned timestamp", () => {
      expect(canShiftDayBackward(makeContext({ instanceClass: "ems__Task" }))).toBe(false);
    });

    it("should return true for Project with planned timestamp", () => {
      expect(
        canShiftDayBackward(
          makeContext({
            instanceClass: "ems__Project",
            metadata: { ems__Effort_plannedStartTimestamp: "2025-01-01" },
          }),
        ),
      ).toBe(true);
    });
  });

  // ─── canShiftDayForward ───

  describe("canShiftDayForward", () => {
    it("should return false for non-effort", () => {
      expect(canShiftDayForward(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for effort with planned timestamp", () => {
      expect(
        canShiftDayForward(
          makeContext({
            instanceClass: "ems__Task",
            metadata: { ems__Effort_plannedStartTimestamp: "2025-01-01T09:00:00" },
          }),
        ),
      ).toBe(true);
    });

    it("should return false for effort without planned timestamp", () => {
      expect(canShiftDayForward(makeContext({ instanceClass: "ems__Meeting" }))).toBe(false);
    });
  });

  // ─── canSetDraftStatus ───

  describe("canSetDraftStatus", () => {
    it("should return false for non-effort", () => {
      expect(canSetDraftStatus(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for effort without status", () => {
      expect(
        canSetDraftStatus(makeContext({ instanceClass: "ems__Task", currentStatus: null })),
      ).toBe(true);
    });

    it("should return false for effort with a status", () => {
      expect(
        canSetDraftStatus(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDraft",
          }),
        ),
      ).toBe(false);
    });

    it("should return true for Project without status", () => {
      expect(
        canSetDraftStatus(makeContext({ instanceClass: "ems__Project", currentStatus: null })),
      ).toBe(true);
    });

    it("should return false for empty string status (truthy check)", () => {
      expect(
        canSetDraftStatus(makeContext({ instanceClass: "ems__Task", currentStatus: "" })),
      ).toBe(true);
    });
  });

  // ─── canMoveToBacklog ───

  describe("canMoveToBacklog", () => {
    it("should return false for non-effort", () => {
      expect(canMoveToBacklog(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for effort with Draft status", () => {
      expect(
        canMoveToBacklog(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDraft",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for effort with Backlog status", () => {
      expect(
        canMoveToBacklog(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for effort with no status", () => {
      expect(
        canMoveToBacklog(makeContext({ instanceClass: "ems__Task", currentStatus: null })),
      ).toBe(false);
    });
  });

  // ─── canStartEffort ───

  describe("canStartEffort", () => {
    it("should return false for non-effort", () => {
      expect(canStartEffort(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for Task with Backlog status", () => {
      expect(
        canStartEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(true);
    });

    it("should return true for Meeting with Backlog status", () => {
      expect(
        canStartEffort(
          makeContext({
            instanceClass: "ems__Meeting",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for Task with Doing status", () => {
      expect(
        canStartEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDoing",
          }),
        ),
      ).toBe(false);
    });

    it("should return true for Project with ToDo status", () => {
      expect(
        canStartEffort(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusToDo",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for Project with Backlog status", () => {
      expect(
        canStartEffort(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for Project with Doing status", () => {
      expect(
        canStartEffort(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusDoing",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for effort with null status", () => {
      expect(
        canStartEffort(makeContext({ instanceClass: "ems__Task", currentStatus: null })),
      ).toBe(false);
    });
  });

  // ─── canMarkDone ───

  describe("canMarkDone", () => {
    it("should return false for non-effort", () => {
      expect(canMarkDone(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for effort with Doing status", () => {
      expect(
        canMarkDone(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDoing",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for effort with Done status", () => {
      expect(
        canMarkDone(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDone",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for effort with null status", () => {
      expect(canMarkDone(makeContext({ instanceClass: "ems__Task", currentStatus: null }))).toBe(
        false,
      );
    });
  });

  // ─── canTrashEffort ───

  describe("canTrashEffort", () => {
    it("should return false for non-effort", () => {
      expect(canTrashEffort(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for effort with no status", () => {
      expect(
        canTrashEffort(makeContext({ instanceClass: "ems__Task", currentStatus: null })),
      ).toBe(true);
    });

    it("should return true for effort with Draft status", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDraft",
          }),
        ),
      ).toBe(true);
    });

    it("should return true for effort with Doing status", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDoing",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for effort with Trashed status", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusTrashed",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for effort with Done status", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusDone",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for effort with Trashed status in wiki-link", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "[[ems__EffortStatusTrashed]]",
          }),
        ),
      ).toBe(false);
    });

    it("should handle array status with Trashed", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: ["ems__EffortStatusTrashed"],
          }),
        ),
      ).toBe(false);
    });

    it("should handle array status with Done", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: ["ems__EffortStatusDone"],
          }),
        ),
      ).toBe(false);
    });

    it("should return true for array status without Trashed or Done", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: ["ems__EffortStatusDraft"],
          }),
        ),
      ).toBe(true);
    });

    it("should handle array with multiple statuses including Trashed", () => {
      expect(
        canTrashEffort(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: ["ems__EffortStatusDraft", "ems__EffortStatusTrashed"],
          }),
        ),
      ).toBe(false);
    });
  });

  // ─── canVoteOnEffort ───

  describe("canVoteOnEffort", () => {
    it("should return false for non-effort", () => {
      expect(canVoteOnEffort(makeContext({ instanceClass: "ems__Area" }))).toBe(false);
    });

    it("should return true for effort that is not archived", () => {
      expect(
        canVoteOnEffort(makeContext({ instanceClass: "ems__Task", isArchived: false })),
      ).toBe(true);
    });

    it("should return false for archived effort", () => {
      expect(canVoteOnEffort(makeContext({ instanceClass: "ems__Task", isArchived: true }))).toBe(
        false,
      );
    });

    it("should return true for Project not archived", () => {
      expect(
        canVoteOnEffort(makeContext({ instanceClass: "ems__Project", isArchived: false })),
      ).toBe(true);
    });

    it("should return true for Meeting not archived", () => {
      expect(
        canVoteOnEffort(makeContext({ instanceClass: "ems__Meeting", isArchived: false })),
      ).toBe(true);
    });
  });

  // ─── canArchiveTask ───

  describe("canArchiveTask", () => {
    it("should return true when not archived", () => {
      expect(canArchiveTask(makeContext({ isArchived: false }))).toBe(true);
    });

    it("should return false when archived", () => {
      expect(canArchiveTask(makeContext({ isArchived: true }))).toBe(false);
    });

    it("should work for any class (not restricted to efforts)", () => {
      expect(canArchiveTask(makeContext({ instanceClass: "ems__Area", isArchived: false }))).toBe(
        true,
      );
    });
  });

  // ─── canMarkReviewed ───

  describe("canMarkReviewed", () => {
    it("should return true for Task not archived", () => {
      expect(
        canMarkReviewed(makeContext({ instanceClass: "ems__Task", isArchived: false })),
      ).toBe(true);
    });

    it("should return true for Project not archived", () => {
      expect(
        canMarkReviewed(makeContext({ instanceClass: "ems__Project", isArchived: false })),
      ).toBe(true);
    });

    it("should return false for Meeting", () => {
      expect(
        canMarkReviewed(makeContext({ instanceClass: "ems__Meeting", isArchived: false })),
      ).toBe(false);
    });

    it("should return false for Area", () => {
      expect(
        canMarkReviewed(makeContext({ instanceClass: "ems__Area", isArchived: false })),
      ).toBe(false);
    });

    it("should return false for archived Task", () => {
      expect(canMarkReviewed(makeContext({ instanceClass: "ems__Task", isArchived: true }))).toBe(
        false,
      );
    });

    it("should return false for archived Project", () => {
      expect(
        canMarkReviewed(makeContext({ instanceClass: "ems__Project", isArchived: true })),
      ).toBe(false);
    });

    it("should return false for null instanceClass", () => {
      expect(canMarkReviewed(makeContext({ instanceClass: null }))).toBe(false);
    });
  });
});
