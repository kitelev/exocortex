/**
 * WebAssembly Physics Engine for Force-Directed Graph Simulation
 *
 * Implements a high-performance physics simulation using:
 * - Barnes-Hut algorithm for O(N log N) charge/repulsion forces
 * - Linear memory layout for cache efficiency
 * - SIMD-ready numeric operations
 *
 * Memory Layout (per node, 32 bytes / 8 floats):
 * - [0] x position
 * - [1] y position
 * - [2] vx velocity
 * - [3] vy velocity
 * - [4] fx fixed x (NaN if not fixed)
 * - [5] fy fixed y (NaN if not fixed)
 * - [6] mass
 * - [7] radius
 *
 * @module physics-wasm
 */

// ============================================================
// Memory Layout Constants
// ============================================================

/** Stride per node in f32 values (8 floats = 32 bytes) */
const NODE_STRIDE: i32 = 8;

/** Stride per edge in i32 values (3 ints = 12 bytes: source, target, strength as fixed-point) */
const EDGE_STRIDE: i32 = 3;

/** Maximum number of nodes supported */
const MAX_NODES: i32 = 50000;

/** Maximum number of edges supported */
const MAX_EDGES: i32 = 200000;

// ============================================================
// Memory Buffers (allocated at module load)
// ============================================================

/** Node data: [x, y, vx, vy, fx, fy, mass, radius] per node */
const nodeData = new Float32Array(MAX_NODES * NODE_STRIDE);

/** Edge data: [source, target, strength] per edge */
const edgeData = new Int32Array(MAX_EDGES * EDGE_STRIDE);

/** Quadtree for Barnes-Hut: [cx, cy, mass, child0, child1, child2, child3, nodeIndex] */
const quadtreeData = new Float32Array(MAX_NODES * 4 * 8);

// ============================================================
// Simulation State
// ============================================================

/** Current number of nodes */
let nodeCount: i32 = 0;

/** Current number of edges */
let edgeCount: i32 = 0;

/** Simulation alpha (cooling parameter) */
let alpha: f32 = 1.0;

/** Alpha decay rate */
let alphaDecay: f32 = 0.0228;

/** Alpha minimum (stop threshold) */
let alphaMin: f32 = 0.001;

/** Alpha target */
let alphaTarget: f32 = 0.0;

/** Velocity decay (friction) */
let velocityDecay: f32 = 0.4;

// Force parameters
let centerStrength: f32 = 0.1;
let centerX: f32 = 0.0;
let centerY: f32 = 0.0;

let chargeStrength: f32 = -300.0;
let chargeTheta: f32 = 0.9;
let chargeDistanceMin: f32 = 1.0;
let chargeDistanceMax: f32 = 10000.0;

let linkStrength: f32 = 1.0;
let linkDistance: f32 = 100.0;

let collisionRadius: f32 = 8.0;
let collisionStrength: f32 = 0.7;
let collisionIterations: i32 = 1;

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize the physics simulation with node and edge counts.
 *
 * @param nodes - Number of nodes
 * @param edges - Number of edges
 */
export function init(nodes: i32, edges: i32): void {
  nodeCount = min(nodes, MAX_NODES);
  edgeCount = min(edges, MAX_EDGES);
  alpha = 1.0;

  // Initialize nodes to zero
  for (let i: i32 = 0; i < nodeCount * NODE_STRIDE; i++) {
    nodeData[i] = 0.0;
  }

  // Initialize edges to zero
  for (let i: i32 = 0; i < edgeCount * EDGE_STRIDE; i++) {
    edgeData[i] = 0;
  }
}

/**
 * Set simulation parameters.
 */
export function setParams(
  _alpha: f32,
  _alphaDecay: f32,
  _velocityDecay: f32,
  _centerStrength: f32,
  _centerX: f32,
  _centerY: f32,
  _chargeStrength: f32,
  _chargeTheta: f32,
  _chargeDistanceMin: f32,
  _chargeDistanceMax: f32,
  _linkStrength: f32,
  _linkDistance: f32,
  _collisionRadius: f32,
  _collisionStrength: f32
): void {
  alpha = _alpha;
  alphaDecay = _alphaDecay;
  velocityDecay = _velocityDecay;
  centerStrength = _centerStrength;
  centerX = _centerX;
  centerY = _centerY;
  chargeStrength = _chargeStrength;
  chargeTheta = _chargeTheta;
  chargeDistanceMin = _chargeDistanceMin;
  chargeDistanceMax = _chargeDistanceMax;
  linkStrength = _linkStrength;
  linkDistance = _linkDistance;
  collisionRadius = _collisionRadius;
  collisionStrength = _collisionStrength;
}

