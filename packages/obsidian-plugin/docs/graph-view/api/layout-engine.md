# LayoutManager API

The LayoutManager orchestrates layout algorithms and provides smooth transitions between different layouts.

## Import

```typescript
import {
  LayoutManager,
  createLayoutManager,
  HierarchicalLayout,
  RadialLayout,
  TemporalLayout,
  detectCommunities,
  LayoutPluginRegistry,
} from "./presentation/renderers/graph";

import type {
  LayoutAlgorithmName,
  LayoutResult,
  LayoutManagerConfig,
  HierarchicalLayoutOptions,
  RadialLayoutOptions,
  TemporalLayoutOptions,
} from "./presentation/renderers/graph";
```

## LayoutManager

### Constructor

```typescript
const layoutManager = createLayoutManager(config?: LayoutManagerConfig);

interface LayoutManagerConfig {
  defaultLayout: LayoutAlgorithmName;  // Default layout algorithm
  transitionDuration: number;           // Animation duration (ms)
  transitionEasing: EasingFunction;     // Easing function
  preservePositions: boolean;           // Preserve node positions during transitions
}
```

### Methods

#### setLayout(name, options?)

Switch to a different layout:

```typescript
// Switch to hierarchical layout
layoutManager.setLayout("hierarchical", {
  direction: "TB",
  layerSpacing: 100,
});

// Switch to radial layout
layoutManager.setLayout("radial", {
  focusNode: "node-1",
  ringSpacing: 80,
});
```

#### getLayout()

Get the current layout:

```typescript
const current = layoutManager.getLayout();
console.log(current.name);    // "force"
console.log(current.options); // { chargeStrength: -300, ... }
```

#### compute(nodes, edges)

Compute layout positions:

```typescript
const result: LayoutResult = layoutManager.compute(nodes, edges);

for (const node of result.nodes) {
  console.log(`${node.id}: (${node.x}, ${node.y})`);
}
```

#### transition(fromPositions, toPositions, options?)

Animate between layouts:

```typescript
const oldPositions = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));

layoutManager.setLayout("hierarchical");
const newResult = layoutManager.compute(nodes, edges);

await layoutManager.transition(oldPositions, newResult.nodes, {
  duration: 500,
  easing: "easeInOutCubic",
  onProgress: (progress) => {
    console.log(`${progress * 100}% complete`);
  },
});
```

#### on(event, callback)

Subscribe to layout events:

```typescript
layoutManager.on("layoutChange", (event) => {
  console.log(`Changed to ${event.name}`);
});

layoutManager.on("transitionStart", () => {
  console.log("Transition started");
});

layoutManager.on("transitionEnd", () => {
  console.log("Transition complete");
});
```

## HierarchicalLayout

For tree and DAG visualization:

```typescript
const layout = new HierarchicalLayout(options?: HierarchicalLayoutOptions);
```

### Options

```typescript
interface HierarchicalLayoutOptions {
  direction: "TB" | "BT" | "LR" | "RL";  // Layout direction
  layerSpacing: number;      // Space between layers (default: 100)
  nodeSpacing: number;       // Space between siblings (default: 50)
  rankingAlgorithm: "longest-path" | "tight-tree" | "network-simplex";
  crossingMinimization: "barycenter" | "median" | "none";
  coordinateAssignment: "barycenter" | "priority" | "fast";
  alignLeaves: boolean;      // Align leaf nodes (default: true)
  groupClusters: boolean;    // Group by cluster (default: false)
}
```

### Methods

```typescript
// Compute layout
const result = layout.compute(nodes, edges);

// Get layer assignments
const layers = layout.getLayers();

// Set root nodes manually
layout.setRoots(["node-1", "node-2"]);
```

### Presets

```typescript
import { HIERARCHICAL_PRESETS } from "./presentation/renderers/graph";

const layout = new HierarchicalLayout(HIERARCHICAL_PRESETS.topDown);
const layout = new HierarchicalLayout(HIERARCHICAL_PRESETS.leftRight);
const layout = new HierarchicalLayout(HIERARCHICAL_PRESETS.compact);
const layout = new HierarchicalLayout(HIERARCHICAL_PRESETS.wide);
```

### Example

```typescript
const layout = new HierarchicalLayout({
  direction: "TB",
  layerSpacing: 120,
  nodeSpacing: 60,
  rankingAlgorithm: "network-simplex",
});

const result = layout.compute(nodes, edges);

// Apply positions
for (const node of result.nodes) {
  const original = nodes.find((n) => n.id === node.id);
  if (original) {
    original.x = node.x;
    original.y = node.y;
  }
}
```

## RadialLayout

For circular/radial visualization with focus node:

```typescript
const layout = new RadialLayout(options?: RadialLayoutOptions);
```

### Options

```typescript
interface RadialLayoutOptions {
  focusNode?: string;        // Central node ID
  centerX: number;           // Center X coordinate
  centerY: number;           // Center Y coordinate
  minRadius: number;         // Inner ring radius (default: 50)
  maxRadius: number;         // Outer ring radius (default: 400)
  ringSpacing: number;       // Distance between rings (default: 80)
  sortBy: "connections" | "alphabetical" | "distance" | "none";
  sortOrder: "asc" | "desc";
  subtreeAngle: "equal" | "weighted" | "fixed";
  ringAssignment: "bfs" | "depth" | "custom";
  edgeRouting: "straight" | "curved" | "bundled";
  startAngle: number;        // Starting angle (radians)
  endAngle: number;          // Ending angle (radians)
}
```

