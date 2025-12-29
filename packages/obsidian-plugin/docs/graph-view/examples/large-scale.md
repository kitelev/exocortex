# Large-Scale Graph Example

This example demonstrates techniques for visualizing graphs with 10,000 to 100,000+ nodes while maintaining interactive performance.

## Performance Architecture

```typescript
import {
  GraphLayoutRenderer,
  LODManager,
  VisibilityCuller,
  ObjectPool,
  BatchedNodeRenderer,
  QuadTree,
  WebGPUAccelerator,
} from "./presentation/renderers/graph";
import type { GraphNode, GraphEdge, LODLevel } from "./presentation/renderers/graph";

// Performance configuration for large graphs
const largeGraphConfig = {
  // Level of Detail thresholds
  lod: {
    high: { minZoom: 0.8, maxNodes: 500 },
    medium: { minZoom: 0.3, maxNodes: 2000 },
    low: { minZoom: 0.1, maxNodes: 10000 },
    minimal: { minZoom: 0, maxNodes: Infinity },
  },

  // Rendering optimizations
  rendering: {
    useBatching: true,
    batchSize: 1000,
    useInstancing: true,
    maxVisibleNodes: 5000,
    cullMargin: 100,
  },

  // Physics optimizations
  physics: {
    useBarnesHut: true,
    theta: 0.9, // Higher = faster, less accurate
    useWebGPU: true,
    maxIterations: 100,
  },

  // Memory management
  memory: {
    poolSize: 10000,
    gcThreshold: 0.8,
    textureAtlasSize: 4096,
  },
};
```

## Chunked Data Loading

```typescript
class ChunkedGraphLoader {
  private chunkSize = 1000;
  private loadedChunks = new Set<number>();

  constructor(
    private dataSource: GraphDataSource,
    private onChunkLoaded: (nodes: GraphNode[], edges: GraphEdge[]) => void
  ) {}

  async loadInitialChunk(): Promise<void> {
    const { nodes, edges } = await this.dataSource.getChunk(0, this.chunkSize);
    this.loadedChunks.add(0);
    this.onChunkLoaded(nodes, edges);
  }

  async loadChunksInViewport(viewport: Viewport): Promise<void> {
    const visibleChunks = this.calculateVisibleChunks(viewport);

    for (const chunkId of visibleChunks) {
      if (!this.loadedChunks.has(chunkId)) {
        const { nodes, edges } = await this.dataSource.getChunk(
          chunkId * this.chunkSize,
          this.chunkSize
        );
        this.loadedChunks.add(chunkId);
        this.onChunkLoaded(nodes, edges);
      }
    }
  }

  private calculateVisibleChunks(viewport: Viewport): number[] {
    // Spatial indexing to determine which chunks are visible
    const chunks: number[] = [];
    const worldBounds = viewport.getWorldBounds();

    // Iterate spatial grid
    for (let x = worldBounds.left; x < worldBounds.right; x += this.chunkSize) {
      for (let y = worldBounds.top; y < worldBounds.bottom; y += this.chunkSize) {
        const chunkId = this.getChunkId(x, y);
        if (!chunks.includes(chunkId)) {
          chunks.push(chunkId);
        }
      }
    }

    return chunks;
  }

  private getChunkId(x: number, y: number): number {
    const chunkX = Math.floor(x / (this.chunkSize * 10));
    const chunkY = Math.floor(y / (this.chunkSize * 10));
    return chunkX * 1000 + chunkY;
  }
}
```

## Visibility Culling

```typescript
class ViewportCuller {
  private quadTree: QuadTree<GraphNode>;
  private visibleNodes = new Set<string>();

  constructor(nodes: GraphNode[]) {
    this.quadTree = new QuadTree<GraphNode>(
      { x: -10000, y: -10000, width: 20000, height: 20000 },
      10 // max items per node
    );

    for (const node of nodes) {
      this.quadTree.insert(node, { x: node.x!, y: node.y! });
    }
  }

  updateVisibleNodes(viewport: Viewport, margin: number = 100): GraphNode[] {
    const bounds = viewport.getWorldBounds();
    const expandedBounds = {
      x: bounds.left - margin,
      y: bounds.top - margin,
      width: bounds.right - bounds.left + margin * 2,
      height: bounds.bottom - bounds.top + margin * 2,
    };

    const visible = this.quadTree.query(expandedBounds);
    this.visibleNodes = new Set(visible.map((n) => n.id));

    return visible;
  }

  isVisible(nodeId: string): boolean {
    return this.visibleNodes.has(nodeId);
  }

  getVisibleEdges(edges: GraphEdge[]): GraphEdge[] {
    return edges.filter((edge) => {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      return this.visibleNodes.has(sourceId) || this.visibleNodes.has(targetId);
    });
  }
}
```

