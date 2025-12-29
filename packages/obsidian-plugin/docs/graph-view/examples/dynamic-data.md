# Dynamic Data Example

This example shows how to handle real-time data updates in Graph View.

## Live Data Updates

```typescript
import {
  ForceSimulation,
  forceCenter,
  forceManyBody,
  forceLink,
} from "./presentation/renderers/graph";
import type { GraphNode, GraphEdge, SimulationNode } from "./presentation/renderers/graph";

class DynamicGraphManager {
  private nodes: SimulationNode[] = [];
  private edges: GraphEdge[] = [];
  private simulation: ForceSimulation<SimulationNode>;
  private nodeIdCounter = 0;
  private edgeIdCounter = 0;

  constructor(
    private width: number,
    private height: number,
    private onUpdate: () => void
  ) {
    this.simulation = new ForceSimulation<SimulationNode>()
      .force("center", forceCenter(width / 2, height / 2))
      .force("charge", forceManyBody().strength(-200))
      .on("tick", onUpdate);
  }

  // Add a single node
  addNode(data: Omit<GraphNode, "id">): string {
    const id = `node-${++this.nodeIdCounter}`;
    const node: SimulationNode = {
      ...data,
      id,
      index: this.nodes.length,
      x: this.width / 2 + (Math.random() - 0.5) * 100,
      y: this.height / 2 + (Math.random() - 0.5) * 100,
      vx: 0,
      vy: 0,
      mass: 1,
      radius: 12,
    };

    this.nodes.push(node);
    this.updateSimulation();

    return id;
  }

  // Add multiple nodes efficiently
  addNodes(dataArray: Omit<GraphNode, "id">[]): string[] {
    const ids: string[] = [];

    for (const data of dataArray) {
      const id = `node-${++this.nodeIdCounter}`;
      const node: SimulationNode = {
        ...data,
        id,
        index: this.nodes.length,
        x: this.width / 2 + (Math.random() - 0.5) * 200,
        y: this.height / 2 + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
        mass: 1,
        radius: 12,
      };
      this.nodes.push(node);
      ids.push(id);
    }

    this.updateSimulation();
    return ids;
  }

  // Remove a node
  removeNode(id: string): void {
    const index = this.nodes.findIndex((n) => n.id === id);
    if (index === -1) return;

    this.nodes.splice(index, 1);

    // Remove connected edges
    this.edges = this.edges.filter((e) => {
      const sourceId = typeof e.source === "string" ? e.source : e.source.id;
      const targetId = typeof e.target === "string" ? e.target : e.target.id;
      return sourceId !== id && targetId !== id;
    });

    // Re-index remaining nodes
    this.nodes.forEach((n, i) => {
      n.index = i;
    });

    this.updateSimulation();
  }

  // Add an edge
  addEdge(source: string, target: string, property?: string): string {
    const id = `edge-${++this.edgeIdCounter}`;
    this.edges.push({ id, source, target, property });
    this.updateSimulation();
    return id;
  }

  // Remove an edge
  removeEdge(id: string): void {
    const index = this.edges.findIndex((e) => e.id === id);
    if (index !== -1) {
      this.edges.splice(index, 1);
      this.updateSimulation();
    }
  }

  // Update node properties
  updateNode(id: string, updates: Partial<GraphNode>): void {
    const node = this.nodes.find((n) => n.id === id);
    if (node) {
      Object.assign(node, updates);
      this.onUpdate();
    }
  }

  // Update simulation with new data
  private updateSimulation(): void {
    this.simulation
      .nodes(this.nodes)
      .force(
        "link",
        forceLink(this.edges)
          .id((d) => d.id)
          .distance(100)
      );

    // Reheat simulation
    this.simulation.alpha(0.3).restart();
  }

  // Get current data
  getNodes(): SimulationNode[] {
    return this.nodes;
  }

  getEdges(): GraphEdge[] {
    return this.edges;
  }

  // Cleanup
  destroy(): void {
    this.simulation.stop();
  }
}
```

## React Hook for Dynamic Data

