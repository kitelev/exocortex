/**
 * Tests for ContextMenuManager - Context-aware right-click menus
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  ContextMenuManager,
  DEFAULT_CONTEXT_MENU_MANAGER_CONFIG,
  type ContextMenuState,
  type ContextMenuManagerConfig,
  type ContextMenuEvent,
  type ContextMenuEventType,
  type ContextMenuItem,
  type ContextMenuProvider,
  type ContextMenuTarget,
  type ContextMenuRenderer,
  type Point,
} from "../../../../../src/presentation/renderers/graph/ContextMenuManager";
import type { GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";

// Create mock graph nodes
function createMockNodes(count: number): GraphNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    label: `Node ${i}`,
    path: `/path/to/node-${i}.md`,
    x: i * 50,
    y: i * 30,
    size: 8,
  }));
}

// Create mock graph edges
function createMockEdges(nodes: GraphNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `edge-${i}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      label: `Edge ${i}`,
      property: `exo:relation${i}`,
    });
  }
  return edges;
}

// Create mock context menu renderer
function createMockRenderer(): ContextMenuRenderer & {
  renderMock: jest.Mock;
  hideMock: jest.Mock;
  updatePositionMock: jest.Mock;
  destroyMock: jest.Mock;
} {
  let visible = false;

  const renderMock = jest.fn().mockImplementation((state: ContextMenuState) => {
    visible = state.visible;
  });
  const hideMock = jest.fn().mockImplementation(() => {
    visible = false;
  });
  const updatePositionMock = jest.fn();
  const destroyMock = jest.fn();

  return {
    render: renderMock,
    hide: hideMock,
    updatePosition: updatePositionMock,
    isVisible: () => visible,
    destroy: destroyMock,
    renderMock,
    hideMock,
    updatePositionMock,
    destroyMock,
  };
}

// Create a simple test provider
function createMockProvider(
  id: string,
  priority: number,
  targetTypes: ContextMenuTarget["type"][],
  items: ContextMenuItem[]
): ContextMenuProvider {
  return {
    id,
    priority,
    appliesTo: (target: ContextMenuTarget) => targetTypes.includes(target.type),
    getItems: () => items,
  };
}

describe("ContextMenuManager", () => {
  let manager: ContextMenuManager;
  let mockRenderer: ReturnType<typeof createMockRenderer>;
  let nodes: GraphNode[];
  let edges: GraphEdge[];

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    manager = new ContextMenuManager({
      renderer: mockRenderer,
    });
    nodes = createMockNodes(5);
    edges = createMockEdges(nodes);
    manager.setNodes(nodes);
    manager.setEdges(edges);
  });

  afterEach(() => {
    manager.destroy();
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const m = new ContextMenuManager();
      expect(m.getConfig()).toEqual(DEFAULT_CONTEXT_MENU_MANAGER_CONFIG);
      m.destroy();
    });

    it("should accept custom config", () => {
      const customConfig: Partial<ContextMenuManagerConfig> = {
        hideDelay: 500,
        maxWidth: 300,
        preventDefaultContextMenu: false,
      };
      const m = new ContextMenuManager({ config: customConfig });
      const config = m.getConfig();
      expect(config.hideDelay).toBe(500);
      expect(config.maxWidth).toBe(300);
      expect(config.preventDefaultContextMenu).toBe(false);
      m.destroy();
    });

    it("should accept renderer in constructor", () => {
      const renderer = createMockRenderer();
      const m = new ContextMenuManager({ renderer });
      expect(m).toBeDefined();
      m.destroy();
    });
  });

  describe("setNodes and setEdges", () => {
    it("should store nodes for lookup", () => {
      expect(manager.getNode("node-0")).toEqual(nodes[0]);
      expect(manager.getNode("node-4")).toEqual(nodes[4]);
    });

    it("should return undefined for unknown node", () => {
      expect(manager.getNode("unknown")).toBeUndefined();
    });

    it("should store edges for lookup", () => {
      expect(manager.getEdge("edge-0")).toEqual(edges[0]);
      expect(manager.getEdge("edge-3")).toEqual(edges[3]);
    });

    it("should return undefined for unknown edge", () => {
      expect(manager.getEdge("unknown")).toBeUndefined();
    });
  });

  describe("registerProvider and unregisterProvider", () => {
    it("should register provider and collect items", () => {
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "test-action", label: "Test Action" },
      ]);
      manager.registerProvider(provider);

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      expect(mockRenderer.renderMock).toHaveBeenCalled();
      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.items).toHaveLength(1);
      expect(state.items[0].id).toBe("test-action");
    });

    it("should unregister provider", () => {
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "test-action", label: "Test Action" },
      ]);
      manager.registerProvider(provider);
      manager.unregisterProvider("test-provider");

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      // No items means menu won't show
      expect(mockRenderer.renderMock).not.toHaveBeenCalled();
    });

    it("should sort providers by priority", () => {
      const lowPriority = createMockProvider("low", 50, ["node"], [
        { id: "low-action", label: "Low" },
      ]);
      const highPriority = createMockProvider("high", 150, ["node"], [
        { id: "high-action", label: "High" },
      ]);

      manager.registerProvider(lowPriority);
      manager.registerProvider(highPriority);

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      // Higher priority items should come first
      expect(state.items[0].id).toBe("high-action");
      expect(state.items[1].id).toBe("low-action");
    });
  });

  describe("show", () => {
    beforeEach(() => {
      const provider = createMockProvider("test-provider", 100, ["node", "edge", "canvas"], [
        { id: "action-1", label: "Action 1" },
        { id: "action-2", label: "Action 2" },
      ]);
      manager.registerProvider(provider);
    });

    it("should show menu for node target", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: "node-0", node: nodes[0] };
      const position: Point = { x: 100, y: 100 };

      manager.show(target, position);

      expect(manager.isVisible()).toBe(true);
      expect(mockRenderer.renderMock).toHaveBeenCalledTimes(1);

      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.visible).toBe(true);
      expect(state.position).toEqual(position);
      expect(state.target).toEqual(target);
      expect(state.items).toHaveLength(2);
    });

    it("should show menu for edge target", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: "edge-0", edge: edges[0] };

      manager.show(target, { x: 200, y: 200 });

      expect(manager.isVisible()).toBe(true);
      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.target?.type).toBe("edge");
    });

    it("should show menu for canvas target", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 50, y: 50 } };

      manager.show(target, { x: 300, y: 300 });

      expect(manager.isVisible()).toBe(true);
      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.target?.type).toBe("canvas");
    });

    it("should not show menu if no items from providers", () => {
      const m = new ContextMenuManager({ renderer: mockRenderer });
      // No providers registered

      m.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      expect(m.isVisible()).toBe(false);
      expect(mockRenderer.renderMock).not.toHaveBeenCalled();
      m.destroy();
    });

    it("should emit show event", () => {
      const listener = jest.fn();
      manager.on("contextmenu:show", listener);

      const target: ContextMenuTarget = { type: "node", nodeId: "node-0", node: nodes[0] };
      const position: Point = { x: 100, y: 100 };
      manager.show(target, position);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "contextmenu:show",
          target,
          position,
        })
      );
    });
  });

  describe("showForNode", () => {
    beforeEach(() => {
      const provider = createMockProvider("test-provider", 100, ["node", "selection"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);
    });

    it("should show menu for existing node", () => {
      manager.showForNode("node-0", { x: 100, y: 100 });

      expect(manager.isVisible()).toBe(true);
      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.target?.type).toBe("node");
      if (state.target?.type === "node") {
        expect(state.target.nodeId).toBe("node-0");
      }
    });

    it("should not show menu for unknown node", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      manager.showForNode("unknown-node", { x: 100, y: 100 });

      expect(manager.isVisible()).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should show selection menu when node is part of multi-selection", () => {
      manager.setSelection(new Set(["node-0", "node-1", "node-2"]), new Set());

      manager.showForNode("node-0", { x: 100, y: 100 });

      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.target?.type).toBe("selection");
    });
  });

  describe("showForEdge", () => {
    beforeEach(() => {
      const provider = createMockProvider("test-provider", 100, ["edge"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);
    });

    it("should show menu for existing edge", () => {
      manager.showForEdge("edge-0", { x: 100, y: 100 });

      expect(manager.isVisible()).toBe(true);
      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.target?.type).toBe("edge");
    });

    it("should not show menu for unknown edge", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      manager.showForEdge("unknown-edge", { x: 100, y: 100 });

      expect(manager.isVisible()).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("showForCanvas", () => {
    beforeEach(() => {
      const provider = createMockProvider("test-provider", 100, ["canvas"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);
    });

    it("should show menu for canvas", () => {
      manager.showForCanvas({ x: 50, y: 50 }, { x: 100, y: 100 });

      expect(manager.isVisible()).toBe(true);
      const state = mockRenderer.renderMock.mock.calls[0][0] as ContextMenuState;
      expect(state.target?.type).toBe("canvas");
      if (state.target?.type === "canvas") {
        expect(state.target.position).toEqual({ x: 50, y: 50 });
      }
    });
  });

  describe("hide", () => {
    beforeEach(() => {
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);
    });

    it("should hide visible menu", () => {
      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });
      expect(manager.isVisible()).toBe(true);

      manager.hide();

      expect(manager.isVisible()).toBe(false);
      expect(mockRenderer.hideMock).toHaveBeenCalled();
    });

    it("should do nothing if already hidden", () => {
      expect(manager.isVisible()).toBe(false);

      manager.hide();

      expect(mockRenderer.hideMock).not.toHaveBeenCalled();
    });

    it("should emit hide event", () => {
      const listener = jest.fn();
      manager.on("contextmenu:hide", listener);

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });
      manager.hide();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "contextmenu:hide",
        })
      );
    });
  });

  describe("scheduleHide and cancelScheduledHide", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should hide after delay", () => {
      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      manager.scheduleHide();

      expect(manager.isVisible()).toBe(true);

      jest.advanceTimersByTime(DEFAULT_CONTEXT_MENU_MANAGER_CONFIG.hideDelay);

      expect(manager.isVisible()).toBe(false);
    });

    it("should cancel scheduled hide", () => {
      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      manager.scheduleHide();
      manager.cancelScheduledHide();

      jest.advanceTimersByTime(DEFAULT_CONTEXT_MENU_MANAGER_CONFIG.hideDelay + 100);

      expect(manager.isVisible()).toBe(true);
    });
  });

  describe("executeAction", () => {
    it("should execute action with correct target", async () => {
      const actionFn = jest.fn();
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "test-action", label: "Test", action: actionFn },
      ]);
      manager.registerProvider(provider);

      const target: ContextMenuTarget = { type: "node", nodeId: "node-0", node: nodes[0] };
      manager.show(target, { x: 100, y: 100 });

      const state = manager.getState();
      await manager.executeAction(state.items[0]);

      expect(actionFn).toHaveBeenCalledWith(target);
    });

    it("should not execute disabled action", async () => {
      const actionFn = jest.fn();
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "test-action", label: "Test", action: actionFn, disabled: true },
      ]);
      manager.registerProvider(provider);

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      const state = manager.getState();
      await manager.executeAction(state.items[0]);

      expect(actionFn).not.toHaveBeenCalled();
    });

    it("should emit action event", async () => {
      const listener = jest.fn();
      manager.on("contextmenu:action", listener);

      const actionFn = jest.fn();
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "test-action", label: "Test", action: actionFn },
      ]);
      manager.registerProvider(provider);

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      const state = manager.getState();
      await manager.executeAction(state.items[0]);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "contextmenu:action",
          actionItem: expect.objectContaining({ id: "test-action" }),
        })
      );
    });

    it("should close menu after action by default", async () => {
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "test-action", label: "Test", action: jest.fn() },
      ]);
      manager.registerProvider(provider);

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      const state = manager.getState();
      await manager.executeAction(state.items[0]);

      expect(manager.isVisible()).toBe(false);
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const listener = jest.fn();

      manager.on("contextmenu:show", listener);

      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);
      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      expect(listener).toHaveBeenCalledTimes(1);

      manager.off("contextmenu:show", listener);
      manager.hide();
      manager.show({ type: "node", nodeId: "node-1", node: nodes[1] }, { x: 200, y: 200 });

      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called after off()
    });
  });

  describe("getState and getTarget", () => {
    it("should return current state", () => {
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);

      const target: ContextMenuTarget = { type: "node", nodeId: "node-0", node: nodes[0] };
      manager.show(target, { x: 100, y: 100 });

      const state = manager.getState();
      expect(state.visible).toBe(true);
      expect(state.target).toEqual(target);
      expect(state.items).toHaveLength(1);
    });

    it("should return current target", () => {
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);

      const target: ContextMenuTarget = { type: "node", nodeId: "node-0", node: nodes[0] };
      manager.show(target, { x: 100, y: 100 });

      expect(manager.getTarget()).toEqual(target);
    });

    it("should return null target when hidden", () => {
      expect(manager.getTarget()).toBeNull();
    });
  });

  describe("setConfig", () => {
    it("should update config", () => {
      manager.setConfig({ hideDelay: 1000 });

      expect(manager.getConfig().hideDelay).toBe(1000);
    });
  });

  describe("setSelection", () => {
    it("should update selection state", () => {
      const provider = createMockProvider("test-provider", 100, ["selection"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);

      manager.setSelection(new Set(["node-0", "node-1"]), new Set(["edge-0"]));

      // Show context menu for a selected node - should show selection menu
      manager.showForNode("node-0", { x: 100, y: 100 });

      const state = manager.getState();
      expect(state.target?.type).toBe("selection");
    });
  });

  describe("destroy", () => {
    it("should cleanup all resources", () => {
      const provider = createMockProvider("test-provider", 100, ["node"], [
        { id: "action-1", label: "Action 1" },
      ]);
      manager.registerProvider(provider);
      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      manager.destroy();

      expect(mockRenderer.destroyMock).toHaveBeenCalled();
      expect(manager.isVisible()).toBe(false);
      expect(manager.getNode("node-0")).toBeUndefined();
    });
  });

  describe("separator handling", () => {
    it("should organize items with separators correctly", () => {
      const provider: ContextMenuProvider = {
        id: "test-provider",
        priority: 100,
        appliesTo: () => true,
        getItems: () => [
          { id: "action-1", label: "Action 1" },
          { id: "action-2", label: "Action 2", separator: true },
          { id: "action-3", label: "Action 3" },
        ],
      };
      manager.registerProvider(provider);

      manager.show({ type: "node", nodeId: "node-0", node: nodes[0] }, { x: 100, y: 100 });

      const state = manager.getState();
      expect(state.items).toHaveLength(3);
      expect(state.items[0].separator).toBeFalsy(); // No separator after first item
      expect(state.items[1].separator).toBe(true); // Separator after second item
      expect(state.items[2].separator).toBeFalsy(); // No trailing separator (removed or undefined)
    });
  });
});