## Level of Detail (LOD)

```typescript
interface LODConfig {
  level: "high" | "medium" | "low" | "minimal";
  nodeRadius: number;
  showLabels: boolean;
  showEdges: boolean;
  edgeWidth: number;
  useShapes: boolean;
  useColors: boolean;
}

class LODController {
  private configs: Record<string, LODConfig> = {
    high: {
      level: "high",
      nodeRadius: 12,
      showLabels: true,
      showEdges: true,
      edgeWidth: 2,
      useShapes: true,
      useColors: true,
    },
    medium: {
      level: "medium",
      nodeRadius: 8,
      showLabels: false,
      showEdges: true,
      edgeWidth: 1,
      useShapes: true,
      useColors: true,
    },
    low: {
      level: "low",
      nodeRadius: 4,
      showLabels: false,
      showEdges: true,
      edgeWidth: 0.5,
      useShapes: false,
      useColors: true,
    },
    minimal: {
      level: "minimal",
      nodeRadius: 2,
      showLabels: false,
      showEdges: false,
      edgeWidth: 0,
      useShapes: false,
      useColors: false,
    },
  };

  getCurrentLOD(zoom: number, visibleNodes: number): LODConfig {
    if (zoom >= 0.8 && visibleNodes <= 500) {
      return this.configs.high;
    } else if (zoom >= 0.3 && visibleNodes <= 2000) {
      return this.configs.medium;
    } else if (zoom >= 0.1 && visibleNodes <= 10000) {
      return this.configs.low;
    } else {
      return this.configs.minimal;
    }
  }

  applyLOD(
    nodeRenderer: NodeRenderer,
    edgeRenderer: EdgeRenderer,
    labelRenderer: LabelRenderer,
    config: LODConfig
  ): void {
    nodeRenderer.setDefaultRadius(config.nodeRadius);
    nodeRenderer.setUseShapes(config.useShapes);
    nodeRenderer.setUseColors(config.useColors);

    edgeRenderer.setVisible(config.showEdges);
    edgeRenderer.setDefaultWidth(config.edgeWidth);

    labelRenderer.setVisible(config.showLabels);
  }
}
```

## Batched Rendering

```typescript
class BatchedGraphRenderer {
  private nodePool: ObjectPool<PIXI.Graphics>;
  private edgePool: ObjectPool<PIXI.Graphics>;
  private batchSize = 1000;

  constructor(app: PIXI.Application) {
    this.nodePool = new ObjectPool(
      () => new PIXI.Graphics(),
      (g) => g.clear(),
      10000
    );
    this.edgePool = new ObjectPool(
      () => new PIXI.Graphics(),
      (g) => g.clear(),
      20000
    );
  }

  renderNodes(nodes: GraphNode[], config: LODConfig): void {
    // Process in batches to avoid frame drops
    for (let i = 0; i < nodes.length; i += this.batchSize) {
      requestAnimationFrame(() => {
        const batch = nodes.slice(i, i + this.batchSize);
        this.renderNodeBatch(batch, config);
      });
    }
  }

  private renderNodeBatch(nodes: GraphNode[], config: LODConfig): void {
    for (const node of nodes) {
      const graphics = this.nodePool.acquire();

      if (config.useColors) {
        graphics.beginFill(node.style?.fill || 0x6366f1);
      } else {
        graphics.beginFill(0x808080);
      }

      if (config.useShapes && node.style?.shape === "diamond") {
        this.drawDiamond(graphics, node.x!, node.y!, config.nodeRadius);
      } else {
        graphics.drawCircle(node.x!, node.y!, config.nodeRadius);
      }

      graphics.endFill();
    }
  }

  private drawDiamond(g: PIXI.Graphics, x: number, y: number, size: number): void {
    g.moveTo(x, y - size);
    g.lineTo(x + size, y);
    g.lineTo(x, y + size);
    g.lineTo(x - size, y);
    g.closePath();
  }

  releaseAll(): void {
    this.nodePool.releaseAll();
    this.edgePool.releaseAll();
  }
}
```

## WebGPU Acceleration

