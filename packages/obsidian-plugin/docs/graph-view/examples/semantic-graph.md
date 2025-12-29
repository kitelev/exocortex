# Semantic Graph Example

This example shows how to build a knowledge graph from RDF triples and SPARQL queries.

## Basic RDF Integration

```typescript
import {
  GraphLayoutRenderer,
  TripleStoreManager,
  buildGraphData,
} from "./presentation/renderers/graph";
import type { GraphNode, GraphEdge, Triple } from "./presentation/renderers/graph";

// 1. Create triple store
const tripleStore = new TripleStoreManager();

// 2. Add triples from frontmatter
const triples: Triple[] = [
  {
    subject: "obsidian://vault/projects/alpha.md",
    predicate: "ems:hasTask",
    object: "obsidian://vault/tasks/task1.md",
  },
  {
    subject: "obsidian://vault/projects/alpha.md",
    predicate: "ems:hasTask",
    object: "obsidian://vault/tasks/task2.md",
  },
  {
    subject: "obsidian://vault/tasks/task1.md",
    predicate: "rdf:type",
    object: "ems:Task",
  },
  {
    subject: "obsidian://vault/tasks/task1.md",
    predicate: "ems:status",
    object: "in-progress",
  },
  {
    subject: "obsidian://vault/areas/development.md",
    predicate: "ems:hasProject",
    object: "obsidian://vault/projects/alpha.md",
  },
];

for (const triple of triples) {
  tripleStore.add(triple);
}

// 3. Convert to graph data
function triplesToGraph(triples: Triple[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const triple of triples) {
    // Create subject node
    if (!nodeMap.has(triple.subject)) {
      nodeMap.set(triple.subject, {
        id: triple.subject,
        label: extractLabel(triple.subject),
        path: uriToPath(triple.subject),
      });
    }

    // If object is a resource, create node and edge
    if (triple.object.startsWith("obsidian://")) {
      if (!nodeMap.has(triple.object)) {
        nodeMap.set(triple.object, {
          id: triple.object,
          label: extractLabel(triple.object),
          path: uriToPath(triple.object),
        });
      }

      edges.push({
        id: `${triple.subject}-${triple.predicate}-${triple.object}`,
        source: triple.subject,
        target: triple.object,
        label: extractPredicateLabel(triple.predicate),
        property: triple.predicate,
      });
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

function extractLabel(uri: string): string {
  const match = uri.match(/\/([^\/]+)\.md$/);
  return match ? match[1].replace(/-/g, " ") : uri;
}

function uriToPath(uri: string): string {
  return uri.replace("obsidian://vault/", "");
}

function extractPredicateLabel(predicate: string): string {
  const match = predicate.match(/[:#](\w+)$/);
  return match ? match[1] : predicate;
}

// 4. Build and render
const graphData = triplesToGraph(triples);

function SemanticGraphView() {
  return (
    <GraphLayoutRenderer
      layout={{
        uid: "semantic-graph",
        label: "Knowledge Graph",
        nodeLabel: "label",
        edgeProperties: ["hasTask", "hasProject", "dependsOn"],
      }}
      nodes={graphData.nodes}
      edges={graphData.edges}
      options={{
        width: "100%",
        height: 600,
        chargeStrength: -400,
        linkDistance: 120,
        showLabels: true,
      }}
    />
  );
}
```

## SPARQL Query Integration

