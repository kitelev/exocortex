# Path Finding Guide

This guide covers path finding functionality for discovering connections between nodes in the graph visualization.

## Overview

The path finding system enables you to:

- Find shortest paths between any two nodes
- Choose from multiple algorithms (BFS, Dijkstra, Bidirectional)
- Control path direction and weight strategies
- Visualize paths with customizable styling
- Navigate between multiple discovered paths

## Quick Start

```typescript
import {
  PathFinder,
  PathFindingManager,
  createPathFinder,
  createPathFindingManager,
} from "./presentation/renderers/graph";

// Create path finder with default options
const pathFinder = createPathFinder();

// Set graph data
pathFinder.setGraph(nodes, edges);

// Find path between two nodes
const result = pathFinder.findPath("nodeA", "nodeB");

if (result.found) {
  console.log("Path found:", result.paths[0].nodeIds);
  console.log("Path length:", result.paths[0].length);
  console.log("Nodes visited:", result.nodesVisited);
} else {
  console.log("No path found");
}
```

## PathFinder Class

The `PathFinder` class implements graph path finding algorithms.

### Creation

```typescript
import { PathFinder, createPathFinder } from "./presentation/renderers/graph";

// Using factory function (recommended)
const pathFinder = createPathFinder({
  algorithm: "bfs",
  maxLength: 10,
  direction: "both",
});

// Using class directly
const pathFinder = new PathFinder({
  algorithm: "dijkstra",
  weightStrategy: "property",
});
```

### Setting Graph Data

```typescript
import type { GraphNode, GraphEdge } from "./presentation/renderers/graph";

const nodes: GraphNode[] = [
  { id: "A", label: "Node A", path: "/A.md" },
  { id: "B", label: "Node B", path: "/B.md" },
  { id: "C", label: "Node C", path: "/C.md" },
];

const edges: GraphEdge[] = [
  { id: "e1", source: "A", target: "B", weight: 1 },
  { id: "e2", source: "B", target: "C", weight: 2 },
];

pathFinder.setGraph(nodes, edges);
```

### Finding Paths

```typescript
// Basic path finding
const result = pathFinder.findPath("A", "C");

// Override options per-query
const result = pathFinder.findPath("A", "C", {
  algorithm: "dijkstra",
  maxLength: 5,
});

// Check result
if (result.found) {
  const path = result.paths[0];
  console.log("Nodes:", path.nodeIds);      // ["A", "B", "C"]
  console.log("Edges:", path.edgeIds);      // ["e1", "e2"]
  console.log("Length:", path.length);       // 2
  console.log("Weight:", path.totalWeight);  // 3
}
```

## Algorithms

### BFS (Breadth-First Search)

Finds shortest path by edge count. Best for unweighted graphs.

```typescript
const pathFinder = createPathFinder({
  algorithm: "bfs",
});

const result = pathFinder.findPath("A", "F");
// Always finds path with minimum number of edges
```

**Characteristics:**
- Time complexity: O(V + E)
- Guarantees shortest path by edge count
- Ignores edge weights
- Best for unweighted or uniformly-weighted graphs

### Dijkstra's Algorithm

Finds shortest path by total weight. Best for weighted graphs.

```typescript
const pathFinder = createPathFinder({
  algorithm: "dijkstra",
  weightStrategy: "property", // Use edge.weight
});

pathFinder.setGraph(nodes, edges);
const result = pathFinder.findPath("A", "F");
// Finds path with minimum total weight
```

**Characteristics:**
- Time complexity: O((V + E) log V)
- Guarantees shortest weighted path
- Respects edge weights
- Best for weighted graphs with varying edge costs

### Bidirectional BFS

Searches from both source and target simultaneously. Faster for large graphs.

```typescript
const pathFinder = createPathFinder({
  algorithm: "bidirectional",
  direction: "both", // Required for bidirectional
});

const result = pathFinder.findPath("A", "F");
// Faster for large graphs with many paths
```

**Characteristics:**
- Time complexity: O(b^(d/2)) where b is branching factor, d is depth
- Significantly faster for large graphs
- Requires bidirectional traversal (`direction: "both"`)
- Best for large graphs where source and target are far apart

## Path Finding Options