### Methods

```typescript
// Compute layout
const result = layout.compute(nodes, edges);

// Set focus node
layout.setFocus("node-1");

// Get ring assignments
const rings = layout.getRings();
```

### Presets

```typescript
import { RADIAL_PRESETS } from "./presentation/renderers/graph";

const layout = new RadialLayout(RADIAL_PRESETS.balanced);
const layout = new RadialLayout(RADIAL_PRESETS.compact);
const layout = new RadialLayout(RADIAL_PRESETS.semicircle);
```

### Example

```typescript
const layout = new RadialLayout({
  focusNode: selectedNodeId,
  centerX: width / 2,
  centerY: height / 2,
  maxRadius: Math.min(width, height) / 2 - 50,
  subtreeAngle: "weighted",
});

const result = layout.compute(nodes, edges);
```

## TemporalLayout

For timeline-based visualization:

```typescript
const layout = new TemporalLayout(options?: TemporalLayoutOptions);
```

### Options

```typescript
interface TemporalLayoutOptions {
  orientation: "horizontal" | "vertical";
  timeField: string;         // Property name for timestamps
  timeScale: "linear" | "log" | "ordinal";
  laneStrategy: "type" | "cluster" | "single" | "custom";
  gapStrategy: "fixed" | "proportional" | "none";
  minGap: number;            // Minimum gap between items
  nodeAlignment: "start" | "center" | "end";
  showTimeline: boolean;     // Display timeline axis
  timeFormat: string;        // Date format string
  laneSpacing: number;       // Space between lanes
}
```

### Methods

```typescript
// Compute layout
const result = layout.compute(nodes, edges);

// Get time markers for axis
const markers: TimeMarker[] = layout.getTimeMarkers();

// Get lane assignments
const lanes: Lane[] = layout.getLanes();
```

### Presets

```typescript
import { TEMPORAL_PRESETS } from "./presentation/renderers/graph";

const layout = new TemporalLayout(TEMPORAL_PRESETS.timeline);
const layout = new TemporalLayout(TEMPORAL_PRESETS.swimlane);
const layout = new TemporalLayout(TEMPORAL_PRESETS.vertical);
```

### Example

```typescript
const layout = new TemporalLayout({
  orientation: "horizontal",
  timeField: "createdAt",
  timeScale: "linear",
  laneStrategy: "type",
  showTimeline: true,
});

const result = layout.compute(nodesWithTimestamps, edges);

// Render timeline axis
const markers = layout.getTimeMarkers();
for (const marker of markers) {
  drawTimeMarker(marker.x, marker.label);
}
```

## Community Detection

Detect communities using the Louvain algorithm:

```typescript
import { detectCommunities, CommunityLayout } from "./presentation/renderers/graph";

// Detect communities
const result = detectCommunities(nodes, edges, {
  resolution: 1.0,     // Higher = more communities
  randomSeed: 42,      // For reproducibility
  maxIterations: 100,
});

console.log(`Found ${result.communities.length} communities`);

// Apply community colors
for (const node of nodes) {
  const community = result.assignment.get(node.id);
  node.group = `community-${community}`;
  node.color = result.colors.get(community);
}

// Layout with community grouping
const communityLayout = new CommunityLayout({
  communities: result.communities,
  intraClusterForce: -100,
  interClusterForce: -300,
  clusterPadding: 50,
});

const positions = communityLayout.compute(nodes, edges);
```

## Layout Plugin Registry

Register custom layout algorithms:

```typescript
import {
  LayoutPluginRegistry,
  layoutPluginRegistry,
  createLayoutPlugin,
  BaseLayoutAlgorithm,
} from "./presentation/renderers/graph";

// Create custom layout
class MyCustomLayout extends BaseLayoutAlgorithm {
  compute(nodes, edges) {
    // Custom positioning logic
    return nodes.map((node, i) => ({
      id: node.id,
      x: i * 100,
      y: Math.sin(i) * 100,
    }));
  }
}

// Create plugin
const myPlugin = createLayoutPlugin({
  name: "custom",
  displayName: "My Custom Layout",
  category: "experimental",
  factory: (options) => new MyCustomLayout(options),
  options: [
    {
      name: "amplitude",
      type: "number",
      default: 100,
      min: 10,
      max: 500,
    },
  ],
});

// Register plugin
layoutPluginRegistry.register(myPlugin);

// Use custom layout
layoutManager.setLayout("custom", { amplitude: 200 });
```

### Querying Plugins

```typescript
// Get all plugins
const all = layoutPluginRegistry.getAll();

// Get by category
const hierarchical = layoutPluginRegistry.getByCategory("hierarchical");

// Get by graph type
const suitable = layoutPluginRegistry.getForGraphType("tree");
```

## Easing Functions

Available easing functions for transitions:

```typescript
import { getEasingFunction, EASING_FUNCTIONS } from "./presentation/renderers/graph";

// Available easings
const easings = [
  "linear",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInElastic",
  "easeOutElastic",
  "easeInOutElastic",
  "easeInBounce",
  "easeOutBounce",
  "easeInOutBounce",
];

// Get easing function
const easing = getEasingFunction("easeInOutCubic");
const progress = easing(0.5);  // Returns 0.5 with easing applied
```

## See Also

- [ForceSimulation](./physics-engine.md) - Physics simulation
- [Configuration](../getting-started/configuration.md) - Layout options
- [Layouts Guide](../guides/layouts.md) - Layout selection guide
