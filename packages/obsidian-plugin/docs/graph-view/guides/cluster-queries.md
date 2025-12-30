# SPARQL Cluster Queries

The Cluster Query system enables semantic grouping and visualization of graph nodes using SPARQL queries against the RDF triple store.

## Overview

The cluster system consists of two main components:

- **ClusterQueryExecutor**: Executes SPARQL queries to define cluster membership
- **ClusterRenderer**: Visualizes clusters with convex hulls, labels, and styling

## Basic Usage

```typescript
import { ClusterQueryExecutor, ClusterRenderer } from "./presentation/renderers/graph";

// Create executor with triple store access
const clusterExecutor = new ClusterQueryExecutor(tripleStore);

// Define clusters via SPARQL
const clusters = await clusterExecutor.execute(`
  SELECT ?cluster ?node WHERE {
    ?node rdf:type ?type .
    ?type rdfs:subClassOf* ?cluster .
    FILTER(?cluster IN (exo:Project, exo:Task, exo:Area))
  }
`);

// Render clusters
const clusterRenderer = new ClusterRenderer(graphRenderer);
clusterRenderer.setClusters(clusters);
clusterRenderer.render();
```

## Cluster Definition Queries

### Type-Based Clustering

Group nodes by their RDF type:

```sparql
# Cluster by direct type
SELECT ?cluster ?node WHERE {
  ?node rdf:type ?cluster .
  FILTER(?cluster IN (
    <https://exocortex.my/ontology/ems#Task>,
    <https://exocortex.my/ontology/ems#Project>,
    <https://exocortex.my/ontology/ems#Area>
  ))
}
```

### Property-Based Clustering

Group nodes by shared property values:

```sparql
# Cluster by status
SELECT ?cluster ?node WHERE {
  ?node ems:status ?cluster .
}

# Cluster by priority
SELECT ?cluster ?node WHERE {
  ?node exo:priority ?priority .
  BIND(
    IF(?priority > 7, "High Priority",
    IF(?priority > 3, "Medium Priority", "Low Priority"))
    AS ?cluster
  )
}
```

### Hierarchical Clustering

Group nodes by their position in a hierarchy:

```sparql
# Cluster by parent Area
SELECT ?cluster ?node WHERE {
  ?node ems:belongsTo+ ?cluster .
  ?cluster rdf:type ems:Area .
}

# Cluster by project membership
SELECT ?cluster ?node WHERE {
  ?node ems:project ?cluster .
  ?cluster rdf:type ems:Project .
}
```

### Temporal Clustering

Group nodes by time periods:

```sparql
# Cluster by creation month
SELECT ?cluster ?node WHERE {
  ?node dc:created ?date .
  BIND(CONCAT(STR(YEAR(?date)), "-", STR(MONTH(?date))) AS ?cluster)
}

# Cluster by date range
SELECT ?cluster ?node WHERE {
  ?node dc:created ?date .
  BIND(
    IF(?date >= "2024-01-01"^^xsd:date, "2024",
    IF(?date >= "2023-01-01"^^xsd:date, "2023", "Older"))
    AS ?cluster
  )
}
```

## Configuration Options

```typescript
interface ClusterConfig {
  /** Visual style for cluster backgrounds */
  style: {
    /** Fill color (supports per-cluster overrides) */
    fillColor: string | ((clusterId: string) => string);
    /** Fill opacity */
    fillOpacity: number;
    /** Border color */
    strokeColor: string;
    /** Border width */
    strokeWidth: number;
    /** Border dash pattern */
    strokeDash?: number[];
  };

  /** Label configuration */
  label: {
    /** Show cluster labels */
    show: boolean;
    /** Label position: 'top' | 'center' | 'bottom' */
    position: string;
    /** Font size */
    fontSize: number;
    /** Font family */
    fontFamily: string;
    /** Label color */
    color: string;
  };

  /** Hull calculation */
  hull: {
    /** Padding around cluster nodes */
    padding: number;
    /** Corner radius for rounded hulls */
    cornerRadius: number;
    /** Smoothing factor (0-1) */
    smoothing: number;
  };

  /** Interaction */
  interaction: {
    /** Enable cluster selection */
    selectable: boolean;
    /** Enable cluster collapse/expand */
    collapsible: boolean;
    /** Show tooltip on hover */
    showTooltip: boolean;
  };
}
```

## ClusterQueryExecutor API

```typescript
class ClusterQueryExecutor {
  constructor(tripleStore: ITripleStore);

  /** Execute a SPARQL query and return cluster assignments */
  execute(query: string): Promise<ClusterResult[]>;

  /** Execute with variable bindings */
  executeWithBindings(
    query: string,
    bindings: Record<string, string>
  ): Promise<ClusterResult[]>;

  /** Register a named cluster query */
  registerQuery(name: string, query: string): void;

  /** Execute a registered query by name */
  executeNamed(name: string, bindings?: Record<string, string>): Promise<ClusterResult[]>;

  /** Get all registered query names */
  getRegisteredQueries(): string[];

  /** Validate a SPARQL query without executing */
  validate(query: string): ValidationResult;
}

interface ClusterResult {
  clusterId: string;
  clusterLabel?: string;
  nodeIds: string[];
  metadata?: Record<string, unknown>;
}
```

## ClusterRenderer API