// ============================================================
// Node Data Access
// ============================================================

/**
 * Set node position.
 */
export function setNodePosition(index: i32, x: f32, y: f32): void {
  if (index >= 0 && index < nodeCount) {
    const offset = index * NODE_STRIDE;
    nodeData[offset + 0] = x;
    nodeData[offset + 1] = y;
  }
}

/**
 * Set node velocity.
 */
export function setNodeVelocity(index: i32, vx: f32, vy: f32): void {
  if (index >= 0 && index < nodeCount) {
    const offset = index * NODE_STRIDE;
    nodeData[offset + 2] = vx;
    nodeData[offset + 3] = vy;
  }
}

/**
 * Set node mass.
 */
export function setNodeMass(index: i32, mass: f32): void {
  if (index >= 0 && index < nodeCount) {
    nodeData[index * NODE_STRIDE + 6] = mass;
  }
}

/**
 * Set node radius.
 */
export function setNodeRadius(index: i32, radius: f32): void {
  if (index >= 0 && index < nodeCount) {
    nodeData[index * NODE_STRIDE + 7] = radius;
  }
}

/**
 * Set node fixed position.
 */
export function setNodeFixed(index: i32, fx: f32, fy: f32): void {
  if (index >= 0 && index < nodeCount) {
    const offset = index * NODE_STRIDE;
    nodeData[offset + 4] = fx;
    nodeData[offset + 5] = fy;
  }
}

/**
 * Clear node fixed position.
 */
export function clearNodeFixed(index: i32): void {
  if (index >= 0 && index < nodeCount) {
    const offset = index * NODE_STRIDE;
    nodeData[offset + 4] = f32.NaN;
    nodeData[offset + 5] = f32.NaN;
  }
}

/**
 * Get node X position.
 */
export function getNodeX(index: i32): f32 {
  if (index >= 0 && index < nodeCount) {
    return nodeData[index * NODE_STRIDE + 0];
  }
  return 0.0;
}

/**
 * Get node Y position.
 */
export function getNodeY(index: i32): f32 {
  if (index >= 0 && index < nodeCount) {
    return nodeData[index * NODE_STRIDE + 1];
  }
  return 0.0;
}

/**
 * Get node X velocity.
 */
export function getNodeVX(index: i32): f32 {
  if (index >= 0 && index < nodeCount) {
    return nodeData[index * NODE_STRIDE + 2];
  }
  return 0.0;
}

/**
 * Get node Y velocity.
 */
export function getNodeVY(index: i32): f32 {
  if (index >= 0 && index < nodeCount) {
    return nodeData[index * NODE_STRIDE + 3];
  }
  return 0.0;
}

// ============================================================
// Edge Data Access
// ============================================================

/**
 * Set edge data.
 */
export function setEdge(index: i32, source: i32, target: i32, strength: f32): void {
  if (index >= 0 && index < edgeCount) {
    const offset = index * EDGE_STRIDE;
    edgeData[offset + 0] = source;
    edgeData[offset + 1] = target;
    // Store strength as fixed-point (multiply by 1000)
    edgeData[offset + 2] = i32(strength * 1000.0);
  }
}

// ============================================================
// Barnes-Hut Quadtree
// ============================================================

// Quadtree node structure (simplified for WASM)
// We use a flattened array approach with inline allocation

/** Number of quadtree nodes allocated */
let qtNodeCount: i32 = 0;

/** Quadtree node stride: [cx, cy, mass, size, child0, child1, child2, child3, nodeIndex, padding] */
const QT_STRIDE: i32 = 10;

/** Quadtree data storage */
const qtData = new Float32Array(MAX_NODES * 4 * QT_STRIDE);

/**
 * Initialize quadtree for current frame.
 */
function initQuadtree(): void {
  qtNodeCount = 0;
}

/**
 * Allocate a new quadtree node.
 */
function allocQuadtreeNode(cx: f32, cy: f32, size: f32): i32 {
  const idx = qtNodeCount++;
  const offset = idx * QT_STRIDE;
  qtData[offset + 0] = cx;          // center x
  qtData[offset + 1] = cy;          // center y
  qtData[offset + 2] = 0.0;         // total mass
  qtData[offset + 3] = size;        // node size
  qtData[offset + 4] = -1.0;        // child 0 (NE)
  qtData[offset + 5] = -1.0;        // child 1 (NW)
  qtData[offset + 6] = -1.0;        // child 2 (SW)
  qtData[offset + 7] = -1.0;        // child 3 (SE)
  qtData[offset + 8] = -1.0;        // node index (-1 = empty or internal)
  qtData[offset + 9] = 0.0;         // mass-weighted x
  return idx;
}

