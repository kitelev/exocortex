# Styling Guide

This guide covers visual customization of nodes, edges, and labels.

## Node Styling

### Basic Node Styles

```typescript
import { NodeRenderer, DEFAULT_NODE_STYLE } from "@exocortex/obsidian-plugin";
import type { NodeVisualStyle } from "@exocortex/obsidian-plugin";

const nodeStyle: NodeVisualStyle = {
  fill: 0x6366f1,        // Indigo fill
  stroke: 0xffffff,      // White border
  strokeWidth: 2,        // Border width
  alpha: 1,              // Full opacity
};

nodeRenderer.renderNode({
  id: "node-1",
  x: 100,
  y: 100,
  radius: 12,
  style: nodeStyle,
});
```

### Node Shapes

```typescript
import { SHAPE_DRAWERS } from "@exocortex/obsidian-plugin";
import type { NodeShape } from "@exocortex/obsidian-plugin";

// Available shapes
const shapes: NodeShape[] = [
  "circle",    // Default round shape
  "square",    // Rectangle
  "diamond",   // Rotated square
  "triangle",  // Pointing up
  "hexagon",   // Six-sided
  "star",      // Five-pointed
];

nodeRenderer.renderNode({
  id: "node-1",
  x: 100,
  y: 100,
  radius: 12,
  shape: "hexagon",
  style: { fill: 0x22c55e },
});
```

### Dynamic Node Colors

Color nodes based on properties:

```typescript
function getNodeColor(node: GraphNode): number {
  // By group
  switch (node.group) {
    case "project": return 0x6366f1;  // Indigo
    case "area": return 0x22c55e;     // Green
    case "task": return 0xf59e0b;     // Amber
    case "resource": return 0xec4899; // Pink
    default: return 0x64748b;         // Slate
  }
}

// By status
function getStatusColor(status: string): number {
  const colors: Record<string, number> = {
    "active": 0x22c55e,
    "pending": 0xf59e0b,
    "completed": 0x64748b,
    "blocked": 0xef4444,
  };
  return colors[status] || 0x64748b;
}

// By connection count
function getConnectionColor(count: number): number {
  if (count > 10) return 0xef4444;  // Red (hub)
  if (count > 5) return 0xf59e0b;   // Amber
  if (count > 2) return 0x22c55e;   // Green
  return 0x64748b;                   // Slate
}
```

### Node Size Scaling

```typescript
import { calculateNodeRadius } from "@exocortex/obsidian-plugin";
import type { RadiusScalingMode } from "@exocortex/obsidian-plugin";

// Scale by connection count
const radius = calculateNodeRadius({
  value: connectionCount,
  baseRadius: 8,
  scalingMode: "sqrt",  // linear, sqrt, log, none
  minRadius: 4,
  maxRadius: 40,
});

// Manual scaling
function scaleRadius(value: number, mode: RadiusScalingMode): number {
  const baseRadius = 8;
  const scale = 2;

  switch (mode) {
    case "linear": return baseRadius + value * scale;
    case "sqrt": return baseRadius + Math.sqrt(value) * scale;
    case "log": return baseRadius + Math.log(value + 1) * scale;
    default: return baseRadius;
  }
}
```

## Edge Styling

### Basic Edge Styles

```typescript
import { EdgeRenderer, DEFAULT_EDGE_STYLE } from "@exocortex/obsidian-plugin";
import type { EdgeVisualStyle } from "@exocortex/obsidian-plugin";

const edgeStyle: EdgeVisualStyle = {
  color: 0x4a4a6a,       // Gray-blue
  width: 2,              // Line width
  alpha: 0.6,            // Semi-transparent
  dashPattern: null,     // Solid line (or [5, 3] for dashed)
};

edgeRenderer.renderEdge({
  id: "edge-1",
  source: { x: 100, y: 100 },
  target: { x: 300, y: 200 },
  style: edgeStyle,
});
```

### Curve Types

