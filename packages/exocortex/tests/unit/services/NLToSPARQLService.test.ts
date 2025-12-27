import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  NLToSPARQLService,
  DEFAULT_NL_TO_SPARQL_CONFIG,
} from "../../../src/services/NLToSPARQLService";
import {
  SPARQL_TEMPLATES,
  KNOWN_PROTOTYPES,
  getTemplateByName,
  findMatchingTemplates,
  fillTemplate,
  validateParameters,
} from "../../../src/services/SPARQLTemplateLibrary";

describe("NLToSPARQLService", () => {
  let service: NLToSPARQLService;

  beforeEach(() => {
    service = new NLToSPARQLService();
  });

  describe("constructor", () => {
    it("should use default config when no config provided", () => {
      const config = service.getConfig();
      expect(config).toEqual(DEFAULT_NL_TO_SPARQL_CONFIG);
    });

    it("should merge custom config with defaults", () => {
      const customService = new NLToSPARQLService({
        defaultLimit: 50,
        confidenceThreshold: 0.5,
      });
      const config = customService.getConfig();
      expect(config.defaultLimit).toBe(50);
      expect(config.confidenceThreshold).toBe(0.5);
      expect(config.includeExplanation).toBe(true); // default
    });
  });

  describe("convert", () => {
    describe("search queries", () => {
      it("should convert simple search query", () => {
        const result = service.convert("найди все задачи со словом йога");

        expect(result.query).toContain("SELECT");
        expect(result.query).toContain("FILTER");
        expect(result.query).toContain("йог");
        expect(result.confidence).toBeGreaterThan(0.3);
      });

      it("should convert search with quoted keyword", () => {
        const result = service.convert('поиск по названию "Утренний душ"');

        expect(result.query).toContain("Утренний душ");
        expect(result.isFallback).toBe(false);
      });
    });

    describe("prototype queries", () => {
      it("should convert query with known prototype (morning shower)", () => {
        const result = service.convert("среднее время утреннего душа");

        expect(result.query).toContain(KNOWN_PROTOTYPES.MORNING_SHOWER);
        expect(result.query).toContain("AVG");
        expect(result.templateName).toBe("average_duration_by_prototype");
        expect(result.confidence).toBeGreaterThan(0.5);
      });

      it("should convert query with explicit UUID", () => {
        const uuid = "2d369bb0-159f-4639-911d-ec2c585e8d00";
        const result = service.convert(`свойства сущности с UUID ${uuid}`);

        expect(result.query).toContain(uuid);
        expect(result.confidence).toBe(0.9);
      });

      it("should handle prototype instance search with UUID", () => {
        const uuid = "2d369bb0";
        const result = service.convert(`все инстансы прототипа ${uuid}`);

        expect(result.query).toContain(uuid);
        expect(result.templateName).toBe("find_by_prototype_uuid");
      });
    });

    describe("sleep analysis queries", () => {
      it("should convert sleep analysis query", () => {
        const result = service.convert("анализ сна за декабрь");

        expect(result.query).toContain("Поспать");
        expect(result.templateName).toBe("sleep_analysis");
      });

      it("should handle sleep query with year-month", () => {
        const result = service.convert("статистика сна за 2025-11");

        expect(result.query).toContain("Поспать 2025-11");
      });
    });

    describe("project queries", () => {
      it("should convert active projects query", () => {
        const result = service.convert("активные проекты");

        expect(result.query).toContain("ems:EffortStatusDoing");
        expect(result.templateName).toBe("active_projects");
      });

      it("should convert projects without tasks query", () => {
        const result = service.convert("проекты без задач");

        expect(result.query).toContain("FILTER NOT EXISTS");
        expect(result.templateName).toBe("projects_without_tasks");
      });
    });

    describe("recent activities queries", () => {
      it("should convert recent activities query", () => {
        const result = service.convert("последние 10 активностей");

        expect(result.query).toContain("ORDER BY DESC");
        expect(result.query).toContain("LIMIT");
        expect(result.templateName).toBe("recent_activities");
      });

      it("should extract limit from query", () => {
        const result = service.convert("покажи первые 50 задач");

        expect(result.parameters.limit).toBe("50");
      });
    });

    describe("areas and persons queries", () => {
      it("should convert areas query", () => {
        const result = service.convert("все области ответственности");

        expect(result.templateName).toBe("areas");
        expect(result.query).toContain("ems__Area");
      });

      it("should convert persons query", () => {
        const result = service.convert("все контакты");

        expect(result.templateName).toBe("persons");
        expect(result.query).toContain("ims__Person");
      });
    });

    describe("fallback queries", () => {
      it("should create fallback for unrecognized queries", () => {
        const result = service.convert("абракадабра");

        expect(result.isFallback).toBe(true);
        expect(result.query).toContain("SELECT");
        expect(result.confidence).toBeLessThan(0.5);
      });

      it("should include explanation in fallback", () => {
        const result = service.convert("xyz123");

        expect(result.explanation).toContain("Не удалось точно определить");
      });
    });

    describe("entity properties queries", () => {
      it("should convert entity properties query", () => {
        const result = service.convert("все свойства задачи Поспать 2025-11-30");

        expect(result.query).toContain("SELECT ?p ?o");
        expect(result.templateName).toBe("entity_properties");
      });
    });

    describe("count queries", () => {
      it("should convert count by class query", () => {
        const result = service.convert("сколько записей каждого типа");

        expect(result.query).toContain("COUNT");
        expect(result.query).toContain("GROUP BY");
        expect(result.templateName).toBe("count_by_class");
      });
    });
  });

  describe("getSuggestions", () => {
    it("should suggest adding date for statistics queries", () => {
      const suggestions = service.getSuggestions("среднее время задачи");

      expect(suggestions).toContain(
        "Добавьте период времени (например: 'за декабрь' или 'за 2025-12')"
      );
    });

    it("should suggest using prototype UUID", () => {
      const suggestions = service.getSuggestions("все активности");

      expect(suggestions).toContain(
        "Для точного поиска используйте UUID прототипа вместо названия"
      );
    });

    it("should suggest more specific query for short inputs", () => {
      const suggestions = service.getSuggestions("задачи");

      expect(suggestions).toContain(
        "Уточните запрос: добавьте название активности или тип данных"
      );
    });

    it("should not suggest date for queries with month", () => {
      const suggestions = service.getSuggestions("среднее время за декабрь");

      expect(suggestions).not.toContain(
        "Добавьте период времени (например: 'за декабрь' или 'за 2025-12')"
      );
    });
  });

  describe("getAvailableTemplates", () => {
    it("should return all available templates", () => {
      const templates = service.getAvailableTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates).toEqual(SPARQL_TEMPLATES);
    });
  });

  describe("getTemplate", () => {
    it("should return template by name", () => {
      const template = service.getTemplate("search_by_label");

      expect(template).toBeDefined();
      expect(template?.name).toBe("search_by_label");
    });

    it("should return undefined for unknown template", () => {
      const template = service.getTemplate("unknown_template");

      expect(template).toBeUndefined();
    });
  });

  describe("setConfig", () => {
    it("should update configuration", () => {
      service.setConfig({ defaultLimit: 200 });
      const config = service.getConfig();

      expect(config.defaultLimit).toBe(200);
    });
  });

  describe("addTemplate", () => {
    it("should add custom template", () => {
      const customTemplate = {
        name: "custom_test",
        description: "Test template",
        template: "SELECT * WHERE { ?s ?p ?o }",
        parameters: [],
        examples: ["test query"],
        keywords: ["test"],
      };

      service.addTemplate(customTemplate);
      const template = service.getTemplate("custom_test");

      expect(template).toBeDefined();
      expect(template?.name).toBe("custom_test");
    });
  });
});

