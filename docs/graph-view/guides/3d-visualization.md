# 3D Graph Visualization Guide

Complete guide to using the 3D graph visualization mode in Exocortex.

## Overview

The 3D visualization module renders your knowledge graph in a three-dimensional space using WebGL2 and Three.js. This provides:

- **Immersive exploration** — Navigate through your knowledge in 3D space
- **Better spatial relationships** — See complex connections without edge overlap
- **Force-directed layout** — Nodes automatically arrange based on relationships
- **Theme-aware coloring** — Nodes colored by ontology namespace

## Getting Started

### Enabling 3D Mode

1. Open Graph View via `Ctrl/Cmd + Shift + G` or Command Palette → "Open Graph View"
2. Click the **3D** toggle button in the toolbar (top-right)
3. The view transitions from 2D canvas to 3D WebGL rendering

### Basic Navigation

| Action | Mouse | Touch | Keyboard |
|--------|-------|-------|----------|
| **Orbit/Rotate** | Left-click + drag | One finger drag | Arrow keys |
| **Pan** | Right-click + drag | Two finger drag | Shift + arrows |
| **Zoom** | Scroll wheel | Pinch gesture | +/- keys |
| **Select Node** | Click | Tap | — |
| **Fit to View** | Double-click background | Double-tap | F key |
| **Reset Camera** | — | — | R key |

### Node Interaction

- **Single click**: Select node, opens file in new pane
- **Hover**: Highlights node and connected edges
- **Long press** (mobile): Same as click

## Visual Features

### Ontology-Based Node Coloring

Nodes are automatically colored based on their ontology namespace:

