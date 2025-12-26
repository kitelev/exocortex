# Performance Guide

This guide covers optimizing Graph View for large graphs (1K to 100K+ nodes).

## Performance Tiers

| Graph Size | Strategy |
|------------|----------|
| < 1K nodes | No optimization needed |
| 1K-10K nodes | Basic optimization |
| 10K-50K nodes | Advanced optimization |
| 50K-100K+ nodes | Maximum optimization |

## Physics Optimization

### Barnes-Hut Algorithm

For O(n log n) many-body force calculation:

```typescript
import { ForceSimulation, forceManyBody, BarnesHutForce } from "@exocortex/obsidian-plugin";

const simulation = new ForceSimulation()
  .force("charge", forceManyBody()
    .strength(-300)
    .theta(0.9)        // Higher = faster, less accurate
    .distanceMax(200)  // Limit force range
  );

// Theta values:
// 0.5 - Accurate, slow
// 0.9 - Balanced (default)
// 1.5 - Fast, less accurate
```

### WebGPU Physics

GPU-accelerated simulation for 10K+ nodes:

```typescript
import { WebGPUPhysics, isWebGPUAvailable, createWebGPUPhysics } from "@exocortex/obsidian-plugin";

if (await isWebGPUAvailable()) {
  const physics = await createWebGPUPhysics({
    nodes: simulationNodes,
    edges: simulationEdges,
    chargeStrength: -300,
    linkDistance: 100,
    iterations: 300,
  });

  physics.on("complete", (result) => {
    // Apply computed positions
    for (const pos of result.positions) {
      const node = nodes.find((n) => n.id === pos.id);
      if (node) {
        node.x = pos.x;
        node.y = pos.y;
      }
    }
    render();
  });

  physics.start();
}
```

### Simulation Tuning

```typescript
const simulation = new ForceSimulation({
  alpha: 1,
  alphaMin: 0.01,      // Stop earlier
  alphaDecay: 0.01,    // Slower cooling
  velocityDecay: 0.3,  // More momentum
});

// For very large graphs, run synchronously
simulation.stop();
for (let i = 0; i < 300; i++) {
  simulation.tick();
}
// Then render once
render();
```

## Rendering Optimization

### Level of Detail (LOD)

Reduce visual complexity at low zoom:

```typescript
import { LODSystem, createLODSystem, LODLevel } from "@exocortex/obsidian-plugin";

const lodSystem = createLODSystem({
  thresholds: [
    {
      zoomLevel: 0.1,
      nodeSettings: { showLabels: false, showShapes: false, minRadius: 1 },
      edgeSettings: { showLabels: false, showArrows: false, minWidth: 0.5 },
    },
    {
      zoomLevel: 0.3,
      nodeSettings: { showLabels: false, showShapes: true, minRadius: 2 },
      edgeSettings: { showLabels: false, showArrows: false, minWidth: 1 },
    },
    {
      zoomLevel: 0.7,
      nodeSettings: { showLabels: true, showShapes: true, minRadius: 4 },
      edgeSettings: { showLabels: false, showArrows: true, minWidth: 1.5 },
    },
    {
      zoomLevel: 1.0,
      nodeSettings: { showLabels: true, showShapes: true, minRadius: 8 },
      edgeSettings: { showLabels: true, showArrows: true, minWidth: 2 },
    },
  ],
});

viewport.on("change", (event) => {
  const level = lodSystem.getLevelForZoom(event.scale);
  applyLODSettings(level);
});
```

### Visibility Culling

Only render visible elements:

```typescript
import { VisibilityCuller, DEFAULT_VISIBILITY_CULLER_CONFIG } from "@exocortex/obsidian-plugin";

const culler = new VisibilityCuller({
  margin: 50,  // Include nodes slightly outside viewport
});

function render(): void {
  const viewport = viewportController.getViewport();
  const visibleNodes = culler.getVisibleNodes(nodes, viewport);
  const visibleEdges = culler.getVisibleEdges(edges, visibleNodes);

  nodeRenderer.renderNodes(visibleNodes);
  edgeRenderer.renderEdges(visibleEdges);
}
```

