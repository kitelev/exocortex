/**
 * Type definitions for the Graph Configuration system.
 * Provides complete configuration schema for graph visualization.
 */

// ============================================================
// Physics Configuration
// ============================================================

/**
 * Force simulation parameters
 */
export interface SimulationConfig {
  /** Minimum alpha before stopping (default: 0.001) */
  alphaMin: number;
  /** Alpha decay rate (default: 0.0228) */
  alphaDecay: number;
  /** Target alpha (default: 0) */
  alphaTarget: number;
  /** Velocity decay / friction (default: 0.4) */
  velocityDecay: number;
}

/**
 * Center force configuration
 */
export interface CenterForceConfig {
  /** Enable center force */
  enabled: boolean;
  /** Force strength (default: 0.1) */
  strength: number;
  /** Center X position (default: viewport width / 2) */
  x?: number;
  /** Center Y position (default: viewport height / 2) */
  y?: number;
}

/**
 * Link force configuration
 */
export interface LinkForceConfig {
  /** Enable link force */
  enabled: boolean;
  /** Target link distance (default: 100) */
  distance: number;
  /** Spring strength (default: 1) */
  strength: number;
  /** Constraint iterations (default: 1) */
  iterations: number;
}

/**
 * Many-body / charge force configuration
 */
export interface ChargeForceConfig {
  /** Enable charge force */
  enabled: boolean;
  /** Repulsion strength - negative for repulsion (default: -300) */
  strength: number;
  /** Minimum distance (default: 1) */
  distanceMin: number;
  /** Maximum distance (default: Infinity) */
  distanceMax: number;
  /** Barnes-Hut theta (default: 0.9) */
  theta: number;
}

/**
 * Collision force configuration
 */
export interface CollisionForceConfig {
  /** Enable collision force */
  enabled: boolean;
  /** Collision radius - 'auto' uses node radius */
  radius: number | "auto";
  /** Collision strength (default: 0.7) */
  strength: number;
  /** Collision iterations (default: 1) */
  iterations: number;
}

/**
 * Radial force configuration (for radial layout)
 */
export interface RadialForceConfig {
  /** Enable radial force */
  enabled: boolean;
  /** Force strength (default: 0.1) */
  strength: number;
  /** Target radius from center */
  radius: number;
  /** Center X */
  x?: number;
  /** Center Y */
  y?: number;
}

/**
 * Complete physics configuration
 */
export interface PhysicsConfig {
  /** Enable physics simulation */
  enabled: boolean;
  /** Force simulation parameters */
  simulation: SimulationConfig;
  /** Center force */
  center: CenterForceConfig;
  /** Link force */
  link: LinkForceConfig;
  /** Many-body force */
  charge: ChargeForceConfig;
  /** Collision force */
  collision: CollisionForceConfig;
  /** Radial force */
  radial: RadialForceConfig;
}

// ============================================================
// Rendering Configuration
// ============================================================

/**
 * Performance rendering settings
 */
export interface PerformanceConfig {
  /** Maximum frames per second (default: 60) */
  maxFPS: number;
  /** Pixel ratio multiplier (default: window.devicePixelRatio or 1) */
  pixelRatio: number | "auto";
  /** Enable antialiasing */
  antialias: boolean;
}

/**
 * Node rendering configuration
 */
export interface NodeRenderConfig {
  /** Default node radius (default: 8) */
  defaultRadius: number;
  /** Minimum radius when scaling by property */
  minRadius: number;
  /** Maximum radius when scaling by property */
  maxRadius: number;
  /** Scale radius by property (e.g., 'degree', 'importance') */
  sizeBy?: string;
  /** Border width (default: 1) */
  borderWidth: number;
  /** Show shadow */
  showShadow: boolean;
  /** Shadow blur radius */
  shadowBlur: number;
}

/**
 * Edge rendering configuration
 */