```typescript
import { SPARQLEngine, QueryExecutor } from "./presentation/renderers/graph";

class KnowledgeGraphBuilder {
  private engine: SPARQLEngine;

  constructor(tripleStore: TripleStoreManager) {
    this.engine = new SPARQLEngine(tripleStore);
  }

  async queryProjectGraph(projectUri: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const query = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

      SELECT ?task ?status ?dependency
      WHERE {
        <${projectUri}> ems:hasTask ?task .
        OPTIONAL { ?task ems:status ?status }
        OPTIONAL { ?task ems:dependsOn ?dependency }
      }
    `;

    const results = await this.engine.execute(query);
    return this.resultsToGraph(projectUri, results);
  }

  async queryAreaHierarchy(areaUri: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const query = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?project ?task
      WHERE {
        <${areaUri}> ems:hasProject ?project .
        OPTIONAL { ?project ems:hasTask ?task }
      }
    `;

    const results = await this.engine.execute(query);
    return this.hierarchyToGraph(areaUri, results);
  }

  private resultsToGraph(
    rootUri: string,
    results: QueryResult
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [
      { id: rootUri, label: extractLabel(rootUri), path: uriToPath(rootUri), group: "project" },
    ];
    const edges: GraphEdge[] = [];
    const seen = new Set<string>([rootUri]);

    for (const binding of results.bindings) {
      const taskUri = binding.task?.value;
      if (taskUri && !seen.has(taskUri)) {
        seen.add(taskUri);
        nodes.push({
          id: taskUri,
          label: extractLabel(taskUri),
          path: uriToPath(taskUri),
          group: "task",
          metadata: { status: binding.status?.value },
        });
        edges.push({
          id: `${rootUri}-hasTask-${taskUri}`,
          source: rootUri,
          target: taskUri,
          property: "hasTask",
        });
      }

      const depUri = binding.dependency?.value;
      if (depUri && taskUri) {
        edges.push({
          id: `${taskUri}-dependsOn-${depUri}`,
          source: taskUri,
          target: depUri,
          property: "dependsOn",
          style: { color: 0xef4444, width: 2, dashed: true },
        });
      }
    }

    return { nodes, edges };
  }

  private hierarchyToGraph(
    areaUri: string,
    results: QueryResult
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [
      { id: areaUri, label: extractLabel(areaUri), path: uriToPath(areaUri), group: "area" },
    ];
    const edges: GraphEdge[] = [];
    const seen = new Set<string>([areaUri]);

    for (const binding of results.bindings) {
      const projectUri = binding.project?.value;
      if (projectUri && !seen.has(projectUri)) {
        seen.add(projectUri);
        nodes.push({
          id: projectUri,
          label: extractLabel(projectUri),
          path: uriToPath(projectUri),
          group: "project",
        });
        edges.push({
          id: `${areaUri}-hasProject-${projectUri}`,
          source: areaUri,
          target: projectUri,
          property: "hasProject",
        });
      }

      const taskUri = binding.task?.value;
      if (taskUri && projectUri && !seen.has(taskUri)) {
        seen.add(taskUri);
        nodes.push({
          id: taskUri,
          label: extractLabel(taskUri),
          path: uriToPath(taskUri),
          group: "task",
        });
        edges.push({
          id: `${projectUri}-hasTask-${taskUri}`,
          source: projectUri,
          target: taskUri,
          property: "hasTask",
        });
      }
    }

    return { nodes, edges };
  }
}
```

## Ontology-Driven Visualization

```typescript
import { OntologyManager, InferenceEngine } from "./presentation/renderers/graph";

interface OntologyConfig {
  classes: Record<string, ClassConfig>;
  properties: Record<string, PropertyConfig>;
}

interface ClassConfig {
  color: number;
  shape: string;
  size: number;
}

interface PropertyConfig {
  color: number;
  style: "solid" | "dashed" | "dotted";
  directed: boolean;
}

const exocortexOntology: OntologyConfig = {
  classes: {
    "ems:Area": { color: 0x22c55e, shape: "hexagon", size: 24 },
    "ems:Project": { color: 0x6366f1, shape: "circle", size: 20 },
    "ems:Task": { color: 0xf59e0b, shape: "circle", size: 16 },
    "ems:Resource": { color: 0x64748b, shape: "diamond", size: 14 },
  },
  properties: {
    "ems:hasProject": { color: 0x22c55e, style: "solid", directed: true },
    "ems:hasTask": { color: 0x6366f1, style: "solid", directed: true },
    "ems:dependsOn": { color: 0xef4444, style: "dashed", directed: true },
    "ems:references": { color: 0x64748b, style: "dotted", directed: false },
  },
};

function applyOntologyStyles(
  nodes: GraphNode[],
  edges: GraphEdge[],
  ontology: OntologyConfig
): void {
  // Apply node styles based on type
  for (const node of nodes) {
    const type = node.metadata?.type as string;
    const config = ontology.classes[type];
    if (config) {
      node.style = {
        fill: config.color,
        shape: config.shape,
        radius: config.size,
      };
    }
  }

  // Apply edge styles based on property
  for (const edge of edges) {
    const property = edge.property as string;
    const config = ontology.properties[property];
    if (config) {
      edge.style = {
        color: config.color,
        width: 2,
        dashed: config.style === "dashed",
        dotted: config.style === "dotted",
        arrow: config.directed ? "end" : "none",
      };
    }
  }
}

// Usage
const graphBuilder = new KnowledgeGraphBuilder(tripleStore);
const { nodes, edges } = await graphBuilder.queryAreaHierarchy(areaUri);
applyOntologyStyles(nodes, edges, exocortexOntology);
```

## Inference and Reasoning

```typescript
import { InferenceEngine, TransitiveClosureReasoner } from "./presentation/renderers/graph";

class SemanticGraphEnricher {
  private reasoner: TransitiveClosureReasoner;

  constructor(tripleStore: TripleStoreManager) {
    this.reasoner = new TransitiveClosureReasoner(tripleStore);
  }

  async enrichWithInferences(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const enrichedEdges = [...edges];

    // Compute transitive closure for dependency chains
    const dependsOnClosure = await this.reasoner.computeClosure("ems:dependsOn");

    for (const [source, targets] of dependsOnClosure) {
      for (const target of targets) {
        // Check if this is an inferred edge (not in original)
        const isOriginal = edges.some(
          (e) => e.source === source && e.target === target && e.property === "dependsOn"
        );

        if (!isOriginal) {
          enrichedEdges.push({
            id: `inferred-${source}-dependsOn-${target}`,
            source,
            target,
            property: "dependsOn",
            label: "depends on (inferred)",
            style: {
              color: 0xfca5a5, // Lighter red for inferred
              width: 1,
              dashed: true,
              alpha: 0.5,
            },
            metadata: { inferred: true },
          });
        }
      }
    }

    return { nodes, edges: enrichedEdges };
  }

  async detectCycles(): Promise<string[][]> {
    const query = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?a ?b ?c
      WHERE {
        ?a ems:dependsOn ?b .
        ?b ems:dependsOn ?c .
        ?c ems:dependsOn ?a .
      }
    `;

    const results = await this.reasoner.engine.execute(query);
    // Convert to cycles
    return results.bindings.map((b) => [b.a.value, b.b.value, b.c.value]);
  }
}
```

## Path Finding

```typescript
import { PathFinder, ShortestPathAlgorithm } from "./presentation/renderers/graph";

