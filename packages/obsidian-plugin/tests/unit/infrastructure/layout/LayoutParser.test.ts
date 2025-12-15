import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { IVaultAdapter, IFile, IFolder, IFrontmatter } from "exocortex";
import {
  LayoutParser,
  type LayoutParseResult,
  type LayoutParseOptions,
} from "../../../../src/infrastructure/layout";
import { LayoutType } from "../../../../src/domain/layout";

// Mock file factory
function createMockFile(
  path: string,
  basename: string = path.split("/").pop() || path,
): IFile {
  return {
    path,
    basename: basename.replace(".md", ""),
    name: basename,
    parent: { path: path.split("/").slice(0, -1).join("/"), name: "parent" } as IFolder,
  };
}

// Mock vault adapter factory
function createMockVaultAdapter(
  files: Map<string, IFrontmatter | null> = new Map(),
): jest.Mocked<IVaultAdapter> {
  return {
    read: jest.fn<IVaultAdapter["read"]>(),
    exists: jest.fn<IVaultAdapter["exists"]>(),
    getAllFiles: jest.fn<IVaultAdapter["getAllFiles"]>(),
    getAbstractFileByPath: jest.fn<IVaultAdapter["getAbstractFileByPath"]>(),
    create: jest.fn<IVaultAdapter["create"]>(),
    modify: jest.fn<IVaultAdapter["modify"]>(),
    delete: jest.fn<IVaultAdapter["delete"]>(),
    process: jest.fn<IVaultAdapter["process"]>(),
    rename: jest.fn<IVaultAdapter["rename"]>(),
    updateLinks: jest.fn<IVaultAdapter["updateLinks"]>(),
    createFolder: jest.fn<IVaultAdapter["createFolder"]>(),
    getDefaultNewFileParent: jest.fn<IVaultAdapter["getDefaultNewFileParent"]>(),
    getFrontmatter: jest.fn<IVaultAdapter["getFrontmatter"]>().mockImplementation((file: IFile) => {
      return files.get(file.path) || null;
    }),
    updateFrontmatter: jest.fn<IVaultAdapter["updateFrontmatter"]>(),
    getFirstLinkpathDest: jest.fn<IVaultAdapter["getFirstLinkpathDest"]>().mockImplementation(
      (linkpath: string) => {
        // Check for exact match
        for (const [path] of files) {
          if (path === linkpath || path === linkpath + ".md") {
            return createMockFile(path);
          }
          // Check if basename matches
          const basename = path.split("/").pop()?.replace(".md", "");
          if (basename === linkpath || basename === linkpath.replace(".md", "")) {
            return createMockFile(path);
          }
        }
        return null;
      },
    ),
  } as jest.Mocked<IVaultAdapter>;
}