export interface EdgeRenderConfig {
  /** Default edge width (default: 1) */
  defaultWidth: number;
  /** Minimum width when scaling */
  minWidth: number;
  /** Maximum width when scaling */
  maxWidth: number;
  /** Edge opacity (0-1, default: 0.6) */
  opacity: number;
  /** Edge curvature (0 = straight, 1 = curved) */
  curvature: number;
  /** Show arrows on directed edges */
  showArrows: boolean;
  /** Arrow size */
  arrowSize: number;
}

/**
 * Label rendering configuration
 */
export interface LabelRenderConfig {
  /** Font family */
  fontFamily: string;
  /** Font size */
  fontSize: number;
  /** Font weight */
  fontWeight: "normal" | "bold" | "lighter";
  /** Zoom threshold to show labels (labels visible when zoom >= threshold) */
  showThreshold: number;
  /** Maximum characters before truncation */
  maxLength: number;
  /** Label offset from node center */
  offset: number;
}

/**
 * Background rendering configuration
 */
export interface BackgroundConfig {
  /** Background color */
  color: string;
  /** Show grid */
  showGrid: boolean;
  /** Grid size */
  gridSize: number;
  /** Grid color */
  gridColor: string;
}

/**
 * Complete rendering configuration
 */
export interface RenderingConfig {
  /** Performance settings */
  performance: PerformanceConfig;
  /** Node rendering */
  nodes: NodeRenderConfig;
  /** Edge rendering */
  edges: EdgeRenderConfig;
  /** Label rendering */
  labels: LabelRenderConfig;
  /** Background */
  background: BackgroundConfig;
}

// ============================================================
// Interaction Configuration
// ============================================================

/**
 * Zoom configuration
 */
export interface ZoomConfig {
  /** Enable zooming */
  enabled: boolean;
  /** Minimum zoom level */
  min: number;
  /** Maximum zoom level */
  max: number;
  /** Zoom step for wheel/pinch */
  step: number;
}

/**
 * Pan configuration
 */
export interface PanConfig {
  /** Enable panning */
  enabled: boolean;
  /** Inertia after pan release */
  inertia: boolean;
  /** Inertia friction */
  friction: number;
}

/**
 * Selection configuration
 */
export interface SelectionConfig {
  /** Enable multi-select */
  multiSelect: boolean;
  /** Modifier key for additive selection */
  modifierKey: "ctrl" | "shift" | "meta" | "alt";
  /** Enable box selection */
  boxSelect: boolean;
}

/**
 * Drag configuration
 */
export interface DragConfig {
  /** Enable node dragging */
  enabled: boolean;
  /** Drag threshold in pixels (must move this far to start drag) */
  threshold: number;
  /** Show drag preview */
  showPreview: boolean;
}

/**
 * Click and hover configuration
 */
export interface ClickConfig {
  /** Double-click delay in ms */
  doubleClickDelay: number;
  /** Hover delay before showing tooltip in ms */
  hoverDelay: number;
}

/**
 * Touch configuration
 */
export interface TouchConfig {
  /** Enable touch support */
  enabled: boolean;
  /** Enable pinch-to-zoom */
  pinchZoom: boolean;
  /** Enable two-finger pan */
  twoFingerPan: boolean;
}

/**
 * Complete interaction configuration
 */
export interface InteractionConfig {
  /** Zoom settings */
  zoom: ZoomConfig;
  /** Pan settings */
  pan: PanConfig;
  /** Selection settings */
  selection: SelectionConfig;
  /** Drag settings */
  drag: DragConfig;
  /** Click/hover settings */
  click: ClickConfig;
  /** Touch settings */
  touch: TouchConfig;
}

// ============================================================
// Filter Configuration
// ============================================================

/**
 * Filter configuration
 */
export interface FilterConfig {
  /** Visible node types (empty = show all) */
  nodeTypes: string[];
  /** Visible edge types (empty = show all) */
  edgeTypes: string[];
  /** Show orphan nodes (nodes with no connections) */
  showOrphans: boolean;
  /** Minimum degree (connections) to show node */
  minDegree: number;
}

// ============================================================
// Layout Configuration
// ============================================================

/**
 * Hierarchical layout direction
 */
export type HierarchyDirection = "TB" | "BT" | "LR" | "RL";

