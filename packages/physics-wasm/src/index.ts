/**
 * @exocortex/physics-wasm
 *
 * High-performance WebAssembly physics engine for force-directed graph simulation.
 *
 * This package provides a WebAssembly-accelerated physics simulation using:
 * - Barnes-Hut algorithm for O(N log N) charge/repulsion forces
 * - Linear memory layout for cache efficiency
 * - Automatic JavaScript fallback if WASM is not available
 *
 * @example
 * ```typescript
 * import { createPhysicsEngine, PhysicsNode, PhysicsEdge } from '@exocortex/physics-wasm';
 *
 * const engine = await createPhysicsEngine();
 *
 * const nodes: PhysicsNode[] = [
 *   { index: 0, x: 100, y: 100 },
 *   { index: 1, x: 200, y: 200 },
 * ];
 *
 * const edges: PhysicsEdge[] = [
 *   { source: 0, target: 1 },
 * ];
 *
 * engine.initialize(nodes, edges);
 * engine.setParams({ chargeStrength: -500, linkDistance: 150 });
 *
 * // Run simulation loop
 * function animate() {
 *   if (engine.isActive()) {
 *     engine.tick();
 *     const positions = engine.getPositions();
 *     // Render positions...
 *     requestAnimationFrame(animate);
 *   }
 * }
 * animate();
 * ```
 *
 * @packageDocumentation
 * @module physics-wasm
 */

export { PhysicsEngine, createPhysicsEngine } from "./PhysicsEngine";

export type {
  PhysicsEngine as IPhysicsEngine,
  PhysicsNode,
  PhysicsEdge,
  PhysicsParams,
  BoundingBox,
  PhysicsWasmExports,
} from "./types";

export { DEFAULT_PHYSICS_PARAMS } from "./types";