| Namespace | Color (Dark) | Color (Light) | Usage |
|-----------|--------------|---------------|-------|
| `exo#` | Blue (#4A90E2) | Blue (#2563EB) | Exocortex core types |
| `ems#` | Green (#7ED321) | Green (#16A34A) | Tasks, Projects, Areas |
| `ims#` | Purple (#9B59B6) | Purple (#7C3AED) | Concepts, Notes |
| `rdf#` | Orange (#F5A623) | Orange (#D97706) | RDF vocabulary |
| `owl#` | Red (#E74C3C) | Red (#DC2626) | OWL vocabulary |
| Unknown | Gray (#95A5A6) | Gray (#6B7280) | Custom namespaces |

### Edge Coloring by Predicate

Edges are colored based on relationship type:

| Predicate | Color | Description |
|-----------|-------|-------------|
| `rdf:type` | Orange | Class membership |
| `rdfs:subClassOf` | Purple | Class hierarchy |
| `owl:sameAs` | Blue | Identity |
| Default | Slate gray | All other predicates |

### Labels

Node labels display asset labels with:
- **Billboard behavior**: Labels always face the camera
- **Distance-based fading**: Labels fade out at distance for performance
- **Theme-aware styling**: Text/background adapt to dark/light mode

## Force-Directed Layout

The 3D layout uses force simulation with these forces:

### Force Types

1. **Center Force** — Pulls nodes toward center
2. **Charge Force** — Repels nodes from each other
3. **Link Force** — Attracts connected nodes
4. **Collision Force** — Prevents node overlap

### Layout Behavior

The simulation runs automatically when:
- Graph data is loaded
- Nodes are added/removed
- User triggers manual restart

Simulation stops when forces stabilize (alpha < 0.01).

### Pinning Nodes

You can pin nodes to fixed positions:
- Hold `Shift` + drag to pin a node
- Pinned nodes won't move during simulation
- Useful for creating custom layouts

## Performance Optimization

### Performance Targets

| Graph Size | Target FPS | Enabled Optimizations |
|------------|------------|----------------------|
| < 100 nodes | 60 FPS | None required |
| 100-500 nodes | 30+ FPS | LOD for labels |
| 500-1000 nodes | 30+ FPS | LOD + Frustum culling |
| > 1000 nodes | 20+ FPS | All optimizations |

### Level of Detail (LOD)

LOD automatically:
- Fades label opacity based on camera distance
- Hides labels for distant nodes (saves GPU draw calls)
- Configurable fade distances

Default LOD settings:
```typescript
{
  labelFadeStart: 150,    // Start fading at 150 units
  labelFadeEnd: 250,      // Fully hidden at 250 units
  labelMinOpacity: 0      // Minimum opacity (fully transparent)
}
```

### Frustum Culling

Frustum culling automatically:
- Hides nodes outside camera view
- Hides edges connected to culled nodes
- Reduces GPU workload for large graphs

### WebGL Context Recovery

The system automatically recovers from WebGL context loss:
- Re-creates all GPU resources (materials, textures)
- Maximum 3 recovery attempts
- Shows recovery message in UI

### Performance Tips

1. **Large graphs (1000+ nodes)**: Enable frustum culling
2. **Mobile devices**: Reduce pixel ratio, enable all optimizations
3. **Complex scenes**: Hide labels (`L` key) when navigating
4. **Slow machines**: Reduce node detail segments

## Configuration

See **[Configuration Reference](./configuration.md)** for all available options.

### Quick Configuration Examples

#### High Performance Mode
```typescript
{
  config: {
    antialias: false,
    pixelRatio: 1
  },
  performanceConfig: {
    lod: { enabled: true },
    frustumCulling: { enabled: true }
  }
}
```

#### High Quality Mode
```typescript
{
  config: {
    antialias: true,
    pixelRatio: 2
  },
  nodeStyle: {
    segments: 32  // Smoother spheres
  }
}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `L` | Toggle labels visibility |
| `A` | Toggle auto-rotate |
| `F` | Fit all nodes in view |
| `R` | Reset camera position |
| `+` / `-` | Zoom in/out |
| Arrow keys | Orbit camera |
| `Shift` + arrows | Pan camera |

## Touch Gestures (Mobile/Tablet)

| Gesture | Action |
|---------|--------|
| One finger drag | Orbit camera |
| Two finger drag | Pan camera |
| Pinch | Zoom |
| Tap | Select node |
| Double-tap | Fit to view |
| Long press | Select node (alternative) |

## Theming

The 3D view automatically adapts to Obsidian's theme:

### Dark Mode
- Background: `#1E1E1E`
- Labels: Light text on semi-transparent dark background
- Fog: Matches background for depth fade

### Light Mode
- Background: `#F5F5F5`
- Labels: Dark text on semi-transparent light background
- Fog: Matches background

Theme changes are detected automatically via MutationObserver.

## Troubleshooting

### Black Screen / No Rendering

1. **Check WebGL2 support**: Visit [get.webgl.org](https://get.webgl.org) to verify
2. **Update graphics drivers**: WebGL2 requires modern drivers
3. **Try disabling hardware acceleration**: If using integrated graphics

### Low FPS / Stuttering

1. Enable all performance optimizations (LOD + frustum culling)
2. Reduce pixel ratio to 1
3. Disable anti-aliasing
4. Hide labels when navigating

### Labels Not Visible

1. Check LOD settings — labels may be faded at current distance
2. Press `L` to toggle labels on
3. Zoom closer to nodes

### Context Loss (WebGL crash)

This happens when GPU resources are exhausted:
1. Reduce graph size (filter nodes)
2. Lower quality settings
3. Close other GPU-intensive applications

## API Reference

For programmatic access to 3D visualization:

### Scene3DManager

Main class for 3D scene management:

```typescript
import { Scene3DManager } from '@exocortex/obsidian-plugin';

const manager = new Scene3DManager({
  backgroundColor: 0x1a1a2e,
  antialias: true
});

manager.initialize(containerElement);
manager.setNodes(nodes);
manager.setEdges(edges, nodes);

// Event handling
manager.on('nodeClick', (event) => {
  console.log('Clicked:', event.node.label);
});

// Cleanup
manager.destroy();
```

### ForceSimulation3D

Force-directed layout in 3D:

```typescript
import { ForceSimulation3D } from '@exocortex/obsidian-plugin';

const simulation = new ForceSimulation3D(nodes, edges, {
  chargeStrength: -300,
  linkDistance: 100
});

simulation.on('tick', (event) => {
  manager.updatePositions(event.nodes, edges);
});

simulation.start();
```

See **[Configuration Reference](./configuration.md)** for complete API documentation.
