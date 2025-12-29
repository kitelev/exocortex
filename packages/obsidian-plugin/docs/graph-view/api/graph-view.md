# GraphLayoutRenderer API

The main React component for rendering graph visualizations.

## Import

```typescript
import { GraphLayoutRenderer } from "./presentation/renderers/graph";
import type { GraphLayoutRendererProps, GraphNode, GraphEdge } from "./presentation/renderers/graph";
```

## Props

```typescript
interface GraphLayoutRendererProps {
  layout: {
    uid: string;               // Unique layout identifier
    label: string;             // Display name
    nodeLabel?: string;        // Column for node labels
    edgeProperties?: string[]; // Properties to extract edges from
    depth?: number;            // Traversal depth
    columns?: LayoutColumn[];  // Column definitions
  };
  nodes: GraphNode[];          // Node data
  edges: GraphEdge[];          // Edge data
  onNodeClick?: (nodeId: string, path: string, event: React.MouseEvent) => void;
  onEdgeClick?: (edgeId: string, event: React.MouseEvent) => void;
  options?: GraphLayoutOptions;
  className?: string;
}
```

## Basic Usage

```tsx
import React from "react";
import { GraphLayoutRenderer } from "./presentation/renderers/graph";

function MyGraph() {
  const nodes = [
    { id: "1", label: "Node A", path: "a.md" },
    { id: "2", label: "Node B", path: "b.md" },
  ];

  const edges = [
    { id: "e1", source: "1", target: "2" },
  ];

  return (
    <GraphLayoutRenderer
      layout={{ uid: "my-graph", label: "My Graph" }}
      nodes={nodes}
      edges={edges}
      options={{ width: "100%", height: 600 }}
    />
  );
}
```

## Event Handlers

### onNodeClick

Fired when a node is clicked:

```tsx
<GraphLayoutRenderer
  onNodeClick={(nodeId, path, event) => {
    if (event.ctrlKey || event.metaKey) {
      // Open in new pane
      openInNewPane(path);
    } else {
      // Navigate to file
      openFile(path);
    }
  }}
/>
```

### onEdgeClick

Fired when an edge is clicked:

```tsx
<GraphLayoutRenderer
  onEdgeClick={(edgeId, event) => {
    console.log(`Edge clicked: ${edgeId}`);
    // Highlight path between nodes
    highlightPath(edgeId);
  }}
/>
```

## Rendering Options

### Dimensions

```tsx
<GraphLayoutRenderer
  options={{
    width: 800,          // Fixed width in pixels
    height: 600,         // Fixed height in pixels
  }}
/>

<GraphLayoutRenderer
  options={{
    width: "100%",       // Responsive width
    height: "calc(100vh - 100px)",  // Dynamic height
  }}
/>
```

### Physics Simulation

```tsx
<GraphLayoutRenderer
  options={{
    chargeStrength: -500,   // Strong repulsion
    linkDistance: 150,      // Long links
    useBarnesHut: true,     // O(n log n) for large graphs
    barnesHutTheta: 0.9,    // Approximation level
  }}
/>
```

### Node Appearance

```tsx
<GraphLayoutRenderer
  options={{
    nodeRadius: 12,
    nodeColor: "#6366f1",  // Static color
    showLabels: true,
  }}
/>

// Dynamic coloring by group
<GraphLayoutRenderer
  options={{
    nodeColor: (node) => {
      switch (node.group) {
        case "project": return "#6366f1";
        case "task": return "#f59e0b";
        default: return "#64748b";
      }
    },
  }}
/>
```

### Edge Appearance

```tsx
<GraphLayoutRenderer
  options={{
    edgeColor: "#4a4a6a",      // Static color
    showEdgeLabels: true,       // Show edge labels
  }}
/>

// Dynamic coloring by property
<GraphLayoutRenderer
  options={{
    edgeColor: (edge) => {
      if (edge.property === "dependsOn") return "#ef4444";
      if (edge.property === "belongsTo") return "#22c55e";
      return "#4a4a6a";
    },
  }}
/>
```

