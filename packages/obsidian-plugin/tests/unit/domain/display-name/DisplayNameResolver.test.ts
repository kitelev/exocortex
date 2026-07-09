import { DisplayNameResolver, type DisplayNameContext } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS, type DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

describe("DisplayNameResolver", () => {
  const defaultSettings: DisplayNameSettings = {
    defaultTemplate: "{{exo__Asset_label}}",
    classTemplates: {
      "ems__Task": "{{exo__Asset_label}}",
      "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
      "ems__Project": "{{exo__Asset_label}}",
    },
  };

  describe("resolve", () => {
    it("should use class-specific template for ems__Task", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Fix bug",
          exo__Instance_class: ["[[ems__Task]]"],
        },
        basename: "fix-bug",
      });
      expect(result).toBe("Fix bug");
    });

    it("should use class-specific template for ems__TaskPrototype", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Morning routine",
          exo__Instance_class: ["[[ems__TaskPrototype]]"],
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
          exo__Instance_class: ["[[ems__Project]]"],
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
          exo__Instance_class: ["[[ems__Area]]"], // No template for Area in test settings
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
          exo__Instance_class: ["[[ems__Task]]"],
        },
        basename: "review-pr",
      });
      expect(result).toBe("Review PR");
    });

    it("should handle array instance class (use first element)", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Multi-class Asset",
          exo__Instance_class: ["ems__Task", "ems__Meeting"],
        },
        basename: "multi-class",
      });
      expect(result).toBe("Multi-class Asset");
    });

    it("should handle quoted instance class", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Quoted Task",
          exo__Instance_class: '"ems__Task"',
        },
        basename: "quoted-task",
      });
      expect(result).toBe("Quoted Task");
    });

    it("should return null for empty template result", () => {
      const settings: DisplayNameSettings = {
        defaultTemplate: "{{missing_field}}",
        classTemplates: {},
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
        "{{exo__Asset_label}}"
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

  describe("getConfiguredClasses", () => {
    it("should return list of configured classes", () => {
      const resolver = new DisplayNameResolver(defaultSettings);
      const classes = resolver.getConfiguredClasses();
      expect(classes).toContain("ems__Task");
      expect(classes).toContain("ems__TaskPrototype");
      expect(classes).toContain("ems__Project");
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
      };
      const resolver = new DisplayNameResolver(settings);
      expect(resolver.hasClassTemplates()).toBe(false);
    });
  });

  describe("with PrintNameRuleService", () => {
    it("should use dynamic rule template over settings template", () => {
      const mockRuleService = {
        getTemplateForClass: jest.fn().mockReturnValue({
          template: "{{exo__Asset_label}} (DynamicRule)",
          priority: 100,
        }),
        createMetadataResolver: jest.fn().mockReturnValue(null),
      };

      const resolver = new DisplayNameResolver(
        defaultSettings,
        mockRuleService as any,
      );

      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "My Task",
          exo__Instance_class: ["[[ems__Task]]"],
        },
        basename: "my-task",
      });

      expect(result).toBe("My Task (DynamicRule)");
      // The resolver now forwards the instance metadata so a conditional spec
      // (matchPath/matchValue) can be evaluated per-render (req ed4201d1).
      expect(mockRuleService.getTemplateForClass).toHaveBeenCalledWith(
        "ems__Task",
        expect.objectContaining({ exo__Asset_label: "My Task" }),
      );
    });

    it("should fall back to settings when no dynamic rule exists", () => {
      const mockRuleService = {
        getTemplateForClass: jest.fn().mockReturnValue(null),
        createMetadataResolver: jest.fn().mockReturnValue(null),
      };

      const resolver = new DisplayNameResolver(
        defaultSettings,
        mockRuleService as any,
      );

      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Morning routine",
          exo__Instance_class: ["[[ems__TaskPrototype]]"],
        },
        basename: "morning-routine",
      });

      expect(result).toBe("Morning routine (TaskPrototype)");
    });

    it("should work without rule service (backwards compatible)", () => {
      const resolver = new DisplayNameResolver(defaultSettings);

      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Fix bug",
          exo__Instance_class: ["[[ems__Task]]"],
        },
        basename: "fix-bug",
      });

      expect(result).toBe("Fix bug");
    });

    it("should pass metadata resolver to template engine for cross-asset resolution", () => {
      const mockMetadataResolver = jest.fn().mockReturnValue({
        exo__Asset_label: "Parent Project",
      });
      const mockRuleService = {
        getTemplateForClass: jest.fn().mockReturnValue({
          template: "{{exo__Asset_label}} / {{ems__Effort_project.exo__Asset_label}}",
          priority: 50,
        }),
        createMetadataResolver: jest.fn().mockReturnValue(mockMetadataResolver),
      };

      const resolver = new DisplayNameResolver(
        defaultSettings,
        mockRuleService as any,
        mockMetadataResolver,
      );

      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Sub Task",
          exo__Instance_class: ["[[ems__Task]]"],
          ems__Effort_project: "[[project-uuid]]",
        },
        basename: "sub-task",
      });

      expect(result).toBe("Sub Task / Parent Project");
    });
  });

  describe("DEFAULT_DISPLAY_NAME_SETTINGS", () => {
    it("should have default template showing label only", () => {
      // Default template shows just the label — classes needing a suffix have explicit entries in classTemplates
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.defaultTemplate).toBe("{{exo__Asset_label}}");
    });

    it("has explicit templates only for suffix classes (label + real class UID) + DailyNote; pure-label classes use the default", () => {
      // Suffix classes — cold-start seed keyed by BOTH label AND real class UID (req b4ee3caa, #2110).
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__TaskPrototype"]).toBeDefined();
      expect(
        DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["df7e579d-02d4-4f3a-971f-3d1d785b689b"],
      ).toBeDefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__MeetingPrototype"]).toBeDefined();
      expect(
        DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["7ab483c7-aafc-4ac8-8aca-0de52db34a93"],
      ).toBeDefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["pn__DailyNote"]).toBeDefined();
      // Pure-label classes equalled the default template → removed (they fall through unchanged).
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__Task"]).toBeUndefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__Project"]).toBeUndefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__Area"]).toBeUndefined();
      expect(DEFAULT_DISPLAY_NAME_SETTINGS.classTemplates["ems__Meeting"]).toBeUndefined();
    });

    it("should work correctly with resolver", () => {
      const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);

      // Task
      const taskResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "Fix bug",
          exo__Instance_class: ["[[ems__Task]]"],
        },
        basename: "fix-bug",
      });
      expect(taskResult).toBe("Fix bug");

      // TaskPrototype
      const prototypeResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "Morning routine",
          exo__Instance_class: ["[[ems__TaskPrototype]]"],
        },
        basename: "morning-routine",
      });
      expect(prototypeResult).toBe("Morning routine (TaskPrototype)");

      // FIX (req b4ee3caa): a TaskPrototype instance keyed by the REAL class UID
      // (how real instances reference exo__Instance_class) now gets the suffix via
      // the cold-start seed — previously it fell through to the label-only default.
      const uidKeyedPrototype = resolver.resolve({
        metadata: {
          exo__Asset_label: "Measure HRV",
          exo__Instance_class: ["[[df7e579d-02d4-4f3a-971f-3d1d785b689b]]"],
        },
        basename: "measure-hrv",
      });
      expect(uidKeyedPrototype).toBe("Measure HRV (TaskPrototype)");

      // Pure-label class (Project) — byte-identical after its redundant classTemplate removal.
      const projectResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "Q3 Roadmap",
          exo__Instance_class: ["[[ems__Project]]"],
        },
        basename: "q3-roadmap",
      });
      expect(projectResult).toBe("Q3 Roadmap");
    });

    it("should use default template (label only) for unknown asset types", () => {
      const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);

      // Unknown class (e.g. ims__Concept, myapp__CustomClass) shows just the label — no class suffix
      const customResult = resolver.resolve({
        metadata: {
          exo__Asset_label: "My Custom Asset",
          exo__Instance_class: ["[[myapp__CustomClass]]"],
        },
        basename: "custom-asset",
      });
      expect(customResult).toBe("My Custom Asset");
    });

    it("should show label only for ims__Concept (H1 regression fix)", () => {
      const resolver = new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);

      const result = resolver.resolve({
        metadata: {
          exo__Asset_label: "Wikilink in Reading View",
          exo__Instance_class: ["[[ims__Concept]]"],
        },
        basename: "some-concept-uuid",
      });
      expect(result).toBe("Wikilink in Reading View");
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
          exo__Instance_class: ["[[pn__DailyNote]]"],
        },
        basename: "2025-10-15",
      });
      expect(dailyNoteResult).toBe("2025-10-15");
    });
  });
});
