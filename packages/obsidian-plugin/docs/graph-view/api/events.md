# Events API

The Graph View uses a consistent event system across all managers and components.

## Event System Overview

All managers implement a common event pattern:

```typescript
// Subscribe to events
manager.on("eventType", callback);

// Unsubscribe
manager.off("eventType", callback);

// One-time subscription
manager.once("eventType", callback);
```

## Simulation Events

### ForceSimulation

```typescript
import { ForceSimulation } from "@exocortex/obsidian-plugin";

const simulation = new ForceSimulation();

// Tick event - fired on each simulation step
simulation.on("tick", () => {
  // Update rendering
  render();
});

// End event - fired when simulation cools down
simulation.on("end", () => {
  console.log("Simulation complete");
  // Save positions, enable interactions, etc.
});
```

## Selection Events

### SelectionManager

```typescript
import { SelectionManager } from "@exocortex/obsidian-plugin";
import type { SelectionEvent } from "@exocortex/obsidian-plugin";

const selectionManager = new SelectionManager();

// Selection changed
selectionManager.on("select", (event: SelectionEvent) => {
  console.log("Selected nodes:", event.nodeIds);
  console.log("Selected edges:", event.edgeIds);
  console.log("Selection mode:", event.mode);  // "single" | "multi" | "box"
});

// Selection cleared
selectionManager.on("clear", () => {
  console.log("Selection cleared");
});

// Box selection started
selectionManager.on("boxStart", (event: { x: number; y: number }) => {
  console.log("Box selection started at", event.x, event.y);
});

// Box selection updated
selectionManager.on("boxUpdate", (event: { rect: Rect }) => {
  console.log("Box selection rect:", event.rect);
});

// Box selection ended
selectionManager.on("boxEnd", (event: { nodeIds: string[] }) => {
  console.log("Box selected nodes:", event.nodeIds);
});
```

### SelectionEvent Type

```typescript
interface SelectionEvent {
  type: "select" | "deselect" | "toggle";
  nodeIds: string[];
  edgeIds: string[];
  mode: "single" | "multi" | "box";
  previousSelection: {
    nodeIds: string[];
    edgeIds: string[];
  };
}
```

## Hover Events

### HoverManager

```typescript
import { HoverManager } from "@exocortex/obsidian-plugin";
import type { HoverEvent } from "@exocortex/obsidian-plugin";

const hoverManager = new HoverManager();

// Hover enter
hoverManager.on("enter", (event: HoverEvent) => {
  console.log("Hovered:", event.targetId);
  console.log("Target type:", event.targetType);  // "node" | "edge"
  console.log("Position:", event.position);
  showTooltip(event.targetId, event.position);
});

// Hover leave
hoverManager.on("leave", (event: HoverEvent) => {
  hideTooltip();
});

// Tooltip data ready
hoverManager.on("tooltipData", (event: { data: TooltipData }) => {
  updateTooltipContent(event.data);
});
```

### HoverEvent Type

```typescript
interface HoverEvent {
  type: "enter" | "leave" | "move";
  targetId: string;
  targetType: "node" | "edge" | null;
  position: { x: number; y: number };
  clientPosition: { x: number; y: number };
}
```

## Viewport Events

### ViewportController

```typescript
import { ViewportController } from "@exocortex/obsidian-plugin";
import type { ViewportEvent } from "@exocortex/obsidian-plugin";

const viewportController = new ViewportController(container);

// Viewport changed (pan or zoom)
viewportController.on("change", (event: ViewportEvent) => {
  console.log("Position:", event.x, event.y);
  console.log("Scale:", event.scale);
  console.log("Change type:", event.changeType);  // "pan" | "zoom" | "both"
});

// Zoom started
viewportController.on("zoomStart", (event: { scale: number }) => {
  console.log("Zoom started at", event.scale);
});

// Zoom ended
viewportController.on("zoomEnd", (event: { scale: number }) => {
  console.log("Zoom ended at", event.scale);
});

// Pan started
viewportController.on("panStart", (event: { x: number; y: number }) => {
  console.log("Pan started");
});

// Pan ended
viewportController.on("panEnd", (event: { x: number; y: number }) => {
  console.log("Pan ended");
});
```