```tsx
import { useState, useEffect, useCallback } from "react";
import type { GraphNode, GraphEdge } from "./presentation/renderers/graph";

interface GraphDataState {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function useDynamicGraph(dataSource: DataSource) {
  const [data, setData] = useState<GraphDataState>({ nodes: [], edges: [] });
  const [isLoading, setIsLoading] = useState(true);

  // Initial load
  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true);
      const initialData = await dataSource.fetchAll();
      setData(initialData);
      setIsLoading(false);
    }
    loadInitialData();
  }, [dataSource]);

  // Subscribe to real-time updates
  useEffect(() => {
    const unsubscribe = dataSource.subscribe((update) => {
      setData((prev) => {
        switch (update.type) {
          case "nodeAdded":
            return {
              ...prev,
              nodes: [...prev.nodes, update.node],
            };

          case "nodeRemoved":
            return {
              ...prev,
              nodes: prev.nodes.filter((n) => n.id !== update.nodeId),
              edges: prev.edges.filter((e) => {
                const sId = typeof e.source === "string" ? e.source : e.source.id;
                const tId = typeof e.target === "string" ? e.target : e.target.id;
                return sId !== update.nodeId && tId !== update.nodeId;
              }),
            };

          case "nodeUpdated":
            return {
              ...prev,
              nodes: prev.nodes.map((n) =>
                n.id === update.node.id ? { ...n, ...update.node } : n
              ),
            };

          case "edgeAdded":
            return {
              ...prev,
              edges: [...prev.edges, update.edge],
            };

          case "edgeRemoved":
            return {
              ...prev,
              edges: prev.edges.filter((e) => e.id !== update.edgeId),
            };

          default:
            return prev;
        }
      });
    });

    return unsubscribe;
  }, [dataSource]);

  // Mutation functions
  const addNode = useCallback(
    async (nodeData: Omit<GraphNode, "id">) => {
      const node = await dataSource.createNode(nodeData);
      return node.id;
    },
    [dataSource]
  );

  const removeNode = useCallback(
    async (nodeId: string) => {
      await dataSource.deleteNode(nodeId);
    },
    [dataSource]
  );

  const addEdge = useCallback(
    async (source: string, target: string) => {
      const edge = await dataSource.createEdge(source, target);
      return edge.id;
    },
    [dataSource]
  );

  return {
    nodes: data.nodes,
    edges: data.edges,
    isLoading,
    addNode,
    removeNode,
    addEdge,
  };
}
```

## WebSocket Integration

```typescript
class WebSocketGraphSync {
  private ws: WebSocket;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(
    private url: string,
    private onUpdate: (update: DataUpdate) => void
  ) {
    this.connect();
  }

  private connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("Connected to graph sync server");
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      this.onUpdate(update);
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  send(action: string, data: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, data }));
    }
  }

  disconnect(): void {
    this.ws.close();
  }
}

// Usage
const sync = new WebSocketGraphSync("wss://api.example.com/graph", (update) => {
  graphManager.handleUpdate(update);
});
```

## Obsidian Vault Sync

```typescript
import { Plugin, TFile, Events } from "obsidian";

class VaultGraphSync extends Events {
  private debounceTimer: number | null = null;

  constructor(private plugin: Plugin) {
    super();
    this.setupWatchers();
  }

  private setupWatchers(): void {
    // File created
    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.debounceUpdate("nodeAdded", { file });
        }
      })
    );

    // File deleted
    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.trigger("nodeRemoved", { nodeId: file.path });
        }
      })
    );

    // File modified
    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.debounceUpdate("nodeUpdated", { file });
        }
      })
    );

    // File renamed
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.trigger("nodeRenamed", { file, oldPath });
        }
      })
    );

    // Metadata changed
    this.plugin.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file) => {
        this.debounceUpdate("metadataChanged", { file });
      })
    );
  }

  private debounceUpdate(event: string, data: unknown): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.trigger(event, data);
      this.debounceTimer = null;
    }, 200);
  }
}
```

## Complete Dynamic Graph Component

```tsx
import React, { useState, useEffect, useCallback } from "react";
import { GraphLayoutRenderer } from "./presentation/renderers/graph";

const DynamicGraphView: React.FC<{ dataSource: DataSource }> = ({ dataSource }) => {
  const { nodes, edges, isLoading, addNode, removeNode } = useDynamicGraph(dataSource);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);

  const handleAddNode = async () => {
    const id = await addNode({
      label: `Node ${nodes.length + 1}`,
      path: `nodes/node-${nodes.length + 1}.md`,
      group: "default",
    });
    console.log(`Added node: ${id}`);
  };

  const handleDeleteSelected = async () => {
    for (const nodeId of selectedNodes) {
      await removeNode(nodeId);
    }
    setSelectedNodes([]);
  };

  if (isLoading) {
    return <div className="loading">Loading graph...</div>;
  }

  return (
    <div className="dynamic-graph-container">
      <div className="toolbar">
        <button onClick={handleAddNode}>Add Node</button>
        <button onClick={handleDeleteSelected} disabled={selectedNodes.length === 0}>
          Delete Selected ({selectedNodes.length})
        </button>
      </div>

      <GraphLayoutRenderer
        layout={{ uid: "dynamic", label: "Dynamic Graph" }}
        nodes={nodes}
        edges={edges}
        onNodeClick={(nodeId) => {
          setSelectedNodes((prev) =>
            prev.includes(nodeId)
              ? prev.filter((id) => id !== nodeId)
              : [...prev, nodeId]
          );
        }}
        options={{
          width: "100%",
          height: 600,
          chargeStrength: -200,
        }}
      />

      <div className="status-bar">
        Nodes: {nodes.length} | Edges: {edges.length}
      </div>
    </div>
  );
};
```

## See Also

- [Basic Graph](./basic-graph.md) - Simple static example
- [Large Scale](./large-scale.md) - Performance optimization
- [Data Sources Guide](../guides/data-sources.md)
