/**
 * 3D Graph Visualization Module
 *
 * Provides WebGL2-based 3D graph rendering using Three.js with:
 * - Scene management with orbit controls
 * - Force-directed layout in 3D space
 * - Node and edge rendering with spheres and lines
 * - Label sprites with billboard behavior
 * - Raycasting for node interaction
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

// Scene manager
export { Scene3DManager, createScene3DManager } from "./Scene3DManager";

// Force simulation
export {
  ForceSimulation3D,
  createForceSimulation3D,
} from "./ForceSimulation3D";
export type {
  SimulationEventType,
  Simulation3DEvent,
  Simulation3DEventListener,
} from "./ForceSimulation3D";

// Types and configuration
export type {
  Point3D,
  Vector3D,
  GraphNode3D,
  GraphEdge3D,
  GraphData3D,
  Scene3DConfig,
  Node3DStyle,
  Edge3DStyle,
  Label3DStyle,
  OrbitControlsConfig,
  ForceSimulation3DConfig,
  Viewport3DState,
  Renderer3DStats,
  Scene3DEventType,
  Scene3DEvent,
  Scene3DEventListener,
} from "./types3d";

export {
  DEFAULT_SCENE_3D_CONFIG,
  DEFAULT_NODE_3D_STYLE,
  DEFAULT_EDGE_3D_STYLE,
  DEFAULT_LABEL_3D_STYLE,
  DEFAULT_ORBIT_CONTROLS_CONFIG,
  DEFAULT_FORCE_SIMULATION_3D_CONFIG,
} from "./types3d";
