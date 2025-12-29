# API Overview

The Graph View module exports a comprehensive set of components, algorithms, and utilities for building high-performance graph visualizations.

## Module Structure

```
@exocortex/obsidian-plugin
├── Core Components
│   ├── GraphLayoutRenderer      # React component wrapper
│   ├── PixiGraphRenderer        # WebGL2 renderer
│   ├── ForceSimulation          # Physics engine
│   └── LayoutManager            # Layout orchestration
│
├── Renderers
│   ├── NodeRenderer             # Node visualization
│   ├── EdgeRenderer             # Edge visualization
│   ├── LabelRenderer            # Text labels
│   ├── BatchedNodeRenderer      # Instanced drawing
│   └── IncrementalRenderer      # Efficient updates
│
├── Layout Algorithms
│   ├── ForceSimulation          # Force-directed
│   ├── HierarchicalLayout       # Tree/DAG
│   ├── RadialLayout             # Circular
│   ├── TemporalLayout           # Timeline
│   ├── CommunityDetection       # Louvain clustering
│   └── LayoutPluginRegistry     # Custom layouts
│
├── Interaction Managers
│   ├── SelectionManager         # Node/edge selection
│   ├── HoverManager             # Hover states
│   ├── ViewportController       # Pan/zoom
│   ├── KeyboardManager          # Keyboard navigation
│   ├── NavigationManager        # Spatial navigation
│   ├── ContextMenuManager       # Right-click menus
│   └── FocusIndicator           # Focus visualization
│
├── Performance Systems
│   ├── LODSystem                # Level of detail
│   ├── VisibilityCuller         # Viewport culling
│   ├── GPUMemoryManager         # Resource management
│   ├── PerformanceProfiler      # Metrics tracking
│   ├── AutoOptimizer            # Automatic tuning
│   └── ObjectPool               # Memory pooling
│
├── Data Sources
│   ├── ClusterQueryExecutor     # SPARQL queries
│   ├── GraphTooltipDataProvider # Triple store access
│   └── FilterManager            # Semantic filtering
│
├── Advanced Features
│   ├── WebGPUPhysics            # GPU-accelerated physics
│   ├── Scene3DManager           # 3D visualization
│   ├── EdgeBundler              # Edge bundling
│   ├── AnimationSystem          # Smooth transitions
│   ├── ExportManager            # Image export
│   ├── PathFindingManager       # Path discovery
│   ├── InferenceManager         # Ontology reasoning
│   └── AccessibilityManager     # WCAG compliance
│
└── Utilities
    ├── buildGraphData           # Data conversion
    ├── extractLabelFromWikilink # Label extraction
    ├── Quadtree                 # Spatial indexing
    └── Easing functions         # Animation curves
```

## Import Patterns

### Component Imports

```typescript
import {
  GraphLayoutRenderer,
  PixiGraphRenderer,
  NodeRenderer,
  EdgeRenderer,
  LabelRenderer,
} from "./presentation/renderers/graph";
```

### Type Imports

```typescript
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  GraphLayoutOptions,
  SimulationNode,
  SimulationLink,
  NodeVisualStyle,
  EdgeVisualStyle,
} from "./presentation/renderers/graph";
```

### Force System Imports

```typescript
import {
  ForceSimulation,
  forceCenter,
  forceLink,
  forceManyBody,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
  FORCE_PRESETS,
} from "./presentation/renderers/graph";
```

### Layout Algorithm Imports

```typescript
import {
  HierarchicalLayout,
  RadialLayout,
  TemporalLayout,
  LayoutManager,
  detectCommunities,
  CommunityLayout,
} from "./presentation/renderers/graph";
```

### Interaction Manager Imports

```typescript
import {
  SelectionManager,
  HoverManager,
  ViewportController,
  KeyboardManager,
  NavigationManager,
  ContextMenuManager,
} from "./presentation/renderers/graph";
```

## Key Concepts

### Nodes and Edges

Nodes represent entities in the graph (files, concepts, etc.):

```typescript
interface GraphNode {
  id: string;                    // Unique identifier
  label: string;                 // Display label
  path: string;                  // File path
  metadata?: Record<string, unknown>;  // Additional data
  group?: string;                // Category for coloring
  x?: number;                    // Position (set by simulation)
  y?: number;
}

interface GraphEdge {
  id: string;                    // Unique identifier
  source: string | GraphNode;    // Source node ID or object
  target: string | GraphNode;    // Target node ID or object
  label?: string;                // Edge label
  property?: string;             // RDF predicate
  weight?: number;               // Edge weight
}
```

### Simulation Nodes

During physics simulation, nodes have additional properties:

```typescript
interface SimulationNode extends GraphNode {
  index: number;     // Node index
  vx: number;        // X velocity
  vy: number;        // Y velocity
  fx?: number;       // Fixed X position (for pinning)
  fy?: number;       // Fixed Y position (for pinning)
  mass: number;      // Node mass
  radius: number;    // Collision radius
}
```

### Forces

Forces modify node positions during simulation:

```typescript
interface Force<N extends SimulationNode = SimulationNode> {
  (alpha: number): void;  // Apply force for one tick
  initialize?(nodes: N[], random: () => number): void;  // Setup
}
```

### Events

All managers emit events for state changes:

```typescript
// Selection events
selectionManager.on("select", (event: SelectionEvent) => {
  console.log("Selected:", event.nodeIds);
});

// Viewport events
viewportController.on("change", (event: ViewportEvent) => {
  console.log("Viewport:", event.x, event.y, event.scale);
});

// Simulation events
simulation.on("tick", () => render());
simulation.on("end", () => console.log("Simulation complete"));
```

## Component Lifecycle

### Initialization

```typescript
// 1. Create renderer
const renderer = new PixiGraphRenderer(container, options);

// 2. Create sub-renderers
const nodeRenderer = new NodeRenderer(renderer.app);
const edgeRenderer = new EdgeRenderer(renderer.app);

// 3. Create managers
const selectionManager = new SelectionManager(config);
const viewportController = new ViewportController(container, config);

// 4. Create simulation
const simulation = new ForceSimulation()
  .nodes(nodes)
  .force("center", forceCenter(width / 2, height / 2));

// 5. Connect managers
selectionManager.on("select", updateNodeStyles);
viewportController.on("change", updateViewport);

// 6. Start
simulation.start();
```

### Cleanup

```typescript
// Stop simulation
simulation.stop();

// Dispose renderers
nodeRenderer.dispose();
edgeRenderer.dispose();
labelRenderer.dispose();

// Destroy managers
selectionManager.destroy();
viewportController.destroy();

// Destroy renderer
renderer.destroy();
```

## API Reference Pages

### Core Components
- [GraphLayoutRenderer](./graph-view.md) - Main React component
- [ForceSimulation](./physics-engine.md) - Physics simulation
- [LayoutManager](./layout-engine.md) - Layout algorithms
- [PixiGraphRenderer](./renderer.md) - WebGL2 rendering

### Export
- [ExportManager](./export-manager.md) - Image export (PNG, JPEG, WebP, SVG)

### Event System
- [Events](./events.md) - Event types and handlers

## See Also

- [Getting Started](../getting-started/installation.md) - Quick start guide
- [Configuration](../getting-started/configuration.md) - Configuration reference
- [Examples](../examples/basic-graph.md) - Code examples
