# Layouts Guide

This guide covers different layout algorithms and when to use each.

## Layout Selection

| Layout | Best For | Graph Size | Interactive |
|--------|----------|------------|-------------|
| Force-directed | General exploration | < 10K | Yes |
| Hierarchical | Trees, DAGs, org charts | < 5K | Limited |
| Radial | Ego networks, focus analysis | < 2K | Yes |
| Temporal | Timelines, sequences | < 2K | Limited |
| Community | Clustered data | < 20K | Yes |

## Force-Directed Layout

The default layout using physics simulation for organic node placement.

### When to Use

- General graph exploration
- Unknown graph structure
- Need for interactive manipulation
- Graphs with unclear hierarchy

### Configuration

```typescript
import {
  ForceSimulation,
  forceCenter,
  forceManyBody,
  forceLink,
  forceCollide,
  FORCE_PRESETS,
} from "./presentation/renderers/graph";

// Basic setup
const simulation = new ForceSimulation()
  .nodes(nodes)
  .force("center", forceCenter(width / 2, height / 2))
  .force("charge", forceManyBody().strength(-300))
  .force("link", forceLink(edges).distance(100))
  .force("collide", forceCollide().radius(20));

// Using presets
simulation.configure(FORCE_PRESETS.clustered);
```

### Force Presets

```typescript
// Default - balanced for general use
FORCE_PRESETS.default = {
  center: { strength: 0.1 },
  charge: { strength: -300, theta: 0.9 },
  link: { distance: 100, strength: 1 },
};

// Clustered - tight groups
FORCE_PRESETS.clustered = {
  center: { strength: 0.05 },
  charge: { strength: -100, distanceMax: 200 },
  link: { distance: 50, strength: 2 },
};

// Sparse - spread out
FORCE_PRESETS.sparse = {
  center: { strength: 0.02 },
  charge: { strength: -500, theta: 0.5 },
  link: { distance: 200, strength: 0.5 },
};
```

### Tuning Tips

| Goal | Adjust |
|------|--------|
| More spread out | Increase charge strength (more negative) |
| Tighter clusters | Decrease charge strength, increase link strength |
| Faster stabilization | Increase alphaDecay |
| Smoother movement | Decrease velocityDecay |

## Hierarchical Layout

For tree structures and directed acyclic graphs (DAGs).

### When to Use

- Org charts
- File system trees
- Dependency graphs
- Process flows

### Configuration

```typescript
import { HierarchicalLayout, HIERARCHICAL_PRESETS } from "./presentation/renderers/graph";

const layout = new HierarchicalLayout({
  direction: "TB",           // Top to Bottom
  layerSpacing: 100,         // Space between levels
  nodeSpacing: 50,           // Space between siblings
  rankingAlgorithm: "network-simplex",  // Best for most cases
  crossingMinimization: "barycenter",   // Reduce edge crossings
  alignLeaves: true,         // Align leaf nodes
});

const result = layout.compute(nodes, edges);
```

### Direction Options

```typescript
// Top to Bottom (default)
{ direction: "TB" }

// Bottom to Top
{ direction: "BT" }

// Left to Right
{ direction: "LR" }

// Right to Left
{ direction: "RL" }
```

### Handling DAGs

For graphs with multiple parents:

```typescript
const layout = new HierarchicalLayout({
  direction: "TB",
  rankingAlgorithm: "network-simplex",  // Handles DAGs well
  crossingMinimization: "median",       // Better for complex graphs
});
```

## Radial Layout

Circular arrangement with focus node at center.

### When to Use

- Ego networks (connections from one person/item)
- Exploring relationships from a central entity
- Hierarchies with radial aesthetic

### Configuration

```typescript
import { RadialLayout, RADIAL_PRESETS } from "./presentation/renderers/graph";

const layout = new RadialLayout({
  focusNode: selectedNodeId,  // Center node
  centerX: width / 2,
  centerY: height / 2,
  minRadius: 50,              // Inner ring
  maxRadius: 400,             // Outer ring
  ringSpacing: 80,            // Distance between rings
  subtreeAngle: "weighted",   // Allocate angle by subtree size
  sortBy: "connections",      // Sort nodes on rings
});

const result = layout.compute(nodes, edges);
```

### Focus Node Behavior

```typescript
// Change focus node dynamically
function onNodeDoubleClick(nodeId: string) {
  layout.setFocus(nodeId);
  const newResult = layout.compute(nodes, edges);
  animateToPositions(newResult.nodes);
}
```

### Angle Strategies

```typescript
// Equal - same angle for all subtrees
{ subtreeAngle: "equal" }

// Weighted - angle proportional to subtree size
{ subtreeAngle: "weighted" }

// Fixed - specific angle per subtree
{ subtreeAngle: "fixed", subtreeAngles: { "subtree-1": 90, "subtree-2": 180 } }
```

## Temporal Layout

Timeline-based layout for chronological data.

### When to Use

