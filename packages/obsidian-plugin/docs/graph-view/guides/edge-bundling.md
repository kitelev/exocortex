# Edge Bundling Guide

Edge bundling reduces visual clutter in dense graphs by routing similar edges along common paths, making patterns and connections easier to understand.

## When to Use Edge Bundling

| Scenario | Bundling | Reason |
|----------|----------|--------|
| Dense graphs (>100 edges) | Yes | Reduces visual clutter |
| Simple graphs (<50 edges) | No | Straight edges are clearer |
| Debugging/validation | No | See exact connections |
| Presentation/publication | Yes | More aesthetically pleasing |
| Hierarchical data | Hierarchical | Follows tree structure |
| General dense graphs | FDEB | Algorithm-agnostic bundling |

## Available Bundlers

### StubBundler - No Bundling

Passthrough bundler that returns straight edges. Use for:
- Disabling bundling while maintaining the bundler interface
- Testing and benchmarking
- Simple graphs where bundling is unnecessary

```typescript
import { createStubBundler } from "@exocortex/obsidian-plugin";

const bundler = createStubBundler();
const bundledEdges = bundler.bundle(edges, nodes);
// Returns edges with only source/target control points (straight lines)
```

### FDEBBundler - Force-Directed Edge Bundling

Implements the Force-Directed Edge Bundling algorithm by Holten & van Wijk (2009). This is the **recommended bundler** for most use cases.

**Key Features:**
- Edge compatibility computation (angle, scale, position, visibility)
- Iterative subdivision and force simulation
- Adaptive step size for convergence
- Configurable bundling strength

```typescript
import { createFDEBBundler } from "@exocortex/obsidian-plugin";

const bundler = createFDEBBundler({
  iterations: 60,           // Number of simulation iterations
  stepSize: 0.04,           // Force simulation step size
  compatibility: 0.6,       // Minimum edge compatibility (0-1)
  subdivisionRate: 2,       // Rate of edge subdivision
  springConstant: 0.1,      // Spring force strength
  bundleStrength: 0.85,     // Overall bundling intensity (0-1)
  maxSubdivisions: 64,      // Maximum control points per edge
  adaptiveStepSize: true,   // Enable adaptive convergence
});

const bundledEdges = bundler.bundle(edges, nodes);
```

**Compatibility Measures:**

FDEB determines which edges to bundle using four compatibility measures:

| Measure | Description | High Value Means |
|---------|-------------|------------------|
| Angle | Similarity of edge directions | Parallel edges |
| Scale | Similarity of edge lengths | Similar length edges |
| Position | Proximity of edge midpoints | Nearby edges |
| Visibility | Edges "seeing" each other | No obstructions |

**Combined compatibility** = angle × scale × position × visibility

Only edge pairs with combined compatibility ≥ `compatibility` threshold are bundled.

### HierarchicalBundler - Hierarchical Edge Bundling

Implements hierarchical edge bundling based on Holten (2006). Routes edges through a hierarchy (tree structure) for smooth bundled curves.

**Key Features:**
- Automatic hierarchy construction from graph structure
- Beta parameter for controlling bundle tightness
- Smooth B-spline interpolation through ancestor nodes
- Optimal for tree-like data structures

```typescript
import { createHierarchicalBundler } from "@exocortex/obsidian-plugin";

const bundler = createHierarchicalBundler({
  beta: 0.85,              // Bundling tightness (0 = straight, 1 = follow hierarchy)
  radialLayout: false,     // Use radial layout for hierarchy
  tension: 0.85,           // Curve tension (0-1)
});

const bundledEdges = bundler.bundle(edges, nodes);
```

**Beta Parameter:**

| Beta Value | Effect |
|------------|--------|
| 0.0 | Straight lines between source and target |
| 0.5 | Moderate bundling through hierarchy |
| 0.85 | Strong bundling (recommended) |
| 1.0 | Exactly follows hierarchy path |

## Quick Start

### Basic Usage

```typescript
import { createEdgeBundler } from "@exocortex/obsidian-plugin";

// Create bundler using factory (recommended)
const bundler = createEdgeBundler("fdeb");

// Prepare node map
const nodeMap = new Map<string, GraphNode>();
for (const node of nodes) {
  nodeMap.set(node.id, node);
}

// Bundle edges
const bundledEdges = bundler.bundle(edges, nodeMap);

// Each bundled edge has control points for curved rendering
for (const edge of bundledEdges) {
  console.log(`Edge ${edge.id}: ${edge.controlPoints.length} control points`);
}
```

### With Statistics

```typescript
import { createFDEBBundler } from "@exocortex/obsidian-plugin";

const bundler = createFDEBBundler();
const result = bundler.bundleWithStats(edges, nodeMap);

console.log(`Duration: ${result.duration.toFixed(2)}ms`);
console.log(`Bundled: ${result.bundledCount} edges`);
console.log(`Unbundled: ${result.unbundledCount} edges`);
console.log(`Avg compatibility: ${result.averageCompatibility.toFixed(3)}`);
```

### Rendering Bundled Edges

