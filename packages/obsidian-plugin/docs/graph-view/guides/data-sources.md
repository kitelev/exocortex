# Data Sources

This guide covers different ways to load and manage graph data.

## Static Data

The simplest approach is providing graph data directly:

```typescript
import type { GraphNode, GraphEdge } from "@exocortex/obsidian-plugin";

const nodes: GraphNode[] = [
  { id: "1", label: "Project Alpha", path: "projects/alpha.md", group: "project" },
  { id: "2", label: "Task 1", path: "tasks/task1.md", group: "task" },
  { id: "3", label: "Task 2", path: "tasks/task2.md", group: "task" },
];

const edges: GraphEdge[] = [
  { id: "e1", source: "1", target: "2", property: "hasTask" },
  { id: "e2", source: "1", target: "3", property: "hasTask" },
  { id: "e3", source: "2", target: "3", property: "dependsOn" },
];
```

## Building from Table Rows

Convert tabular data (e.g., from Obsidian frontmatter) to graph format:

```typescript
import { buildGraphData, rowsToNodes, extractEdges } from "@exocortex/obsidian-plugin";
import type { TableRow, GraphData } from "@exocortex/obsidian-plugin";

// Table rows from Obsidian query
const tableRows: TableRow[] = [
  {
    id: "note-1",
    path: "projects/alpha.md",
    values: {
      title: "Project Alpha",
      status: "active",
      tasks: ["[[tasks/task1.md|Task 1]]", "[[tasks/task2.md|Task 2]]"],
      tags: ["project", "priority-high"],
    },
    metadata: { created: "2024-01-15" },
  },
  // ... more rows
];

// Option 1: Full automatic conversion
const graphData: GraphData = buildGraphData(
  tableRows,
  "title",               // Column for node labels
  ["tasks", "references"] // Properties to extract edges from
);

// Option 2: Manual node/edge creation
const nodes = rowsToNodes(tableRows, "title");
const edges = extractEdges(tableRows, ["tasks", "references"]);
```

## Triple Store Integration

For semantic graph data, integrate with a triple store:

```typescript
import { GraphTooltipDataProvider } from "@exocortex/obsidian-plugin";
import type { TripleStore, Triple } from "@exocortex/obsidian-plugin";

// Implement triple store adapter
class MyTripleStore implements TripleStore {
  async query(sparql: string): Promise<Triple[]> {
    // Execute SPARQL query
    const results = await this.executeSparql(sparql);
    return results.map((row) => ({
      subject: row.s.value,
      predicate: row.p.value,
      object: row.o.value,
    }));
  }

  async getTriples(subject?: string, predicate?: string, object?: string): Promise<Triple[]> {
    let query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o";
    const filters: string[] = [];

    if (subject) filters.push(`FILTER(?s = <${subject}>)`);
    if (predicate) filters.push(`FILTER(?p = <${predicate}>)`);
    if (object) filters.push(`FILTER(?o = <${object}>)`);

    query += filters.join(" ") + " }";
    return this.query(query);
  }
}

// Create data provider
const dataProvider = new GraphTooltipDataProvider({
  tripleStore: new MyTripleStore(),
  cacheTimeout: 5000,
});
```

## SPARQL Queries

Execute SPARQL queries to build graph data:

```typescript
import { ClusterQueryExecutor } from "@exocortex/obsidian-plugin";
import type { ClusterQueryResult, TripleStoreAdapter } from "@exocortex/obsidian-plugin";

// Create query executor
const executor = new ClusterQueryExecutor({
  tripleStore: myTripleStoreAdapter,
  defaultPrefixes: {
    exo: "https://exocortex.my/ontology/exo#",
    ems: "https://exocortex.my/ontology/ems#",
  },
});

// Execute query
const query = `
  SELECT ?project ?task ?status
  WHERE {
    ?project a ems:Project .
    ?project ems:hasTask ?task .
    ?task ems:status ?status .
  }
`;

const result: ClusterQueryResult = await executor.execute(query);

// Convert to graph data
const nodes: GraphNode[] = [];
const edges: GraphEdge[] = [];
const seenNodes = new Set<string>();

for (const row of result.bindings) {
  // Add project node
  if (!seenNodes.has(row.project)) {
    nodes.push({
      id: row.project,
      label: extractLabel(row.project),
      path: uriToPath(row.project),
      group: "project",
    });
    seenNodes.add(row.project);
  }

  // Add task node
  if (!seenNodes.has(row.task)) {
    nodes.push({
      id: row.task,
      label: extractLabel(row.task),
      path: uriToPath(row.task),
      group: "task",
      metadata: { status: row.status },
    });
    seenNodes.add(row.task);
  }

  // Add edge
  edges.push({
    id: `${row.project}-${row.task}`,
    source: row.project,
    target: row.task,
    property: "ems:hasTask",
  });
}
```

## Obsidian Vault Adapter

Load graph data from Obsidian vault:

