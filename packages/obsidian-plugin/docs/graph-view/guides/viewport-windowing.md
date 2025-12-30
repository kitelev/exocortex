# Viewport Windowing System

The Viewport Windowing System enables virtual scrolling and efficient rendering of graphs with 100K+ nodes by only rendering visible elements within the current viewport.

## Overview

The `ViewportWindowManager` implements spatial windowing techniques to:

- **Reduce draw calls**: Only render nodes/edges visible in the viewport
- **Minimize memory usage**: Pool and recycle DOM/WebGL resources
- **Enable infinite canvas**: Support arbitrarily large graphs
- **Maintain 60fps**: Consistent performance regardless of total graph size

## Architecture

```
┌─────────────────────────────────────────┐
│           ViewportWindowManager          │
├─────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Spatial  │  │ Viewport │  │ Buffer │ │
│  │  Index   │  │  Query   │  │  Pool  │ │
│  └──────────┘  └──────────┘  └────────┘ │
├─────────────────────────────────────────┤
│           Visible Node Set              │
│    (dynamically updated on scroll)      │
└─────────────────────────────────────────┘
```

## Basic Usage

```typescript
import { ViewportWindowManager } from "./presentation/renderers/graph";

// Create manager with configuration
const windowManager = new ViewportWindowManager({
  viewport: { x: 0, y: 0, width: 1920, height: 1080 },
  bufferSize: 200, // Extra pixels to render outside viewport
  updateThreshold: 50, // Minimum scroll distance before update
});

// Set all nodes (can be 100K+)
windowManager.setNodes(allNodes);

// Get only visible nodes for rendering
const visibleNodes = windowManager.getVisibleNodes();

// Update on viewport change
viewportController.on("change", (event) => {
  windowManager.updateViewport(event.viewport);
  const visible = windowManager.getVisibleNodes();
  renderer.render(visible);
});
```

## Configuration Options

```typescript
interface ViewportWindowConfig {
  /** Initial viewport bounds */
  viewport: ViewportBounds;

  /** Buffer zone outside viewport (pixels) */
  bufferSize: number;

  /** Minimum scroll distance to trigger update (pixels) */
  updateThreshold: number;

  /** Spatial index cell size (default: 100) */
  cellSize: number;

  /** Maximum nodes to render regardless of visibility */
  maxVisibleNodes: number;

  /** Enable edge visibility culling */
  cullEdges: boolean;

  /** Include edges with at least one visible endpoint */
  includePartialEdges: boolean;

  /** Pre-render buffer ratio (0-1, default: 0.2) */
  prefetchRatio: number;
}
```

## Spatial Indexing

The system uses a spatial hash grid for O(1) visibility queries:

```typescript
// The spatial index automatically maintains a hash grid
windowManager.setNodes(nodes);

// Query nodes in a region
const nodesInRegion = windowManager.queryRegion({
  minX: 100,
  minY: 100,
  maxX: 500,
  maxY: 400,
});

// Get nodes near a point
const nearbyNodes = windowManager.queryRadius(
  { x: 250, y: 250 }, // center
  100 // radius
);
```

## Level of Detail Integration

Combine with LOD for additional performance:

```typescript
interface LODConfig {
  /** Distance thresholds for detail levels */
  thresholds: [number, number, number]; // [full, medium, minimal]

  /** What to show at each level */
  levels: {
    full: { labels: true; icons: true; metadata: true };
    medium: { labels: true; icons: false; metadata: false };
    minimal: { labels: false; icons: false; metadata: false };
  };
}

// LOD is automatically applied based on zoom level
windowManager.setLODConfig(lodConfig);

// Get visible nodes with their LOD level
const visibleWithLOD = windowManager.getVisibleNodesWithLOD();
// Returns: { node: GraphNode, lod: 'full' | 'medium' | 'minimal' }[]
```

## Edge Handling

Edges spanning viewport boundaries are handled specially:

```typescript
// Configure edge visibility
windowManager.setConfig({
  cullEdges: true,
  includePartialEdges: true, // Show edges with one visible endpoint
});

// Get visible edges
const visibleEdges = windowManager.getVisibleEdges();

// Get edges that cross viewport boundary (for different rendering)
const boundaryEdges = windowManager.getBoundaryEdges();
```

