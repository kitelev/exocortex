/**
 * Tests for ContextMenuProviders - Built-in context menu providers
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  NodeContextMenuProvider,
  EdgeContextMenuProvider,
  CanvasContextMenuProvider,
  SelectionContextMenuProvider,
  createDefaultProviders,
  type ContextMenuCallbacks,
} from "../../../../../src/presentation/renderers/graph/ContextMenuProviders";
import type { ContextMenuTarget } from "../../../../../src/presentation/renderers/graph/ContextMenuManager";
import type { GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";

// Create mock nodes
function createMockNode(id: string, fx?: number | null): GraphNode {
  return {
    id,
    label: `Node ${id}`,
    path: `/path/to/${id}.md`,
    x: 100,
    y: 100,
    fx,
    size: 8,
  };
}

// Create mock edge
function createMockEdge(id: string, sourceId: string, targetId: string): GraphEdge {
  return {
    id,
    source: sourceId,
    target: targetId,
    label: `Edge ${id}`,
    property: "exo:relation",
  };
}

// Create mock callbacks
function createMockCallbacks(): Required<ContextMenuCallbacks> & {
  [K in keyof ContextMenuCallbacks]: jest.Mock;
} {
  return {
    onNavigate: jest.fn(),
    onOpenInNewPane: jest.fn(),
    onFocusNode: jest.fn(),
    onSelectNodes: jest.fn(),
    onExpandNode: jest.fn(),
    onCollapseNode: jest.fn(),
    onHideNodes: jest.fn(),
    onCopy: jest.fn(),
    onPinNode: jest.fn(),
    onUnpinNode: jest.fn(),
    onFitView: jest.fn(),
    onResetZoom: jest.fn(),
    onChangeLayout: jest.fn(),
    onCreateNode: jest.fn(),
    onShowDetails: jest.fn(),
    onSelectConnected: jest.fn(),
    onInvertSelection: jest.fn(),
  };
}

describe("NodeContextMenuProvider", () => {
  let provider: NodeContextMenuProvider;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let node: GraphNode;

  beforeEach(() => {
    callbacks = createMockCallbacks();
    provider = new NodeContextMenuProvider(callbacks);
    node = createMockNode("test-node");
  });

  describe("appliesTo", () => {
    it("should apply to node targets", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      expect(provider.appliesTo(target)).toBe(true);
    });

    it("should not apply to edge targets", () => {
      const edge = createMockEdge("edge-1", "node-1", "node-2");
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      expect(provider.appliesTo(target)).toBe(false);
    });

    it("should not apply to canvas targets", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 0, y: 0 } };
      expect(provider.appliesTo(target)).toBe(false);
    });

    it("should not apply to selection targets", () => {
      const target: ContextMenuTarget = { type: "selection", nodeIds: [], edgeIds: [] };
      expect(provider.appliesTo(target)).toBe(false);
    });
  });

  describe("getItems", () => {
    it("should return items for node target", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      expect(items.length).toBeGreaterThan(0);
      expect(items.some((item) => item.id === "open-file")).toBe(true);
      expect(items.some((item) => item.id === "focus-node")).toBe(true);
      expect(items.some((item) => item.id === "copy-path")).toBe(true);
    });

    it("should return empty array for non-node target", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 0, y: 0 } };
      const items = provider.getItems(target);
      expect(items).toEqual([]);
    });

    it("should call onNavigate when Open File is clicked", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const openItem = items.find((item) => item.id === "open-file");
      openItem?.action?.(target);

      expect(callbacks.onNavigate).toHaveBeenCalledWith(node.path);
    });

    it("should call onOpenInNewPane when Open in New Pane is clicked", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const openNewPaneItem = items.find((item) => item.id === "open-new-pane");
      openNewPaneItem?.action?.(target);

      expect(callbacks.onOpenInNewPane).toHaveBeenCalledWith(node.path);
    });

    it("should call onFocusNode when Focus in Graph is clicked", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const focusItem = items.find((item) => item.id === "focus-node");
      focusItem?.action?.(target);

      expect(callbacks.onFocusNode).toHaveBeenCalledWith(node.id);
    });

    it("should call onCopy with path when Copy File Path is clicked", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const copyItem = items.find((item) => item.id === "copy-path");
      copyItem?.action?.(target);

      expect(callbacks.onCopy).toHaveBeenCalledWith(node.path);
    });

    it("should call onCopy with link when Copy Obsidian Link is clicked", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const copyLinkItem = items.find((item) => item.id === "copy-link");
      copyLinkItem?.action?.(target);

      expect(callbacks.onCopy).toHaveBeenCalledWith(`[[${node.path}]]`);
    });

    it("should show Pin Position when node is not pinned", () => {
      const unpinnedNode = createMockNode("unpinned", undefined);
      const target: ContextMenuTarget = { type: "node", nodeId: unpinnedNode.id, node: unpinnedNode };
      const items = provider.getItems(target);

      const pinItem = items.find((item) => item.id === "pin-node");
      expect(pinItem).toBeDefined();
      expect(pinItem?.label).toBe("Pin Position");
    });

    it("should show Unpin Position when node is pinned", () => {
      const pinnedNode = createMockNode("pinned", 100);
      const target: ContextMenuTarget = { type: "node", nodeId: pinnedNode.id, node: pinnedNode };
      const items = provider.getItems(target);

      const unpinItem = items.find((item) => item.id === "unpin-node");
      expect(unpinItem).toBeDefined();
      expect(unpinItem?.label).toBe("Unpin Position");
    });

    it("should call onPinNode when Pin Position is clicked", () => {
      const unpinnedNode = createMockNode("unpinned", undefined);
      const target: ContextMenuTarget = { type: "node", nodeId: unpinnedNode.id, node: unpinnedNode };
      const items = provider.getItems(target);

      const pinItem = items.find((item) => item.id === "pin-node");
      pinItem?.action?.(target);

      expect(callbacks.onPinNode).toHaveBeenCalledWith(unpinnedNode.id);
    });

    it("should call onUnpinNode when Unpin Position is clicked", () => {
      const pinnedNode = createMockNode("pinned", 100);
      const target: ContextMenuTarget = { type: "node", nodeId: pinnedNode.id, node: pinnedNode };
      const items = provider.getItems(target);

      const unpinItem = items.find((item) => item.id === "unpin-node");
      unpinItem?.action?.(target);

      expect(callbacks.onUnpinNode).toHaveBeenCalledWith(pinnedNode.id);
    });

    it("should call onHideNodes when Hide from Graph is clicked", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const hideItem = items.find((item) => item.id === "hide-node");
      hideItem?.action?.(target);

      expect(callbacks.onHideNodes).toHaveBeenCalledWith([node.id]);
    });

    it("should have danger styling on Hide item", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const hideItem = items.find((item) => item.id === "hide-node");
      expect(hideItem?.danger).toBe(true);
    });

    it("should have Select Connected submenu", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const selectConnectedItem = items.find((item) => item.id === "select-connected");
      expect(selectConnectedItem?.submenu).toBeDefined();
      expect(selectConnectedItem?.submenu?.length).toBe(3);
    });

    it("should have Expand Neighbors submenu", () => {
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);

      const expandItem = items.find((item) => item.id === "expand-node");
      expect(expandItem?.submenu).toBeDefined();
      expect(expandItem?.submenu?.length).toBe(3);
    });
  });
});

describe("EdgeContextMenuProvider", () => {
  let provider: EdgeContextMenuProvider;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let nodes: Map<string, GraphNode>;
  let edge: GraphEdge;

  beforeEach(() => {
    callbacks = createMockCallbacks();
    nodes = new Map([
      ["source-node", createMockNode("source-node")],
      ["target-node", createMockNode("target-node")],
    ]);
    edge = createMockEdge("test-edge", "source-node", "target-node");
    provider = new EdgeContextMenuProvider(callbacks, (id) => nodes.get(id));
  });

  describe("appliesTo", () => {
    it("should apply to edge targets", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      expect(provider.appliesTo(target)).toBe(true);
    });

    it("should not apply to node targets", () => {
      const node = createMockNode("node-1");
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      expect(provider.appliesTo(target)).toBe(false);
    });
  });

  describe("getItems", () => {
    it("should return items for edge target", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      const items = provider.getItems(target);

      expect(items.length).toBeGreaterThan(0);
    });

    it("should include Go to Source item", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      const items = provider.getItems(target);

      const sourceItem = items.find((item) => item.id === "goto-source");
      expect(sourceItem).toBeDefined();
      expect(sourceItem?.label).toContain("source-node");
    });

    it("should include Go to Target item", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      const items = provider.getItems(target);

      const targetItem = items.find((item) => item.id === "goto-target");
      expect(targetItem).toBeDefined();
      expect(targetItem?.label).toContain("target-node");
    });

    it("should call onNavigate when Go to Source is clicked", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      const items = provider.getItems(target);

      const sourceItem = items.find((item) => item.id === "goto-source");
      sourceItem?.action?.(target);

      expect(callbacks.onNavigate).toHaveBeenCalledWith(nodes.get("source-node")?.path);
    });

    it("should call onFocusNode when Focus on Source is clicked", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      const items = provider.getItems(target);

      const focusSourceItem = items.find((item) => item.id === "focus-source");
      focusSourceItem?.action?.(target);

      expect(callbacks.onFocusNode).toHaveBeenCalledWith("source-node");
    });

    it("should include Copy Relationship item when edge has property", () => {
      const target: ContextMenuTarget = { type: "edge", edgeId: edge.id, edge };
      const items = provider.getItems(target);

      const copyItem = items.find((item) => item.id === "copy-relationship");
      expect(copyItem).toBeDefined();
    });

    it("should return empty array for non-edge target", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 0, y: 0 } };
      const items = provider.getItems(target);
      expect(items).toEqual([]);
    });
  });
});

describe("CanvasContextMenuProvider", () => {
  let provider: CanvasContextMenuProvider;
  let callbacks: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    callbacks = createMockCallbacks();
    provider = new CanvasContextMenuProvider(callbacks);
  });

  describe("appliesTo", () => {
    it("should apply to canvas targets", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 100, y: 100 } };
      expect(provider.appliesTo(target)).toBe(true);
    });

    it("should not apply to node targets", () => {
      const node = createMockNode("node-1");
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      expect(provider.appliesTo(target)).toBe(false);
    });
  });

  describe("getItems", () => {
    it("should return items for canvas target", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 100, y: 100 } };
      const items = provider.getItems(target);

      expect(items.length).toBeGreaterThan(0);
    });

    it("should include Fit to View item", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 100, y: 100 } };
      const items = provider.getItems(target);

      const fitItem = items.find((item) => item.id === "fit-view");
      expect(fitItem).toBeDefined();
    });

    it("should call onFitView when Fit to View is clicked", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 100, y: 100 } };
      const items = provider.getItems(target);

      const fitItem = items.find((item) => item.id === "fit-view");
      fitItem?.action?.(target);

      expect(callbacks.onFitView).toHaveBeenCalled();
    });

    it("should include Reset Zoom item", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 100, y: 100 } };
      const items = provider.getItems(target);

      const resetItem = items.find((item) => item.id === "reset-zoom");
      expect(resetItem).toBeDefined();
    });

    it("should have Layout submenu", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 100, y: 100 } };
      const items = provider.getItems(target);

      const layoutItem = items.find((item) => item.id === "layout");
      expect(layoutItem?.submenu).toBeDefined();
      expect(layoutItem?.submenu?.length).toBeGreaterThan(0);
    });

    it("should include Create New Note item", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 100, y: 100 } };
      const items = provider.getItems(target);

      const createItem = items.find((item) => item.id === "create-node");
      expect(createItem).toBeDefined();
    });

    it("should call onCreateNode with position when Create is clicked", () => {
      const position = { x: 150, y: 200 };
      const target: ContextMenuTarget = { type: "canvas", position };
      const items = provider.getItems(target);

      const createItem = items.find((item) => item.id === "create-node");
      createItem?.action?.(target);

      expect(callbacks.onCreateNode).toHaveBeenCalledWith(position);
    });

    it("should return empty array for non-canvas target", () => {
      const node = createMockNode("node-1");
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      const items = provider.getItems(target);
      expect(items).toEqual([]);
    });
  });
});

describe("SelectionContextMenuProvider", () => {
  let provider: SelectionContextMenuProvider;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let nodes: Map<string, GraphNode>;

  beforeEach(() => {
    callbacks = createMockCallbacks();
    nodes = new Map([
      ["node-1", createMockNode("node-1")],
      ["node-2", createMockNode("node-2")],
      ["node-3", createMockNode("node-3")],
    ]);
    provider = new SelectionContextMenuProvider(callbacks, (id) => nodes.get(id));
  });

  describe("appliesTo", () => {
    it("should apply to selection targets", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2"],
        edgeIds: [],
      };
      expect(provider.appliesTo(target)).toBe(true);
    });

    it("should not apply to node targets", () => {
      const node = createMockNode("node-1");
      const target: ContextMenuTarget = { type: "node", nodeId: node.id, node };
      expect(provider.appliesTo(target)).toBe(false);
    });
  });

  describe("getItems", () => {
    it("should return items for selection target", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2"],
        edgeIds: [],
      };
      const items = provider.getItems(target);

      expect(items.length).toBeGreaterThan(0);
    });

    it("should show selection count in disabled info item", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2", "node-3"],
        edgeIds: ["edge-1"],
      };
      const items = provider.getItems(target);

      const infoItem = items.find((item) => item.id === "selection-info");
      expect(infoItem).toBeDefined();
      expect(infoItem?.disabled).toBe(true);
      expect(infoItem?.label).toContain("3 nodes");
      expect(infoItem?.label).toContain("1 edge");
    });

    it("should include Focus Selected Nodes item", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2"],
        edgeIds: [],
      };
      const items = provider.getItems(target);

      const focusItem = items.find((item) => item.id === "focus-selection");
      expect(focusItem).toBeDefined();
    });

    it("should include Copy All Paths item", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2"],
        edgeIds: [],
      };
      const items = provider.getItems(target);

      const copyItem = items.find((item) => item.id === "copy-all-paths");
      expect(copyItem).toBeDefined();
    });

    it("should call onCopy with all paths when Copy All Paths is clicked", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2"],
        edgeIds: [],
      };
      const items = provider.getItems(target);

      const copyItem = items.find((item) => item.id === "copy-all-paths");
      copyItem?.action?.(target);

      expect(callbacks.onCopy).toHaveBeenCalledWith(
        expect.stringContaining("/path/to/node-1.md")
      );
    });

    it("should include Invert Selection item", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1"],
        edgeIds: [],
      };
      const items = provider.getItems(target);

      const invertItem = items.find((item) => item.id === "invert-selection");
      expect(invertItem).toBeDefined();
    });

    it("should include Hide Selected item with danger styling", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2"],
        edgeIds: [],
      };
      const items = provider.getItems(target);

      const hideItem = items.find((item) => item.id === "hide-selection");
      expect(hideItem).toBeDefined();
      expect(hideItem?.danger).toBe(true);
    });

    it("should call onHideNodes with all selected node IDs", () => {
      const target: ContextMenuTarget = {
        type: "selection",
        nodeIds: ["node-1", "node-2", "node-3"],
        edgeIds: [],
      };
      const items = provider.getItems(target);

      const hideItem = items.find((item) => item.id === "hide-selection");
      hideItem?.action?.(target);

      expect(callbacks.onHideNodes).toHaveBeenCalledWith(["node-1", "node-2", "node-3"]);
    });

    it("should return empty array for non-selection target", () => {
      const target: ContextMenuTarget = { type: "canvas", position: { x: 0, y: 0 } };
      const items = provider.getItems(target);
      expect(items).toEqual([]);
    });
  });
});

describe("createDefaultProviders", () => {
  it("should create all default providers", () => {
    const callbacks = createMockCallbacks();
    const nodes = new Map<string, GraphNode>();
    const providers = createDefaultProviders(callbacks, (id) => nodes.get(id));

    expect(providers.length).toBe(4);
    expect(providers.some((p) => p instanceof NodeContextMenuProvider)).toBe(true);
    expect(providers.some((p) => p instanceof EdgeContextMenuProvider)).toBe(true);
    expect(providers.some((p) => p instanceof CanvasContextMenuProvider)).toBe(true);
    expect(providers.some((p) => p instanceof SelectionContextMenuProvider)).toBe(true);
  });
});
