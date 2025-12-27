/**
 * Tests for SPARQLTemplateLibrary
 *
 * These tests verify the SPARQL template matching, filling, and validation
 * functionality used by the NLToSPARQLService.
 */

import {
  SPARQL_TEMPLATES,
  SPARQL_PREFIXES,
  PREDICATES,
  ASSET_CLASSES,
  EFFORT_STATUSES,
  KNOWN_PROTOTYPES,
  getTemplateByName,
  findMatchingTemplates,
  fillTemplate,
  validateParameters,
  type SPARQLTemplate,
} from "../../src/services/SPARQLTemplateLibrary";

describe("SPARQLTemplateLibrary", () => {
  describe("Constants", () => {
    describe("SPARQL_PREFIXES", () => {
      it("should contain exo prefix", () => {
        expect(SPARQL_PREFIXES).toContain("PREFIX exo:");
        expect(SPARQL_PREFIXES).toContain("https://exocortex.my/ontology/exo#");
      });

      it("should contain ems prefix", () => {
        expect(SPARQL_PREFIXES).toContain("PREFIX ems:");
        expect(SPARQL_PREFIXES).toContain("https://exocortex.my/ontology/ems#");
      });

      it("should contain xsd prefix for datatypes", () => {
        expect(SPARQL_PREFIXES).toContain("PREFIX xsd:");
        expect(SPARQL_PREFIXES).toContain("http://www.w3.org/2001/XMLSchema#");
      });
    });

    describe("PREDICATES", () => {
      it("should have core predicates", () => {
        expect(PREDICATES.ASSET_LABEL).toBe("exo:Asset_label");
        expect(PREDICATES.ASSET_UID).toBe("exo:Asset_uid");
        expect(PREDICATES.ASSET_PROTOTYPE).toBe("exo:Asset_prototype");
        expect(PREDICATES.INSTANCE_CLASS).toBe("exo:Instance_class");
      });

      it("should have effort predicates", () => {
        expect(PREDICATES.EFFORT_START_TIMESTAMP).toBe("ems:Effort_startTimestamp");
        expect(PREDICATES.EFFORT_END_TIMESTAMP).toBe("ems:Effort_endTimestamp");
        expect(PREDICATES.EFFORT_STATUS).toBe("ems:Effort_status");
        expect(PREDICATES.EFFORT_PARENT).toBe("ems:Effort_parent");
      });
    });

    describe("ASSET_CLASSES", () => {
      it("should have all common classes", () => {
        expect(ASSET_CLASSES.TASK).toBe("ems__Task");
        expect(ASSET_CLASSES.PROJECT).toBe("ems__Project");
        expect(ASSET_CLASSES.AREA).toBe("ems__Area");
        expect(ASSET_CLASSES.PERSON).toBe("ims__Person");
      });
    });

    describe("EFFORT_STATUSES", () => {
      it("should have standard status values", () => {
        expect(EFFORT_STATUSES.DOING).toBe("ems:EffortStatusDoing");
        expect(EFFORT_STATUSES.DONE).toBe("ems:EffortStatusDone");
        expect(EFFORT_STATUSES.BACKLOG).toBe("ems:EffortStatusBacklog");
      });
    });

    describe("KNOWN_PROTOTYPES", () => {
      it("should have known prototype UUIDs", () => {
        expect(KNOWN_PROTOTYPES.MORNING_SHOWER).toBe("2d369bb0-159f-4639-911d-ec2c585e8d00");
        expect(KNOWN_PROTOTYPES.CUT_NAILS).toBe("1d7b739c-0e3e-46f2-ba88-e66f30b732f9");
      });
    });
  });

  describe("SPARQL_TEMPLATES", () => {
    it("should have multiple templates defined", () => {
      expect(SPARQL_TEMPLATES.length).toBeGreaterThan(0);
    });

    it("should have all required properties on each template", () => {
      for (const template of SPARQL_TEMPLATES) {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.template).toBeTruthy();
        expect(Array.isArray(template.parameters)).toBe(true);
        expect(Array.isArray(template.examples)).toBe(true);
        expect(Array.isArray(template.keywords)).toBe(true);
      }
    });

    it("should have unique names for all templates", () => {
      const names = SPARQL_TEMPLATES.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe("getTemplateByName", () => {
    it("should find template by name", () => {
      const template = getTemplateByName("search_by_label");
      expect(template).toBeDefined();
      expect(template?.name).toBe("search_by_label");
    });

    it("should return undefined for non-existent template", () => {
      const template = getTemplateByName("non_existent_template");
      expect(template).toBeUndefined();
    });

    it("should find all known templates", () => {
      const knownTemplates = [
        "search_by_label",
        "find_by_prototype_uuid",
        "average_duration_by_prototype",
        "sleep_analysis",
        "active_projects",
        "projects_without_tasks",
        "recent_activities",
        "tasks_by_label_pattern",
        "count_by_class",
        "find_prototype",
        "entity_properties",
        "properties_by_uuid",
        "areas",
        "persons",
      ];

      for (const name of knownTemplates) {
        const template = getTemplateByName(name);
        expect(template).toBeDefined();
        expect(template?.name).toBe(name);
      }
    });
  });

  describe("findMatchingTemplates", () => {
    it("should find templates matching search keywords", () => {
      const matches = findMatchingTemplates("найди все задачи");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].name).toBe("search_by_label");
    });

    it("should find templates for sleep analysis", () => {
      const matches = findMatchingTemplates("анализ сна за декабрь");
      expect(matches.length).toBeGreaterThan(0);
      // Should match sleep_analysis template
      const hasSleeTemplate = matches.some((t) => t.name === "sleep_analysis");
      expect(hasSleeTemplate).toBe(true);
    });

    it("should find templates for project queries", () => {
      const matches = findMatchingTemplates("активные проекты");
      expect(matches.length).toBeGreaterThan(0);
      const hasActiveProjects = matches.some((t) => t.name === "active_projects");
      expect(hasActiveProjects).toBe(true);
    });

    it("should find templates for average duration", () => {
      const matches = findMatchingTemplates("среднее время");
      expect(matches.length).toBeGreaterThan(0);
      const hasAverageDuration = matches.some((t) => t.name === "average_duration_by_prototype");
      expect(hasAverageDuration).toBe(true);
    });

    it("should limit results to maxResults", () => {
      const matches = findMatchingTemplates("найди", 1);
      expect(matches.length).toBeLessThanOrEqual(1);
    });

    it("should return empty array for unrelated query", () => {
      const matches = findMatchingTemplates("xyzzy12345nonexistent");
      expect(matches.length).toBe(0);
    });

    it("should handle case-insensitive matching", () => {
      const matchesLower = findMatchingTemplates("найди");
      const matchesUpper = findMatchingTemplates("НАЙДИ");
      expect(matchesLower.length).toBe(matchesUpper.length);
    });
  });

  describe("fillTemplate", () => {
    it("should fill keyword parameter", () => {
      const template = getTemplateByName("search_by_label")!;
      const filled = fillTemplate(template, { keyword: "Поспать" });
      expect(filled).toContain('CONTAINS(?label, "Поспать")');
    });

    it("should fill limit parameter", () => {
      const template = getTemplateByName("search_by_label")!;
      const filled = fillTemplate(template, { keyword: "test", limit: "50" });
      expect(filled).toContain("LIMIT 50");
    });

    it("should use default limit when not provided", () => {
      const template = getTemplateByName("search_by_label")!;
      const filled = fillTemplate(template, { keyword: "test" });
      expect(filled).toContain("LIMIT 100");
    });

    it("should fill prototype UUID parameter", () => {
      const template = getTemplateByName("find_by_prototype_uuid")!;
      const filled = fillTemplate(template, { prototypeUuid: "2d369bb0" });
      expect(filled).toContain('CONTAINS(STR(?proto), "2d369bb0")');
    });

    it("should fill multiple parameters", () => {
      const template = getTemplateByName("sleep_analysis")!;
      const filled = fillTemplate(template, { yearMonth: "2025-12" });
      expect(filled).toContain('STRSTARTS(?label, "Поспать 2025-12")');
    });

    it("should preserve SPARQL prefixes", () => {
      const template = getTemplateByName("search_by_label")!;
      const filled = fillTemplate(template, { keyword: "test" });
      expect(filled).toContain("PREFIX exo:");
      expect(filled).toContain("PREFIX ems:");
    });
  });

  describe("validateParameters", () => {
    it("should return valid for complete parameters", () => {
      const template = getTemplateByName("search_by_label")!;
      const result = validateParameters(template, { keyword: "test" });
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("should return invalid for missing required parameter", () => {
      const template = getTemplateByName("search_by_label")!;
      const result = validateParameters(template, {});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("keyword");
    });

    it("should not require optional parameters", () => {
      const template = getTemplateByName("search_by_label")!;
      const result = validateParameters(template, { keyword: "test" });
      expect(result.valid).toBe(true);
      // limit is optional
    });

    it("should return valid for template without parameters", () => {
      const template = getTemplateByName("active_projects")!;
      const result = validateParameters(template, {});
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("should report all missing required parameters", () => {
      const template = getTemplateByName("find_by_prototype_uuid")!;
      const result = validateParameters(template, {});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("prototypeUuid");
    });
  });

  describe("Template Examples", () => {
    it("search_by_label template should produce valid SPARQL", () => {
      const template = getTemplateByName("search_by_label")!;
      const filled = fillTemplate(template, { keyword: "душ", limit: "10" });

      expect(filled).toContain("SELECT ?s ?label");
      expect(filled).toContain("exo:Asset_label");
      expect(filled).toContain("FILTER");
      expect(filled).toContain("ORDER BY");
      expect(filled).toContain("LIMIT 10");
    });

    it("average_duration_by_prototype template should include aggregation", () => {
      const template = getTemplateByName("average_duration_by_prototype")!;
      const filled = fillTemplate(template, { prototypeUuid: "test-uuid" });

      expect(filled).toContain("AVG(?durationMin)");
      expect(filled).toContain("COUNT(?s)");
      expect(filled).toContain("MIN(?durationMin)");
      expect(filled).toContain("MAX(?durationMin)");
      expect(filled).toContain("SUM(?durationMin)");
      expect(filled).toContain("exo:dateDiffMinutes");
    });

    it("projects_without_tasks template should use FILTER NOT EXISTS", () => {
      const template = getTemplateByName("projects_without_tasks")!;
      const filled = fillTemplate(template, {});

      expect(filled).toContain("FILTER NOT EXISTS");
      expect(filled).toContain("ems:Effort_parent");
    });
  });
});
