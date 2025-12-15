/**
 * Integration tests for Layout parsing functionality.
 *
 * These tests verify that the LayoutParser correctly parses Layout definitions
 * using realistic scenarios with complex frontmatter structures.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { IVaultAdapter, IFile, IFolder, IFrontmatter } from "exocortex";
import {
  LayoutParser,
  type LayoutParseResult,
} from "../../src/infrastructure/layout";
import { LayoutType } from "../../src/domain/layout";

// Helper to create mock files
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

/**
 * In-memory vault adapter for integration testing.
 * Simulates a real vault with files, frontmatter, and link resolution.
 */
class InMemoryVaultAdapter implements IVaultAdapter {
  private files: Map<string, { content: string; frontmatter: IFrontmatter }> = new Map();

  constructor() {
    // Initialize empty vault
  }

  addFile(path: string, frontmatter: IFrontmatter, content: string = ""): void {
    this.files.set(path, { content, frontmatter });
  }

  // IVaultFileReader
  async read(file: IFile): Promise<string> {
    const entry = this.files.get(file.path);
    return entry?.content || "";
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  getAllFiles(): IFile[] {
    return Array.from(this.files.keys()).map((path) => createMockFile(path));
  }

  getAbstractFileByPath(path: string): IFile | IFolder | null {
    if (this.files.has(path)) {
      return createMockFile(path);
    }
    return null;
  }

  // IVaultFileWriter
  async create(path: string, content: string): Promise<IFile> {
    this.files.set(path, { content, frontmatter: {} });
    return createMockFile(path);
  }

  async modify(file: IFile, newContent: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (entry) {
      entry.content = newContent;
    }
  }

  async delete(file: IFile): Promise<void> {
    this.files.delete(file.path);
  }

  async process(file: IFile, fn: (content: string) => string): Promise<string> {
    const entry = this.files.get(file.path);
    if (entry) {
      const newContent = fn(entry.content);
      entry.content = newContent;
      return newContent;
    }
    return "";
  }

  // IVaultFileRenamer
  async rename(file: IFile, newPath: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (entry) {
      this.files.delete(file.path);
      this.files.set(newPath, entry);
    }
  }

  async updateLinks(
    _oldPath: string,
    _newPath: string,
    _oldBasename: string,
  ): Promise<void> {
    // No-op for tests
  }

  // IVaultFolderManager
  async createFolder(_path: string): Promise<void> {
    // No-op for tests
  }

  getDefaultNewFileParent(): IFolder | null {
    return { path: "/", name: "root" };
  }

  // IVaultFrontmatterManager
  getFrontmatter(file: IFile): IFrontmatter | null {
    const entry = this.files.get(file.path);
    return entry?.frontmatter || null;
  }

  async updateFrontmatter(
    file: IFile,
    updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void> {
    const entry = this.files.get(file.path);
    if (entry) {
      entry.frontmatter = updater(entry.frontmatter);
    }
  }

  // IVaultLinkResolver
  getFirstLinkpathDest(linkpath: string, _sourcePath: string): IFile | null {
    // Try exact match
    if (this.files.has(linkpath)) {
      return createMockFile(linkpath);
    }

    // Try with .md extension
    const withMd = linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`;
    if (this.files.has(withMd)) {
      return createMockFile(withMd);
    }

    // Try matching by basename
    for (const [path] of this.files) {
      const basename = path.split("/").pop()?.replace(".md", "");
      if (basename === linkpath || basename === linkpath.replace(".md", "")) {
        return createMockFile(path);
      }
    }

    return null;
  }
}

describe("Layout Parsing Integration", () => {
  let vault: InMemoryVaultAdapter;
  let parser: LayoutParser;

  beforeEach(() => {
    vault = new InMemoryVaultAdapter();
    parser = new LayoutParser(vault);
  });

  describe("Complete Layout Parsing Scenario", () => {
    it("should parse a complete table layout with all related objects", async () => {
      // Set up a realistic vault structure
      vault.addFile("03 Knowledge/layouts/DailyTasksLayout.md", {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000001",
        exo__Asset_label: "Daily Tasks Table",
        exo__Asset_description: "A table showing tasks for the current day",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_columns: [
          "[[emslayout__DailyTasks_LabelColumn]]",
          "[[emslayout__DailyTasks_StatusColumn]]",
          "[[emslayout__DailyTasks_VotesColumn]]",
        ],
        exo__Layout_filters: ["[[emslayout__DailyTasks_TodayFilter]]"],
        exo__Layout_defaultSort: ["[[emslayout__DailyTasks_SortByPlannedStart]]"],
        exo__Layout_groupBy: "[[emslayout__DailyTasks_GroupByProject]]",
      });

      // Add column definitions
      vault.addFile("03 Knowledge/layouts/columns/emslayout__DailyTasks_LabelColumn.md", {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000010",
        exo__Asset_label: "Label Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
        exo__LayoutColumn_header: "Задача",
        exo__LayoutColumn_width: "1fr",
        exo__LayoutColumn_renderer: "link",
        exo__LayoutColumn_editable: true,
        exo__LayoutColumn_sortable: true,
      });

      vault.addFile("03 Knowledge/layouts/columns/emslayout__DailyTasks_StatusColumn.md", {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000011",
        exo__Asset_label: "Status Column",
        exo__LayoutColumn_property: "[[ems__Effort_status]]",
        exo__LayoutColumn_header: "Статус",
        exo__LayoutColumn_width: "100px",
        exo__LayoutColumn_renderer: "badge",
        exo__LayoutColumn_editable: false,
        exo__LayoutColumn_sortable: true,
      });

      vault.addFile("03 Knowledge/layouts/columns/emslayout__DailyTasks_VotesColumn.md", {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000012",
        exo__Asset_label: "Votes Column",
        exo__LayoutColumn_property: "[[ems__Effort_votes]]",
        exo__LayoutColumn_header: "Голоса",
        exo__LayoutColumn_width: "80px",
        exo__LayoutColumn_renderer: "number",
        exo__LayoutColumn_editable: true,
        exo__LayoutColumn_sortable: true,
      });

      // Add filter definition
      vault.addFile("03 Knowledge/layouts/filters/emslayout__DailyTasks_TodayFilter.md", {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000020",
        exo__Asset_label: "Today Filter",
        exo__LayoutFilter_sparql: `
          ?asset ems:Effort_plannedStartTimestamp ?plannedStart .
          FILTER(?plannedStart >= NOW() - "PT12H"^^xsd:duration)
        `,
      });

      // Add sort definition
      vault.addFile("03 Knowledge/layouts/sorts/emslayout__DailyTasks_SortByPlannedStart.md", {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000030",
        exo__Asset_label: "Sort by Planned Start",
        exo__LayoutSort_property: "[[ems__Effort_plannedStartTimestamp]]",
        exo__LayoutSort_direction: "asc",
        exo__LayoutSort_nullsPosition: "last",
      });

      // Add group definition
      vault.addFile("03 Knowledge/layouts/groups/emslayout__DailyTasks_GroupByProject.md", {
        exo__Asset_uid: "60000000-0000-0000-0000-000000000040",
        exo__Asset_label: "Group by Project",
        exo__LayoutGroup_property: "[[ems__Task_project]]",
        exo__LayoutGroup_collapsed: false,
        exo__LayoutGroup_showCount: true,
        exo__LayoutGroup_sortGroups: "asc",
      });

      // Parse the layout
      const file = createMockFile("03 Knowledge/layouts/DailyTasksLayout.md");
      const result = await parser.parseFromFile(file);

      // Verify result
      expect(result.success).toBe(true);
      expect(result.layout).toBeDefined();

      const layout = result.layout!;

      // Verify base properties
      expect(layout.uid).toBe("60000000-0000-0000-0000-000000000001");
      expect(layout.label).toBe("Daily Tasks Table");
      expect(layout.description).toBe("A table showing tasks for the current day");
      expect(layout.type).toBe(LayoutType.Table);
      expect(layout.targetClass).toBe("[[ems__Task]]");

      // Verify columns
      const tableLayout = layout as { columns: unknown[] };
      expect(tableLayout.columns).toHaveLength(3);

      expect(tableLayout.columns[0]).toMatchObject({
        uid: "60000000-0000-0000-0000-000000000010",
        label: "Label Column",
        property: "[[exo__Asset_label]]",
        header: "Задача",
        renderer: "link",
      });

      expect(tableLayout.columns[1]).toMatchObject({
        uid: "60000000-0000-0000-0000-000000000011",
        property: "[[ems__Effort_status]]",
        renderer: "badge",
      });

      expect(tableLayout.columns[2]).toMatchObject({
        uid: "60000000-0000-0000-0000-000000000012",
        property: "[[ems__Effort_votes]]",
        renderer: "number",
      });

      // Verify filter
      expect(layout.filters).toHaveLength(1);
      expect(layout.filters![0]).toMatchObject({
        uid: "60000000-0000-0000-0000-000000000020",
        label: "Today Filter",
      });
      expect(layout.filters![0].sparql).toContain("ems:Effort_plannedStartTimestamp");

      // Verify sort
      expect(layout.defaultSort).toMatchObject({
        uid: "60000000-0000-0000-0000-000000000030",
        label: "Sort by Planned Start",
        property: "[[ems__Effort_plannedStartTimestamp]]",
        direction: "asc",
        nullsPosition: "last",
      });

      // Verify group
      expect(layout.groupBy).toMatchObject({
        uid: "60000000-0000-0000-0000-000000000040",
        label: "Group by Project",
        property: "[[ems__Task_project]]",
        collapsed: false,
        showCount: true,
        sortGroups: "asc",
      });
    });

    it("should parse a kanban layout from the issue example", async () => {
      // Set up layout file matching the issue description
      vault.addFile("03 Knowledge/layouts/UpcomingTasksLayout.md", {
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Asset_uid: "upcoming-tasks-001",
        exo__Asset_label: "Upcoming Tasks",
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_columns: [
          "[[emslayout__DailyTasks_LabelColumn]]",
          "[[emslayout__DailyTasks_StatusColumn]]",
        ],
        exo__Layout_defaultSort: ["[[emslayout__DailyTasks_SortByPlannedStart]]"],
      });

      // Add minimal column and sort definitions
      vault.addFile("03 Knowledge/layouts/columns/emslayout__DailyTasks_LabelColumn.md", {
        exo__Asset_uid: "col-label-001",
        exo__Asset_label: "Label Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
        exo__LayoutColumn_renderer: "link",
      });

      vault.addFile("03 Knowledge/layouts/columns/emslayout__DailyTasks_StatusColumn.md", {
        exo__Asset_uid: "col-status-001",
        exo__Asset_label: "Status Column",
        exo__LayoutColumn_property: "[[ems__Effort_status]]",
        exo__LayoutColumn_renderer: "badge",
      });

      vault.addFile("03 Knowledge/layouts/sorts/emslayout__DailyTasks_SortByPlannedStart.md", {
        exo__Asset_uid: "sort-planned-001",
        exo__Asset_label: "Sort by Planned Start",
        exo__LayoutSort_property: "[[ems__Effort_plannedStartTimestamp]]",
        exo__LayoutSort_direction: "asc",
      });

      // Parse via wikilink (as referenced in the issue)
      const layout = await parser.parseFromWikiLink("[[UpcomingTasksLayout]]");

      expect(layout).toBeDefined();
      expect(layout!.uid).toBe("upcoming-tasks-001");
      expect(layout!.label).toBe("Upcoming Tasks");
      expect(layout!.type).toBe(LayoutType.Table);

      const tableLayout = layout as { columns: unknown[] };
      expect(tableLayout.columns).toHaveLength(2);
      expect(layout!.defaultSort).toBeDefined();
      expect(layout!.defaultSort!.property).toBe("[[ems__Effort_plannedStartTimestamp]]");
    });
  });

  describe("Graceful Degradation", () => {
    it("should skip missing columns and continue parsing", async () => {
      vault.addFile("layouts/PartialLayout.md", {
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Partial Layout",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_columns: [
          "[[ExistingColumn]]",
          "[[MissingColumn]]", // This doesn't exist
          "[[AnotherExistingColumn]]",
        ],
      });

      vault.addFile("columns/ExistingColumn.md", {
        exo__Asset_uid: "col-001",
        exo__Asset_label: "Existing Column",
        exo__LayoutColumn_property: "[[exo__Asset_label]]",
      });

      vault.addFile("columns/AnotherExistingColumn.md", {
        exo__Asset_uid: "col-002",
        exo__Asset_label: "Another Column",
        exo__LayoutColumn_property: "[[exo__Asset_uid]]",
      });

      const file = createMockFile("layouts/PartialLayout.md");
      const result = await parser.parseFromFile(file, { gracefulDegradation: true });

      expect(result.success).toBe(true);
      const tableLayout = result.layout as { columns: unknown[] };
      expect(tableLayout.columns).toHaveLength(2); // Missing column skipped
    });

    it("should skip missing filter and continue", async () => {
      vault.addFile("layouts/FilteredLayout.md", {
        exo__Asset_uid: "layout-001",
        exo__Asset_label: "Filtered Layout",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__Layout_filters: ["[[MissingFilter]]"],
      });

      const file = createMockFile("layouts/FilteredLayout.md");
      const result = await parser.parseFromFile(file, { gracefulDegradation: true });

      expect(result.success).toBe(true);
      expect(result.layout!.filters).toBeUndefined(); // Filter not loaded
    });
  });

  describe("Multiple Layout Types", () => {
    it("should parse different layout types correctly", async () => {
      // Add various layout types
      vault.addFile("layouts/Table.md", {
        exo__Asset_uid: "table-001",
        exo__Asset_label: "Table Layout",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      vault.addFile("layouts/Kanban.md", {
        exo__Asset_uid: "kanban-001",
        exo__Asset_label: "Kanban Layout",
        exo__Instance_class: ["[[exo__KanbanLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__KanbanLayout_laneProperty: "[[ems__Effort_status]]",
      });

      vault.addFile("layouts/Graph.md", {
        exo__Asset_uid: "graph-001",
        exo__Asset_label: "Graph Layout",
        exo__Instance_class: ["[[exo__GraphLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      vault.addFile("layouts/Calendar.md", {
        exo__Asset_uid: "calendar-001",
        exo__Asset_label: "Calendar Layout",
        exo__Instance_class: ["[[exo__CalendarLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
        exo__CalendarLayout_startProperty: "[[ems__Effort_startTimestamp]]",
      });

      vault.addFile("layouts/List.md", {
        exo__Asset_uid: "list-001",
        exo__Asset_label: "List Layout",
        exo__Instance_class: ["[[exo__ListLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      // Parse each and verify type
      const table = await parser.parseFromWikiLink("[[Table]]");
      const kanban = await parser.parseFromWikiLink("[[Kanban]]");
      const graph = await parser.parseFromWikiLink("[[Graph]]");
      const calendar = await parser.parseFromWikiLink("[[Calendar]]");
      const list = await parser.parseFromWikiLink("[[List]]");

      expect(table!.type).toBe(LayoutType.Table);
      expect(kanban!.type).toBe(LayoutType.Kanban);
      expect(graph!.type).toBe(LayoutType.Graph);
      expect(calendar!.type).toBe(LayoutType.Calendar);
      expect(list!.type).toBe(LayoutType.List);
    });
  });

  describe("Cache Behavior", () => {
    it("should return same object from cache", async () => {
      vault.addFile("layouts/Cached.md", {
        exo__Asset_uid: "cached-001",
        exo__Asset_label: "Cached Layout",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      const layout1 = await parser.parseFromWikiLink("[[Cached]]");
      const layout2 = await parser.parseFromWikiLink("[[Cached]]");

      expect(layout1).toBe(layout2); // Same object reference
    });

    it("should return fresh object after cache clear", async () => {
      vault.addFile("layouts/Refresh.md", {
        exo__Asset_uid: "refresh-001",
        exo__Asset_label: "Refresh Layout",
        exo__Instance_class: ["[[exo__TableLayout]]"],
        exo__Layout_targetClass: "[[ems__Task]]",
      });

      const layout1 = await parser.parseFromWikiLink("[[Refresh]]");
      parser.clearCache();
      const layout2 = await parser.parseFromWikiLink("[[Refresh]]");

      expect(layout1).not.toBe(layout2); // Different object references
      expect(layout1!.uid).toBe(layout2!.uid); // But same content
    });
  });
});
