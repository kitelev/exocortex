# Extension Points

This document describes how to extend and customize Graph View.

## Layout Plugins

### Plugin Interface

```typescript
interface LayoutPlugin {
  name: string;
  displayName: string;
  description?: string;
  category: LayoutCategory;
  graphTypes: GraphType[];
  factory: LayoutFactory;
  options: LayoutOptionDefinition[];
  validate?: (options: unknown) => ValidationResult;
}

type LayoutCategory =
  | "force"
  | "hierarchical"
  | "radial"
  | "temporal"
  | "geographic"
  | "custom";

type GraphType =
  | "general"
  | "tree"
  | "dag"
  | "cyclic"
  | "bipartite"
  | "complete";
```

### Creating a Layout Plugin

```typescript
import { createLayoutPlugin, BaseLayoutAlgorithm } from "@exocortex/obsidian-plugin";

class GridLayout extends BaseLayoutAlgorithm {
  compute(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
    const columns = this.options.columns || Math.ceil(Math.sqrt(nodes.length));
    const spacing = this.options.spacing || 100;

    return {
      nodes: nodes.map((node, i) => ({
        id: node.id,
        x: (i % columns) * spacing,
        y: Math.floor(i / columns) * spacing,
      })),
      edges,
    };
  }
}

const gridPlugin = createLayoutPlugin({
  name: "grid",
  displayName: "Grid Layout",
  description: "Arrange nodes in a regular grid",
  category: "custom",
  graphTypes: ["general"],
  factory: (options) => new GridLayout(options),
  options: [
    {
      name: "columns",
      type: "number",
      displayName: "Columns",
      default: 0,
      min: 0,
      description: "Number of columns (0 = auto)",
    },
    {
      name: "spacing",
      type: "number",
      displayName: "Spacing",
      default: 100,
      min: 10,
      max: 500,
    },
  ],
});
```

### Registering Plugins

```typescript
import { layoutPluginRegistry } from "@exocortex/obsidian-plugin";

// Register plugin
layoutPluginRegistry.register(gridPlugin);

// Use registered layout
const layout = layoutPluginRegistry.get("grid");
const result = layout.compute(nodes, edges);
```

## Custom Forces

### Force Interface

```typescript
interface Force<N extends SimulationNode = SimulationNode> {
  (alpha: number): void;
  initialize?(nodes: N[], random: () => number): void;
}
```

### Creating Custom Forces

```typescript
function forceAttractToCenter(cx: number, cy: number, strength: number = 0.1): Force {
  let nodes: SimulationNode[] = [];

  const force: Force = (alpha: number) => {
    for (const node of nodes) {
      if (node.fx != null) continue;

      const dx = cx - node.x;
      const dy = cy - node.y;

      node.vx += dx * strength * alpha;
      node.vy += dy * strength * alpha;
    }
  };

  force.initialize = (n: SimulationNode[]) => {
    nodes = n;
  };

  return force;
}

// Use custom force
simulation.force("attract", forceAttractToCenter(400, 300, 0.05));
```

### Configurable Forces

```typescript
function forceGroup(groupKey: string): Force & {
  strength: (s: number) => Force;
  distance: (d: number) => Force;
} {
  let nodes: SimulationNode[] = [];
  let _strength = 0.1;
  let _distance = 100;

  const force: Force = (alpha: number) => {
    // Group nodes by property
    const groups = new Map<string, SimulationNode[]>();
    for (const node of nodes) {
      const group = (node as any)[groupKey] || "default";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(node);
    }

    // Apply intra-group attraction
    for (const groupNodes of groups.values()) {
      const cx = groupNodes.reduce((sum, n) => sum + n.x, 0) / groupNodes.length;
      const cy = groupNodes.reduce((sum, n) => sum + n.y, 0) / groupNodes.length;

      for (const node of groupNodes) {
        if (node.fx != null) continue;

        const dx = cx - node.x;
        const dy = cy - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > _distance) {
          const f = _strength * alpha * (dist - _distance) / dist;
          node.vx += dx * f;
          node.vy += dy * f;
        }
      }
    }
  };

  force.initialize = (n) => { nodes = n; };

  const forceWithMethods = force as any;
  forceWithMethods.strength = (s: number) => { _strength = s; return forceWithMethods; };
  forceWithMethods.distance = (d: number) => { _distance = d; return forceWithMethods; };

  return forceWithMethods;
}

// Use configurable force
simulation.force("group", forceGroup("group").strength(0.2).distance(50));
```

