/**
 * 3D Graph Visualization Module
 *
 * Provides WebGL2-based 3D graph rendering using Three.js with:
 * - Scene management with orbit controls
 * - Force-directed layout in 3D space
 * - Node and edge rendering with spheres and lines
 * - Label sprites with billboard behavior
 * - Raycasting for node interaction
 * - Theme-aware coloring (dark/light mode support)
 * - Ontology-based node coloring
 * - Predicate-based edge coloring
 * - LOD (Level of Detail) for labels
 * - Frustum culling for off-screen nodes
 * - WebGL context loss recovery
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

// Scene manager
export { Scene3DManager, createScene3DManager } from "./Scene3DManager";

// Performance manager
export {
  Graph3DPerformanceManager,
  createGraph3DPerformanceManager,
  DEFAULT_LOD_CONFIG,
  DEFAULT_FRUSTUM_CULLING_CONFIG,
  DEFAULT_WEBGL_RECOVERY_CONFIG,
  DEFAULT_PERFORMANCE_CONFIG,
} from "./Graph3DPerformanceManager";
export type {
  LODConfig,
  FrustumCullingConfig,
  WebGLRecoveryConfig,
  PerformanceConfig,
  NodeVisibility,
  PerformanceEventType,
  PerformanceEvent,
  PerformanceEventListener,
  PerformanceStats,
} from "./Graph3DPerformanceManager";

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

// Theme service
export {
  Graph3DThemeService,
  createGraph3DThemeService,
  DEFAULT_THEME_CONFIG,
} from "./Graph3DThemeService";
export type {
  ThemeMode,
  OntologyNamespace,
  ThemeColors,
  Graph3DThemeConfig,
  Graph3DThemeEventType,
  Graph3DThemeEvent,
  Graph3DThemeEventListener,
} from "./Graph3DThemeService";

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