```typescript
import { createFDEBBundler } from "@exocortex/obsidian-plugin";

const bundler = createFDEBBundler();
const bundledEdges = bundler.bundle(edges, nodeMap);

// Canvas 2D rendering with bezier curves
const ctx = canvas.getContext("2d");

for (const edge of bundledEdges) {
  const points = edge.controlPoints;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    // Straight line (unbundled)
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    // Smooth curve through control points
    for (let i = 1; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }

    // Final segment
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  ctx.stroke();
}
```

## Configuration Reference

### BundlingConfig

```typescript
interface BundlingConfig {
  /** Algorithm to use: "fdeb" | "hierarchical" | "stub" */
  algorithm: BundlingAlgorithm;

  /** Number of iterations for force simulation (FDEB) */
  iterations: number;

  /** Step size for force simulation (FDEB) */
  stepSize: number;

  /** Minimum edge compatibility threshold (0-1) for bundling (FDEB) */
  compatibility: number;

  /** Rate at which edges are subdivided (FDEB) */
  subdivisionRate: number;

  /** Spring constant for edge attraction (FDEB) */
  springConstant: number;

  /** Strength of bundling (0-1), where 1 is maximum bundling */
  bundleStrength: number;

  /** Maximum number of subdivision points per edge */
  maxSubdivisions: number;

  /** Whether to enable adaptive step size */
  adaptiveStepSize: boolean;
}
```

### Default Configuration

```typescript
const DEFAULT_BUNDLING_CONFIG: BundlingConfig = {
  algorithm: "fdeb",
  iterations: 60,
  stepSize: 0.04,
  compatibility: 0.6,
  subdivisionRate: 2,
  springConstant: 0.1,
  bundleStrength: 0.85,
  maxSubdivisions: 64,
  adaptiveStepSize: true,
};
```

### HierarchicalBundlingConfig

```typescript
interface HierarchicalBundlingConfig extends BundlingConfig {
  /** Beta parameter for hierarchical bundling (0-1) */
  beta: number;

  /** Whether to use radial layout for hierarchy */
  radialLayout: boolean;

  /** Tension for the bundled curves (0-1) */
  tension: number;
}

const DEFAULT_HIERARCHICAL_CONFIG: HierarchicalBundlingConfig = {
  ...DEFAULT_BUNDLING_CONFIG,
  algorithm: "hierarchical",
  beta: 0.85,
  radialLayout: false,
  tension: 0.85,
};
```

## Tuning Parameters

### FDEB Tuning Guide

| Goal | Parameter | Adjust |
|------|-----------|--------|
| Tighter bundles | `bundleStrength` | Increase toward 1.0 |
| Looser bundles | `bundleStrength` | Decrease toward 0.0 |
| More edges bundled | `compatibility` | Decrease (e.g., 0.4) |
| Only similar edges | `compatibility` | Increase (e.g., 0.8) |
| Smoother curves | `maxSubdivisions` | Increase (e.g., 128) |
| Faster computation | `iterations` | Decrease (e.g., 30) |
| Better convergence | `adaptiveStepSize` | Enable (true) |

### Performance vs Quality Trade-offs

| Setting | Performance | Quality |
|---------|-------------|---------|
| `iterations: 30` | Fast (~50ms) | Lower |
| `iterations: 60` | Medium (~100ms) | Good |
| `iterations: 100` | Slow (~200ms) | High |
| `compatibility: 0.4` | Slower (more pairs) | More bundling |
| `compatibility: 0.8` | Faster (fewer pairs) | Less bundling |
| `maxSubdivisions: 32` | Fast | Slightly angular |
| `maxSubdivisions: 64` | Medium | Smooth |
| `maxSubdivisions: 128` | Slow | Very smooth |

## Bundled Edge Output

```typescript
interface BundledEdge {
  /** Unique identifier for the edge */
  id: string;

  /** Source node ID */
  sourceId: string;

  /** Target node ID */
  targetId: string;

  /** Control points defining the bundled path */
  controlPoints: Vector2[];

  /** Reference to the original edge data */
  originalEdge: GraphEdge;

  /** Compatibility score (for debugging) */
  compatibilityScore?: number;
}
```

### Control Points

- **Unbundled edges**: 2 control points (source, target)
- **Bundled edges**: Many control points (typically 10-64)
- Points define a smooth curve from source to target
- First point = source position
- Last point = target position

## Algorithm Deep Dive

### FDEB Algorithm Steps

1. **Initialize**: Create edge segments with source/target points
2. **Compute Compatibility**: Calculate pairwise edge compatibility scores
3. **Simulation Loop**:
   - Subdivide edges (add midpoints)
   - Apply attraction forces between compatible edges
   - Apply spring forces to maintain edge smoothness
   - Adaptive step size for convergence
4. **Output**: Return edges with control points

### FDEB Compatibility Calculation