## Custom Renderers

### Node Shape Renderer

```typescript
import { SHAPE_DRAWERS, Graphics } from "@exocortex/obsidian-plugin";

// Register custom shape
SHAPE_DRAWERS.cloud = (graphics: Graphics, x: number, y: number, radius: number) => {
  const r = radius * 0.6;

  // Draw cloud shape
  graphics.beginFill(0xffffff);
  graphics.drawCircle(x - r, y, r * 0.8);
  graphics.drawCircle(x + r, y, r * 0.8);
  graphics.drawCircle(x, y - r * 0.5, r);
  graphics.drawCircle(x - r * 0.5, y - r * 0.3, r * 0.7);
  graphics.drawCircle(x + r * 0.5, y - r * 0.3, r * 0.7);
  graphics.endFill();
};

// Use custom shape
nodeRenderer.renderNode({
  id: "node-1",
  x: 100,
  y: 100,
  radius: 20,
  shape: "cloud",
  style: { fill: 0x87ceeb },
});
```

### Custom Edge Renderer

```typescript
class WavyEdgeRenderer extends EdgeRenderer {
  protected drawCurve(
    graphics: Graphics,
    source: Position,
    target: Position,
    style: EdgeVisualStyle
  ): void {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const waves = Math.floor(length / 20);

    graphics.moveTo(source.x, source.y);

    for (let i = 1; i <= waves; i++) {
      const t = i / waves;
      const x = source.x + dx * t;
      const y = source.y + dy * t;
      const offset = Math.sin(t * Math.PI * 4) * 10;
      const perpX = -dy / length * offset;
      const perpY = dx / length * offset;

      graphics.lineTo(x + perpX, y + perpY);
    }

    graphics.lineTo(target.x, target.y);
  }
}
```

## Context Menu Providers

### Provider Interface

```typescript
interface ContextMenuProvider {
  id: string;
  priority?: number;
  getItems(target: ContextMenuTarget): ContextMenuItem[];
}
```

### Creating Providers

```typescript
const analysisMenuProvider: ContextMenuProvider = {
  id: "analysis",
  priority: 100,

  getItems(target) {
    if (target.type !== "node") return [];

    return [
      {
        id: "find-paths",
        label: "Find paths from here",
        icon: "route",
        action: () => pathFinding.setStartNode(target.id),
      },
      {
        id: "show-neighborhood",
        label: "Show neighborhood",
        icon: "network",
        submenu: [
          {
            id: "depth-1",
            label: "1 hop",
            action: () => showNeighborhood(target.id, 1),
          },
          {
            id: "depth-2",
            label: "2 hops",
            action: () => showNeighborhood(target.id, 2),
          },
          {
            id: "depth-3",
            label: "3 hops",
            action: () => showNeighborhood(target.id, 3),
          },
        ],
      },
      {
        id: "detect-community",
        label: "Detect community",
        icon: "users",
        action: () => detectCommunityFrom(target.id),
      },
    ];
  },
};

contextMenuManager.addProvider(analysisMenuProvider);
```

## Filter Plugins

### Filter Interface

```typescript
interface GraphFilter {
  id: string;
  type: "type" | "predicate" | "literal" | "path" | "sparql" | "composite";
  apply(nodes: GraphNode[], edges: GraphEdge[]): FilterResult;
}

interface FilterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodesRemoved: number;
    edgesRemoved: number;
  };
}
```

### Creating Custom Filters

```typescript
function createDateRangeFilter(options: {
  field: string;
  start?: Date;
  end?: Date;
}): GraphFilter {
  return {
    id: `date-range-${options.field}`,
    type: "literal",

    apply(nodes, edges) {
      const filtered = nodes.filter((node) => {
        const value = node.metadata?.[options.field];
        if (!value) return true;

        const date = new Date(value as string);
        if (options.start && date < options.start) return false;
        if (options.end && date > options.end) return false;
        return true;
      });

      const nodeIds = new Set(filtered.map((n) => n.id));
      const filteredEdges = edges.filter((e) => {
        const sourceId = typeof e.source === "string" ? e.source : e.source.id;
        const targetId = typeof e.target === "string" ? e.target : e.target.id;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });

      return {
        nodes: filtered,
        edges: filteredEdges,
        stats: {
          nodesRemoved: nodes.length - filtered.length,
          edgesRemoved: edges.length - filteredEdges.length,
        },
      };
    },
  };
}

filterManager.addFilter(createDateRangeFilter({
  field: "createdAt",
  start: new Date("2024-01-01"),
}));
```

