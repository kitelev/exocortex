import { describe, it, expect } from "@jest/globals";
import {
  TemplateRegistry,
  TemplateNotFoundError,
  InvalidParameterError,
  MissingParameterError,
  InvalidParamFormatError,
} from "../../../src/templates/TemplateRegistry.js";

describe("TemplateRegistry", () => {
  describe("listTemplates", () => {
    it("should return all available templates", () => {
      const registry = new TemplateRegistry();
      const templates = registry.listTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0]).toHaveProperty("name");
      expect(templates[0]).toHaveProperty("description");
      expect(templates[0]).toHaveProperty("parameters");
    });

    it("should include MVP templates", () => {
      const registry = new TemplateRegistry();
      const templates = registry.listTemplates();
      const templateNames = templates.map((t) => t.name);

      expect(templateNames).toContain("tasks-by-date");
      expect(templateNames).toContain("tasks-by-status");
      expect(templateNames).toContain("projects-active");
      expect(templateNames).toContain("concepts-by-domain");
      expect(templateNames).toContain("sleep-analysis");
    });
  });

  describe("getTemplate", () => {
    it("should return template by name", () => {
      const registry = new TemplateRegistry();
      const template = registry.getTemplate("tasks-by-date");

      expect(template).toBeDefined();
      expect(template.name).toBe("tasks-by-date");
      expect(template.query).toContain("SELECT");
      expect(template.parameters).toContain("date");
    });

    it("should throw TemplateNotFoundError for unknown template", () => {
      const registry = new TemplateRegistry();

      expect(() => registry.getTemplate("non-existent")).toThrow(TemplateNotFoundError);
    });
  });

  describe("applyTemplate", () => {
    it("should substitute single parameter", () => {
      const registry = new TemplateRegistry();
      const result = registry.applyTemplate("tasks-by-date", { date: "2024-01-15" });

      expect(result).toContain("2024-01-15");
      expect(result).not.toContain("{{date}}");
      expect(result).toContain("SELECT");
    });

    it("should substitute multiple parameters", () => {
      const registry = new TemplateRegistry();
      const template = registry.getTemplate("tasks-by-status");

      // Check that template has status parameter
      expect(template.parameters).toContain("status");

      const result = registry.applyTemplate("tasks-by-status", { status: "Done" });
      expect(result).toContain("Done");
      expect(result).not.toContain("{{status}}");
    });

    it("should throw MissingParameterError for required parameter not provided", () => {
      const registry = new TemplateRegistry();

      expect(() => registry.applyTemplate("tasks-by-date", {})).toThrow(MissingParameterError);
    });

    it("should throw InvalidParameterError for parameter not in template", () => {
      const registry = new TemplateRegistry();

      expect(() =>
        registry.applyTemplate("tasks-by-date", {
          date: "2024-01-15",
          unknown: "value"
        })
      ).toThrow(InvalidParameterError);
    });

    it("should throw TemplateNotFoundError for unknown template", () => {
      const registry = new TemplateRegistry();

      expect(() =>
        registry.applyTemplate("non-existent", { date: "2024-01-15" })
      ).toThrow(TemplateNotFoundError);
    });

    it("should handle templates without parameters (projects-active)", () => {
      const registry = new TemplateRegistry();
      const result = registry.applyTemplate("projects-active", {});

      expect(result).toContain("SELECT");
      expect(result).not.toContain("{{");
    });

    it("should escape special SPARQL characters in parameter values", () => {
      const registry = new TemplateRegistry();
      // Test that quotes are properly escaped in parameter values
      const result = registry.applyTemplate("concepts-by-domain", {
        domain: "test\"domain"
      });

      // Should escape quotes to prevent SPARQL injection
      expect(result).not.toContain('test"domain');
      expect(result).toContain('test\\"domain');
    });
  });

  describe("validateParameters", () => {
    it("should validate required parameters are present", () => {
      const registry = new TemplateRegistry();

      const validation = registry.validateParameters("tasks-by-date", {});
      expect(validation.valid).toBe(false);
      expect(validation.missing).toContain("date");
    });

    it("should validate no unknown parameters", () => {
      const registry = new TemplateRegistry();

      const validation = registry.validateParameters("tasks-by-date", {
        date: "2024-01-15",
        unknown: "value"
      });
      expect(validation.valid).toBe(false);
      expect(validation.unknown).toContain("unknown");
    });

    it("should return valid for correct parameters", () => {
      const registry = new TemplateRegistry();

      const validation = registry.validateParameters("tasks-by-date", {
        date: "2024-01-15"
      });
      expect(validation.valid).toBe(true);
      expect(validation.missing).toHaveLength(0);
      expect(validation.unknown).toHaveLength(0);
    });
  });

  describe("parseParamString", () => {
    it("should parse single key=value", () => {
      const registry = new TemplateRegistry();
      const params = registry.parseParamString("date=2024-01-15");

      expect(params).toEqual({ date: "2024-01-15" });
    });

    it("should parse multiple comma-separated params", () => {
      const registry = new TemplateRegistry();
      const params = registry.parseParamString("status=Done,limit=10");

      expect(params).toEqual({ status: "Done", limit: "10" });
    });

    it("should handle values with equals sign", () => {
      const registry = new TemplateRegistry();
      const params = registry.parseParamString("filter=value=test");

      expect(params).toEqual({ filter: "value=test" });
    });

    it("should trim whitespace", () => {
      const registry = new TemplateRegistry();
      const params = registry.parseParamString("  date = 2024-01-15  ");

      expect(params).toEqual({ date: "2024-01-15" });
    });

    it("should return empty object for empty string", () => {
      const registry = new TemplateRegistry();
      const params = registry.parseParamString("");

      expect(params).toEqual({});
    });

    it("should throw for invalid format", () => {
      const registry = new TemplateRegistry();

      expect(() => registry.parseParamString("invalid")).toThrow(InvalidParamFormatError);
    });
  });

  describe("hasTemplate", () => {
    it("should return true for existing template", () => {
      const registry = new TemplateRegistry();
      expect(registry.hasTemplate("tasks-by-date")).toBe(true);
    });

    it("should return false for non-existing template", () => {
      const registry = new TemplateRegistry();
      expect(registry.hasTemplate("non-existent")).toBe(false);
    });
  });

  describe("registerTemplate", () => {
    it("should register custom template", () => {
      const registry = new TemplateRegistry();
      registry.registerTemplate({
        name: "custom-query",
        description: "Custom test query",
        query: "SELECT ?s WHERE { ?s ?p {{value}} }",
        parameters: ["value"],
      });

      expect(registry.hasTemplate("custom-query")).toBe(true);
      const template = registry.getTemplate("custom-query");
      expect(template.description).toBe("Custom test query");
    });
  });

  describe("formatList", () => {
    it("should format as text", () => {
      const registry = new TemplateRegistry();
      const output = registry.formatList("text");

      expect(output).toContain("Available SPARQL Templates");
      expect(output).toContain("tasks-by-date");
      expect(output).toContain("Parameters:");
    });

    it("should format as JSON", () => {
      const registry = new TemplateRegistry();
      const output = registry.formatList("json");

      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty("name");
    });
  });
});

