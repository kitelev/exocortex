# Interactions Guide

This guide covers user interactions including selection, dragging, zooming, and keyboard navigation.

## Selection

### Single Selection

```typescript
import { SelectionManager, DEFAULT_SELECTION_MANAGER_CONFIG } from "@exocortex/obsidian-plugin";

const selectionManager = new SelectionManager({
  multiSelect: false,      // Only single selection
  clearOnBackground: true, // Clear when clicking background
});

selectionManager.on("select", (event) => {
  const selectedId = event.nodeIds[0];
  highlightNode(selectedId);
  showNodeDetails(selectedId);
});
```

### Multi-Selection

```typescript
const selectionManager = new SelectionManager({
  multiSelect: true,       // Allow multiple selection
  boxSelect: true,         // Enable box selection
  boxSelectKey: "shift",   // Hold Shift for box select
});

// Handle selection changes
selectionManager.on("select", (event) => {
  console.log("Selected:", event.nodeIds);
  console.log("Mode:", event.mode);  // "single", "multi", "box"

  // Highlight all selected
  for (const nodeId of event.nodeIds) {
    setNodeHighlight(nodeId, true);
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    selectionManager.selectAll(nodes);
  }

  if (e.key === "Escape") {
    selectionManager.clearSelection();
  }
});
```

### Box Selection

```typescript
selectionManager.on("boxStart", (event) => {
  console.log("Box started at", event.x, event.y);
  showSelectionRectangle();
});

selectionManager.on("boxUpdate", (event) => {
  updateSelectionRectangle(event.rect);
});

selectionManager.on("boxEnd", (event) => {
  hideSelectionRectangle();
  console.log("Box selected:", event.nodeIds);
});
```

## Hover and Tooltips

### Basic Hover

```typescript
import { HoverManager, DEFAULT_HOVER_MANAGER_CONFIG } from "@exocortex/obsidian-plugin";

const hoverManager = new HoverManager({
  hoverDelay: 200,         // Wait before hover triggers
  leaveDelay: 100,         // Wait before hover ends
  showNeighborHighlight: true,  // Highlight connected nodes
});

hoverManager.on("enter", (event) => {
  // Highlight node and neighbors
  setNodeHover(event.targetId, true);
  for (const neighborId of getNeighbors(event.targetId)) {
    setNodeConnected(neighborId, true);
  }

  // Show tooltip
  showTooltip(event.targetId, event.clientPosition);
});

hoverManager.on("leave", (event) => {
  // Clear highlights
  setNodeHover(event.targetId, false);
  clearConnectedHighlights();

  // Hide tooltip
  hideTooltip();
});
```

### Rich Tooltips

```typescript
import { TooltipRenderer, GraphTooltipDataProvider } from "@exocortex/obsidian-plugin";

const tooltipProvider = new GraphTooltipDataProvider({
  tripleStore: myTripleStore,
  fileContentProvider: {
    getContent: async (path) => await vault.read(path),
  },
});

const tooltipRenderer = new TooltipRenderer({
  maxWidth: 300,
  showPreview: true,
  showMetadata: true,
});

hoverManager.on("enter", async (event) => {
  const data = await tooltipProvider.getData(event.targetId);
  tooltipRenderer.show(data, event.clientPosition);
});

hoverManager.on("leave", () => {
  tooltipRenderer.hide();
});
```

## Pan and Zoom

### Viewport Control

```typescript
import { ViewportController, DEFAULT_VIEWPORT_CONTROLLER_CONFIG } from "@exocortex/obsidian-plugin";

const viewport = new ViewportController(container, {
  pannable: true,
  zoomable: true,
  minZoom: 0.1,
  maxZoom: 4,
  zoomSpeed: 1,
  panSpeed: 1,
  wheelZoom: true,
  pinchZoom: true,        // Mobile support
  doubleTapZoom: true,
});

viewport.on("change", (event) => {
  // Update render transform
  renderer.setTransform(event.x, event.y, event.scale);

  // Update level of detail
  updateLOD(event.scale);
});
```

### Programmatic Control

```typescript
// Zoom to specific level
viewport.zoomTo(2);  // 200%

// Pan to position
viewport.panTo(500, 300);

// Fit all nodes in view
viewport.fitToView(nodes, { padding: 50 });

// Center on specific node
viewport.centerOnNode(nodeId);

// Animate to position
viewport.animateTo({
  x: 100,
  y: 100,
  scale: 1.5,
  duration: 500,
  easing: "easeInOutCubic",
});
```

