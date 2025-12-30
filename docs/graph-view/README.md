# Graph View Documentation

Interactive visualization of your knowledge graph with support for both 2D and 3D rendering.

## Overview

The Graph View module provides:
- **2D Graph Visualization** — Fast, canvas-based rendering for exploring relationships
- **3D Graph Visualization** — WebGL-powered immersive 3D exploration using Three.js
- **Force-Directed Layouts** — Automatic node positioning based on relationships
- **Semantic Coloring** — Nodes and edges colored by ontology namespace
- **Interactive Navigation** — Zoom, pan, rotate, and click-to-open nodes

## Quick Start

### Enabling 3D Mode

The 3D visualization is available in the Graph View panel:

1. Open Graph View via `Ctrl/Cmd + Shift + G` or Command Palette
2. Click the **3D** toggle button in the toolbar
3. Use mouse/touch to orbit, pan, and zoom

### Navigation Controls

| Action | Mouse | Touch |
|--------|-------|-------|
| Orbit/Rotate | Left-click + drag | One finger drag |
| Pan | Right-click + drag | Two finger drag |
| Zoom | Scroll wheel | Pinch |
| Select Node | Click | Tap |
| Fit to View | Double-click background | Double-tap |

## Documentation

### User Guides
- **[3D Visualization Guide](./guides/3d-visualization.md)** — Complete guide to 3D mode
- **[Inference & Reasoning](./guides/inference.md)** — RDFS/OWL inference in graph view

### Configuration
- **[Configuration Reference](./guides/configuration.md)** — All configuration options for 2D and 3D modes

### Examples
- **[3D Graph Examples](./examples/3d-graph.md)** — Common use cases and code snippets

## Architecture

```
graph-view/
├── 2d/                    # 2D Canvas-based rendering
│   ├── ForceSimulation2D  # D3-style force layout
│   └── CanvasRenderer     # HTML5 Canvas rendering
│
├── 3d/                    # 3D WebGL rendering (Three.js)
│   ├── Scene3DManager     # WebGL scene, camera, controls
│   ├── ForceSimulation3D  # 3D force-directed layout
│   ├── Graph3DThemeService    # Theme-aware coloring
│   ├── Graph3DPerformanceManager  # LOD, frustum culling
│   └── TouchGestureManager    # Mobile touch support
│
├── search/                # Search functionality
└── GraphViewPanel         # Main UI container
```

## Performance

### 3D Mode Performance Targets

| Graph Size | Target FPS | Optimizations Enabled |
|------------|------------|----------------------|
| < 100 nodes | 60 FPS | None required |
| 100-500 nodes | 30+ FPS | LOD for labels |
| 500-1000 nodes | 30+ FPS | LOD + Frustum culling |
| > 1000 nodes | 20+ FPS | All optimizations |

See **[3D Visualization Guide](./guides/3d-visualization.md#performance-optimization)** for tuning options.

## Related Documentation

- **[SPARQL Query Examples](../sparql/Query-Examples.md)** — Query patterns for graph exploration
- **[Core API](../api/Core-API.md)** — Programmatic graph access