/**
 * Force-directed layout configuration
 */
export interface ForceLayoutConfig {
  /** Initial layout iterations */
  initialIterations: number;
}

/**
 * Hierarchical layout configuration
 */
export interface HierarchicalLayoutConfig {
  /** Direction of hierarchy */
  direction: HierarchyDirection;
  /** Level separation */
  levelSeparation: number;
  /** Node separation within level */
  nodeSeparation: number;
}

/**
 * Radial layout configuration
 */
export interface RadialLayoutConfig {
  /** Number of rings */
  rings: number;
  /** Ring separation */
  ringSeparation: number;
  /** Starting angle (radians) */
  startAngle: number;
}

/**
 * Grid layout configuration
 */
export interface GridLayoutConfig {
  /** Grid columns (0 = auto) */
  columns: number;
  /** Cell width */
  cellWidth: number;
  /** Cell height */
  cellHeight: number;
}

/**
 * Complete layout configuration
 */
export interface LayoutConfig {
  /** Default layout algorithm */
  defaultAlgorithm: "force" | "hierarchical" | "radial" | "grid";
  /** Force layout settings */
  force: ForceLayoutConfig;
  /** Hierarchical layout settings */
  hierarchical: HierarchicalLayoutConfig;
  /** Radial layout settings */
  radial: RadialLayoutConfig;
  /** Grid layout settings */
  grid: GridLayoutConfig;
}

// ============================================================
// Minimap Configuration
// ============================================================

/**
 * Minimap position
 */
export type MinimapCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Minimap configuration
 */
export interface MinimapConfig {
  /** Show minimap */
  enabled: boolean;
  /** Minimap position */
  position: MinimapCorner;
  /** Minimap width */
  width: number;
  /** Minimap height */
  height: number;
  /** Minimap opacity */
  opacity: number;
}

// ============================================================
// Complete Graph Configuration
// ============================================================

/**
 * Complete graph configuration schema
 */
export interface GraphConfig {
  /** Physics simulation settings */
  physics: PhysicsConfig;
  /** Rendering settings */
  rendering: RenderingConfig;
  /** Interaction settings */
  interaction: InteractionConfig;
  /** Filter settings */
  filters: FilterConfig;
  /** Layout settings */
  layout: LayoutConfig;
  /** Minimap settings */
  minimap: MinimapConfig;
}

// ============================================================
// Preset Types
// ============================================================

/**
 * Named preset with partial configuration
 */
export interface ConfigPreset {
  /** Unique preset name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Partial configuration to apply */
  config: DeepPartial<GraphConfig>;
}

/**
 * Deep partial type for nested partial updates
 */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

// ============================================================
// Store Types
// ============================================================

/**
 * Configuration store state
 */
export interface GraphConfigState {
  /** Current configuration */
  config: GraphConfig;
  /** Currently active preset name (if any) */
  activePreset: string | null;
  /** Custom presets saved by user */
  customPresets: ConfigPreset[];
}

/**
 * Configuration store actions
 */
export interface GraphConfigActions {
  /** Get complete config or nested path */
  get: <T = GraphConfig>(path?: string) => T;
  /** Update configuration with deep merge */
  set: (updates: DeepPartial<GraphConfig>) => void;
  /** Reset configuration to defaults or specific path */
  reset: (path?: string) => void;
  /** Apply a built-in preset by name */
  applyPreset: (name: string) => void;
  /** Save current config as custom preset */
  saveAsPreset: (name: string, description?: string) => void;
  /** Delete a custom preset */
  deletePreset: (name: string) => void;
  /** Get all available presets (built-in + custom) */
  getPresets: () => ConfigPreset[];
  /** Export configuration as JSON */
  exportConfig: () => string;
  /** Import configuration from JSON */
  importConfig: (json: string) => boolean;
  /** Subscribe to configuration changes */
  subscribe: (callback: (config: GraphConfig) => void) => () => void;
}

/**
 * Complete configuration store type
 */
export type GraphConfigStore = GraphConfigState & GraphConfigActions;