```typescript
interface PathFindingOptions {
  // Algorithm selection
  algorithm: "bfs" | "dijkstra" | "bidirectional";

  // Path constraints
  maxLength: number;              // Maximum edges in path (default: 10)
  direction: "outgoing" | "incoming" | "both";  // Traversal direction

  // Multiple paths
  findAllPaths: boolean;          // Find all shortest paths (default: false)
  maxPaths: number;               // Max paths when findAllPaths=true (default: 5)

  // Weight configuration
  weightStrategy: "uniform" | "property" | "predicate";
  preferredPredicates?: string[]; // Lower weight for these predicates
  avoidedPredicates?: string[];   // Higher weight for these predicates
  customWeightFn?: (edge: GraphEdge) => number;

  // Performance
  timeoutMs: number;              // Search timeout (default: 5000)
}
```

### Default Options

```typescript
const DEFAULT_PATH_FINDING_OPTIONS: PathFindingOptions = {
  algorithm: "bfs",
  maxLength: 10,
  direction: "both",
  findAllPaths: false,
  maxPaths: 5,
  weightStrategy: "uniform",
  timeoutMs: 5000,
};
```

## Direction Constraints

Control which edge directions are traversable:

```typescript
// Follow only outgoing edges (A → B → C)
const pathFinder = createPathFinder({
  direction: "outgoing",
});

// Follow only incoming edges (C ← B ← A)
const pathFinder = createPathFinder({
  direction: "incoming",
});

// Follow edges in both directions (default)
const pathFinder = createPathFinder({
  direction: "both",
});
```

**Example:**

```typescript
// Graph: A → B → C
const nodes = [
  { id: "A", label: "A", path: "/A.md" },
  { id: "B", label: "B", path: "/B.md" },
  { id: "C", label: "C", path: "/C.md" },
];
const edges = [
  { id: "e1", source: "A", target: "B" },
  { id: "e2", source: "B", target: "C" },
];

// Outgoing only
const pathFinder = createPathFinder({ direction: "outgoing" });
pathFinder.setGraph(nodes, edges);

pathFinder.findPath("A", "C"); // Found: A → B → C
pathFinder.findPath("C", "A"); // Not found (can't go backwards)

// Both directions
const pathFinderBoth = createPathFinder({ direction: "both" });
pathFinderBoth.setGraph(nodes, edges);

pathFinderBoth.findPath("A", "C"); // Found: A → B → C
pathFinderBoth.findPath("C", "A"); // Found: C ← B ← A
```

## Weight Strategies

### Uniform Weights

All edges have weight 1:

```typescript
const pathFinder = createPathFinder({
  algorithm: "dijkstra",
  weightStrategy: "uniform",
});
// Behaves like BFS
```

### Property-Based Weights

Use `edge.weight` property:

```typescript
const edges: GraphEdge[] = [
  { id: "e1", source: "A", target: "B", weight: 1 },
  { id: "e2", source: "A", target: "C", weight: 5 },
  { id: "e3", source: "C", target: "B", weight: 1 },
];

const pathFinder = createPathFinder({
  algorithm: "dijkstra",
  weightStrategy: "property",
});

// Path A → B (weight 1) preferred over A → C → B (weight 6)
```

### Predicate-Based Weights

Weight by edge predicate/property type:

```typescript
const edges: GraphEdge[] = [
  { id: "e1", source: "A", target: "B", property: "rdfs:subClassOf" },
  { id: "e2", source: "A", target: "C", property: "exo:relatedTo" },
];

const pathFinder = createPathFinder({
  algorithm: "dijkstra",
  weightStrategy: "predicate",
  preferredPredicates: ["rdfs:subClassOf", "owl:sameAs"],  // weight: 0.5
  avoidedPredicates: ["exo:mentions"],                     // weight: 10
  // Other predicates: weight: 1
});
```

### Custom Weight Function

Full control over edge weights:

```typescript
const pathFinder = createPathFinder({
  algorithm: "dijkstra",
  customWeightFn: (edge) => {
    // Prefer recent relationships
    const age = Date.now() - (edge.createdAt ?? 0);
    const ageWeight = age / (1000 * 60 * 60 * 24); // Days old

    // Prefer strong relationships
    const strength = edge.strength ?? 1;

    return ageWeight / strength;
  },
});
```

## Path Result

```typescript
interface PathFindingResult {
  found: boolean;                    // Whether path was found
  paths: Path[];                     // Found paths (empty if not found)
  sourceId: string;                  // Source node ID
  targetId: string;                  // Target node ID
  algorithm: PathFindingAlgorithm;   // Algorithm used
  nodesVisited: number;              // Nodes explored during search
  searchTimeMs: number;              // Search duration
  timedOut: boolean;                 // Whether search timed out
  error?: string;                    // Error message if failed
}

interface Path {
  id: string;           // Unique path identifier
  source: GraphNode;    // Source node
  target: GraphNode;    // Target node
  steps: PathStep[];    // All steps including source and target
  totalWeight: number;  // Sum of edge weights
  length: number;       // Number of edges
  nodeIds: string[];    // All node IDs in order
  edgeIds: string[];    // All edge IDs in order
}

interface PathStep {
  node: GraphNode;           // Node at this step
  edge: GraphEdge | null;    // Edge taken (null for source)
  isReverse: boolean;        // Edge traversed in reverse direction
  cumulativeWeight: number;  // Total weight to this point
}
```