- Event timelines
- Project milestones
- Activity sequences
- Git history

### Configuration

```typescript
import { TemporalLayout, TEMPORAL_PRESETS } from "./presentation/renderers/graph";

const layout = new TemporalLayout({
  orientation: "horizontal",
  timeField: "createdAt",     // Property with timestamps
  timeScale: "linear",        // linear, log, ordinal
  laneStrategy: "type",       // Group by type
  showTimeline: true,         // Show axis
  timeFormat: "YYYY-MM-DD",
  laneSpacing: 60,
});

const result = layout.compute(nodesWithTimestamps, edges);

// Get timeline markers for axis
const markers = layout.getTimeMarkers();
```

### Lane Strategies

```typescript
// Single lane - all nodes in one row
{ laneStrategy: "single" }

// By type - lanes by node group
{ laneStrategy: "type" }

// By cluster - detected clusters get lanes
{ laneStrategy: "cluster" }

// Custom - provide lane assignment function
{
  laneStrategy: "custom",
  laneAssignment: (node) => node.metadata?.category || "default"
}
```

## Community Detection

Automatically detect and visualize communities.

### When to Use

- Social networks
- Collaboration networks
- Any graph with natural clusters

### Configuration

```typescript
import { detectCommunities, CommunityLayout, assignCommunityColors } from "./presentation/renderers/graph";

// Detect communities
const detection = detectCommunities(nodes, edges, {
  resolution: 1.0,     // Higher = more communities
  randomSeed: 42,      // For reproducibility
  maxIterations: 100,
});

console.log(`Found ${detection.communities.length} communities`);

// Assign colors
const colors = assignCommunityColors(detection.communities);

// Apply to nodes
for (const node of nodes) {
  const communityId = detection.assignment.get(node.id);
  node.group = `community-${communityId}`;
  node.color = colors.get(communityId);
}

// Layout with community grouping
const layout = new CommunityLayout({
  communities: detection.communities,
  intraClusterForce: -100,   // Force within cluster
  interClusterForce: -300,   // Force between clusters
  clusterPadding: 50,        // Space between clusters
});

const result = layout.compute(nodes, edges);
```

## Layout Transitions

Smoothly animate between layouts:

```typescript
import { LayoutTransitionManager, TRANSITION_PRESETS } from "./presentation/renderers/graph";

const transitionManager = new LayoutTransitionManager({
  duration: 500,
  easing: "easeInOutCubic",
});

// Save current positions
const oldPositions = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));

// Compute new layout
const newLayout = new HierarchicalLayout();
const newResult = newLayout.compute(nodes, edges);

// Animate transition
await transitionManager.transition(oldPositions, newResult.nodes, {
  onProgress: (progress) => {
    // Update node positions
    for (let i = 0; i < nodes.length; i++) {
      const start = oldPositions[i];
      const end = newResult.nodes.find((n) => n.id === start.id)!;
      nodes[i].x = start.x + (end.x - start.x) * progress;
      nodes[i].y = start.y + (end.y - start.y) * progress;
    }
    render();
  },
});
```

## Custom Layouts

Create custom layout algorithms:

```typescript
import { BaseLayoutAlgorithm, LayoutPluginRegistry, layoutPluginRegistry } from "./presentation/renderers/graph";

class CircularLayout extends BaseLayoutAlgorithm {
  compute(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
    const result = [];
    const angleStep = (2 * Math.PI) / nodes.length;

    for (let i = 0; i < nodes.length; i++) {
      const angle = i * angleStep;
      result.push({
        id: nodes[i].id,
        x: this.options.centerX + this.options.radius * Math.cos(angle),
        y: this.options.centerY + this.options.radius * Math.sin(angle),
      });
    }

    return { nodes: result, edges };
  }
}

// Register plugin
layoutPluginRegistry.register({
  name: "circular",
  displayName: "Circular Layout",
  category: "radial",
  factory: (options) => new CircularLayout(options),
  options: [
    { name: "radius", type: "number", default: 200 },
    { name: "centerX", type: "number", default: 400 },
    { name: "centerY", type: "number", default: 300 },
  ],
});

// Use custom layout
const layout = layoutPluginRegistry.get("circular");
const result = layout.compute(nodes, edges);
```

## Performance Considerations

| Layout | Complexity | Memory | Best Practices |
|--------|-----------|--------|----------------|
| Force | O(n log n) | O(n) | Use Barnes-Hut, limit iterations |
| Hierarchical | O(n²) | O(n) | Cache layer assignments |
| Radial | O(n log n) | O(n) | Limit ring count |
| Temporal | O(n log n) | O(n) | Use ordinal scale for many events |
| Community | O(n²) | O(n²) | Pre-compute for large graphs |

## See Also

- [ForceSimulation API](../api/physics-engine.md) - Physics engine details
- [LayoutManager API](../api/layout-engine.md) - Layout manager reference
- [Performance](./performance.md) - Large graph optimization
