# ForceSimulation API

The physics engine for force-directed graph layouts. Provides a d3-force compatible API with Barnes-Hut optimization for large graphs.

## Import

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

import type {
  SimulationNode,
  SimulationLink,
  Force,
  ForceSimulationConfig,
  SimulationMetrics,
} from "./presentation/renderers/graph";
```

## Constructor

```typescript
const simulation = new ForceSimulation<SimulationNode>(config?: ForceSimulationConfig);
```

### ForceSimulationConfig

```typescript
interface ForceSimulationConfig {
  alpha?: number;          // Initial alpha (default: 1)
  alphaMin?: number;       // Stop threshold (default: 0.001)
  alphaDecay?: number;     // Cooling rate (default: 0.0228)
  alphaTarget?: number;    // Target alpha (default: 0)
  velocityDecay?: number;  // Velocity damping (default: 0.4)
  randomSource?: () => number;  // Custom RNG
}
```

## Methods

### nodes(nodes)

Set or get the simulation nodes:

```typescript
// Set nodes
simulation.nodes([
  { id: "1", x: 0, y: 0, vx: 0, vy: 0, index: 0, mass: 1, radius: 8 },
  { id: "2", x: 100, y: 100, vx: 0, vy: 0, index: 1, mass: 1, radius: 8 },
]);

// Get nodes
const nodes = simulation.nodes();
```

### force(name, force?)

Add, get, or remove a force:

```typescript
// Add force
simulation.force("center", forceCenter(400, 300));

// Get force
const centerForce = simulation.force("center");

// Remove force
simulation.force("center", null);
```

### start()

Start the simulation:

```typescript
simulation.start();
```

### stop()

Stop the simulation:

```typescript
simulation.stop();
```

### restart()

Restart the simulation with current alpha:

```typescript
simulation.restart();
```

### tick(iterations?)

Manually advance the simulation:

```typescript
// Single tick
simulation.tick();

// Multiple ticks
simulation.tick(100);
```

### alpha(value?)

Get or set the current alpha:

```typescript
// Get alpha
const currentAlpha = simulation.alpha();

// Set alpha (reheat simulation)
simulation.alpha(1);
```

### alphaMin(value?)

Get or set the minimum alpha:

```typescript
simulation.alphaMin(0.001);
```

### alphaDecay(value?)

Get or set the alpha decay rate:

```typescript
simulation.alphaDecay(0.0228);
```

### alphaTarget(value?)

Get or set the target alpha:

```typescript
// Keep simulation running
simulation.alphaTarget(0.1);

// Allow simulation to cool
simulation.alphaTarget(0);
```

### velocityDecay(value?)

Get or set the velocity decay:

```typescript
simulation.velocityDecay(0.4);
```

### on(event, callback)

Subscribe to simulation events:

```typescript
simulation.on("tick", () => {
  // Update rendering
  render();
});

simulation.on("end", () => {
  console.log("Simulation complete");
});
```

### off(event, callback?)

Unsubscribe from events:

```typescript
simulation.off("tick", tickHandler);
simulation.off("tick"); // Remove all tick handlers
```

### metrics()

Get performance metrics:

```typescript
const metrics: SimulationMetrics = simulation.metrics();
console.log(`FPS: ${metrics.fps}`);
console.log(`Avg tick: ${metrics.avgTickTime}ms`);
```

## Built-in Forces

### forceCenter(x, y)

Centers the graph at a specific point:

```typescript
import { forceCenter } from "./presentation/renderers/graph";

simulation.force("center", forceCenter(width / 2, height / 2));

// Configure strength
const center = forceCenter(400, 300);
center.strength(0.1);  // Gentle centering
simulation.force("center", center);
```

### forceManyBody()

Applies charge-based repulsion/attraction:

```typescript
import { forceManyBody } from "./presentation/renderers/graph";

const charge = forceManyBody()
  .strength(-300)        // Negative for repulsion
  .distanceMin(1)        // Minimum distance
  .distanceMax(Infinity) // Maximum distance
  .theta(0.9);           // Barnes-Hut approximation

simulation.force("charge", charge);
```

### forceLink(links)

Applies link constraints:

```typescript
import { forceLink } from "./presentation/renderers/graph";

const links = [
  { source: "1", target: "2" },
  { source: "2", target: "3" },
];

const linkForce = forceLink(links)
  .id((d) => d.id)       // Node ID accessor
  .distance(100)         // Target distance
  .strength(1)           // Link stiffness
  .iterations(1);        // Constraint iterations

simulation.force("link", linkForce);
```

### forceCollide(radius?)

Prevents node overlap:

```typescript
import { forceCollide } from "./presentation/renderers/graph";