## PathFindingManager

For UI integration, use `PathFindingManager` which handles:

- Node selection workflow
- Path visualization state
- Multiple path navigation
- Event notifications

### Basic Usage

```typescript
import { createPathFindingManager } from "./presentation/renderers/graph";

const manager = createPathFindingManager();

// Set graph data
manager.setGraph(nodes, edges);

// Listen for events
manager.addEventListener((event) => {
  switch (event.type) {
    case "pathfinding:found":
      highlightPath(event.path);
      break;
    case "pathfinding:not-found":
      showMessage("No path exists between selected nodes");
      break;
  }
});

// Start path finding mode
manager.start();
```

### Node Selection Workflow

```typescript
// Start path finding mode
manager.start();

// User clicks first node → source selected
manager.handleNodeClick("nodeA");
// Event: "pathfinding:source-selected"

// User clicks second node → target selected, search starts
manager.handleNodeClick("nodeB");
// Events: "pathfinding:target-selected", "pathfinding:searching", "pathfinding:found"
```

### Programmatic Selection

```typescript
// Set source and target directly
manager.setSource("nodeA");
manager.setTarget("nodeB");
// Auto-searches when both are set

// Swap source and target
manager.swapSourceTarget();

// Re-run search with current selection
manager.search();

// Clear selection and path
manager.clear();

// Exit path finding mode
manager.cancel();
```

### Path Navigation

When multiple paths are found:

```typescript
// Navigate between paths
manager.nextPath();
manager.previousPath();
manager.selectPath(2);

// Get current path
const path = manager.getCurrentPath();

// Check path membership
const isOnPath = manager.isNodeOnPath("nodeId");
const isEdgeOnPath = manager.isEdgeOnPath("edgeId");
```

### Events

```typescript
type PathFindingEventType =
  | "pathfinding:start"           // Mode activated
  | "pathfinding:source-selected" // Source node selected
  | "pathfinding:target-selected" // Target node selected
  | "pathfinding:searching"       // Search in progress
  | "pathfinding:found"           // Path(s) found
  | "pathfinding:not-found"       // No path exists
  | "pathfinding:error"           // Search error
  | "pathfinding:path-change"     // Different path selected
  | "pathfinding:clear"           // Selection cleared
  | "pathfinding:cancel";         // Mode deactivated

interface PathFindingEvent {
  type: PathFindingEventType;
  state?: PathFindingState;
  result?: PathFindingResult;
  path?: Path;
  error?: string;
}
```

### State Access

```typescript
const state = manager.getState();

console.log(state.isActive);        // Path finding mode active
console.log(state.sourceNode);      // Selected source node
console.log(state.targetNode);      // Selected target node
console.log(state.selectionStep);   // "source" | "target" | "complete"
console.log(state.isSearching);     // Search in progress
console.log(state.result);          // Last search result
console.log(state.currentPathIndex);// Current path index
```

## Visualization

### Path Highlighting

```typescript
const manager = createPathFindingManager({
  visualizationStyle: {
    edgeColor: "#22c55e",     // Green path edges
    nodeColor: "#22c55e",     // Green path nodes
    edgeWidth: 4,             // Thicker path edges
    nodeBorderWidth: 4,       // Thicker node borders
    animated: true,           // Enable animation
    animationDuration: 1500,  // Animation cycle
    animationType: "flow",    // "flow" | "pulse" | "dash"
    dimOpacity: 0.2,          // Dim non-path elements
    glowEnabled: true,        // Glow effect
    glowColor: "#22c55e",
    glowBlur: 6,
  },
});

// Use for rendering
const style = manager.getVisualizationStyle();
const highlightedNodes = manager.getHighlightedNodeIds();
const highlightedEdges = manager.getHighlightedEdgeIds();
```

### Integration with Renderer