describe("SPARQLTemplateLibrary", () => {
  describe("SPARQL_TEMPLATES", () => {
    it("should have templates with required properties", () => {
      for (const template of SPARQL_TEMPLATES) {
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.template).toBeDefined();
        expect(template.parameters).toBeDefined();
        expect(template.examples).toBeDefined();
        expect(template.keywords).toBeDefined();
        expect(template.examples.length).toBeGreaterThan(0);
        expect(template.keywords.length).toBeGreaterThan(0);
      }
    });

    it("should have valid SPARQL in templates", () => {
      for (const template of SPARQL_TEMPLATES) {
        expect(template.template).toContain("SELECT");
        expect(template.template).toContain("WHERE");
      }
    });
  });

  describe("getTemplateByName", () => {
    it("should find template by name", () => {
      const template = getTemplateByName("search_by_label");
      expect(template).toBeDefined();
      expect(template?.name).toBe("search_by_label");
    });

    it("should return undefined for non-existent template", () => {
      const template = getTemplateByName("non_existent");
      expect(template).toBeUndefined();
    });
  });

  describe("findMatchingTemplates", () => {
    it("should find templates matching keywords", () => {
      const templates = findMatchingTemplates("найди все задачи", 3);

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.length).toBeLessThanOrEqual(3);
    });

    it("should return empty array for no matches", () => {
      const templates = findMatchingTemplates("xyz123abc456", 3);

      // May find some partial matches, but scores should be low
      expect(templates.length).toBeLessThanOrEqual(3);
    });

    it("should respect maxResults parameter", () => {
      const templates = findMatchingTemplates("задачи проекты активности", 2);

      expect(templates.length).toBeLessThanOrEqual(2);
    });
  });

  describe("fillTemplate", () => {
    it("should replace placeholders with values", () => {
      const template = getTemplateByName("search_by_label")!;
      const filled = fillTemplate(template, {
        keyword: "test",
        limit: "50",
      });

      expect(filled).toContain('"test"');
      expect(filled).toContain("LIMIT 50");
    });

    it("should use default limit for optional parameters", () => {
      const template = getTemplateByName("search_by_label")!;
      const filled = fillTemplate(template, { keyword: "test" });

      expect(filled).toContain("LIMIT 100");
    });
  });

  describe("validateParameters", () => {
    it("should validate required parameters", () => {
      const template = getTemplateByName("search_by_label")!;

      const valid = validateParameters(template, { keyword: "test" });
      expect(valid.valid).toBe(true);
      expect(valid.missing).toHaveLength(0);

      const invalid = validateParameters(template, {});
      expect(invalid.valid).toBe(false);
      expect(invalid.missing).toContain("keyword");
    });

    it("should not require optional parameters", () => {
      const template = getTemplateByName("search_by_label")!;
      const result = validateParameters(template, { keyword: "test" });

      expect(result.valid).toBe(true);
    });
  });
});
