import { DisplayNameResolver, type DisplayNameContext } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS, type DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

describe("DisplayNameResolver", () => {
  const defaultSettings: DisplayNameSettings = {
    defaultTemplate: "{{exo__Asset_label}}",
    classTemplates: {
      "ems__Task": "{{exo__Asset_label}} {{statusEmoji}}",
      "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
      "ems__Project": "{{exo__Asset_label}}",
    },
    statusEmojis: {
      "DOING": "🟢",
      "DONE": "✅",
      "BLOCKED": "🔴",
      "BACKLOG": "📋",
    },
  };

  describe("resolve", () => {
    it("should use class-specific template for ems__Task", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Fix bug",
          exo__Instance_class: "ems__Task",
          ems__Effort_status: "DOING",
        },
        basename: "fix-bug",
      });
      expect(result).toBe("Fix bug 🟢");
    });

    it("should use class-specific template for ems__TaskPrototype", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Morning routine",
          exo__Instance_class: "ems__TaskPrototype",
        },
        basename: "morning-routine",
      });
      expect(result).toBe("Morning routine (TaskPrototype)");
    });

    it("should use class-specific template for ems__Project", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Alpha Project",
          exo__Instance_class: "ems__Project",
        },
        basename: "alpha-project",
      });
      expect(result).toBe("Alpha Project");
    });

    it("should use default template when no class-specific template exists", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Some Area",
          exo__Instance_class: "ems__Area", // No template for Area in test settings
        },
        basename: "some-area",
      });
      expect(result).toBe("Some Area");
    });

    it("should use default template when no instance class is set", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Generic Asset",
        },
        basename: "generic-asset",
      });
      expect(result).toBe("Generic Asset");
    });

    it("should handle wikilink syntax in instance class", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Review PR",
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "DONE",
        },
        basename: "review-pr",
      });
      expect(result).toBe("Review PR ✅");
    });

    it("should handle array instance class (use first element)", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Multi-class Asset",
          exo__Instance_class: ["ems__Task", "ems__Meeting"],
          ems__Effort_status: "BLOCKED",
        },
        basename: "multi-class",
      });
      expect(result).toBe("Multi-class Asset 🔴");
    });

    it("should handle quoted instance class", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Quoted Task",
          exo__Instance_class: '"ems__Task"',
          ems__Effort_status: "BACKLOG",
        },
        basename: "quoted-task",
      });
      expect(result).toBe("Quoted Task 📋");
    });

    it("should return null for empty template result", () => {
      const settings: DisplayNameSettings = {
        defaultTemplate: "{{missing_field}}",
        classTemplates: {},
        statusEmojis: {},
      };
      const resolver = new DisplayNameResolver(settings);
      const result = resolver.resolve({
        metadata: { exo__Asset_label: "Task" },
        basename: "task",
      });
      expect(result).toBeNull();
    });

    it("should pass creation date to template", () => {
      const settings: DisplayNameSettings = {
        defaultTemplate: "{{_created}} - {{exo__Asset_label}}",
        classTemplates: {},
        statusEmojis: {},
      };
      const resolver = new DisplayNameResolver(settings);
      const result = resolver.resolve({
        metadata: { exo__Asset_label: "Task" },
        basename: "task",
        createdDate: new Date("2025-01-15T10:00:00.000Z"),
      });
      expect(result).toBe("2025-01-15 - Task");
    });
  });

  describe("getTemplateForClass", () => {
    it("should return class-specific template when available", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      expect(resolver.getTemplateForClass("ems__Task")).toBe(
        "{{exo__Asset_label}} {{statusEmoji}}"
      );
    });

    it("should return default template when no class-specific template", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      expect(resolver.getTemplateForClass("ems__Unknown")).toBe(
        "{{exo__Asset_label}}"
      );
    });

    it("should return default template for null class", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      expect(resolver.getTemplateForClass(null)).toBe("{{exo__Asset_label}}");
    });
  });

  describe("getStatusEmoji", () => {
    it("should return emoji for direct status match", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      expect(resolver.getStatusEmoji("DOING")).toBe("🟢");
    });

    it("should return emoji for case-insensitive match", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      expect(resolver.getStatusEmoji("doing")).toBe("🟢");
    });

    it("should return null for unknown status", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      expect(resolver.getStatusEmoji("UNKNOWN")).toBeNull();
    });
  });

  describe("getConfiguredClasses", () => {
    it("should return list of configured classes", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const classes = resolver.getConfiguredClasses();
      expect(classes).toContain("ems__Task");
      expect(classes).toContain("ems__TaskPrototype");
      expect(classes).toContain("ems__Project");
    });
  });

  describe("getConfiguredStatuses", () => {
    it("should return list of configured statuses", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const statuses = resolver.getConfiguredStatuses();
      expect(statuses).toContain("DOING");
      expect(statuses).toContain("DONE");
      expect(statuses).toContain("BLOCKED");
      expect(statuses).toContain("BACKLOG");
    });
  });

  describe("hasClassTemplates", () => {
    it("should return true when class templates exist", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      expect(resolver.hasClassTemplates()).toBe(true);
    });

    it("should return false when no class templates exist", () => {
      const settings: DisplayNameSettings = {
        defaultTemplate: "{{exo__Asset_label}}",
        classTemplates: {},
        statusEmojis: {},
      };
      const resolver = new DisplayNameResolver(settings);
      expect(resolver.hasClassTemplates()).toBe(false);
    });
  });

  describe("DEFAULT_DISPLAY_NAME_SETTINGS", () => {
    it("should have default template with class suffix for all asset types", () => {
      // Default template now includes class suffix for consistent display across all asset types
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.defaultTemplate).toBe(
        "{{exo__Asset_label}} ({{exo__Instance_class}})"
      );
    });

    it("should have class templates for common classes", () => {
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__Task"]).toBeDefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__TaskPrototype"]).toBeDefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__Project"]).toBeDefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__Area"]).toBeDefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["pn__DailyNote"]).toBeDefined();
    });

    it("should have status emoji mappings", () => {
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.statusEmojis["DOING"]).toBe("🟢");
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.statusEmojis["DONE"]).toBe("✅");
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.statusEmojis["BLOCKED"]).toBe("🔴");
    });

    it("should work correctly with resolver", () => {
      const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);

      // Task with status
      const taskResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "Fix bug",
          exo__Instance_class: "ems__Task",
          ems__Effort_status: "DOING",
        },
        basename: "fix-bug",
      });
      expect(taskResult).toBe("Fix bug 🟢");

      // TaskPrototype
      const prototypeResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "Morning routine",
          exo__Instance_class: "ems__TaskPrototype",
        },
        basename: "morning-routine",
      });
      expect(prototypeResult).toBe("Morning routine (TaskPrototype)");
    });

    it("should use default template with class suffix for unknown asset types", () => {
      const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);

      // Custom/unknown asset class should use default template
      const customResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "My Custom Asset",
          exo__Instance_class: "myapp__CustomClass",
        },
        basename: "custom-asset",
      });
      expect(customResult).toBe("My Custom Asset (myapp__CustomClass)");
    });

    it("should gracefully handle missing class in default template", () => {
      const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);

      // Asset with label but no class - cleanup removes empty parentheses
      const noClassResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "Asset Without Class",
        },
        basename: "no-class",
      });
      // With cleanup logic, empty parentheses are removed
      expect(noClassResult).toBe("Asset Without Class");
    });

    it("should use basename template for pn__DailyNote class", () => {
      const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);

      // DailyNote uses basename (the date) since it typically has no label
      const dailyNoteResult = resolver.resolve({
        metadata: {
          exo__Instance_class: "pn__DailyNote",
        },
        basename: "2025-10-15",
      });
      expect(dailyNoteResult).toBe("2025-10-15");
    });
  });
});
