# PixiGraphRenderer API

High-performance WebGL2 renderer built on PixiJS for graph visualization.

## Import

```typescript
import {
  PixiGraphRenderer,
  NodeRenderer,
  EdgeRenderer,
  LabelRenderer,
  BatchedNodeRenderer,
  IncrementalRenderer,
} from "@exocortex/obsidian-plugin";

import type {
  PixiGraphRendererOptions,
  ViewportState,
  NodeVisualStyle,
  EdgeVisualStyle,
  LabelVisualStyle,
  RenderedNode,
  RenderedEdge,
  RenderedLabel,
} from "@exocortex/obsidian-plugin";
```

## PixiGraphRenderer

The main WebGL2 renderer that manages the PixiJS application.

### Constructor

```typescript
const renderer = new PixiGraphRenderer(container: HTMLElement, options?: PixiGraphRendererOptions);

interface PixiGraphRendererOptions {
  width: number;              // Canvas width
  height: number;             // Canvas height
  backgroundColor: number;    // Background color (hex)
  antialias: boolean;         // Smooth edges (default: true)
  resolution: number;         // Device pixel ratio
  autoDensity: boolean;       // Auto-adjust for HiDPI
  powerPreference: "default" | "high-performance" | "low-power";
  preserveDrawingBuffer: boolean;  // Required for export
}
```

### Properties

```typescript
// Access the PixiJS Application
renderer.app: Application;

// Access the main container
renderer.container: Container;

// Access the viewport state
renderer.viewport: ViewportState;

// Check if WebGPU is available
renderer.isWebGPUAvailable: boolean;
```

### Methods

#### resize(width, height)

Resize the renderer:

```typescript
renderer.resize(800, 600);

// Auto-resize to container
const resizeObserver = new ResizeObserver((entries) => {
  const { width, height } = entries[0].contentRect;
  renderer.resize(width, height);
});
resizeObserver.observe(containerElement);
```

#### setBackgroundColor(color)

Change the background color:

```typescript
renderer.setBackgroundColor(0x1a1a2e);  // Dark blue
renderer.setBackgroundColor(0xffffff);  // White
```

#### getViewport() / setViewport(state)

Get or set viewport state:

```typescript
// Get current viewport
const viewport = renderer.getViewport();
console.log(viewport.x, viewport.y, viewport.scale);

// Set viewport
renderer.setViewport({ x: 100, y: 50, scale: 1.5 });
```

#### render()

Force a render frame:

```typescript
renderer.render();
```

#### destroy()

Clean up resources:

```typescript
renderer.destroy();
```

## NodeRenderer

Renders nodes with customizable shapes and styles.

### Constructor

```typescript
const nodeRenderer = new NodeRenderer(app: Application);
```

### Methods

#### renderNode(data)

Render a single node:

```typescript
nodeRenderer.renderNode({
  id: "node-1",
  x: 100,
  y: 200,
  radius: 12,
  style: {
    fill: 0x6366f1,
    stroke: 0xffffff,
    strokeWidth: 2,
    alpha: 1,
  },
  shape: "circle",  // circle, square, diamond, triangle, hexagon, star
  selected: false,
  hovered: false,
});
```

#### renderNodes(nodes)

Render multiple nodes:

```typescript
nodeRenderer.renderNodes([
  { id: "1", x: 100, y: 100, radius: 12, style: { fill: 0x6366f1 } },
  { id: "2", x: 200, y: 150, radius: 12, style: { fill: 0x22c55e } },
]);
```

#### updateNode(id, updates)

Update a specific node:

```typescript
nodeRenderer.updateNode("node-1", {
  x: 150,
  y: 250,
  style: { fill: 0xef4444 },  // Change to red
});
```

#### removeNode(id)

Remove a node:

```typescript
nodeRenderer.removeNode("node-1");
```

#### clear()

Clear all nodes:

```typescript
nodeRenderer.clear();
```

#### dispose()

Clean up resources:

```typescript
nodeRenderer.dispose();
```

### Node Shapes

```typescript
import { SHAPE_DRAWERS } from "@exocortex/obsidian-plugin";

// Available shapes
const shapes: NodeShape[] = [
  "circle",    // Default round shape
  "square",    // Rectangle
  "diamond",   // Rotated square
  "triangle",  // Equilateral triangle
  "hexagon",   // Six-sided polygon
  "star",      // Five-pointed star
];

// Custom shape drawer
SHAPE_DRAWERS.custom = (graphics, x, y, radius) => {
  // Draw custom shape
  graphics.beginFill(0xffffff);
  // ... custom drawing code
  graphics.endFill();
};
```

## EdgeRenderer

Renders edges with curves and arrows.

### Constructor

```typescript
const edgeRenderer = new EdgeRenderer(app: Application);
```

### Methods

#### renderEdge(data)

Render a single edge:

```typescript
edgeRenderer.renderEdge({
  id: "edge-1",
  source: { x: 100, y: 100 },
  target: { x: 300, y: 200 },
  style: {
    color: 0x4a4a6a,
    width: 2,
    alpha: 0.6,
    dashPattern: [5, 3],  // Optional dashed line
  },
  curveType: "quadratic",  // straight, quadratic, cubic, arc
  curvature: 0.2,
  arrowType: "triangle",   // none, triangle, stealth, diamond
  arrowPosition: "end",    // start, end, both
  arrowSize: 8,
});
```

#### renderEdges(edges)

Render multiple edges:

