/**
 * Web Worker for physics simulation.
 * Runs force calculations off the main thread using SharedArrayBuffer
 * for zero-copy data transfer.
 *
 * Force algorithms implemented:
 * - Center force: Attracts nodes toward center
 * - Link force: Spring forces between connected nodes
 * - Many-body force: Repulsion between all nodes (Barnes-Hut approximation)
 * - Collision force: Prevents node overlap
 * - Radial force: Attracts nodes to a specific radius from center
 */

import type {
  WorkerInMessage,
  WorkerOutMessage,
  PhysicsEdge,
  PhysicsWorkerConfig,
} from "./types";

import {
  FLOATS_PER_NODE,
  NODE_OFFSET,
  STATE_OFFSET,
} from "./types";

// ============================================================
// Worker State
// ============================================================

let nodeBuffer: SharedArrayBuffer | null = null;
let stateBuffer: SharedArrayBuffer | null = null;
let nodeArray: Float32Array | null = null;
let stateArray: Float32Array | null = null;
let nodeCount = 0;
let edges: PhysicsEdge[] = [];
let config: PhysicsWorkerConfig | null = null;

let isRunning = false;
let totalTicks = 0;
let startTime = 0;

// ============================================================
// Message Handler
// ============================================================

// Valid message types that this worker accepts
const VALID_MESSAGE_TYPES = [
  "init",
  "start",
  "stop",
  "config",
  "edges",
  "resize",
  "fixNode",
  "unfixNode",
  "reheat",
  "terminate",
] as const;

type ValidMessageType = typeof VALID_MESSAGE_TYPES[number];

/**
 * Validate that a message type is one we expect to handle.
 * This prevents property injection attacks where an attacker
 * might try to send malicious message types.
 */
function isValidMessageType(type: unknown): type is ValidMessageType {
  return typeof type === "string" && VALID_MESSAGE_TYPES.includes(type as ValidMessageType);
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  // Web Workers only receive messages from their parent context (main thread).
  // Unlike window.postMessage, Worker.postMessage does not have an origin
  // since workers are same-origin by definition (loaded from same origin blob/URL).
  // The message event comes from the trusted main thread that created this worker.

  const message = event.data;

  // Validate message structure before processing
  if (!message || typeof message !== "object" || !isValidMessageType(message.type)) {
    // Ignore invalid messages silently - don't send error to avoid
    // leaking information about valid message types
    return;
  }

  switch (message.type) {
    case "init":
      handleInit(message);
      break;
    case "start":
      handleStart(message.alpha);
      break;
    case "stop":
      handleStop();
      break;
    case "config":
      handleConfig(message.config);
      break;
    case "edges":
      handleEdges(message.edges);
      break;
    case "resize":
      handleResize(message.nodeBuffer, message.nodeCount);
      break;
    case "fixNode":
      handleFixNode(message.nodeIndex, message.x, message.y);
      break;
    case "unfixNode":
      handleUnfixNode(message.nodeIndex);
      break;
    case "reheat":
      handleReheat(message.alpha);
      break;
    case "terminate":
      handleTerminate();
      break;
  }
};

// ============================================================
// Message Handlers
// ============================================================

function handleInit(message: {
  nodeBuffer: SharedArrayBuffer;
  stateBuffer: SharedArrayBuffer;
  nodeCount: number;
  edges: PhysicsEdge[];
  config: PhysicsWorkerConfig;
}): void {
  try {
    nodeBuffer = message.nodeBuffer;
    stateBuffer = message.stateBuffer;
    nodeArray = new Float32Array(nodeBuffer);
    stateArray = new Float32Array(stateBuffer);
    nodeCount = message.nodeCount;
    edges = message.edges;
    config = message.config;

    // Initialize state buffer
    stateArray[STATE_OFFSET.ALPHA] = 1.0;
    stateArray[STATE_OFFSET.ALPHA_TARGET] = config.simulation.alphaTarget;
    stateArray[STATE_OFFSET.ALPHA_MIN] = config.simulation.alphaMin;
    stateArray[STATE_OFFSET.RUNNING] = 0.0;

    totalTicks = 0;
    startTime = 0;

    sendMessage({ type: "ready" });
  } catch (error) {
    sendError(error);
  }
}

