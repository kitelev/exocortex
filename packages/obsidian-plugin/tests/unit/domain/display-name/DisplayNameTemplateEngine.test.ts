import {
  DisplayNameTemplateEngine,
  DISPLAY_NAME_PRESETS,
  DEFAULT_DISPLAY_NAME_TEMPLATE,
} from "@plugin/domain/display-name/DisplayNameTemplateEngine";

describe("DisplayNameTemplateEngine", () => {
  describe("render", () => {
    it("should render simple placeholder", () => {
      const engine = new DisplayNameTemplateEngine("{{exo__Asset_label}}");
      const result = engine.render(
        { exo__Asset_label: "My Task" },
        "my-task"
      );
      expect(result).toBe("My Task");
    });

    it("should render multiple placeholders", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}}: {{ems__Effort_status}}"
      );
      const result = engine.render(
        {
          exo__Asset_label: "My Task",
          ems__Effort_status: "IN_PROGRESS",
        },
        "my-task"
      );
      expect(result).toBe("My Task: IN_PROGRESS");
    });

    it("should render _basename placeholder", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{_basename}} - {{exo__Asset_label}}"
      );
      const result = engine.render(
        { exo__Asset_label: "My Task" },
        "2025-01-15-my-task"
      );
      expect(result).toBe("2025-01-15-my-task - My Task");
    });

    it("should render _created placeholder", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{_created}} - {{exo__Asset_label}}"
      );
      const date = new Date("2025-01-15T10:00:00.000Z");
      const result = engine.render(
        { exo__Asset_label: "My Task" },
        "my-task",
        date
      );
      expect(result).toBe("2025-01-15 - My Task");
    });

    it("should handle missing _created date", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{_created}} - {{exo__Asset_label}}"
      );
      const result = engine.render(
        { exo__Asset_label: "My Task" },
        "my-task"
      );
      expect(result).toBe("- My Task");
    });

    it("should render class prefix pattern", () => {
      const engine = new DisplayNameTemplateEngine(
        "[{{exo__Instance_class}}] {{exo__Asset_label}}"
      );
      const result = engine.render(
        {
          exo__Asset_label: "Fix Login Bug",
          exo__Instance_class: "ems__Task",
        },
        "fix-login-bug"
      );
      expect(result).toBe("[ems__Task] Fix Login Bug");
    });

    it("should handle missing field with empty string in result", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}}: {{ems__Effort_status}}"
      );
      const result = engine.render(
        { exo__Asset_label: "My Task" },
        "my-task"
      );
      // Missing field is replaced with empty string, producing "My Task: "
      expect(result).toBe("My Task:");
    });

    it("should strip wikilink syntax from values", () => {
      const engine = new DisplayNameTemplateEngine("{{exo__Asset_label}}");
      const result = engine.render(
        { exo__Asset_label: "[[My Task]]" },
        "my-task"
      );
      expect(result).toBe("My Task");
    });

    it("should handle array values by using first element", () => {
      const engine = new DisplayNameTemplateEngine("{{exo__Instance_class}}");
      const result = engine.render(
        { exo__Instance_class: ["ems__Task", "ems__Project"] },
        "my-file"
      );
      expect(result).toBe("ems__Task");
    });

    it("should handle empty array with null result", () => {
      const engine = new DisplayNameTemplateEngine("{{tags}}");
      const result = engine.render(
        { tags: [] },
        "my-file"
      );
      // Template produces empty result, so null is returned
      expect(result).toBeNull();
    });

    it("should return null for empty template result", () => {
      const engine = new DisplayNameTemplateEngine("{{missing_field}}");
      const result = engine.render({}, "my-file");
      expect(result).toBeNull();
    });

    it("should return null for empty template", () => {
      const engine = new DisplayNameTemplateEngine("");
      const result = engine.render({ exo__Asset_label: "My Task" }, "my-file");
      expect(result).toBeNull();
    });

    it("should handle whitespace-only template result", () => {
      const engine = new DisplayNameTemplateEngine("   {{missing}}   ");
      const result = engine.render({}, "my-file");
      expect(result).toBeNull();
    });

    it("should trim whitespace from result", () => {
      const engine = new DisplayNameTemplateEngine("  {{exo__Asset_label}}  ");
      const result = engine.render(
        { exo__Asset_label: "My Task" },
        "my-file"
      );
      expect(result).toBe("My Task");
    });
  });

  describe("nested fields (dot notation)", () => {
    it("should resolve nested field values", () => {
      const engine = new DisplayNameTemplateEngine("{{custom.priority}}");
      const result = engine.render(
        { custom: { priority: "high" } },
        "my-file"
      );
      expect(result).toBe("high");
    });

    it("should resolve deeply nested field values", () => {
      const engine = new DisplayNameTemplateEngine("{{a.b.c.d}}");
      const result = engine.render(
        { a: { b: { c: { d: "deep value" } } } },
        "my-file"
      );
      expect(result).toBe("deep value");
    });

    it("should handle missing nested path with null result", () => {
      const engine = new DisplayNameTemplateEngine("{{custom.nonexistent}}");
      const result = engine.render(
        { custom: { priority: "high" } },
        "my-file"
      );
      // Template produces empty result, so null is returned
      expect(result).toBeNull();
    });

    it("should handle null in nested path with null result", () => {
      const engine = new DisplayNameTemplateEngine("{{custom.nested}}");
      const result = engine.render(
        { custom: null },
        "my-file"
      );
      // Template produces empty result, so null is returned
      expect(result).toBeNull();
    });
  });

  describe("getTemplate", () => {
    it("should return the template string", () => {
      const template = "{{exo__Asset_label}}";
      const engine = new DisplayNameTemplateEngine(template);
      expect(engine.getTemplate()).toBe(template);
    });
  });

  describe("isValid", () => {
    it("should return true for valid template with placeholder", () => {
      const engine = new DisplayNameTemplateEngine("{{exo__Asset_label}}");
      expect(engine.isValid()).toBe(true);
    });

    it("should return true for template with multiple placeholders", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{label}} - {{status}}"
      );
      expect(engine.isValid()).toBe(true);
    });

    it("should return false for empty template", () => {
      const engine = new DisplayNameTemplateEngine("");
      expect(engine.isValid()).toBe(false);
    });

    it("should return false for template without placeholders", () => {
      const engine = new DisplayNameTemplateEngine("Static text only");
      expect(engine.isValid()).toBe(false);
    });

    it("should return false for whitespace-only template", () => {
      const engine = new DisplayNameTemplateEngine("   ");
      expect(engine.isValid()).toBe(false);
    });
  });

  describe("getPlaceholders", () => {
    it("should extract single placeholder", () => {
      const engine = new DisplayNameTemplateEngine("{{exo__Asset_label}}");
      expect(engine.getPlaceholders()).toEqual(["exo__Asset_label"]);
    });

    it("should extract multiple placeholders", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{label}} - {{status}} - {{_basename}}"
      );
      expect(engine.getPlaceholders()).toEqual(["label", "status", "_basename"]);
    });

    it("should return empty array for template without placeholders", () => {
      const engine = new DisplayNameTemplateEngine("Static text");
      expect(engine.getPlaceholders()).toEqual([]);
    });

    it("should trim whitespace from placeholder keys", () => {
      const engine = new DisplayNameTemplateEngine("{{ label }} - {{  status  }}");
      expect(engine.getPlaceholders()).toEqual(["label", "status"]);
    });
  });

  describe("presets", () => {
    it("should have default preset", () => {
      expect(DISPLAY_NAME_PRESETS.default).toBeDefined();
      expect(DISPLAY_NAME_PRESETS.default.template).toBe("{{exo__Asset_label}}");
    });

    it("should have labelWithStatus preset", () => {
      expect(DISPLAY_NAME_PRESETS.labelWithStatus).toBeDefined();
      expect(DISPLAY_NAME_PRESETS.labelWithStatus.template).toBe(
        "{{exo__Asset_label}}: {{ems__Effort_status}}"
      );
    });

    it("should have classPrefix preset", () => {
      expect(DISPLAY_NAME_PRESETS.classPrefix).toBeDefined();
      expect(DISPLAY_NAME_PRESETS.classPrefix.template).toBe(
        "[{{exo__Instance_class}}] {{exo__Asset_label}}"
      );
    });

    it("should have basenameWithLabel preset", () => {
      expect(DISPLAY_NAME_PRESETS.basenameWithLabel).toBeDefined();
      expect(DISPLAY_NAME_PRESETS.basenameWithLabel.template).toBe(
        "{{_basename}} - {{exo__Asset_label}}"
      );
    });

    it("should have datePrefix preset", () => {
      expect(DISPLAY_NAME_PRESETS.datePrefix).toBeDefined();
      expect(DISPLAY_NAME_PRESETS.datePrefix.template).toBe(
        "{{_created}} - {{exo__Asset_label}}"
      );
    });

    it("should export DEFAULT_DISPLAY_NAME_TEMPLATE", () => {
      expect(DEFAULT_DISPLAY_NAME_TEMPLATE).toBe("{{exo__Asset_label}}");
    });
  });

  describe("preset rendering", () => {
    const sampleMetadata = {
      exo__Asset_label: "Fix Login Bug",
      exo__Instance_class: "ems__Task",
      ems__Effort_status: "🟡 IN_PROGRESS",
    };

    it("should render default preset", () => {
      const engine = new DisplayNameTemplateEngine(
        DISPLAY_NAME_PRESETS.default.template
      );
      expect(engine.render(sampleMetadata, "fix-login-bug")).toBe("Fix Login Bug");
    });

    it("should render labelWithStatus preset", () => {
      const engine = new DisplayNameTemplateEngine(
        DISPLAY_NAME_PRESETS.labelWithStatus.template
      );
      expect(engine.render(sampleMetadata, "fix-login-bug")).toBe(
        "Fix Login Bug: 🟡 IN_PROGRESS"
      );
    });

    it("should render classPrefix preset", () => {
      const engine = new DisplayNameTemplateEngine(
        DISPLAY_NAME_PRESETS.classPrefix.template
      );
      expect(engine.render(sampleMetadata, "fix-login-bug")).toBe(
        "[ems__Task] Fix Login Bug"
      );
    });

    it("should render basenameWithLabel preset", () => {
      const engine = new DisplayNameTemplateEngine(
        DISPLAY_NAME_PRESETS.basenameWithLabel.template
      );
      expect(engine.render(sampleMetadata, "2025-01-15-bug")).toBe(
        "2025-01-15-bug - Fix Login Bug"
      );
    });

    it("should render datePrefix preset", () => {
      const engine = new DisplayNameTemplateEngine(
        DISPLAY_NAME_PRESETS.datePrefix.template
      );
      const date = new Date("2025-01-15");
      expect(engine.render(sampleMetadata, "bug", date)).toBe(
        "2025-01-15 - Fix Login Bug"
      );
    });
  });

  describe("statusEmoji placeholder", () => {
    const statusEmojis = {
      "DOING": "🟢",
      "DONE": "✅",
      "BLOCKED": "🔴",
      "BACKLOG": "📋",
      "TRASHED": "🗑️",
      "Active": "🟢",
      "IN_PROGRESS": "🟢",
    };

    it("should render statusEmoji from ems__Effort_status", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}} {{statusEmoji}}",
        statusEmojis
      );
      const result = engine.render(
        { exo__Asset_label: "Fix bug", ems__Effort_status: "DOING" },
        "fix-bug"
      );
      expect(result).toBe("Fix bug 🟢");
    });

    it("should handle case-insensitive status lookup", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}} {{statusEmoji}}",
        statusEmojis
      );
      const result = engine.render(
        { exo__Asset_label: "Task", ems__Effort_status: "doing" },
        "task"
      );
      expect(result).toBe("Task 🟢");
    });

    it("should extract status from enum-style value", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}} {{statusEmoji}}",
        statusEmojis
      );
      const result = engine.render(
        { exo__Asset_label: "Task", ems__Effort_status: "ems__EffortStatus_DONE" },
        "task"
      );
      expect(result).toBe("Task ✅");
    });

    it("should return empty string for missing status", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}} {{statusEmoji}}",
        statusEmojis
      );
      const result = engine.render(
        { exo__Asset_label: "Task" },
        "task"
      );
      expect(result).toBe("Task");
    });

    it("should return empty string for unmapped status", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}} {{statusEmoji}}",
        statusEmojis
      );
      const result = engine.render(
        { exo__Asset_label: "Task", ems__Effort_status: "UNKNOWN_STATUS" },
        "task"
      );
      expect(result).toBe("Task");
    });

    it("should work without statusEmojis mapping (empty)", () => {
      const engine = new DisplayNameTemplateEngine(
        "{{exo__Asset_label}} {{statusEmoji}}"
      );
      const result = engine.render(
        { exo__Asset_label: "Task", ems__Effort_status: "DOING" },
        "task"
      );
      expect(result).toBe("Task");
    });

    it("should have labelWithStatusEmoji preset", () => {
      expect(DISPLAY_NAME_PRESETS.labelWithStatusEmoji).toBeDefined();
      expect(DISPLAY_NAME_PRESETS.labelWithStatusEmoji.template).toBe(
        "{{exo__Asset_label}} {{statusEmoji}}"
      );
    });

    it("should have classSuffix preset", () => {
      expect(DISPLAY_NAME_PRESETS.classSuffix).toBeDefined();
      expect(DISPLAY_NAME_PRESETS.classSuffix.template).toBe(
        "{{exo__Asset_label}} ({{exo__Instance_class}})"
      );
    });
  });

  describe("edge cases", () => {
    it("should handle numeric values", () => {
      const engine = new DisplayNameTemplateEngine("Count: {{count}}");
      const result = engine.render({ count: 42 }, "my-file");
      expect(result).toBe("Count: 42");
    });

    it("should handle boolean values", () => {
      const engine = new DisplayNameTemplateEngine("Active: {{active}}");
      const result = engine.render({ active: true }, "my-file");
      expect(result).toBe("Active: true");
    });

    it("should handle null values", () => {
      const engine = new DisplayNameTemplateEngine("{{nullField}}");
      const result = engine.render({ nullField: null }, "my-file");
      expect(result).toBeNull();
    });

    it("should handle undefined values", () => {
      const engine = new DisplayNameTemplateEngine("{{undefinedField}}");
      const result = engine.render({ undefinedField: undefined }, "my-file");
      expect(result).toBeNull();
    });

    it("should handle object values by stringifying", () => {
      const engine = new DisplayNameTemplateEngine("{{obj}}");
      const result = engine.render({ obj: { a: 1 } }, "my-file");
      expect(result).toBe('{"a":1}');
    });

    it("should handle special characters in template", () => {
      const engine = new DisplayNameTemplateEngine("🎯 {{exo__Asset_label}} ✅");
      const result = engine.render({ exo__Asset_label: "Done" }, "my-file");
      expect(result).toBe("🎯 Done ✅");
    });

    it("should handle curly braces in values", () => {
      const engine = new DisplayNameTemplateEngine("{{code}}");
      const result = engine.render({ code: "function() {}" }, "my-file");
      expect(result).toBe("function() {}");
    });
  });
});
