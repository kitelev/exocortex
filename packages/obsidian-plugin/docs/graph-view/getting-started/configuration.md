# Configuration Reference

Complete reference for all Graph View configuration options.

## GraphLayoutOptions

The main configuration object for `GraphLayoutRenderer`:

```typescript
interface GraphLayoutOptions {
  // Dimensions
  width?: string | number;      // Container width (default: "100%")
  height?: string | number;     // Container height (default: 400)

  // Node appearance
  nodeRadius?: number;          // Base node radius (default: 8)
  nodeColor?: string | ((node: GraphNode) => string);  // Node fill color

  // Edge appearance
  edgeColor?: string | ((edge: GraphEdge) => string);  // Edge stroke color
  showEdgeLabels?: boolean;     // Display edge labels (default: false)

  // Labels
  showLabels?: boolean;         // Display node labels (default: true)

  // Physics simulation
  chargeStrength?: number;      // Repulsion force (default: -300)
  linkDistance?: number;        // Link distance (default: 100)

  // Viewport
  zoomable?: boolean;           // Enable zoom (default: true)
  minZoom?: number;             // Minimum zoom level (default: 0.1)
  maxZoom?: number;             // Maximum zoom level (default: 4)
  draggable?: boolean;          // Enable node dragging (default: true)
  initialZoom?: { x: number; y: number; k: number };

  // Performance
  useBarnesHut?: boolean;       // Use Barnes-Hut algorithm (default: true for >100 nodes)
  barnesHutTheta?: number;      // BH approximation (default: 0.9)
  distanceMin?: number;         // Minimum force distance (default: 1)
  distanceMax?: number;         // Maximum force distance (default: Infinity)
}
```

## Force Configuration

### ForceSimulationConfig

```typescript
interface ForceSimulationConfig {
  alpha?: number;          // Initial alpha (default: 1)
  alphaMin?: number;       // Stop threshold (default: 0.001)
  alphaDecay?: number;     // Cooling rate (default: 0.0228)
  alphaTarget?: number;    // Target alpha (default: 0)
  velocityDecay?: number;  // Velocity damping (default: 0.4)
  randomSource?: () => number;  // RNG for reproducibility
}
```

### Force Presets

```typescript
import { FORCE_PRESETS } from "@exocortex/obsidian-plugin";

// Available presets
const presets = {
  default: { ... },      // Balanced for general use
  clustered: { ... },    // Tight clusters, visible communities
  sparse: { ... },       // Spread out, minimal overlap
  hierarchical: { ... }, // Vertical/horizontal emphasis
  radial: { ... },       // Circular arrangement
};

// Using a preset
const simulation = new ForceSimulation()
  .configure(FORCE_PRESETS.clustered);
```

### CenterForceParams

```typescript
interface CenterForceParams {
  enabled: boolean;     // Enable/disable (default: true)
  strength: number;     // 0-1, centering strength (default: 0.1)
  x: number;            // Center X coordinate
  y: number;            // Center Y coordinate
}
```

### ChargeForceParams

```typescript
interface ChargeForceParams {
  enabled: boolean;     // Enable/disable (default: true)
  strength: number;     // Negative for repulsion (default: -300)
  distanceMin: number;  // Min distance (default: 1)
  distanceMax: number;  // Max distance (default: Infinity)
  theta: number;        // Barnes-Hut theta (default: 0.9)
}
```

### LinkForceParams

```typescript
interface LinkForceParams {
  enabled: boolean;     // Enable/disable (default: true)
  distance: number;     // Target distance (default: 100)
  strength: number;     // Link stiffness (default: 1)
  iterations: number;   // Constraint iterations (default: 1)
}
```

### CollisionForceParams

```typescript
interface CollisionForceParams {
  enabled: boolean;     // Enable/disable (default: false)
  radius: number;       // Collision radius (default: nodeRadius + 2)
  strength: number;     // Collision strength (default: 0.7)
  iterations: number;   // Collision iterations (default: 1)
}
```