function handleStart(alpha?: number): void {
  if (!nodeArray || !stateArray || !config) {
    sendError(new Error("Worker not initialized"));
    return;
  }

  if (isRunning) return;

  stateArray[STATE_OFFSET.ALPHA] = alpha ?? 1.0;
  stateArray[STATE_OFFSET.RUNNING] = 1.0;
  isRunning = true;
  totalTicks = 0;
  startTime = performance.now();

  requestAnimationFrame(tick);
}

function handleStop(): void {
  if (!stateArray) return;

  isRunning = false;
  stateArray[STATE_OFFSET.RUNNING] = 0.0;
}

function handleConfig(partialConfig: Partial<PhysicsWorkerConfig>): void {
  if (!config) return;

  // Deep merge configuration
  config = deepMerge(config, partialConfig);

  if (stateArray) {
    stateArray[STATE_OFFSET.ALPHA_TARGET] = config.simulation.alphaTarget;
    stateArray[STATE_OFFSET.ALPHA_MIN] = config.simulation.alphaMin;
  }
}

function handleEdges(newEdges: PhysicsEdge[]): void {
  edges = newEdges;
}

function handleResize(
  newBuffer: SharedArrayBuffer,
  newNodeCount: number
): void {
  nodeBuffer = newBuffer;
  nodeArray = new Float32Array(nodeBuffer);
  nodeCount = newNodeCount;
}

function handleFixNode(nodeIndex: number, x: number, y: number): void {
  if (!nodeArray || nodeIndex < 0 || nodeIndex >= nodeCount) return;

  const offset = nodeIndex * FLOATS_PER_NODE;
  nodeArray[offset + NODE_OFFSET.FX] = x;
  nodeArray[offset + NODE_OFFSET.FY] = y;
  nodeArray[offset + NODE_OFFSET.X] = x;
  nodeArray[offset + NODE_OFFSET.Y] = y;
}

function handleUnfixNode(nodeIndex: number): void {
  if (!nodeArray || nodeIndex < 0 || nodeIndex >= nodeCount) return;

  const offset = nodeIndex * FLOATS_PER_NODE;
  nodeArray[offset + NODE_OFFSET.FX] = NaN;
  nodeArray[offset + NODE_OFFSET.FY] = NaN;
}

function handleReheat(alpha: number): void {
  if (!stateArray) return;

  stateArray[STATE_OFFSET.ALPHA] = alpha;

  if (!isRunning) {
    isRunning = true;
    stateArray[STATE_OFFSET.RUNNING] = 1.0;
    requestAnimationFrame(tick);
  }
}

function handleTerminate(): void {
  isRunning = false;
  nodeBuffer = null;
  stateBuffer = null;
  nodeArray = null;
  stateArray = null;
  nodeCount = 0;
  edges = [];
  config = null;
  self.close();
}

// ============================================================
// Simulation Loop
// ============================================================

function tick(): void {
  if (!isRunning || !nodeArray || !stateArray || !config) return;

  const tickStart = performance.now();

  // Get current alpha
  let alpha = stateArray[STATE_OFFSET.ALPHA];
  const alphaMin = stateArray[STATE_OFFSET.ALPHA_MIN];
  const alphaTarget = stateArray[STATE_OFFSET.ALPHA_TARGET];

  // Apply forces
  if (config.center.enabled) {
    applyCenterForce(alpha);
  }

  if (config.link.enabled && edges.length > 0) {
    applyLinkForce(alpha);
  }

  if (config.charge.enabled) {
    applyChargeForce(alpha);
  }

  if (config.collision.enabled) {
    applyCollisionForce();
  }

  if (config.radial.enabled) {
    applyRadialForce(alpha);
  }

  // Update positions from velocities
  updatePositions();

  // Decay alpha
  alpha += (alphaTarget - alpha) * config.simulation.alphaDecay;
  stateArray[STATE_OFFSET.ALPHA] = alpha;

  totalTicks++;
  const computeTime = performance.now() - tickStart;

  // Send tick notification
  sendMessage({ type: "tick", alpha, computeTime });

  // Check if simulation should end
  if (alpha < alphaMin) {
    isRunning = false;
    stateArray[STATE_OFFSET.RUNNING] = 0.0;
    const totalTime = performance.now() - startTime;
    sendMessage({ type: "end", totalTicks, totalTime });
    return;
  }

  // Continue simulation
  if (isRunning) {
    requestAnimationFrame(tick);
  }
}

