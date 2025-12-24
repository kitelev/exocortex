/**
 * PhysicsController - Manager for Web Worker physics simulation.
 *
 * Responsibilities:
 * - Worker lifecycle management (create, initialize, terminate)
 * - SharedArrayBuffer allocation and management
 * - Node/Edge data synchronization
 * - Message handling between main thread and worker
 */

import type {
  PhysicsNode,
  PhysicsEdgeInput,
  PhysicsEdge,
  PhysicsControllerConfig,
  PhysicsWorkerConfig,
  PhysicsStatus,
  WorkerInMessage,
  WorkerOutMessage,
} from "./types";

import {
  BYTES_PER_NODE,
  FLOATS_PER_NODE,
  NODE_OFFSET,
  STATE_BUFFER_SIZE,
  STATE_OFFSET,
} from "./types";

/**
 * Default physics configuration
 */
export const DEFAULT_PHYSICS_CONFIG: PhysicsWorkerConfig = {
  simulation: {
    alphaMin: 0.001,
    alphaDecay: 0.0228,
    alphaTarget: 0,
    velocityDecay: 0.4,
  },
  center: {
    enabled: true,
    strength: 0.1,
    x: 0,
    y: 0,
  },
  link: {
    enabled: true,
    iterations: 1,
  },
  charge: {
    enabled: true,
    strength: -300,
    distanceMin: 1,
    distanceMax: Infinity,
    theta: 0.9,
  },
  collision: {
    enabled: true,
    strength: 0.7,
    iterations: 1,
  },
  radial: {
    enabled: false,
    strength: 0.1,
    radius: 200,
    x: 0,
    y: 0,
  },
};

/**
 * Check if SharedArrayBuffer is supported
 */