### ViewportEvent Type

```typescript
interface ViewportEvent {
  type: "change" | "zoomStart" | "zoomEnd" | "panStart" | "panEnd";
  x: number;
  y: number;
  scale: number;
  changeType: "pan" | "zoom" | "both";
  delta?: { x: number; y: number; scale: number };
}
```

## Keyboard Events

### KeyboardManager

```typescript
import { KeyboardManager } from "@exocortex/obsidian-plugin";
import type { KeyboardEvent_Custom } from "@exocortex/obsidian-plugin";

const keyboardManager = new KeyboardManager();

// Action triggered
keyboardManager.on("action", (event: KeyboardEvent_Custom) => {
  console.log("Action:", event.action);
  console.log("Key:", event.key);
  console.log("Modifiers:", event.modifiers);

  switch (event.action) {
    case "navigate-up":
      navigateToNeighbor("up");
      break;
    case "select-all":
      selectAll();
      break;
    case "delete":
      deleteSelected();
      break;
  }
});

// Key pressed (raw event)
keyboardManager.on("keydown", (event: KeyboardEvent) => {
  console.log("Key pressed:", event.key);
});
```

### KeyboardEvent_Custom Type

```typescript
interface KeyboardEvent_Custom {
  action: string;
  key: string;
  modifiers: {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
  };
  context: "node" | "edge" | "viewport" | "any";
  originalEvent: KeyboardEvent;
}
```

## Navigation Events

### NavigationManager

```typescript
import { NavigationManager } from "@exocortex/obsidian-plugin";
import type { NavigationEvent } from "@exocortex/obsidian-plugin";

const navigationManager = new NavigationManager();

// Navigation occurred
navigationManager.on("navigate", (event: NavigationEvent) => {
  console.log("From:", event.fromNodeId);
  console.log("To:", event.toNodeId);
  console.log("Direction:", event.direction);
});

// Focus changed
navigationManager.on("focus", (event: { nodeId: string }) => {
  console.log("Focused:", event.nodeId);
  highlightNode(event.nodeId);
});

// Navigation failed (no target in direction)
navigationManager.on("blocked", (event: NavigationEvent) => {
  console.log("No node in direction:", event.direction);
  playBlockedSound();
});
```

### NavigationEvent Type

```typescript
interface NavigationEvent {
  type: "navigate" | "focus" | "blocked";
  fromNodeId: string | null;
  toNodeId: string | null;
  direction: "up" | "down" | "left" | "right" | "in" | "out";
  mode: "spatial" | "graph" | "semantic";
}
```

## Context Menu Events

### ContextMenuManager

```typescript
import { ContextMenuManager } from "@exocortex/obsidian-plugin";
import type { ContextMenuEvent } from "@exocortex/obsidian-plugin";

const contextMenuManager = new ContextMenuManager();

// Menu opened
contextMenuManager.on("open", (event: ContextMenuEvent) => {
  console.log("Menu opened for:", event.target);
  console.log("Position:", event.position);
  console.log("Items:", event.items);
});

// Menu closed
contextMenuManager.on("close", () => {
  console.log("Menu closed");
});

// Item selected
contextMenuManager.on("select", (event: { item: ContextMenuItem }) => {
  console.log("Selected:", event.item.label);
  event.item.action();
});
```

### ContextMenuEvent Type

```typescript
interface ContextMenuEvent {
  type: "open" | "close" | "select";
  target: ContextMenuTarget | null;
  position: { x: number; y: number };
  items: ContextMenuItem[];
}

interface ContextMenuTarget {
  type: "node" | "edge" | "canvas" | "selection";
  id?: string;
  ids?: string[];
}

interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void;
  submenu?: ContextMenuItem[];
}
```

## Layout Events

### LayoutManager