### Zoom Constraints

```typescript
const viewport = new ViewportController(container, {
  minZoom: 0.1,
  maxZoom: 4,
  boundingBox: {
    minX: -1000,
    minY: -1000,
    maxX: 2000,
    maxY: 2000,
  },
});
```

## Drag and Drop

### Node Dragging

```typescript
import { ForceSimulation } from "@exocortex/obsidian-plugin";

let draggedNode: SimulationNode | null = null;

function onDragStart(nodeId: string, x: number, y: number): void {
  draggedNode = nodes.find((n) => n.id === nodeId) || null;
  if (!draggedNode) return;

  // Pin node
  draggedNode.fx = x;
  draggedNode.fy = y;

  // Reheat simulation
  simulation.alphaTarget(0.3).restart();
}

function onDrag(x: number, y: number): void {
  if (!draggedNode) return;

  // Update position
  draggedNode.fx = x;
  draggedNode.fy = y;
}

function onDragEnd(): void {
  if (!draggedNode) return;

  // Unpin (or keep pinned for sticky nodes)
  draggedNode.fx = null;
  draggedNode.fy = null;
  draggedNode = null;

  // Let simulation cool
  simulation.alphaTarget(0);
}
```

### Sticky Nodes

Keep nodes pinned after drag:

```typescript
const pinnedNodes = new Set<string>();

function onDragEnd(): void {
  if (!draggedNode) return;

  if (keepPinned) {
    // Keep node pinned
    pinnedNodes.add(draggedNode.id);
    // Don't clear fx/fy
  } else {
    // Release node
    draggedNode.fx = null;
    draggedNode.fy = null;
  }

  draggedNode = null;
}

// Double-click to unpin
function onDoubleClick(nodeId: string): void {
  if (pinnedNodes.has(nodeId)) {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
      pinnedNodes.delete(nodeId);
    }
  }
}
```

## Keyboard Navigation

### Setup

```typescript
import { KeyboardManager, NavigationManager, DEFAULT_KEY_BINDINGS } from "@exocortex/obsidian-plugin";

const keyboardManager = new KeyboardManager({
  enabled: true,
  trapFocus: false,
  keyBindings: DEFAULT_KEY_BINDINGS,
});

const navigationManager = new NavigationManager({
  mode: "spatial",  // spatial, graph, semantic
});
```

### Spatial Navigation

Navigate to visually closest node:

```typescript
keyboardManager.on("action", (event) => {
  switch (event.action) {
    case "navigate-up":
      navigationManager.navigate("up", currentNode, nodes);
      break;
    case "navigate-down":
      navigationManager.navigate("down", currentNode, nodes);
      break;
    case "navigate-left":
      navigationManager.navigate("left", currentNode, nodes);
      break;
    case "navigate-right":
      navigationManager.navigate("right", currentNode, nodes);
      break;
  }
});

navigationManager.on("navigate", (event) => {
  setFocus(event.toNodeId);
  viewport.centerOnNode(event.toNodeId);
});
```

### Graph Navigation

Navigate along edges:

```typescript
const navigationManager = new NavigationManager({
  mode: "graph",
});

// Navigate to connected nodes
keyboardManager.on("action", (event) => {
  switch (event.action) {
    case "navigate-in":
      // Follow outgoing edges
      navigationManager.navigateToChild(currentNode, edges);
      break;
    case "navigate-out":
      // Follow incoming edges
      navigationManager.navigateToParent(currentNode, edges);
      break;
    case "navigate-next":
      // Next sibling (same parent)
      navigationManager.navigateToSibling(currentNode, 1, edges);
      break;
    case "navigate-prev":
      // Previous sibling
      navigationManager.navigateToSibling(currentNode, -1, edges);
      break;
  }
});
```

### Custom Key Bindings

```typescript
const customBindings = [
  ...DEFAULT_KEY_BINDINGS,
  { key: "Enter", action: "open-node", context: "node" },
  { key: "Delete", action: "delete-node", context: "node" },
  { key: "e", action: "edit-node", context: "node" },
  { key: "c", modifiers: ["ctrl"], action: "copy-node" },
  { key: "v", modifiers: ["ctrl"], action: "paste-node" },
  { key: "?", action: "show-help" },
];

keyboardManager.on("action", (event) => {
  switch (event.action) {
    case "open-node":
      openNode(currentNodeId);
      break;
    case "show-help":
      showShortcutHelp();
      break;
  }
});
```