### Batched Rendering

Use instanced drawing for many similar nodes:

```typescript
import { BatchedNodeRenderer, createBatchedNodeRenderer } from "@exocortex/obsidian-plugin";

const batchRenderer = createBatchedNodeRenderer(renderer.app, {
  maxBatchSize: 1000,
  instancedDrawing: true,
  sortByDepth: true,
});

// Add all nodes at once
batchRenderer.addNodes(nodes.map((n) => ({
  id: n.id,
  x: n.x,
  y: n.y,
  radius: 8,
  color: getNodeColor(n),
})));

// Render all batches
batchRenderer.render();
```

### Incremental Rendering

Only re-render changed elements:

```typescript
import { IncrementalRenderer, DirtyTracker } from "@exocortex/obsidian-plugin";

const dirtyTracker = new DirtyTracker();
const incrementalRenderer = new IncrementalRenderer({
  nodeRenderer,
  edgeRenderer,
  labelRenderer,
  dirtyTracker,
});

// Mark changed nodes
simulation.on("tick", () => {
  for (const node of nodes) {
    if (hasPositionChanged(node)) {
      dirtyTracker.markDirty(node.id, "position");
    }
  }
});

// Only render dirty elements
function render(): void {
  const stats = incrementalRenderer.render();
  console.log(`Updated ${stats.nodesUpdated} nodes`);
}
```

## Memory Optimization

### Object Pooling

Reuse objects to reduce GC pressure:

```typescript
import {
  PoolManager,
  createPoolManager,
  getGlobalPoolManager,
  POOL_NAMES,
} from "@exocortex/obsidian-plugin";

const poolManager = getGlobalPoolManager();

// Pre-warm pools
poolManager.prewarm(POOL_NAMES.VECTOR_2D, 10000);
poolManager.prewarm(POOL_NAMES.RENDER_BATCH, 100);

// Use pooled objects
const vector = poolManager.acquire(POOL_NAMES.VECTOR_2D);
vector.x = 100;
vector.y = 200;
// ... use vector ...
poolManager.release(POOL_NAMES.VECTOR_2D, vector);
```

### GPU Memory Management

```typescript
import { GPUMemoryManager, getGlobalMemoryManager, MemoryPressure } from "@exocortex/obsidian-plugin";

const memoryManager = getGlobalMemoryManager();

memoryManager.on("pressureChange", (event) => {
  switch (event.pressure) {
    case MemoryPressure.LOW:
      // Normal operation
      break;
    case MemoryPressure.MEDIUM:
      // Reduce texture quality
      nodeRenderer.setQuality("medium");
      break;
    case MemoryPressure.HIGH:
      // Reduce further
      nodeRenderer.setQuality("low");
      labelRenderer.setVisibility(false);
      break;
    case MemoryPressure.CRITICAL:
      // Emergency measures
      lodSystem.forceLowestDetail();
      break;
  }
});

// Manual GC trigger
memoryManager.gc();
```

### Texture Atlasing

Combine small textures:

```typescript
// Node shapes use a shared texture atlas
const shapeAtlas = new TextureAtlas({
  size: 1024,
  padding: 2,
});

// Add shapes to atlas
shapeAtlas.add("circle", createCircleTexture(64));
shapeAtlas.add("diamond", createDiamondTexture(64));
shapeAtlas.add("hexagon", createHexagonTexture(64));

// Single draw call for all shapes
nodeRenderer.setShapeAtlas(shapeAtlas);
```

## Viewport Windowing

Virtual scrolling for very large graphs:

```typescript
import { ViewportWindowManager, createViewportWindowManager } from "@exocortex/obsidian-plugin";

const windowManager = createViewportWindowManager({
  windowSize: 2000,    // Pixels per window
  overlap: 200,        // Window overlap
  maxWindows: 9,       // 3x3 grid around viewport
});

windowManager.on("windowChange", (event) => {
  // Load data for visible windows
  for (const windowId of event.activeWindows) {
    if (!loadedWindows.has(windowId)) {
      loadWindowData(windowId);
    }
  }

  // Unload distant windows
  for (const windowId of event.removedWindows) {
    unloadWindowData(windowId);
  }
});
```

