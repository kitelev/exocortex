/**
 * 3D Graph Types
 *
 * Defines types and interfaces for 3D graph visualization components.
 * Extends the base graph types with 3D-specific properties.
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

/**
 * 3D Point coordinates
 */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * 3D Vector with optional velocity components
 */
export interface Vector3D extends Point3D {
  vx?: number;
  vy?: number;
  vz?: number;
}

/**
 * 3D Node data for graph visualization
 */
export interface GraphNode3D {
  /** Unique identifier for the node */
  id: string;

  /** Display label for the node */
  label: string;

  /** Path to the asset file */
  path: string;

  /** Additional node metadata */
  metadata?: Record<string, unknown>;

  /** Optional node group/category */
  group?: string;

  /** Optional node color (hex string) */
  color?: string;

  /** Optional node size multiplier */
  size?: number;

  /** 3D position coordinates */
  x?: number;
  y?: number;
  z?: number;

  /** Velocity for force simulation */
  vx?: number;
  vy?: number;
  vz?: number;

  /** Fixed position (pinned nodes) */
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

/**
 * 3D Edge data for graph visualization
 */
export interface GraphEdge3D {
  /** Unique identifier for the edge */
  id: string;

  /** Source node ID or reference */
  source: string | GraphNode3D;

  /** Target node ID or reference */
  target: string | GraphNode3D;

  /** Edge label */
  label?: string;

  /** Property that created this edge */
  property?: string;

  /** Optional edge weight */
  weight?: number;

  /** Optional edge color (hex string) */
  color?: string;
}

/**
 * 3D Graph data container
 */
export interface GraphData3D {
  /** All nodes in the graph */
  nodes: GraphNode3D[];

  /** All edges in the graph */
  edges: GraphEdge3D[];
}

/**
 * Configuration options for Scene3DManager
 */
export interface Scene3DConfig {
  /** Background color (hex number) */
  backgroundColor: number;

  /** Ambient light intensity (0-1) */
  ambientLightIntensity: number;

  /** Directional light intensity (0-1) */
  directionalLightIntensity: number;

  /** Camera field of view in degrees */
  cameraFov: number;

  /** Camera near clipping plane */
  cameraNear: number;

  /** Camera far clipping plane */
  cameraFar: number;

  /** Enable anti-aliasing */
  antialias: boolean;

  /** Device pixel ratio (default: min(devicePixelRatio, 2)) */
  pixelRatio: number;

  /** Initial camera distance from center */
  cameraDistance: number;

  /** Enable fog for depth perception */
  enableFog: boolean;

  /** Fog near distance */
  fogNear: number;

  /** Fog far distance */
  fogFar: number;
}

/**
 * Node visual style configuration for 3D
 */
export interface Node3DStyle {
  /** Base radius in world units */
  radius: number;

  /** Node color (hex number) */
  color: number;

  /** Emissive color for glow effect */
  emissive: number;

  /** Emissive intensity */
  emissiveIntensity: number;

  /** Material roughness (0-1) */
  roughness: number;

  /** Material metalness (0-1) */
  metalness: number;

  /** Sphere segments (detail level) */
  segments: number;
}

/**
 * Edge visual style configuration for 3D
 */
export interface Edge3DStyle {
  /** Line width in pixels */
  lineWidth: number;

  /** Line color (hex number) */
  color: number;

  /** Line opacity (0-1) */
  opacity: number;

  /** Use tube geometry instead of lines */
  useTube: boolean;

  /** Tube radius (if using tubes) */
  tubeRadius: number;

  /** Tube segments (detail level) */
  tubeSegments: number;
}

/**
 * Label visual style configuration for 3D
 */
export interface Label3DStyle {
  /** Font size in pixels */
  fontSize: number;

  /** Font family */
  fontFamily: string;

  /** Text color (CSS color) */
  color: string;

  /** Background color (CSS color or null for transparent) */
  backgroundColor: string | null;

  /** Padding around text */
  padding: number;

  /** Billboard behavior - always face camera */
  billboard: boolean;

  /** Scale factor for sprite size */
  scale: number;

  /** Y offset from node center */
  yOffset: number;
}

/**
 * Camera orbit controls configuration
 */
export interface OrbitControlsConfig {
  /** Enable orbit rotation */
  enableRotate: boolean;

  /** Enable zoom */
  enableZoom: boolean;

  /** Enable panning */
  enablePan: boolean;

  /** Enable damping (inertia) */
  enableDamping: boolean;

  /** Damping factor */
  dampingFactor: number;

  /** Rotation speed multiplier */
  rotateSpeed: number;

  /** Zoom speed multiplier */
  zoomSpeed: number;

  /** Pan speed multiplier */
  panSpeed: number;

  /** Minimum zoom distance */
  minDistance: number;

  /** Maximum zoom distance */
  maxDistance: number;

  /** Minimum polar angle (vertical rotation limit) */
  minPolarAngle: number;

  /** Maximum polar angle (vertical rotation limit) */
  maxPolarAngle: number;

  /** Auto-rotate the scene */
  autoRotate: boolean;

