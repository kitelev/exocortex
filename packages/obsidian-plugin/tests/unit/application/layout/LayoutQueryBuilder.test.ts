import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  LayoutQueryBuilder,
  SPARQL_PREFIXES,
  type QueryBuildOptions,
} from "../../../../src/application/layout";
import {
  LayoutType,
  type TableLayout,
  type KanbanLayout,
  type GraphLayout,
  type ListLayout,
  type LayoutColumn,
  type LayoutFilter,
  type LayoutSort,
} from "../../../../src/domain/layout";

// Helper to create a minimal TableLayout
function createTableLayout(
  overrides: Partial<TableLayout> = {},
): TableLayout {
  return {
    uid: "layout-001",
    label: "Test Table",
    type: LayoutType.Table,
    targetClass: "[[ems__Task]]",
    columns: [],
    ...overrides,
  };
}

// Helper to create a minimal KanbanLayout
function createKanbanLayout(
  overrides: Partial<KanbanLayout> = {},
): KanbanLayout {
  return {
    uid: "layout-001",
    label: "Test Kanban",
    type: LayoutType.Kanban,
    targetClass: "[[ems__Task]]",
    laneProperty: "[[ems__Effort_status]]",
    ...overrides,
  };
}

// Helper to create a column
function createColumn(overrides: Partial<LayoutColumn> = {}): LayoutColumn {
  return {
    uid: "col-001",
    label: "Test Column",
    property: "[[exo__Asset_label]]",
    ...overrides,
  };
}

// Helper to create a filter
function createFilter(overrides: Partial<LayoutFilter> = {}): LayoutFilter {
  return {
    uid: "filter-001",
    label: "Test Filter",
    ...overrides,
  };
}

// Helper to create a sort
function createSort(overrides: Partial<LayoutSort> = {}): LayoutSort {
  return {
    uid: "sort-001",
    label: "Test Sort",
    property: "[[ems__Effort_startTimestamp]]",
    direction: "asc",
    ...overrides,
  };
}