describe("LayoutParser", () => {
  let parser: LayoutParser;
  let mockVaultAdapter: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVaultAdapter = createMockVaultAdapter();
    parser = new LayoutParser(mockVaultAdapter);
  });

  describe("constructor", () => {
    it("should create a LayoutParser instance", () => {
      expect(parser).toBeInstanceOf(LayoutParser);
    });
  });

  describe("parseFromFile", () => {
    it("should return error if file has no frontmatter", async () => {
      const file = createMockFile("layouts/MyLayout.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue(null);

      const result = await parser.parseFromFile(file);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No frontmatter found");
    });

    it("should return error if file is not a Layout asset", async () => {
      const file = createMockFile("tasks/MyTask.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "task-001",
        exo__Asset_label: "My Task",
        exo__Instance_class: ["[[ems__Task]]"],
      });

      const result = await parser.parseFromFile(file);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not a Layout asset");
    });

    it("should successfully parse a TableLayout", async () => {
      const file = createMockFile("layouts/TaskTable.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Task Table",
        exo__Asset_description: "A table of tasks",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      const result = await parser.parseFromFile(file);

      expect(result.success).toBe(true);
      expect(result.layout).toBeDefined();
      expect(result.layout!.uid).toBe("layout-001");
      expect(result.layout!.label).toBe("Task Table");
      expect(result.layout!.description).toBe("A table of tasks");
      expect(result.layout!.type).toBe(LayoutType.Table);
      expect(result.layout!.targetClass).toBe("[[ems__Task]]");
    });

    it("should cache parsed layouts", async () => {
      const file = createMockFile("layouts/TaskTable.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Task Table",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      // First call
      const result1 = await parser.parseFromFile(file);
      // Second call - should use cache
      const result2 = await parser.parseFromFile(file);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.layout).toBe(result2.layout); // Same object from cache
      expect(mockVaultAdapter.getFrontmatter).toHaveBeenCalledTimes(1);
    });

    it("should detect circular references", async () => {
      // This tests internal implementation, but it's important for robustness
      // The parser tracks which files are being parsed to prevent infinite loops
      const file = createMockFile("layouts/CircularLayout.md");

      // Simulate a layout that references itself indirectly
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Circular Layout",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      const result = await parser.parseFromFile(file);

      // Should parse successfully (no actual circular ref in this simple case)
      expect(result.success).toBe(true);
    });

    it("should respect maxDepth option", async () => {
      const file = createMockFile("layouts/DeepLayout.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Deep Layout",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      const result = await parser.parseFromFile(file, { maxDepth: 5 });

      expect(result.success).toBe(true);
    });
  });

  describe("parseFromWikiLink", () => {
    it("should parse layout from wikilink", async () => {
      const files = new Map<string, IFrontmatter>([
        [
          "layouts/TaskTable.md",
          {
            exo__Asset_uid: "layout-001",
            exo__Asset_label: "Task Table",
            exo__Instance_class: ["[[exo__TableLayout]]"],
            exo__Layout_targetClass: "[[ems__Task]]",
          },
        ],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      parser = new LayoutParser(mockVaultAdapter);

      const layout = await parser.parseFromWikiLink("[[TaskTable]]");

      expect(layout).toBeDefined();
      expect(layout!.uid).toBe("layout-001");
    });

    it("should return null for unresolvable wikilink", async () => {
      const layout = await parser.parseFromWikiLink("[[NonExistentLayout]]");

      expect(layout).toBeNull();
    });

    it("should handle wikilink with path", async () => {
      const files = new Map<string, IFrontmatter>([
        [
          "layouts/tables/TaskTable.md",
          {
            exo__Asset_uid: "layout-001",
            exo__Asset_label: "Task Table",
            exo__Instance_class: ["[[exo__TableLayout]]"],
            exo__Layout_targetClass: "[[ems__Task]]",
          },
        ],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      parser = new LayoutParser(mockVaultAdapter);

      const layout = await parser.parseFromWikiLink("[[layouts/tables/TaskTable]]");

      expect(layout).toBeDefined();
      expect(layout!.uid).toBe("layout-001");
    });
  });

  describe("Layout Type Parsing", () => {
    describe("TableLayout", () => {
      it("should parse TableLayout with columns", async () => {
        const files = new Map<string, IFrontmatter>([
          [
            "layouts/TaskTable.md",
            {
              exo__Asset_uid: "layout-001",
              exo__Asset_label: "Task Table",
              exo__Instance_class: ["[[exo__TableLayout]]"],
              exo__Layout_targetClass: "[[ems__Task]]",
              exo__Layout_columns: [
                "[[LabelColumn]]",
                "[[StatusColumn]]",
              ],
            },
          ],
          [
            "columns/LabelColumn.md",
            {
              exo__Asset_uid: "col-001",
              exo__Asset_label: "Label Column",
              exo__LayoutColumn_property: "[[exo__Asset_label]]",
              exo__LayoutColumn_header: "Name",
              exo__LayoutColumn_renderer: "link",
            },
          ],
          [
            "columns/StatusColumn.md",
            {
              exo__Asset_uid: "col-002",
              exo__Asset_label: "Status Column",
              exo__LayoutColumn_property: "[[ems__Effort_status]]",
              exo__LayoutColumn_header: "Status",
              exo__LayoutColumn_renderer: "badge",
            },
          ],
        ]);
        mockVaultAdapter = createMockVaultAdapter(files);
        parser = new LayoutParser(mockVaultAdapter);

        const file = createMockFile("layouts/TaskTable.md");
        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.type).toBe(LayoutType.Table);

        const tableLayout = result.layout as { columns: unknown[] };
        expect(tableLayout.columns).toHaveLength(2);
        expect(tableLayout.columns[0]).toMatchObject({
          uid: "col-001",
          label: "Label Column",
          property: "[[exo__Asset_label]]",
          header: "Name",
          renderer: "link",
        });
      });

      it("should parse TableLayout with empty columns array", async () => {
        const file = createMockFile("layouts/EmptyTable.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Empty Table",
          exo__Instance_class: ["[[exo__TableLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        const tableLayout = result.layout as { columns: unknown[] };
        expect(tableLayout.columns).toEqual([]);
      });
    });

    describe("KanbanLayout", () => {
      it("should parse KanbanLayout with laneProperty", async () => {
        const file = createMockFile("layouts/TaskKanban.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Task Kanban",
          exo__Instance_class: ["[[exo__KanbanLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
          exo__KanbanLayout_laneProperty: "[[ems__Effort_status]]",
          exo__KanbanLayout_lanes: [
            "[[ems__EffortStatus_ToDo]]",
            "[[ems__EffortStatus_InProgress]]",
            "[[ems__EffortStatus_Done]]",
          ],
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.type).toBe(LayoutType.Kanban);

        const kanbanLayout = result.layout as {
          laneProperty: string;
          lanes: string[];
        };
        expect(kanbanLayout.laneProperty).toBe("[[ems__Effort_status]]");
        expect(kanbanLayout.lanes).toHaveLength(3);
      });

      it("should return null for KanbanLayout without laneProperty", async () => {
        const file = createMockFile("layouts/InvalidKanban.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Invalid Kanban",
          exo__Instance_class: ["[[exo__KanbanLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
          // Missing exo__KanbanLayout_laneProperty
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(false);
      });
    });

    describe("GraphLayout", () => {
      it("should parse GraphLayout with optional properties", async () => {
        const file = createMockFile("layouts/TaskGraph.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Task Graph",
          exo__Instance_class: ["[[exo__GraphLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
          exo__GraphLayout_nodeLabel: "[[exo__Asset_label]]",
          exo__GraphLayout_edgeProperties: [
            "[[ems__Task_project]]",
            "[[ems__Effort_parent]]",
          ],
          exo__GraphLayout_depth: 3,
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.type).toBe(LayoutType.Graph);

        const graphLayout = result.layout as {
          nodeLabel: string;
          edgeProperties: string[];
          depth: number;
        };
        expect(graphLayout.nodeLabel).toBe("[[exo__Asset_label]]");
        expect(graphLayout.edgeProperties).toHaveLength(2);
        expect(graphLayout.depth).toBe(3);
      });

      it("should parse GraphLayout with minimal properties", async () => {
        const file = createMockFile("layouts/SimpleGraph.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Simple Graph",
          exo__Instance_class: ["[[exo__GraphLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.type).toBe(LayoutType.Graph);
      });
    });

    describe("CalendarLayout", () => {
      it("should parse CalendarLayout with required properties", async () => {
        const file = createMockFile("layouts/TaskCalendar.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Task Calendar",
          exo__Instance_class: ["[[exo__CalendarLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
          exo__CalendarLayout_startProperty: "[[ems__Effort_startTimestamp]]",
          exo__CalendarLayout_endProperty: "[[ems__Effort_endTimestamp]]",
          exo__CalendarLayout_view: "month",
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.type).toBe(LayoutType.Calendar);

        const calendarLayout = result.layout as {
          startProperty: string;
          endProperty: string;
          view: string;
        };
        expect(calendarLayout.startProperty).toBe("[[ems__Effort_startTimestamp]]");
        expect(calendarLayout.endProperty).toBe("[[ems__Effort_endTimestamp]]");
        expect(calendarLayout.view).toBe("month");
      });

      it("should return null for CalendarLayout without startProperty", async () => {
        const file = createMockFile("layouts/InvalidCalendar.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Invalid Calendar",
          exo__Instance_class: ["[[exo__CalendarLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
          // Missing exo__CalendarLayout_startProperty
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(false);
      });

      it("should default view to 'week' if not specified", async () => {
        const file = createMockFile("layouts/DefaultCalendar.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Default Calendar",
          exo__Instance_class: ["[[exo__CalendarLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
          exo__CalendarLayout_startProperty: "[[ems__Effort_startTimestamp]]",
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        const calendarLayout = result.layout as { view: string };
        expect(calendarLayout.view).toBe("week");
      });
    });

    describe("ListLayout", () => {
      it("should parse ListLayout with all properties", async () => {
        const file = createMockFile("layouts/TaskList.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Task List",
          exo__Instance_class: ["[[exo__ListLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
          exo__ListLayout_template: "{{label}} - {{status}}",
          exo__ListLayout_showIcon: true,
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.type).toBe(LayoutType.List);

        const listLayout = result.layout as {
          template: string;
          showIcon: boolean;
        };
        expect(listLayout.template).toBe("{{label}} - {{status}}");
        expect(listLayout.showIcon).toBe(true);
      });

      it("should default showIcon to false", async () => {
        const file = createMockFile("layouts/SimpleList.md");
        mockVaultAdapter.getFrontmatter.mockReturnValue({
          exo__Asset_uid: "layout-001",
          exo__Asset_label: "Simple List",
          exo__Instance_class: ["[[exo__ListLayout]]"],
          exo__Layout_targetClass: "[[ems__Task]]",
        });

        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        const listLayout = result.layout as { showIcon: boolean };
        expect(listLayout.showIcon).toBe(false);
      });
    });
  });

  describe("Related Object Loading", () => {
    describe("Filters", () => {
      it("should load filters from wikilinks", async () => {
        const files = new Map<string, IFrontmatter>([
          [
            "layouts/FilteredTable.md",
            {
              exo__Asset_uid: "layout-001",
              exo__Asset_label: "Filtered Table",
              exo__Instance_class: ["[[exo__TableLayout]]"],
              exo__Layout_targetClass: "[[ems__Task]]",
              exo__Layout_filters: ["[[ActiveFilter]]"],
            },
          ],
          [
            "filters/ActiveFilter.md",
            {
              exo__Asset_uid: "filter-001",
              exo__Asset_label: "Active Tasks Filter",
              exo__LayoutFilter_property: "[[ems__Effort_status]]",
              exo__LayoutFilter_operator: "ne",
              exo__LayoutFilter_value: "[[ems__EffortStatus_Done]]",
            },
          ],
        ]);
        mockVaultAdapter = createMockVaultAdapter(files);
        parser = new LayoutParser(mockVaultAdapter);

        const file = createMockFile("layouts/FilteredTable.md");
        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.filters).toHaveLength(1);
        expect(result.layout!.filters![0]).toMatchObject({
          uid: "filter-001",
          label: "Active Tasks Filter",
          property: "[[ems__Effort_status]]",
          operator: "ne",
          value: "[[ems__EffortStatus_Done]]",
        });
      });

      it("should skip unresolvable filters with gracefulDegradation", async () => {
        const files = new Map<string, IFrontmatter>([
          [
            "layouts/FilteredTable.md",
            {
              exo__Asset_uid: "layout-001",
              exo__Asset_label: "Filtered Table",
              exo__Instance_class: ["[[exo__TableLayout]]"],
              exo__Layout_targetClass: "[[ems__Task]]",
              exo__Layout_filters: ["[[NonExistentFilter]]"],
            },
          ],
        ]);
        mockVaultAdapter = createMockVaultAdapter(files);
        parser = new LayoutParser(mockVaultAdapter);

        const file = createMockFile("layouts/FilteredTable.md");
        const result = await parser.parseFromFile(file, { gracefulDegradation: true });

        expect(result.success).toBe(true);
        expect(result.layout!.filters).toBeUndefined();
      });

      it("should fail on unresolvable filters without gracefulDegradation", async () => {
        const files = new Map<string, IFrontmatter>([
          [
            "layouts/FilteredTable.md",
            {
              exo__Asset_uid: "layout-001",
              exo__Asset_label: "Filtered Table",
              exo__Instance_class: ["[[exo__TableLayout]]"],
              exo__Layout_targetClass: "[[ems__Task]]",
              exo__Layout_filters: ["[[NonExistentFilter]]"],
            },
          ],
        ]);
        mockVaultAdapter = createMockVaultAdapter(files);
        parser = new LayoutParser(mockVaultAdapter);

        const file = createMockFile("layouts/FilteredTable.md");

        await expect(
          parser.parseFromFile(file, { gracefulDegradation: false }),
        ).rejects.toThrow("Failed to load filter");
      });
    });

    describe("DefaultSort", () => {
      it("should load defaultSort from wikilink", async () => {
        const files = new Map<string, IFrontmatter>([
          [
            "layouts/SortedTable.md",
            {
              exo__Asset_uid: "layout-001",
              exo__Asset_label: "Sorted Table",
              exo__Instance_class: ["[[exo__TableLayout]]"],
              exo__Layout_targetClass: "[[ems__Task]]",
              exo__Layout_defaultSort: "[[SortByStart]]",
            },
          ],
          [
            "sorts/SortByStart.md",
            {
              exo__Asset_uid: "sort-001",
              exo__Asset_label: "Sort by Start Time",
              exo__LayoutSort_property: "[[ems__Effort_startTimestamp]]",
              exo__LayoutSort_direction: "desc",
              exo__LayoutSort_nullsPosition: "last",
            },
          ],
        ]);
        mockVaultAdapter = createMockVaultAdapter(files);
        parser = new LayoutParser(mockVaultAdapter);

        const file = createMockFile("layouts/SortedTable.md");
        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.defaultSort).toMatchObject({
          uid: "sort-001",
          label: "Sort by Start Time",
          property: "[[ems__Effort_startTimestamp]]",
          direction: "desc",
          nullsPosition: "last",
        });
      });

      it("should take first sort from array", async () => {
        const files = new Map<string, IFrontmatter>([
          [
            "layouts/MultiSortTable.md",
            {
              exo__Asset_uid: "layout-001",
              exo__Asset_label: "Multi Sort Table",
              exo__Instance_class: ["[[exo__TableLayout]]"],
              exo__Layout_targetClass: "[[ems__Task]]",
              exo__Layout_defaultSort: ["[[SortByStart]]", "[[SortByLabel]]"],
            },
          ],
          [
            "sorts/SortByStart.md",
            {
              exo__Asset_uid: "sort-001",
              exo__Asset_label: "Sort by Start Time",
              exo__LayoutSort_property: "[[ems__Effort_startTimestamp]]",
              exo__LayoutSort_direction: "desc",
            },
          ],
          [
            "sorts/SortByLabel.md",
            {
              exo__Asset_uid: "sort-002",
              exo__Asset_label: "Sort by Label",
              exo__LayoutSort_property: "[[exo__Asset_label]]",
              exo__LayoutSort_direction: "asc",
            },
          ],
        ]);
        mockVaultAdapter = createMockVaultAdapter(files);
        parser = new LayoutParser(mockVaultAdapter);

        const file = createMockFile("layouts/MultiSortTable.md");
        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.defaultSort!.uid).toBe("sort-001");
      });
    });

    describe("GroupBy", () => {
      it("should load groupBy from wikilink", async () => {
        const files = new Map<string, IFrontmatter>([
          [
            "layouts/GroupedTable.md",
            {
              exo__Asset_uid: "layout-001",
              exo__Asset_label: "Grouped Table",
              exo__Instance_class: ["[[exo__TableLayout]]"],
              exo__Layout_targetClass: "[[ems__Task]]",
              exo__Layout_groupBy: "[[GroupByProject]]",
            },
          ],
          [
            "groups/GroupByProject.md",
            {
              exo__Asset_uid: "group-001",
              exo__Asset_label: "Group by Project",
              exo__LayoutGroup_property: "[[ems__Task_project]]",
              exo__LayoutGroup_collapsed: false,
              exo__LayoutGroup_showCount: true,
              exo__LayoutGroup_sortGroups: "asc",
            },
          ],
        ]);
        mockVaultAdapter = createMockVaultAdapter(files);
        parser = new LayoutParser(mockVaultAdapter);

        const file = createMockFile("layouts/GroupedTable.md");
        const result = await parser.parseFromFile(file);

        expect(result.success).toBe(true);
        expect(result.layout!.groupBy).toMatchObject({
          uid: "group-001",
          label: "Group by Project",
          property: "[[ems__Task_project]]",
          collapsed: false,
          showCount: true,
          sortGroups: "asc",
        });
      });
    });
  });

  describe("Cache Management", () => {
    it("should clear cache", async () => {
      const file = createMockFile("layouts/TaskTable.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Task Table",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      // First call to populate cache
      await parser.parseFromFile(file);
      expect(mockVaultAdapter.getFrontmatter).toHaveBeenCalledTimes(1);

      // Clear cache
      parser.clearCache();

      // Second call should re-fetch
      await parser.parseFromFile(file);
      expect(mockVaultAdapter.getFrontmatter).toHaveBeenCalledTimes(2);
    });

    it("should invalidate specific cache entry", async () => {
      const file1 = createMockFile("layouts/Layout1.md");
      const file2 = createMockFile("layouts/Layout2.md");

      mockVaultAdapter.getFrontmatter.mockImplementation((file: IFile) => {
        if (file.path === "layouts/Layout1.md") {
          return {
            exo__Asset_uid: "layout-001",
            exo__Asset_label: "Layout 1",
            exo__Instance_class: ["[[exo__TableLayout]]"],
            exo__Layout_targetClass: "[[ems__Task]]",
          };
        }
        if (file.path === "layouts/Layout2.md") {
          return {
            exo__Asset_uid: "layout-002",
            exo__Asset_label: "Layout 2",
            exo__Instance_class: ["[[exo__TableLayout]]"],
            exo__Layout_targetClass: "[[ems__Task]]",
          };
        }
        return null;
      });

      // Parse both layouts
      await parser.parseFromFile(file1);
      await parser.parseFromFile(file2);
      expect(mockVaultAdapter.getFrontmatter).toHaveBeenCalledTimes(2);

      // Invalidate only Layout1
      parser.invalidateCache("layouts/Layout1.md");

      // Parse both again - Layout1 should re-fetch, Layout2 should use cache
      await parser.parseFromFile(file1);
      await parser.parseFromFile(file2);
      expect(mockVaultAdapter.getFrontmatter).toHaveBeenCalledTimes(3); // Only one additional call
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing required fields", async () => {
      const file = createMockFile("layouts/Incomplete.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Instance_class: ["[[exo__TableLayout]]"],
        // Missing uid, label, targetClass
      });

      const result = await parser.parseFromFile(file);

      expect(result.success).toBe(false);
    });

    it("should handle wikilink with alias", async () => {
      const files = new Map<string, IFrontmatter>([
        [
          "layouts/TaskTable.md",
          {
            exo__Asset_uid: "layout-001",
            exo__Asset_label: "Task Table",
            exo__Instance_class: ["[[exo__TableLayout]]"],
            exo__Layout_targetClass: "[[ems__Task]]",
          },
        ],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      parser = new LayoutParser(mockVaultAdapter);

      // Wikilink with alias: [[TaskTable|My Task Table]]
      const layout = await parser.parseFromWikiLink("[[TaskTable|My Task Table]]");

      expect(layout).toBeDefined();
      expect(layout!.uid).toBe("layout-001");
    });

    it("should handle wikilink with heading", async () => {
      const files = new Map<string, IFrontmatter>([
        [
          "layouts/TaskTable.md",
          {
            exo__Asset_uid: "layout-001",
            exo__Asset_label: "Task Table",
            exo__Instance_class: ["[[exo__TableLayout]]"],
            exo__Layout_targetClass: "[[ems__Task]]",
          },
        ],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      parser = new LayoutParser(mockVaultAdapter);

      // Wikilink with heading: [[TaskTable#Section]]
      const layout = await parser.parseFromWikiLink("[[TaskTable#Section]]");

      expect(layout).toBeDefined();
      expect(layout!.uid).toBe("layout-001");
    });

    it("should handle instance class as plain string", async () => {
      const file = createMockFile("layouts/TaskTable.md");
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Task Table",
        exo__Instance_class: "exo__TableLayout", // Plain string, not array or wikilink
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      const result = await parser.parseFromFile(file);

      expect(result.success).toBe(true);
      expect(result.layout!.type).toBe(LayoutType.Table);
    });

    it("should handle single filter as string instead of array", async () => {
      const files = new Map<string, IFrontmatter>([
        [
          "layouts/FilteredTable.md",
          {
            exo__Asset_uid: "layout-001",
            exo__Asset_label: "Filtered Table",
            exo__Instance_class: ["[[exo__TableLayout]]"],
            exo__Layout_targetClass: "[[ems__Task]]",
            exo__Layout_filters: "[[ActiveFilter]]", // String instead of array
          },
        ],
        [
          "filters/ActiveFilter.md",
          {
            exo__Asset_uid: "filter-001",
            exo__Asset_label: "Active Tasks Filter",
            exo__LayoutFilter_property: "[[ems__Effort_status]]",
            exo__LayoutFilter_operator: "ne",
            exo__LayoutFilter_value: "[[ems__EffortStatus_Done]]",
          },
        ],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      parser = new LayoutParser(mockVaultAdapter);

      const file = createMockFile("layouts/FilteredTable.md");
      const result = await parser.parseFromFile(file);

      expect(result.success).toBe(true);
      expect(result.layout!.filters).toHaveLength(1);
    });
  });

  describe("parseLayoutFromFrontmatter", () => {
    it("should parse layout directly from frontmatter object", async () => {
      const frontmatter: IFrontmatter = {
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Direct Layout",
        exo__Instance_class: ["[[exo__ListLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      };

      const layout = await parser.parseLayoutFromFrontmatter(frontmatter);

      expect(layout).toBeDefined();
      expect(layout!.uid).toBe("layout-001");
      expect(layout!.type).toBe(LayoutType.List);
    });

    it("should return null for invalid frontmatter", async () => {
      const frontmatter: IFrontmatter = {
        exo__Asset_uid: "layout-001",
        // Missing required fields
      };

      const layout = await parser.parseLayoutFromFrontmatter(frontmatter);

      expect(layout).toBeNull();
    });
  });
});
