import {
  canCreateEvent,
  canCreateInstance,
  canCleanProperties,
  canRepairFolder,
  canRenameToUid,
  canCopyLabelToAliases,
  canCreateNarrowerConcept,
  canCreateSubclass,
  canCreateTaskForDailyNote,
  canCopyFleetingNoteLabel,
} from "../../../../../src/domain/commands/visibility/AssetVisibilityRules";
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

describe("AssetVisibilityRules", () => {
  // ─── canCreateEvent ───

  describe("canCreateEvent", () => {
    it("should return true for Area", () => {
      expect(canCreateEvent(makeContext({ instanceClass: "ems__Area" }))).toBe(true);
    });

    it("should return true for Project", () => {
      expect(canCreateEvent(makeContext({ instanceClass: "ems__Project" }))).toBe(true);
    });

    it("should return false for Task", () => {
      expect(canCreateEvent(makeContext({ instanceClass: "ems__Task" }))).toBe(false);
    });

    it("should return false for null instanceClass", () => {
      expect(canCreateEvent(makeContext({ instanceClass: null }))).toBe(false);
    });

    it("should return false for Meeting", () => {
      expect(canCreateEvent(makeContext({ instanceClass: "ems__Meeting" }))).toBe(false);
    });
  });

  // ─── canCreateInstance ───

  describe("canCreateInstance", () => {
    it("should return true for TaskPrototype", () => {
      expect(canCreateInstance(makeContext({ instanceClass: "ems__TaskPrototype" }))).toBe(true);
    });

    it("should return true for TaskPrototype UID", () => {
      expect(
        canCreateInstance(
          makeContext({ instanceClass: "75302770-279e-4a59-ba85-09df29725713" }),
        ),
      ).toBe(true);
    });

    it("should return true for MeetingPrototype", () => {
      expect(canCreateInstance(makeContext({ instanceClass: "ems__MeetingPrototype" }))).toBe(true);
    });

    it("should return true for EventPrototype", () => {
      expect(canCreateInstance(makeContext({ instanceClass: "exo__EventPrototype" }))).toBe(true);
    });

    it("should return true for ProjectPrototype", () => {
      expect(canCreateInstance(makeContext({ instanceClass: "ems__ProjectPrototype" }))).toBe(true);
    });

    it("should return true for exo__Prototype directly", () => {
      expect(canCreateInstance(makeContext({ instanceClass: "exo__Prototype" }))).toBe(true);
    });

    it("should return true when classIsPrototype is true", () => {
      expect(
        canCreateInstance(
          makeContext({
            instanceClass: "some-uuid",
            classIsPrototype: true,
          }),
        ),
      ).toBe(true);
    });

    it("should return true for class inheriting from Prototype", () => {
      expect(
        canCreateInstance(
          makeContext({
            instanceClass: "exo__Class",
            metadata: { exo__Class_superClass: "exo__Prototype" },
          }),
        ),
      ).toBe(true);
    });

    it("should return false for regular Task", () => {
      expect(canCreateInstance(makeContext({ instanceClass: "ems__Task" }))).toBe(false);
    });

    it("should return false for null instanceClass", () => {
      expect(canCreateInstance(makeContext({ instanceClass: null }))).toBe(false);
    });

    it("should return false for class not inheriting from Prototype", () => {
      expect(
        canCreateInstance(
          makeContext({
            instanceClass: "exo__Class",
            metadata: { exo__Class_superClass: "some__Other" },
          }),
        ),
      ).toBe(false);
    });

    it("should return true when array contains TaskPrototype", () => {
      expect(
        canCreateInstance(
          makeContext({ instanceClass: ["ems__TaskPrototype", "something__Else"] }),
        ),
      ).toBe(true);
    });

    it("should return true when array contains exo__Prototype", () => {
      expect(
        canCreateInstance(makeContext({ instanceClass: ["exo__Prototype", "something__Else"] })),
      ).toBe(true);
    });

    it("should return false when classIsPrototype is false and no other match", () => {
      expect(
        canCreateInstance(
          makeContext({
            instanceClass: "some__Random",
            classIsPrototype: false,
          }),
        ),
      ).toBe(false);
    });

    it("should return false when classIsPrototype is undefined and no other match", () => {
      expect(
        canCreateInstance(
          makeContext({
            instanceClass: "some__Random",
          }),
        ),
      ).toBe(false);
    });
  });

  // ─── canCleanProperties ───

  describe("canCleanProperties", () => {
    it("should return true when metadata has empty property", () => {
      expect(canCleanProperties(makeContext({ metadata: { key: null } }))).toBe(true);
    });

    it("should return true when metadata has empty string property", () => {
      expect(canCleanProperties(makeContext({ metadata: { key: "" } }))).toBe(true);
    });

    it("should return true when metadata has empty array property", () => {
      expect(canCleanProperties(makeContext({ metadata: { key: [] } }))).toBe(true);
    });

    it("should return false when metadata has no empty properties", () => {
      expect(canCleanProperties(makeContext({ metadata: { key: "value" } }))).toBe(false);
    });

    it("should return false for empty metadata", () => {
      expect(canCleanProperties(makeContext({ metadata: {} }))).toBe(false);
    });
  });

  // ─── canRepairFolder ───

  describe("canRepairFolder", () => {
    it("should return true when folder differs from expected", () => {
      expect(
        canRepairFolder(
          makeContext({
            currentFolder: "/wrong/folder",
            expectedFolder: "/correct/folder",
          }),
        ),
      ).toBe(true);
    });

    it("should return false when folder matches expected", () => {
      expect(
        canRepairFolder(
          makeContext({
            currentFolder: "/correct/folder",
            expectedFolder: "/correct/folder",
          }),
        ),
      ).toBe(false);
    });

    it("should return false when expectedFolder is null", () => {
      expect(
        canRepairFolder(
          makeContext({
            currentFolder: "/some/folder",
            expectedFolder: null,
          }),
        ),
      ).toBe(false);
    });

    it("should handle trailing slash normalization", () => {
      expect(
        canRepairFolder(
          makeContext({
            currentFolder: "/correct/folder/",
            expectedFolder: "/correct/folder",
          }),
        ),
      ).toBe(false);
    });
  });

  // ─── canRenameToUid ───

  describe("canRenameToUid", () => {
    it("should return true when filename differs from uid", () => {
      expect(
        canRenameToUid(
          makeContext({ metadata: { exo__Asset_uid: "abc-123" } }),
          "different-name",
        ),
      ).toBe(true);
    });

    it("should return false when filename matches uid", () => {
      expect(
        canRenameToUid(makeContext({ metadata: { exo__Asset_uid: "abc-123" } }), "abc-123"),
      ).toBe(false);
    });

    it("should return false when uid is missing", () => {
      expect(canRenameToUid(makeContext({ metadata: {} }), "some-file")).toBe(false);
    });

    it("should return false when uid is null", () => {
      expect(
        canRenameToUid(makeContext({ metadata: { exo__Asset_uid: null } }), "some-file"),
      ).toBe(false);
    });

    it("should return false when uid is undefined", () => {
      expect(
        canRenameToUid(makeContext({ metadata: { exo__Asset_uid: undefined } }), "some-file"),
      ).toBe(false);
    });
  });

  // ─── canCopyLabelToAliases ───

  describe("canCopyLabelToAliases", () => {
    it("should return false when label is missing", () => {
      expect(canCopyLabelToAliases(makeContext({ metadata: {} }))).toBe(false);
    });

    it("should return false when label is null", () => {
      expect(canCopyLabelToAliases(makeContext({ metadata: { exo__Asset_label: null } }))).toBe(
        false,
      );
    });

    it("should return false when label is empty string", () => {
      expect(canCopyLabelToAliases(makeContext({ metadata: { exo__Asset_label: "" } }))).toBe(
        false,
      );
    });

    it("should return false when label is whitespace only", () => {
      expect(canCopyLabelToAliases(makeContext({ metadata: { exo__Asset_label: "   " } }))).toBe(
        false,
      );
    });

    it("should return false when label is not a string", () => {
      expect(canCopyLabelToAliases(makeContext({ metadata: { exo__Asset_label: 42 } }))).toBe(
        false,
      );
    });

    it("should return true when label exists but aliases is missing", () => {
      expect(
        canCopyLabelToAliases(makeContext({ metadata: { exo__Asset_label: "My Label" } })),
      ).toBe(true);
    });

    it("should return true when label exists but aliases is not array", () => {
      expect(
        canCopyLabelToAliases(
          makeContext({ metadata: { exo__Asset_label: "My Label", aliases: "single" } }),
        ),
      ).toBe(true);
    });

    it("should return true when aliases is empty array", () => {
      expect(
        canCopyLabelToAliases(
          makeContext({ metadata: { exo__Asset_label: "My Label", aliases: [] } }),
        ),
      ).toBe(true);
    });

    it("should return false when label already in aliases", () => {
      expect(
        canCopyLabelToAliases(
          makeContext({
            metadata: { exo__Asset_label: "My Label", aliases: ["My Label"] },
          }),
        ),
      ).toBe(false);
    });

    it("should return true when label not in aliases", () => {
      expect(
        canCopyLabelToAliases(
          makeContext({
            metadata: { exo__Asset_label: "My Label", aliases: ["Other Label"] },
          }),
        ),
      ).toBe(true);
    });

    it("should handle whitespace in label comparison", () => {
      expect(
        canCopyLabelToAliases(
          makeContext({
            metadata: { exo__Asset_label: " My Label ", aliases: ["My Label"] },
          }),
        ),
      ).toBe(false);
    });

    it("should handle non-string values in aliases array", () => {
      expect(
        canCopyLabelToAliases(
          makeContext({
            metadata: { exo__Asset_label: "My Label", aliases: [42, null, "Other"] },
          }),
        ),
      ).toBe(true);
    });

    it("should return false when non-string alias matches after type check", () => {
      expect(
        canCopyLabelToAliases(
          makeContext({
            metadata: {
              exo__Asset_label: "My Label",
              aliases: [42, "My Label"],
            },
          }),
        ),
      ).toBe(false);
    });
  });

  // ─── canCreateNarrowerConcept ───

  describe("canCreateNarrowerConcept", () => {
    it("should return true for Concept", () => {
      expect(canCreateNarrowerConcept(makeContext({ instanceClass: "ims__Concept" }))).toBe(true);
    });

    it("should return false for Task", () => {
      expect(canCreateNarrowerConcept(makeContext({ instanceClass: "ems__Task" }))).toBe(false);
    });

    it("should return false for null", () => {
      expect(canCreateNarrowerConcept(makeContext({ instanceClass: null }))).toBe(false);
    });
  });

  // ─── canCreateSubclass ───

  describe("canCreateSubclass", () => {
    it("should return true for exo__Class", () => {
      expect(canCreateSubclass(makeContext({ instanceClass: "exo__Class" }))).toBe(true);
    });

    it("should return false for Task", () => {
      expect(canCreateSubclass(makeContext({ instanceClass: "ems__Task" }))).toBe(false);
    });

    it("should return false for null", () => {
      expect(canCreateSubclass(makeContext({ instanceClass: null }))).toBe(false);
    });
  });

  // ─── canCreateTaskForDailyNote ───

  describe("canCreateTaskForDailyNote", () => {
    it("should return false for non-DailyNote", () => {
      expect(canCreateTaskForDailyNote(makeContext({ instanceClass: "ems__Task" }))).toBe(false);
    });

    it("should return false for archived DailyNote", () => {
      expect(
        canCreateTaskForDailyNote(
          makeContext({
            instanceClass: "pn__DailyNote",
            isArchived: true,
            metadata: { pn__DailyNote_day: "[[2025-01-01]]" },
          }),
        ),
      ).toBe(false);
    });

    it("should return false when DailyNote has no date", () => {
      expect(
        canCreateTaskForDailyNote(
          makeContext({
            instanceClass: "pn__DailyNote",
            metadata: {},
          }),
        ),
      ).toBe(false);
    });

    it("should return true for DailyNote with valid date", () => {
      expect(
        canCreateTaskForDailyNote(
          makeContext({
            instanceClass: "pn__DailyNote",
            metadata: { pn__DailyNote_day: "[[2025-01-01]]" },
          }),
        ),
      ).toBe(true);
    });

    it("should return true for DailyNote with plain date", () => {
      expect(
        canCreateTaskForDailyNote(
          makeContext({
            instanceClass: "pn__DailyNote",
            metadata: { pn__DailyNote_day: "2025-01-01" },
          }),
        ),
      ).toBe(true);
    });

    it("should return false for null instanceClass", () => {
      expect(canCreateTaskForDailyNote(makeContext({ instanceClass: null }))).toBe(false);
    });

    it("should return false when DailyNote_day is null", () => {
      expect(
        canCreateTaskForDailyNote(
          makeContext({
            instanceClass: "pn__DailyNote",
            metadata: { pn__DailyNote_day: null },
          }),
        ),
      ).toBe(false);
    });
  });

  // ─── canCopyFleetingNoteLabel ───

  describe("canCopyFleetingNoteLabel", () => {
    it("should return true for FleetingNote", () => {
      expect(canCopyFleetingNoteLabel(makeContext({ instanceClass: "ztlk__FleetingNote" }))).toBe(
        true,
      );
    });

    it("should return true for FleetingNote UID", () => {
      expect(
        canCopyFleetingNoteLabel(
          makeContext({ instanceClass: "fca0a931-a01f-48e4-b72a-4af206c94bc7" }),
        ),
      ).toBe(true);
    });

    it("should return false for Task", () => {
      expect(canCopyFleetingNoteLabel(makeContext({ instanceClass: "ems__Task" }))).toBe(false);
    });

    it("should return false for null", () => {
      expect(canCopyFleetingNoteLabel(makeContext({ instanceClass: null }))).toBe(false);
    });

    it("should return true when array contains FleetingNote", () => {
      expect(
        canCopyFleetingNoteLabel(
          makeContext({ instanceClass: ["ztlk__FleetingNote", "other"] }),
        ),
      ).toBe(true);
    });

    it("should return true when array contains FleetingNote UID", () => {
      expect(
        canCopyFleetingNoteLabel(
          makeContext({
            instanceClass: ["fca0a931-a01f-48e4-b72a-4af206c94bc7", "other"],
          }),
        ),
      ).toBe(true);
    });
  });
});