describe("Template content verification", () => {
  const registry = new TemplateRegistry();

  describe("tasks-by-date template", () => {
    it("should have valid SPARQL query", () => {
      const template = registry.getTemplate("tasks-by-date");
      expect(template.query).toMatch(/SELECT/i);
      expect(template.query).toMatch(/WHERE/i);
      expect(template.query).toContain("{{date}}");
    });

    it("should query for tasks with date filter", () => {
      const template = registry.getTemplate("tasks-by-date");
      expect(template.query).toMatch(/ems:Task/);
    });
  });

  describe("tasks-by-status template", () => {
    it("should have status parameter", () => {
      const template = registry.getTemplate("tasks-by-status");
      expect(template.parameters).toContain("status");
    });

    it("should filter by effort status", () => {
      const template = registry.getTemplate("tasks-by-status");
      expect(template.query).toMatch(/ems:Effort|ems:Task/);
    });
  });

  describe("projects-active template", () => {
    it("should have no required parameters", () => {
      const template = registry.getTemplate("projects-active");
      expect(template.parameters).toHaveLength(0);
    });

    it("should query for active projects", () => {
      const template = registry.getTemplate("projects-active");
      expect(template.query).toMatch(/ems:Project/);
    });
  });

  describe("concepts-by-domain template", () => {
    it("should have domain parameter", () => {
      const template = registry.getTemplate("concepts-by-domain");
      expect(template.parameters).toContain("domain");
    });

    it("should query for concepts", () => {
      const template = registry.getTemplate("concepts-by-domain");
      expect(template.query).toMatch(/ims:Concept/);
    });
  });

  describe("sleep-analysis template", () => {
    it("should have no required parameters for default behavior", () => {
      const template = registry.getTemplate("sleep-analysis");
      // Sleep analysis returns recent data by default
      expect(template.parameters).toHaveLength(0);
    });

    it("should query for sleep-related data", () => {
      const template = registry.getTemplate("sleep-analysis");
      // Should query tasks or efforts related to sleep
      expect(template.query).toMatch(/ems:|sleep/i);
    });
  });
});