const collide = forceCollide()
  .radius((d) => d.radius + 2)  // Collision radius
  .strength(0.7)                 // Collision strength
  .iterations(1);                // Collision iterations

simulation.force("collide", collide);
```

### forceRadial(radius, x?, y?)

Pulls nodes toward a circular path:

```typescript
import { forceRadial } from "./presentation/renderers/graph";

const radial = forceRadial(200, width / 2, height / 2)
  .strength(0.1);

simulation.force("radial", radial);
```

### forceX(x?) / forceY(y?)

Position forces along axes:

```typescript
import { forceX, forceY } from "./presentation/renderers/graph";

// Pull nodes toward center X
simulation.force("x", forceX(width / 2).strength(0.05));

// Pull nodes toward center Y
simulation.force("y", forceY(height / 2).strength(0.05));

// Position by group
simulation.force("x", forceX((d) => {
  if (d.group === "left") return 100;
  if (d.group === "right") return 700;
  return 400;
}).strength(0.1));
```

## Force Presets

Pre-configured force combinations:

```typescript
import { FORCE_PRESETS } from "./presentation/renderers/graph";

// Available presets
FORCE_PRESETS.default     // Balanced for general use
FORCE_PRESETS.clustered   // Tight clusters
FORCE_PRESETS.sparse      // Spread out
FORCE_PRESETS.hierarchical // Vertical emphasis
FORCE_PRESETS.radial      // Circular arrangement

// Apply preset
simulation
  .force("center", forceCenter(width / 2, height / 2).strength(FORCE_PRESETS.clustered.center.strength))
  .force("charge", forceManyBody().strength(FORCE_PRESETS.clustered.charge.strength))
  .force("link", forceLink(edges).distance(FORCE_PRESETS.clustered.link.distance));
```

## Custom Forces

Create custom forces:

```typescript
function forceGravity(centerX: number, centerY: number, strength: number = 0.1): Force {
  let nodes: SimulationNode[] = [];

  const force: Force = (alpha: number) => {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;

      const dx = centerX - node.x;
      const dy = centerY - node.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 0) {
        const force = strength * alpha;
        node.vx += (dx / distance) * force;
        node.vy += (dy / distance) * force;
      }
    }
  };

  force.initialize = (n: SimulationNode[]) => {
    nodes = n;
  };

  return force;
}

simulation.force("gravity", forceGravity(400, 300, 0.05));
```

## Node Pinning

Fix node positions during drag:

```typescript
function onDragStart(node: SimulationNode, x: number, y: number) {
  // Pin node to current position
  node.fx = x;
  node.fy = y;

  // Reheat simulation
  simulation.alphaTarget(0.3).restart();
}

function onDrag(node: SimulationNode, x: number, y: number) {
  node.fx = x;
  node.fy = y;
}

function onDragEnd(node: SimulationNode) {
  // Unpin node
  node.fx = null;
  node.fy = null;

  // Let simulation cool
  simulation.alphaTarget(0);
}
```

## Barnes-Hut Optimization

For large graphs (1000+ nodes), the Barnes-Hut algorithm provides O(n log n) performance:

```typescript
import { BarnesHutForce, createBarnesHutForce } from "./presentation/renderers/graph";

// Create Barnes-Hut force
const bhForce = createBarnesHutForce({
  strength: -300,
  theta: 0.9,       // 0.5 = accurate, 1.5 = fast
  distanceMin: 1,
  distanceMax: Infinity,
});

simulation.force("charge", bhForce);
```

## Performance Tips

### Large Graphs (1000+ nodes)

```typescript
const simulation = new ForceSimulation({
  alphaDecay: 0.01,    // Slower cooling for better layout
  velocityDecay: 0.3,  // More momentum
});

simulation
  .force("center", forceCenter(width / 2, height / 2).strength(0.05))
  .force("charge", forceManyBody()
    .strength(-100)      // Weaker repulsion
    .distanceMax(200)    // Limit distance
    .theta(1.0))         // More approximation
  .force("link", forceLink(edges)
    .distance(50)
    .strength(0.5)
    .iterations(1));
```

### Real-time Updates

```typescript
// Batch node additions
function addNodes(newNodes: SimulationNode[]) {
  const allNodes = [...simulation.nodes(), ...newNodes];
  simulation.nodes(allNodes);
  simulation.alpha(0.3).restart();
}

// Efficient reruns
function updateLayout() {
  simulation.alpha(0.5);
  simulation.restart();
}
```

## See Also

- [LayoutManager](./layout-engine.md) - Layout algorithms
- [WebGPUPhysics](../guides/performance.md#webgpu-physics) - GPU acceleration
- [Configuration](../getting-started/configuration.md) - Full options
