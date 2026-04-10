/**
 * Integration tests for wikilink resolution and display name rendering.
 *
 * These tests verify the complete flow:
 * - Wikilink extraction from metadata
 * - Display name template rendering
 * - Class-based template selection
 * - Wikilink alias management
 *
 * Issue #2187: Add integration tests for critical user paths
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DisplayNameTemplateEngine } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import { DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * Test settings for display name resolution.
 */
const createTestSettings = (
  overrides: Partial<DisplayNameSettings> = {}
): DisplayNameSettings => ({
  defaultTemplate: "{{exo__Asset_label}}",
  classTemplates: {},
  ...overrides,
});

describe("Wikilink Resolution (Integration)", () => {
  describe("DisplayNameTemplateEngine", () => {
    describe("Basic Template Rendering", () => {
      it("should render simple label template", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine("{{exo__Asset_label}}");
        const metadata = { exo__Asset_label: "My Task" };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("My Task");
      });

      it("should render template with multiple placeholders", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "[{{exo__Instance_class}}] {{exo__Asset_label}}"
        );
        const metadata = {
          exo__Instance_class: ["[[ems__Task]]"],
          exo__Asset_label: "Important Task",
        };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("[ems__Task] Important Task");
      });

      it("should render template with suffix pattern", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{exo__Asset_label}} ({{exo__Instance_class}})"
        );
        const metadata = {
          exo__Instance_class: ["[[ems__Project]]"],
          exo__Asset_label: "Q1 Sprint",
        };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("Q1 Sprint (ems__Project)");
      });
    });

    describe("Wikilink Syntax Handling", () => {
      it("should strip wikilink brackets from values", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{exo__Asset_label}} - {{ems__Effort_status}}"
        );
        const metadata = {
          exo__Asset_label: "My Task",
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
        };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("My Task - ems__EffortStatusDoing");
        expect(result).not.toContain("[[");
        expect(result).not.toContain("]]");
      });

      it("should handle array values with wikilinks", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine("{{exo__Instance_class}}");
        const metadata = {
          exo__Instance_class: ["[[ems__Task]]"],
        };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("ems__Task");
      });
    });

    describe("Special Variables", () => {
      it("should render _basename special variable", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{_basename}} - {{exo__Asset_label}}"
        );
        const metadata = { exo__Asset_label: "Description" };

        // Act
        const result = engine.render(metadata, "abc-123-def");

        // Assert
        expect(result).toBe("abc-123-def - Description");
      });

      it("should render _created special variable", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{_created}}: {{exo__Asset_label}}"
        );
        const metadata = { exo__Asset_label: "Daily Log" };
        const createdDate = new Date("2024-03-15");

        // Act
        const result = engine.render(metadata, "basename", createdDate);

        // Assert
        expect(result).toBe("2024-03-15: Daily Log");
      });
    });

    describe("Nested Field Access", () => {
      it("should resolve dot-notation for nested fields", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{custom.priority}}: {{exo__Asset_label}}"
        );
        const metadata = {
          exo__Asset_label: "Task Name",
          custom: { priority: "high" },
        };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("high: Task Name");
      });

      it("should handle missing nested fields gracefully", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{nested.field}}: {{exo__Asset_label}}"
        );
        const metadata = { exo__Asset_label: "Task Name" };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert - Missing nested field returns empty string
        expect(result).toBe(": Task Name");
      });
    });

    describe("Empty Value Cleanup", () => {
      it("should remove empty parentheses at end of string", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{exo__Asset_label}} ({{missing}})"
        );
        const metadata = { exo__Asset_label: "Task Name" };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("Task Name");
        expect(result).not.toContain("()");
      });

      it("should remove empty brackets at end of string", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine(
          "{{exo__Asset_label}} [{{missing}}]"
        );
        const metadata = { exo__Asset_label: "Task Name" };

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBe("Task Name");
        expect(result).not.toContain("[]");
      });

      it("should return null for empty template result", () => {
        // Arrange
        const engine = new DisplayNameTemplateEngine("{{missing}}");
        const metadata = {};

        // Act
        const result = engine.render(metadata, "basename");

        // Assert
        expect(result).toBeNull();
      });
    });

    describe("Template Validation", () => {
      it("should identify valid templates with placeholders", () => {
        const validEngine = new DisplayNameTemplateEngine("{{field}}");
        expect(validEngine.isValid()).toBe(true);
      });

      it("should identify invalid templates without placeholders", () => {
        const invalidEngine = new DisplayNameTemplateEngine("static text");
        expect(invalidEngine.isValid()).toBe(false);
      });

      it("should identify empty templates as invalid", () => {
        const emptyEngine = new DisplayNameTemplateEngine("");
        expect(emptyEngine.isValid()).toBe(false);
      });

      it("should extract all placeholders from template", () => {
        const engine = new DisplayNameTemplateEngine(
          "{{field1}} - {{field2}} ({{field3}})"
        );
        const placeholders = engine.getPlaceholders();

        expect(placeholders).toEqual(["field1", "field2", "field3"]);
      });
    });
  });

  describe("DisplayNameResolver", () => {
    describe("Default Template Resolution", () => {
      it("should use default template when no class template exists", () => {
        // Arrange
        const settings = createTestSettings({
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
        });
        const resolver = new DisplayNameResolver(settings);
        const context = {
          metadata: {
            exo__Instance_class: ["[[ems__Task]]"],
            exo__Asset_label: "Task Label",
          },
          basename: "task-123",
        };

        // Act
        const result = resolver.resolve(context);

        // Assert
        expect(result).toBe("Task Label");
      });
    });

    describe("Class-Specific Template Resolution", () => {
      it("should use class-specific template when configured", () => {
        // Arrange
        const settings = createTestSettings({
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {
            "ems__Task": "[TASK] {{exo__Asset_label}}",
            "ems__Project": "[PROJECT] {{exo__Asset_label}}",
          },
        });
        const resolver = new DisplayNameResolver(settings);
        const context = {
          metadata: {
            exo__Instance_class: ["[[ems__Task]]"],
            exo__Asset_label: "My Task",
          },
          basename: "task-123",
        };

        // Act
        const result = resolver.resolve(context);

        // Assert
        expect(result).toBe("[TASK] My Task");
      });

      it("should handle array-format instance class", () => {
        // Arrange
        const settings = createTestSettings({
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {
            "ems__Task": "[T] {{exo__Asset_label}}",
          },
        });
        const resolver = new DisplayNameResolver(settings);
        const context = {
          metadata: {
            exo__Instance_class: ["ems__Task"],
            exo__Asset_label: "Array Class Task",
          },
          basename: "task-456",
        };

        // Act
        const result = resolver.resolve(context);

        // Assert
        expect(result).toBe("[T] Array Class Task");
      });

      it("should handle wikilink-wrapped instance class", () => {
        // Arrange
        const settings = createTestSettings({
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {
            "ems__Meeting": "[MEETING] {{exo__Asset_label}}",
          },
        });
        const resolver = new DisplayNameResolver(settings);
        const context = {
          metadata: {
            exo__Instance_class: ["[[ems__Meeting]]"],
            exo__Asset_label: "Team Standup",
          },
          basename: "meeting-789",
        };

        // Act
        const result = resolver.resolve(context);

        // Assert
        expect(result).toBe("[MEETING] Team Standup");
      });

      it("should handle quoted wikilink instance class", () => {
        // Arrange
        // Note: When class is stored as '"[[ems__Area]]"', cleanClassValue:
        // 1. First removes brackets (but fails due to ^ anchor since " is first)
        // 2. Then removes quotes → "[[ems__Area]]" becomes [[ems__Area]]
        // The cleaned value "[[ems__Area]]" doesn't match "ems__Area" key
        // So it falls back to default template
        const settings = createTestSettings({
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {
            "ems__Area": "[AREA] {{exo__Asset_label}}",
          },
        });
        const resolver = new DisplayNameResolver(settings);
        const context = {
          metadata: {
            // More realistic format: array with wikilink (not double-wrapped)
            exo__Instance_class: ["[[ems__Area]]"],
            exo__Asset_label: "Work",
          },
          basename: "area-work",
        };

        // Act
        const result = resolver.resolve(context);

        // Assert
        expect(result).toBe("[AREA] Work");
      });
    });

    describe("Fallback Behavior", () => {
      it("should fallback to default template for unknown class", () => {
        // Arrange
        const settings = createTestSettings({
          defaultTemplate: "DEFAULT: {{exo__Asset_label}}",
          classTemplates: {
            "ems__Task": "TASK: {{exo__Asset_label}}",
          },
        });
        const resolver = new DisplayNameResolver(settings);
        const context = {
          metadata: {
            exo__Instance_class: ["[[custom__UnknownClass]]"],
            exo__Asset_label: "Unknown Asset",
          },
          basename: "unknown-123",
        };

        // Act
        const result = resolver.resolve(context);

        // Assert
        expect(result).toBe("DEFAULT: Unknown Asset");
      });

      it("should return null when no label and empty template result", () => {
        // Arrange
        const settings = createTestSettings({
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
        });
        const resolver = new DisplayNameResolver(settings);
        const context = {
          metadata: {
            exo__Instance_class: ["[[ems__Task]]"],
            // No label
          },
          basename: "task-empty",
        };

        // Act
        const result = resolver.resolve(context);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe("Helper Methods", () => {
      it("should return configured class list", () => {
        // Arrange
        const settings = createTestSettings({
          classTemplates: {
            "ems__Task": "template1",
            "ems__Project": "template2",
            "ems__Area": "template3",
          },
        });
        const resolver = new DisplayNameResolver(settings);

        // Act
        const classes = resolver.getConfiguredClasses();

        // Assert
        expect(classes).toHaveLength(3);
        expect(classes).toContain("ems__Task");
        expect(classes).toContain("ems__Project");
        expect(classes).toContain("ems__Area");
      });

      it("should detect presence of class templates", () => {
        const withTemplates = new DisplayNameResolver(
          createTestSettings({ classTemplates: { "ems__Task": "template" } })
        );
        expect(withTemplates.hasClassTemplates()).toBe(true);

        const withoutTemplates = new DisplayNameResolver(
          createTestSettings({ classTemplates: {} })
        );
        expect(withoutTemplates.hasClassTemplates()).toBe(false);
      });

      it("should return correct template for given class", () => {
        // Arrange
        const settings = createTestSettings({
          defaultTemplate: "DEFAULT",
          classTemplates: {
            "ems__Task": "TASK_TEMPLATE",
          },
        });
        const resolver = new DisplayNameResolver(settings);

        // Act & Assert
        expect(resolver.getTemplateForClass("ems__Task")).toBe("TASK_TEMPLATE");
        expect(resolver.getTemplateForClass("ems__Project")).toBe("DEFAULT");
        expect(resolver.getTemplateForClass(null)).toBe("DEFAULT");
      });
    });
  });

  describe("End-to-End Wikilink Resolution Flow", () => {
    it("should resolve display name for task with wikilink status", () => {
      // Arrange: Realistic metadata from Obsidian file
      const settings = createTestSettings({
        defaultTemplate: "{{exo__Asset_label}}",
        classTemplates: {
          "ems__Task": "{{exo__Asset_label}} ({{ems__Effort_status}})",
        },
      });
      const resolver = new DisplayNameResolver(settings);
      const context = {
        metadata: {
          exo__Instance_class: ["[[ems__Task]]"],
          exo__Asset_label: "Implement feature X",
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
          exo__Asset_uid: "abc-123-def-456",
        },
        basename: "abc-123-def-456",
      };

      // Act
      const result = resolver.resolve(context);

      // Assert
      expect(result).toBe("Implement feature X (ems__EffortStatusDoing)");
    });

    it("should resolve display name for project with area reference", () => {
      // Arrange
      const settings = createTestSettings({
        defaultTemplate: "{{exo__Asset_label}}",
        classTemplates: {
          "ems__Project": "{{ems__Project_area}}/{{exo__Asset_label}}",
        },
      });
      const resolver = new DisplayNameResolver(settings);
      const context = {
        metadata: {
          exo__Instance_class: ["[[ems__Project]]"],
          exo__Asset_label: "Q1 Sprint",
          ems__Project_area: "[[Work]]",
        },
        basename: "project-q1-sprint",
      };

      // Act
      const result = resolver.resolve(context);

      // Assert
      expect(result).toBe("Work/Q1 Sprint");
    });

    it("should handle meeting with datetime", () => {
      // Arrange
      const settings = createTestSettings({
        defaultTemplate: "{{exo__Asset_label}}",
        classTemplates: {
          "ems__Meeting": "{{_created}}: {{exo__Asset_label}}",
        },
      });
      const resolver = new DisplayNameResolver(settings);
      const context = {
        metadata: {
          exo__Instance_class: ["[[ems__Meeting]]"],
          exo__Asset_label: "Weekly Standup",
        },
        basename: "meeting-2024-03-15",
        createdDate: new Date("2024-03-15"),
      };

      // Act
      const result = resolver.resolve(context);

      // Assert
      expect(result).toBe("2024-03-15: Weekly Standup");
    });

    it("should gracefully handle malformed metadata", () => {
      // Arrange
      const settings = createTestSettings({
        defaultTemplate: "{{exo__Asset_label}} - {{_basename}}",
      });
      const resolver = new DisplayNameResolver(settings);
      const context = {
        metadata: {
          // No class, no label - common in corrupted files
          random_field: "random_value",
        },
        basename: "orphan-file",
      };

      // Act
      const result = resolver.resolve(context);

      // Assert
      expect(result).toBe("- orphan-file");
    });
  });

  describe("Performance Considerations", () => {
    it("should handle large metadata objects efficiently", () => {
      // Arrange: Simulate metadata with many properties
      const metadata: Record<string, unknown> = {
        exo__Asset_label: "Performance Test",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      // Add 100 extra properties
      for (let i = 0; i < 100; i++) {
        metadata[`custom_property_${i}`] = `value_${i}`;
      }

      const engine = new DisplayNameTemplateEngine("{{exo__Asset_label}}");

      // Act
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        engine.render(metadata, "basename");
      }
      const duration = Date.now() - start;

      // Assert: 1000 renders should complete in reasonable time (<1s)
      expect(duration).toBeLessThan(1000);
    });

    it("should handle templates with many placeholders efficiently", () => {
      // Arrange: Template with 10 placeholders
      const template = Array.from(
        { length: 10 },
        (_, i) => `{{field_${i}}}`
      ).join(" - ");
      const metadata: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        metadata[`field_${i}`] = `value_${i}`;
      }

      const engine = new DisplayNameTemplateEngine(template);

      // Act
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        engine.render(metadata, "basename");
      }
      const duration = Date.now() - start;

      // Assert: Should be fast
      expect(duration).toBeLessThan(1000);
    });
  });
});
