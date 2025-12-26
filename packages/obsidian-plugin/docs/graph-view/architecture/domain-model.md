# Domain Model

This document describes the core entities and value objects in the Graph View domain.

## Core Entities

### GraphNode

The fundamental unit of the graph - represents a single item.

```typescript
interface GraphNode {
  // Identity
  id: string;              // Unique identifier
  path: string;            // File path (Obsidian-specific)

  // Display
  label: string;           // Display name
  group?: string;          // Category/type for styling
  color?: string;          // Override color
  size?: number;           // Size multiplier

  // Additional data
  metadata?: Record<string, unknown>;

  // Position (mutable, set by simulation)
  x?: number;
  y?: number;
}
```

**Invariants:**
- `id` must be unique within a graph
- `label` should be human-readable
- `path` should be a valid file path

### GraphEdge

Represents a relationship between two nodes.

```typescript
interface GraphEdge {
  // Identity
  id: string;              // Unique identifier

  // Connection
  source: string | GraphNode;  // Source node ID or object
  target: string | GraphNode;  // Target node ID or object

  // Metadata
  label?: string;          // Edge label
  property?: string;       // RDF predicate
  weight?: number;         // Edge weight (0-1)
  color?: string;          // Override color
}
```

**Invariants:**
- `source` and `target` must reference valid node IDs
- Self-loops (`source === target`) are allowed
- Multiple edges between same nodes are allowed

### SimulationNode

Extends GraphNode with physics properties for simulation.

```typescript
interface SimulationNode extends GraphNode {
  // Index
  index: number;           // Array index (assigned by simulation)

  // Velocity
  vx: number;              // X velocity
  vy: number;              // Y velocity

  // Fixed position (for pinning)
  fx?: number | null;      // Fixed X (null = free)
  fy?: number | null;      // Fixed Y (null = free)

  // Physics properties
  mass: number;            // Node mass (default: 1)
  radius: number;          // Collision radius
}
```

**Lifecycle:**
1. Created from GraphNode
2. Positioned by simulation
3. Pinned during drag
4. Released after drag

## Value Objects

### Position

A 2D coordinate.

```typescript
interface Position {
  x: number;
  y: number;
}
```

### Viewport

The current view transform.

```typescript
interface Viewport {
  x: number;       // Pan X offset
  y: number;       // Pan Y offset
  scale: number;   // Zoom level (1 = 100%)
}
```

### ViewportBounds

The visible area in world coordinates.

```typescript
interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}
```

### NodeVisualStyle

Visual properties for node rendering.

```typescript
interface NodeVisualStyle {
  fill: number;          // Fill color (hex)
  stroke: number;        // Stroke color (hex)
  strokeWidth: number;   // Stroke width (pixels)
  alpha: number;         // Opacity (0-1)
}
```

### EdgeVisualStyle

Visual properties for edge rendering.

```typescript
interface EdgeVisualStyle {
  color: number;         // Stroke color (hex)
  width: number;         // Line width (pixels)
  alpha: number;         // Opacity (0-1)
  dashPattern?: number[];  // Dash pattern [dash, gap]
}
```

## Aggregates

### GraphData

The complete graph data container.

```typescript
interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

### SelectionState

Current selection state.

```typescript
interface SelectionState {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  mode: "single" | "multi" | "box";
  anchorId?: string;  // For range selection
}
```

### HoverState

Current hover state.

```typescript
interface HoverState {
  targetId: string | null;
  targetType: "node" | "edge" | null;
  position: Position | null;
  enterTime: number;
}
```

## Domain Events

### SelectionEvent

Emitted when selection changes.

```typescript
interface SelectionEvent {
  type: "select" | "deselect" | "clear";
  nodeIds: string[];
  edgeIds: string[];
  mode: "single" | "multi" | "box";
  previousSelection: {
    nodeIds: string[];
    edgeIds: string[];
  };
}
```

### ViewportEvent

Emitted when viewport changes.

```typescript
interface ViewportEvent {
  type: "change" | "zoomStart" | "zoomEnd" | "panStart" | "panEnd";
  x: number;
  y: number;
  scale: number;
  changeType: "pan" | "zoom" | "both";
}
```

### NavigationEvent

Emitted when keyboard navigation occurs.

```typescript
interface NavigationEvent {
  type: "navigate" | "focus" | "blocked";
  fromNodeId: string | null;
  toNodeId: string | null;
  direction: "up" | "down" | "left" | "right" | "in" | "out";
}
```

## Entity Relationships

```
┌──────────────┐         ┌──────────────┐
│  GraphNode   │◄───────▶│  GraphEdge   │
│              │  source │              │
│  id          │  target │  id          │
│  label       │         │  source      │
│  path        │         │  target      │
│  group       │         │  property    │
│  metadata    │         │  weight      │
└──────────────┘         └──────────────┘
       │
       ▼ extends
┌──────────────┐
│SimulationNode│
│              │
│  index       │
│  vx, vy      │
│  fx, fy      │
│  mass        │
│  radius      │
└──────────────┘
```

## Type Mappings

### Ontology to Domain

```typescript
// EMS Ontology classes map to node groups
const ontologyMapping: Record<string, string> = {
  "ems__Area": "area",
  "ems__Project": "project",
  "ems__Task": "task",
  "ems__Resource": "resource",
  "exo__Concept": "concept",
};

// RDF predicates map to edge properties
const predicateMapping: Record<string, string> = {
  "ems:belongsTo": "parent",
  "ems:hasTask": "child",
  "ems:dependsOn": "dependency",
  "exo:references": "reference",
};
```

### UI State to Domain

```typescript
// Selection mode
type SelectionMode = "single" | "multi" | "box";

// Navigation direction
type NavigationDirection = "up" | "down" | "left" | "right" | "in" | "out";

// Layout algorithm
type LayoutAlgorithm = "force" | "hierarchical" | "radial" | "temporal";
```

## Validation

### Node Validation

```typescript
function validateNode(node: GraphNode): ValidationResult {
  const errors: string[] = [];

  if (!node.id) {
    errors.push("Node must have an id");
  }

  if (!node.label) {
    errors.push("Node must have a label");
  }

  if (node.size !== undefined && node.size < 0) {
    errors.push("Node size must be non-negative");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

### Edge Validation

```typescript
function validateEdge(edge: GraphEdge, nodeIds: Set<string>): ValidationResult {
  const errors: string[] = [];

  if (!edge.id) {
    errors.push("Edge must have an id");
  }

  const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
  const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

  if (!nodeIds.has(sourceId)) {
    errors.push(`Edge source "${sourceId}" not found in nodes`);
  }

  if (!nodeIds.has(targetId)) {
    errors.push(`Edge target "${targetId}" not found in nodes`);
  }

  if (edge.weight !== undefined && (edge.weight < 0 || edge.weight > 1)) {
    errors.push("Edge weight must be between 0 and 1");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

## See Also

- [Data Flow](./data-flow.md) - State management
- [Extension Points](./extension-points.md) - Customization
- [API Reference](../api/index.md) - TypeScript interfaces
