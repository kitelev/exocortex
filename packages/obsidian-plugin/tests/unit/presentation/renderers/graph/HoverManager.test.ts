/**
 * Tests for HoverManager - Node and edge hover states with tooltip support
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  HoverManager,
  DEFAULT_HOVER_MANAGER_CONFIG,
  type HoverState,
  type HoverManagerConfig,
  type HoverEvent,
  type HoverEventType,
  type TooltipData,
  type TooltipDataProvider,
  type TooltipRenderer,
  type Point,
} from "../../../../../src/presentation/renderers/graph/HoverManager";
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

// Create mock tooltip data
function createMockTooltipData(id: string, type: "node" | "edge"): TooltipData {
  return {
    id,
    title: `${type === "node" ? "Node" : "Edge"} ${id}`,
    type: "task",
    properties: [
      { name: "Status", value: "Active" },
      { name: "Priority", value: "High" },
    ],
    incomingCount: 2,
    outgoingCount: 3,
    preview: "This is a preview text for the tooltip.",
    path: type === "node" ? `/path/to/${id}.md` : undefined,
  };
}

// Create mock tooltip data provider
function createMockDataProvider(): TooltipDataProvider & { getTooltipDataMock: jest.Mock } {
  const mock = jest.fn().mockImplementation((id: string, type: "node" | "edge") => {
    return Promise.resolve(createMockTooltipData(id, type));
  });

  return {
    getTooltipData: mock,
    getTooltipDataMock: mock,
  };
}

// Create mock tooltip renderer
function createMockRenderer(): TooltipRenderer & {
  showMock: jest.Mock;
  hideMock: jest.Mock;
  updatePositionMock: jest.Mock;
  destroyMock: jest.Mock;
} {
  let visible = false;

  const showMock = jest.fn().mockImplementation(() => {
    visible = true;
  });
  const hideMock = jest.fn().mockImplementation(() => {
    visible = false;
  });
  const updatePositionMock = jest.fn();
  const destroyMock = jest.fn();

  return {
    show: showMock,
    hide: hideMock,
    updatePosition: updatePositionMock,
    isVisible: () => visible,
    destroy: destroyMock,
    showMock,
    hideMock,
    updatePositionMock,
    destroyMock,
  };
}

describe("HoverManager", () => {
  let hoverManager: HoverManager;
  let mockNodes: GraphNode[];
  let mockEdges: GraphEdge[];

  beforeEach(() => {
    jest.useFakeTimers();
    mockNodes = createMockNodes(5);
    mockEdges = createMockEdges(mockNodes);
    hoverManager = new HoverManager();
    hoverManager.setNodes(mockNodes);
    hoverManager.setEdges(mockEdges);
  });

  afterEach(() => {
    hoverManager.destroy();
    jest.useRealTimers();
  });

  describe("initialization", () => {
    it("should initialize with empty hover state", () => {
      const state = hoverManager.getHoverState();
      expect(state.nodeId).toBeNull();
      expect(state.edgeId).toBeNull();
      expect(state.isTooltipVisible).toBe(false);
    });

    it("should use default config", () => {
      const config = hoverManager.getConfig();
      expect(config.hoverDelay).toBe(300);
      expect(config.highlightConnectedEdges).toBe(true);
      expect(config.highlightConnectedNodes).toBe(true);
      expect(config.dimmedOpacity).toBe(0.3);
      expect(config.glowColor).toBe(0x6366f1);
      expect(config.glowBlur).toBe(10);
      expect(config.tooltipsEnabled).toBe(true);
    });

    it("should accept custom config", () => {
      hoverManager.destroy();
      hoverManager = new HoverManager({
        config: {
          hoverDelay: 500,
          highlightConnectedEdges: false,
          glowColor: 0xff0000,
        },
      });

      const config = hoverManager.getConfig();
      expect(config.hoverDelay).toBe(500);
      expect(config.highlightConnectedEdges).toBe(false);
      expect(config.glowColor).toBe(0xff0000);
    });
  });

  describe("DEFAULT_HOVER_MANAGER_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_HOVER_MANAGER_CONFIG.hoverDelay).toBe(300);
      expect(DEFAULT_HOVER_MANAGER_CONFIG.highlightConnectedEdges).toBe(true);
      expect(DEFAULT_HOVER_MANAGER_CONFIG.highlightConnectedNodes).toBe(true);
      expect(DEFAULT_HOVER_MANAGER_CONFIG.dimmedOpacity).toBe(0.3);
      expect(DEFAULT_HOVER_MANAGER_CONFIG.glowColor).toBe(0x6366f1);
      expect(DEFAULT_HOVER_MANAGER_CONFIG.glowBlur).toBe(10);
      expect(DEFAULT_HOVER_MANAGER_CONFIG.tooltipsEnabled).toBe(true);
    });
  });

  describe("node hover enter", () => {
    it("should update hover state on node enter", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      const state = hoverManager.getHoverState();
      expect(state.nodeId).toBe("node-0");
      expect(state.edgeId).toBeNull();
      expect(state.position).toEqual({ x: 100, y: 100 });
    });

    it("should highlight the hovered node", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      expect(hoverManager.isNodeHighlighted("node-0")).toBe(true);
    });

    it("should highlight connected edges", () => {
      hoverManager.onNodeEnter("node-1", { x: 100, y: 100 });

      // node-1 is connected to edge-0 (from node-0) and edge-1 (to node-2)
      expect(hoverManager.isEdgeHighlighted("edge-0")).toBe(true);
      expect(hoverManager.isEdgeHighlighted("edge-1")).toBe(true);
      expect(hoverManager.isEdgeHighlighted("edge-2")).toBe(false);
    });

    it("should highlight connected nodes when highlighting edges", () => {
      hoverManager.onNodeEnter("node-1", { x: 100, y: 100 });

      // node-1's neighbors are node-0 and node-2
      expect(hoverManager.isNodeHighlighted("node-0")).toBe(true);
      expect(hoverManager.isNodeHighlighted("node-1")).toBe(true);
      expect(hoverManager.isNodeHighlighted("node-2")).toBe(true);
      expect(hoverManager.isNodeHighlighted("node-3")).toBe(false);
    });

    it("should not highlight connected edges when disabled", () => {
      hoverManager.setConfig({ highlightConnectedEdges: false });
      hoverManager.onNodeEnter("node-1", { x: 100, y: 100 });

      expect(hoverManager.isNodeHighlighted("node-1")).toBe(true);
      expect(hoverManager.isEdgeHighlighted("edge-0")).toBe(false);
      expect(hoverManager.isEdgeHighlighted("edge-1")).toBe(false);
    });

    it("should emit hover:node:enter event", () => {
      const listener = jest.fn();
      hoverManager.on("hover:node:enter", listener);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as HoverEvent;
      expect(event.type).toBe("hover:node:enter");
      expect(event.nodeId).toBe("node-0");
      expect(event.position).toEqual({ x: 100, y: 100 });
    });

    it("should emit hover:highlight:change event", () => {
      const listener = jest.fn();
      hoverManager.on("hover:highlight:change", listener);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as HoverEvent;
      expect(event.type).toBe("hover:highlight:change");
      expect(event.highlightedNodeIds.has("node-0")).toBe(true);
    });

    it("should update position when re-entering same node", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      hoverManager.onNodeEnter("node-0", { x: 150, y: 150 });

      const state = hoverManager.getHoverState();
      expect(state.position).toEqual({ x: 150, y: 150 });
    });
  });

  describe("node hover leave", () => {
    it("should clear hover state on node leave", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      hoverManager.onNodeLeave();

      const state = hoverManager.getHoverState();
      expect(state.nodeId).toBeNull();
    });

    it("should clear highlights on node leave", () => {
      hoverManager.onNodeEnter("node-1", { x: 100, y: 100 });
      hoverManager.onNodeLeave();

      expect(hoverManager.isNodeHighlighted("node-0")).toBe(false);
      expect(hoverManager.isNodeHighlighted("node-1")).toBe(false);
      expect(hoverManager.isEdgeHighlighted("edge-0")).toBe(false);
    });

    it("should emit hover:node:leave event", () => {
      const listener = jest.fn();
      hoverManager.on("hover:node:leave", listener);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      hoverManager.onNodeLeave();

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as HoverEvent;
      expect(event.type).toBe("hover:node:leave");
      expect(event.nodeId).toBe("node-0");
    });

    it("should not emit leave event if not hovering", () => {
      const listener = jest.fn();
      hoverManager.on("hover:node:leave", listener);

      hoverManager.onNodeLeave();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("edge hover enter", () => {
    it("should update hover state on edge enter", () => {
      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });

      const state = hoverManager.getHoverState();
      expect(state.edgeId).toBe("edge-0");
      expect(state.nodeId).toBeNull();
    });

    it("should highlight the hovered edge", () => {
      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });

      expect(hoverManager.isEdgeHighlighted("edge-0")).toBe(true);
      expect(hoverManager.isEdgeHighlighted("edge-1")).toBe(false);
    });

    it("should highlight source and target nodes", () => {
      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });

      // edge-0 connects node-0 and node-1
      expect(hoverManager.isNodeHighlighted("node-0")).toBe(true);
      expect(hoverManager.isNodeHighlighted("node-1")).toBe(true);
      expect(hoverManager.isNodeHighlighted("node-2")).toBe(false);
    });

    it("should emit hover:edge:enter event", () => {
      const listener = jest.fn();
      hoverManager.on("hover:edge:enter", listener);

      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as HoverEvent;
      expect(event.type).toBe("hover:edge:enter");
      expect(event.edgeId).toBe("edge-0");
    });
  });

  describe("edge hover leave", () => {
    it("should clear hover state on edge leave", () => {
      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });
      hoverManager.onEdgeLeave();

      const state = hoverManager.getHoverState();
      expect(state.edgeId).toBeNull();
    });

    it("should emit hover:edge:leave event", () => {
      const listener = jest.fn();
      hoverManager.on("hover:edge:leave", listener);

      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });
      hoverManager.onEdgeLeave();

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as HoverEvent;
      expect(event.type).toBe("hover:edge:leave");
    });
  });

  describe("tooltip delayed display", () => {
    it("should schedule tooltip after hover delay", () => {
      const mockProvider = createMockDataProvider();
      const mockRenderer = createMockRenderer();

      hoverManager.setDataProvider(mockProvider);
      hoverManager.setRenderer(mockRenderer);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      // Tooltip should not be shown immediately
      expect(mockRenderer.showMock).not.toHaveBeenCalled();

      // Advance timer by hover delay
      jest.advanceTimersByTime(300);

      // Now tooltip should be shown (after async resolution)
      return Promise.resolve().then(() => {
        expect(mockProvider.getTooltipDataMock).toHaveBeenCalledWith("node-0", "node");
      });
    });

    it("should not show tooltip if mouse leaves before delay", () => {
      const mockProvider = createMockDataProvider();
      const mockRenderer = createMockRenderer();

      hoverManager.setDataProvider(mockProvider);
      hoverManager.setRenderer(mockRenderer);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      // Leave before delay expires
      jest.advanceTimersByTime(100);
      hoverManager.onNodeLeave();

      // Advance past the original delay
      jest.advanceTimersByTime(300);

      expect(mockProvider.getTooltipDataMock).not.toHaveBeenCalled();
    });

    it("should not show tooltip if tooltips are disabled", () => {
      hoverManager.setConfig({ tooltipsEnabled: false });

      const mockProvider = createMockDataProvider();
      const mockRenderer = createMockRenderer();

      hoverManager.setDataProvider(mockProvider);
      hoverManager.setRenderer(mockRenderer);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      jest.advanceTimersByTime(500);

      expect(mockProvider.getTooltipDataMock).not.toHaveBeenCalled();
    });
  });

  describe("tooltip visibility", () => {
    it("should report tooltip visibility correctly", () => {
      expect(hoverManager.isTooltipVisible()).toBe(false);
    });

    it("should update tooltip position when hovering", () => {
      const mockRenderer = createMockRenderer();
      hoverManager.setRenderer(mockRenderer);

      // Simulate showing tooltip by setting internal state
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      hoverManager.updatePosition({ x: 150, y: 150 });

      // updatePosition is called on the renderer when tooltip is visible
      // Since we didn't complete the tooltip show cycle, it won't be called
      // This tests the position update logic
      expect(hoverManager.getHoverState().position).toEqual({ x: 150, y: 150 });
    });
  });

  describe("hover state transition", () => {
    it("should clear previous node hover when entering new node", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      hoverManager.onNodeEnter("node-1", { x: 200, y: 200 });

      const state = hoverManager.getHoverState();
      expect(state.nodeId).toBe("node-1");
      expect(hoverManager.isNodeHighlighted("node-0")).toBe(true); // Still highlighted as neighbor
    });

    it("should clear node hover when entering edge", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      hoverManager.onEdgeEnter("edge-0", { x: 150, y: 150 });

      const state = hoverManager.getHoverState();
      expect(state.nodeId).toBeNull();
      expect(state.edgeId).toBe("edge-0");
    });

    it("should clear edge hover when entering node", () => {
      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });
      hoverManager.onNodeEnter("node-0", { x: 150, y: 150 });

      const state = hoverManager.getHoverState();
      expect(state.edgeId).toBeNull();
      expect(state.nodeId).toBe("node-0");
    });
  });

  describe("isHovering", () => {
    it("should return false when not hovering", () => {
      expect(hoverManager.isHovering()).toBe(false);
    });

    it("should return true when hovering node", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      expect(hoverManager.isHovering()).toBe(true);
    });

    it("should return true when hovering edge", () => {
      hoverManager.onEdgeEnter("edge-0", { x: 100, y: 100 });
      expect(hoverManager.isHovering()).toBe(true);
    });

    it("should return false after leaving", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      hoverManager.onNodeLeave();
      expect(hoverManager.isHovering()).toBe(false);
    });
  });

  describe("highlight sets", () => {
    it("should return empty sets when not hovering", () => {
      expect(hoverManager.getHighlightedNodeIds().size).toBe(0);
      expect(hoverManager.getHighlightedEdgeIds().size).toBe(0);
    });

    it("should return highlighted node ids", () => {
      hoverManager.onNodeEnter("node-1", { x: 100, y: 100 });

      const highlightedNodes = hoverManager.getHighlightedNodeIds();
      expect(highlightedNodes.has("node-0")).toBe(true);
      expect(highlightedNodes.has("node-1")).toBe(true);
      expect(highlightedNodes.has("node-2")).toBe(true);
    });

    it("should return highlighted edge ids", () => {
      hoverManager.onNodeEnter("node-1", { x: 100, y: 100 });

      const highlightedEdges = hoverManager.getHighlightedEdgeIds();
      expect(highlightedEdges.has("edge-0")).toBe(true);
      expect(highlightedEdges.has("edge-1")).toBe(true);
    });
  });

  describe("glow config", () => {
    it("should return glow configuration", () => {
      const glowConfig = hoverManager.getGlowConfig();
      expect(glowConfig.color).toBe(0x6366f1);
      expect(glowConfig.blur).toBe(10);
    });

    it("should return updated glow configuration after setConfig", () => {
      hoverManager.setConfig({ glowColor: 0xff0000, glowBlur: 20 });

      const glowConfig = hoverManager.getGlowConfig();
      expect(glowConfig.color).toBe(0xff0000);
      expect(glowConfig.blur).toBe(20);
    });
  });

  describe("dimmed opacity", () => {
    it("should return dimmed opacity", () => {
      expect(hoverManager.getDimmedOpacity()).toBe(0.3);
    });

    it("should return updated dimmed opacity after setConfig", () => {
      hoverManager.setConfig({ dimmedOpacity: 0.5 });
      expect(hoverManager.getDimmedOpacity()).toBe(0.5);
    });
  });

  describe("event listeners", () => {
    it("should add and remove event listeners", () => {
      const listener = jest.fn();

      hoverManager.on("hover:node:enter", listener);
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      expect(listener).toHaveBeenCalledTimes(1);

      hoverManager.off("hover:node:enter", listener);
      hoverManager.onNodeEnter("node-1", { x: 200, y: 200 });
      expect(listener).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it("should support multiple listeners for same event", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      hoverManager.on("hover:node:enter", listener1);
      hoverManager.on("hover:node:enter", listener2);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("config updates", () => {
    it("should update config via setConfig", () => {
      hoverManager.setConfig({ hoverDelay: 500 });
      expect(hoverManager.getConfig().hoverDelay).toBe(500);
    });

    it("should preserve existing config values when updating", () => {
      hoverManager.setConfig({ hoverDelay: 500 });
      hoverManager.setConfig({ glowColor: 0xff0000 });

      const config = hoverManager.getConfig();
      expect(config.hoverDelay).toBe(500);
      expect(config.glowColor).toBe(0xff0000);
    });
  });

  describe("destroy", () => {
    it("should clear state on destroy", () => {
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      hoverManager.destroy();

      const state = hoverManager.getHoverState();
      expect(state.nodeId).toBeNull();
      expect(state.edgeId).toBeNull();
    });

    it("should clear listeners on destroy", () => {
      const listener = jest.fn();
      hoverManager.on("hover:node:enter", listener);

      hoverManager.destroy();

      // Create new manager since old one is destroyed
      hoverManager = new HoverManager();
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      expect(listener).not.toHaveBeenCalled();
    });

    it("should destroy renderer on destroy", () => {
      const mockRenderer = createMockRenderer();
      hoverManager.setRenderer(mockRenderer);

      hoverManager.destroy();

      expect(mockRenderer.destroyMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge lookup", () => {
    it("should handle nodes at graph endpoints correctly", () => {
      // node-0 only has outgoing edge (edge-0)
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      const highlightedEdges = hoverManager.getHighlightedEdgeIds();
      expect(highlightedEdges.size).toBe(1);
      expect(highlightedEdges.has("edge-0")).toBe(true);
    });

    it("should handle nodes with no edges", () => {
      const isolatedNode: GraphNode = {
        id: "isolated",
        label: "Isolated",
        path: "/path/to/isolated.md",
        x: 100,
        y: 100,
      };

      hoverManager.setNodes([...mockNodes, isolatedNode]);

      hoverManager.onNodeEnter("isolated", { x: 100, y: 100 });

      const highlightedEdges = hoverManager.getHighlightedEdgeIds();
      expect(highlightedEdges.size).toBe(0);
      expect(hoverManager.isNodeHighlighted("isolated")).toBe(true);
    });

    it("should rebuild edge lookup when edges change", () => {
      // Add a new edge
      const newEdges = [
        ...mockEdges,
        {
          id: "edge-new",
          source: "node-0",
          target: "node-3",
          label: "New Edge",
        },
      ];

      hoverManager.setEdges(newEdges);
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      const highlightedEdges = hoverManager.getHighlightedEdgeIds();
      expect(highlightedEdges.has("edge-0")).toBe(true);
      expect(highlightedEdges.has("edge-new")).toBe(true);
    });
  });

  describe("tooltip show event", () => {
    it("should emit tooltip:show event when tooltip is displayed", async () => {
      const mockProvider = createMockDataProvider();
      const mockRenderer = createMockRenderer();
      const listener = jest.fn();

      hoverManager.setDataProvider(mockProvider);
      hoverManager.setRenderer(mockRenderer);
      hoverManager.on("hover:tooltip:show", listener);

      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });

      // Advance timer and wait for async
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as HoverEvent;
      expect(event.type).toBe("hover:tooltip:show");
      expect(event.tooltipData).toBeDefined();
      expect(event.tooltipData?.id).toBe("node-0");
    });
  });

  describe("tooltip hide event", () => {
    it("should emit tooltip:hide event when tooltip is hidden", async () => {
      const mockProvider = createMockDataProvider();
      const mockRenderer = createMockRenderer();
      const listener = jest.fn();

      hoverManager.setDataProvider(mockProvider);
      hoverManager.setRenderer(mockRenderer);
      hoverManager.on("hover:tooltip:hide", listener);

      // Show tooltip first
      hoverManager.onNodeEnter("node-0", { x: 100, y: 100 });
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      // Now leave
      hoverManager.onNodeLeave();

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as HoverEvent;
      expect(event.type).toBe("hover:tooltip:hide");
    });
  });
});