/**
 * Get quadrant for a point relative to a center.
 * 0 = NE, 1 = NW, 2 = SW, 3 = SE
 */
function getQuadrant(px: f32, py: f32, cx: f32, cy: f32): i32 {
  if (px >= cx) {
    return py >= cy ? 0 : 3;
  } else {
    return py >= cy ? 1 : 2;
  }
}

/**
 * Insert a node into the quadtree.
 */
function insertIntoQuadtree(qtIdx: i32, nodeIdx: i32, x: f32, y: f32, mass: f32): void {
  const offset = qtIdx * QT_STRIDE;
  const cx = qtData[offset + 0];
  const cy = qtData[offset + 1];
  const size = qtData[offset + 3];
  const existingNode = i32(qtData[offset + 8]);

  // Update mass and center of mass
  const oldMass = qtData[offset + 2];
  const newMass = oldMass + mass;
  if (newMass > 0) {
    const oldMcx = qtData[offset + 9];
    qtData[offset + 9] = (oldMcx * oldMass + x * mass) / newMass;
  }
  qtData[offset + 2] = newMass;

  // If this is an empty leaf, store the node
  if (existingNode < 0 && qtData[offset + 4] < 0) {
    qtData[offset + 8] = f32(nodeIdx);
    return;
  }

  // If this was a leaf with a node, we need to subdivide
  if (existingNode >= 0) {
    // Get existing node position
    const existingOffset = existingNode * NODE_STRIDE;
    const ex = nodeData[existingOffset + 0];
    const ey = nodeData[existingOffset + 1];
    const em = nodeData[existingOffset + 6];

    // Clear existing node from this quadtree node
    qtData[offset + 8] = -1.0;

    // Re-insert existing node into appropriate child
    const eq = getQuadrant(ex, ey, cx, cy);
    if (qtData[offset + 4 + eq] < 0) {
      const halfSize = size * 0.5;
      const qx = eq === 0 || eq === 3 ? cx + halfSize * 0.5 : cx - halfSize * 0.5;
      const qy = eq === 0 || eq === 1 ? cy + halfSize * 0.5 : cy - halfSize * 0.5;
      qtData[offset + 4 + eq] = f32(allocQuadtreeNode(qx, qy, halfSize));
    }
    insertIntoQuadtree(i32(qtData[offset + 4 + eq]), existingNode, ex, ey, em);
  }

  // Insert new node into appropriate child
  const q = getQuadrant(x, y, cx, cy);
  if (qtData[offset + 4 + q] < 0) {
    const halfSize = size * 0.5;
    const qx = q === 0 || q === 3 ? cx + halfSize * 0.5 : cx - halfSize * 0.5;
    const qy = q === 0 || q === 1 ? cy + halfSize * 0.5 : cy - halfSize * 0.5;
    qtData[offset + 4 + q] = f32(allocQuadtreeNode(qx, qy, halfSize));
  }
  insertIntoQuadtree(i32(qtData[offset + 4 + q]), nodeIdx, x, y, mass);
}

/**
 * Build the quadtree from current node positions.
 */