## Performance Profiling

### Built-in Profiler

```typescript
import { PerformanceProfiler, getGlobalProfiler } from "@exocortex/obsidian-plugin";

const profiler = getGlobalProfiler();
profiler.enable();

// Profile sections
profiler.startSection("simulation");
simulation.tick(10);
profiler.endSection("simulation");

profiler.startSection("render");
render();
profiler.endSection("render");

// Get metrics
const metrics = profiler.getMetrics();
console.log(`FPS: ${metrics.fps}`);
console.log(`Avg frame: ${metrics.avgFrameTime}ms`);

// Per-section timing
const sections = profiler.getSections();
for (const [name, timing] of sections) {
  console.log(`${name}: ${timing.avg}ms`);
}
```

### Bottleneck Detection

```typescript
import { BottleneckDetector, createBottleneckDetector } from "@exocortex/obsidian-plugin";

const detector = createBottleneckDetector({
  sampleSize: 60,        // Frames to analyze
  warningThreshold: 16,  // ms per frame (60fps target)
});

detector.on("bottleneck", (analysis) => {
  console.warn("Bottlenecks detected:");
  for (const bottleneck of analysis.bottlenecks) {
    console.warn(`- ${bottleneck.category}: ${bottleneck.description}`);
    console.warn(`  Severity: ${bottleneck.severity}`);
    console.warn(`  Suggestion: ${bottleneck.suggestion}`);
  }
});
```

### Auto Optimizer

Automatic performance tuning:

```typescript
import { AutoOptimizer, createAutoOptimizer } from "@exocortex/obsidian-plugin";

const optimizer = createAutoOptimizer({
  targetFPS: 60,
  minFPS: 30,
  adjustmentInterval: 1000,  // Check every second
});

optimizer.on("adjustment", (event) => {
  console.log(`Adjusting: ${event.action}`);

  switch (event.action) {
    case "reduce-quality":
      lodSystem.setLevel(lodSystem.getLevel() - 1);
      break;
    case "disable-labels":
      labelRenderer.setVisibility(false);
      break;
    case "reduce-edge-quality":
      edgeRenderer.setSimplifiedMode(true);
      break;
    case "increase-quality":
      // FPS is good, increase quality
      lodSystem.setLevel(lodSystem.getLevel() + 1);
      break;
  }
});

optimizer.start();
```

## Performance Dashboard

```typescript
import { PerformanceMetricsDashboard, PerformanceDashboardButton } from "@exocortex/obsidian-plugin";

// Add dashboard button
const button = new PerformanceDashboardButton({
  position: { right: 10, bottom: 10 },
  onClick: () => dashboard.toggle(),
});

const dashboard = new PerformanceMetricsDashboard({
  profiler: getGlobalProfiler(),
  memoryManager: getGlobalMemoryManager(),
  updateInterval: 100,
  showGraph: true,
});

// Show dashboard
dashboard.show();
```

## Best Practices Summary

### For 10K+ Nodes

1. Use Barnes-Hut with `theta: 1.0`
2. Enable LOD system
3. Use visibility culling
4. Use batched rendering
5. Consider WebGPU physics

### For 50K+ Nodes

1. Use WebGPU physics
2. Maximum LOD settings
3. Viewport windowing
4. Object pooling
5. Incremental rendering
6. Disable labels at overview
7. Simplified edge rendering

### Common Mistakes

| Mistake | Solution |
|---------|----------|
| Re-rendering every frame | Use dirty tracking |
| Creating new objects in loops | Use object pooling |
| Rendering off-screen nodes | Use visibility culling |
| Full-detail at all zoom levels | Use LOD system |
| Synchronous layout for large graphs | Use async/Web Worker |

## See Also

- [Configuration](../getting-started/configuration.md) - Performance options
- [ForceSimulation API](../api/physics-engine.md) - Physics tuning
- [PixiGraphRenderer API](../api/renderer.md) - Renderer options
