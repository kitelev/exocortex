# Constraint System

The Constraint System provides user-controlled positioning and relationship constraints for graph nodes, allowing precise control over node placement while maintaining physics simulation.

## Overview

The constraint system consists of two main components:

- **ConstraintManager**: Manages constraint definitions, lifecycle, and UI integration
- **ConstraintSolver**: Resolves constraint violations and applies corrections during simulation

## Constraint Types

### Position Constraints

Pin nodes to specific coordinates or regions:

```typescript
import { ConstraintManager, ConstraintType } from "./presentation/renderers/graph";

const constraintManager = new ConstraintManager();

// Pin a node to exact coordinates
constraintManager.addConstraint({
  type: ConstraintType.POSITION,
  nodeId: "node-1",
  target: { x: 100, y: 200 },
  strength: 1.0, // 0-1, higher = stricter adherence
});

// Constrain to a region (bounding box)
constraintManager.addConstraint({
  type: ConstraintType.REGION,
  nodeId: "node-2",
  bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
  strength: 0.8,
});
```

### Alignment Constraints

Align multiple nodes horizontally or vertically:

```typescript
// Horizontal alignment (same Y coordinate)
constraintManager.addConstraint({
  type: ConstraintType.ALIGN_HORIZONTAL,
  nodeIds: ["node-1", "node-2", "node-3"],
  targetY: 150,
  strength: 0.9,
});

// Vertical alignment (same X coordinate)
constraintManager.addConstraint({
  type: ConstraintType.ALIGN_VERTICAL,
  nodeIds: ["node-4", "node-5"],
  targetX: 300,
  strength: 0.9,
});
```

### Spacing Constraints

Maintain consistent spacing between nodes:

```typescript
// Equal horizontal spacing
constraintManager.addConstraint({
  type: ConstraintType.EQUAL_SPACING,
  nodeIds: ["node-1", "node-2", "node-3"],
  direction: "horizontal",
  spacing: 50, // pixels between nodes
  strength: 0.7,
});

// Minimum distance constraint
constraintManager.addConstraint({
  type: ConstraintType.MIN_DISTANCE,
  nodeIds: ["node-a", "node-b"],
  minDistance: 100,
  strength: 1.0,
});
```

### Hierarchy Constraints

Enforce parent-child relationships:

```typescript
// Parent above children
constraintManager.addConstraint({
  type: ConstraintType.HIERARCHY,
  parentId: "parent-node",
  childIds: ["child-1", "child-2", "child-3"],
  direction: "vertical", // parent above
  minGap: 80,
  strength: 0.85,
});
```

## Configuration Options

```typescript
interface ConstraintConfig {
  /** Maximum solver iterations per frame (default: 10) */
  maxIterations: number;

  /** Convergence threshold (default: 0.01) */
  tolerance: number;

  /** Global strength multiplier (default: 1.0) */
  globalStrength: number;

  /** Whether to visualize constraints (default: false) */
  showConstraints: boolean;

  /** Constraint line color (default: '#ff6b6b') */
  constraintColor: string;

  /** Constraint line opacity (default: 0.5) */
  constraintOpacity: number;
}
```

## Solver Algorithm

The `ConstraintSolver` uses an iterative relaxation algorithm:

1. **Priority Resolution**: Constraints are sorted by priority (position > alignment > spacing)
2. **Iterative Relaxation**: Each constraint computes correction vectors
3. **Conflict Resolution**: Overlapping constraints are blended based on strength
4. **Velocity Damping**: Corrections are applied gradually to prevent oscillation

```typescript
// Create solver with custom config
const solver = new ConstraintSolver({
  maxIterations: 15,
  tolerance: 0.005,
  damping: 0.8,
});

// Integrate with simulation
simulation.on("tick", () => {
  solver.solve(nodes, constraints);
  renderer.render();
});
```

## Integration with Force Simulation

Constraints work alongside force simulation:

```typescript
const simulation = new ForceSimulation()
  .nodes(graphData.nodes)
  .force("center", forceCenter(width / 2, height / 2))
  .force("charge", forceManyBody().strength(-300));

// Add constraint manager as a custom force
simulation.force("constraints", (alpha) => {
  constraintManager.apply(simulation.nodes(), alpha);
});
```

## UI Integration

### Visual Feedback

```typescript
// Enable constraint visualization
constraintManager.setConfig({ showConstraints: true });

// Highlight violated constraints
constraintManager.on("violation", (event) => {
  console.log("Constraint violated:", event.constraintId);
  highlightNode(event.nodeId, "warning");
});
```

### Interactive Constraint Creation

```typescript
// Create constraint from user selection
function createAlignmentFromSelection(selectedNodeIds: string[]) {
  if (selectedNodeIds.length < 2) return;

  constraintManager.addConstraint({
    type: ConstraintType.ALIGN_HORIZONTAL,
    nodeIds: selectedNodeIds,
    strength: 0.8,
  });
}
```

## Events

The ConstraintManager emits events for constraint lifecycle:

```typescript
constraintManager.on("add", (event) => {
  console.log("Constraint added:", event.constraint.id);
});

constraintManager.on("remove", (event) => {
  console.log("Constraint removed:", event.constraintId);
});

constraintManager.on("update", (event) => {
  console.log("Constraint updated:", event.constraint);
});

constraintManager.on("violation", (event) => {
  console.log("Constraint violated:", event.constraintId, event.error);
});

constraintManager.on("satisfied", (event) => {
  console.log("All constraints satisfied");
});
```

## Performance Considerations

- **Limit constraint count**: Keep under 100 constraints for real-time performance
- **Use appropriate strength**: Lower strength (0.3-0.7) allows faster convergence
- **Batch updates**: Use `constraintManager.batchUpdate()` for multiple changes
- **Disable during layout**: Temporarily disable constraints during major layout changes

```typescript
// Batch constraint updates
constraintManager.batchUpdate(() => {
  constraintManager.removeAll();
  selectedNodes.forEach((nodeId) => {
    constraintManager.addConstraint({
      type: ConstraintType.POSITION,
      nodeId,
      target: calculateGridPosition(nodeId),
      strength: 1.0,
    });
  });
});
```

## Persistence

Save and restore constraints:

```typescript
// Export constraints
const constraintData = constraintManager.export();
localStorage.setItem("graph-constraints", JSON.stringify(constraintData));

// Import constraints
const savedData = JSON.parse(localStorage.getItem("graph-constraints"));
constraintManager.import(savedData);
```

## See Also

- [Layouts](./layouts.md) - Layout algorithms
- [Interactions](./interactions.md) - User interaction handling
- [Performance](./performance.md) - Optimization guide
