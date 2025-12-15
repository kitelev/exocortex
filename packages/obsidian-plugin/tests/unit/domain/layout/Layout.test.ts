import { describe, it, expect } from "@jest/globals";
import {
  LayoutType,
  getLayoutTypeFromInstanceClass,
  isLayoutFrontmatter,
  createBaseLayoutFromFrontmatter,
  isTableLayout,
  isKanbanLayout,
  isGraphLayout,
  isCalendarLayout,
  isListLayout,
  isValidCalendarView,
  type Layout,
  type TableLayout,
  type KanbanLayout,
  type GraphLayout,
  type CalendarLayout,
  type ListLayout,
  type BaseLayout,
} from "../../../../src/domain/layout/Layout";

describe("Layout", () => {
  describe("LayoutType enum", () => {
    it("should have correct values", () => {
      expect(LayoutType.Table).toBe("exo__TableLayout");
      expect(LayoutType.Kanban).toBe("exo__KanbanLayout");
      expect(LayoutType.Graph).toBe("exo__GraphLayout");
      expect(LayoutType.Calendar).toBe("exo__CalendarLayout");
      expect(LayoutType.List).toBe("exo__ListLayout");
    });
  });

  describe("getLayoutTypeFromInstanceClass", () => {
    it("should return Table for exo__TableLayout wikilink", () => {
      expect(getLayoutTypeFromInstanceClass("[[exo__TableLayout]]")).toBe(
        LayoutType.Table,
      );
    });

    it("should return Kanban for exo__KanbanLayout wikilink", () => {
      expect(getLayoutTypeFromInstanceClass("[[exo__KanbanLayout]]")).toBe(
        LayoutType.Kanban,
      );
    });

    it("should return Graph for exo__GraphLayout wikilink", () => {
      expect(getLayoutTypeFromInstanceClass("[[exo__GraphLayout]]")).toBe(
        LayoutType.Graph,
      );
    });

    it("should return Calendar for exo__CalendarLayout wikilink", () => {
      expect(getLayoutTypeFromInstanceClass("[[exo__CalendarLayout]]")).toBe(
        LayoutType.Calendar,
      );
    });

    it("should return List for exo__ListLayout wikilink", () => {
      expect(getLayoutTypeFromInstanceClass("[[exo__ListLayout]]")).toBe(
        LayoutType.List,
      );
    });

    it("should return layout type from array of instance classes", () => {
      expect(
        getLayoutTypeFromInstanceClass(["[[exo__Asset]]", "[[exo__TableLayout]]"]),
      ).toBe(LayoutType.Table);
    });

    it("should return first matching layout type from array", () => {
      expect(
        getLayoutTypeFromInstanceClass([
          "[[exo__TableLayout]]",
          "[[exo__KanbanLayout]]",
        ]),
      ).toBe(LayoutType.Table);
    });

    it("should return layout type from plain string (no wikilink)", () => {
      expect(getLayoutTypeFromInstanceClass("exo__TableLayout")).toBe(
        LayoutType.Table,
      );
    });

    it("should return null for non-layout class", () => {
      expect(getLayoutTypeFromInstanceClass("[[ems__Task]]")).toBeNull();
      expect(getLayoutTypeFromInstanceClass("[[exo__Asset]]")).toBeNull();
    });

    it("should return null for invalid input", () => {
      expect(getLayoutTypeFromInstanceClass(null)).toBeNull();
      expect(getLayoutTypeFromInstanceClass(undefined)).toBeNull();
      expect(getLayoutTypeFromInstanceClass(123)).toBeNull();
      expect(getLayoutTypeFromInstanceClass({})).toBeNull();
    });

    it("should return null for empty array", () => {
      expect(getLayoutTypeFromInstanceClass([])).toBeNull();
    });
  });

  describe("isLayoutFrontmatter", () => {
    it("should return true for valid layout frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: "[[exo__TableLayout]]",
      };

      expect(isLayoutFrontmatter(frontmatter)).toBe(true);
    });

    it("should return true for layout frontmatter with array class", () => {
      const frontmatter = {
        exo__Instance_class: ["[[exo__Asset]]", "[[exo__KanbanLayout]]"],
      };

      expect(isLayoutFrontmatter(frontmatter)).toBe(true);
    });

    it("should return false for non-layout frontmatter", () => {
      const frontmatter = {
        exo__Instance_class: "[[ems__Task]]",
      };

      expect(isLayoutFrontmatter(frontmatter)).toBe(false);
    });

    it("should return false for frontmatter without instance class", () => {
      const frontmatter = {
        exo__Asset_label: "Some Asset",
      };

      expect(isLayoutFrontmatter(frontmatter)).toBe(false);
    });
  });

  describe("createBaseLayoutFromFrontmatter", () => {
    it("should create a BaseLayout from valid frontmatter", () => {
      const frontmatter = {
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Daily Tasks Layout",
        exo__Asset_description: "Table of daily tasks",
        exo__Instance_class: "[[exo__TableLayout]]",
        exo__Layout_targetClass: "[[ems__Task]]",
      };

      const result = createBaseLayoutFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.uid).toBe("layout-001");
      expect(result!.label).toBe("Daily Tasks Layout");
      expect(result!.description).toBe("Table of daily tasks");
      expect(result!.type).toBe(LayoutType.Table);
      expect(result!.targetClass).toBe("[[ems__Task]]");
    });

    it("should return null when uid is missing", () => {
      const frontmatter = {
        exo__Asset_label: "Daily Tasks Layout",
        exo__Instance_class: "[[exo__TableLayout]]",
        exo__Layout_targetClass: "[[ems__Task]]",
      };

      const result = createBaseLayoutFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when label is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "layout-001",
        exo__Instance_class: "[[exo__TableLayout]]",
        exo__Layout_targetClass: "[[ems__Task]]",
      };

      const result = createBaseLayoutFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when instance class is not a layout type", () => {
      const frontmatter = {
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Not a Layout",
        exo__Instance_class: "[[ems__Task]]",
        exo__Layout_targetClass: "[[ems__Task]]",
      };

      const result = createBaseLayoutFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should return null when targetClass is missing", () => {
      const frontmatter = {
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Daily Tasks Layout",
        exo__Instance_class: "[[exo__TableLayout]]",
      };

      const result = createBaseLayoutFromFrontmatter(frontmatter);

      expect(result).toBeNull();
    });

    it("should handle description being undefined", () => {
      const frontmatter = {
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Daily Tasks Layout",
        exo__Instance_class: "[[exo__TableLayout]]",
        exo__Layout_targetClass: "[[ems__Task]]",
      };

      const result = createBaseLayoutFromFrontmatter(frontmatter);

      expect(result).not.toBeNull();
      expect(result!.description).toBeUndefined();
    });

    it("should create BaseLayout for all layout types", () => {
      const layoutTypes = [
        { class: "[[exo__TableLayout]]", expected: LayoutType.Table },
        { class: "[[exo__KanbanLayout]]", expected: LayoutType.Kanban },
        { class: "[[exo__GraphLayout]]", expected: LayoutType.Graph },
        { class: "[[exo__CalendarLayout]]", expected: LayoutType.Calendar },
        { class: "[[exo__ListLayout]]", expected: LayoutType.List },
      ];

      for (const { class: cls, expected } of layoutTypes) {
        const frontmatter = {
          exo__Asset_uid: `layout-${expected}`,
          exo__Asset_label: `${expected} Layout`,
          exo__Instance_class: cls,
          exo__Layout_targetClass: "[[ems__Task]]",
        };

        const result = createBaseLayoutFromFrontmatter(frontmatter);
        expect(result).not.toBeNull();
        expect(result!.type).toBe(expected);
      }
    });
  });

  describe("type guards", () => {
    const tableLayout: TableLayout = {
      uid: "table-001",
      label: "Table Layout",
      type: LayoutType.Table,
      targetClass: "[[ems__Task]]",
      columns: [],
    };

    const kanbanLayout: KanbanLayout = {
      uid: "kanban-001",
      label: "Kanban Layout",
      type: LayoutType.Kanban,
      targetClass: "[[ems__Task]]",
      laneProperty: "[[ems__Effort_status]]",
    };

    const graphLayout: GraphLayout = {
      uid: "graph-001",
      label: "Graph Layout",
      type: LayoutType.Graph,
      targetClass: "[[ems__Task]]",
    };

    const calendarLayout: CalendarLayout = {
      uid: "calendar-001",
      label: "Calendar Layout",
      type: LayoutType.Calendar,
      targetClass: "[[ems__Effort]]",
      startProperty: "[[ems__Effort_startTimestamp]]",
    };

    const listLayout: ListLayout = {
      uid: "list-001",
      label: "List Layout",
      type: LayoutType.List,
      targetClass: "[[ems__Task]]",
    };

    describe("isTableLayout", () => {
      it("should return true for TableLayout", () => {
        expect(isTableLayout(tableLayout)).toBe(true);
      });

      it("should return false for other layout types", () => {
        expect(isTableLayout(kanbanLayout)).toBe(false);
        expect(isTableLayout(graphLayout)).toBe(false);
        expect(isTableLayout(calendarLayout)).toBe(false);
        expect(isTableLayout(listLayout)).toBe(false);
      });
    });

    describe("isKanbanLayout", () => {
      it("should return true for KanbanLayout", () => {
        expect(isKanbanLayout(kanbanLayout)).toBe(true);
      });

      it("should return false for other layout types", () => {
        expect(isKanbanLayout(tableLayout)).toBe(false);
        expect(isKanbanLayout(graphLayout)).toBe(false);
        expect(isKanbanLayout(calendarLayout)).toBe(false);
        expect(isKanbanLayout(listLayout)).toBe(false);
      });
    });

    describe("isGraphLayout", () => {
      it("should return true for GraphLayout", () => {
        expect(isGraphLayout(graphLayout)).toBe(true);
      });

      it("should return false for other layout types", () => {
        expect(isGraphLayout(tableLayout)).toBe(false);
        expect(isGraphLayout(kanbanLayout)).toBe(false);
        expect(isGraphLayout(calendarLayout)).toBe(false);
        expect(isGraphLayout(listLayout)).toBe(false);
      });
    });

    describe("isCalendarLayout", () => {
      it("should return true for CalendarLayout", () => {
        expect(isCalendarLayout(calendarLayout)).toBe(true);
      });

      it("should return false for other layout types", () => {
        expect(isCalendarLayout(tableLayout)).toBe(false);
        expect(isCalendarLayout(kanbanLayout)).toBe(false);
        expect(isCalendarLayout(graphLayout)).toBe(false);
        expect(isCalendarLayout(listLayout)).toBe(false);
      });
    });

    describe("isListLayout", () => {
      it("should return true for ListLayout", () => {
        expect(isListLayout(listLayout)).toBe(true);
      });

      it("should return false for other layout types", () => {
        expect(isListLayout(tableLayout)).toBe(false);
        expect(isListLayout(kanbanLayout)).toBe(false);
        expect(isListLayout(graphLayout)).toBe(false);
        expect(isListLayout(calendarLayout)).toBe(false);
      });
    });
  });

  describe("isValidCalendarView", () => {
    it('should return true for "day"', () => {
      expect(isValidCalendarView("day")).toBe(true);
    });

    it('should return true for "week"', () => {
      expect(isValidCalendarView("week")).toBe(true);
    });

    it('should return true for "month"', () => {
      expect(isValidCalendarView("month")).toBe(true);
    });

    it("should return false for invalid string values", () => {
      expect(isValidCalendarView("year")).toBe(false);
      expect(isValidCalendarView("")).toBe(false);
      expect(isValidCalendarView("Day")).toBe(false);
      expect(isValidCalendarView("WEEK")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isValidCalendarView(null)).toBe(false);
      expect(isValidCalendarView(undefined)).toBe(false);
      expect(isValidCalendarView(123)).toBe(false);
      expect(isValidCalendarView(true)).toBe(false);
    });
  });

  describe("type definitions", () => {
    it("should allow creating TableLayout with columns", () => {
      const layout: TableLayout = {
        uid: "layout-001",
        label: "Task Table",
        type: LayoutType.Table,
        targetClass: "[[ems__Task]]",
        columns: [
          {
            uid: "col-001",
            label: "Label Column",
            property: "[[exo__Asset_label]]",
          },
        ],
      };

      expect(layout.type).toBe(LayoutType.Table);
      expect(layout.columns.length).toBe(1);
    });

    it("should allow creating KanbanLayout with lanes", () => {
      const layout: KanbanLayout = {
        uid: "layout-001",
        label: "Task Kanban",
        type: LayoutType.Kanban,
        targetClass: "[[ems__Task]]",
        laneProperty: "[[ems__Effort_status]]",
        lanes: [
          "[[ems__EffortStatus_Queued]]",
          "[[ems__EffortStatus_Doing]]",
          "[[ems__EffortStatus_Done]]",
        ],
      };

      expect(layout.type).toBe(LayoutType.Kanban);
      expect(layout.lanes).toHaveLength(3);
    });

    it("should allow creating GraphLayout with edge properties", () => {
      const layout: GraphLayout = {
        uid: "layout-001",
        label: "Task Graph",
        type: LayoutType.Graph,
        targetClass: "[[ems__Task]]",
        nodeLabel: "[[exo__Asset_label]]",
        edgeProperties: ["[[ems__Task_project]]", "[[ems__Task_blockedBy]]"],
        depth: 2,
      };

      expect(layout.type).toBe(LayoutType.Graph);
      expect(layout.edgeProperties).toHaveLength(2);
    });

    it("should allow creating CalendarLayout with time properties", () => {
      const layout: CalendarLayout = {
        uid: "layout-001",
        label: "Effort Calendar",
        type: LayoutType.Calendar,
        targetClass: "[[ems__Effort]]",
        startProperty: "[[ems__Effort_startTimestamp]]",
        endProperty: "[[ems__Effort_endTimestamp]]",
        view: "week",
      };

      expect(layout.type).toBe(LayoutType.Calendar);
      expect(layout.view).toBe("week");
    });

    it("should allow creating ListLayout with template", () => {
      const layout: ListLayout = {
        uid: "layout-001",
        label: "Task List",
        type: LayoutType.List,
        targetClass: "[[ems__Task]]",
        template: "{{label}} — {{status}}",
        showIcon: true,
      };

      expect(layout.type).toBe(LayoutType.List);
      expect(layout.template).toBe("{{label}} — {{status}}");
    });
  });
});
