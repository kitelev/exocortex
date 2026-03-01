/**
 * Tests for NLToSPARQLService
 *
 * These tests verify the natural language to SPARQL conversion functionality,
 * including template matching, parameter extraction, and query generation.
 */

// Import reflect-metadata for TSyringe decorator support
import "reflect-metadata";

import {
  NLToSPARQLService,
  DEFAULT_NL_TO_SPARQL_CONFIG,
  type NLToSPARQLConfig,
  type NLToSPARQLResult,
} from "../../src/services/NLToSPARQLService";
import { KNOWN_PROTOTYPES } from "../../src/services/SPARQLTemplateLibrary";

describe("NLToSPARQLService", () => {
  let service: NLToSPARQLService;

  beforeEach(() => {
    service = new NLToSPARQLService();
  });

  describe("Configuration", () => {
    it("should use default configuration", () => {
      const config = service.getConfig();
      expect(config.defaultLimit).toBe(DEFAULT_NL_TO_SPARQL_CONFIG.defaultLimit);
      expect(config.includeExplanation).toBe(DEFAULT_NL_TO_SPARQL_CONFIG.includeExplanation);
      expect(config.confidenceThreshold).toBe(DEFAULT_NL_TO_SPARQL_CONFIG.confidenceThreshold);
    });

    it("should accept custom configuration", () => {
      const customConfig: Partial<NLToSPARQLConfig> = {
        defaultLimit: 50,
        confidenceThreshold: 0.5,
      };
      const customService = new NLToSPARQLService(customConfig);
      const config = customService.getConfig();
      expect(config.defaultLimit).toBe(50);
      expect(config.confidenceThreshold).toBe(0.5);
    });

    it("should update configuration via setConfig", () => {
      service.setConfig({ defaultLimit: 25 });
      const config = service.getConfig();
      expect(config.defaultLimit).toBe(25);
    });
  });

  describe("convert - Basic Queries", () => {
    it("should convert simple search query", () => {
      const result = service.convert("найди все задачи со словом душ");

      expect(result.query).toBeDefined();
      expect(result.query).toContain("SELECT");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.explanation).toBeDefined();
    });

    it("should extract keyword from query", () => {
      const result = service.convert('найди записи с "утренний душ"');

      expect(result.parameters).toBeDefined();
      // Should have extracted keyword
      expect(Object.values(result.parameters).some((v) => v.includes("душ"))).toBe(true);
    });

    it("should include SPARQL prefixes", () => {
      const result = service.convert("найди задачи");

      expect(result.query).toContain("PREFIX exo:");
      expect(result.query).toContain("PREFIX ems:");
    });
  });

  describe("convert - UUID Queries", () => {
    it("should recognize UUID and use properties_by_uuid template", () => {
      const uuid = "2d369bb0-159f-4639-911d-ec2c585e8d00";
      const result = service.convert(`покажи свойства ${uuid}`);

      expect(result.templateName).toBe("properties_by_uuid");
      expect(result.parameters.uuid).toBe(uuid);
      expect(result.query).toContain(uuid);
    });

    it("should recognize prototype UUID query", () => {
      const uuid = "2d369bb0-159f-4639-911d-ec2c585e8d00";
      const result = service.convert(`найди инстансы прототипа ${uuid}`);

      expect(result.templateName).toBe("find_by_prototype_uuid");
      expect(result.parameters.prototypeUuid).toBe(uuid);
    });

    it("should handle UUID without dashes", () => {
      const uuid = "2d369bb0159f4639911dec2c585e8d00";
      const result = service.convert(`покажи ${uuid}`);

      expect(result.query).toContain(uuid);
    });
  });

  describe("convert - Activity Analysis", () => {
    it("should recognize sleep analysis query", () => {
      const result = service.convert("анализ сна за декабрь");

      expect(result.query).toContain("Поспать");
      // Should match sleep_analysis template or similar
    });

    it("should recognize average duration query", () => {
      const result = service.convert("среднее время утреннего душа");

      expect(result.query).toContain("AVG");
      // Should include duration calculation
    });

    it("should map activity names to prototypes", () => {
      const result = service.convert("статистика утреннего душа");

      // Should recognize and use morning shower prototype UUID
      expect(result.query).toContain(KNOWN_PROTOTYPES.MORNING_SHOWER);
    });
  });

  describe("convert - Project Queries", () => {
    it("should convert active projects query", () => {
      const result = service.convert("активные проекты");

      expect(result.templateName).toBe("active_projects");
      expect(result.query).toContain("ems:EffortStatusDoing");
    });

    it("should convert projects without tasks query", () => {
      const result = service.convert("проекты без задач");

      expect(result.templateName).toBe("projects_without_tasks");
      expect(result.query).toContain("FILTER NOT EXISTS");
    });
  });

  describe("convert - Recent Activities", () => {
    it("should convert recent activities query", () => {
      const result = service.convert("последние активности");

      expect(result.templateName).toBe("recent_activities");
      expect(result.query).toContain("ORDER BY DESC(?start)");
    });

    it("should extract limit from query", () => {
      const result = service.convert("последние 10 активностей");

      expect(result.query).toContain("LIMIT");
      // Should use the extracted limit
      expect(result.parameters.limit).toBe("10");
    });
  });

  describe("convert - Fallback Behavior", () => {
    it("should create fallback query for unrecognized input", () => {
      const result = service.convert("xyzzy something random");

      expect(result.isFallback).toBe(true);
      expect(result.query).toContain("SELECT");
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });

    it("should still produce valid SPARQL in fallback mode", () => {
      const result = service.convert("непонятный запрос");

      expect(result.query).toContain("PREFIX exo:");
      expect(result.query).toContain("SELECT");
      expect(result.query).toContain("WHERE");
    });
  });

  describe("convert - Date Extraction", () => {
    it("should extract year-month from query", () => {
      const result = service.convert("сон за 2025-12");

      expect(result.parameters.yearMonth || result.query).toContain("2025-12");
    });

    it("should recognize month names in Russian", () => {
      // Use a query that clearly triggers sleep analysis template
      const result = service.convert("сон за декабрь 2025");

      // Should use sleep_analysis template which includes year-month in pattern
      expect(result.templateName).toBe("sleep_analysis");
      expect(result.query).toContain("Поспать");
    });

    it("should recognize month names in English", () => {
      const result = service.convert("sleep analysis for december");

      expect(result.query).toContain("12");
    });
  });

  describe("convert - Parameter Validation", () => {
    it("should attempt to infer missing parameters", () => {
      const result = service.convert("среднее время душа");

      // Should infer prototype UUID from "душ"
      expect(result.isFallback).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it("should handle empty query", () => {
      const result = service.convert("");

      expect(result.query).toBeDefined();
      expect(result.isFallback).toBe(true);
    });

    it("should handle whitespace-only query", () => {
      const result = service.convert("   ");

      expect(result.query).toBeDefined();
    });
  });

  describe("convert - Result Structure", () => {
    it("should return all expected fields", () => {
      const result = service.convert("найди задачи");

      expect(result).toHaveProperty("query");
      expect(result).toHaveProperty("templateName");
      expect(result).toHaveProperty("parameters");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("explanation");
      expect(result).toHaveProperty("isFallback");
      expect(result).toHaveProperty("alternatives");
    });

    it("should provide alternatives for low confidence matches", () => {
      const result = service.convert("найди что-нибудь");

      expect(Array.isArray(result.alternatives)).toBe(true);
    });
  });

  describe("getAvailableTemplates", () => {
    it("should return all templates", () => {
      const templates = service.getAvailableTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0]).toHaveProperty("name");
      expect(templates[0]).toHaveProperty("description");
      expect(templates[0]).toHaveProperty("template");
    });
  });

  describe("getTemplate", () => {
    it("should get template by name", () => {
      const template = service.getTemplate("search_by_label");

      expect(template).toBeDefined();
      expect(template?.name).toBe("search_by_label");
    });

    it("should return undefined for unknown template", () => {
      const template = service.getTemplate("unknown_template");

      expect(template).toBeUndefined();
    });
  });

  describe("getSuggestions", () => {
    it("should suggest adding date for statistics queries", () => {
      const suggestions = service.getSuggestions("сколько всего");

      const hasDateSuggestion = suggestions.some(
        (s) => s.includes("период") || s.includes("время")
      );
      expect(hasDateSuggestion).toBe(true);
    });

    it("should suggest using UUID for task queries", () => {
      const suggestions = service.getSuggestions("задачи");

      const hasUuidSuggestion = suggestions.some((s) => s.includes("UUID"));
      expect(hasUuidSuggestion).toBe(true);
    });

    it("should suggest clarification for short queries", () => {
      const suggestions = service.getSuggestions("найди");

      expect(suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("addTemplate", () => {
    it("should add custom template", () => {
      const customTemplate = {
        name: "custom_test_template",
        description: "Test template",
        template: "SELECT ?s WHERE { ?s ?p ?o } LIMIT {{limit}}",
        parameters: [{ name: "limit", description: "Limit", required: false }],
        examples: ["test query"],
        keywords: ["test"],
      };

      service.addTemplate(customTemplate);

      const template = service.getTemplate("custom_test_template");
      expect(template).toBeDefined();
      expect(template?.name).toBe("custom_test_template");
    });
  });

  describe("Integration - Query Types", () => {
    it("should handle persons query", () => {
      const result = service.convert("все люди");

      expect(result.templateName).toBe("persons");
      expect(result.query).toContain("ims__Person");
    });

    it("should handle areas query", () => {
      const result = service.convert("области ответственности");

      expect(result.templateName).toBe("areas");
      expect(result.query).toContain("ems__Area");
    });

    it("should handle count by class query", () => {
      const result = service.convert("сколько записей каждого типа");

      expect(result.templateName).toBe("count_by_class");
      expect(result.query).toContain("GROUP BY");
      expect(result.query).toContain("COUNT");
    });

    it("should handle entity properties query", () => {
      const result = service.convert("покажи свойства сущности");

      expect(result.templateName).toBe("entity_properties");
      expect(result.query).toContain("?p ?o");
    });

    it("should handle find prototype query", () => {
      const result = service.convert("какой прототип у задачи утренний душ");

      expect(result.templateName).toBe("find_prototype");
      expect(result.query).toContain("Asset_prototype");
    });
  });

  describe("Edge Cases", () => {
    it("should handle mixed language queries", () => {
      const result = service.convert("найди active projects");

      expect(result.query).toBeDefined();
      expect(result.isFallback).toBe(false);
    });

    it("should handle queries with special characters", () => {
      const result = service.convert('найди "задачу с кавычками"');

      expect(result.query).toBeDefined();
    });

    it("should handle very long queries", () => {
      const longQuery = "найди " + "очень ".repeat(100) + "длинный запрос";
      const result = service.convert(longQuery);

      expect(result.query).toBeDefined();
    });

    it("should handle queries with numbers", () => {
      const result = service.convert("последние 25 активностей");

      expect(result.query).toBeDefined();
      // Should use the number as limit
      expect(result.query).toContain("LIMIT 25");
    });
  });
});

describe("NLToSPARQLService - Class-based queries (#2248)", () => {
  let service: NLToSPARQLService;

  beforeEach(() => {
    service = new NLToSPARQLService();
  });

  describe("Class detection", () => {
    it("should detect concept class and generate class-based query", () => {
      const result = service.convert("найди все концепты");

      expect(result.templateName).toBe("find_by_class");
      expect(result.query).toContain("Instance_class");
      expect(result.query).toContain("dda12c48-6886-4624-8710-ed4ba92ce2b3");
      expect(result.query).toContain("FILTER NOT EXISTS");
      expect(result.query).toContain("Asset_deprecatedBy");
      expect(result.isFallback).toBe(false);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should detect concept class with keyword and use REGEX", () => {
      const result = service.convert("найди все концепты связанные с agent или sandbox");

      expect(result.templateName).toBe("find_by_class_and_keyword");
      expect(result.query).toContain("Instance_class");
      expect(result.query).toContain("dda12c48-6886-4624-8710-ed4ba92ce2b3");
      expect(result.query).toContain("REGEX");
      expect(result.query).toContain("agent");
      expect(result.query).toContain("sandbox");
      expect(result.query).toContain("FILTER NOT EXISTS");
      expect(result.isFallback).toBe(false);
    });

    it("should detect task class", () => {
      const result = service.convert("все задачи");

      expect(result.templateName).toBe("find_by_class");
      expect(result.query).toContain("1b20a8f0-d745-4e93-91db-4531b3df120e");
    });

    it("should detect project class", () => {
      const result = service.convert("список проектов");

      // May match active_projects or find_by_class depending on keyword score
      expect(result.query).toBeDefined();
    });

    it("should detect conspect class", () => {
      const result = service.convert("найди все конспекты");

      expect(result.templateName).toBe("find_by_class");
      expect(result.query).toContain("8efe8da6-0b88-4752-b90a-109280111c43");
    });

    it("should detect person class", () => {
      const result = service.convert("найди всех людей");

      expect(result.query).toContain("ims__Person");
    });
  });

  describe("Multi-term REGEX search", () => {
    it("should combine multiple terms with pipe for REGEX", () => {
      const result = service.convert("концепты про agent или sandbox");

      expect(result.query).toContain("REGEX");
      // Should contain both terms separated by |
      expect(result.query).toMatch(/agent\|sandbox|sandbox\|agent/);
    });

    it("should handle single keyword with class", () => {
      const result = service.convert("конспекты про философию");

      expect(result.templateName).toBe("find_by_class_and_keyword");
      expect(result.query).toContain("REGEX");
      expect(result.query).toContain("философию");
    });
  });

  describe("Deprecated filter", () => {
    it("should include deprecated filter in class queries", () => {
      const result = service.convert("все концепты");

      expect(result.query).toContain("FILTER NOT EXISTS");
      expect(result.query).toContain("Asset_deprecatedBy");
    });

    it("should include deprecated filter in fallback queries", () => {
      // Use a query that doesn't match any template or class
      const result = service.convert("zzxxyyww qwfpgj");

      expect(result.isFallback).toBe(true);
      expect(result.query).toContain("FILTER NOT EXISTS");
      expect(result.query).toContain("Asset_deprecatedBy");
    });
  });

  describe("Fallback uses REGEX not CONTAINS(LCASE)", () => {
    it("should use REGEX in fallback query", () => {
      const result = service.convert("zzxxyyww qwfpgj");

      expect(result.isFallback).toBe(true);
      expect(result.query).toContain("REGEX");
      expect(result.query).not.toContain("CONTAINS(LCASE");
    });
  });

  describe("Specific templates still take priority", () => {
    it("should prefer active_projects over class detection", () => {
      const result = service.convert("активные проекты");

      expect(result.templateName).toBe("active_projects");
    });

    it("should prefer projects_without_tasks over class detection", () => {
      const result = service.convert("проекты без задач");

      expect(result.templateName).toBe("projects_without_tasks");
    });

    it("should prefer areas template over class detection", () => {
      const result = service.convert("все области");

      expect(result.templateName).toBe("areas");
    });

    it("should prefer persons template over class detection", () => {
      const result = service.convert("все люди");

      expect(result.templateName).toBe("persons");
    });
  });
});
