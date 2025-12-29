# Graph View Documentation

> High-performance, WebGL2-accelerated graph visualization for knowledge graphs

The Graph View module provides a comprehensive solution for rendering force-directed and hierarchical graph visualizations within the Exocortex Obsidian plugin. It is designed to handle large-scale knowledge graphs (100K+ nodes) with smooth 60fps rendering.

## Key Features

- **High Performance**: WebGL2 rendering via PixiJS with WebGPU physics acceleration
- **Barnes-Hut Algorithm**: O(n log n) force calculations for large graphs
- **Multiple Layouts**: Force-directed, hierarchical, radial, temporal, and community detection
- **Rich Interactions**: Pan, zoom, drag, selection, context menus, keyboard navigation
- **Filtering & Search**: Type filters, predicate filters, text search with highlighting
- **Type-Based Coloring**: Automatic colors with palettes, legends, and accessibility options
- **Path Finding**: BFS, Dijkstra, and bidirectional algorithms for discovering connections
- **WCAG 2.1 AA Accessibility**: Screen reader support, keyboard navigation, high contrast
- **Semantic Integration**: SPARQL queries, RDF/triple store, ontology-driven visualization
- **Export**: PNG, JPEG, WebP, and SVG export with customizable bounds

## Quick Start

```typescript
import {
  GraphLayoutRenderer,
  buildGraphData,
  ForceSimulation,
} from "./presentation/renderers/graph";

// Build graph from table data
const graphData = buildGraphData(tableRows, "label", ["links", "references"]);

// Create force simulation
const simulation = new ForceSimulation()
  .nodes(graphData.nodes)
  .force("center", forceCenter(width / 2, height / 2))
  .force("charge", forceManyBody().strength(-300))
  .force("link", forceLink(graphData.edges).distance(100));

// Start simulation
simulation.on("tick", () => renderer.render());
simulation.start();
```

## Documentation Structure

### Getting Started
- [Installation](./getting-started/installation.md) - Package setup and dependencies
- [Basic Usage](./getting-started/basic-usage.md) - Minimal working example
- [Obsidian Integration](./getting-started/obsidian-integration.md) - Plugin-specific setup
- [Configuration](./getting-started/configuration.md) - Full configuration reference

### Guides
- [Data Sources](./guides/data-sources.md) - Triple store, SPARQL, static data
- [Layouts](./guides/layouts.md) - Force, hierarchical, radial, temporal layouts
- [Filtering](./guides/filtering.md) - Filter nodes by type, property, and relationships
- [Search](./guides/search.md) - Find and highlight nodes, type-based coloring
- [Styling](./guides/styling.md) - Node/edge customization
- [Interactions](./guides/interactions.md) - Selection, drag, zoom, context menus
- [Performance](./guides/performance.md) - Large graph optimization
- [Edge Bundling](./guides/edge-bundling.md) - Reduce visual clutter in dense graphs
- [Export](./guides/export.md) - PNG, JPEG, WebP, SVG export
- [Accessibility](./guides/accessibility.md) - WCAG compliance and screen readers
- [Path Finding](./guides/path-finding.md) - Find paths between nodes
- [Migration](./guides/migration.md) - Version upgrade guide

### API Reference
- [Overview](./api/index.md) - API overview and module structure
- [GraphLayoutRenderer](./api/graph-view.md) - Main component API
- [ForceSimulation](./api/physics-engine.md) - Physics simulation API
- [LayoutManager](./api/layout-engine.md) - Layout algorithms API
- [PixiGraphRenderer](./api/renderer.md) - WebGL2 renderer API
- [ExportManager](./api/export-manager.md) - Image export API
- [Events](./api/events.md) - Event system reference

### Examples
- [Basic Graph](./examples/basic-graph.md) - Simple static graph
- [Dynamic Data](./examples/dynamic-data.md) - Real-time updates
- [Custom Layout](./examples/custom-layout.md) - Custom layout implementation
- [Semantic Graph](./examples/semantic-graph.md) - RDF/SPARQL integration
- [Large Scale](./examples/large-scale.md) - 100K+ node optimization
- [Export](./examples/export.md) - Image export examples

### Architecture
- [Overview](./architecture/overview.md) - High-level architecture
- [Domain Model](./architecture/domain-model.md) - Core entities
- [Data Flow](./architecture/data-flow.md) - State flow diagram
- [Extension Points](./architecture/extension-points.md) - Plugin architecture

## Performance Characteristics

| Graph Size | Render FPS | Layout Time | Memory |
|------------|-----------|-------------|--------|
| 1K nodes   | 60fps     | <100ms      | ~50MB  |
| 10K nodes  | 60fps     | ~500ms      | ~200MB |
| 50K nodes  | 30-60fps  | ~2s         | ~500MB |
| 100K nodes | 30fps     | ~5s         | ~1GB   |

## Requirements

- **Obsidian**: 1.4.0+
- **Browser**: WebGL2 support (all modern browsers)
- **Optional**: WebGPU for accelerated physics (Chrome 113+, Edge 113+)

## License

MIT License - see [LICENSE](../../../../LICENSE) for details.
