import {
  hasClass,
  isAreaOrProject,
  isEffort,
  hasStatus,
  isAssetArchived,
  hasEmptyProperties,
  needsFolderRepair,
  getTodayDateString,
  isPlannedForToday,
  hasPlannedStartTimestamp,
  extractDailyNoteDate,
  isCurrentDateGteDay,
  inheritsFromPrototype,
  isPrototypeClass,
} from "../../../../../src/domain/commands/visibility/helpers";

describe("helpers", () => {
  // ─── hasClass ───

  describe("hasClass", () => {
    it("should return false when instanceClass is null", () => {
      expect(hasClass(null, "ems__Task")).toBe(false);
    });

    it("should return false when instanceClass is empty string", () => {
      expect(hasClass("", "ems__Task")).toBe(false);
    });

    it("should return true when string matches target", () => {
      expect(hasClass("ems__Task", "ems__Task")).toBe(true);
    });

    it("should return false when string does not match target", () => {
      expect(hasClass("ems__Project", "ems__Task")).toBe(false);
    });

    it("should handle wiki-link format in string", () => {
      expect(hasClass("[[ems__Task]]", "ems__Task")).toBe(true);
    });

    it("should return true when array contains matching class", () => {
      expect(hasClass(["ems__Task", "ems__Project"], "ems__Task")).toBe(true);
    });

    it("should return false when array does not contain matching class", () => {
      expect(hasClass(["ems__Area", "ems__Project"], "ems__Task")).toBe(false);
    });

    it("should handle wiki-link format in array", () => {
      expect(hasClass(["[[ems__Task]]"], "ems__Task")).toBe(true);
    });

    it("should return false for empty array", () => {
      expect(hasClass([], "ems__Task")).toBe(false);
    });
  });

  // ─── isAreaOrProject ───

  describe("isAreaOrProject", () => {
    it("should return true for ems__Area", () => {
      expect(isAreaOrProject("ems__Area")).toBe(true);
    });

    it("should return true for ems__Project", () => {
      expect(isAreaOrProject("ems__Project")).toBe(true);
    });

    it("should return false for ems__Task", () => {
      expect(isAreaOrProject("ems__Task")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isAreaOrProject(null)).toBe(false);
    });

    it("should return true when array contains Area", () => {
      expect(isAreaOrProject(["ems__Area"])).toBe(true);
    });

    it("should return true when array contains Project", () => {
      expect(isAreaOrProject(["ems__Project"])).toBe(true);
    });

    it("should return false when array contains neither", () => {
      expect(isAreaOrProject(["ems__Task"])).toBe(false);
    });
  });

  // ─── isEffort ───

  describe("isEffort", () => {
    it("should return true for ems__Task", () => {
      expect(isEffort("ems__Task")).toBe(true);
    });

    it("should return true for ems__Project", () => {
      expect(isEffort("ems__Project")).toBe(true);
    });

    it("should return true for ems__Meeting", () => {
      expect(isEffort("ems__Meeting")).toBe(true);
    });

    it("should return false for ems__Area", () => {
      expect(isEffort("ems__Area")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isEffort(null)).toBe(false);
    });

    it("should return true when array contains Task", () => {
      expect(isEffort(["ems__Task"])).toBe(true);
    });

    it("should return false when array contains only Area", () => {
      expect(isEffort(["ems__Area"])).toBe(false);
    });
  });

  // ─── hasStatus ───

  describe("hasStatus", () => {
    it("should return false when currentStatus is null", () => {
      expect(hasStatus(null, "ems__EffortStatusDoing")).toBe(false);
    });

    it("should return false when currentStatus is empty string", () => {
      expect(hasStatus("", "ems__EffortStatusDoing")).toBe(false);
    });

    it("should return true when string matches target", () => {
      expect(hasStatus("ems__EffortStatusDoing", "ems__EffortStatusDoing")).toBe(true);
    });

    it("should return false when string does not match", () => {
      expect(hasStatus("ems__EffortStatusDraft", "ems__EffortStatusDoing")).toBe(false);
    });

    it("should handle wiki-link format", () => {
      expect(hasStatus("[[ems__EffortStatusDoing]]", "ems__EffortStatusDoing")).toBe(true);
    });

    it("should use first element when currentStatus is array", () => {
      expect(
        hasStatus(["ems__EffortStatusDoing", "ems__EffortStatusDraft"], "ems__EffortStatusDoing"),
      ).toBe(true);
    });

    it("should return false when array first element does not match", () => {
      expect(
        hasStatus(["ems__EffortStatusDraft", "ems__EffortStatusDoing"], "ems__EffortStatusDoing"),
      ).toBe(false);
    });

    it("should return false when array is empty", () => {
      expect(hasStatus([], "ems__EffortStatusDoing")).toBe(false);
    });

    it("should return false for array with empty string as first element", () => {
      expect(hasStatus([""], "ems__EffortStatusDoing")).toBe(false);
    });
  });

  // ─── isAssetArchived ───

  describe("isAssetArchived", () => {
    it("should return true for boolean true", () => {
      expect(isAssetArchived(true)).toBe(true);
    });

    it("should return false for boolean false", () => {
      expect(isAssetArchived(false)).toBe(false);
    });

    it("should return true for number 1", () => {
      expect(isAssetArchived(1)).toBe(true);
    });

    it("should return false for number 0", () => {
      expect(isAssetArchived(0)).toBe(false);
    });

    it("should return true for string 'true'", () => {
      expect(isAssetArchived("true")).toBe(true);
    });

    it("should return true for string 'True' (case insensitive)", () => {
      expect(isAssetArchived("True")).toBe(true);
    });

    it("should return true for string 'TRUE'", () => {
      expect(isAssetArchived("TRUE")).toBe(true);
    });

    it("should return true for string 'yes'", () => {
      expect(isAssetArchived("yes")).toBe(true);
    });

    it("should return true for string 'Yes'", () => {
      expect(isAssetArchived("Yes")).toBe(true);
    });

    it("should return false for string 'false'", () => {
      expect(isAssetArchived("false")).toBe(false);
    });

    it("should return false for string 'no'", () => {
      expect(isAssetArchived("no")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isAssetArchived(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isAssetArchived(undefined)).toBe(false);
    });

    it("should return false for random string", () => {
      expect(isAssetArchived("random")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isAssetArchived("")).toBe(false);
    });

    it("should return false for number 2", () => {
      expect(isAssetArchived(2)).toBe(false);
    });

    it("should return false for object", () => {
      expect(isAssetArchived({})).toBe(false);
    });

    it("should return false for array", () => {
      expect(isAssetArchived([])).toBe(false);
    });
  });

  // ─── hasEmptyProperties ───

  describe("hasEmptyProperties", () => {
    it("should return false for null metadata", () => {
      expect(hasEmptyProperties(null as unknown as Record<string, unknown>)).toBe(false);
    });

    it("should return false for empty metadata object", () => {
      expect(hasEmptyProperties({})).toBe(false);
    });

    it("should return true when a property is null", () => {
      expect(hasEmptyProperties({ key: null })).toBe(true);
    });

    it("should return true when a property is undefined", () => {
      expect(hasEmptyProperties({ key: undefined })).toBe(true);
    });

    it("should return true when a property is empty string", () => {
      expect(hasEmptyProperties({ key: "" })).toBe(true);
    });

    // @req:f05caada-fbaa-43fb-9808-e5330c685df4 — a quoted whitespace-only string
    // is KEPT by PropertyCleanupService.isEmptyValue, so the gate must NOT flag it
    // (else the Clean Properties button shows but clicking is a no-op).
    it("@req:f05caada-fbaa-43fb-9808-e5330c685df4 should return false for a whitespace-only string (cleanup keeps it)", () => {
      expect(hasEmptyProperties({ key: "   " })).toBe(false);
    });

    it("should return true when a property is empty array", () => {
      expect(hasEmptyProperties({ key: [] })).toBe(true);
    });

    // @req:f05caada-fbaa-43fb-9808-e5330c685df4 — cleanEmptyProperties removes a
    // list whose items are ALL empty, so the gate must flag it too.
    it("@req:f05caada-fbaa-43fb-9808-e5330c685df4 should return true when a list has only empty items (cleanup removes it)", () => {
      expect(hasEmptyProperties({ key: [null] })).toBe(true);
      expect(hasEmptyProperties({ key: [null, "   ", ""] })).toBe(true);
    });

    it("should return false when a list has at least one non-empty item", () => {
      expect(hasEmptyProperties({ key: [null, "real"] })).toBe(false);
    });

    it("should return true when a property is empty object", () => {
      expect(hasEmptyProperties({ key: {} })).toBe(true);
    });

    it("should return false when all properties have values", () => {
      expect(hasEmptyProperties({ key: "value", num: 42, arr: [1] })).toBe(false);
    });

    it("should return true when at least one property is empty among non-empty ones", () => {
      expect(hasEmptyProperties({ a: "value", b: null, c: 42 })).toBe(true);
    });

    it("should return false for non-empty string values", () => {
      expect(hasEmptyProperties({ key: "hello" })).toBe(false);
    });

    it("should return false for non-empty array", () => {
      expect(hasEmptyProperties({ key: [1, 2, 3] })).toBe(false);
    });

    it("should return false for non-empty object", () => {
      expect(hasEmptyProperties({ key: { nested: true } })).toBe(false);
    });

    it("should return false for number values", () => {
      expect(hasEmptyProperties({ key: 0 })).toBe(false);
    });

    it("should return false for boolean values", () => {
      expect(hasEmptyProperties({ key: false })).toBe(false);
    });
  });

  // ─── needsFolderRepair ───

  describe("needsFolderRepair", () => {
    it("should return false when expectedFolder is null", () => {
      expect(needsFolderRepair("/some/path", null)).toBe(false);
    });

    it("should return false when folders match", () => {
      expect(needsFolderRepair("/some/path", "/some/path")).toBe(false);
    });

    it("should return true when folders differ", () => {
      expect(needsFolderRepair("/some/path", "/other/path")).toBe(true);
    });

    it("should normalize trailing slashes", () => {
      expect(needsFolderRepair("/some/path/", "/some/path")).toBe(false);
    });

    it("should normalize trailing slashes on expected", () => {
      expect(needsFolderRepair("/some/path", "/some/path/")).toBe(false);
    });

    it("should return true when different folders with trailing slashes", () => {
      expect(needsFolderRepair("/some/path/", "/other/path/")).toBe(true);
    });

    it("should return false when expectedFolder is empty string", () => {
      expect(needsFolderRepair("", "")).toBe(false);
    });
  });

  // ─── getTodayDateString ───

  describe("getTodayDateString", () => {
    it("should return date in YYYY-MM-DD format", () => {
      const result = getTodayDateString();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should return today's date", () => {
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      expect(getTodayDateString()).toBe(expected);
    });
  });

  // ─── isPlannedForToday ───

  describe("isPlannedForToday", () => {
    const todayString = getTodayDateString();

    it("should return false when plannedStartTimestamp is missing", () => {
      expect(isPlannedForToday({})).toBe(false);
    });

    it("should return false when plannedStartTimestamp is null", () => {
      expect(isPlannedForToday({ ems__Effort_plannedStartTimestamp: null })).toBe(false);
    });

    it("should return false when plannedStartTimestamp is empty string", () => {
      expect(isPlannedForToday({ ems__Effort_plannedStartTimestamp: "" })).toBe(false);
    });

    it("should return true when string timestamp matches today", () => {
      expect(
        isPlannedForToday({
          ems__Effort_plannedStartTimestamp: `${todayString}T09:00:00`,
        }),
      ).toBe(true);
    });

    it("should return true when string timestamp is just today's date", () => {
      expect(
        isPlannedForToday({
          ems__Effort_plannedStartTimestamp: todayString,
        }),
      ).toBe(true);
    });

    it("should return false when string timestamp is a different date", () => {
      expect(
        isPlannedForToday({
          ems__Effort_plannedStartTimestamp: "2020-01-01T09:00:00",
        }),
      ).toBe(false);
    });

    it("should return true when array first element matches today", () => {
      expect(
        isPlannedForToday({
          ems__Effort_plannedStartTimestamp: [`${todayString}T10:00:00`],
        }),
      ).toBe(true);
    });

    it("should return false when array first element is different date", () => {
      expect(
        isPlannedForToday({
          ems__Effort_plannedStartTimestamp: ["2020-01-01T10:00:00"],
        }),
      ).toBe(false);
    });

    it("should return false when array is empty", () => {
      expect(
        isPlannedForToday({
          ems__Effort_plannedStartTimestamp: [],
        }),
      ).toBe(false);
    });

    it("should return false when plannedStartTimestamp is a number", () => {
      expect(
        isPlannedForToday({
          ems__Effort_plannedStartTimestamp: 12345,
        }),
      ).toBe(false);
    });
  });

  // ─── hasPlannedStartTimestamp ───

  describe("hasPlannedStartTimestamp", () => {
    it("should return false when property is missing", () => {
      expect(hasPlannedStartTimestamp({})).toBe(false);
    });

    it("should return false when property is null", () => {
      expect(hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: null })).toBe(false);
    });

    it("should return false when property is empty string", () => {
      expect(hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: "" })).toBe(false);
    });

    it("should return false when property is whitespace-only string", () => {
      expect(hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: "   " })).toBe(false);
    });

    it("should return true when property is non-empty string", () => {
      expect(
        hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: "2025-01-01T09:00:00" }),
      ).toBe(true);
    });

    it("should return true when array has non-empty first element", () => {
      expect(
        hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: ["2025-01-01T09:00:00"] }),
      ).toBe(true);
    });

    it("should return false when array is empty", () => {
      expect(hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: [] })).toBe(false);
    });

    it("should return false when array first element is whitespace", () => {
      expect(hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: ["  "] })).toBe(false);
    });

    it("should return false when property is a number", () => {
      expect(hasPlannedStartTimestamp({ ems__Effort_plannedStartTimestamp: 12345 })).toBe(false);
    });
  });

  // ─── extractDailyNoteDate ───

  describe("extractDailyNoteDate", () => {
    it("should return null when property is missing", () => {
      expect(extractDailyNoteDate({})).toBeNull();
    });

    it("should return null when property is null", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: null })).toBeNull();
    });

    it("should return null when property is empty string", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: "" })).toBeNull();
    });

    it("should extract date from wiki-link format", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: "[[2025-11-11]]" })).toBe("2025-11-11");
    });

    it("should return plain string when no wiki-link", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: "2025-11-11" })).toBe("2025-11-11");
    });

    it("should handle array with wiki-link format", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: ["[[2025-11-11]]"] })).toBe("2025-11-11");
    });

    it("should handle array with plain string", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: ["2025-11-11"] })).toBe("2025-11-11");
    });

    it("should return null when array is empty", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: [] })).toBeNull();
    });

    it("should return null when property is a number", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: 20251111 })).toBeNull();
    });

    it("should handle nested content in wiki-link", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: "[[some-date-value]]" })).toBe(
        "some-date-value",
      );
    });
  });

  // ─── isCurrentDateGteDay ───

  describe("isCurrentDateGteDay", () => {
    it("should return true when dailyNoteDate is in the past", () => {
      expect(isCurrentDateGteDay("2000-01-01")).toBe(true);
    });

    it("should return true when dailyNoteDate is today", () => {
      const today = getTodayDateString();
      expect(isCurrentDateGteDay(today)).toBe(true);
    });

    it("should return false when dailyNoteDate is in the far future", () => {
      expect(isCurrentDateGteDay("2099-12-31")).toBe(false);
    });
  });

  // ─── inheritsFromPrototype ───

  describe("inheritsFromPrototype", () => {
    it("should return false when no exo__Class_superClass", () => {
      expect(inheritsFromPrototype({})).toBe(false);
    });

    it("should return true when direct superclass is exo__Prototype", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "exo__Prototype",
        }),
      ).toBe(true);
    });

    it("should return true when direct superclass is wiki-link exo__Prototype", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "[[exo__Prototype]]",
        }),
      ).toBe(true);
    });

    it("should return true when direct superclass is quoted wiki-link", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: '"[[exo__Prototype]]"',
        }),
      ).toBe(true);
    });

    it("should return true for transitive inheritance", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "custom__Base",
          custom__Base__exo__Class_superClass: "exo__Prototype",
        }),
      ).toBe(true);
    });

    it("should return true for multi-level transitive inheritance", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "level1",
          level1__exo__Class_superClass: "level2",
          level2__exo__Class_superClass: "exo__Prototype",
        }),
      ).toBe(true);
    });

    it("should return false when superclass chain does not reach Prototype", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "some__Other",
        }),
      ).toBe(false);
    });

    it("should return false for circular inheritance", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "classA",
          classA__exo__Class_superClass: "classB",
          classB__exo__Class_superClass: "classA",
        }),
      ).toBe(false);
    });

    it("should respect maxDepth parameter", () => {
      expect(
        inheritsFromPrototype(
          {
            exo__Class_superClass: "level1",
            level1__exo__Class_superClass: "level2",
            level2__exo__Class_superClass: "exo__Prototype",
          },
          1,
        ),
      ).toBe(false);
    });

    it("should handle array of superclasses", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: ["some__Other", "exo__Prototype"],
        }),
      ).toBe(true);
    });

    it("should handle array of parent superclasses", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "custom__Base",
          custom__Base__exo__Class_superClass: ["some__Other", "exo__Prototype"],
        }),
      ).toBe(true);
    });

    it("should skip null/empty values in superclass arrays", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: [null, "", "exo__Prototype"],
        }),
      ).toBe(true);
    });

    it("should return false when superclass is null", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: null,
        }),
      ).toBe(false);
    });

    it("should handle empty string superclass", () => {
      expect(
        inheritsFromPrototype({
          exo__Class_superClass: "",
        }),
      ).toBe(false);
    });
  });

  // ─── isPrototypeClass ───

  describe("isPrototypeClass", () => {
    it("should return false when not a class", () => {
      expect(isPrototypeClass("ems__Task", {})).toBe(false);
    });

    it("should return false when instanceClass is null", () => {
      expect(isPrototypeClass(null, {})).toBe(false);
    });

    it("should return true when class inherits from Prototype", () => {
      expect(
        isPrototypeClass("exo__Class", {
          exo__Class_superClass: "exo__Prototype",
        }),
      ).toBe(true);
    });

    it("should return false when class does not inherit from Prototype", () => {
      expect(
        isPrototypeClass("exo__Class", {
          exo__Class_superClass: "some__Other",
        }),
      ).toBe(false);
    });

    it("should return false when class has no superclass", () => {
      expect(isPrototypeClass("exo__Class", {})).toBe(false);
    });

    it("should handle array instanceClass with exo__Class", () => {
      expect(
        isPrototypeClass(["exo__Class", "something__Else"], {
          exo__Class_superClass: "exo__Prototype",
        }),
      ).toBe(true);
    });
  });
});