```typescript
class WebGPUForceSimulation {
  private device: GPUDevice | null = null;
  private positionBuffer: GPUBuffer | null = null;
  private velocityBuffer: GPUBuffer | null = null;
  private forceComputePipeline: GPUComputePipeline | null = null;

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn("WebGPU not available, falling back to CPU");
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;

    this.device = await adapter.requestDevice();
    await this.createPipelines();

    return true;
  }

  private async createPipelines(): Promise<void> {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: `
        struct Node {
          position: vec2<f32>,
          velocity: vec2<f32>,
          mass: f32,
          _padding: f32,
        }

        @group(0) @binding(0) var<storage, read_write> nodes: array<Node>;
        @group(0) @binding(1) var<uniform> params: SimParams;

        struct SimParams {
          nodeCount: u32,
          alpha: f32,
          chargeStrength: f32,
          theta: f32,
        }

        @compute @workgroup_size(256)
        fn computeForces(@builtin(global_invocation_id) id: vec3<u32>) {
          let i = id.x;
          if (i >= params.nodeCount) { return; }

          var force = vec2<f32>(0.0, 0.0);

          // Barnes-Hut approximation would go here
          // For simplicity, showing direct N-body
          for (var j = 0u; j < params.nodeCount; j++) {
            if (i == j) { continue; }

            let diff = nodes[j].position - nodes[i].position;
            let dist = max(length(diff), 1.0);
            let f = params.chargeStrength / (dist * dist);
            force -= normalize(diff) * f;
          }

          nodes[i].velocity += force * params.alpha;
          nodes[i].position += nodes[i].velocity;
          nodes[i].velocity *= 0.9; // Damping
        }
      `,
    });

    this.forceComputePipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "computeForces",
      },
    });
  }

  async simulate(nodes: SimulationNode[], iterations: number): Promise<void> {
    if (!this.device || !this.forceComputePipeline) {
      // Fallback to CPU
      return;
    }

    // Upload node data to GPU
    const nodeData = new Float32Array(nodes.length * 6);
    for (let i = 0; i < nodes.length; i++) {
      nodeData[i * 6 + 0] = nodes[i].x;
      nodeData[i * 6 + 1] = nodes[i].y;
      nodeData[i * 6 + 2] = nodes[i].vx;
      nodeData[i * 6 + 3] = nodes[i].vy;
      nodeData[i * 6 + 4] = nodes[i].mass;
      nodeData[i * 6 + 5] = 0; // padding
    }

    this.positionBuffer = this.device.createBuffer({
      size: nodeData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.positionBuffer.getMappedRange()).set(nodeData);
    this.positionBuffer.unmap();

    // Run compute shader
    for (let i = 0; i < iterations; i++) {
      const commandEncoder = this.device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();

      // Would set bind groups and dispatch here
      passEncoder.end();

      this.device.queue.submit([commandEncoder.finish()]);
    }

    // Read back results
    await this.readBackPositions(nodes);
  }

  private async readBackPositions(nodes: SimulationNode[]): Promise<void> {
    // Copy buffer and read positions back to CPU
  }
}
```

## Clustering for Overview

