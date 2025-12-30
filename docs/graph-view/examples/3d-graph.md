# 3D Graph Examples

Practical examples for using the 3D graph visualization module.

## Basic Usage

### Creating a 3D Scene

```typescript
import {
  Scene3DManager,
  ForceSimulation3D,
  createScene3DManager,
  createForceSimulation3D
} from '@exocortex/obsidian-plugin';

// Create and initialize the scene
const sceneManager = createScene3DManager();
sceneManager.initialize(document.getElementById('graph-container'));

// Prepare graph data
const nodes = [
  { id: '1', label: 'Project A', path: '/projects/a.md' },
  { id: '2', label: 'Task 1', path: '/tasks/1.md' },
  { id: '3', label: 'Task 2', path: '/tasks/2.md' },
  { id: '4', label: 'Concept X', path: '/concepts/x.md' }
];

const edges = [
  { id: 'e1', source: '1', target: '2', label: 'contains' },
  { id: 'e2', source: '1', target: '3', label: 'contains' },
  { id: 'e3', source: '2', target: '4', label: 'relates' }
];

// Set up force simulation
const simulation = createForceSimulation3D(nodes, edges);

// Connect simulation to scene
simulation.on('tick', (event) => {
  sceneManager.updatePositions(event.nodes, edges);
});

// Render initial graph
sceneManager.setNodes(nodes);
sceneManager.setEdges(edges, nodes);

// Start simulation
simulation.start();
```

### Handling Node Clicks

```typescript
sceneManager.on('nodeClick', (event) => {
  console.log('Clicked node:', event.node.label);
  console.log('File path:', event.node.path);
  console.log('3D position:', event.worldPosition);

  // Open the file in Obsidian
  app.workspace.openLinkText(event.node.path, '', false);
});

sceneManager.on('nodeHover', (event) => {
  console.log('Hovering:', event.node.label);
  // Show tooltip, highlight connected edges, etc.
});

sceneManager.on('nodeHoverEnd', (event) => {
  console.log('Stopped hovering:', event.node.label);
  // Hide tooltip, remove highlights
});
```

## Custom Node Coloring

### Color by Ontology Namespace

```typescript
import { Graph3DThemeService } from '@exocortex/obsidian-plugin';

const themeService = new Graph3DThemeService();

// Color nodes based on their ontology
const coloredNodes = nodes.map(node => ({
  ...node,
  color: themeService.getNodeColorFromUri(node.metadata?.rdfType ?? '')
}));

sceneManager.setNodes(coloredNodes);
```

### Color by Custom Property

```typescript
// Color nodes by status
const statusColors = {
  'todo': '#F5A623',     // Orange
  'doing': '#4A90E2',    // Blue
  'done': '#7ED321',     // Green
  'blocked': '#E74C3C'   // Red
};

const coloredNodes = nodes.map(node => ({
  ...node,
  color: statusColors[node.metadata?.status] ?? '#95A5A6'
}));

sceneManager.setNodes(coloredNodes);
```

### Dynamic Color Updates

```typescript
// Update all node colors based on a function
sceneManager.updateAllNodeColors((node) => {
  const age = calculateAge(node.metadata?.createdAt);
  // Newer nodes are brighter blue, older nodes fade to gray
  const brightness = Math.max(0.3, 1 - age / 365);
  return colorLerp(0x4A90E2, 0x95A5A6, 1 - brightness);
});

// Update single node color
sceneManager.updateNodeColor('node-123', 0xFF0000);
```

## Camera Control

### Programmatic Camera Movement

```typescript
// Move camera to specific position
sceneManager.setCameraPosition(
  { x: 100, y: 50, z: 300 },  // Camera position
  { x: 0, y: 0, z: 0 }        // Look-at target
);

// Fit all nodes in view
sceneManager.fitToView(nodes, 1.5); // 1.5 = padding factor

// Reset camera with animation
sceneManager.resetCamera(500); // 500ms animation

// Enable auto-rotate
sceneManager.setAutoRotate(true, 1.0); // speed = 1.0
```

### Save and Restore Camera State

```typescript
// Save current view
const savedViewport = sceneManager.getViewport();

// Later, restore the view
sceneManager.setCameraPosition(
  savedViewport.cameraPosition,
  savedViewport.cameraTarget
);
```

## Performance Optimization

### Large Graph Optimization

```typescript
// For graphs with 500+ nodes
const sceneManager = createScene3DManager(
  // Scene config
  {
    antialias: false,
    pixelRatio: 1,
    enableFog: true
  },
  // Node style - lower detail
  {
    segments: 8
  },
  // Edge style
  {},
  // Label style
  {},
  // Controls config
  {},
  // Performance config
  {
    lod: {
      enabled: true,
      labelFadeStart: 100,
      labelFadeEnd: 150
    },
    frustumCulling: {
      enabled: true,
      updateInterval: 1
    }
  }
);
```

### Toggle Performance Features

```typescript
// Enable/disable LOD dynamically
sceneManager.setLODEnabled(true);

// Enable/disable frustum culling
sceneManager.setFrustumCullingEnabled(true);

// Check current state
console.log('LOD enabled:', sceneManager.getLODEnabled());
console.log('Culling enabled:', sceneManager.getFrustumCullingEnabled());
```

### Monitor Performance

```typescript
// Get renderer stats
const stats = sceneManager.getStats();
console.log('FPS:', stats.fps);
console.log('Visible nodes:', stats.nodeCount);
console.log('Draw calls:', stats.drawCalls);
console.log('Triangles:', stats.triangles);

// Get detailed performance stats
const perfStats = sceneManager.getPerformanceStats();
console.log('Culled nodes:', perfStats?.culledNodes);
console.log('Culling efficiency:', perfStats?.cullingEfficiency + '%');
```