function buildQuadtree(): i32 {
  initQuadtree();

  // Calculate bounding box
  let minX: f32 = f32.MAX_VALUE;
  let maxX: f32 = f32.MIN_VALUE;
  let minY: f32 = f32.MAX_VALUE;
  let maxY: f32 = f32.MIN_VALUE;

  for (let i: i32 = 0; i < nodeCount; i++) {
    const offset = i * NODE_STRIDE;
    const x = nodeData[offset + 0];
    const y = nodeData[offset + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Create root node
  const size = max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const root = allocQuadtreeNode(cx, cy, size + 1.0);

  // Insert all nodes
  for (let i: i32 = 0; i < nodeCount; i++) {
    const offset = i * NODE_STRIDE;
    const x = nodeData[offset + 0];
    const y = nodeData[offset + 1];
    const mass = nodeData[offset + 6];
    insertIntoQuadtree(root, i, x, y, mass > 0 ? mass : 1.0);
  }

  return root;
}

// ============================================================
// Force Calculations
// ============================================================

/**
 * Apply center force.
 */
function applyCenter(): void {
  if (centerStrength <= 0) return;

  let sx: f32 = 0.0;
  let sy: f32 = 0.0;

  for (let i: i32 = 0; i < nodeCount; i++) {
    const offset = i * NODE_STRIDE;
    sx += nodeData[offset + 0];
    sy += nodeData[offset + 1];
  }

  sx = (sx / f32(nodeCount) - centerX) * centerStrength * alpha;
  sy = (sy / f32(nodeCount) - centerY) * centerStrength * alpha;

  for (let i: i32 = 0; i < nodeCount; i++) {
    const offset = i * NODE_STRIDE;
    nodeData[offset + 0] -= sx;
    nodeData[offset + 1] -= sy;
  }
}

/**
 * Apply charge force using Barnes-Hut approximation.
 */
function applyCharge(nodeIdx: i32, qtIdx: i32): void {
  const nodeOffset = nodeIdx * NODE_STRIDE;
  const nx = nodeData[nodeOffset + 0];
  const ny = nodeData[nodeOffset + 1];

  const qtOffset = qtIdx * QT_STRIDE;
  const qtCx = qtData[qtOffset + 0];
  const qtCy = qtData[qtOffset + 1];
  const qtMass = qtData[qtOffset + 2];
  const qtSize = qtData[qtOffset + 3];
  const qtNodeIdx = i32(qtData[qtOffset + 8]);

  // Distance to center of mass
  let dx = qtCx - nx;
  let dy = qtCy - ny;
  let d2 = dx * dx + dy * dy;

  // If it's a leaf with this same node, skip
  if (qtNodeIdx === nodeIdx) return;

  // Barnes-Hut criterion: if far enough, treat as point mass
  if (d2 > 0 && (qtSize * qtSize / d2 < chargeTheta * chargeTheta || qtNodeIdx >= 0)) {
    let d = Mathf.sqrt(d2);
    if (d < chargeDistanceMin) d = chargeDistanceMin;
    if (d > chargeDistanceMax) return;

    const strength = chargeStrength * alpha * qtMass / (d * d);
    nodeData[nodeOffset + 2] += dx / d * strength;
    nodeData[nodeOffset + 3] += dy / d * strength;
    return;
  }

  // Otherwise, recurse into children
  for (let i: i32 = 0; i < 4; i++) {
    const childIdx = i32(qtData[qtOffset + 4 + i]);
    if (childIdx >= 0) {
      applyCharge(nodeIdx, childIdx);
    }
  }
}

/**
 * Apply charge forces to all nodes.
 */
function applyChargeForce(): void {
  if (chargeStrength === 0) return;

  const root = buildQuadtree();

  for (let i: i32 = 0; i < nodeCount; i++) {
    applyCharge(i, root);
  }
}

/**
 * Apply link force.
 */
function applyLinkForce(): void {
  if (linkStrength <= 0) return;

  for (let i: i32 = 0; i < edgeCount; i++) {
    const offset = i * EDGE_STRIDE;
    const source = edgeData[offset + 0];
    const target = edgeData[offset + 1];
    const strength = f32(edgeData[offset + 2]) / 1000.0;

    if (source < 0 || source >= nodeCount) continue;
    if (target < 0 || target >= nodeCount) continue;

    const srcOffset = source * NODE_STRIDE;
    const tgtOffset = target * NODE_STRIDE;

    let dx = nodeData[tgtOffset + 0] - nodeData[srcOffset + 0];
    let dy = nodeData[tgtOffset + 1] - nodeData[srcOffset + 1];

    let d = Mathf.sqrt(dx * dx + dy * dy);
    if (d < 0.001) d = 0.001;

    const l = (d - linkDistance) / d * alpha * linkStrength * strength;

    dx *= l;
    dy *= l;

    // Apply to target (pull towards source)
    nodeData[tgtOffset + 2] -= dx * 0.5;
    nodeData[tgtOffset + 3] -= dy * 0.5;

    // Apply to source (pull towards target)
    nodeData[srcOffset + 2] += dx * 0.5;
    nodeData[srcOffset + 3] += dy * 0.5;
  }
}

/**
 * Apply collision force.
 */
function applyCollisionForce(): void {
  if (collisionStrength <= 0) return;

  for (let iter: i32 = 0; iter < collisionIterations; iter++) {
    for (let i: i32 = 0; i < nodeCount; i++) {
      const iOffset = i * NODE_STRIDE;
      const ix = nodeData[iOffset + 0];
      const iy = nodeData[iOffset + 1];
      const ir = nodeData[iOffset + 7] > 0 ? nodeData[iOffset + 7] : collisionRadius;

      for (let j: i32 = i + 1; j < nodeCount; j++) {
        const jOffset = j * NODE_STRIDE;
        const jx = nodeData[jOffset + 0];
        const jy = nodeData[jOffset + 1];
        const jr = nodeData[jOffset + 7] > 0 ? nodeData[jOffset + 7] : collisionRadius;

        let dx = jx - ix;
        let dy = jy - iy;
        let d = Mathf.sqrt(dx * dx + dy * dy);
        const minDist = ir + jr;

        if (d < minDist && d > 0) {
          const overlap = (minDist - d) / d * collisionStrength * alpha;
          dx *= overlap * 0.5;
          dy *= overlap * 0.5;

          nodeData[iOffset + 0] -= dx;
          nodeData[iOffset + 1] -= dy;
          nodeData[jOffset + 0] += dx;
          nodeData[jOffset + 1] += dy;
        }
      }
    }
  }
}

/**
 * Apply velocity and update positions.
 */
function applyVelocity(): void {
  for (let i: i32 = 0; i < nodeCount; i++) {
    const offset = i * NODE_STRIDE;
    let vx = nodeData[offset + 2];
    let vy = nodeData[offset + 3];
    const fx = nodeData[offset + 4];
    const fy = nodeData[offset + 5];

    // Apply velocity decay (friction)
    vx *= 1.0 - velocityDecay;
    vy *= 1.0 - velocityDecay;

    // Update velocity
    nodeData[offset + 2] = vx;
    nodeData[offset + 3] = vy;

    // Update position (or use fixed position)
    if (isNaN(fx)) {
      nodeData[offset + 0] += vx;
    } else {
      nodeData[offset + 0] = fx;
      nodeData[offset + 2] = 0;
    }

    if (isNaN(fy)) {
      nodeData[offset + 1] += vy;
    } else {
      nodeData[offset + 1] = fy;
      nodeData[offset + 3] = 0;
    }
  }
}

// ============================================================
// Main Simulation Tick
// ============================================================

/**
 * Run simulation for specified number of iterations.
 * Returns the new alpha value.
 */
export function tick(iterations: i32): f32 {
  for (let i: i32 = 0; i < iterations; i++) {
    // Decay alpha
    alpha += (alphaTarget - alpha) * alphaDecay;

    if (alpha < alphaMin) {
      alpha = 0;
      break;
    }

    // Apply forces
    applyCenter();
    applyChargeForce();
    applyLinkForce();
    applyCollisionForce();

    // Update positions
    applyVelocity();
  }

  return alpha;
}

// ============================================================
// Bulk Operations
// ============================================================

/**
 * Get pointer to node data for bulk read.
 * Returns the byte offset into memory.
 */
export function getNodeDataPtr(): i32 {
  return nodeData.dataStart;
}

/**
 * Get pointer to edge data for bulk read.
 */
export function getEdgeDataPtr(): i32 {
  return edgeData.dataStart;
}

/**
 * Get the current alpha value.
 */
export function getAlpha(): f32 {
  return alpha;
}

/**
 * Set the alpha value directly.
 */
export function setAlpha(_alpha: f32): void {
  alpha = _alpha;
}

/**
 * Get the node count.
 */
export function getNodeCount(): i32 {
  return nodeCount;
}

/**
 * Get the edge count.
 */
export function getEdgeCount(): i32 {
  return edgeCount;
}

// ============================================================
// Hit Testing (for mouse interaction)
// ============================================================

/**
 * Find the closest node to a point within a given radius.
 * Returns node index or -1 if none found.
 */
export function findNodeAt(x: f32, y: f32, radius: f32): i32 {
  let closestIdx: i32 = -1;
  let closestDist: f32 = radius * radius;

  for (let i: i32 = 0; i < nodeCount; i++) {
    const offset = i * NODE_STRIDE;
    const dx = nodeData[offset + 0] - x;
    const dy = nodeData[offset + 1] - y;
    const d2 = dx * dx + dy * dy;

    if (d2 < closestDist) {
      closestDist = d2;
      closestIdx = i;
    }
  }

  return closestIdx;
}

/**
 * Calculate bounding box of all nodes.
 * Returns [minX, minY, maxX, maxY] as 4 consecutive floats at the given pointer.
 */
export function getBoundingBox(): Float32Array {
  const result = new Float32Array(4);

  if (nodeCount === 0) {
    result[0] = 0;
    result[1] = 0;
    result[2] = 0;
    result[3] = 0;
    return result;
  }

  let minX: f32 = f32.MAX_VALUE;
  let maxX: f32 = f32.MIN_VALUE;
  let minY: f32 = f32.MAX_VALUE;
  let maxY: f32 = f32.MIN_VALUE;

  for (let i: i32 = 0; i < nodeCount; i++) {
    const offset = i * NODE_STRIDE;
    const x = nodeData[offset + 0];
    const y = nodeData[offset + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  result[0] = minX;
  result[1] = minY;
  result[2] = maxX;
  result[3] = maxY;

  return result;
}