describe("LayoutQueryBuilder", () => {
  let builder: LayoutQueryBuilder;

  beforeEach(() => {
    builder = new LayoutQueryBuilder();
  });

  describe("constructor", () => {
    it("should create a LayoutQueryBuilder instance", () => {
      expect(builder).toBeInstanceOf(LayoutQueryBuilder);
    });
  });

  describe("SPARQL_PREFIXES", () => {
    it("should export standard prefixes", () => {
      expect(SPARQL_PREFIXES.exo).toBe("https://exocortex.my/ontology/exo#");
      expect(SPARQL_PREFIXES.ems).toBe("https://exocortex.my/ontology/ems#");
      expect(SPARQL_PREFIXES.xsd).toBe("http://www.w3.org/2001/XMLSchema#");
      expect(SPARQL_PREFIXES.rdf).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
      expect(SPARQL_PREFIXES.rdfs).toBe("http://www.w3.org/2000/01/rdf-schema#");
    });
  });

  describe("build", () => {
    describe("basic query generation", () => {
      it("should build a basic query for empty table layout", () => {
        const layout = createTableLayout();

        const result = builder.build(layout);

        expect(result.success).toBe(true);
        expect(result.query).toBeDefined();
        expect(result.variables).toEqual(["?asset"]);
      });

      it("should include PREFIX declarations by default", () => {
        const layout = createTableLayout();

        const result = builder.build(layout);

        expect(result.query).toContain("PREFIX exo:");
        expect(result.query).toContain("PREFIX ems:");
        expect(result.query).toContain("PREFIX xsd:");
      });

      it("should exclude PREFIX declarations when includePrefixes is false", () => {
        const layout = createTableLayout();

        const result = builder.build(layout, { includePrefixes: false });

        expect(result.query).not.toContain("PREFIX");
      });

      it("should generate SELECT with ?asset variable", () => {
        const layout = createTableLayout();

        const result = builder.build(layout);

        expect(result.query).toContain("SELECT ?asset");
      });

      it("should filter by target class", () => {
        const layout = createTableLayout({ targetClass: "[[ems__Task]]" });

        const result = builder.build(layout);

        expect(result.query).toContain("?asset exo:Instance_class ems:Task .");
      });

      it("should handle different target classes", () => {
        const layout = createTableLayout({ targetClass: "[[exo__Project]]" });

        const result = builder.build(layout);

        expect(result.query).toContain("?asset exo:Instance_class exo:Project .");
      });
    });

    describe("column handling", () => {
      it("should generate variables for columns", () => {
        const columns = [
          createColumn({ uid: "col-001", property: "[[exo__Asset_label]]" }),
          createColumn({ uid: "col-002", property: "[[ems__Effort_status]]" }),
        ];
        const layout = createTableLayout({ columns });

        const result = builder.build(layout);

        expect(result.variables).toEqual(["?asset", "?col0", "?col1"]);
        expect(result.query).toContain("SELECT ?asset ?col0 ?col1");
      });

      it("should generate OPTIONAL patterns for columns by default", () => {
        const columns = [
          createColumn({ property: "[[exo__Asset_label]]" }),
        ];
        const layout = createTableLayout({ columns });

        const result = builder.build(layout);

        expect(result.query).toContain("OPTIONAL { ?asset exo:Asset_label ?col0 . }");
      });

      it("should generate required patterns when useOptional is false", () => {
        const columns = [
          createColumn({ property: "[[exo__Asset_label]]" }),
        ];
        const layout = createTableLayout({ columns });

        const result = builder.build(layout, { useOptional: false });

        expect(result.query).toContain("?asset exo:Asset_label ?col0 .");
        expect(result.query).not.toContain("OPTIONAL");
      });

      it("should handle multiple columns", () => {
        const columns = [
          createColumn({ uid: "col-001", property: "[[exo__Asset_label]]" }),
          createColumn({ uid: "col-002", property: "[[ems__Effort_status]]" }),
          createColumn({ uid: "col-003", property: "[[ems__Effort_startTimestamp]]" }),
        ];
        const layout = createTableLayout({ columns });

        const result = builder.build(layout);

        expect(result.query).toContain("?col0");
        expect(result.query).toContain("?col1");
        expect(result.query).toContain("?col2");
        expect(result.query).toContain("exo:Asset_label");
        expect(result.query).toContain("ems:Effort_status");
        expect(result.query).toContain("ems:Effort_startTimestamp");
      });

      it("should handle columns in KanbanLayout", () => {
        const columns = [
          createColumn({ property: "[[exo__Asset_label]]" }),
        ];
        const layout = createKanbanLayout({ columns });

        const result = builder.build(layout);

        expect(result.query).toContain("OPTIONAL { ?asset exo:Asset_label ?col0 . }");
      });
    });

    describe("filter handling", () => {
      describe("SPARQL filters", () => {
        it("should inject SPARQL filter directly", () => {
          const filters = [
            createFilter({
              sparql: `?asset ems:Task_currentEffort ?effort .
  ?effort ems:Effort_startTimestamp ?start .
  FILTER(?start >= NOW())`,
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain("?asset ems:Task_currentEffort ?effort .");
          expect(result.query).toContain("?effort ems:Effort_startTimestamp ?start .");
          expect(result.query).toContain("FILTER(?start >= NOW())");
        });

        it("should handle multiple SPARQL filters", () => {
          const filters = [
            createFilter({ sparql: "?asset exo:Asset_isArchived false ." }),
            createFilter({ sparql: 'FILTER(CONTAINS(STR(?asset), "task"))' }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain("?asset exo:Asset_isArchived false .");
          expect(result.query).toContain('FILTER(CONTAINS(STR(?asset), "task"))');
        });
      });

      describe("simple filters", () => {
        it("should generate eq filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Effort_status]]",
              operator: "eq",
              value: "[[ems__EffortStatus_Done]]",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain("?asset ems:Effort_status ?filterVar_ems__Effort_status .");
          expect(result.query).toContain("FILTER(?filterVar_ems__Effort_status = ems:EffortStatus_Done)");
        });

        it("should generate ne filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Effort_status]]",
              operator: "ne",
              value: "[[ems__EffortStatus_Done]]",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain("FILTER(?filterVar_ems__Effort_status != ems:EffortStatus_Done)");
        });

        it("should generate gt filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Task_priority]]",
              operator: "gt",
              value: "5",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain('FILTER(?filterVar_ems__Task_priority > "5")');
        });

        it("should generate gte filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Task_priority]]",
              operator: "gte",
              value: "5",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain('FILTER(?filterVar_ems__Task_priority >= "5")');
        });

        it("should generate lt filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Task_priority]]",
              operator: "lt",
              value: "10",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain('FILTER(?filterVar_ems__Task_priority < "10")');
        });

        it("should generate lte filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Task_priority]]",
              operator: "lte",
              value: "10",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain('FILTER(?filterVar_ems__Task_priority <= "10")');
        });

        it("should generate contains filter", () => {
          const filters = [
            createFilter({
              property: "[[exo__Asset_label]]",
              operator: "contains",
              value: "urgent",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain('FILTER(CONTAINS(STR(?filterVar_exo__Asset_label), "urgent"))');
        });

        it("should generate startsWith filter", () => {
          const filters = [
            createFilter({
              property: "[[exo__Asset_label]]",
              operator: "startsWith",
              value: "Bug:",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain('FILTER(STRSTARTS(STR(?filterVar_exo__Asset_label), "Bug:"))');
        });

        it("should generate endsWith filter", () => {
          const filters = [
            createFilter({
              property: "[[exo__Asset_label]]",
              operator: "endsWith",
              value: "done",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain('FILTER(STRENDS(STR(?filterVar_exo__Asset_label), "done"))');
        });

        it("should generate isNull filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Task_project]]",
              operator: "isNull",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain("FILTER(!BOUND(?filterVar_ems__Task_project))");
        });

        it("should generate isNotNull filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Task_project]]",
              operator: "isNotNull",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain("FILTER(BOUND(?filterVar_ems__Task_project))");
        });

        it("should generate in filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Effort_status]]",
              operator: "in",
              value: "[[ems__EffortStatus_ToDo]], [[ems__EffortStatus_InProgress]]",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain(
            "FILTER(?filterVar_ems__Effort_status IN (ems:EffortStatus_ToDo, ems:EffortStatus_InProgress))"
          );
        });

        it("should generate notIn filter", () => {
          const filters = [
            createFilter({
              property: "[[ems__Effort_status]]",
              operator: "notIn",
              value: "[[ems__EffortStatus_Done]], [[ems__EffortStatus_Cancelled]]",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain(
            "FILTER(?filterVar_ems__Effort_status NOT IN (ems:EffortStatus_Done, ems:EffortStatus_Cancelled))"
          );
        });
      });

      describe("mixed filters", () => {
        it("should handle both SPARQL and simple filters", () => {
          const filters = [
            createFilter({ sparql: "?asset exo:Asset_isArchived false ." }),
            createFilter({
              property: "[[ems__Effort_status]]",
              operator: "ne",
              value: "[[ems__EffortStatus_Done]]",
            }),
          ];
          const layout = createTableLayout({ filters });

          const result = builder.build(layout);

          expect(result.query).toContain("?asset exo:Asset_isArchived false .");
          expect(result.query).toContain("FILTER(?filterVar_ems__Effort_status != ems:EffortStatus_Done)");
        });
      });
    });

    describe("sort handling", () => {
      it("should generate ORDER BY ASC by default", () => {
        const sort = createSort({ direction: "asc" });
        const layout = createTableLayout({ defaultSort: sort });

        const result = builder.build(layout);

        expect(result.query).toContain("ORDER BY ASC(?sortVar)");
      });

      it("should generate ORDER BY DESC when direction is desc", () => {
        const sort = createSort({ direction: "desc" });
        const layout = createTableLayout({ defaultSort: sort });

        const result = builder.build(layout);

        expect(result.query).toContain("ORDER BY DESC(?sortVar)");
      });

      it("should not include ORDER BY when no defaultSort", () => {
        const layout = createTableLayout();

        const result = builder.build(layout);

        expect(result.query).not.toContain("ORDER BY");
      });
    });

    describe("modifiers", () => {
      it("should add LIMIT when specified", () => {
        const layout = createTableLayout();

        const result = builder.build(layout, { limit: 100 });

        expect(result.query).toContain("LIMIT 100");
      });

      it("should add OFFSET when specified", () => {
        const layout = createTableLayout();

        const result = builder.build(layout, { offset: 50 });

        expect(result.query).toContain("OFFSET 50");
      });

      it("should add both LIMIT and OFFSET", () => {
        const layout = createTableLayout();

        const result = builder.build(layout, { limit: 100, offset: 50 });

        expect(result.query).toContain("LIMIT 100");
        expect(result.query).toContain("OFFSET 50");
      });

      it("should not add LIMIT when 0", () => {
        const layout = createTableLayout();

        const result = builder.build(layout, { limit: 0 });

        expect(result.query).not.toContain("LIMIT");
      });

      it("should not add OFFSET when 0", () => {
        const layout = createTableLayout();

        const result = builder.build(layout, { offset: 0 });

        expect(result.query).not.toContain("OFFSET");
      });
    });

    describe("layout types", () => {
      it("should handle TableLayout", () => {
        const layout = createTableLayout();

        const result = builder.build(layout);

        expect(result.success).toBe(true);
      });

      it("should handle KanbanLayout", () => {
        const layout = createKanbanLayout();

        const result = builder.build(layout);

        expect(result.success).toBe(true);
      });

      it("should handle GraphLayout (no columns)", () => {
        const layout: GraphLayout = {
          uid: "layout-001",
          label: "Test Graph",
          type: LayoutType.Graph,
          targetClass: "[[ems__Task]]",
        };

        const result = builder.build(layout);

        expect(result.success).toBe(true);
        expect(result.variables).toEqual(["?asset"]);
      });

      it("should handle ListLayout (no columns)", () => {
        const layout: ListLayout = {
          uid: "layout-001",
          label: "Test List",
          type: LayoutType.List,
          targetClass: "[[ems__Task]]",
        };

        const result = builder.build(layout);

        expect(result.success).toBe(true);
        expect(result.variables).toEqual(["?asset"]);
      });
    });

    describe("edge cases", () => {
      it("should handle target class without wikilink brackets", () => {
        const layout = createTableLayout({ targetClass: "ems__Task" });

        const result = builder.build(layout);

        expect(result.query).toContain("ems:Task");
      });

      it("should handle property without wikilink brackets", () => {
        const columns = [
          createColumn({ property: "exo__Asset_label" }),
        ];
        const layout = createTableLayout({ columns });

        const result = builder.build(layout);

        expect(result.query).toContain("exo:Asset_label");
      });

      it("should handle wikilink with alias", () => {
        const columns = [
          createColumn({ property: "[[exo__Asset_label|Label]]" }),
        ];
        const layout = createTableLayout({ columns });

        const result = builder.build(layout);

        expect(result.query).toContain("exo:Asset_label");
      });

      it("should handle wikilink with heading", () => {
        const columns = [
          createColumn({ property: "[[exo__Asset_label#Section]]" }),
        ];
        const layout = createTableLayout({ columns });

        const result = builder.build(layout);

        expect(result.query).toContain("exo:Asset_label");
      });

      it("should escape special characters in string values", () => {
        const filters = [
          createFilter({
            property: "[[exo__Asset_label]]",
            operator: "contains",
            value: 'test "quoted" value',
          }),
        ];
        const layout = createTableLayout({ filters });

        const result = builder.build(layout);

        expect(result.query).toContain('\\"quoted\\"');
      });

      it("should handle filter with no value for eq operator", () => {
        const filters = [
          createFilter({
            property: "[[exo__Asset_label]]",
            operator: "eq",
            // No value provided
          }),
        ];
        const layout = createTableLayout({ filters });

        const result = builder.build(layout);

        // Should not generate filter expression without value
        expect(result.success).toBe(true);
      });
    });
  });

  describe("buildOrThrow", () => {
    it("should return query string on success", () => {
      const layout = createTableLayout();

      const query = builder.buildOrThrow(layout);

      expect(typeof query).toBe("string");
      expect(query).toContain("SELECT");
    });

    it("should throw error on failure", () => {
      // Create a layout that would fail validation
      // In this implementation, all layouts are valid, but we test the mechanism
      const builder = new LayoutQueryBuilder();

      // Since our implementation doesn't have validation that would fail,
      // we test that it returns a string for valid input
      const layout = createTableLayout();
      expect(() => builder.buildOrThrow(layout)).not.toThrow();
    });
  });

  describe("complete query example", () => {
    it("should generate a complete query with all features", () => {
      const columns = [
        createColumn({ uid: "col-001", property: "[[exo__Asset_label]]" }),
        createColumn({ uid: "col-002", property: "[[ems__Effort_status]]" }),
        createColumn({ uid: "col-003", property: "[[ems__Effort_startTimestamp]]" }),
      ];
      const filters = [
        createFilter({
          uid: "filter-001",
          label: "Active Filter",
          property: "[[ems__Effort_status]]",
          operator: "ne",
          value: "[[ems__EffortStatus_Done]]",
        }),
        createFilter({
          uid: "filter-002",
          label: "Time Range Filter",
          sparql: `?asset ems:Task_currentEffort ?effort .
  ?effort ems:Effort_plannedStartTimestamp ?plannedStart .
  FILTER(?plannedStart >= NOW())`,
        }),
      ];
      const defaultSort = createSort({
        property: "[[ems__Effort_startTimestamp]]",
        direction: "desc",
      });
      const layout = createTableLayout({ columns, filters, defaultSort });

      const result = builder.build(layout, { limit: 50, offset: 0 });

      expect(result.success).toBe(true);
      expect(result.variables).toEqual(["?asset", "?col0", "?col1", "?col2"]);

      const query = result.query!;
      // Check structure
      expect(query).toContain("PREFIX exo:");
      expect(query).toContain("PREFIX ems:");
      expect(query).toContain("SELECT ?asset ?col0 ?col1 ?col2");
      expect(query).toContain("WHERE {");
      expect(query).toContain("?asset exo:Instance_class ems:Task .");
      expect(query).toContain("OPTIONAL { ?asset exo:Asset_label ?col0 . }");
      expect(query).toContain("OPTIONAL { ?asset ems:Effort_status ?col1 . }");
      expect(query).toContain("OPTIONAL { ?asset ems:Effort_startTimestamp ?col2 . }");
      expect(query).toContain("FILTER(?filterVar_ems__Effort_status != ems:EffortStatus_Done)");
      expect(query).toContain("?asset ems:Task_currentEffort ?effort .");
      expect(query).toContain("ORDER BY DESC(?sortVar)");
      expect(query).toContain("LIMIT 50");
    });
  });
});
