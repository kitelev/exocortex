# Custom Layout Example

This example shows how to create and register custom layout algorithms.

## Spiral Layout

A layout that arranges nodes in a spiral pattern:

```typescript
import {
  BaseLayoutAlgorithm,
  createLayoutPlugin,
  layoutPluginRegistry,
} from "@exocortex/obsidian-plugin";
import type { GraphNode, GraphEdge, LayoutResult } from "@exocortex/obsidian-plugin";

interface SpiralLayoutOptions {
  centerX: number;
  centerY: number;
  startRadius: number;
  radiusIncrement: number;
  angleStep: number;
  sortBy: "label" | "connections" | "none";
}

class SpiralLayout extends BaseLayoutAlgorithm<SpiralLayoutOptions> {
  static defaultOptions: SpiralLayoutOptions = {
    centerX: 400,
    centerY: 300,
    startRadius: 50,
    radiusIncrement: 15,
    angleStep: 0.5,
    sortBy: "none",
  };

  compute(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
    const opts = { ...SpiralLayout.defaultOptions, ...this.options };
    let sortedNodes = [...nodes];

    // Sort nodes if requested
    if (opts.sortBy === "label") {
      sortedNodes.sort((a, b) => a.label.localeCompare(b.label));
    } else if (opts.sortBy === "connections") {
      const connections = new Map<string, number>();
      for (const edge of edges) {
        const sId = typeof edge.source === "string" ? edge.source : edge.source.id;
        const tId = typeof edge.target === "string" ? edge.target : edge.target.id;
        connections.set(sId, (connections.get(sId) || 0) + 1);
        connections.set(tId, (connections.get(tId) || 0) + 1);
      }
      sortedNodes.sort(
        (a, b) => (connections.get(b.id) || 0) - (connections.get(a.id) || 0)
      );
    }

    // Calculate positions
    const positions = sortedNodes.map((node, i) => {
      const angle = i * opts.angleStep;
      const radius = opts.startRadius + i * opts.radiusIncrement;

      return {
        id: node.id,
        x: opts.centerX + radius * Math.cos(angle),
        y: opts.centerY + radius * Math.sin(angle),
      };
    });

    return { nodes: positions, edges };
  }
}

// Register the plugin
const spiralPlugin = createLayoutPlugin({
  name: "spiral",
  displayName: "Spiral Layout",
  description: "Arranges nodes in a spiral pattern from the center",
  category: "radial",
  graphTypes: ["general"],
  factory: (options) => new SpiralLayout(options),
  options: [
    { name: "startRadius", type: "number", displayName: "Start Radius", default: 50, min: 10 },
    { name: "radiusIncrement", type: "number", displayName: "Radius Increment", default: 15, min: 1 },
    { name: "angleStep", type: "number", displayName: "Angle Step (radians)", default: 0.5, min: 0.1, max: 2 },
    {
      name: "sortBy",
      type: "select",
      displayName: "Sort Nodes By",
      default: "none",
      options: ["none", "label", "connections"],
    },
  ],
});

layoutPluginRegistry.register(spiralPlugin);
```

## Force-Directed with Constraints

A force layout with alignment constraints:

```typescript
import { ForceSimulation, forceCenter, forceManyBody, forceLink, forceY } from "@exocortex/obsidian-plugin";

interface GroupConstraintOptions {
  groupKey: string;
  groupPositions: Record<string, number>;
  strength: number;
}

class ConstrainedForceLayout extends BaseLayoutAlgorithm<GroupConstraintOptions> {
  compute(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
    const opts = this.options;

    // Create simulation nodes
    const simNodes = nodes.map((n, i) => ({
      ...n,
      index: i,
      x: Math.random() * 800,
      y: opts.groupPositions[(n as any)[opts.groupKey]] || 300,
      vx: 0,
      vy: 0,
      mass: 1,
      radius: 12,
    }));

    // Create simulation with custom Y force for group alignment
    const simulation = new ForceSimulation()
      .nodes(simNodes)
      .force("center", forceCenter(400, 300).strength(0.05))
      .force("charge", forceManyBody().strength(-200))
      .force("link", forceLink(edges).id((d) => d.id).distance(80))
      .force(
        "groupY",
        forceY((d: any) => opts.groupPositions[d[opts.groupKey]] || 300).strength(opts.strength)
      );

    // Run simulation synchronously
    simulation.stop();
    for (let i = 0; i < 300; i++) {
      simulation.tick();
    }

    return {
      nodes: simNodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      edges,
    };
  }
}

// Usage
const layout = new ConstrainedForceLayout({
  groupKey: "type",
  groupPositions: {
    area: 100,
    project: 250,
    task: 400,
    resource: 550,
  },
  strength: 0.3,
});

const result = layout.compute(nodes, edges);
```

## Swimlane Layout

Horizontal lanes based on node properties:

```typescript
interface SwimlaneLayoutOptions {
  laneKey: string;
  laneSpacing: number;
  nodeSpacing: number;
  sortWithinLane: "label" | "date" | "none";
  direction: "horizontal" | "vertical";
}

class SwimlaneLayout extends BaseLayoutAlgorithm<SwimlaneLayoutOptions> {
  compute(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
    const opts = {
      laneKey: "group",
      laneSpacing: 150,
      nodeSpacing: 80,
      sortWithinLane: "label" as const,
      direction: "horizontal" as const,
      ...this.options,
    };

    // Group nodes by lane
    const lanes = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const lane = (node as any)[opts.laneKey] || "default";
      if (!lanes.has(lane)) lanes.set(lane, []);
      lanes.get(lane)!.push(node);
    }

    // Sort lanes
    const sortedLanes = Array.from(lanes.keys()).sort();

    // Sort nodes within each lane
    for (const [lane, laneNodes] of lanes) {
      if (opts.sortWithinLane === "label") {
        laneNodes.sort((a, b) => a.label.localeCompare(b.label));
      } else if (opts.sortWithinLane === "date") {
        laneNodes.sort(
          (a, b) =>
            new Date(a.metadata?.createdAt as string || 0).getTime() -
            new Date(b.metadata?.createdAt as string || 0).getTime()
        );
      }
    }

    // Calculate positions
    const positions: { id: string; x: number; y: number }[] = [];

    sortedLanes.forEach((lane, laneIndex) => {
      const laneNodes = lanes.get(lane)!;

      laneNodes.forEach((node, nodeIndex) => {
        if (opts.direction === "horizontal") {
          positions.push({
            id: node.id,
            x: 100 + nodeIndex * opts.nodeSpacing,
            y: 100 + laneIndex * opts.laneSpacing,
          });
        } else {
          positions.push({
            id: node.id,
            x: 100 + laneIndex * opts.laneSpacing,
            y: 100 + nodeIndex * opts.nodeSpacing,
          });
        }
      });
    });

    return { nodes: positions, edges };
  }

  getLanes(): string[] {
    // For rendering lane headers
    return Array.from(this.lanes?.keys() || []);
  }
}
```

## Cluster Layout with Force

Combines community detection with force simulation:

```typescript
import { detectCommunities } from "@exocortex/obsidian-plugin";

class ClusterForceLayout extends BaseLayoutAlgorithm {
  compute(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
    // Detect communities
    const communities = detectCommunities(nodes, edges, {
      resolution: 1.0,
    });

    // Calculate cluster centers
    const clusterCount = communities.communities.length;
    const clusterRadius = 200;
    const clusterCenters = new Map<number, { x: number; y: number }>();

    for (let i = 0; i < clusterCount; i++) {
      const angle = (i / clusterCount) * Math.PI * 2;
      clusterCenters.set(i, {
        x: 400 + clusterRadius * Math.cos(angle),
        y: 300 + clusterRadius * Math.sin(angle),
      });
    }

    // Create simulation with cluster attraction
    const simNodes = nodes.map((n, i) => {
      const cluster = communities.assignment.get(n.id) || 0;
      const center = clusterCenters.get(cluster)!;
      return {
        ...n,
        index: i,
        x: center.x + (Math.random() - 0.5) * 50,
        y: center.y + (Math.random() - 0.5) * 50,
        vx: 0,
        vy: 0,
        mass: 1,
        radius: 12,
        cluster,
      };
    });

    // Custom cluster force
    const clusterForce = (alpha: number) => {
      for (const node of simNodes) {
        const center = clusterCenters.get(node.cluster)!;
        node.vx += (center.x - node.x) * alpha * 0.1;
        node.vy += (center.y - node.y) * alpha * 0.1;
      }
    };

    const simulation = new ForceSimulation()
      .nodes(simNodes)
      .force("charge", forceManyBody().strength(-50))
      .force("link", forceLink(edges).id((d) => d.id).distance(30))
      .force("cluster", clusterForce);

    // Run simulation
    simulation.stop();
    for (let i = 0; i < 200; i++) {
      simulation.tick();
    }

    return {
      nodes: simNodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      edges,
      metadata: {
        communities: communities.communities,
        assignment: communities.assignment,
      },
    };
  }
}
```

## Using Custom Layouts

```typescript
// Register all custom layouts
layoutPluginRegistry.register(spiralPlugin);
layoutPluginRegistry.register(swimlanePlugin);
layoutPluginRegistry.register(clusterForcePlugin);

// Use in LayoutManager
const layoutManager = new LayoutManager({
  defaultLayout: "force",
});

// Switch to custom layout
layoutManager.setLayout("spiral", {
  startRadius: 30,
  radiusIncrement: 20,
  sortBy: "connections",
});

// Transition with animation
await layoutManager.transitionTo("swimlane", {
  laneKey: "status",
  direction: "horizontal",
});
```

## Layout with Animation

```typescript
class AnimatedLayout extends BaseLayoutAlgorithm {
  async computeAsync(
    nodes: GraphNode[],
    edges: GraphEdge[],
    onProgress?: (progress: number, positions: Position[]) => void
  ): Promise<LayoutResult> {
    const totalIterations = 100;

    // Initial random positions
    const positions = nodes.map((n) => ({
      id: n.id,
      x: Math.random() * 800,
      y: Math.random() * 600,
    }));

    // Animate layout computation
    for (let i = 0; i < totalIterations; i++) {
      // Apply layout step
      this.layoutStep(positions, edges);

      // Report progress
      if (onProgress) {
        onProgress(i / totalIterations, positions);
      }

      // Allow rendering
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    return { nodes: positions, edges };
  }

  private layoutStep(positions: Position[], edges: GraphEdge[]): void {
    // Simple force iteration
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 100 / (dist * dist);

        positions[i].x -= (dx / dist) * force;
        positions[i].y -= (dy / dist) * force;
        positions[j].x += (dx / dist) * force;
        positions[j].y += (dy / dist) * force;
      }
    }
  }
}
```

## See Also

- [Layouts Guide](../guides/layouts.md) - Layout algorithms
- [LayoutManager API](../api/layout-engine.md) - Layout management
- [Extension Points](../architecture/extension-points.md) - Plugin architecture
