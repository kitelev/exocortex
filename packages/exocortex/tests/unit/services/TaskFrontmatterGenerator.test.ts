import { TaskFrontmatterGenerator } from "../../../src/services/TaskFrontmatterGenerator";
import { AssetClass } from "../../../src/domain/constants/AssetClass";

jest.mock("uuid", () => ({
  v4: () => "generated-uuid-0000-0000-000000000000",
}));

describe("TaskFrontmatterGenerator", () => {
  let generator: TaskFrontmatterGenerator;

  const baseMetadata = {
    exo__Asset_isDefinedBy: '"[[!kitelev]]"',
  };

  beforeEach(() => {
    generator = new TaskFrontmatterGenerator();
  });

  describe("generateTaskFrontmatter", () => {
    it("should generate frontmatter with required fields", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source-name",
        AssetClass.PROJECT,
      );

      expect(result).toHaveProperty("exo__Asset_isDefinedBy");
      expect(result).toHaveProperty("exo__Asset_uid");
      expect(result).toHaveProperty("exo__Asset_createdAt");
      expect(result).toHaveProperty("exo__Instance_class");
      expect(result).toHaveProperty("ems__Effort_status", '"[[ems__EffortStatusDraft]]"');
    });

    it("should set instance class to ems__Task for Area source", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "area-name",
        AssetClass.AREA,
      );

      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.TASK}]]"`]);
      expect(result["ems__Effort_area"]).toBe('"[[area-name]]"');
    });

    it("should set instance class to ems__Task for Project source", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "project-name",
        AssetClass.PROJECT,
      );

      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.TASK}]]"`]);
      expect(result["ems__Effort_parent"]).toBe('"[[project-name]]"');
    });

    it("should set instance class to ems__Task for TaskPrototype source", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "proto-name",
        AssetClass.TASK_PROTOTYPE,
      );

      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.TASK}]]"`]);
      expect(result["exo__Asset_prototype"]).toBe('"[[proto-name]]"');
    });

    it("should set instance class to ems__Meeting for MeetingPrototype source", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "meeting-proto",
        AssetClass.MEETING_PROTOTYPE,
      );

      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.MEETING}]]"`]);
      expect(result["exo__Asset_prototype"]).toBe('"[[meeting-proto]]"');
    });

    it("should set instance class to exo__Event for EventPrototype source", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "event-proto",
        AssetClass.EVENT_PROTOTYPE,
      );

      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.EVENT}]]"`]);
      expect(result["exo__Asset_prototype"]).toBe('"[[event-proto]]"');
    });

    it("should set instance class to ems__Project for ProjectPrototype source", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "proj-proto",
        AssetClass.PROJECT_PROTOTYPE,
      );

      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.PROJECT}]]"`]);
      expect(result["exo__Asset_prototype"]).toBe('"[[proj-proto]]"');
    });

    it("should default instance class to ems__Task for unknown source class", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "unknown-source",
        "some_unknown_class",
      );

      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.TASK}]]"`]);
      // No effort property should be set for unknown class
      expect(result).not.toHaveProperty("ems__Effort_area");
      expect(result).not.toHaveProperty("ems__Effort_parent");
      expect(result).not.toHaveProperty("exo__Asset_prototype");
    });

    it("should use provided uid when given", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        undefined,
        "custom-uid-123",
      );

      expect(result["exo__Asset_uid"]).toBe("custom-uid-123");
    });

    it("should generate uuid when uid not provided", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
      );

      expect(result["exo__Asset_uid"]).toBe("generated-uuid-0000-0000-000000000000");
    });

    it("should include label and aliases when label is provided", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        "My Task Label",
      );

      expect(result["exo__Asset_label"]).toBe("My Task Label");
      expect(result["aliases"]).toEqual(["My Task Label"]);
    });

    it("should trim label", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        "  Padded Label  ",
      );

      expect(result["exo__Asset_label"]).toBe("Padded Label");
      expect(result["aliases"]).toEqual(["Padded Label"]);
    });

    it("should not include label when empty string", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        "",
      );

      expect(result).not.toHaveProperty("exo__Asset_label");
      expect(result).not.toHaveProperty("aliases");
    });

    it("should not include label when whitespace only", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        "   ",
      );

      expect(result).not.toHaveProperty("exo__Asset_label");
      expect(result).not.toHaveProperty("aliases");
    });

    it("should not include label when undefined", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        undefined,
      );

      expect(result).not.toHaveProperty("exo__Asset_label");
      expect(result).not.toHaveProperty("aliases");
    });

    it("should include taskSize when provided", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        undefined,
        undefined,
        "S",
      );

      expect(result["ems__Task_size"]).toBe("S");
    });

    it("should not include taskSize when null", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        undefined,
        undefined,
        null,
      );

      expect(result).not.toHaveProperty("ems__Task_size");
    });

    it("should not include taskSize when undefined", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        undefined,
        undefined,
        undefined,
      );

      expect(result).not.toHaveProperty("ems__Task_size");
    });

    it("should include plannedStartTimestamp when provided", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
        undefined,
        undefined,
        undefined,
        "2025-06-15T10:00:00",
      );

      expect(result["ems__Effort_plannedStartTimestamp"]).toBe("2025-06-15T10:00:00");
    });

    it("should not include plannedStartTimestamp when undefined", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
      );

      expect(result).not.toHaveProperty("ems__Effort_plannedStartTimestamp");
    });

    it("should handle wiki-link wrapped sourceClass", () => {
      // WikiLinkHelpers.normalize removes [[ and ]] but keeps quotes
      // so "[[ems__Project]]" normalizes to "\"ems__Project\"" which
      // does not match AssetClass.PROJECT exactly. The effortProperty
      // won't be found, but no error should be thrown.
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        `[[${AssetClass.PROJECT}]]`,
      );

      // With bare [[ems__Project]] the normalize removes brackets -> "ems__Project"
      expect(result["ems__Effort_parent"]).toBe('"[[source]]"');
    });

    it("should auto-generate meeting label with date for MeetingPrototype when no label given", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "meeting-proto",
        AssetClass.MEETING_PROTOTYPE,
      );

      // Should auto-generate label since instanceClass is MEETING and no label
      expect(result).toHaveProperty("exo__Asset_label");
      expect(result).toHaveProperty("aliases");
    });

    it("should auto-generate meeting label when label is empty string", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "meeting-proto",
        AssetClass.MEETING_PROTOTYPE,
        "",
      );

      expect(result).toHaveProperty("exo__Asset_label");
    });

    it("should auto-generate meeting label when label is whitespace", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "meeting-proto",
        AssetClass.MEETING_PROTOTYPE,
        "   ",
      );

      // Meeting auto-label should still be generated
      expect(result).toHaveProperty("exo__Asset_label");
    });

    it("should use sourceMetadata exo__Asset_label as base for meeting auto-label", () => {
      const metadataWithLabel = {
        ...baseMetadata,
        exo__Asset_label: "Standup",
      };

      const result = generator.generateTaskFrontmatter(
        metadataWithLabel,
        "meeting-proto",
        AssetClass.MEETING_PROTOTYPE,
      );

      expect(result["exo__Asset_label"]).toContain("Standup");
    });

    it("should use sourceName when sourceMetadata has no label for meeting auto-label", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "daily-standup",
        AssetClass.MEETING_PROTOTYPE,
      );

      expect(result["exo__Asset_label"]).toContain("daily-standup");
    });

    it("should use explicit label for meeting when provided", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "meeting-proto",
        AssetClass.MEETING_PROTOTYPE,
        "Custom Meeting Name",
      );

      expect(result["exo__Asset_label"]).toBe("Custom Meeting Name");
    });

    it("should not auto-generate label for non-meeting types even without label", () => {
      const result = generator.generateTaskFrontmatter(
        baseMetadata,
        "source",
        AssetClass.PROJECT,
      );

      expect(result).not.toHaveProperty("exo__Asset_label");
      expect(result).not.toHaveProperty("aliases");
    });

    it("should handle isDefinedBy as array", () => {
      const metadataWithArray = {
        exo__Asset_isDefinedBy: ['"[[!kitelev]]"', '"[[!other]]"'],
      };

      const result = generator.generateTaskFrontmatter(
        metadataWithArray,
        "source",
        AssetClass.PROJECT,
      );

      expect(result["exo__Asset_isDefinedBy"]).toBe('"[[!kitelev]]"');
    });

    it("should handle missing isDefinedBy with default empty quotes", () => {
      const result = generator.generateTaskFrontmatter(
        {},
        "source",
        AssetClass.PROJECT,
      );

      expect(result["exo__Asset_isDefinedBy"]).toBe('""');
    });

    it("should handle isPrototypeClass for custom prototypes", () => {
      // isPrototypeClass checks: hasClass(instanceClass, exo__Class)
      // where instanceClass is actually the sourceClass string,
      // AND inheritsFromPrototype checks exo__Class_superClass in metadata
      const protoMetadata = {
        ...baseMetadata,
        exo__Instance_class: `"[[${AssetClass.CLASS}]]"`,
        exo__Class_superClass: `"[[${AssetClass.PROTOTYPE}]]"`,
      };

      const result = generator.generateTaskFrontmatter(
        protoMetadata,
        "custom-proto",
        AssetClass.CLASS,
      );

      // For custom prototypes that inherit from exo__Prototype
      // the isPrototypeClass helper should detect this
      // and set exo__Asset_prototype
      expect(result).toHaveProperty("exo__Asset_prototype", '"[[custom-proto]]"');
    });
  });

  describe("generateRelatedTaskFrontmatter", () => {
    it("should generate frontmatter with relates link", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source-name",
      );

      expect(result).toHaveProperty("exo__Asset_isDefinedBy");
      expect(result).toHaveProperty("exo__Asset_uid");
      expect(result).toHaveProperty("exo__Asset_createdAt");
      expect(result["exo__Instance_class"]).toEqual([`"[[${AssetClass.TASK}]]"`]);
      expect(result["ems__Effort_status"]).toBe('"[[ems__EffortStatusDraft]]"');
      expect(result["exo__Asset_relates"]).toEqual(['"[[source-name]]"']);
    });

    it("should include label and aliases when label is provided", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
        "Related Task Label",
      );

      expect(result["exo__Asset_label"]).toBe("Related Task Label");
      expect(result["aliases"]).toEqual(["Related Task Label"]);
    });

    it("should trim label in related task", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
        "  Padded  ",
      );

      expect(result["exo__Asset_label"]).toBe("Padded");
      expect(result["aliases"]).toEqual(["Padded"]);
    });

    it("should not include label when empty string", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
        "",
      );

      expect(result).not.toHaveProperty("exo__Asset_label");
      expect(result).not.toHaveProperty("aliases");
    });

    it("should not include label when whitespace only", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
        "   ",
      );

      expect(result).not.toHaveProperty("exo__Asset_label");
      expect(result).not.toHaveProperty("aliases");
    });

    it("should include taskSize when provided", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
        undefined,
        undefined,
        "L",
      );

      expect(result["ems__Task_size"]).toBe("L");
    });

    it("should not include taskSize when null", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
        undefined,
        undefined,
        null,
      );

      expect(result).not.toHaveProperty("ems__Task_size");
    });

    it("should use provided uid", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
        undefined,
        "custom-uid",
      );

      expect(result["exo__Asset_uid"]).toBe("custom-uid");
    });

    it("should generate uid when not provided", () => {
      const result = generator.generateRelatedTaskFrontmatter(
        baseMetadata,
        "source",
      );

      expect(result["exo__Asset_uid"]).toBe("generated-uuid-0000-0000-000000000000");
    });
  });
});