```typescript
import type { CurveType } from "@exocortex/obsidian-plugin";

// Straight line
edgeRenderer.renderEdge({
  ...edge,
  curveType: "straight",
});

// Quadratic Bezier (single control point)
edgeRenderer.renderEdge({
  ...edge,
  curveType: "quadratic",
  curvature: 0.2,  // 0 = straight, 1 = very curved
});

// Cubic Bezier (smooth S-curves)
edgeRenderer.renderEdge({
  ...edge,
  curveType: "cubic",
  curvature: 0.3,
});

// Arc (circular path)
edgeRenderer.renderEdge({
  ...edge,
  curveType: "arc",
  curvature: 0.5,
});
```

### Arrow Styles

```typescript
import type { ArrowType, ArrowPosition } from "@exocortex/obsidian-plugin";

edgeRenderer.renderEdge({
  ...edge,
  arrowType: "triangle",  // none, triangle, stealth, diamond
  arrowPosition: "end",   // start, end, both
  arrowSize: 8,
});

// Arrow types
// "triangle" - Simple filled triangle
// "stealth" - Pointed arrowhead (like →)
// "diamond" - Diamond shape
// "none" - No arrow
```

### Dynamic Edge Colors

```typescript
function getEdgeColor(edge: GraphEdge): number {
  // By predicate type
  switch (edge.property) {
    case "dependsOn": return 0xef4444;    // Red
    case "belongsTo": return 0x22c55e;    // Green
    case "references": return 0x6366f1;   // Indigo
    default: return 0x4a4a6a;             // Default gray
  }
}

// By weight
function getWeightColor(weight: number): number {
  if (weight > 0.8) return 0xef4444;
  if (weight > 0.5) return 0xf59e0b;
  if (weight > 0.2) return 0x22c55e;
  return 0x64748b;
}
```

### Dashed Lines

```typescript
// Dashed line for optional relationships
edgeRenderer.renderEdge({
  ...edge,
  style: {
    ...edgeStyle,
    dashPattern: [5, 3],  // 5px dash, 3px gap
  },
});

// Dotted line
{ dashPattern: [2, 2] }

// Long dash
{ dashPattern: [10, 5] }

// Dash-dot pattern
{ dashPattern: [10, 3, 2, 3] }
```

## Label Styling

### Basic Label Styles

```typescript
import { LabelRenderer, DEFAULT_LABEL_STYLE } from "@exocortex/obsidian-plugin";
import type { LabelVisualStyle } from "@exocortex/obsidian-plugin";

const labelStyle: LabelVisualStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 12,
  fill: 0xffffff,        // White text
  fontWeight: "normal",  // normal, bold
  align: "center",       // left, center, right
  alpha: 1,
  maxWidth: 120,         // Truncate if wider
};

labelRenderer.renderLabel({
  id: "label-1",
  text: "Node Label",
  x: 100,
  y: 120,
  style: labelStyle,
});
```

### Label Positioning

```typescript
import { calculateOptimalLabelPosition } from "@exocortex/obsidian-plugin";
import type { LabelAnchor } from "@exocortex/obsidian-plugin";

// Predefined positions
const positions: LabelAnchor[] = [
  { position: "bottom", offset: { x: 0, y: 8 } },   // Below node
  { position: "top", offset: { x: 0, y: -8 } },     // Above node
  { position: "right", offset: { x: 8, y: 0 } },    // Right of node
  { position: "left", offset: { x: -8, y: 0 } },    // Left of node
  { position: "center", offset: { x: 0, y: 0 } },   // On node
];

// Automatic optimal positioning
const position = calculateOptimalLabelPosition(
  node,
  neighboringNodes,
  labelWidth,
  labelHeight,
  nodeRadius
);
```

### Truncation

```typescript
// Truncate long labels
labelRenderer.renderLabel({
  id: "label-1",
  text: "This is a very long label that needs truncation",
  style: {
    ...labelStyle,
    maxWidth: 80,  // Will show "This is a very lo..."
  },
});

// Custom truncation
function truncateLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + "…";
}
```

## Theme Integration

### Obsidian Theme Colors

```typescript
function getThemeColors(): { [key: string]: number } {
  const root = document.documentElement;
  const style = getComputedStyle(root);

  return {
    background: cssToHex(style.getPropertyValue("--background-primary")),
    text: cssToHex(style.getPropertyValue("--text-normal")),
    accent: cssToHex(style.getPropertyValue("--interactive-accent")),
    muted: cssToHex(style.getPropertyValue("--text-muted")),
    border: cssToHex(style.getPropertyValue("--background-modifier-border")),
  };
}

function cssToHex(cssColor: string): number {
  const rgb = cssColor.match(/\d+/g);
  if (!rgb || rgb.length < 3) return 0x000000;
  return (parseInt(rgb[0]) << 16) | (parseInt(rgb[1]) << 8) | parseInt(rgb[2]);
}
```