  /** Auto-rotate speed */
  autoRotateSpeed: number;
}

/**
 * 3D Force simulation configuration
 */
export interface ForceSimulation3DConfig {
  /** Repulsion strength between nodes */
  chargeStrength: number;

  /** Target distance between linked nodes */
  linkDistance: number;

  /** Center attraction strength */
  centerStrength: number;

  /** Collision detection radius multiplier */
  collisionRadius: number;

  /** Simulation alpha (energy level) */
  alpha: number;

  /** Target alpha for convergence */
  alphaTarget: number;

  /** Alpha decay rate per tick */
  alphaDecay: number;

  /** Velocity decay (damping) per tick */
  velocityDecay: number;

  /** Minimum alpha before stopping */
  alphaMin: number;

  /** Use Barnes-Hut optimization */
  useBarnesHut: boolean;

  /** Barnes-Hut theta parameter */
  theta: number;
}

/**
 * 3D Viewport state
 */
export interface Viewport3DState {
  /** Camera position */
  cameraPosition: Point3D;

  /** Camera target (look-at point) */
  cameraTarget: Point3D;

  /** Camera up vector */
  cameraUp: Point3D;

  /** Current zoom level */
  zoom: number;
}

/**
 * 3D Renderer statistics
 */
export interface Renderer3DStats {
  /** Number of rendered nodes */
  nodeCount: number;

  /** Number of rendered edges */
  edgeCount: number;

  /** Number of rendered labels */
  labelCount: number;

  /** Current frames per second */
  fps: number;

  /** Draw calls per frame */
  drawCalls: number;

  /** Triangles rendered per frame */
  triangles: number;

  /** GPU memory usage estimate (bytes) */
  memoryUsage: number;
}

/**
 * 3D Event types for scene interactions
 */
export type Scene3DEventType =
  | "nodeClick"
  | "nodeHover"
  | "nodeHoverEnd"
  | "edgeClick"
  | "edgeHover"
  | "edgeHoverEnd"
  | "backgroundClick"
  | "cameraChange"
  | "render";

/**
 * 3D Scene event data
 */
export interface Scene3DEvent {
  /** Event type */
  type: Scene3DEventType;

  /** Target node (if applicable) */
  node?: GraphNode3D;

  /** Target edge (if applicable) */
  edge?: GraphEdge3D;

  /** 3D world position of event */
  worldPosition?: Point3D;

  /** 2D screen position of event */
  screenPosition?: { x: number; y: number };

  /** Original DOM event */
  originalEvent?: MouseEvent;
}

/**
 * Event listener callback for 3D scene events
 */
export type Scene3DEventListener = (event: Scene3DEvent) => void;

/**
 * Default configuration values
 */
export const DEFAULT_SCENE_3D_CONFIG: Scene3DConfig = {
  backgroundColor: 0x1a1a2e,
  ambientLightIntensity: 0.4,
  directionalLightIntensity: 0.8,
  cameraFov: 60,
  cameraNear: 0.1,
  cameraFar: 10000,
  antialias: true,
  pixelRatio: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
  cameraDistance: 500,
  enableFog: true,
  fogNear: 500,
  fogFar: 2000,
};

export const DEFAULT_NODE_3D_STYLE: Node3DStyle = {
  radius: 8,
  color: 0x6366f1,
  emissive: 0x6366f1,
  emissiveIntensity: 0.2,
  roughness: 0.7,
  metalness: 0.3,
  segments: 16,
};

export const DEFAULT_EDGE_3D_STYLE: Edge3DStyle = {
  lineWidth: 1,
  color: 0x64748b,
  opacity: 0.6,
  useTube: false,
  tubeRadius: 0.5,
  tubeSegments: 8,
};

export const DEFAULT_LABEL_3D_STYLE: Label3DStyle = {
  fontSize: 14,
  fontFamily: "Inter, system-ui, sans-serif",
  color: "#e2e8f0",
  backgroundColor: "rgba(26, 26, 46, 0.8)",
  padding: 4,
  billboard: true,
  scale: 1,
  yOffset: 12,
};

export const DEFAULT_ORBIT_CONTROLS_CONFIG: OrbitControlsConfig = {
  enableRotate: true,
  enableZoom: true,
  enablePan: true,
  enableDamping: true,
  dampingFactor: 0.05,
  rotateSpeed: 1.0,
  zoomSpeed: 1.0,
  panSpeed: 1.0,
  minDistance: 10,
  maxDistance: 5000,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  autoRotate: false,
  autoRotateSpeed: 2.0,
};

export const DEFAULT_FORCE_SIMULATION_3D_CONFIG: ForceSimulation3DConfig = {
  chargeStrength: -300,
  linkDistance: 100,
  centerStrength: 0.1,
  collisionRadius: 1.5,
  alpha: 1,
  alphaTarget: 0,
  alphaDecay: 0.0228,
  velocityDecay: 0.4,
  alphaMin: 0.01, // Stops simulation when forces stabilize (acceptance criteria: alpha < 0.01)
  useBarnesHut: true,
  theta: 0.9,
};
