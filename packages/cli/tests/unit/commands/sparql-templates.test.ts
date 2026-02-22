import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Command } from "commander";

// Mock dependencies
jest.unstable_mockModule("../../../src/templates/TemplateRegistry.js", () => ({
  TemplateRegistry: jest.fn(() => ({
    listTemplates: jest.fn().mockReturnValue([
      {
        name: "tasks-by-date",
        description: "Find tasks scheduled for a specific date",
        parameters: ["date"],
        examples: { date: "2024-01-15" },
      },
      {
        name: "projects-active",
        description: "List all active projects",
        parameters: [],
        examples: {},
      },
    ]),
    formatList: jest.fn().mockReturnValue(
      "Available SPARQL Templates:\n" +
      "==================================================\n\n" +
      "📋 tasks-by-date\n" +
      "   Find tasks scheduled for a specific date\n" +
      "   Parameters: date\n\n" +
      "📋 projects-active\n" +
      "   List all active projects\n" +
      "   Parameters: (none)\n"
    ),
  })),
}));

// Import after mocks
const { sparqlTemplatesCommand } = await import("../../../src/commands/sparql-templates.js");

describe("sparqlTemplatesCommand", () => {
  let consoleSpy: jest.SpiedFunction<typeof console.log>;
  let command: Command;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    command = sparqlTemplatesCommand();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("command setup", () => {
    it("should have correct name", () => {
      expect(command.name()).toBe("templates");
    });

    it("should have description", () => {
      expect(command.description()).toContain("SPARQL query templates");
    });

    it("should have --output option", () => {
      const options = command.options;
      const outputOption = options.find((opt) => opt.long === "--output");
      expect(outputOption).toBeDefined();
    });
  });

  describe("text output", () => {
    it("should list templates in text format by default", async () => {
      await command.parseAsync(["node", "test"]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.join("\n");
      expect(output).toContain("Available SPARQL Templates");
      expect(output).toContain("tasks-by-date");
    });
  });

  describe("json output", () => {
    it("should list templates in JSON format", async () => {
      await command.parseAsync(["node", "test", "--output", "json"]);

      expect(consoleSpy).toHaveBeenCalled();
      const jsonOutput = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.success).toBe(true);
      expect(parsed.data.templates).toBeDefined();
      expect(parsed.data.count).toBe(2);
    });
  });
});