## Data Adapters

### Triple Store Adapter

```typescript
interface TripleStoreAdapter {
  query(sparql: string): Promise<QueryResult>;
  getTriples(s?: string, p?: string, o?: string): Promise<Triple[]>;
}

class CustomTripleStore implements TripleStoreAdapter {
  constructor(private endpoint: string) {}

  async query(sparql: string): Promise<QueryResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query" },
      body: sparql,
    });
    return response.json();
  }

  async getTriples(s?: string, p?: string, o?: string): Promise<Triple[]> {
    const query = `SELECT ?s ?p ?o WHERE {
      ${s ? `BIND(<${s}> AS ?s)` : ""}
      ?s ?p ?o
      ${p ? `FILTER(?p = <${p}>)` : ""}
      ${o ? `FILTER(?o = <${o}>)` : ""}
    }`;
    const result = await this.query(query);
    return result.bindings.map((b) => ({
      subject: b.s.value,
      predicate: b.p.value,
      object: b.o.value,
    }));
  }
}
```

### File Content Provider

```typescript
interface FileContentProvider {
  getContent(path: string): Promise<string>;
  getMetadata(path: string): Promise<Record<string, unknown>>;
}

class ObsidianFileProvider implements FileContentProvider {
  constructor(private vault: Vault) {}

  async getContent(path: string): Promise<string> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return await this.vault.read(file);
    }
    throw new Error(`File not found: ${path}`);
  }

  async getMetadata(path: string): Promise<Record<string, unknown>> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const cache = this.vault.metadataCache.getFileCache(file);
      return cache?.frontmatter || {};
    }
    return {};
  }
}
```

## Event Interceptors

### Intercepting Events

```typescript
class EventInterceptor {
  private interceptors = new Map<string, Function[]>();

  intercept(event: string, handler: (event: any, next: () => void) => void): void {
    if (!this.interceptors.has(event)) {
      this.interceptors.set(event, []);
    }
    this.interceptors.get(event)!.push(handler);
  }

  emit(event: string, data: any): boolean {
    const handlers = this.interceptors.get(event) || [];
    let index = 0;
    let cancelled = false;

    const next = () => {
      if (index < handlers.length && !cancelled) {
        handlers[index++](data, next);
      }
    };

    next();
    return !cancelled;
  }
}

// Usage
const interceptor = new EventInterceptor();

// Add confirmation for delete
interceptor.intercept("delete", (event, next) => {
  if (confirm(`Delete ${event.nodeId}?`)) {
    next();
  }
});

// Add logging
interceptor.intercept("select", (event, next) => {
  console.log("Selection:", event.nodeIds);
  next();
});
```

## Theme Providers

### Theme Interface

```typescript
interface GraphTheme {
  name: string;
  colors: {
    background: number;
    node: Record<string, number>;
    edge: Record<string, number>;
    label: number;
    selection: number;
    hover: number;
  };
  styles: {
    node: NodeVisualStyle;
    edge: EdgeVisualStyle;
    label: LabelVisualStyle;
  };
}
```

### Creating Themes

```typescript
const darkTheme: GraphTheme = {
  name: "dark",
  colors: {
    background: 0x1a1a2e,
    node: {
      default: 0x64748b,
      project: 0x6366f1,
      area: 0x22c55e,
      task: 0xf59e0b,
    },
    edge: {
      default: 0x4a4a6a,
      dependency: 0xef4444,
    },
    label: 0xffffff,
    selection: 0x6366f1,
    hover: 0xffffff,
  },
  styles: {
    node: { fill: 0x64748b, stroke: 0xffffff, strokeWidth: 2, alpha: 1 },
    edge: { color: 0x4a4a6a, width: 2, alpha: 0.6 },
    label: { fontFamily: "Inter", fontSize: 12, fill: 0xffffff },
  },
};

themeManager.register(darkTheme);
themeManager.apply("dark");
```

## See Also

- [Architecture Overview](./overview.md) - System architecture
- [Domain Model](./domain-model.md) - Entity details
- [API Reference](../api/index.md) - TypeScript interfaces