## Force Simulation Control

### Custom Force Parameters

```typescript
const simulation = createForceSimulation3D(nodes, edges, {
  chargeStrength: -500,    // Stronger repulsion
  linkDistance: 150,       // Longer edge length
  centerStrength: 0.05,    // Weaker center pull
  collisionRadius: 2.0,    // Larger collision detection
  velocityDecay: 0.3       // Less damping = more movement
});
```

### Control Simulation Lifecycle

```typescript
// Start with custom alpha
simulation.start(0.5);

// Pause simulation
simulation.stop();

// Resume simulation
simulation.restart(0.3);

// Check if running
console.log('Running:', simulation.isRunning());

// Get current alpha (energy level)
console.log('Alpha:', simulation.getAlpha());
```

### Pin Nodes to Fixed Positions

```typescript
// Pin a node at specific position
simulation.pinNode('node-1', { x: 0, y: 0, z: 0 });

// Unpin a node
simulation.unpinNode('node-1');

// Check if node is pinned
const isPinned = simulation.isNodePinned('node-1');
```

## Theme Integration

### Listen for Theme Changes

```typescript
import { Graph3DThemeService } from '@exocortex/obsidian-plugin';

const themeService = new Graph3DThemeService();

themeService.on('themeChange', (event) => {
  console.log('Theme changed to:', event.mode);

  // Update scene colors
  const colors = event.colors;
  sceneManager.setBackgroundColor(parseInt(colors.background.slice(1), 16));
  sceneManager.setFogColor(parseInt(colors.fogColor.slice(1), 16));
  sceneManager.setLabelStyle(colors.labelColor, colors.labelBackground);

  // Update node colors
  sceneManager.updateAllNodeColors((node) => {
    const namespace = themeService.getNamespaceFromUri(node.metadata?.rdfType);
    return parseInt(colors.nodeColors[namespace].slice(1), 16);
  });
});
```

### Manual Theme Detection

```typescript
const themeService = new Graph3DThemeService();

// Get current theme mode
const mode = themeService.getThemeMode(); // 'dark' or 'light'

// Get theme colors
const colors = themeService.getThemeColors();
console.log('Background:', colors.background);
console.log('Node colors:', colors.nodeColors);
```

## Event Handling

### All Available Events

```typescript
// Node events
sceneManager.on('nodeClick', (e) => { /* ... */ });
sceneManager.on('nodeHover', (e) => { /* ... */ });
sceneManager.on('nodeHoverEnd', (e) => { /* ... */ });

// Edge events
sceneManager.on('edgeClick', (e) => { /* ... */ });
sceneManager.on('edgeHover', (e) => { /* ... */ });
sceneManager.on('edgeHoverEnd', (e) => { /* ... */ });

// Background events
sceneManager.on('backgroundClick', (e) => { /* ... */ });

// Camera events
sceneManager.on('cameraChange', (e) => {
  console.log('Camera moved to:', e.worldPosition);
});

// Render events (every frame)
sceneManager.on('render', () => {
  // Called every frame - use sparingly!
});

// Simulation events
simulation.on('tick', (e) => {
  console.log('Alpha:', e.alpha);
  console.log('Node positions updated');
});

simulation.on('end', (e) => {
  console.log('Simulation converged at alpha:', e.alpha);
});
```

### Remove Event Listeners

```typescript
const handler = (event) => { /* ... */ };

// Add listener
sceneManager.on('nodeClick', handler);

// Remove listener
sceneManager.off('nodeClick', handler);
```

## Cleanup

### Proper Resource Disposal

```typescript
// Stop simulation first
simulation.stop();

// Destroy scene manager (releases all GPU resources)
sceneManager.destroy();

// Destroy theme service
themeService.destroy();
```

## Integration with Obsidian

### Opening Files from Nodes

```typescript
sceneManager.on('nodeClick', async (event) => {
  const file = app.vault.getAbstractFileByPath(event.node.path);
  if (file instanceof TFile) {
    await app.workspace.openLinkText(event.node.path, '', false);
  }
});
```

### Building Graph from Vault

```typescript
import { SparqlService } from '@exocortex/obsidian-plugin';

// Query all assets and relationships
const sparqlService = new SparqlService(vaultAdapter);
const results = await sparqlService.query(`
  SELECT ?asset ?label ?relatedAsset ?relatedLabel ?predicate
  WHERE {
    ?asset exo:Asset_label ?label .
    OPTIONAL {
      ?asset ?predicate ?relatedAsset .
      ?relatedAsset exo:Asset_label ?relatedLabel .
      FILTER(?predicate != exo:Asset_label)
    }
  }
`);

// Convert to graph data
const nodes = new Map();
const edges = [];

for (const binding of results) {
  // Add nodes
  if (!nodes.has(binding.asset.value)) {
    nodes.set(binding.asset.value, {
      id: binding.asset.value,
      label: binding.label.value,
      path: uriToPath(binding.asset.value)
    });
  }

  // Add edges
  if (binding.relatedAsset) {
    edges.push({
      id: `${binding.asset.value}-${binding.predicate.value}-${binding.relatedAsset.value}`,
      source: binding.asset.value,
      target: binding.relatedAsset.value,
      label: binding.predicate.value.split('#').pop()
    });
  }
}

// Render graph
sceneManager.setNodes([...nodes.values()]);
sceneManager.setEdges(edges, [...nodes.values()]);
```