## Layout Algorithms

### HierarchicalLayoutOptions

```typescript
interface HierarchicalLayoutOptions {
  direction: "TB" | "BT" | "LR" | "RL";  // Layout direction
  layerSpacing: number;      // Vertical spacing (default: 100)
  nodeSpacing: number;       // Horizontal spacing (default: 50)
  rankingAlgorithm: "longest-path" | "tight-tree" | "network-simplex";
  crossingMinimization: "barycenter" | "median" | "none";
  coordinateAssignment: "barycenter" | "priority" | "fast";
  alignLeaves: boolean;      // Align leaf nodes (default: true)
  groupClusters: boolean;    // Group by cluster (default: false)
}

// Presets
const HIERARCHICAL_PRESETS = {
  topDown: { direction: "TB", layerSpacing: 100 },
  leftRight: { direction: "LR", layerSpacing: 150 },
  compact: { direction: "TB", layerSpacing: 60, nodeSpacing: 30 },
  wide: { direction: "TB", layerSpacing: 120, nodeSpacing: 80 },
};
```

### RadialLayoutOptions

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
  startAngle: number;        // Starting angle in radians (default: 0)
  endAngle: number;          // Ending angle in radians (default: 2π)
}

// Presets
const RADIAL_PRESETS = {
  balanced: { subtreeAngle: "weighted", ringSpacing: 80 },
  compact: { maxRadius: 300, ringSpacing: 50 },
  semicircle: { startAngle: -Math.PI / 2, endAngle: Math.PI / 2 },
};
```

### TemporalLayoutOptions

```typescript
interface TemporalLayoutOptions {
  orientation: "horizontal" | "vertical";
  timeField: string;         // Property name for timestamps
  timeScale: "linear" | "log" | "ordinal";
  laneStrategy: "type" | "cluster" | "single" | "custom";
  gapStrategy: "fixed" | "proportional" | "none";
  minGap: number;            // Minimum gap between items (default: 20)
  nodeAlignment: "start" | "center" | "end";
  showTimeline: boolean;     // Display timeline axis (default: true)
  timeFormat: string;        // Date format string
  laneSpacing: number;       // Space between lanes (default: 60)
}

// Presets
const TEMPORAL_PRESETS = {
  timeline: { orientation: "horizontal", showTimeline: true },
  swimlane: { orientation: "horizontal", laneStrategy: "type" },
  vertical: { orientation: "vertical", showTimeline: true },
};
```

## Renderer Configuration

### PixiGraphRendererOptions

```typescript
interface PixiGraphRendererOptions {
  width: number;
  height: number;
  backgroundColor: number;   // Hex color (default: 0x1a1a2e)
  antialias: boolean;        // Smooth edges (default: true)
  resolution: number;        // Device pixel ratio (default: window.devicePixelRatio)
  autoDensity: boolean;      // Auto-adjust for HiDPI (default: true)
  powerPreference: "default" | "high-performance" | "low-power";
  preserveDrawingBuffer: boolean;  // Required for export (default: false)
}
```

### NodeRenderer Configuration

```typescript
interface NodeVisualStyle {
  fill: number;              // Fill color (hex)
  stroke: number;            // Stroke color (hex)
  strokeWidth: number;       // Stroke width (default: 2)
  alpha: number;             // Opacity 0-1 (default: 1)
}

interface NodeTypeConfig {
  shape: "circle" | "square" | "diamond" | "triangle" | "hexagon" | "star";
  baseRadius: number;        // Base size (default: 8)
  scalingMode: "linear" | "sqrt" | "log" | "none";
  minRadius: number;         // Minimum size (default: 4)
  maxRadius: number;         // Maximum size (default: 40)
  style: NodeVisualStyle;
}