// ============================================================
// Force Implementations
// ============================================================

/**
 * Apply center force - attracts all nodes toward center
 */
function applyCenterForce(alpha: number): void {
  if (!nodeArray || !config) return;

  const { strength, x: centerX, y: centerY } = config.center;

  // Calculate centroid
  let sx = 0, sy = 0;
  for (let i = 0; i < nodeCount; i++) {
    const offset = i * FLOATS_PER_NODE;
    sx += nodeArray[offset + NODE_OFFSET.X];
    sy += nodeArray[offset + NODE_OFFSET.Y];
  }
  sx /= nodeCount;
  sy /= nodeCount;

  // Move all nodes toward center
  const dx = (centerX - sx) * strength * alpha;
  const dy = (centerY - sy) * strength * alpha;

  for (let i = 0; i < nodeCount; i++) {
    const offset = i * FLOATS_PER_NODE;
    const fx = nodeArray[offset + NODE_OFFSET.FX];
    const fy = nodeArray[offset + NODE_OFFSET.FY];

    // Skip fixed nodes
    if (!isNaN(fx) && !isNaN(fy)) continue;

    nodeArray[offset + NODE_OFFSET.X] += dx;
    nodeArray[offset + NODE_OFFSET.Y] += dy;
  }
}

/**
 * Apply link force - spring forces between connected nodes
 */
function applyLinkForce(alpha: number): void {
  if (!nodeArray || !config) return;

  const { iterations } = config.link;

  for (let iter = 0; iter < iterations; iter++) {
    for (const edge of edges) {
      const sourceOffset = edge.source * FLOATS_PER_NODE;
      const targetOffset = edge.target * FLOATS_PER_NODE;

      // Get positions
      const x1 = nodeArray[sourceOffset + NODE_OFFSET.X];
      const y1 = nodeArray[sourceOffset + NODE_OFFSET.Y];
      const x2 = nodeArray[targetOffset + NODE_OFFSET.X];
      const y2 = nodeArray[targetOffset + NODE_OFFSET.Y];

      // Calculate distance
      let dx = x2 - x1;
      let dy = y2 - y1;
      let l = Math.sqrt(dx * dx + dy * dy);

      if (l === 0) {
        // Jitter if overlapping
        dx = (Math.random() - 0.5) * 0.001;
        dy = (Math.random() - 0.5) * 0.001;
        l = Math.sqrt(dx * dx + dy * dy);
      }

      // Calculate force
      const k = (l - edge.distance) / l * alpha * edge.strength;
      dx *= k;
      dy *= k;

      // Apply to target
      const fxTarget = nodeArray[targetOffset + NODE_OFFSET.FX];
      const fyTarget = nodeArray[targetOffset + NODE_OFFSET.FY];
      if (isNaN(fxTarget) || isNaN(fyTarget)) {
        nodeArray[targetOffset + NODE_OFFSET.X] -= dx * 0.5;
        nodeArray[targetOffset + NODE_OFFSET.Y] -= dy * 0.5;
      }

      // Apply to source
      const fxSource = nodeArray[sourceOffset + NODE_OFFSET.FX];
      const fySource = nodeArray[sourceOffset + NODE_OFFSET.FY];
      if (isNaN(fxSource) || isNaN(fySource)) {
        nodeArray[sourceOffset + NODE_OFFSET.X] += dx * 0.5;
        nodeArray[sourceOffset + NODE_OFFSET.Y] += dy * 0.5;
      }
    }
  }
}

/**
 * Apply charge/many-body force - repulsion between all nodes
 * Uses Barnes-Hut approximation for O(n log n) complexity
 */