```typescript
class ClusterRenderer {
  constructor(graphRenderer: PixiGraphRenderer);

  /** Set clusters to render */
  setClusters(clusters: ClusterResult[]): void;

  /** Update cluster configuration */
  setConfig(config: Partial<ClusterConfig>): void;

  /** Render all clusters */
  render(): void;

  /** Highlight a specific cluster */
  highlightCluster(clusterId: string): void;

  /** Clear cluster highlighting */
  clearHighlight(): void;

  /** Collapse a cluster (show as single node) */
  collapseCluster(clusterId: string): void;

  /** Expand a collapsed cluster */
  expandCluster(clusterId: string): void;

  /** Get cluster at a point */
  getClusterAtPoint(x: number, y: number): ClusterResult | null;

  /** Destroy renderer and release resources */
  destroy(): void;
}
```

## Dynamic Clustering

Update clusters in response to graph changes:

```typescript
// Re-execute query when data changes
tripleStore.on("change", async () => {
  const clusters = await clusterExecutor.execute(clusterQuery);
  clusterRenderer.setClusters(clusters);
  clusterRenderer.render();
});

// Animate cluster transitions
clusterRenderer.setConfig({
  animation: {
    duration: 300,
    easing: "easeOutQuad",
  },
});
```

## Nested Clusters

Support hierarchical cluster visualization:

```typescript
// Define nested cluster query
const nestedQuery = `
  SELECT ?level1 ?level2 ?node WHERE {
    ?node ems:belongsTo ?level2 .
    ?level2 ems:belongsTo ?level1 .
  }
`;

const results = await clusterExecutor.execute(nestedQuery);

// Build hierarchy
const hierarchy = buildClusterHierarchy(results);

// Render with nesting
clusterRenderer.setClusters(hierarchy);
clusterRenderer.setConfig({
  nesting: {
    enabled: true,
    levelIndent: 20,
    showNestingLines: true,
  },
});
```

## Events

```typescript
// Cluster selection
clusterRenderer.on("select", (event) => {
  console.log("Selected cluster:", event.clusterId);
  console.log("Nodes in cluster:", event.nodeIds);
});

// Cluster hover
clusterRenderer.on("hover", (event) => {
  if (event.clusterId) {
    showTooltip(event.clusterId, event.position);
  } else {
    hideTooltip();
  }
});

// Cluster collapse/expand
clusterRenderer.on("collapse", (event) => {
  console.log("Collapsed:", event.clusterId);
});

clusterRenderer.on("expand", (event) => {
  console.log("Expanded:", event.clusterId);
});
```

## Performance Considerations

### Query Optimization

```typescript
// Use LIMIT for large result sets
const query = `
  SELECT ?cluster ?node WHERE {
    ?node rdf:type ?cluster .
  }
  LIMIT 10000
`;

// Cache cluster results
const clusterCache = new Map<string, ClusterResult[]>();

async function getClusters(queryName: string) {
  if (!clusterCache.has(queryName)) {
    const results = await clusterExecutor.executeNamed(queryName);
    clusterCache.set(queryName, results);
  }
  return clusterCache.get(queryName);
}
```

### Rendering Optimization

```typescript
// Disable hull animation for large clusters
clusterRenderer.setConfig({
  animation: {
    enabled: (cluster) => cluster.nodeIds.length < 100,
  },
});

// Simplify hulls for many clusters
clusterRenderer.setConfig({
  hull: {
    simplification: 0.5, // Reduce hull vertices
  },
});
```

## Integration with Layouts

Clusters can influence layout algorithms:

```typescript
// Use cluster-aware force simulation
const simulation = new ForceSimulation()
  .nodes(nodes)
  .force(
    "cluster",
    forceCluster()
      .clusters(clusters)
      .strength(0.5)
  );

// Hierarchical layout respecting clusters
const layout = new HierarchicalLayout({
  clusterGrouping: true,
  clusterSpacing: 100,
});
```

## Example: Complete Cluster Setup

```typescript
import {
  ClusterQueryExecutor,
  ClusterRenderer,
  PixiGraphRenderer,
} from "./presentation/renderers/graph";

// Setup
const graphRenderer = new PixiGraphRenderer(container);
const clusterExecutor = new ClusterQueryExecutor(tripleStore);
const clusterRenderer = new ClusterRenderer(graphRenderer);

// Register cluster queries
clusterExecutor.registerQuery(
  "byType",
  `
  SELECT ?cluster ?node WHERE {
    ?node rdf:type ?cluster .
    FILTER(?cluster IN (ems:Task, ems:Project, ems:Area))
  }
`
);

clusterExecutor.registerQuery(
  "byStatus",
  `
  SELECT ?cluster ?node WHERE {
    ?node ems:status ?cluster .
  }
`
);

// Configure renderer
clusterRenderer.setConfig({
  style: {
    fillColor: (clusterId) => getColorForCluster(clusterId),
    fillOpacity: 0.1,
    strokeWidth: 2,
  },
  label: {
    show: true,
    position: "top",
  },
  interaction: {
    selectable: true,
    collapsible: true,
  },
});

// Load and render
async function loadClusters(queryName: string) {
  const clusters = await clusterExecutor.executeNamed(queryName);
  clusterRenderer.setClusters(clusters);
  clusterRenderer.render();
}

// Initial load
loadClusters("byType");

// UI for switching cluster mode
document.getElementById("cluster-select").addEventListener("change", (e) => {
  loadClusters(e.target.value);
});
```

## See Also

- [Data Sources](./data-sources.md) - Triple store and SPARQL basics
- [Filtering](./filtering.md) - Node filtering
- [Layouts](./layouts.md) - Layout algorithms
- [Styling](./styling.md) - Visual customization