// Default configs by ontology class
const DEFAULT_NODE_TYPE_CONFIGS: Record<string, NodeTypeConfig> = {
  "ems__Area": { shape: "hexagon", baseRadius: 16, style: { fill: 0x22c55e } },
  "ems__Project": { shape: "diamond", baseRadius: 12, style: { fill: 0x6366f1 } },
  "ems__Task": { shape: "circle", baseRadius: 8, style: { fill: 0xf59e0b } },
  "default": { shape: "circle", baseRadius: 8, style: { fill: 0x64748b } },
};
```

### EdgeRenderer Configuration

```typescript
interface EdgeVisualStyle {
  color: number;             // Stroke color (hex)
  width: number;             // Line width (default: 2)
  alpha: number;             // Opacity 0-1 (default: 0.6)
  dashPattern?: number[];    // Dash pattern [dash, gap]
}

interface EdgeTypeConfig {
  curveType: "straight" | "quadratic" | "cubic" | "arc";
  curvature: number;         // Curve amount 0-1 (default: 0.2)
  arrowType: "none" | "triangle" | "stealth" | "diamond";
  arrowPosition: "end" | "start" | "both";
  arrowSize: number;         // Arrow size (default: 8)
  style: EdgeVisualStyle;
}

// Default configs by predicate
const DEFAULT_EDGE_TYPE_CONFIGS: Record<string, EdgeTypeConfig> = {
  "exo:belongsTo": { curveType: "straight", arrowType: "triangle", style: { color: 0x4a4a6a } },
  "exo:dependsOn": { curveType: "quadratic", arrowType: "stealth", style: { color: 0xef4444, dashPattern: [5, 3] } },
  "default": { curveType: "quadratic", arrowType: "triangle", style: { color: 0x4a4a6a } },
};
```

### LabelRenderer Configuration

```typescript
interface LabelVisualStyle {
  fontFamily: string;        // Font family (default: "Inter, sans-serif")
  fontSize: number;          // Font size (default: 12)
  fill: number;              // Text color (hex)
  fontWeight: "normal" | "bold";
  align: "left" | "center" | "right";
  alpha: number;             // Opacity 0-1 (default: 1)
  maxWidth: number;          // Truncation width (default: 100)
}

interface LabelAnchor {
  position: "top" | "bottom" | "left" | "right" | "center";
  offset: { x: number; y: number };
}

const DEFAULT_LABEL_STYLE: LabelVisualStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 12,
  fill: 0xffffff,
  fontWeight: "normal",
  align: "center",
  alpha: 1,
  maxWidth: 120,
};
```

## Interaction Configuration

### SelectionManagerConfig

```typescript
interface SelectionManagerConfig {
  multiSelect: boolean;      // Allow multi-select with Ctrl/Cmd (default: true)
  boxSelect: boolean;        // Allow box selection (default: true)
  boxSelectKey: "shift" | "alt" | "ctrl" | "none";  // Modifier key (default: "shift")
  clearOnBackground: boolean;  // Clear selection on background click (default: true)
  highlightStyle: {
    nodeStroke: number;      // Highlight stroke color
    nodeStrokeWidth: number; // Highlight stroke width
    edgeColor: number;       // Highlight edge color
  };
}
```

### HoverManagerConfig

```typescript
interface HoverManagerConfig {
  hoverDelay: number;        // Delay before hover triggers (default: 200)
  leaveDelay: number;        // Delay before hover ends (default: 100)
  tooltipOffset: { x: number; y: number };  // Tooltip position offset
  showNeighborHighlight: boolean;  // Highlight connected nodes (default: true)
}
```

### ViewportControllerConfig

```typescript
interface ViewportControllerConfig {
  pannable: boolean;         // Enable panning (default: true)
  zoomable: boolean;         // Enable zooming (default: true)
  minZoom: number;           // Minimum zoom (default: 0.1)
  maxZoom: number;           // Maximum zoom (default: 4)
  zoomSpeed: number;         // Zoom sensitivity (default: 1)
  panSpeed: number;          // Pan sensitivity (default: 1)
  wheelZoom: boolean;        // Zoom with scroll wheel (default: true)
  pinchZoom: boolean;        // Zoom with pinch gesture (default: true)
  doubleTapZoom: boolean;    // Zoom on double-tap (default: true)
  boundingBox?: { minX: number; minY: number; maxX: number; maxY: number };
}
```

### KeyboardManagerConfig

```typescript
interface KeyboardManagerConfig {
  enabled: boolean;          // Enable keyboard navigation (default: true)
  trapFocus: boolean;        // Trap focus within graph (default: false)
  keyBindings: KeyBinding[];
}