function applyChargeForce(alpha: number): void {
  if (!nodeArray || !config) return;

  const { strength, distanceMin, distanceMax, theta } = config.charge;
  const theta2 = theta * theta;
  const distanceMin2 = distanceMin * distanceMin;
  const distanceMax2 = distanceMax * distanceMax;

  // Build quadtree for Barnes-Hut
  const quadtree = buildQuadtree();

  // Apply forces using Barnes-Hut
  for (let i = 0; i < nodeCount; i++) {
    const offset = i * FLOATS_PER_NODE;
    const fx = nodeArray[offset + NODE_OFFSET.FX];
    const fy = nodeArray[offset + NODE_OFFSET.FY];

    // Skip fixed nodes
    if (!isNaN(fx) && !isNaN(fy)) continue;

    const x = nodeArray[offset + NODE_OFFSET.X];
    const y = nodeArray[offset + NODE_OFFSET.Y];
    const mass = nodeArray[offset + NODE_OFFSET.MASS] || 1;

    // Traverse quadtree
    let forceX = 0;
    let forceY = 0;

    const visit = (node: QuadtreeNode): void => {
      if (!node) return;

      const dx = node.cx - x;
      const dy = node.cy - y;
      const l2 = dx * dx + dy * dy;

      // Check if we can treat as single body (Barnes-Hut criterion)
      if (node.size * node.size / l2 < theta2 || node.count === 1) {
        if (l2 < distanceMax2 && l2 > 0) {
          const l = Math.max(Math.sqrt(l2), Math.sqrt(distanceMin2));
          const k = (strength * node.mass * alpha) / (l * l);
          forceX -= dx * k;
          forceY -= dy * k;
        }
      } else {
        // Recurse into children
        for (const child of node.children) {
          if (child) visit(child);
        }
      }
    };

    if (quadtree) visit(quadtree);

    // Apply force
    nodeArray[offset + NODE_OFFSET.VX] += forceX / mass;
    nodeArray[offset + NODE_OFFSET.VY] += forceY / mass;
  }
}

/**
 * Apply collision force - prevents node overlap
 */
function applyCollisionForce(): void {
  if (!nodeArray || !config) return;

  const { strength, iterations } = config.collision;

  for (let iter = 0; iter < iterations; iter++) {
    // Simple O(n^2) collision detection
    // For large graphs, use spatial hashing
    for (let i = 0; i < nodeCount; i++) {
      const offsetI = i * FLOATS_PER_NODE;
      const xi = nodeArray[offsetI + NODE_OFFSET.X];
      const yi = nodeArray[offsetI + NODE_OFFSET.Y];
      const ri = nodeArray[offsetI + NODE_OFFSET.RADIUS] || 8;

      for (let j = i + 1; j < nodeCount; j++) {
        const offsetJ = j * FLOATS_PER_NODE;
        const xj = nodeArray[offsetJ + NODE_OFFSET.X];
        const yj = nodeArray[offsetJ + NODE_OFFSET.Y];
        const rj = nodeArray[offsetJ + NODE_OFFSET.RADIUS] || 8;

        let dx = xi - xj;
        let dy = yi - yj;
        let l = Math.sqrt(dx * dx + dy * dy);
        const r = ri + rj;

        if (l < r && l > 0) {
          // Nodes overlap
          const k = (r - l) / l * strength * 0.5;
          dx *= k;
          dy *= k;

          // Push apart
          const fxi = nodeArray[offsetI + NODE_OFFSET.FX];
          const fyi = nodeArray[offsetI + NODE_OFFSET.FY];
          if (isNaN(fxi) || isNaN(fyi)) {
            nodeArray[offsetI + NODE_OFFSET.X] += dx;
            nodeArray[offsetI + NODE_OFFSET.Y] += dy;
          }

          const fxj = nodeArray[offsetJ + NODE_OFFSET.FX];
          const fyj = nodeArray[offsetJ + NODE_OFFSET.FY];
          if (isNaN(fxj) || isNaN(fyj)) {
            nodeArray[offsetJ + NODE_OFFSET.X] -= dx;
            nodeArray[offsetJ + NODE_OFFSET.Y] -= dy;
          }
        }
      }
    }
  }
}

/**
 * Apply radial force - attracts nodes to a specific radius from center
 */
function applyRadialForce(alpha: number): void {
  if (!nodeArray || !config) return;

  const { strength, radius, x: centerX, y: centerY } = config.radial;

  for (let i = 0; i < nodeCount; i++) {
    const offset = i * FLOATS_PER_NODE;
    const fx = nodeArray[offset + NODE_OFFSET.FX];
    const fy = nodeArray[offset + NODE_OFFSET.FY];

    // Skip fixed nodes
    if (!isNaN(fx) && !isNaN(fy)) continue;

    const x = nodeArray[offset + NODE_OFFSET.X];
    const y = nodeArray[offset + NODE_OFFSET.Y];

    const dx = x - centerX;
    const dy = y - centerY;
    const r = Math.sqrt(dx * dx + dy * dy);

    if (r > 0) {
      const k = (radius - r) * strength * alpha / r;
      nodeArray[offset + NODE_OFFSET.VX] += dx * k;
      nodeArray[offset + NODE_OFFSET.VY] += dy * k;
    }
  }
}