## Performance Optimization

### Buffer Zones

Pre-render content just outside the viewport:

```typescript
// Larger buffer = smoother scrolling, more memory
windowManager.setConfig({ bufferSize: 300 });

// Predictive buffering based on scroll velocity
windowManager.enablePredictiveBuffering({
  velocityMultiplier: 0.5, // Buffer more in scroll direction
  maxBuffer: 500,
});
```

### Update Throttling

Control update frequency:

```typescript
// Only update when scroll exceeds threshold
windowManager.setConfig({ updateThreshold: 100 });

// Or use frame-rate limiting
windowManager.setConfig({
  maxUpdatesPerSecond: 30,
});
```

### Incremental Updates

For large datasets, use incremental visibility updates:

```typescript
// Enable incremental mode
windowManager.setConfig({ incrementalUpdates: true });

// Get only nodes that entered/exited viewport
windowManager.on("visibilityChange", (event) => {
  const { entered, exited } = event;

  // Add new nodes to render list
  entered.forEach((node) => renderer.addNode(node));

  // Remove nodes that left viewport
  exited.forEach((node) => renderer.removeNode(node));
});
```

## Events

```typescript
// Viewport updated
windowManager.on("viewportChange", (event) => {
  console.log("Viewport:", event.viewport);
  console.log("Visible count:", event.visibleCount);
});

// Nodes entered/exited visibility
windowManager.on("visibilityChange", (event) => {
  console.log("Entered:", event.entered.length);
  console.log("Exited:", event.exited.length);
});

// Spatial index rebuilt
windowManager.on("indexRebuild", (event) => {
  console.log("Index rebuilt:", event.nodeCount, "nodes");
});
```

## Memory Management

### Resource Pooling

The window manager maintains pools for efficient memory use:

```typescript
// Get pool statistics
const poolStats = windowManager.getPoolStats();
console.log("Node pool:", poolStats.nodePool);
console.log("Edge pool:", poolStats.edgePool);

// Force pool cleanup
windowManager.trimPools();
```

### Garbage Collection Hints

```typescript
// Mark nodes as eligible for GC when far from viewport
windowManager.setConfig({
  gcDistance: 2000, // Pixels from viewport
  gcBatchSize: 100, // Nodes to process per frame
});
```

## Integration Example

Complete integration with graph renderer:

```typescript
import {
  ViewportWindowManager,
  PixiGraphRenderer,
  ViewportController,
} from "./presentation/renderers/graph";

// Setup
const windowManager = new ViewportWindowManager({
  viewport: { x: 0, y: 0, width: container.clientWidth, height: container.clientHeight },
  bufferSize: 200,
  cullEdges: true,
});

const renderer = new PixiGraphRenderer(container);
const viewportController = new ViewportController(container);

// Load large dataset
windowManager.setNodes(largeNodeArray); // 100K+ nodes
windowManager.setEdges(largeEdgeArray);

// Connect viewport changes
viewportController.on("change", (event) => {
  windowManager.updateViewport({
    x: -event.x / event.scale,
    y: -event.y / event.scale,
    width: container.clientWidth / event.scale,
    height: container.clientHeight / event.scale,
  });
});

// Render only visible content
function render() {
  const visibleNodes = windowManager.getVisibleNodes();
  const visibleEdges = windowManager.getVisibleEdges();

  renderer.setNodes(visibleNodes);
  renderer.setEdges(visibleEdges);
  renderer.render();
}

// Initial render
render();

// Update on visibility change
windowManager.on("visibilityChange", render);
```

## Performance Metrics

Expected performance with viewport windowing:

| Total Nodes | Visible Nodes | Render Time | Memory |
| ----------- | ------------- | ----------- | ------ |
| 10K         | ~500          | <5ms        | ~50MB  |
| 50K         | ~500          | <5ms        | ~100MB |
| 100K        | ~500          | <5ms        | ~200MB |
| 500K        | ~500          | <5ms        | ~500MB |

Render time remains constant regardless of total graph size.

## See Also

- [Performance](./performance.md) - General performance optimization
- [Interactions](./interactions.md) - Viewport control
- [Memory Optimization](./memory-optimization.md) - Object pooling