```typescript
// Render loop
function render() {
  for (const node of nodes) {
    const isOnPath = manager.isNodeOnPath(node.id);
    const isSource = manager.isSourceNode(node.id);
    const isTarget = manager.isTargetNode(node.id);

    if (isSource) {
      renderNode(node, { color: "#3b82f6", glow: true }); // Blue source
    } else if (isTarget) {
      renderNode(node, { color: "#ef4444", glow: true }); // Red target
    } else if (isOnPath) {
      renderNode(node, { color: style.nodeColor, glow: style.glowEnabled });
    } else {
      renderNode(node, { opacity: path ? style.dimOpacity : 1 });
    }
  }

  for (const edge of edges) {
    const isOnPath = manager.isEdgeOnPath(edge.id);
    if (isOnPath) {
      renderEdge(edge, {
        color: style.edgeColor,
        width: style.edgeWidth,
        animated: style.animated,
      });
    } else {
      renderEdge(edge, { opacity: path ? style.dimOpacity : 1 });
    }
  }
}
```

## Performance Tips

### Large Graphs

```typescript
// Use bidirectional for large graphs
const pathFinder = createPathFinder({
  algorithm: "bidirectional",
  maxLength: 5,           // Limit depth
  timeoutMs: 3000,        // Prevent long searches
});

// Check for timeout
const result = pathFinder.findPath("A", "Z");
if (result.timedOut) {
  console.log("Search timed out after", result.searchTimeMs, "ms");
  console.log("Nodes visited:", result.nodesVisited);
}
```

### Caching

```typescript
// Cache PathFinder instance
class PathCache {
  private pathFinder: PathFinder;
  private cache = new Map<string, PathFindingResult>();

  findPath(source: string, target: string): PathFindingResult {
    const key = `${source}-${target}`;

    if (!this.cache.has(key)) {
      this.cache.set(key, this.pathFinder.findPath(source, target));
    }

    return this.cache.get(key)!;
  }

  invalidate() {
    this.cache.clear();
  }
}
```

## Error Handling

```typescript
const result = pathFinder.findPath("A", "B");

if (!result.found) {
  if (result.error === "Source node not found") {
    console.error("Source node does not exist");
  } else if (result.error === "Target node not found") {
    console.error("Target node does not exist");
  } else if (result.timedOut) {
    console.error("Search timed out");
  } else {
    console.log("No path exists between nodes");
  }
}
```

## Complete Example

```typescript
import {
  createPathFindingManager,
  PathFindingEventType,
} from "./presentation/renderers/graph";

// Setup
const manager = createPathFindingManager({
  pathFindingOptions: {
    algorithm: "bidirectional",
    maxLength: 8,
    direction: "both",
    timeoutMs: 3000,
  },
  visualizationStyle: {
    edgeColor: "#22c55e",
    animated: true,
    dimOpacity: 0.15,
  },
});

// Load graph
manager.setGraph(graphNodes, graphEdges);

// Event handling
manager.addEventListener((event) => {
  switch (event.type) {
    case "pathfinding:start":
      showStatus("Click source node");
      break;

    case "pathfinding:source-selected":
      showStatus("Click target node");
      highlightNode(event.state?.sourceNode?.id, "source");
      break;

    case "pathfinding:target-selected":
      showStatus("Searching...");
      highlightNode(event.state?.targetNode?.id, "target");
      break;

    case "pathfinding:found":
      const path = event.path!;
      showStatus(`Path found: ${path.length} edges`);
      renderPath(path);
      break;

    case "pathfinding:not-found":
      showStatus("No path found");
      break;

    case "pathfinding:error":
      showError(event.error ?? "Unknown error");
      break;

    case "pathfinding:clear":
      clearHighlights();
      showStatus("Selection cleared");
      break;

    case "pathfinding:cancel":
      clearHighlights();
      hideStatus();
      break;
  }
});

// UI controls
document.getElementById("start-pathfinding")?.addEventListener("click", () => {
  manager.start();
});

document.getElementById("clear-path")?.addEventListener("click", () => {
  manager.clear();
});

document.getElementById("next-path")?.addEventListener("click", () => {
  manager.nextPath();
});

// Node click handler
function onNodeClick(nodeId: string) {
  if (manager.getState().isActive) {
    manager.handleNodeClick(nodeId);
  }
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    manager.cancel();
  }
  if (e.key === "ArrowRight" && manager.getCurrentPath()) {
    manager.nextPath();
  }
  if (e.key === "ArrowLeft" && manager.getCurrentPath()) {
    manager.previousPath();
  }
});
```

## See Also

- [Interactions Guide](./interactions.md) - Selection and navigation
- [Layouts Guide](./layouts.md) - Graph layout algorithms
- [Performance Guide](./performance.md) - Optimization techniques
- [Events API](../api/events.md) - Event reference