/**
 * Update positions from velocities with decay
 */
function updatePositions(): void {
  if (!nodeArray || !config) return;

  const velocityDecay = config.simulation.velocityDecay;

  for (let i = 0; i < nodeCount; i++) {
    const offset = i * FLOATS_PER_NODE;
    const fx = nodeArray[offset + NODE_OFFSET.FX];
    const fy = nodeArray[offset + NODE_OFFSET.FY];

    // Fixed nodes don't move
    if (!isNaN(fx) && !isNaN(fy)) {
      nodeArray[offset + NODE_OFFSET.X] = fx;
      nodeArray[offset + NODE_OFFSET.Y] = fy;
      nodeArray[offset + NODE_OFFSET.VX] = 0;
      nodeArray[offset + NODE_OFFSET.VY] = 0;
      continue;
    }

    // Apply velocity with decay
    const vx = nodeArray[offset + NODE_OFFSET.VX] * velocityDecay;
    const vy = nodeArray[offset + NODE_OFFSET.VY] * velocityDecay;

    nodeArray[offset + NODE_OFFSET.VX] = vx;
    nodeArray[offset + NODE_OFFSET.VY] = vy;
    nodeArray[offset + NODE_OFFSET.X] += vx;
    nodeArray[offset + NODE_OFFSET.Y] += vy;
  }
}

// ============================================================
// Barnes-Hut Quadtree
// ============================================================

interface QuadtreeNode {
  x: number;
  y: number;
  size: number;
  cx: number; // Center of mass x
  cy: number; // Center of mass y
  mass: number;
  count: number;
  children: (QuadtreeNode | null)[];
}

function buildQuadtree(): QuadtreeNode | null {
  if (!nodeArray || nodeCount === 0) return null;

  // Find bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < nodeCount; i++) {
    const offset = i * FLOATS_PER_NODE;
    const x = nodeArray[offset + NODE_OFFSET.X];
    const y = nodeArray[offset + NODE_OFFSET.Y];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Make square bounds
  const size = Math.max(maxX - minX, maxY - minY) + 1;

  // Create root
  const root: QuadtreeNode = {
    x: minX,
    y: minY,
    size,
    cx: 0,
    cy: 0,
    mass: 0,
    count: 0,
    children: [null, null, null, null],
  };

  // Insert all nodes
  for (let i = 0; i < nodeCount; i++) {
    const offset = i * FLOATS_PER_NODE;
    const x = nodeArray[offset + NODE_OFFSET.X];
    const y = nodeArray[offset + NODE_OFFSET.Y];
    const mass = nodeArray[offset + NODE_OFFSET.MASS] || 1;
    insertNode(root, x, y, mass);
  }

  return root;
}

function insertNode(
  node: QuadtreeNode,
  x: number,
  y: number,
  mass: number
): void {
  // Update center of mass
  const totalMass = node.mass + mass;
  node.cx = (node.cx * node.mass + x * mass) / totalMass;
  node.cy = (node.cy * node.mass + y * mass) / totalMass;
  node.mass = totalMass;
  node.count++;

  // If leaf node
  if (node.count === 1) return;

  // Determine quadrant
  const midX = node.x + node.size / 2;
  const midY = node.y + node.size / 2;
  const quadrant = (x < midX ? 0 : 1) + (y < midY ? 0 : 2);

  // Create child if needed
  if (!node.children[quadrant]) {
    const childSize = node.size / 2;
    node.children[quadrant] = {
      x: quadrant & 1 ? midX : node.x,
      y: quadrant & 2 ? midY : node.y,
      size: childSize,
      cx: 0,
      cy: 0,
      mass: 0,
      count: 0,
      children: [null, null, null, null],
    };
  }

  // Recurse
  insertNode(node.children[quadrant]!, x, y, mass);
}

// ============================================================
// Utilities
// ============================================================

function sendMessage(message: WorkerOutMessage): void {
  self.postMessage(message);
}

function sendError(error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  sendMessage({ type: "error", message: errorMessage, stack });
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const output = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(
        targetValue as object,
        sourceValue as object
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue as T[keyof T];
    }
  }
  return output;
}

// Export for type checking (worker runs in its own context)
export {};
