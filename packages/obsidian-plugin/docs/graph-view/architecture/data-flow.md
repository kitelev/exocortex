# Data Flow

This document describes how data flows through the Graph View system.

## Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    Data     │────▶│   Layout    │────▶│   State     │────▶│   Render    │
│   Source    │     │ Computation │     │   Update    │     │   Output    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                          │                   │                   │
                          └───────────────────┼───────────────────┘
                                              │
                                        ┌─────▼─────┐
                                        │   Event   │
                                        │  System   │
                                        └───────────┘
```

## Data Loading

### 1. Data Source

Data enters the system from various sources:

```typescript
// Static data
const graphData: GraphData = { nodes, edges };

// From Obsidian vault
const graphData = await vaultAdapter.loadGraph("projects/");

// From SPARQL query
const graphData = await sparqlExecutor.query(`
  SELECT ?node ?edge WHERE { ... }
`);

// From table rows
const graphData = buildGraphData(tableRows, "title", ["links"]);
```

### 2. Data Transformation

Raw data is transformed into domain objects:

```typescript
// Enrich nodes with computed properties
const enrichedNodes = nodes.map((node) => ({
  ...node,
  connectionCount: countConnections(node.id, edges),
  depth: calculateDepth(node.id, edges),
}));

// Resolve edge references
const resolvedEdges = edges.map((edge) => ({
  ...edge,
  source: findNode(edge.source),
  target: findNode(edge.target),
}));
```

### 3. Filtering

Data is filtered before layout:

```typescript
const filterManager = new FilterManager();

// Apply type filter
filterManager.addFilter(createTypeFilter({
  types: ["project", "area"],
  mode: "include",
}));

// Apply predicate filter
filterManager.addFilter(createPredicateFilter({
  predicates: ["belongsTo"],
  mode: "include",
}));

// Get filtered data
const filteredNodes = filterManager.filterNodes(nodes);
const filteredEdges = filterManager.filterEdges(edges, filteredNodes);
```

## Layout Computation

### 1. Initial Positioning

Nodes receive initial positions:

```typescript
// Random initial positions
for (const node of nodes) {
  node.x = Math.random() * width;
  node.y = Math.random() * height;
}

// Or grid initialization
const gridSize = Math.ceil(Math.sqrt(nodes.length));
for (let i = 0; i < nodes.length; i++) {
  const row = Math.floor(i / gridSize);
  const col = i % gridSize;
  nodes[i].x = col * spacing;
  nodes[i].y = row * spacing;
}
```

### 2. Simulation Loop

Force simulation updates positions:

```
┌─────────────────────────────────────────────────────────────┐
│                    Simulation Tick                          │
│                                                             │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐     │
│  │ Center  │──▶│ Charge  │──▶│  Link   │──▶│ Collide │     │
│  │ Force   │   │ Force   │   │ Force   │   │ Force   │     │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘     │
│       │             │             │             │           │
│       ▼             ▼             ▼             ▼           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Apply Velocities                        │   │
│  │         node.x += node.vx; node.y += node.vy        │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Apply Decay                             │   │
│  │         node.vx *= (1 - velocityDecay)              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Update Alpha                            │   │
│  │         alpha = alpha + (alphaTarget - alpha)       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3. Layout Algorithms

Alternative layouts compute positions directly:

```typescript
// Hierarchical layout
const hierarchicalLayout = new HierarchicalLayout({ direction: "TB" });
const result = hierarchicalLayout.compute(nodes, edges);

// Radial layout
const radialLayout = new RadialLayout({ focusNode: "node-1" });
const result = radialLayout.compute(nodes, edges);
```

## State Management

### 1. State Stores

Each manager owns its state:

```typescript
// Selection state
class SelectionManager {
  private state: SelectionState = {
    nodeIds: new Set(),
    edgeIds: new Set(),
    mode: "single",
  };

  selectNodes(ids: string[]): void {
    this.state = {
      ...this.state,
      nodeIds: new Set(ids),
    };
    this.emit("select", this.createEvent());
  }
}

// Viewport state
class ViewportController {
  private viewport: Viewport = { x: 0, y: 0, scale: 1 };

  zoomTo(scale: number): void {
    this.viewport = { ...this.viewport, scale };
    this.emit("change", this.createEvent());
  }
}
```

### 2. State Updates

Updates follow immutable patterns:

```typescript
// Create new state object
const newState = {
  ...oldState,
  nodeIds: new Set([...oldState.nodeIds, newNodeId]),
};

// Emit change event
this.emit("change", {
  previous: oldState,
  current: newState,
});
```

### 3. State Synchronization

States are synchronized via events:

```typescript
// Selection affects hover
selectionManager.on("select", (event) => {
  // Clear hover if selected
  if (event.nodeIds.includes(hoverManager.getHoveredId())) {
    hoverManager.clearHover();
  }
});

// Viewport affects LOD
viewportController.on("change", (event) => {
  const level = lodSystem.getLevelForZoom(event.scale);
  lodSystem.setLevel(level);
});
```

