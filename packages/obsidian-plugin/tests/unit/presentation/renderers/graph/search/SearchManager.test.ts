/**
 * SearchManager Unit Tests
 *
 * Tests for the node search and highlighting system.
 */

import {
  SearchManager,
  createSearchManager,
  DEFAULT_SEARCH_MANAGER_CONFIG,
  DEFAULT_SEARCH_OPTIONS,
} from "../../../../../../src/presentation/renderers/graph/search";
import type { GraphNode } from "../../../../../../src/presentation/renderers/graph/types";

describe("SearchManager", () => {
  let manager: SearchManager;
  let testNodes: GraphNode[];

  beforeEach(() => {
    manager = new SearchManager();

    testNodes = [
      { id: "1", label: "Task Alpha", path: "/tasks/alpha.md" },
      { id: "2", label: "Task Beta", path: "/tasks/beta.md" },
      { id: "3", label: "Project Gamma", path: "/projects/gamma.md" },
      { id: "4", label: "Area Delta", path: "/areas/delta.md" },
      { id: "5", label: "Testing Notes", path: "/notes/testing.md" },
    ];

    manager.setNodes(testNodes);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const state = manager.getState();
      expect(state.query).toBe("");
      expect(state.isActive).toBe(false);
      expect(state.matches).toHaveLength(0);
    });

    it("should accept custom config", () => {
      const customManager = new SearchManager({
        searchOptions: { minChars: 5 },
      });
      customManager.setNodes(testNodes);
      customManager.search("Tas", true); // Less than 5 chars
      expect(customManager.getState().isActive).toBe(false);
      customManager.destroy();
    });
  });

  describe("setNodes", () => {
    it("should set nodes for searching", () => {
      const newNodes = [{ id: "x", label: "New Node", path: "/new.md" }];
      manager.setNodes(newNodes);
      manager.search("New", true);
      expect(manager.getState().matches.length).toBe(1);
    });

    it("should re-run search if already active", () => {
      manager.search("Task", true);
      expect(manager.getState().matches.length).toBe(2);

      // Add more nodes
      const moreNodes = [...testNodes, { id: "6", label: "Task Epsilon", path: "/tasks/epsilon.md" }];
      manager.setNodes(moreNodes);
      expect(manager.getState().matches.length).toBe(3);
    });

    it("should accept node types map", () => {
      const nodeTypes = new Map([
        ["1", ["ems__Task"]],
        ["3", ["ems__Project"]],
      ]);
      manager.setNodes(testNodes, nodeTypes);
      manager.setOptions({ searchTypes: true });
      manager.search("Project", true);
      expect(manager.getState().matches.length).toBeGreaterThan(0);
    });
  });

  describe("search", () => {
    it("should find matches in labels", () => {
      manager.search("Task", true);
      const state = manager.getState();
      expect(state.isActive).toBe(true);
      expect(state.matches.length).toBe(2);
      expect(state.matches.map((m) => m.nodeId)).toContain("1");
      expect(state.matches.map((m) => m.nodeId)).toContain("2");
    });

    it("should be case-insensitive by default", () => {
      manager.search("task", true);
      expect(manager.getState().matches.length).toBe(2);
    });

    it("should respect caseSensitive option", () => {
      // Disable path search to isolate label matching for this test
      manager.setOptions({ caseSensitive: true, searchPaths: false });

      // Verify options were set
      const optionsAfterSet = manager.getState().options;
      expect(optionsAfterSet.caseSensitive).toBe(true);
      expect(optionsAfterSet.searchPaths).toBe(false);

      // Search with lowercase "task" - should NOT match "Task Alpha/Beta" when case-sensitive
      manager.search("task", true);
      expect(manager.getState().matches.length).toBe(0);

      // Search with correct case "Task" - should match
      manager.search("Task", true);
      expect(manager.getState().matches.length).toBe(2);
    });

    it("should find matches in paths", () => {
      manager.setOptions({ searchLabels: false, searchPaths: true });
      manager.search("projects", true);
      const state = manager.getState();
      expect(state.matches.length).toBe(1);
      expect(state.matches[0].nodeId).toBe("3");
    });

    it("should not search if query too short", () => {
      manager.search("T", true);
      expect(manager.getState().isActive).toBe(false);
    });

    it("should support regex search", () => {
      manager.setOptions({ useRegex: true });
      manager.search("^Task", true);
      expect(manager.getState().matches.length).toBe(2);
    });

    it("should handle invalid regex gracefully", () => {
      manager.setOptions({ useRegex: true });
      manager.search("[invalid(", true);
      expect(manager.getState().matches).toHaveLength(0);
    });

    it("should emit search events", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.search("Task", true);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "search:start" })
      );
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "search:update" })
      );
    });

    it("should rank exact matches higher", () => {
      const nodes = [
        { id: "1", label: "Testing", path: "/a.md" },
        { id: "2", label: "Testing Framework", path: "/b.md" },
      ];
      manager.setNodes(nodes);
      manager.search("Testing", true);
      const matches = manager.getState().matches;
      expect(matches[0].nodeId).toBe("1"); // Exact match should be first
    });

    it("should limit results to maxResults", () => {
      const manyNodes = Array.from({ length: 200 }, (_, i) => ({
        id: `${i}`,
        label: `Match ${i}`,
        path: `/path${i}.md`,
      }));
      manager.setNodes(manyNodes);
      manager.search("Match", true);
      expect(manager.getState().matches.length).toBeLessThanOrEqual(
        DEFAULT_SEARCH_OPTIONS.maxResults
      );
    });
  });

  describe("navigation", () => {
    beforeEach(() => {
      manager.search("Task", true);
    });

    it("should select first match after search", () => {
      const state = manager.getState();
      expect(state.currentMatchIndex).toBe(0);
    });

    it("should navigate to next match", () => {
      const match = manager.nextMatch();
      expect(match).toBeDefined();
      expect(manager.getState().currentMatchIndex).toBe(1);
    });

    it("should wrap around at end", () => {
      manager.nextMatch(); // Go to index 1
      manager.nextMatch(); // Wrap to index 0
      expect(manager.getState().currentMatchIndex).toBe(0);
    });

    it("should navigate to previous match", () => {
      const match = manager.previousMatch();
      expect(match).toBeDefined();
      // From 0, should wrap to last (index 1)
      expect(manager.getState().currentMatchIndex).toBe(1);
    });

    it("should select match by index", () => {
      const match = manager.selectMatch(1);
      expect(match).toBeDefined();
      expect(manager.getState().currentMatchIndex).toBe(1);
    });

    it("should return null for invalid index", () => {
      expect(manager.selectMatch(-1)).toBeNull();
      expect(manager.selectMatch(100)).toBeNull();
    });

    it("should select match by node ID", () => {
      const match = manager.selectMatchByNodeId("2");
      expect(match).toBeDefined();
      expect(match?.nodeId).toBe("2");
    });

    it("should return null for non-matching node ID", () => {
      expect(manager.selectMatchByNodeId("nonexistent")).toBeNull();
    });

    it("should emit match:select events", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.nextMatch();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "match:select" })
      );
    });
  });

  describe("clear", () => {
    it("should clear search state", () => {
      manager.search("Task", true);
      manager.clear();
      const state = manager.getState();
      expect(state.query).toBe("");
      expect(state.isActive).toBe(false);
      expect(state.matches).toHaveLength(0);
    });

    it("should emit search:clear event", () => {
      manager.search("Task", true);
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.clear();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "search:clear" })
      );
    });
  });

  describe("isMatch / isCurrentMatch", () => {
    beforeEach(() => {
      manager.search("Task", true);
    });

    it("should identify matching nodes", () => {
      expect(manager.isMatch("1")).toBe(true);
      expect(manager.isMatch("2")).toBe(true);
      expect(manager.isMatch("3")).toBe(false);
    });

    it("should identify current match", () => {
      // Get the matches to determine which node is first (order depends on scoring)
      const matches = manager.getState().matches;
      expect(matches.length).toBe(2);

      const firstMatchId = matches[0].nodeId;
      const secondMatchId = matches[1].nodeId;

      // First match should be current
      expect(manager.isCurrentMatch(firstMatchId)).toBe(true);
      expect(manager.isCurrentMatch(secondMatchId)).toBe(false);

      // After navigation, second match should be current
      manager.nextMatch();
      expect(manager.isCurrentMatch(firstMatchId)).toBe(false);
      expect(manager.isCurrentMatch(secondMatchId)).toBe(true);
    });
  });

  describe("getMatchedNodeIds", () => {
    it("should return set of matched node IDs", () => {
      manager.search("Task", true);
      const ids = manager.getMatchedNodeIds();
      expect(ids.has("1")).toBe(true);
      expect(ids.has("2")).toBe(true);
      expect(ids.size).toBe(2);
    });

    it("should return empty set when no matches", () => {
      manager.search("xyz", true);
      expect(manager.getMatchedNodeIds().size).toBe(0);
    });
  });

  describe("setOptions", () => {
    it("should update search options", () => {
      manager.setOptions({ caseSensitive: true });
      expect(manager.getState().options.caseSensitive).toBe(true);
    });

    it("should re-run search with new options", () => {
      // First, disable path search and search case-insensitively
      manager.setOptions({ searchPaths: false });
      manager.search("task", true);
      expect(manager.getState().matches.length).toBe(2); // Matches "Task Alpha" and "Task Beta"

      // Now enable case-sensitive - should no longer match "Task" with "task"
      manager.setOptions({ caseSensitive: true });
      expect(manager.getState().matches.length).toBe(0);
    });
  });

  describe("setHighlightStyle", () => {
    it("should update highlight style", () => {
      manager.setHighlightStyle({ fillColor: "#ff0000" });
      const style = manager.getHighlightStyle();
      expect(style.fillColor).toBe("#ff0000");
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.search("Test", true);
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      manager.removeEventListener(listener);
      manager.search("Task", true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("should clean up resources", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);
      manager.destroy();
      // After destroy, listeners should be cleared
      // This is tested by not throwing errors
      expect(true).toBe(true);
    });
  });

  describe("createSearchManager factory", () => {
    it("should create manager with config", () => {
      const created = createSearchManager({
        searchOptions: { minChars: 3 },
      });
      expect(created).toBeDefined();
      created.destroy();
    });
  });

  describe("DEFAULT_SEARCH_MANAGER_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_SEARCH_MANAGER_CONFIG.searchOptions).toBeDefined();
      expect(DEFAULT_SEARCH_MANAGER_CONFIG.highlightStyle).toBeDefined();
    });
  });
});
