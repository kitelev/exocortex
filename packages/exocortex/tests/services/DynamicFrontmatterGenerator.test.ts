import { DynamicFrontmatterGenerator, PropertyDefinition, PropertyFieldType } from "../../src/services/DynamicFrontmatterGenerator";
import { DateFormatter } from "../../src/utilities/DateFormatter";

describe("DynamicFrontmatterGenerator", () => {
  let generator: DynamicFrontmatterGenerator;

  beforeEach(() => {
    generator = new DynamicFrontmatterGenerator();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-12-07T10:30:00"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("generate", () => {
    describe("system properties", () => {
      it("should generate frontmatter with required system properties", () => {
        const properties: PropertyDefinition[] = [];
        const values = {};

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_uid"]).toBeDefined();
        expect(result["exo__Asset_createdAt"]).toBe("2025-12-07T10:30:00");
        expect(result["exo__Instance_class"]).toEqual(['"[[ems__Task]]"']);
      });

      it("should use provided uid", () => {
        const customUid = "custom-uuid-1234";
        const result = generator.generate("ems__Task", {}, [], { uid: customUid });

        expect(result["exo__Asset_uid"]).toBe(customUid);
      });

      it("should use provided createdAt", () => {
        const customTimestamp = "2025-01-01T00:00:00";
        const result = generator.generate("ems__Task", {}, [], { createdAt: customTimestamp });

        expect(result["exo__Asset_createdAt"]).toBe(customTimestamp);
      });

      it("should set isDefinedBy when provided", () => {
        const result = generator.generate("ems__Task", {}, [], {
          isDefinedBy: "[[exo]]",
        });

        expect(result["exo__Asset_isDefinedBy"]).toBe('"[[exo]]"');
      });

      it("should quote isDefinedBy if not already quoted", () => {
        const result = generator.generate("ems__Task", {}, [], {
          isDefinedBy: "exo",
        });

        expect(result["exo__Asset_isDefinedBy"]).toBe('"exo"');
      });
    });

    describe("text properties", () => {
      it("should handle text property", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_label", type: "text" },
        ];
        const values = { exo__Asset_label: "My Task Label" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_label"]).toBe("My Task Label");
      });

      it("should convert number to string for text property", () => {
        const properties: PropertyDefinition[] = [
          { name: "description", type: "text" },
        ];
        const values = { description: 12345 };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["description"]).toBe("12345");
      });

      it("should create aliases from label", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_label", type: "text" },
        ];
        const values = { exo__Asset_label: "Task Name" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_label"]).toBe("Task Name");
        expect(result["aliases"]).toEqual(["Task Name"]);
      });

      it("should trim label and aliases", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_label", type: "text" },
        ];
        const values = { exo__Asset_label: "  Task Name  " };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_label"]).toBe("Task Name");
        expect(result["aliases"]).toEqual(["Task Name"]);
      });

      it("should not set aliases if label is empty", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_label", type: "text" },
        ];
        const values = { exo__Asset_label: "   " };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_label"]).toBeUndefined();
        expect(result["aliases"]).toBeUndefined();
      });
    });

    describe("wikilink properties", () => {
      it("should format raw value as wikilink", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_area", type: "wikilink" },
        ];
        const values = { ems__Effort_area: "Work" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_area"]).toBe('"[[Work]]"');
      });

      it("should quote wikilink that is already in [[]] format", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_area", type: "wikilink" },
        ];
        const values = { ems__Effort_area: "[[Work]]" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_area"]).toBe('"[[Work]]"');
      });

      it("should not double-quote already quoted wikilink", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_area", type: "wikilink" },
        ];
        const values = { ems__Effort_area: '"[[Work]]"' };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_area"]).toBe('"[[Work]]"');
      });
    });

    describe("status-select properties", () => {
      it("should format status-select as wikilink", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_status", type: "status-select" },
        ];
        const values = { ems__Effort_status: "ems__EffortStatusDraft" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_status"]).toBe('"[[ems__EffortStatusDraft]]"');
      });

      it("should handle status-select already in wikilink format", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_status", type: "status-select" },
        ];
        const values = { ems__Effort_status: "[[ems__EffortStatusDoing]]" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_status"]).toBe('"[[ems__EffortStatusDoing]]"');
      });
    });

    describe("size-select properties", () => {
      it("should format size-select as wikilink", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Task_size", type: "size-select" },
        ];
        const values = { ems__Task_size: "ems__TaskSize_M" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Task_size"]).toBe('"[[ems__TaskSize_M]]"');
      });
    });

    describe("number properties", () => {
      it("should preserve number value", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_votes", type: "number" },
        ];
        const values = { ems__Effort_votes: 5 };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_votes"]).toBe(5);
      });

      it("should parse string to number", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_votes", type: "number" },
        ];
        const values = { ems__Effort_votes: "10" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_votes"]).toBe(10);
      });

      it("should return 0 for invalid number", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_votes", type: "number" },
        ];
        const values = { ems__Effort_votes: "invalid" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_votes"]).toBe(0);
      });

      it("should handle negative numbers", () => {
        const properties: PropertyDefinition[] = [
          { name: "score", type: "number" },
        ];
        const values = { score: -5 };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["score"]).toBe(-5);
      });

      it("should handle decimal numbers", () => {
        const properties: PropertyDefinition[] = [
          { name: "rating", type: "number" },
        ];
        const values = { rating: 3.5 };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["rating"]).toBe(3.5);
      });
    });

    describe("boolean properties", () => {
      it("should preserve boolean true", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_isArchived", type: "boolean" },
        ];
        const values = { exo__Asset_isArchived: true };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_isArchived"]).toBe(true);
      });

      it("should preserve boolean false", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_isArchived", type: "boolean" },
        ];
        const values = { exo__Asset_isArchived: false };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_isArchived"]).toBe(false);
      });

      it("should parse string 'true' to boolean", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_isArchived", type: "boolean" },
        ];
        const values = { exo__Asset_isArchived: "true" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_isArchived"]).toBe(true);
      });

      it("should parse string 'false' to boolean", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_isArchived", type: "boolean" },
        ];
        const values = { exo__Asset_isArchived: "false" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_isArchived"]).toBe(false);
      });

      it("should parse string 'yes' to boolean true", () => {
        const properties: PropertyDefinition[] = [
          { name: "active", type: "boolean" },
        ];
        const values = { active: "yes" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["active"]).toBe(true);
      });

      it("should parse string '1' to boolean true", () => {
        const properties: PropertyDefinition[] = [
          { name: "enabled", type: "boolean" },
        ];
        const values = { enabled: "1" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["enabled"]).toBe(true);
      });

      it("should parse number 1 to boolean true", () => {
        const properties: PropertyDefinition[] = [
          { name: "enabled", type: "boolean" },
        ];
        const values = { enabled: 1 };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["enabled"]).toBe(true);
      });

      it("should parse number 0 to boolean false", () => {
        const properties: PropertyDefinition[] = [
          { name: "enabled", type: "boolean" },
        ];
        const values = { enabled: 0 };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["enabled"]).toBe(false);
      });
    });

    describe("timestamp properties", () => {
      it("should format Date object as timestamp", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_startTimestamp", type: "timestamp" },
        ];
        const values = { ems__Effort_startTimestamp: new Date("2025-06-15T14:30:00") };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_startTimestamp"]).toBe("2025-06-15T14:30:00");
      });

      it("should preserve local timestamp string", () => {
        const properties: PropertyDefinition[] = [
          { name: "ems__Effort_endTimestamp", type: "timestamp" },
        ];
        const values = { ems__Effort_endTimestamp: "2025-06-15T18:00:00" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["ems__Effort_endTimestamp"]).toBe("2025-06-15T18:00:00");
      });

      it("should convert UTC timestamp to local format", () => {
        const properties: PropertyDefinition[] = [
          { name: "timestamp", type: "timestamp" },
        ];
        const values = { timestamp: "2025-06-15T14:30:00Z" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["timestamp"]).toBe("2025-06-15T14:30:00");
      });

      it("should parse numeric timestamp", () => {
        const properties: PropertyDefinition[] = [
          { name: "timestamp", type: "timestamp" },
        ];
        const values = { timestamp: new Date("2025-06-15T14:30:00").getTime() };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["timestamp"]).toBe("2025-06-15T14:30:00");
      });
    });

    describe("null and undefined values", () => {
      it("should skip null values", () => {
        const properties: PropertyDefinition[] = [
          { name: "description", type: "text" },
        ];
        const values = { description: null };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["description"]).toBeUndefined();
      });

      it("should skip undefined values", () => {
        const properties: PropertyDefinition[] = [
          { name: "description", type: "text" },
        ];
        const values = { description: undefined };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["description"]).toBeUndefined();
      });
    });

    describe("values without property definition", () => {
      it("should infer type for string value", () => {
        const properties: PropertyDefinition[] = [];
        const values = { custom_field: "some text" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["custom_field"]).toBe("some text");
      });

      it("should infer type for number value", () => {
        const properties: PropertyDefinition[] = [];
        const values = { custom_number: 42 };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["custom_number"]).toBe(42);
      });

      it("should infer type for boolean value", () => {
        const properties: PropertyDefinition[] = [];
        const values = { custom_flag: true };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["custom_flag"]).toBe(true);
      });

      it("should infer wikilink type for [[]] value", () => {
        const properties: PropertyDefinition[] = [];
        const values = { custom_ref: "[[SomeAsset]]" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["custom_ref"]).toBe('"[[SomeAsset]]"');
      });

      it("should infer Date type", () => {
        const properties: PropertyDefinition[] = [];
        const values = { custom_date: new Date("2025-06-15T14:30:00") };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["custom_date"]).toBe("2025-06-15T14:30:00");
      });
    });

    describe("system property protection", () => {
      it("should not override uid from values", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_uid", type: "text" },
        ];
        const values = { exo__Asset_uid: "user-provided-uid" };

        const result = generator.generate("ems__Task", values, properties);

        // System uid should be generated, not use user value
        expect(result["exo__Asset_uid"]).toBeDefined();
        expect(result["exo__Asset_uid"]).not.toBe("user-provided-uid");
      });

      it("should not override createdAt from values", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_createdAt", type: "timestamp" },
        ];
        const values = { exo__Asset_createdAt: "2020-01-01T00:00:00" };

        const result = generator.generate("ems__Task", values, properties);

        expect(result["exo__Asset_createdAt"]).toBe("2025-12-07T10:30:00");
      });
    });

    describe("complex scenarios", () => {
      it("should generate complete task frontmatter", () => {
        const properties: PropertyDefinition[] = [
          { name: "exo__Asset_label", type: "text" },
          { name: "ems__Effort_status", type: "status-select" },
          { name: "ems__Effort_area", type: "wikilink" },
          { name: "ems__Task_size", type: "size-select" },
          { name: "ems__Effort_votes", type: "number" },
          { name: "exo__Asset_isArchived", type: "boolean" },
        ];
        const values = {
          exo__Asset_label: "Complete Documentation",
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
          ems__Effort_area: "Work",
          ems__Task_size: "ems__TaskSize_L",
          ems__Effort_votes: 3,
          exo__Asset_isArchived: false,
        };

        const result = generator.generate("ems__Task", values, properties, {
          isDefinedBy: "[[exo]]",
        });

        expect(result["exo__Asset_isDefinedBy"]).toBe('"[[exo]]"');
        expect(result["exo__Asset_uid"]).toBeDefined();
        expect(result["exo__Asset_createdAt"]).toBe("2025-12-07T10:30:00");
        expect(result["exo__Instance_class"]).toEqual(['"[[ems__Task]]"']);
        expect(result["exo__Asset_label"]).toBe("Complete Documentation");
        expect(result["aliases"]).toEqual(["Complete Documentation"]);
        expect(result["ems__Effort_status"]).toBe('"[[ems__EffortStatusDoing]]"');
        expect(result["ems__Effort_area"]).toBe('"[[Work]]"');
        expect(result["ems__Task_size"]).toBe('"[[ems__TaskSize_L]]"');
        expect(result["ems__Effort_votes"]).toBe(3);
        expect(result["exo__Asset_isArchived"]).toBe(false);
      });
    });
  });

  describe("formatValue", () => {
    it("should return null for null value", () => {
      const result = generator.formatValue(null, "text");
      expect(result).toBeNull();
    });

    it("should return null for undefined value", () => {
      const result = generator.formatValue(undefined, "text");
      expect(result).toBeNull();
    });

    it("should format text without explicit type", () => {
      const result = generator.formatValue("hello", undefined);
      expect(result).toBe("hello");
    });

    it("should handle unknown type as text", () => {
      const result = generator.formatValue("value", "unknown-type" as PropertyFieldType);
      expect(result).toBe("value");
    });
  });

  describe("generateYAML", () => {
    it("should generate YAML string with frontmatter delimiters", () => {
      const properties: PropertyDefinition[] = [
        { name: "exo__Asset_label", type: "text" },
      ];
      const values = { exo__Asset_label: "My Task" };

      const result = generator.generateYAML("ems__Task", values, properties);

      expect(result).toContain("---");
      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---$/);
      expect(result).toContain("exo__Asset_label: My Task");
      expect(result).toContain("exo__Asset_uid:");
      expect(result).toContain("exo__Asset_createdAt: 2025-12-07T10:30:00");
      expect(result).toContain("exo__Instance_class:");
    });

    it("should format array properties correctly in YAML", () => {
      const properties: PropertyDefinition[] = [
        { name: "exo__Asset_label", type: "text" },
      ];
      const values = { exo__Asset_label: "Task Name" };

      const result = generator.generateYAML("ems__Task", values, properties);

      expect(result).toContain("exo__Instance_class:");
      expect(result).toContain('  - "[[ems__Task]]"');
      expect(result).toContain("aliases:");
      expect(result).toContain("  - Task Name");
    });
  });
});