class SemanticPathFinder {
  private pathFinder: PathFinder;

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    this.pathFinder = new PathFinder(nodes, edges);
  }

  findShortestPath(startId: string, endId: string): string[] {
    return this.pathFinder.dijkstra(startId, endId);
  }

  findAllPaths(startId: string, endId: string, maxDepth: number = 5): string[][] {
    return this.pathFinder.allPaths(startId, endId, maxDepth);
  }

  findRelatedNodes(nodeId: string, hops: number = 2): Set<string> {
    return this.pathFinder.neighborhood(nodeId, hops);
  }

  highlightPath(path: string[], nodes: GraphNode[], edges: GraphEdge[]): void {
    const pathSet = new Set(path);

    // Highlight nodes on path
    for (const node of nodes) {
      if (pathSet.has(node.id)) {
        node.style = { ...node.style, stroke: 0xfbbf24, strokeWidth: 4 };
      } else {
        node.style = { ...node.style, alpha: 0.3 };
      }
    }

    // Highlight edges on path
    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      const sourceIdx = path.indexOf(sourceId);
      const targetIdx = path.indexOf(targetId);

      if (sourceIdx >= 0 && targetIdx === sourceIdx + 1) {
        edge.style = { ...edge.style, color: 0xfbbf24, width: 4 };
      } else {
        edge.style = { ...edge.style, alpha: 0.2 };
      }
    }
  }
}
```

## Complete Semantic Graph Application

```typescript
import React, { useState, useEffect, useCallback } from "react";
import {
  GraphLayoutRenderer,
  TripleStoreManager,
  HierarchicalLayout,
} from "./presentation/renderers/graph";

function SemanticKnowledgeGraph({ vault }: { vault: Vault }) {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null);

  // Initialize triple store from vault
  useEffect(() => {
    async function loadGraph() {
      setLoading(true);

      const tripleStore = new TripleStoreManager();

      // Load triples from all markdown files
      const files = vault.getMarkdownFiles();
      for (const file of files) {
        const metadata = vault.metadataCache.getFileCache(file);
        if (metadata?.frontmatter) {
          const triples = extractTriples(file.path, metadata.frontmatter);
          for (const triple of triples) {
            tripleStore.add(triple);
          }
        }
      }

      // Query for visualization
      const builder = new KnowledgeGraphBuilder(tripleStore);
      const areas = await builder.queryAllAreas();
      const data = await builder.queryFullGraph();

      // Apply ontology styles
      applyOntologyStyles(data.nodes, data.edges, exocortexOntology);

      setGraphData(data);
      setLoading(false);
    }

    loadGraph();
  }, [vault]);

  const handleNodeClick = useCallback((nodeId: string, path: string) => {
    const file = vault.getAbstractFileByPath(path);
    if (file) {
      vault.workspace.getLeaf().openFile(file as TFile);
    }
  }, [vault]);

  const handleFindPath = useCallback((startId: string, endId: string) => {
    const pathFinder = new SemanticPathFinder(graphData.nodes, graphData.edges);
    const path = pathFinder.findShortestPath(startId, endId);
    setSelectedPath(path);
  }, [graphData]);

  if (loading) {
    return <div className="graph-loading">Loading knowledge graph...</div>;
  }

  return (
    <div className="semantic-graph-container">
      <GraphLayoutRenderer
        layout={{
          uid: "semantic-knowledge",
          label: "Knowledge Graph",
          nodeLabel: "label",
          edgeProperties: ["hasProject", "hasTask", "dependsOn", "references"],
        }}
        nodes={graphData.nodes}
        edges={graphData.edges}
        onNodeClick={handleNodeClick}
        options={{
          width: "100%",
          height: "100%",
          layout: "hierarchical",
          hierarchicalDirection: "TB",
          showLabels: true,
          zoomable: true,
          draggable: true,
          layoutOptions: {
            algorithm: "hierarchical",
            direction: "TB",
            levelSeparation: 100,
            nodeSeparation: 60,
          },
        }}
      />

      {selectedPath && (
        <div className="path-overlay">
          <h4>Path</h4>
          <ol>
            {selectedPath.map((nodeId) => (
              <li key={nodeId}>{extractLabel(nodeId)}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
```

## See Also

- [Data Sources Guide](../guides/data-sources.md) - Triple store integration
- [Layouts Guide](../guides/layouts.md) - Hierarchical layouts for ontologies
- [API Reference](../api/index.md) - Full API documentation