### Viewport Controls

```tsx
<GraphLayoutRenderer
  options={{
    zoomable: true,        // Enable zoom
    minZoom: 0.1,          // Minimum zoom level
    maxZoom: 4,            // Maximum zoom level
    draggable: true,       // Enable node dragging
    initialZoom: {
      x: 400,              // Initial pan X
      y: 300,              // Initial pan Y
      k: 1,                // Initial zoom level
    },
  }}
/>
```

## Ref Access

Access the underlying renderer via ref:

```tsx
import { useRef, useEffect } from "react";

function MyGraph() {
  const graphRef = useRef<GraphLayoutRendererRef>(null);

  useEffect(() => {
    // Access simulation
    const simulation = graphRef.current?.getSimulation();
    simulation?.alpha(1).restart();

    // Access viewport
    const viewport = graphRef.current?.getViewport();
    viewport?.zoomTo(1.5);

    // Focus on node
    graphRef.current?.focusNode("node-1");

    // Export to PNG
    const dataUrl = graphRef.current?.exportToPNG();
  }, []);

  return <GraphLayoutRenderer ref={graphRef} {...props} />;
}
```

## Imperative Methods

When using a ref, these methods are available:

### getSimulation()

Returns the `ForceSimulation` instance:

```typescript
const simulation = graphRef.current?.getSimulation();
simulation?.alpha(1).restart();  // Reheat simulation
simulation?.stop();              // Stop simulation
```

### getViewport()

Returns the `ViewportController` instance:

```typescript
const viewport = graphRef.current?.getViewport();
viewport?.zoomTo(2);                    // Zoom to 2x
viewport?.panTo(100, 200);              // Pan to position
viewport?.fitToView(nodes);             // Fit all nodes
viewport?.centerOnNode("node-1");       // Center on specific node
```

### focusNode(nodeId)

Focus and center on a specific node:

```typescript
graphRef.current?.focusNode("node-1");
```

### selectNodes(nodeIds)

Select multiple nodes:

```typescript
graphRef.current?.selectNodes(["node-1", "node-2"]);
```

### clearSelection()

Clear all selection:

```typescript
graphRef.current?.clearSelection();
```

### exportToPNG(options?)

Export the graph as PNG:

```typescript
const dataUrl = graphRef.current?.exportToPNG({
  scale: 2,              // Resolution multiplier
  backgroundColor: "#fff", // Background color
});
```

### exportToSVG()

Export the graph as SVG:

```typescript
const svgString = graphRef.current?.exportToSVG();
```

## Performance Optimization

For large graphs (1000+ nodes):

```tsx
<GraphLayoutRenderer
  options={{
    // Use Barnes-Hut algorithm
    useBarnesHut: true,
    barnesHutTheta: 0.9,

    // Limit visual complexity
    showLabels: false,       // Hide labels at overview level
    showEdgeLabels: false,

    // Use smaller nodes
    nodeRadius: 4,
  }}
/>
```

## TypeScript

Full type definitions:

```typescript
import type {
  GraphLayoutRendererProps,
  GraphLayoutRendererRef,
  GraphNode,
  GraphEdge,
  GraphData,
  GraphLayoutOptions,
} from "./presentation/renderers/graph";

const MyGraph: React.FC = () => {
  const ref = useRef<GraphLayoutRendererRef>(null);

  const nodes: GraphNode[] = [...];
  const edges: GraphEdge[] = [...];
  const options: GraphLayoutOptions = {...};

  return (
    <GraphLayoutRenderer
      ref={ref}
      layout={{ uid: "graph", label: "Graph" }}
      nodes={nodes}
      edges={edges}
      options={options}
    />
  );
};
```

## See Also

- [ForceSimulation](./physics-engine.md) - Physics simulation API
- [LayoutManager](./layout-engine.md) - Layout algorithms
- [Events](./events.md) - Event handling
- [Configuration](../getting-started/configuration.md) - Full options reference