interface KeyBinding {
  key: string;               // Key code (e.g., "ArrowUp", "Enter")
  modifiers?: ("ctrl" | "alt" | "shift" | "meta")[];
  action: string;            // Action name
  context?: "node" | "edge" | "viewport" | "any";
}

// Default bindings
const DEFAULT_KEY_BINDINGS: KeyBinding[] = [
  { key: "ArrowUp", action: "navigate-up" },
  { key: "ArrowDown", action: "navigate-down" },
  { key: "ArrowLeft", action: "navigate-left" },
  { key: "ArrowRight", action: "navigate-right" },
  { key: "Enter", action: "activate", context: "node" },
  { key: "Escape", action: "clear-selection" },
  { key: "+", action: "zoom-in" },
  { key: "-", action: "zoom-out" },
  { key: "0", action: "reset-zoom" },
  { key: "f", action: "fit-to-view" },
  { key: "a", modifiers: ["ctrl"], action: "select-all" },
];
```

## Performance Configuration

### LODSystemConfig

```typescript
interface LODSystemConfig {
  enabled: boolean;          // Enable LOD (default: true)
  thresholds: LODThreshold[];
}

interface LODThreshold {
  zoomLevel: number;         // Zoom level threshold
  nodeSettings: {
    showLabels: boolean;
    showShapes: boolean;     // Use simple shapes at low zoom
    minRadius: number;       // Minimum visible size
  };
  edgeSettings: {
    showLabels: boolean;
    showArrows: boolean;
    minWidth: number;        // Minimum visible width
  };
}

const DEFAULT_LOD_THRESHOLDS: LODThreshold[] = [
  { zoomLevel: 0.1, nodeSettings: { showLabels: false, showShapes: false, minRadius: 1 } },
  { zoomLevel: 0.3, nodeSettings: { showLabels: false, showShapes: true, minRadius: 2 } },
  { zoomLevel: 0.7, nodeSettings: { showLabels: true, showShapes: true, minRadius: 4 } },
  { zoomLevel: 1.0, nodeSettings: { showLabels: true, showShapes: true, minRadius: 8 } },
];
```

### GPUMemoryManagerConfig

```typescript
interface GPUMemoryManagerConfig {
  maxMemoryMB: number;       // Maximum GPU memory (default: 256)
  gcThreshold: number;       // GC trigger threshold 0-1 (default: 0.8)
  gcInterval: number;        // GC interval in ms (default: 5000)
  resourceTTL: number;       // Resource time-to-live in ms (default: 30000)
  preferWebGPU: boolean;     // Use WebGPU when available (default: true)
}
```

### BatchedNodeRendererConfig

```typescript
interface BatchConfig {
  maxBatchSize: number;      // Max nodes per batch (default: 1000)
  sortByDepth: boolean;      // Sort by z-index (default: true)
  instancedDrawing: boolean; // Use instancing (default: true)
  geometryPoolSize: number;  // Pre-allocated geometries (default: 10)
}
```

## Next Steps

- [Layouts](../guides/layouts.md) - Layout algorithm details
- [Performance](../guides/performance.md) - Optimization strategies
- [API Reference](../api/index.md) - Complete API documentation
