# Basic Graph Example

A minimal example showing how to create and render a simple graph.

## Complete Example

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
  ViewportController,
  SelectionManager,
} from "@exocortex/obsidian-plugin";
import type { GraphNode, GraphEdge, SimulationNode } from "@exocortex/obsidian-plugin";

// 1. Define graph data
const nodes: GraphNode[] = [
  { id: "1", label: "Project Alpha", path: "projects/alpha.md", group: "project" },
  { id: "2", label: "Task 1", path: "tasks/task1.md", group: "task" },
  { id: "3", label: "Task 2", path: "tasks/task2.md", group: "task" },
  { id: "4", label: "Resource A", path: "resources/a.md", group: "resource" },
];

const edges: GraphEdge[] = [
  { id: "e1", source: "1", target: "2", property: "hasTask" },
  { id: "e2", source: "1", target: "3", property: "hasTask" },
  { id: "e3", source: "2", target: "4", property: "uses" },
];

// 2. Get container element
const container = document.getElementById("graph-container")!;
const width = container.clientWidth;
const height = container.clientHeight;

// 3. Create renderer
const renderer = new PixiGraphRenderer(container, {
  width,
  height,
  backgroundColor: 0x1a1a2e,
  antialias: true,
});

// 4. Create sub-renderers
const nodeRenderer = new NodeRenderer(renderer.app);
const edgeRenderer = new EdgeRenderer(renderer.app);
const labelRenderer = new LabelRenderer(renderer.app);

// 5. Create controllers
const viewportController = new ViewportController(container, {
  minZoom: 0.1,
  maxZoom: 4,
});

const selectionManager = new SelectionManager({
  multiSelect: true,
});

// 6. Convert to simulation nodes
const simNodes: SimulationNode[] = nodes.map((n, i) => ({
  ...n,
  index: i,
  x: Math.random() * width,
  y: Math.random() * height,
  vx: 0,
  vy: 0,
  mass: 1,
  radius: 12,
}));

// 7. Create force simulation
const simulation = new ForceSimulation<SimulationNode>()
  .nodes(simNodes)
  .force("center", forceCenter(width / 2, height / 2))
  .force("charge", forceManyBody().strength(-300))
  .force("link", forceLink(edges).id((d) => d.id).distance(100));

// 8. Define colors
const colors: Record<string, number> = {
  project: 0x6366f1,
  task: 0xf59e0b,
  resource: 0x22c55e,
};

// 9. Render function
function render(): void {
  // Clear previous frame
  nodeRenderer.clear();
  edgeRenderer.clear();
  labelRenderer.clear();

  // Render edges
  for (const edge of edges) {
    const source = simNodes.find((n) => n.id === edge.source);
    const target = simNodes.find((n) => n.id === edge.target);
    if (!source || !target) continue;

    edgeRenderer.renderEdge({
      id: edge.id,
      source: { x: source.x, y: source.y },
      target: { x: target.x, y: target.y },
      style: { color: 0x4a4a6a, width: 2, alpha: 0.6 },
      curveType: "quadratic",
      curvature: 0.2,
      arrowType: "triangle",
      arrowPosition: "end",
      arrowSize: 8,
    });
  }

  // Render nodes
  for (const node of simNodes) {
    const isSelected = selectionManager.isSelected(node.id);

    nodeRenderer.renderNode({
      id: node.id,
      x: node.x,
      y: node.y,
      radius: 12,
      shape: "circle",
      style: {
        fill: colors[node.group || "default"] || 0x64748b,
        stroke: isSelected ? 0x6366f1 : 0xffffff,
        strokeWidth: isSelected ? 3 : 2,
        alpha: 1,
      },
    });
  }

  // Render labels
  for (const node of simNodes) {
    labelRenderer.renderLabel({
      id: `label-${node.id}`,
      text: nodes.find((n) => n.id === node.id)!.label,
      x: node.x,
      y: node.y + 20,
      style: {
        fontFamily: "Inter, sans-serif",
        fontSize: 12,
        fill: 0xffffff,
        align: "center",
        alpha: 1,
      },
    });
  }
}

// 10. Connect simulation to rendering
simulation.on("tick", render);
simulation.on("end", () => console.log("Simulation complete"));

// 11. Handle selection
container.addEventListener("click", (e) => {
  const worldPos = viewportController.screenToWorld(e.clientX, e.clientY);
  const nodeId = hitTestNode(worldPos, simNodes);

  if (nodeId) {
    if (e.shiftKey) {
      selectionManager.toggleSelection(nodeId);
    } else {
      selectionManager.selectNode(nodeId);
    }
    render();
  } else {
    selectionManager.clearSelection();
    render();
  }
});

// 12. Hit testing helper
function hitTestNode(pos: { x: number; y: number }, nodes: SimulationNode[]): string | null {
  for (const node of nodes) {
    const dx = pos.x - node.x;
    const dy = pos.y - node.y;
    if (dx * dx + dy * dy < node.radius * node.radius) {
      return node.id;
    }
  }
  return null;
}

// 13. Start simulation
simulation.start();

// 14. Cleanup function
function cleanup(): void {
  simulation.stop();
  nodeRenderer.dispose();
  edgeRenderer.dispose();
  labelRenderer.dispose();
  renderer.destroy();
}
```

## React Component Version

```tsx
import React, { useEffect, useRef } from "react";
import { GraphLayoutRenderer } from "@exocortex/obsidian-plugin";
import type { GraphNode, GraphEdge } from "@exocortex/obsidian-plugin";

const BasicGraph: React.FC = () => {
  const nodes: GraphNode[] = [
    { id: "1", label: "Project Alpha", path: "projects/alpha.md", group: "project" },
    { id: "2", label: "Task 1", path: "tasks/task1.md", group: "task" },
    { id: "3", label: "Task 2", path: "tasks/task2.md", group: "task" },
    { id: "4", label: "Resource A", path: "resources/a.md", group: "resource" },
  ];

  const edges: GraphEdge[] = [
    { id: "e1", source: "1", target: "2", property: "hasTask" },
    { id: "e2", source: "1", target: "3", property: "hasTask" },
    { id: "e3", source: "2", target: "4", property: "uses" },
  ];

  const handleNodeClick = (nodeId: string, path: string) => {
    console.log(`Clicked: ${nodeId} (${path})`);
  };

  return (
    <GraphLayoutRenderer
      layout={{
        uid: "basic-graph",
        label: "Basic Graph Example",
      }}
      nodes={nodes}
      edges={edges}
      onNodeClick={handleNodeClick}
      options={{
        width: "100%",
        height: 500,
        chargeStrength: -300,
        linkDistance: 100,
        showLabels: true,
        nodeColor: (node) => {
          const colors: Record<string, string> = {
            project: "#6366f1",
            task: "#f59e0b",
            resource: "#22c55e",
          };
          return colors[node.group || ""] || "#64748b";
        },
      }}
    />
  );
};

export default BasicGraph;
```

## Output

The example creates:
- 4 nodes (1 project, 2 tasks, 1 resource)
- 3 edges connecting them
- Force-directed layout with repulsion
- Click to select nodes
- Shift+click for multi-select

## See Also

- [Dynamic Data](./dynamic-data.md) - Real-time updates
- [Custom Layout](./custom-layout.md) - Custom algorithms
- [Basic Usage Guide](../getting-started/basic-usage.md)