```typescript
import { App, TFile, CachedMetadata } from "obsidian";

class VaultGraphAdapter {
  constructor(private app: App) {}

  async loadGraph(folder?: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const pathToId = new Map<string, string>();

    // Get all markdown files
    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => !folder || f.path.startsWith(folder)
    );

    // Create nodes
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const id = file.path;

      nodes.push({
        id,
        label: cache?.frontmatter?.title || file.basename,
        path: file.path,
        group: this.inferGroup(file, cache),
        metadata: {
          tags: cache?.tags?.map((t) => t.tag) || [],
          ...cache?.frontmatter,
        },
      });

      pathToId.set(file.path, id);
    }

    // Create edges from links
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.links) continue;

      for (const link of cache.links) {
        const targetFile = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
        if (!targetFile || !pathToId.has(targetFile.path)) continue;

        edges.push({
          id: `${file.path}→${targetFile.path}`,
          source: file.path,
          target: targetFile.path,
          label: link.displayText,
          property: "wiki-link",
        });
      }

      // Create edges from frontmatter references
      const fm = cache?.frontmatter;
      if (fm) {
        for (const [key, value] of Object.entries(fm)) {
          if (typeof value === "string" && value.startsWith("[[")) {
            const target = this.extractWikilink(value);
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
            if (targetFile && pathToId.has(targetFile.path)) {
              edges.push({
                id: `${file.path}→${targetFile.path}:${key}`,
                source: file.path,
                target: targetFile.path,
                property: key,
              });
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  private inferGroup(file: TFile, cache: CachedMetadata | null): string {
    // Check frontmatter type
    if (cache?.frontmatter?.type) {
      return cache.frontmatter.type;
    }
    // Check folder
    const folder = file.parent?.name;
    if (folder === "projects") return "project";
    if (folder === "areas") return "area";
    if (folder === "tasks") return "task";
    return "note";
  }

  private extractWikilink(text: string): string {
    const match = text.match(/\[\[([^\]|]+)/);
    return match ? match[1] : text;
  }
}
```

## Real-time Updates

Watch for data changes and update the graph:

```typescript
class GraphDataManager {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private listeners = new Set<() => void>();

  constructor(private dataSource: DataSource) {}

  async initialize(): Promise<void> {
    const data = await this.dataSource.load();
    this.nodes = data.nodes;
    this.edges = data.edges;

    // Watch for changes
    this.dataSource.on("change", this.handleChange.bind(this));
  }

  private handleChange(change: DataChange): void {
    switch (change.type) {
      case "nodeAdded":
        this.nodes.push(change.node);
        break;
      case "nodeRemoved":
        this.nodes = this.nodes.filter((n) => n.id !== change.nodeId);
        this.edges = this.edges.filter(
          (e) => e.source !== change.nodeId && e.target !== change.nodeId
        );
        break;
      case "nodeUpdated":
        const nodeIndex = this.nodes.findIndex((n) => n.id === change.node.id);
        if (nodeIndex >= 0) {
          this.nodes[nodeIndex] = { ...this.nodes[nodeIndex], ...change.node };
        }
        break;
      case "edgeAdded":
        this.edges.push(change.edge);
        break;
      case "edgeRemoved":
        this.edges = this.edges.filter((e) => e.id !== change.edgeId);
        break;
    }

    this.notifyListeners();
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach((callback) => callback());
  }

  getNodes(): GraphNode[] {
    return this.nodes;
  }

  getEdges(): GraphEdge[] {
    return this.edges;
  }
}

// Usage with React
function GraphWithRealTimeData() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);

  useEffect(() => {
    const manager = new GraphDataManager(dataSource);
    manager.initialize();

    const unsubscribe = manager.subscribe(() => {
      setNodes([...manager.getNodes()]);
      setEdges([...manager.getEdges()]);
    });

    setNodes(manager.getNodes());
    setEdges(manager.getEdges());

    return unsubscribe;
  }, [dataSource]);

  return <GraphLayoutRenderer nodes={nodes} edges={edges} />;
}
```

## Data Filtering

Filter graph data before rendering:

```typescript
import { FilterManager, createTypeFilter, createPredicateFilter } from "@exocortex/obsidian-plugin";

const filterManager = new FilterManager();

// Add filters
filterManager.addFilter(
  createTypeFilter({
    id: "projects-only",
    types: ["project", "area"],
    mode: "include",
  })
);

filterManager.addFilter(
  createPredicateFilter({
    id: "direct-relations",
    predicates: ["hasTask", "belongsTo"],
    mode: "include",
  })
);

// Apply filters
const filteredNodes = filterManager.filterNodes(nodes);
const filteredEdges = filterManager.filterEdges(edges, filteredNodes);
```

## Data Transformation

Transform data for specific visualizations:

```typescript
// Add computed properties
function enrichNodes(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const connectionCount = new Map<string, number>();

  for (const edge of edges) {
    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
    connectionCount.set(sourceId, (connectionCount.get(sourceId) || 0) + 1);
    connectionCount.set(targetId, (connectionCount.get(targetId) || 0) + 1);
  }

  return nodes.map((node) => ({
    ...node,
    size: Math.max(1, Math.log(connectionCount.get(node.id) || 1)),
    metadata: {
      ...node.metadata,
      connectionCount: connectionCount.get(node.id) || 0,
    },
  }));
}

// Group nodes by property
function groupByProperty(nodes: GraphNode[], property: string): Map<string, GraphNode[]> {
  const groups = new Map<string, GraphNode[]>();

  for (const node of nodes) {
    const value = node.metadata?.[property] as string || "default";
    if (!groups.has(value)) {
      groups.set(value, []);
    }
    groups.get(value)!.push(node);
  }

  return groups;
}
```

## See Also

- [Configuration](../getting-started/configuration.md) - Data source configuration
- [SPARQL Documentation](../../../../core/docs/SPARQL.md) - SPARQL query guide
- [Performance](./performance.md) - Handling large datasets
