# Basic Usage

This guide shows how to create a simple force-directed graph visualization.

## Minimal Working Example

```typescript
import {
  ForceSimulation,
  forceCenter,
  forceLink,
  forceManyBody,
  PixiGraphRenderer,
  NodeRenderer,
  EdgeRenderer,
  LabelRenderer,
} from "@exocortex/obsidian-plugin";
import type { GraphNode, GraphEdge, SimulationNode } from "@exocortex/obsidian-plugin";

// 1. Define your graph data
const nodes: GraphNode[] = [
  { id: "1", label: "Node A", path: "notes/a.md" },
  { id: "2", label: "Node B", path: "notes/b.md" },
  { id: "3", label: "Node C", path: "notes/c.md" },
];

const edges: GraphEdge[] = [
  { id: "e1", source: "1", target: "2", label: "links to" },
  { id: "e2", source: "2", target: "3", label: "references" },
];

// 2. Create container element
const container = document.getElementById("graph-container")!;

// 3. Initialize the PixiJS renderer
const renderer = new PixiGraphRenderer(container, {
  width: 800,
  height: 600,
  backgroundColor: 0x1a1a2e,
  antialias: true,
});

// 4. Create sub-renderers
const nodeRenderer = new NodeRenderer(renderer.app);
const edgeRenderer = new EdgeRenderer(renderer.app);
const labelRenderer = new LabelRenderer(renderer.app);

// 5. Create force simulation
const simulation = new ForceSimulation<SimulationNode>();

// Convert graph nodes to simulation nodes
const simNodes: SimulationNode[] = nodes.map((n, i) => ({
  ...n,
  index: i,
  x: Math.random() * 800,
  y: Math.random() * 600,
  vx: 0,
  vy: 0,
  mass: 1,
  radius: 8,
}));

// 6. Configure forces
simulation
  .nodes(simNodes)
  .force("center", forceCenter(400, 300))
  .force("charge", forceManyBody().strength(-300))
  .force(
    "link",
    forceLink<SimulationNode, { source: string; target: string }>(edges).id(
      (d) => d.id
    )
  );

// 7. Render on each tick
simulation.on("tick", () => {
  // Update edge positions
  edges.forEach((edge) => {
    const source = simNodes.find((n) => n.id === edge.source);
    const target = simNodes.find((n) => n.id === edge.target);
    if (source && target) {
      edgeRenderer.renderEdge({
        id: edge.id,
        source,
        target,
        style: { color: 0x4a4a6a, width: 2 },
      });
    }
  });

  // Update node positions
  simNodes.forEach((node) => {
    nodeRenderer.renderNode({
      id: node.id,
      x: node.x,
      y: node.y,
      radius: 12,
      style: { fill: 0x6366f1, stroke: 0xffffff, strokeWidth: 2 },
    });
  });

  // Update labels
  simNodes.forEach((node) => {
    labelRenderer.renderLabel({
      id: `label-${node.id}`,
      text: nodes.find((n) => n.id === node.id)!.label,
      x: node.x,
      y: node.y + 20,
      style: { fontSize: 12, fill: 0xffffff },
    });
  });
});

// 8. Start simulation
simulation.start();
```

## Using the GraphLayoutRenderer Component

For React-based usage in Obsidian, use the `GraphLayoutRenderer` component:

```tsx
import React from "react";
import { GraphLayoutRenderer } from "@exocortex/obsidian-plugin";
import type { GraphNode, GraphEdge } from "@exocortex/obsidian-plugin";

function MyGraphView() {
  const nodes: GraphNode[] = [
    { id: "1", label: "Project Alpha", path: "projects/alpha.md", group: "project" },
    { id: "2", label: "Task 1", path: "tasks/task1.md", group: "task" },
    { id: "3", label: "Task 2", path: "tasks/task2.md", group: "task" },
  ];

  const edges: GraphEdge[] = [
    { id: "e1", source: "1", target: "2", property: "hasTask" },
    { id: "e2", source: "1", target: "3", property: "hasTask" },
  ];

  const handleNodeClick = (nodeId: string, path: string) => {
    console.log(`Clicked node ${nodeId} at ${path}`);
    // Navigate to file in Obsidian
  };

  return (
    <GraphLayoutRenderer
      layout={{
        uid: "my-graph",
        label: "Project Graph",
        nodeLabel: "label",
        edgeProperties: ["hasTask", "dependsOn"],
      }}
      nodes={nodes}
      edges={edges}
      onNodeClick={handleNodeClick}
      options={{
        width: "100%",
        height: 500,
        chargeStrength: -400,
        linkDistance: 120,
        showLabels: true,
        zoomable: true,
        draggable: true,
      }}
    />
  );
}
```

## Building Graph Data from Table Rows

If you have data in table format (from Obsidian frontmatter), use `buildGraphData`:

```typescript
import { buildGraphData } from "@exocortex/obsidian-plugin";
import type { TableRow } from "@exocortex/obsidian-plugin";

// Table rows from Obsidian query
const tableRows: TableRow[] = [
  {
    id: "note-1",
    path: "projects/alpha.md",
    values: {
      title: "Project Alpha",
      status: "active",
      links: ["[[tasks/task1.md|Task 1]]", "[[tasks/task2.md|Task 2]]"],
    },
  },
  {
    id: "note-2",
    path: "tasks/task1.md",
    values: {
      title: "Task 1",
      status: "in-progress",
      parent: "[[projects/alpha.md|Project Alpha]]",
    },
  },
];

// Build graph data automatically
const graphData = buildGraphData(
  tableRows,
  "title", // Use 'title' column for labels
  ["links", "parent"] // Extract edges from these properties
);

console.log(graphData.nodes); // Automatically extracted nodes
console.log(graphData.edges); // Automatically extracted edges from wikilinks
```

## Customizing Node Colors by Type

```typescript
import { GraphLayoutRenderer } from "@exocortex/obsidian-plugin";

const nodeColorByGroup = (node: GraphNode): string => {
  switch (node.group) {
    case "project":
      return "#6366f1"; // Indigo
    case "area":
      return "#22c55e"; // Green
    case "task":
      return "#f59e0b"; // Amber
    default:
      return "#64748b"; // Slate
  }
};

<GraphLayoutRenderer
  layout={layout}
  nodes={nodes}
  edges={edges}
  options={{
    nodeColor: nodeColorByGroup,
    edgeColor: "#4a4a6a",
  }}
/>;
```

## Adding Interactivity

```typescript
import {
  SelectionManager,
  HoverManager,
  ViewportController,
} from "@exocortex/obsidian-plugin";

// Selection with multi-select
const selectionManager = new SelectionManager({
  multiSelect: true,
  boxSelect: true,
});

selectionManager.on("select", (event) => {
  console.log("Selected:", event.nodeIds);
});

// Hover tooltips
const hoverManager = new HoverManager({
  hoverDelay: 200,
  tooltipOffset: { x: 10, y: 10 },
});

hoverManager.on("hover", (event) => {
  if (event.type === "enter") {
    showTooltip(event.nodeId, event.position);
  }
});

// Pan and zoom
const viewportController = new ViewportController({
  minZoom: 0.1,
  maxZoom: 4,
  pannable: true,
  zoomable: true,
});

viewportController.on("change", (event) => {
  console.log("Viewport:", event.x, event.y, event.scale);
});
```

## Cleanup

Always clean up resources when the component unmounts:

```typescript
// In React useEffect
useEffect(() => {
  const simulation = new ForceSimulation();
  simulation.start();

  return () => {
    simulation.stop();
    renderer.destroy();
    nodeRenderer.dispose();
    edgeRenderer.dispose();
    labelRenderer.dispose();
  };
}, []);
```

## Next Steps

- [Obsidian Integration](./obsidian-integration.md) - Plugin-specific patterns
- [Configuration](./configuration.md) - Full options reference
- [Layouts](../guides/layouts.md) - Different layout algorithms