```typescript
import { LayoutManager } from "@exocortex/obsidian-plugin";
import type { LayoutManagerEvent } from "@exocortex/obsidian-plugin";

const layoutManager = new LayoutManager();

// Layout changed
layoutManager.on("layoutChange", (event: LayoutManagerEvent) => {
  console.log("Changed to:", event.name);
  console.log("Options:", event.options);
});

// Transition started
layoutManager.on("transitionStart", (event: { from: string; to: string }) => {
  console.log("Transitioning from", event.from, "to", event.to);
  disableInteractions();
});

// Transition progress
layoutManager.on("transitionProgress", (event: { progress: number }) => {
  console.log(`${Math.round(event.progress * 100)}% complete`);
});

// Transition ended
layoutManager.on("transitionEnd", () => {
  console.log("Transition complete");
  enableInteractions();
});
```

## Performance Events

### PerformanceProfiler

```typescript
import { PerformanceProfiler, getGlobalProfiler } from "@exocortex/obsidian-plugin";
import type { ProfilerEvent } from "@exocortex/obsidian-plugin";

const profiler = getGlobalProfiler();

// Frame completed
profiler.on("frame", (event: { metrics: PerformanceMetrics }) => {
  if (event.metrics.fps < 30) {
    console.warn("Low FPS:", event.metrics.fps);
  }
});

// Performance warning
profiler.on("warning", (event: { message: string; severity: string }) => {
  console.warn("Performance warning:", event.message);
});
```

### GPUMemoryManager

```typescript
import { GPUMemoryManager, getGlobalMemoryManager } from "@exocortex/obsidian-plugin";
import type { MemoryEvent } from "@exocortex/obsidian-plugin";

const memoryManager = getGlobalMemoryManager();

// Memory pressure changed
memoryManager.on("pressureChange", (event: MemoryEvent) => {
  console.log("Memory pressure:", event.pressure);  // "low" | "medium" | "high" | "critical"
  if (event.pressure === "critical") {
    reduceQuality();
  }
});

// GC occurred
memoryManager.on("gc", (event: { freed: number }) => {
  console.log(`Freed ${event.freed} bytes`);
});
```

## Accessibility Events

### AccessibilityManager

```typescript
import { AccessibilityManager } from "@exocortex/obsidian-plugin";
import type { A11yEvent } from "@exocortex/obsidian-plugin";

const a11yManager = new AccessibilityManager();

// Announcement made
a11yManager.on("announce", (event: { message: string; type: string }) => {
  console.log("Announced:", event.message);
});

// Focus trap activated
a11yManager.on("focusTrap", (event: { active: boolean }) => {
  console.log("Focus trap:", event.active ? "activated" : "deactivated");
});

// High contrast mode changed
a11yManager.on("contrastChange", (event: { enabled: boolean }) => {
  console.log("High contrast:", event.enabled);
});
```

## Creating Custom Events

Implement the event pattern in your own components:

```typescript
type EventCallback<T> = (event: T) => void;

class MyComponent<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<EventCallback<any>>>();

  on<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return this;
  }

  off<K extends keyof Events>(event: K, callback?: EventCallback<Events[K]>): this {
    if (callback) {
      this.listeners.get(event)?.delete(callback);
    } else {
      this.listeners.delete(event);
    }
    return this;
  }

  once<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>): this {
    const wrapped: EventCallback<Events[K]> = (e) => {
      this.off(event, wrapped);
      callback(e);
    };
    return this.on(event, wrapped);
  }

  protected emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this.listeners.get(event)?.forEach((callback) => callback(data));
  }
}

// Usage
interface MyEvents {
  change: { value: number };
  error: { message: string };
}

class MyManager extends MyComponent<MyEvents> {
  setValue(value: number): void {
    this.emit("change", { value });
  }
}
```

## See Also

- [GraphLayoutRenderer](./graph-view.md) - Main component
- [Configuration](../getting-started/configuration.md) - Event configuration options
- [Interactions Guide](../guides/interactions.md) - Interaction patterns
