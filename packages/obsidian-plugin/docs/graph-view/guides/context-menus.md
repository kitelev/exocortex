# Context Menu Architecture

The Context Menu system provides extensible right-click menus for graph nodes, edges, and canvas with keyboard navigation, submenus, and accessibility support.

## Overview

The context menu architecture consists of three main components:

- **ContextMenuManager**: Orchestrates menu display, action execution, and event handling
- **ContextMenuProvider**: Interface for pluggable menu item sources
- **ContextMenuRenderer**: DOM-based rendering with keyboard navigation and animations

## Architecture

```
┌────────────────────────────────────────────────────┐
│                ContextMenuManager                   │
├────────────────────────────────────────────────────┤
│  Providers Registry                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────┐  │
│  │ NodeProvider │ │ EdgeProvider │ │CanvasProvider│ │
│  └──────────────┘ └──────────────┘ └────────────┘  │
├────────────────────────────────────────────────────┤
│  ContextMenuRenderer                                │
│  (DOM rendering, keyboard nav, submenus)           │
└────────────────────────────────────────────────────┘
```

## Basic Usage

```typescript
import {
  ContextMenuManager,
  ContextMenuRenderer,
  NodeContextMenuProvider,
  EdgeContextMenuProvider,
  CanvasContextMenuProvider,
} from "./presentation/renderers/graph";

// Create renderer
const renderer = new ContextMenuRenderer(document.body, {
  classPrefix: "exo-context-menu",
  maxWidth: 240,
});

// Create manager
const contextMenu = new ContextMenuManager({
  renderer,
  config: {
    closeOnAction: true,
    closeOnOutsideClick: true,
    closeOnEscape: true,
  },
});

// Register providers
contextMenu.registerProvider(new NodeContextMenuProvider(callbacks));
contextMenu.registerProvider(new EdgeContextMenuProvider(callbacks, getNode));
contextMenu.registerProvider(new CanvasContextMenuProvider(callbacks));

// Show on right-click
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const node = hitTest(e.clientX, e.clientY);
  if (node) {
    contextMenu.showForNode(node.id, { x: e.clientX, y: e.clientY });
  } else {
    contextMenu.showForCanvas(
      { x: worldX, y: worldY },
      { x: e.clientX, y: e.clientY }
    );
  }
});
```

## Menu Targets

Context menus can target different graph elements:

### Node Target

```typescript
contextMenu.showForNode(nodeId, screenPosition);

// Or manually
contextMenu.show(
  { type: "node", nodeId: "node-1", node: nodeData },
  { x: 100, y: 100 }
);
```

### Edge Target

```typescript
contextMenu.showForEdge(edgeId, screenPosition);

// Or manually
contextMenu.show(
  { type: "edge", edgeId: "edge-1", edge: edgeData },
  { x: 100, y: 100 }
);
```

### Canvas Target

```typescript
contextMenu.showForCanvas(worldPosition, screenPosition);

// Or manually
contextMenu.show(
  { type: "canvas", position: { x: worldX, y: worldY } },
  { x: 100, y: 100 }
);
```

### Selection Target

```typescript
// Multi-select context menu
contextMenu.show(
  {
    type: "selection",
    nodeIds: ["node-1", "node-2", "node-3"],
    edgeIds: ["edge-1"],
  },
  { x: 100, y: 100 }
);
```

## Creating Custom Providers

Implement the `ContextMenuProvider` interface to add custom menu items:

```typescript
import type {
  ContextMenuProvider,
  ContextMenuItem,
  ContextMenuTarget,
} from "./presentation/renderers/graph";

class CustomProvider implements ContextMenuProvider {
  readonly id = "custom-provider";
  readonly priority = 50; // Higher = earlier in menu

  appliesTo(target: ContextMenuTarget): boolean {
    // Only apply to nodes with specific metadata
    return target.type === "node" && target.node.metadata?.isCustom === true;
  }

  getItems(target: ContextMenuTarget): ContextMenuItem[] {
    if (target.type !== "node") return [];

    return [
      {
        id: "custom-action-1",
        label: "Custom Action",
        icon: "custom-icon",
        shortcut: "⌘K",
        action: (target) => {
          console.log("Custom action on:", target.nodeId);
        },
      },
      {
        id: "custom-submenu",
        label: "More Actions",
        submenu: [
          {
            id: "sub-action-1",
            label: "Sub Action 1",
            action: () => console.log("Sub action 1"),
          },
          {
            id: "sub-action-2",
            label: "Sub Action 2",
            action: () => console.log("Sub action 2"),
          },
        ],
      },
    ];
  }
}

contextMenu.registerProvider(new CustomProvider());
```

## Menu Item Structure

