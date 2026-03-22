import {
  LayoutSection,
  PropertyDependencyResolver,
} from "../../src/application/services/PropertyDependencyResolver";

describe("PropertyDependencyResolver", () => {
  let resolver: PropertyDependencyResolver;

  beforeEach(() => {
    resolver = new PropertyDependencyResolver();
  });

  describe("Core properties (exo__)", () => {
    it("should map exo__Asset_label to Relations + Area Tree", () => {
      const sections = resolver.getAffectedSections(["exo__Asset_label"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toContain(LayoutSection.AREA_TREE);
      expect(sections).toHaveLength(2);
    });

    it("should map exo__Instance_class to Buttons + Relations", () => {
      const sections = resolver.getAffectedSections(["exo__Instance_class"]);

      expect(sections).toContain(LayoutSection.BUTTONS);
      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(2);
    });

    it("should map exo__Asset_isArchived to Buttons + Daily Tasks + Relations", () => {
      const sections = resolver.getAffectedSections(["exo__Asset_isArchived"]);

      expect(sections).toContain(LayoutSection.BUTTONS);
      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(3);
    });

    it("should map exo__Asset_prototype to Relations", () => {
      const sections = resolver.getAffectedSections(["exo__Asset_prototype"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });
  });

  describe("Effort properties (ems__Effort_)", () => {
    it("should map ems__Effort_status to Buttons + Daily Tasks", () => {
      const sections = resolver.getAffectedSections(["ems__Effort_status"]);

      expect(sections).toContain(LayoutSection.BUTTONS);
      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toHaveLength(2);
    });

    it("should map ems__Effort_votes to Daily Tasks", () => {
      const sections = resolver.getAffectedSections(["ems__Effort_votes"]);

      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toHaveLength(1);
    });

    it("should map ems__Effort_day to Daily Tasks", () => {
      const sections = resolver.getAffectedSections(["ems__Effort_day"]);

      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toHaveLength(1);
    });

    it("should map ems__Effort_area to Daily Tasks", () => {
      const sections = resolver.getAffectedSections(["ems__Effort_area"]);

      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toHaveLength(1);
    });

    it("should map ems__Effort_parent to Relations", () => {
      const sections = resolver.getAffectedSections(["ems__Effort_parent"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });
  });

  describe("Area properties (ems__Area_)", () => {
    it("should map ems__Area_parent to Area Tree", () => {
      const sections = resolver.getAffectedSections(["ems__Area_parent"]);

      expect(sections).toContain(LayoutSection.AREA_TREE);
      expect(sections).toHaveLength(1);
    });
  });

  describe("Task properties (ems__Task_)", () => {
    it("should map ems__Task_size to Daily Tasks", () => {
      const sections = resolver.getAffectedSections(["ems__Task_size"]);

      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toHaveLength(1);
    });

    it("should map ems__Task_blockedBy to Daily Tasks + Relations", () => {
      const sections = resolver.getAffectedSections(["ems__Task_blockedBy"]);

      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(2);
    });

    it("should map ems__Task_blocks to Relations", () => {
      const sections = resolver.getAffectedSections(["ems__Task_blocks"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });
  });

  describe("Project properties (ems__Project_)", () => {
    it("should map ems__Project_blockedBy to Relations", () => {
      const sections = resolver.getAffectedSections([
        "ems__Project_blockedBy",
      ]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });

    it("should map ems__Project_blocks to Relations", () => {
      const sections = resolver.getAffectedSections(["ems__Project_blocks"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });
  });

  describe("Daily Note properties (pn__DailyNote_)", () => {
    it("should map pn__DailyNote_day to Daily Tasks", () => {
      const sections = resolver.getAffectedSections(["pn__DailyNote_day"]);

      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toHaveLength(1);
    });
  });

  describe("Concept properties (ims__Concept_)", () => {
    it("should map ims__Concept_broader to Relations", () => {
      const sections = resolver.getAffectedSections(["ims__Concept_broader"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });

    it("should map ims__Concept_narrower to Relations", () => {
      const sections = resolver.getAffectedSections(["ims__Concept_narrower"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });

    it("should map ims__Concept_related to Relations", () => {
      const sections = resolver.getAffectedSections(["ims__Concept_related"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(1);
    });
  });

  describe("Obsidian standard properties", () => {
    it("should map aliases to Relations + Area Tree", () => {
      const sections = resolver.getAffectedSections(["aliases"]);

      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toContain(LayoutSection.AREA_TREE);
      expect(sections).toHaveLength(2);
    });
  });

  describe("Unknown properties", () => {
    it("should return empty array for unknown property", () => {
      const sections = resolver.getAffectedSections([
        "custom__Unknown_property",
      ]);

      expect(sections).toHaveLength(0);
    });
  });

  describe("Multiple properties", () => {
    it("should return union of affected sections for multiple properties", () => {
      const sections = resolver.getAffectedSections([
        "ems__Effort_votes",
        "ems__Effort_status",
      ]);

      expect(sections).toContain(LayoutSection.BUTTONS);
      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toHaveLength(2);
    });

    it("should deduplicate sections when multiple properties affect same section", () => {
      const sections = resolver.getAffectedSections([
        "exo__Asset_label",
        "exo__Instance_class",
      ]);

      expect(sections).toContain(LayoutSection.BUTTONS);
      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toContain(LayoutSection.AREA_TREE);
      expect(sections).toHaveLength(3);
    });

    it("should handle bulk property changes efficiently", () => {
      const sections = resolver.getAffectedSections([
        "exo__Asset_label",
        "ems__Effort_status",
        "ems__Effort_votes",
        "ems__Area_parent",
        "aliases",
      ]);

      expect(sections).toContain(LayoutSection.BUTTONS);
      expect(sections).toContain(LayoutSection.DAILY_TASKS);
      expect(sections).toContain(LayoutSection.AREA_TREE);
      expect(sections).toContain(LayoutSection.RELATIONS);
      expect(sections).toHaveLength(4);
    });
  });

  describe("Empty input", () => {
    it("should return empty array when no properties changed", () => {
      const sections = resolver.getAffectedSections([]);

      expect(sections).toEqual([]);
    });
  });
});