## Context Menu

### Setup

```typescript
import {
  ContextMenuManager,
  ContextMenuRenderer,
  createDefaultProviders,
} from "@exocortex/obsidian-plugin";

const contextMenuManager = new ContextMenuManager();
const contextMenuRenderer = new ContextMenuRenderer(container);

// Add default providers
const providers = createDefaultProviders({
  onOpenNode: (nodeId) => openNode(nodeId),
  onDeleteNode: (nodeId) => deleteNode(nodeId),
  onFocusNode: (nodeId) => focusNode(nodeId),
});

for (const provider of Object.values(providers)) {
  contextMenuManager.addProvider(provider);
}

contextMenuManager.on("open", (event) => {
  contextMenuRenderer.show(event.items, event.position);
});

contextMenuManager.on("close", () => {
  contextMenuRenderer.hide();
});
```

### Custom Menu Items

```typescript
import { ContextMenuProvider, ContextMenuItem } from "@exocortex/obsidian-plugin";

const customProvider: ContextMenuProvider = {
  id: "custom",
  getItems(target) {
    if (target.type !== "node") return [];

    return [
      {
        id: "copy-link",
        label: "Copy link",
        icon: "link",
        action: () => copyToClipboard(`[[${target.id}]]`),
      },
      {
        id: "submenu",
        label: "More options",
        submenu: [
          { id: "opt1", label: "Option 1", action: () => {} },
          { id: "opt2", label: "Option 2", action: () => {} },
        ],
      },
      {
        id: "delete",
        label: "Delete",
        icon: "trash",
        shortcut: "Delete",
        action: () => deleteNode(target.id),
        disabled: isSystemNode(target.id),
      },
    ];
  },
};

contextMenuManager.addProvider(customProvider);
```

## Focus Management

### Focus Indicator

```typescript
import { FocusIndicator, DEFAULT_FOCUS_INDICATOR_STYLE } from "@exocortex/obsidian-plugin";

const focusIndicator = new FocusIndicator(renderer.app, {
  style: {
    color: 0x6366f1,
    width: 3,
    dashPattern: null,
    glowEnabled: true,
    glowColor: 0x6366f1,
    glowAlpha: 0.3,
    glowBlur: 10,
  },
  animationDuration: 200,
});

// Show focus on navigation
navigationManager.on("focus", (event) => {
  focusIndicator.show(event.nodeId);
});

// Hide on selection change
selectionManager.on("select", () => {
  focusIndicator.hide();
});
```

### Tab Order

```typescript
// Set logical tab order
const tabOrder = computeTabOrder(nodes, edges);

keyboardManager.on("action", (event) => {
  if (event.action === "tab-next") {
    const currentIndex = tabOrder.indexOf(currentNodeId);
    const nextIndex = (currentIndex + 1) % tabOrder.length;
    setFocus(tabOrder[nextIndex]);
  }

  if (event.action === "tab-prev") {
    const currentIndex = tabOrder.indexOf(currentNodeId);
    const prevIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
    setFocus(tabOrder[prevIndex]);
  }
});
```

## Touch Gestures

### Mobile Support

```typescript
const viewport = new ViewportController(container, {
  pinchZoom: true,        // Two-finger zoom
  doubleTapZoom: true,    // Double-tap to zoom in
  pannable: true,         // One-finger pan
  touchThreshold: 10,     // Pixels before pan starts
});

// Long press for context menu
let longPressTimer: number | null = null;

container.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    longPressTimer = window.setTimeout(() => {
      const nodeId = getNodeAtPoint(touch.clientX, touch.clientY);
      if (nodeId) {
        contextMenuManager.show({ type: "node", id: nodeId }, {
          x: touch.clientX,
          y: touch.clientY,
        });
      }
    }, 500);
  }
});

container.addEventListener("touchend", () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
});
```

## See Also

- [Events API](../api/events.md) - Event reference
- [Keyboard Manager](../api/events.md#keyboard-events) - Keyboard shortcuts
- [Accessibility](./accessibility.md) - Accessible interactions