```typescript
edgeRenderer.renderEdges(edges.map((e) => ({
  id: e.id,
  source: nodes.find((n) => n.id === e.source),
  target: nodes.find((n) => n.id === e.target),
  style: { color: 0x4a4a6a, width: 2 },
})));
```

#### updateEdge(id, updates)

Update a specific edge:

```typescript
edgeRenderer.updateEdge("edge-1", {
  style: { color: 0xef4444, width: 3 },  // Highlight in red
});
```

#### removeEdge(id)

Remove an edge:

```typescript
edgeRenderer.removeEdge("edge-1");
```

#### clear()

Clear all edges:

```typescript
edgeRenderer.clear();
```

### Curve Types

```typescript
// Straight line
{ curveType: "straight" }

// Quadratic Bezier (single control point)
{ curveType: "quadratic", curvature: 0.2 }

// Cubic Bezier (two control points)
{ curveType: "cubic", curvature: 0.3 }

// Arc (circular arc between points)
{ curveType: "arc", curvature: 0.5 }
```

## LabelRenderer

Renders text labels with bitmap font caching.

### Constructor

```typescript
const labelRenderer = new LabelRenderer(app: Application);
```

### Methods

#### renderLabel(data)

Render a single label:

```typescript
labelRenderer.renderLabel({
  id: "label-1",
  text: "Node Label",
  x: 100,
  y: 220,  // Below node
  style: {
    fontFamily: "Inter, sans-serif",
    fontSize: 12,
    fill: 0xffffff,
    fontWeight: "normal",
    align: "center",
    alpha: 1,
    maxWidth: 100,  // Truncate if wider
  },
  anchor: { x: 0.5, y: 0 },  // Center-top
});
```

#### updateLabel(id, updates)

Update a label:

```typescript
labelRenderer.updateLabel("label-1", {
  text: "Updated Label",
  style: { fill: 0x22c55e },
});
```

#### setVisibility(visible)

Show/hide all labels:

```typescript
labelRenderer.setVisibility(false);  // Hide all labels
labelRenderer.setVisibility(true);   // Show all labels
```

### Label Positioning

```typescript
import { calculateOptimalLabelPosition } from "@exocortex/obsidian-plugin";

// Find best position avoiding overlaps
const position = calculateOptimalLabelPosition(
  node,           // Node position
  neighbors,      // Neighboring nodes
  labelWidth,     // Label dimensions
  labelHeight,
  nodeRadius
);
```

## BatchedNodeRenderer

Efficient instanced rendering for large graphs.

### Constructor

```typescript
const batchedRenderer = createBatchedNodeRenderer(app: Application, config?: BatchConfig);

interface BatchConfig {
  maxBatchSize: number;      // Max nodes per batch (default: 1000)
  sortByDepth: boolean;      // Sort by z-index (default: true)
  instancedDrawing: boolean; // Use GPU instancing (default: true)
  geometryPoolSize: number;  // Pre-allocated geometries (default: 10)
}
```

### Methods

```typescript
// Add nodes to batch
batchedRenderer.addNodes(nodes);

// Update batch
batchedRenderer.updateNodes(updatedNodes);

// Render all batches
batchedRenderer.render();

// Get statistics
const stats: BatchRendererStats = batchedRenderer.getStats();
console.log(`Batches: ${stats.batchCount}`);
console.log(`Draw calls: ${stats.drawCalls}`);
console.log(`Nodes rendered: ${stats.nodesRendered}`);
```

## IncrementalRenderer

Only re-renders changed elements for performance.

### Constructor

```typescript
const incrementalRenderer = new IncrementalRenderer(options?: IncrementalRendererOptions);

interface IncrementalRendererOptions {
  nodeRenderer: NodeRenderer;
  edgeRenderer: EdgeRenderer;
  labelRenderer: LabelRenderer;
  dirtyTracker: DirtyTracker;
}
```

### Methods

```typescript
// Mark node as dirty
incrementalRenderer.markDirty("node-1", "position");
incrementalRenderer.markDirty("node-1", "style");

// Render only dirty elements
const stats: RenderStats = incrementalRenderer.render();
console.log(`Nodes updated: ${stats.nodesUpdated}`);
console.log(`Edges updated: ${stats.edgesUpdated}`);

// Force full re-render
incrementalRenderer.invalidateAll();
incrementalRenderer.render();
```

## Performance Tips

### Use Object Pooling

```typescript
import { PoolManager, getGlobalPoolManager } from "@exocortex/obsidian-plugin";

const poolManager = getGlobalPoolManager();

// Pre-warm pools
poolManager.prewarm("renderBatch", 100);
poolManager.prewarm("vector2d", 1000);
```

### Use Visibility Culling

```typescript
import { VisibilityCuller } from "@exocortex/obsidian-plugin";

const culler = new VisibilityCuller({
  margin: 50,  // Pixels outside viewport to include
});

// Get visible nodes
const visibleNodes = culler.getVisibleNodes(allNodes, viewport);

// Only render visible
nodeRenderer.renderNodes(visibleNodes);
```

### Use Level of Detail

```typescript
import { LODSystem, LODLevel } from "@exocortex/obsidian-plugin";

const lodSystem = new LODSystem();

// Get current LOD level
const level: LODLevel = lodSystem.getLevelForZoom(viewport.scale);

// Adjust rendering based on LOD
if (level === LODLevel.LOW) {
  nodeRenderer.setSimplifiedMode(true);
  labelRenderer.setVisibility(false);
}
```

## See Also

- [Performance Guide](../guides/performance.md) - Optimization strategies
- [Events](./events.md) - Rendering events
- [Export](../guides/styling.md#export) - Image export