```typescript
interface ContextMenuItem {
  /** Unique identifier for the item */
  id: string;

  /** Display label */
  label: string;

  /** Optional icon (CSS class or icon name) */
  icon?: string;

  /** Optional keyboard shortcut display */
  shortcut?: string;

  /** Whether the item is disabled */
  disabled?: boolean;

  /** Whether this is a danger action (red styling) */
  danger?: boolean;

  /** Optional submenu items */
  submenu?: ContextMenuItem[];

  /** Action to execute when clicked */
  action?: (target: ContextMenuTarget) => void | Promise<void>;

  /** Show separator after this item */
  separator?: boolean;
}
```

## Built-in Providers

### NodeContextMenuProvider

Default actions for nodes:

| Action             | Shortcut | Description                       |
| ------------------ | -------- | --------------------------------- |
| Open in Obsidian   | Enter    | Navigate to file                  |
| Open in New Pane   | ⌘Enter   | Open in split pane                |
| Focus in Graph     | F        | Center viewport on node           |
| Select Connected   | -        | Select neighboring nodes          |
| Expand Neighbors   | -        | Show 1/2/3 levels of connections  |
| Collapse Node      | -        | Hide neighboring nodes            |
| Copy File Path     | -        | Copy to clipboard                 |
| Copy Obsidian Link | -        | Copy `[[file]]` link              |
| Pin/Unpin Position | -        | Lock node position                |
| Show Details       | -        | Open details panel                |
| Hide from Graph    | -        | Remove from view (danger action)  |

### EdgeContextMenuProvider

Default actions for edges:

| Action           | Description           |
| ---------------- | --------------------- |
| Go to Source     | Navigate to source    |
| Go to Target     | Navigate to target    |
| Focus on Source  | Center on source node |
| Focus on Target  | Center on target node |
| Copy Relationship| Copy relationship text|
| Show Edge Details| Open details panel    |

### CanvasContextMenuProvider

Default actions for canvas background:

| Action       | Shortcut | Description          |
| ------------ | -------- | -------------------- |
| Fit to View  | ⌘0       | Fit all nodes        |
| Reset Zoom   | ⌘1       | Reset to 100%        |
| Layout       | -        | Change layout algorithm |
| Create Note  | -        | Create new node      |

### SelectionContextMenuProvider

Default actions for multi-selection:

| Action           | Description                  |
| ---------------- | ---------------------------- |
| Selection Info   | Shows count (disabled label) |
| Focus Selected   | Center on selection          |
| Expand All       | Expand all selected nodes    |
| Copy All Paths   | Copy all file paths          |
| Copy All Links   | Copy all Obsidian links      |
| Invert Selection | Select unselected nodes      |
| Hide Selected    | Remove from view             |

## Configuration

### Manager Configuration

```typescript
interface ContextMenuManagerConfig {
  /** Delay in ms before auto-hiding on mouse leave */
  hideDelay: number;

  /** Maximum width of the menu in pixels */
  maxWidth: number;

  /** Prevent default browser context menu */
  preventDefaultContextMenu: boolean;

  /** Close menu on item click */
  closeOnAction: boolean;

  /** Close menu on outside click */
  closeOnOutsideClick: boolean;

  /** Close menu on Escape key */
  closeOnEscape: boolean;
}
```

### Renderer Configuration

```typescript
interface ContextMenuRendererConfig {
  /** CSS class prefix for styling */
  classPrefix: string;

  /** Maximum width of the menu */
  maxWidth: number;

  /** Offset from cursor position */
  offset: Point;

  /** Animation duration in ms */
  animationDuration: number;

  /** Z-index for the menu */
  zIndex: number;

  /** Enable keyboard navigation */
  enableKeyboardNavigation: boolean;

  /** Submenu open delay in ms */
  submenuDelay: number;
}
```

## Events

```typescript
// Menu shown
contextMenu.on("contextmenu:show", (event) => {
  console.log("Menu shown at:", event.position);
  console.log("Target:", event.target);
});

// Menu hidden
contextMenu.on("contextmenu:hide", (event) => {
  console.log("Menu hidden");
});

// Action executed
contextMenu.on("contextmenu:action", (event) => {
  console.log("Action:", event.actionItem?.id);
  console.log("Target:", event.target);
});

// Submenu events
contextMenu.on("contextmenu:submenu:open", (event) => {
  console.log("Submenu opened:", event.submenuItem?.id);
});

contextMenu.on("contextmenu:submenu:close", (event) => {
  console.log("Submenu closed");
});
```

## Keyboard Navigation

The renderer supports full keyboard navigation:

| Key        | Action                           |
| ---------- | -------------------------------- |
| ↓          | Move to next item                |
| ↑          | Move to previous item            |
| →          | Open submenu                     |
| ←          | Close submenu                    |
| Enter      | Execute action                   |
| Space      | Execute action                   |
| Escape     | Close menu                       |
| Home       | Jump to first item               |
| End        | Jump to last item                |

## Styling

The renderer applies CSS classes for styling:

