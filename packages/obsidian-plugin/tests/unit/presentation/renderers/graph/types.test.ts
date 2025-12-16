/**
 * Graph Types Unit Tests
 *
 * Tests for graph utility functions including:
 * - extractLabelFromWikilink
 * - extractPathFromWikilink
 * - rowsToNodes
 * - extractEdges
 * - buildGraphData
 */

import {
  extractLabelFromWikilink,
  extractPathFromWikilink,
  rowsToNodes,
  extractEdges,
  buildGraphData,
} from "@plugin/presentation/renderers/graph/types";
import type { TableRow } from "@plugin/presentation/renderers/cell-renderers";

describe("Graph Types", () => {
  describe("extractLabelFromWikilink", () => {
    it("extracts label from piped wikilink", () => {
      expect(extractLabelFromWikilink("[[path/to/file|My Label]]")).toBe("My Label");
    });

    it("extracts filename from simple wikilink", () => {
      expect(extractLabelFromWikilink("[[path/to/file]]")).toBe("file");
    });

    it("removes .md extension from simple wikilink", () => {
      expect(extractLabelFromWikilink("[[path/to/file.md]]")).toBe("file");
    });

    it("returns original string if not a wikilink", () => {
      expect(extractLabelFromWikilink("plain text")).toBe("plain text");
    });

    it("handles wikilink without path", () => {
      expect(extractLabelFromWikilink("[[filename]]")).toBe("filename");
    });

    it("handles nested paths", () => {
      expect(extractLabelFromWikilink("[[a/b/c/deep/file]]")).toBe("file");
    });
  });

  describe("extractPathFromWikilink", () => {
    it("extracts path from piped wikilink", () => {
      expect(extractPathFromWikilink("[[path/to/file|My Label]]")).toBe("path/to/file");
    });

    it("extracts path from simple wikilink", () => {
      expect(extractPathFromWikilink("[[path/to/file]]")).toBe("path/to/file");
    });

    it("returns original string if not a wikilink", () => {
      expect(extractPathFromWikilink("plain text")).toBe("plain text");
    });

    it("handles wikilink without path", () => {
      expect(extractPathFromWikilink("[[filename]]")).toBe("filename");
    });
  });

  describe("rowsToNodes", () => {
    const createRow = (overrides: Partial<TableRow> = {}): TableRow => ({
      id: "row-1",
      path: "/path/to/asset.md",
      metadata: {},
      values: { label: "Test Asset" },
      ...overrides,
    });

    it("converts rows to nodes with path-based labels", () => {
      const rows = [createRow({ id: "r1", path: "/path/task.md" })];
      const nodes = rowsToNodes(rows);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        id: "r1",
        path: "/path/task.md",
        label: "task",
      });
    });

    it("uses label column when provided", () => {
      const rows = [
        createRow({
          id: "r1",
          path: "/path/task.md",
          values: { title: "My Task" },
        }),
      ];
      const nodes = rowsToNodes(rows, "title");

      expect(nodes[0].label).toBe("My Task");
    });

    it("falls back to path label when column value is missing", () => {
      const rows = [
        createRow({
          id: "r1",
          path: "/path/task.md",
          values: {},
        }),
      ];
      const nodes = rowsToNodes(rows, "nonexistent");

      expect(nodes[0].label).toBe("task");
    });

    it("preserves metadata", () => {
      const rows = [
        createRow({
          id: "r1",
          metadata: { type: "task", priority: 1 },
        }),
      ];
      const nodes = rowsToNodes(rows);

      expect(nodes[0].metadata).toEqual({ type: "task", priority: 1 });
    });

    it("handles multiple rows", () => {
      const rows = [
        createRow({ id: "r1", path: "/a.md" }),
        createRow({ id: "r2", path: "/b.md" }),
        createRow({ id: "r3", path: "/c.md" }),
      ];
      const nodes = rowsToNodes(rows);

      expect(nodes).toHaveLength(3);
      expect(nodes.map((n) => n.id)).toEqual(["r1", "r2", "r3"]);
    });
  });

  describe("extractEdges", () => {
    const createRow = (overrides: Partial<TableRow> = {}): TableRow => ({
      id: "row-1",
      path: "/path/to/asset.md",
      metadata: {},
      values: {},
      ...overrides,
    });

    it("extracts edges from single wikilink property", () => {
      const rows = [
        createRow({
          id: "task-1",
          path: "/tasks/task-1.md",
          values: { parent: "[[projects/project-1.md]]" },
        }),
      ];
      const edges = extractEdges(rows, ["parent"]);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: "task-1",
        target: "projects/project-1.md",
        property: "parent",
      });
    });

    it("extracts edges from array of wikilinks", () => {
      const rows = [
        createRow({
          id: "task-1",
          path: "/tasks/task-1.md",
          values: {
            blockedBy: ["[[tasks/task-2.md]]", "[[tasks/task-3.md]]"],
          },
        }),
      ];
      const edges = extractEdges(rows, ["blockedBy"]);

      expect(edges).toHaveLength(2);
      expect(edges[0].target).toBe("tasks/task-2.md");
      expect(edges[1].target).toBe("tasks/task-3.md");
    });

    it("extracts edges from multiple properties", () => {
      const rows = [
        createRow({
          id: "task-1",
          path: "/tasks/task-1.md",
          values: {
            parent: "[[projects/project-1.md]]",
            blockedBy: "[[tasks/task-2.md]]",
          },
        }),
      ];
      const edges = extractEdges(rows, ["parent", "blockedBy"]);

      expect(edges).toHaveLength(2);
    });

    it("skips self-referencing edges", () => {
      const rows = [
        createRow({
          id: "task-1",
          path: "/tasks/task-1.md",
          values: { related: "[[/tasks/task-1.md]]" },
        }),
      ];
      const edges = extractEdges(rows, ["related"]);

      expect(edges).toHaveLength(0);
    });

    it("skips empty property values", () => {
      const rows = [
        createRow({
          id: "task-1",
          path: "/tasks/task-1.md",
          values: { parent: null },
        }),
      ];
      const edges = extractEdges(rows, ["parent"]);

      expect(edges).toHaveLength(0);
    });

    it("assigns unique edge IDs", () => {
      const rows = [
        createRow({
          id: "task-1",
          path: "/tasks/task-1.md",
          values: {
            blockedBy: ["[[tasks/task-2.md]]", "[[tasks/task-3.md]]"],
          },
        }),
      ];
      const edges = extractEdges(rows, ["blockedBy"]);

      const ids = edges.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length); // All unique
    });

    it("extracts label from property wikilink", () => {
      const rows = [
        createRow({
          id: "task-1",
          path: "/tasks/task-1.md",
          values: { "[[ems__Task_parent]]": "[[projects/p1.md]]" },
        }),
      ];
      const edges = extractEdges(rows, ["[[ems__Task_parent]]"]);

      expect(edges).toHaveLength(1);
      expect(edges[0].label).toBe("ems__Task_parent");
    });
  });

  describe("buildGraphData", () => {
    const createRow = (overrides: Partial<TableRow> = {}): TableRow => ({
      id: "row-1",
      path: "/path/to/asset.md",
      metadata: {},
      values: {},
      ...overrides,
    });

    it("builds complete graph data from rows", () => {
      const rows = [
        createRow({ id: "t1", path: "/tasks/t1.md", values: { label: "Task 1" } }),
        createRow({
          id: "t2",
          path: "/tasks/t2.md",
          values: { label: "Task 2", blockedBy: "[[/tasks/t1.md]]" },
        }),
      ];
      const data = buildGraphData(rows, "label", ["blockedBy"]);

      expect(data.nodes).toHaveLength(2);
      expect(data.edges).toHaveLength(1);
    });

    it("filters out edges with invalid targets", () => {
      const rows = [
        createRow({
          id: "t1",
          path: "/tasks/t1.md",
          values: { blockedBy: "[[/tasks/nonexistent.md]]" },
        }),
      ];
      const data = buildGraphData(rows, undefined, ["blockedBy"]);

      expect(data.nodes).toHaveLength(1);
      expect(data.edges).toHaveLength(0); // Target doesn't exist
    });

    it("handles empty rows", () => {
      const data = buildGraphData([], undefined, []);

      expect(data.nodes).toHaveLength(0);
      expect(data.edges).toHaveLength(0);
    });

    it("handles rows without edge properties", () => {
      const rows = [
        createRow({ id: "t1", path: "/tasks/t1.md" }),
        createRow({ id: "t2", path: "/tasks/t2.md" }),
      ];
      const data = buildGraphData(rows);

      expect(data.nodes).toHaveLength(2);
      expect(data.edges).toHaveLength(0);
    });

    it("resolves edges by path as well as id", () => {
      const rows = [
        createRow({ id: "t1", path: "/tasks/t1.md" }),
        createRow({
          id: "t2",
          path: "/tasks/t2.md",
          values: { blockedBy: "[[/tasks/t1.md]]" },
        }),
      ];
      const data = buildGraphData(rows, undefined, ["blockedBy"]);

      // Edge target "/tasks/t1.md" matches node path "/tasks/t1.md"
      expect(data.edges).toHaveLength(1);
    });
  });
});