## Rendering Pipeline

### 1. Dirty Tracking

Track what needs re-rendering:

```typescript
class DirtyTracker {
  private dirty = new Map<string, Set<DirtyFlag>>();

  markDirty(id: string, flag: DirtyFlag): void {
    if (!this.dirty.has(id)) {
      this.dirty.set(id, new Set());
    }
    this.dirty.get(id)!.add(flag);
  }

  getDirty(flag: DirtyFlag): string[] {
    const result: string[] = [];
    for (const [id, flags] of this.dirty) {
      if (flags.has(flag)) {
        result.push(id);
      }
    }
    return result;
  }

  clear(): void {
    this.dirty.clear();
  }
}
```

### 2. Incremental Rendering

Only re-render changed elements:

```typescript
class IncrementalRenderer {
  render(): RenderStats {
    const stats = { nodesUpdated: 0, edgesUpdated: 0 };

    // Update dirty nodes
    for (const nodeId of dirtyTracker.getDirty("position")) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        nodeRenderer.updateNode(nodeId, { x: node.x, y: node.y });
        stats.nodesUpdated++;
      }
    }

    // Update dirty edges
    for (const edgeId of dirtyTracker.getDirty("endpoints")) {
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) {
        edgeRenderer.updateEdge(edgeId, getEdgeEndpoints(edge));
        stats.edgesUpdated++;
      }
    }

    dirtyTracker.clear();
    return stats;
  }
}
```

### 3. Render Order

Elements are rendered in layers:

```
┌─────────────────────────────────────────────────────────────┐
│                     Background                              │
│                     (Grid, etc.)                            │
├─────────────────────────────────────────────────────────────┤
│                     Edges                                   │
│                     (Z-index: 0)                            │
├─────────────────────────────────────────────────────────────┤
│                     Edge Labels                             │
│                     (Z-index: 1)                            │
├─────────────────────────────────────────────────────────────┤
│                     Nodes                                   │
│                     (Z-index: 2)                            │
├─────────────────────────────────────────────────────────────┤
│                     Node Labels                             │
│                     (Z-index: 3)                            │
├─────────────────────────────────────────────────────────────┤
│                     Selection Highlight                     │
│                     (Z-index: 4)                            │
├─────────────────────────────────────────────────────────────┤
│                     Focus Indicator                         │
│                     (Z-index: 5)                            │
├─────────────────────────────────────────────────────────────┤
│                     Overlays                                │
│                     (Tooltips, Menus)                       │
└─────────────────────────────────────────────────────────────┘
```

## Event Flow

### 1. Input Events

DOM events are captured and processed:

```typescript
container.addEventListener("pointerdown", (e) => {
  const worldPos = viewportController.screenToWorld(e.clientX, e.clientY);
  const target = hitTest(worldPos);

  if (target.type === "node") {
    selectionManager.handleClick(target.id, {
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
    });
  }
});
```

### 2. State Change Events

Managers emit events on state changes:

```typescript
// Selection change
selectionManager.on("select", (event) => {
  // Update visual selection
  for (const nodeId of event.nodeIds) {
    nodeRenderer.updateNode(nodeId, { selected: true });
  }
});

// Viewport change
viewportController.on("change", (event) => {
  // Update transform
  renderer.setTransform(event.x, event.y, event.scale);
});
```

### 3. Event Propagation

Events bubble through the system:

```
User Click
    │
    ▼
┌─────────────────┐
│  Hit Testing    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ SelectionManager│
│    .handleClick │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  State Update   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ "select" Event  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│Render │ │A11y   │
│Update │ │Announce
└───────┘ └───────┘
```

## Performance Optimization

### 1. Batching

Updates are batched for efficiency:

```typescript
class BatchedUpdater {
  private pending = new Map<string, Partial<NodeState>>();
  private scheduled = false;

  update(id: string, changes: Partial<NodeState>): void {
    const existing = this.pending.get(id) || {};
    this.pending.set(id, { ...existing, ...changes });

    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  private flush(): void {
    for (const [id, changes] of this.pending) {
      nodeRenderer.updateNode(id, changes);
    }
    this.pending.clear();
    this.scheduled = false;
  }
}
```

### 2. Debouncing

High-frequency events are debounced:

```typescript
const debouncedSearch = debounce((query: string) => {
  searchManager.search(query);
}, 200);

searchInput.addEventListener("input", (e) => {
  debouncedSearch(e.target.value);
});
```

### 3. Throttling

Continuous events are throttled:

```typescript
const throttledViewportUpdate = throttle((viewport: Viewport) => {
  cullingManager.updateVisibility(viewport);
}, 16);  // ~60fps

viewportController.on("change", (event) => {
  throttledViewportUpdate(event);
});
```

## See Also

- [Architecture Overview](./overview.md) - System architecture
- [Domain Model](./domain-model.md) - Entity details
- [Extension Points](./extension-points.md) - Customization