```typescript
import { detectCommunities, ClusterLayout } from "./presentation/renderers/graph";

class ClusteredGraphView {
  private clusters: Map<number, GraphNode[]> = new Map();
  private clusterNodes: GraphNode[] = [];
  private clusterEdges: GraphEdge[] = [];

  constructor(
    private nodes: GraphNode[],
    private edges: GraphEdge[]
  ) {}

  computeClusters(resolution: number = 1.0): void {
    const result = detectCommunities(this.nodes, this.edges, { resolution });

    // Group nodes by cluster
    this.clusters.clear();
    for (const [nodeId, clusterId] of result.assignment) {
      if (!this.clusters.has(clusterId)) {
        this.clusters.set(clusterId, []);
      }
      const node = this.nodes.find((n) => n.id === nodeId);
      if (node) {
        this.clusters.get(clusterId)!.push(node);
      }
    }

    // Create cluster summary nodes
    this.clusterNodes = [];
    for (const [clusterId, clusterMembers] of this.clusters) {
      const centroid = this.computeCentroid(clusterMembers);
      this.clusterNodes.push({
        id: `cluster-${clusterId}`,
        label: `Cluster ${clusterId} (${clusterMembers.length})`,
        x: centroid.x,
        y: centroid.y,
        metadata: {
          isCluster: true,
          memberCount: clusterMembers.length,
          members: clusterMembers.map((n) => n.id),
        },
        style: {
          fill: this.getClusterColor(clusterId),
          radius: Math.sqrt(clusterMembers.length) * 5 + 10,
        },
      });
    }

    // Create inter-cluster edges
    this.clusterEdges = this.computeInterClusterEdges(result.assignment);
  }

  private computeCentroid(nodes: GraphNode[]): { x: number; y: number } {
    const sum = nodes.reduce(
      (acc, n) => ({ x: acc.x + (n.x || 0), y: acc.y + (n.y || 0) }),
      { x: 0, y: 0 }
    );
    return {
      x: sum.x / nodes.length,
      y: sum.y / nodes.length,
    };
  }

  private getClusterColor(clusterId: number): number {
    const colors = [0x6366f1, 0x22c55e, 0xf59e0b, 0xef4444, 0x8b5cf6, 0x06b6d4];
    return colors[clusterId % colors.length];
  }

  private computeInterClusterEdges(assignment: Map<string, number>): GraphEdge[] {
    const interClusterCounts = new Map<string, number>();

    for (const edge of this.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const sourceCluster = assignment.get(sourceId);
      const targetCluster = assignment.get(targetId);

      if (sourceCluster !== undefined && targetCluster !== undefined && sourceCluster !== targetCluster) {
        const key = `${Math.min(sourceCluster, targetCluster)}-${Math.max(sourceCluster, targetCluster)}`;
        interClusterCounts.set(key, (interClusterCounts.get(key) || 0) + 1);
      }
    }

    const clusterEdges: GraphEdge[] = [];
    for (const [key, count] of interClusterCounts) {
      const [source, target] = key.split("-").map(Number);
      clusterEdges.push({
        id: `cluster-edge-${key}`,
        source: `cluster-${source}`,
        target: `cluster-${target}`,
        style: {
          width: Math.log2(count + 1) + 1,
          alpha: 0.6,
        },
        metadata: { connectionCount: count },
      });
    }

    return clusterEdges;
  }

  getClusterView(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: this.clusterNodes, edges: this.clusterEdges };
  }

  expandCluster(clusterId: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const members = this.clusters.get(clusterId) || [];
    const memberIds = new Set(members.map((n) => n.id));

    const relevantEdges = this.edges.filter((e) => {
      const sourceId = typeof e.source === "string" ? e.source : e.source.id;
      const targetId = typeof e.target === "string" ? e.target : e.target.id;
      return memberIds.has(sourceId) && memberIds.has(targetId);
    });

    return { nodes: members, edges: relevantEdges };
  }
}
```

## Complete Large-Scale Example

```tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  GraphLayoutRenderer,
  ForceSimulation,
  forceCenter,
  forceManyBody,
  forceLink,
} from "./presentation/renderers/graph";

interface LargeGraphProps {
  dataSource: GraphDataSource;
  nodeCount: number;
}

function LargeScaleGraph({ dataSource, nodeCount }: LargeGraphProps) {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [visibleData, setVisibleData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [viewMode, setViewMode] = useState<"full" | "clustered">("clustered");
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  const cullerRef = useRef<ViewportCuller | null>(null);
  const lodControllerRef = useRef<LODController>(new LODController());
  const clusteredViewRef = useRef<ClusteredGraphView | null>(null);

  // Progressive loading
  useEffect(() => {
    async function loadData() {
      setLoading(true);

      const loader = new ChunkedGraphLoader(dataSource, (nodes, edges) => {
        setGraphData((prev) => ({
          nodes: [...prev.nodes, ...nodes],
          edges: [...prev.edges, ...edges],
        }));
        setProgress((prev) => Math.min(prev + 10, 100));
      });

      await loader.loadInitialChunk();

      // Load remaining chunks
      const totalChunks = Math.ceil(nodeCount / 1000);
      for (let i = 1; i < totalChunks; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Prevent UI freeze
        await loader.loadChunksInViewport({
          getWorldBounds: () => ({ left: -10000, right: 10000, top: -10000, bottom: 10000 }),
        } as any);
      }

      setLoading(false);
    }

    loadData();
  }, [dataSource, nodeCount]);

  // Initialize culler and clusters when data loaded
  useEffect(() => {
    if (graphData.nodes.length > 0) {
      cullerRef.current = new ViewportCuller(graphData.nodes);

      clusteredViewRef.current = new ClusteredGraphView(graphData.nodes, graphData.edges);
      clusteredViewRef.current.computeClusters(1.0);

      if (viewMode === "clustered") {
        setVisibleData(clusteredViewRef.current.getClusterView());
      }
    }
  }, [graphData, viewMode]);

  const handleViewportChange = useCallback(
    (event: ViewportEvent) => {
      if (viewMode === "full" && cullerRef.current) {
        const visible = cullerRef.current.updateVisibleNodes(
          { getWorldBounds: () => event } as any,
          100
        );
        const visibleEdges = cullerRef.current.getVisibleEdges(graphData.edges);
        setVisibleData({ nodes: visible, edges: visibleEdges });

        // Update LOD
        const lod = lodControllerRef.current.getCurrentLOD(event.scale, visible.length);
        // Apply LOD settings...
      }
    },
    [graphData, viewMode]
  );

  const toggleViewMode = useCallback(() => {
    if (viewMode === "clustered") {
      setViewMode("full");
      if (cullerRef.current) {
        const visible = cullerRef.current.updateVisibleNodes(
          { getWorldBounds: () => ({ left: -1000, right: 1000, top: -1000, bottom: 1000 }) } as any,
          100
        );
        setVisibleData({ nodes: visible, edges: cullerRef.current.getVisibleEdges(graphData.edges) });
      }
    } else {
      setViewMode("clustered");
      if (clusteredViewRef.current) {
        setVisibleData(clusteredViewRef.current.getClusterView());
      }
    }
  }, [viewMode, graphData]);

  const handleClusterClick = useCallback(
    (nodeId: string) => {
      if (viewMode === "clustered" && nodeId.startsWith("cluster-") && clusteredViewRef.current) {
        const clusterId = parseInt(nodeId.replace("cluster-", ""));
        const expanded = clusteredViewRef.current.expandCluster(clusterId);
        setVisibleData(expanded);
        setViewMode("full");
      }
    },
    [viewMode]
  );

  return (
    <div className="large-graph-container">
      <div className="graph-controls">
        <button onClick={toggleViewMode}>
          {viewMode === "clustered" ? "Show Full Graph" : "Show Clusters"}
        </button>
        <span className="stats">
          Total: {graphData.nodes.length} nodes | Visible: {visibleData.nodes.length} nodes
        </span>
      </div>

      {loading && (
        <div className="loading-overlay">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
          <span>Loading {Math.round(progress)}%...</span>
        </div>
      )}

      <GraphLayoutRenderer
        layout={{
          uid: "large-graph",
          label: "Large Scale Graph",
          nodeLabel: "label",
        }}
        nodes={visibleData.nodes}
        edges={visibleData.edges}
        onNodeClick={(nodeId) => handleClusterClick(nodeId)}
        onViewportChange={handleViewportChange}
        options={{
          width: "100%",
          height: "100%",
          chargeStrength: -100,
          linkDistance: 50,
          showLabels: visibleData.nodes.length < 500,
          zoomable: true,
          draggable: true,
          minZoom: 0.01,
          maxZoom: 4,
          physicsOptions: {
            useBarnesHut: true,
            theta: 0.9,
            maxIterations: 100,
          },
        }}
      />
    </div>
  );
}

export default LargeScaleGraph;
```

## Performance Metrics

```typescript
class PerformanceMonitor {
  private frameCount = 0;
  private lastTime = performance.now();
  private fps = 60;

  tick(): void {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastTime;

    if (elapsed >= 1000) {
      this.fps = (this.frameCount * 1000) / elapsed;
      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  getFPS(): number {
    return Math.round(this.fps);
  }

  getMemoryUsage(): { used: number; total: number } | null {
    if ("memory" in performance) {
      const memory = (performance as any).memory;
      return {
        used: memory.usedJSHeapSize / 1024 / 1024,
        total: memory.totalJSHeapSize / 1024 / 1024,
      };
    }
    return null;
  }
}

// Usage
const monitor = new PerformanceMonitor();

function renderLoop() {
  monitor.tick();

  if (monitor.getFPS() < 30) {
    console.warn("Performance degraded, consider reducing detail");
  }

  requestAnimationFrame(renderLoop);
}
```

## See Also

- [Performance Guide](../guides/performance.md) - Optimization techniques
- [Physics Engine API](../api/physics-engine.md) - Force simulation
- [Renderer API](../api/renderer.md) - Batched rendering