```css
/* Main menu container */
.exo-context-menu {
  position: fixed;
  background: var(--background-primary);
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  padding: 4px 0;
  opacity: 0;
  transform: scale(0.95);
  transition: opacity 0.15s, transform 0.15s;
}

.exo-context-menu--visible {
  opacity: 1;
  transform: scale(1);
}

/* Menu items */
.exo-context-menu__item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
}

.exo-context-menu__item:hover,
.exo-context-menu__item--focused {
  background: var(--background-modifier-hover);
}

.exo-context-menu__item--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.exo-context-menu__item--danger {
  color: var(--text-error);
}

/* Icon, label, shortcut */
.exo-context-menu__icon {
  width: 16px;
  height: 16px;
  margin-right: 8px;
}

.exo-context-menu__label {
  flex: 1;
}

.exo-context-menu__shortcut {
  opacity: 0.6;
  font-size: 0.9em;
  margin-left: 16px;
}

/* Separator */
.exo-context-menu__separator {
  height: 1px;
  background: var(--background-modifier-border);
  margin: 4px 8px;
}

/* Submenu arrow */
.exo-context-menu__arrow {
  margin-left: 8px;
}
```

## Accessibility

The context menu includes ARIA attributes for accessibility:

```html
<div class="exo-context-menu" role="menu" aria-label="Context menu">
  <div class="exo-context-menu__item" role="menuitem" tabindex="-1">
    Open in Obsidian
  </div>
  <div class="exo-context-menu__item" role="menuitem" aria-haspopup="true" aria-expanded="false">
    More Actions
  </div>
  <div class="exo-context-menu__separator" role="separator"></div>
  <div class="exo-context-menu__item" role="menuitem" aria-disabled="true">
    Disabled Action
  </div>
</div>
```

## Integration Example

Complete context menu integration:

```typescript
import {
  ContextMenuManager,
  ContextMenuRenderer,
  createDefaultProviders,
  ViewportController,
  SelectionManager,
} from "./presentation/renderers/graph";

// Setup
const container = document.getElementById("graph-container");
const viewport = new ViewportController(container);
const selection = new SelectionManager();

// Create context menu
const renderer = new ContextMenuRenderer(document.body);
const contextMenu = new ContextMenuManager({ renderer });

// Define callbacks for menu actions
const callbacks = {
  onNavigate: (path) => app.workspace.openLinkText(path, ""),
  onOpenInNewPane: (path) => app.workspace.openLinkText(path, "", true),
  onFocusNode: (nodeId) => viewport.focusOnNode(nodeId),
  onSelectNodes: (nodeIds) => selection.selectMultiple(nodeIds),
  onExpandNode: (nodeId, depth) => expandNeighbors(nodeId, depth),
  onCollapseNode: (nodeId) => collapseNode(nodeId),
  onHideNodes: (nodeIds) => hideNodes(nodeIds),
  onCopy: (text) => navigator.clipboard.writeText(text),
  onPinNode: (nodeId) => pinNode(nodeId),
  onUnpinNode: (nodeId) => unpinNode(nodeId),
  onFitView: () => viewport.fitToView(),
  onResetZoom: () => viewport.setZoom(1),
  onChangeLayout: (algo) => changeLayout(algo),
  onCreateNode: (pos) => createNodeAt(pos),
  onShowDetails: (type, id) => showDetailsPanel(type, id),
  onSelectConnected: (nodeId, dir) => selectConnected(nodeId, dir),
  onInvertSelection: () => selection.invert(),
};

// Register providers
const providers = createDefaultProviders(callbacks, (id) =>
  graphData.nodes.find((n) => n.id === id)
);
providers.forEach((p) => contextMenu.registerProvider(p));

// Provide node/edge data
contextMenu.setNodes(graphData.nodes);
contextMenu.setEdges(graphData.edges);

// Connect selection state
selection.on("change", (event) => {
  contextMenu.setSelection(event.nodeIds, event.edgeIds);
});

// Handle right-click
container.addEventListener("contextmenu", (e) => {
  e.preventDefault();

  const screenPos = { x: e.clientX, y: e.clientY };
  const worldPos = viewport.screenToWorld(e.clientX, e.clientY);

  const node = hitTestNode(worldPos);
  const edge = hitTestEdge(worldPos);

  if (node) {
    contextMenu.showForNode(node.id, screenPos);
  } else if (edge) {
    contextMenu.showForEdge(edge.id, screenPos);
  } else {
    contextMenu.showForCanvas(worldPos, screenPos);
  }
});

// Cleanup
function destroy() {
  contextMenu.destroy();
  viewport.destroy();
  selection.destroy();
}
```

## See Also

- [Interactions](./interactions.md) - General interaction handling
- [Touch Gestures](./touch-gestures.md) - Mobile context menu support
- [Accessibility](./accessibility.md) - WCAG compliance