```typescript
// Angle compatibility: edges with similar angles bundle better
angleCompatibility = |cos(angle between edges)|

// Scale compatibility: edges of similar length bundle better
scaleCompatibility = 2 / (avgLen/minLen + maxLen/avgLen)

// Position compatibility: nearby edges bundle better
positionCompatibility = avgLen / (avgLen + midpointDistance)

// Visibility compatibility: edges that can "see" each other
visibilityCompatibility = overlap * 2  // (0-1)

// Combined compatibility (all must be high for bundling)
combined = angle × scale × position × visibility
```

### Hierarchical Bundling Algorithm Steps

1. **Build Hierarchy**: Cluster nodes based on connections
2. **Create Virtual Nodes**: Add cluster centers and root
3. **Find LCA**: For each edge, find lowest common ancestor in hierarchy
4. **Route Through Hierarchy**: Path from source → LCA → target
5. **Apply Beta**: Interpolate between straight line and hierarchy path
6. **Smooth**: Apply Catmull-Rom spline interpolation

## Utility Functions

The bundling module exports useful vector math utilities:

```typescript
import {
  distance,       // Euclidean distance between two points
  midpoint,       // Midpoint between two points
  normalize,      // Normalize vector to unit length
  dot,            // Dot product of two vectors
  subtract,       // Vector subtraction
  add,            // Vector addition
  scale,          // Scale vector by scalar
  lerp,           // Linear interpolation
  projectOntoLine // Project point onto line segment
} from "@exocortex/obsidian-plugin";

// Example: Calculate edge length
const length = distance(sourcePos, targetPos);

// Example: Find midpoint
const mid = midpoint(sourcePos, targetPos);

// Example: Interpolate along edge
const point = lerp(sourcePos, targetPos, 0.5); // Middle point
```

## Common Patterns

### Dynamic Bundling Toggle

```typescript
let bundlingEnabled = true;
let bundler = createEdgeBundler("fdeb");

function toggleBundling() {
  bundlingEnabled = !bundlingEnabled;
  bundler = bundlingEnabled
    ? createEdgeBundler("fdeb")
    : createEdgeBundler("stub");

  rebundleEdges();
}

function rebundleEdges() {
  const bundledEdges = bundler.bundle(edges, nodeMap);
  renderEdges(bundledEdges);
}
```

### Adjust Bundling on Graph Density

```typescript
function createOptimalBundler(edgeCount: number) {
  if (edgeCount < 50) {
    return createEdgeBundler("stub");
  }

  if (edgeCount < 200) {
    return createFDEBBundler({
      iterations: 30,
      compatibility: 0.7,
    });
  }

  // Dense graph - more aggressive bundling
  return createFDEBBundler({
    iterations: 60,
    compatibility: 0.5,
    bundleStrength: 0.9,
  });
}
```

### Cache Bundled Edges

```typescript
class BundlingCache {
  private cache = new Map<string, BundledEdge[]>();
  private bundler: EdgeBundler;

  constructor() {
    this.bundler = createFDEBBundler();
  }

  bundle(edges: GraphEdge[], nodes: Map<string, GraphNode>): BundledEdge[] {
    const key = this.computeCacheKey(edges, nodes);

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const result = this.bundler.bundle(edges, nodes);
    this.cache.set(key, result);
    return result;
  }

  private computeCacheKey(edges: GraphEdge[], nodes: Map<string, GraphNode>): string {
    // Hash based on edge IDs and node positions
    const edgeIds = edges.map(e => e.id).sort().join(",");
    const nodePositions = [...nodes.values()]
      .map(n => `${n.id}:${n.x?.toFixed(0)}:${n.y?.toFixed(0)}`)
      .sort()
      .join(",");
    return `${edgeIds}|${nodePositions}`;
  }

  invalidate() {
    this.cache.clear();
  }
}
```

## Performance Considerations

| Graph Size | Recommended Bundler | Iterations | Expected Time |
|------------|---------------------|------------|---------------|
| <100 edges | StubBundler | N/A | <1ms |
| 100-500 edges | FDEB | 30-40 | 20-50ms |
| 500-2000 edges | FDEB | 40-60 | 50-150ms |
| >2000 edges | FDEB with high threshold | 30-50 | 100-300ms |

### Optimization Tips

1. **Raise compatibility threshold** for large graphs to reduce pair comparisons
2. **Lower iterations** for interactive use cases (30 is often sufficient)
3. **Cache results** when graph structure doesn't change
4. **Use web worker** for bundling to keep UI responsive
5. **Consider stub bundler** during drag operations, re-bundle on release

## See Also

- [Layouts Guide](./layouts.md) - Layout algorithms
- [Performance Guide](./performance.md) - Large graph optimization
- [Styling Guide](./styling.md) - Visual customization
- [ForceSimulation API](../api/physics-engine.md) - Physics engine details

## References

- Holten, D. and Van Wijk, J.J., 2009. "Force-Directed Edge Bundling for Graph Visualization." Computer Graphics Forum, 28(3), pp.983-990.
- Holten, D., 2006. "Hierarchical Edge Bundles: Visualization of Adjacency Relations in Hierarchical Data." IEEE Transactions on Visualization and Computer Graphics, 12(5), pp.741-748.