export function isSharedArrayBufferSupported(): boolean {
  try {
    // Check if SharedArrayBuffer exists
    if (typeof SharedArrayBuffer === "undefined") {
      return false;
    }

    // Check if we're in a cross-origin isolated context (required for SharedArrayBuffer)
    if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) {
      return false;
    }

    // Try to create a small SharedArrayBuffer
    new SharedArrayBuffer(1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create inline worker from function string
 */
function createInlineWorker(workerCode: string): Worker {
  const blob = new Blob([workerCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  // Clean up blob URL after worker loads
  worker.addEventListener("message", () => {
    URL.revokeObjectURL(url);
  }, { once: true });

  return worker;
}

/**
 * PhysicsController class
 */
export class PhysicsController {
  private worker: Worker | null = null;
  private nodeBuffer: SharedArrayBuffer | null = null;
  private stateBuffer: SharedArrayBuffer | null = null;
  private nodeArray: Float32Array | null = null;
  private stateArray: Float32Array | null = null;

  private nodeIdToIndex: Map<string, number> = new Map();
  private indexToNodeId: string[] = [];
  private nodeCount = 0;
  private edges: PhysicsEdge[] = [];

  private config: PhysicsWorkerConfig;
  private status: PhysicsStatus = "idle";

  private onTick?: (alpha: number, computeTime: number) => void;
  private onEnd?: (totalTicks: number, totalTime: number) => void;
  private onError?: (error: Error) => void;
  private onStatusChange?: (status: PhysicsStatus) => void;

  private isSupported: boolean;

  constructor(config?: Partial<PhysicsControllerConfig>) {
    this.config = config?.physics
      ? this.mergeConfig(DEFAULT_PHYSICS_CONFIG, config.physics)
      : { ...DEFAULT_PHYSICS_CONFIG };

    this.onTick = config?.onTick;
    this.onEnd = config?.onEnd;
    this.onError = config?.onError;
    this.onStatusChange = config?.onStatusChange;

    this.isSupported = isSharedArrayBufferSupported();
  }

  /**
   * Check if Web Worker physics is supported
   */
  public getIsSupported(): boolean {
    return this.isSupported;
  }

  /**
   * Get current simulation status
   */
  public getStatus(): PhysicsStatus {
    return this.status;
  }

  /**
   * Get current alpha value from state buffer
   */
  public getAlpha(): number {
    if (!this.stateArray) return 0;
    return this.stateArray[STATE_OFFSET.ALPHA];
  }

  /**
   * Check if simulation is running
   */
  public isRunning(): boolean {
    if (!this.stateArray) return false;
    return this.stateArray[STATE_OFFSET.RUNNING] === 1.0;
  }

  /**
   * Get current node count
   */
  public getNodeCount(): number {
    return this.nodeCount;
  }

  /**
   * Get current edge count
   */
  public getEdgeCount(): number {
    return this.edges.length;
  }

  /**
   * Initialize the physics simulation
   */
  public async initialize(
    nodes: PhysicsNode[],
    edgeInputs: PhysicsEdgeInput[],
    centerX?: number,
    centerY?: number
  ): Promise<void> {
    if (!this.isSupported) {
      this.handleError(new Error("SharedArrayBuffer is not supported in this environment"));
      return;
    }

    this.setStatus("initializing");

    try {
      // Clean up existing worker
      this.cleanup();

      // Build node ID to index mapping
      this.nodeIdToIndex.clear();
      this.indexToNodeId = [];
      nodes.forEach((node, index) => {
        this.nodeIdToIndex.set(node.id, index);
        this.indexToNodeId.push(node.id);
      });
      this.nodeCount = nodes.length;

      // Convert edges to index-based format
      this.edges = this.convertEdges(edgeInputs);

      // Allocate SharedArrayBuffers
      this.nodeBuffer = new SharedArrayBuffer(nodes.length * BYTES_PER_NODE);
      this.stateBuffer = new SharedArrayBuffer(STATE_BUFFER_SIZE);
      this.nodeArray = new Float32Array(this.nodeBuffer);
      this.stateArray = new Float32Array(this.stateBuffer);

      // Initialize node data
      nodes.forEach((node, index) => {
        const offset = index * FLOATS_PER_NODE;
        this.nodeArray![offset + NODE_OFFSET.X] = node.x;
        this.nodeArray![offset + NODE_OFFSET.Y] = node.y;
        this.nodeArray![offset + NODE_OFFSET.VX] = node.vx ?? 0;
        this.nodeArray![offset + NODE_OFFSET.VY] = node.vy ?? 0;
        this.nodeArray![offset + NODE_OFFSET.FX] = node.fx ?? NaN;
        this.nodeArray![offset + NODE_OFFSET.FY] = node.fy ?? NaN;
        this.nodeArray![offset + NODE_OFFSET.RADIUS] = node.radius ?? 8;
        this.nodeArray![offset + NODE_OFFSET.MASS] = node.mass ?? 1;
      });

      // Update center in config
      if (centerX !== undefined && centerY !== undefined) {
        this.config.center.x = centerX;
        this.config.center.y = centerY;
        this.config.radial.x = centerX;
        this.config.radial.y = centerY;
      }

      // Create worker
      this.worker = await this.createWorker();

      // Wait for worker to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Worker initialization timeout"));
        }, 5000);

        const handleMessage = (event: MessageEvent<WorkerOutMessage>) => {
          if (event.data.type === "ready") {
            clearTimeout(timeout);
            this.worker?.removeEventListener("message", handleMessage);
            resolve();
          } else if (event.data.type === "error") {
            clearTimeout(timeout);
            this.worker?.removeEventListener("message", handleMessage);
            reject(new Error(event.data.message));
          }
        };

        this.worker?.addEventListener("message", handleMessage);

        // Send init message
        this.sendMessage({
          type: "init",
          nodeBuffer: this.nodeBuffer!,
          stateBuffer: this.stateBuffer!,
          nodeCount: this.nodeCount,
          edges: this.edges,
          config: this.config,
        });
      });

      // Setup message handler
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      this.setStatus("stopped");
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Start the simulation
   */
  public start(alpha?: number): void {
    if (this.status !== "stopped" && this.status !== "idle") {
      return;
    }

    this.sendMessage({ type: "start", alpha });
    this.setStatus("running");
  }

  /**
   * Stop the simulation
   */
  public stop(): void {
    if (this.status !== "running") {
      return;
    }

    this.sendMessage({ type: "stop" });
    this.setStatus("stopped");
  }

  /**
   * Reheat the simulation
   */
  public reheat(alpha = 0.3): void {
    this.sendMessage({ type: "reheat", alpha });
    if (this.status !== "running") {
      this.setStatus("running");
    }
  }

  /**
   * Update physics configuration
   */
  public updateConfig(config: Partial<PhysicsWorkerConfig>): void {
    this.config = this.mergeConfig(this.config, config);
    this.sendMessage({ type: "config", config });
  }

  /**
   * Update edges
   */
  public updateEdges(edgeInputs: PhysicsEdgeInput[]): void {
    this.edges = this.convertEdges(edgeInputs);
    this.sendMessage({ type: "edges", edges: this.edges });
  }

  /**
   * Fix a node at a specific position
   */
  public fixNode(nodeId: string, x: number, y: number): void {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined) return;

    // Update local buffer
    if (this.nodeArray) {
      const offset = index * FLOATS_PER_NODE;
      this.nodeArray[offset + NODE_OFFSET.FX] = x;
      this.nodeArray[offset + NODE_OFFSET.FY] = y;
      this.nodeArray[offset + NODE_OFFSET.X] = x;
      this.nodeArray[offset + NODE_OFFSET.Y] = y;
    }

    this.sendMessage({ type: "fixNode", nodeIndex: index, x, y });
  }

  /**
   * Unfix a node
   */
  public unfixNode(nodeId: string): void {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined) return;

    // Update local buffer
    if (this.nodeArray) {
      const offset = index * FLOATS_PER_NODE;
      this.nodeArray[offset + NODE_OFFSET.FX] = NaN;
      this.nodeArray[offset + NODE_OFFSET.FY] = NaN;
    }

    this.sendMessage({ type: "unfixNode", nodeIndex: index });
  }

  /**
   * Update a node's position (for drag)
   */
  public updateNodePosition(nodeId: string, x: number, y: number): void {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined || !this.nodeArray) return;

    const offset = index * FLOATS_PER_NODE;
    this.nodeArray[offset + NODE_OFFSET.X] = x;
    this.nodeArray[offset + NODE_OFFSET.Y] = y;
    // Reset velocity when manually moving
    this.nodeArray[offset + NODE_OFFSET.VX] = 0;
    this.nodeArray[offset + NODE_OFFSET.VY] = 0;
  }

  /**
   * Get all current node positions
   */
  public getNodePositions(): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();

    if (!this.nodeArray) return positions;

    for (let i = 0; i < this.nodeCount; i++) {
      const offset = i * FLOATS_PER_NODE;
      const nodeId = this.indexToNodeId[i];
      positions.set(nodeId, {
        x: this.nodeArray[offset + NODE_OFFSET.X],
        y: this.nodeArray[offset + NODE_OFFSET.Y],
      });
    }

    return positions;
  }

  /**
   * Get all current node velocities
   */
  public getNodeVelocities(): Map<string, { vx: number; vy: number }> {
    const velocities = new Map<string, { vx: number; vy: number }>();

    if (!this.nodeArray) return velocities;

    for (let i = 0; i < this.nodeCount; i++) {
      const offset = i * FLOATS_PER_NODE;
      const nodeId = this.indexToNodeId[i];
      velocities.set(nodeId, {
        vx: this.nodeArray[offset + NODE_OFFSET.VX],
        vy: this.nodeArray[offset + NODE_OFFSET.VY],
      });
    }

    return velocities;
  }

  /**
   * Get position for a specific node
   */
  public getNodePosition(nodeId: string): { x: number; y: number } | null {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index === undefined || !this.nodeArray) return null;

    const offset = index * FLOATS_PER_NODE;
    return {
      x: this.nodeArray[offset + NODE_OFFSET.X],
      y: this.nodeArray[offset + NODE_OFFSET.Y],
    };
  }

  /**
   * Cleanup and terminate the worker
   */
  public cleanup(): void {
    if (this.worker) {
      this.sendMessage({ type: "terminate" });
      this.worker.terminate();
      this.worker = null;
    }

    this.nodeBuffer = null;
    this.stateBuffer = null;
    this.nodeArray = null;
    this.stateArray = null;
    this.nodeIdToIndex.clear();
    this.indexToNodeId = [];
    this.nodeCount = 0;
    this.edges = [];
    this.setStatus("idle");
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private async createWorker(): Promise<Worker> {
    // Import worker code as string for inline worker
    // In a bundled environment, this would be handled by the bundler
    const workerCode = `
      // Inline physics worker code
      ${await this.getWorkerCode()}
    `;

    return createInlineWorker(workerCode);
  }

  private async getWorkerCode(): Promise<string> {
    // This is a simplified version - in production, the bundler would handle this
    // For now, we return a minimal implementation
    return `
      const FLOATS_PER_NODE = 8;
      const NODE_OFFSET = { X: 0, Y: 1, VX: 2, VY: 3, FX: 4, FY: 5, RADIUS: 6, MASS: 7 };
      const STATE_OFFSET = { ALPHA: 0, ALPHA_TARGET: 1, ALPHA_MIN: 2, RUNNING: 3 };

      let nodeBuffer = null;
      let stateBuffer = null;
      let nodeArray = null;
      let stateArray = null;
      let nodeCount = 0;
      let edges = [];
      let config = null;
      let isRunning = false;
      let totalTicks = 0;
      let startTime = 0;

      self.onmessage = (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'init':
            nodeBuffer = msg.nodeBuffer;
            stateBuffer = msg.stateBuffer;
            nodeArray = new Float32Array(nodeBuffer);
            stateArray = new Float32Array(stateBuffer);
            nodeCount = msg.nodeCount;
            edges = msg.edges;
            config = msg.config;
            stateArray[STATE_OFFSET.ALPHA] = 1.0;
            stateArray[STATE_OFFSET.ALPHA_TARGET] = config.simulation.alphaTarget;
            stateArray[STATE_OFFSET.ALPHA_MIN] = config.simulation.alphaMin;
            stateArray[STATE_OFFSET.RUNNING] = 0.0;
            self.postMessage({ type: 'ready' });
            break;
          case 'start':
            if (isRunning) return;
            stateArray[STATE_OFFSET.ALPHA] = msg.alpha ?? 1.0;
            stateArray[STATE_OFFSET.RUNNING] = 1.0;
            isRunning = true;
            totalTicks = 0;
            startTime = performance.now();
            requestAnimationFrame(tick);
            break;
          case 'stop':
            isRunning = false;
            stateArray[STATE_OFFSET.RUNNING] = 0.0;
            break;
          case 'config':
            config = deepMerge(config, msg.config);
            if (stateArray) {
              stateArray[STATE_OFFSET.ALPHA_TARGET] = config.simulation.alphaTarget;
              stateArray[STATE_OFFSET.ALPHA_MIN] = config.simulation.alphaMin;
            }
            break;
          case 'edges':
            edges = msg.edges;
            break;
          case 'resize':
            nodeBuffer = msg.nodeBuffer;
            nodeArray = new Float32Array(nodeBuffer);
            nodeCount = msg.nodeCount;
            break;
          case 'fixNode':
            if (!nodeArray || msg.nodeIndex < 0 || msg.nodeIndex >= nodeCount) return;
            const fixOffset = msg.nodeIndex * FLOATS_PER_NODE;
            nodeArray[fixOffset + NODE_OFFSET.FX] = msg.x;
            nodeArray[fixOffset + NODE_OFFSET.FY] = msg.y;
            nodeArray[fixOffset + NODE_OFFSET.X] = msg.x;
            nodeArray[fixOffset + NODE_OFFSET.Y] = msg.y;
            break;
          case 'unfixNode':
            if (!nodeArray || msg.nodeIndex < 0 || msg.nodeIndex >= nodeCount) return;
            const unfixOffset = msg.nodeIndex * FLOATS_PER_NODE;
            nodeArray[unfixOffset + NODE_OFFSET.FX] = NaN;
            nodeArray[unfixOffset + NODE_OFFSET.FY] = NaN;
            break;
          case 'reheat':
            if (!stateArray) return;
            stateArray[STATE_OFFSET.ALPHA] = msg.alpha;
            if (!isRunning) {
              isRunning = true;
              stateArray[STATE_OFFSET.RUNNING] = 1.0;
              requestAnimationFrame(tick);
            }
            break;
          case 'terminate':
            isRunning = false;
            self.close();
            break;
        }
      };

      function tick() {
        if (!isRunning || !nodeArray || !stateArray || !config) return;
        const tickStart = performance.now();
        let alpha = stateArray[STATE_OFFSET.ALPHA];
        const alphaMin = stateArray[STATE_OFFSET.ALPHA_MIN];
        const alphaTarget = stateArray[STATE_OFFSET.ALPHA_TARGET];

        // Apply forces
        if (config.center.enabled) applyCenterForce(alpha);
        if (config.link.enabled && edges.length > 0) applyLinkForce(alpha);
        if (config.charge.enabled) applyChargeForce(alpha);
        if (config.collision.enabled) applyCollisionForce();
        if (config.radial.enabled) applyRadialForce(alpha);
        updatePositions();

        // Decay alpha
        alpha += (alphaTarget - alpha) * config.simulation.alphaDecay;
        stateArray[STATE_OFFSET.ALPHA] = alpha;
        totalTicks++;
        const computeTime = performance.now() - tickStart;
        self.postMessage({ type: 'tick', alpha, computeTime });

        if (alpha < alphaMin) {
          isRunning = false;
          stateArray[STATE_OFFSET.RUNNING] = 0.0;
          self.postMessage({ type: 'end', totalTicks, totalTime: performance.now() - startTime });
          return;
        }
        if (isRunning) requestAnimationFrame(tick);
      }

      function applyCenterForce(alpha) {
        const { strength, x: cx, y: cy } = config.center;
        let sx = 0, sy = 0;
        for (let i = 0; i < nodeCount; i++) {
          const o = i * FLOATS_PER_NODE;
          sx += nodeArray[o + NODE_OFFSET.X];
          sy += nodeArray[o + NODE_OFFSET.Y];
        }
        sx /= nodeCount; sy /= nodeCount;
        const dx = (cx - sx) * strength * alpha;
        const dy = (cy - sy) * strength * alpha;
        for (let i = 0; i < nodeCount; i++) {
          const o = i * FLOATS_PER_NODE;
          if (!isNaN(nodeArray[o + NODE_OFFSET.FX])) continue;
          nodeArray[o + NODE_OFFSET.X] += dx;
          nodeArray[o + NODE_OFFSET.Y] += dy;
        }
      }

      function applyLinkForce(alpha) {
        const { iterations } = config.link;
        for (let iter = 0; iter < iterations; iter++) {
          for (const edge of edges) {
            const so = edge.source * FLOATS_PER_NODE;
            const to = edge.target * FLOATS_PER_NODE;
            let dx = nodeArray[to + NODE_OFFSET.X] - nodeArray[so + NODE_OFFSET.X];
            let dy = nodeArray[to + NODE_OFFSET.Y] - nodeArray[so + NODE_OFFSET.Y];
            let l = Math.sqrt(dx * dx + dy * dy);
            if (l === 0) { dx = Math.random() * 0.001; dy = Math.random() * 0.001; l = Math.sqrt(dx * dx + dy * dy); }
            const k = (l - edge.distance) / l * alpha * edge.strength;
            dx *= k; dy *= k;
            if (isNaN(nodeArray[to + NODE_OFFSET.FX])) { nodeArray[to + NODE_OFFSET.X] -= dx * 0.5; nodeArray[to + NODE_OFFSET.Y] -= dy * 0.5; }
            if (isNaN(nodeArray[so + NODE_OFFSET.FX])) { nodeArray[so + NODE_OFFSET.X] += dx * 0.5; nodeArray[so + NODE_OFFSET.Y] += dy * 0.5; }
          }
        }
      }

      function applyChargeForce(alpha) {
        const { strength, distanceMin, distanceMax } = config.charge;
        const distanceMin2 = distanceMin * distanceMin;
        const distanceMax2 = distanceMax * distanceMax;
        for (let i = 0; i < nodeCount; i++) {
          const oi = i * FLOATS_PER_NODE;
          if (!isNaN(nodeArray[oi + NODE_OFFSET.FX])) continue;
          const xi = nodeArray[oi + NODE_OFFSET.X];
          const yi = nodeArray[oi + NODE_OFFSET.Y];
          const mi = nodeArray[oi + NODE_OFFSET.MASS] || 1;
          let fx = 0, fy = 0;
          for (let j = 0; j < nodeCount; j++) {
            if (i === j) continue;
            const oj = j * FLOATS_PER_NODE;
            const dx = nodeArray[oj + NODE_OFFSET.X] - xi;
            const dy = nodeArray[oj + NODE_OFFSET.Y] - yi;
            let l2 = dx * dx + dy * dy;
            if (l2 < distanceMax2 && l2 > 0) {
              const l = Math.max(Math.sqrt(l2), Math.sqrt(distanceMin2));
              const mj = nodeArray[oj + NODE_OFFSET.MASS] || 1;
              const k = strength * mj * alpha / (l * l);
              fx -= dx * k; fy -= dy * k;
            }
          }
          nodeArray[oi + NODE_OFFSET.VX] += fx / mi;
          nodeArray[oi + NODE_OFFSET.VY] += fy / mi;
        }
      }

      function applyCollisionForce() {
        const { strength, iterations } = config.collision;
        for (let iter = 0; iter < iterations; iter++) {
          for (let i = 0; i < nodeCount; i++) {
            const oi = i * FLOATS_PER_NODE;
            const xi = nodeArray[oi + NODE_OFFSET.X];
            const yi = nodeArray[oi + NODE_OFFSET.Y];
            const ri = nodeArray[oi + NODE_OFFSET.RADIUS] || 8;
            for (let j = i + 1; j < nodeCount; j++) {
              const oj = j * FLOATS_PER_NODE;
              const xj = nodeArray[oj + NODE_OFFSET.X];
              const yj = nodeArray[oj + NODE_OFFSET.Y];
              const rj = nodeArray[oj + NODE_OFFSET.RADIUS] || 8;
              let dx = xi - xj, dy = yi - yj;
              let l = Math.sqrt(dx * dx + dy * dy);
              const r = ri + rj;
              if (l < r && l > 0) {
                const k = (r - l) / l * strength * 0.5;
                dx *= k; dy *= k;
                if (isNaN(nodeArray[oi + NODE_OFFSET.FX])) { nodeArray[oi + NODE_OFFSET.X] += dx; nodeArray[oi + NODE_OFFSET.Y] += dy; }
                if (isNaN(nodeArray[oj + NODE_OFFSET.FX])) { nodeArray[oj + NODE_OFFSET.X] -= dx; nodeArray[oj + NODE_OFFSET.Y] -= dy; }
              }
            }
          }
        }
      }

      function applyRadialForce(alpha) {
        const { strength, radius, x: cx, y: cy } = config.radial;
        for (let i = 0; i < nodeCount; i++) {
          const o = i * FLOATS_PER_NODE;
          if (!isNaN(nodeArray[o + NODE_OFFSET.FX])) continue;
          const x = nodeArray[o + NODE_OFFSET.X];
          const y = nodeArray[o + NODE_OFFSET.Y];
          const dx = x - cx, dy = y - cy;
          const r = Math.sqrt(dx * dx + dy * dy);
          if (r > 0) {
            const k = (radius - r) * strength * alpha / r;
            nodeArray[o + NODE_OFFSET.VX] += dx * k;
            nodeArray[o + NODE_OFFSET.VY] += dy * k;
          }
        }
      }

      function updatePositions() {
        const velocityDecay = config.simulation.velocityDecay;
        for (let i = 0; i < nodeCount; i++) {
          const o = i * FLOATS_PER_NODE;
          const fx = nodeArray[o + NODE_OFFSET.FX];
          const fy = nodeArray[o + NODE_OFFSET.FY];
          if (!isNaN(fx) && !isNaN(fy)) {
            nodeArray[o + NODE_OFFSET.X] = fx;
            nodeArray[o + NODE_OFFSET.Y] = fy;
            nodeArray[o + NODE_OFFSET.VX] = 0;
            nodeArray[o + NODE_OFFSET.VY] = 0;
            continue;
          }
          const vx = nodeArray[o + NODE_OFFSET.VX] * velocityDecay;
          const vy = nodeArray[o + NODE_OFFSET.VY] * velocityDecay;
          nodeArray[o + NODE_OFFSET.VX] = vx;
          nodeArray[o + NODE_OFFSET.VY] = vy;
          nodeArray[o + NODE_OFFSET.X] += vx;
          nodeArray[o + NODE_OFFSET.Y] += vy;
        }
      }

      function deepMerge(target, source) {
        const output = { ...target };
        for (const key of Object.keys(source)) {
          if (source[key] !== undefined && typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key]) &&
              typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
            output[key] = deepMerge(target[key], source[key]);
          } else if (source[key] !== undefined) {
            output[key] = source[key];
          }
        }
        return output;
      }
    `;
  }

  private sendMessage(message: WorkerInMessage): void {
    if (!this.worker) return;
    this.worker.postMessage(message);
  }

  private handleWorkerMessage(event: MessageEvent<WorkerOutMessage>): void {
    const message = event.data;

    switch (message.type) {
      case "tick":
        this.onTick?.(message.alpha, message.computeTime);
        break;
      case "end":
        this.setStatus("stopped");
        this.onEnd?.(message.totalTicks, message.totalTime);
        break;
      case "error":
        this.handleError(new Error(message.message));
        break;
    }
  }

  private handleWorkerError(error: ErrorEvent): void {
    this.handleError(new Error(error.message));
  }

  private handleError(error: Error): void {
    this.setStatus("error");
    this.onError?.(error);
  }

  private setStatus(status: PhysicsStatus): void {
    this.status = status;
    this.onStatusChange?.(status);
  }

  private convertEdges(edgeInputs: PhysicsEdgeInput[]): PhysicsEdge[] {
    return edgeInputs
      .map((edge) => {
        const sourceIndex = this.nodeIdToIndex.get(edge.source);
        const targetIndex = this.nodeIdToIndex.get(edge.target);

        if (sourceIndex === undefined || targetIndex === undefined) {
          return null;
        }

        return {
          source: sourceIndex,
          target: targetIndex,
          distance: edge.distance ?? 100,
          strength: edge.strength ?? 1,
        };
      })
      .filter((edge): edge is PhysicsEdge => edge !== null);
  }

  private mergeConfig(
    target: PhysicsWorkerConfig,
    source: Partial<PhysicsWorkerConfig>
  ): PhysicsWorkerConfig {
    return {
      simulation: { ...target.simulation, ...source.simulation },
      center: { ...target.center, ...source.center },
      link: { ...target.link, ...source.link },
      charge: { ...target.charge, ...source.charge },
      collision: { ...target.collision, ...source.collision },
      radial: { ...target.radial, ...source.radial },
    };
  }
}