### Dark/Light Mode

```typescript
interface ThemeConfig {
  background: number;
  nodeDefault: number;
  edgeDefault: number;
  labelColor: number;
  selectionColor: number;
}

const THEMES: Record<string, ThemeConfig> = {
  dark: {
    background: 0x1a1a2e,
    nodeDefault: 0x64748b,
    edgeDefault: 0x4a4a6a,
    labelColor: 0xffffff,
    selectionColor: 0x6366f1,
  },
  light: {
    background: 0xffffff,
    nodeDefault: 0x475569,
    edgeDefault: 0xd1d5db,
    labelColor: 0x1f2937,
    selectionColor: 0x6366f1,
  },
};

function applyTheme(theme: "dark" | "light"): void {
  const config = THEMES[theme];
  renderer.setBackgroundColor(config.background);
  // Update default styles...
}
```

## Type-Based Styling

Style by ontology class:

```typescript
import { DEFAULT_NODE_TYPE_CONFIGS } from "@exocortex/obsidian-plugin";
import type { NodeTypeConfig, OntologyClass } from "@exocortex/obsidian-plugin";

const nodeTypeConfigs: Record<OntologyClass, NodeTypeConfig> = {
  "ems__Area": {
    shape: "hexagon",
    baseRadius: 16,
    scalingMode: "sqrt",
    style: { fill: 0x22c55e, stroke: 0xffffff, strokeWidth: 2, alpha: 1 },
  },
  "ems__Project": {
    shape: "diamond",
    baseRadius: 12,
    scalingMode: "sqrt",
    style: { fill: 0x6366f1, stroke: 0xffffff, strokeWidth: 2, alpha: 1 },
  },
  "ems__Task": {
    shape: "circle",
    baseRadius: 8,
    scalingMode: "linear",
    style: { fill: 0xf59e0b, stroke: 0xffffff, strokeWidth: 1, alpha: 1 },
  },
  "default": {
    shape: "circle",
    baseRadius: 8,
    scalingMode: "none",
    style: { fill: 0x64748b, stroke: 0xffffff, strokeWidth: 1, alpha: 1 },
  },
};

function getNodeConfig(node: GraphNode): NodeTypeConfig {
  const type = node.metadata?.type as OntologyClass;
  return nodeTypeConfigs[type] || nodeTypeConfigs.default;
}
```

## Selection and Hover States

```typescript
interface NodeRenderState {
  isSelected: boolean;
  isHovered: boolean;
  isConnected: boolean;  // Connected to selected/hovered
  isFaded: boolean;      // Not connected
}

function getNodeStyle(node: GraphNode, state: NodeRenderState): NodeVisualStyle {
  const baseStyle = getNodeConfig(node).style;

  if (state.isSelected) {
    return {
      ...baseStyle,
      stroke: 0x6366f1,
      strokeWidth: 4,
    };
  }

  if (state.isHovered) {
    return {
      ...baseStyle,
      stroke: 0xffffff,
      strokeWidth: 3,
    };
  }

  if (state.isFaded) {
    return {
      ...baseStyle,
      alpha: 0.3,
    };
  }

  return baseStyle;
}
```

## Export Styling

Prepare styles for image export:

```typescript
import { ExportManager } from "@exocortex/obsidian-plugin";

const exportManager = new ExportManager(renderer);

// Export with custom background
const dataUrl = await exportManager.exportToPNG({
  backgroundColor: "#ffffff",
  scale: 2,  // 2x resolution
  padding: 50,
});

// Export to SVG (vector, infinite resolution)
const svgString = await exportManager.exportToSVG({
  includeStyles: true,
  fontEmbed: true,
});
```

## See Also

- [Configuration](../getting-started/configuration.md) - Full style options
- [Accessibility](./accessibility.md) - Accessible color choices
- [PixiGraphRenderer API](../api/renderer.md) - Renderer details
