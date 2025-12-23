/**
 * Zod validation schemas for graph configuration.
 * Provides runtime type checking and validation.
 */

import { z } from "zod";
import type { GraphConfig } from "./types";

// ============================================================
// Custom Schemas for Special Values
// ============================================================

/**
 * Custom schema that accepts positive numbers including Infinity.
 * Used for distance maximums where Infinity means "no limit".
 * Note: z.number() in Zod v4 rejects Infinity, so we use z.custom() instead.
 */
const positiveNumberOrInfinity = z.custom<number>(
  (val) => typeof val === "number" && (val >= 0 || val === Infinity),
  { message: "Must be a non-negative number or Infinity" }
);

// ============================================================
// Physics Schemas
// ============================================================

export const SimulationConfigSchema = z.object({
  alphaMin: z.number().min(0).max(1),
  alphaDecay: z.number().min(0).max(1),
  alphaTarget: z.number().min(0).max(1),
  velocityDecay: z.number().min(0).max(1),
});

export const CenterForceConfigSchema = z.object({
  enabled: z.boolean(),
  strength: z.number().min(0).max(1),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const LinkForceConfigSchema = z.object({
  enabled: z.boolean(),
  distance: z.number().min(0),
  strength: z.number().min(0).max(2),
  iterations: z.number().int().min(1).max(10),
});

export const ChargeForceConfigSchema = z.object({
  enabled: z.boolean(),
  strength: z.number().min(-1000).max(1000),
  distanceMin: z.number().min(0),
  distanceMax: positiveNumberOrInfinity,
  theta: z.number().min(0).max(1),
});

export const CollisionForceConfigSchema = z.object({
  enabled: z.boolean(),
  radius: z.union([z.number().min(0), z.literal("auto")]),
  strength: z.number().min(0).max(1),
  iterations: z.number().int().min(1).max(10),
});

export const RadialForceConfigSchema = z.object({
  enabled: z.boolean(),
  strength: z.number().min(0).max(1),
  radius: z.number().min(0),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const PhysicsConfigSchema = z.object({
  enabled: z.boolean(),
  simulation: SimulationConfigSchema,
  center: CenterForceConfigSchema,
  link: LinkForceConfigSchema,
  charge: ChargeForceConfigSchema,
  collision: CollisionForceConfigSchema,
  radial: RadialForceConfigSchema,
});

// ============================================================
// Rendering Schemas
// ============================================================

export const PerformanceConfigSchema = z.object({
  maxFPS: z.number().int().min(1).max(120),
  pixelRatio: z.union([z.number().min(0.5).max(4), z.literal("auto")]),
  antialias: z.boolean(),
});

export const NodeRenderConfigSchema = z.object({
  defaultRadius: z.number().min(1).max(100),
  minRadius: z.number().min(1).max(100),
  maxRadius: z.number().min(1).max(100),
  sizeBy: z.string().optional(),
  borderWidth: z.number().min(0).max(10),
  showShadow: z.boolean(),
  shadowBlur: z.number().min(0).max(50),
});

export const EdgeRenderConfigSchema = z.object({
  defaultWidth: z.number().min(0.5).max(10),
  minWidth: z.number().min(0.5).max(10),
  maxWidth: z.number().min(0.5).max(20),
  opacity: z.number().min(0).max(1),
  curvature: z.number().min(0).max(1),
  showArrows: z.boolean(),
  arrowSize: z.number().min(2).max(20),
});

export const LabelRenderConfigSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number().min(8).max(32),
  fontWeight: z.enum(["normal", "bold", "lighter"]),
  showThreshold: z.number().min(0).max(10),
  maxLength: z.number().int().min(5).max(100),
  offset: z.number().min(0).max(50),
});

export const BackgroundConfigSchema = z.object({
  color: z.string(),
  showGrid: z.boolean(),
  gridSize: z.number().min(10).max(200),
  gridColor: z.string(),
});

export const RenderingConfigSchema = z.object({
  performance: PerformanceConfigSchema,
  nodes: NodeRenderConfigSchema,
  edges: EdgeRenderConfigSchema,
  labels: LabelRenderConfigSchema,
  background: BackgroundConfigSchema,
});

// ============================================================
// Interaction Schemas
// ============================================================

export const ZoomConfigSchema = z.object({
  enabled: z.boolean(),
  min: z.number().min(0.01).max(1),
  max: z.number().min(1).max(50),
  step: z.number().min(1.01).max(2),
});

export const PanConfigSchema = z.object({
  enabled: z.boolean(),
  inertia: z.boolean(),
  friction: z.number().min(0).max(1),
});

export const SelectionConfigSchema = z.object({
  multiSelect: z.boolean(),
  modifierKey: z.enum(["ctrl", "shift", "meta", "alt"]),
  boxSelect: z.boolean(),
});

export const DragConfigSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().min(0).max(20),
  showPreview: z.boolean(),
});

export const ClickConfigSchema = z.object({
  doubleClickDelay: z.number().min(100).max(1000),
  hoverDelay: z.number().min(0).max(2000),
});

export const TouchConfigSchema = z.object({
  enabled: z.boolean(),
  pinchZoom: z.boolean(),
  twoFingerPan: z.boolean(),
});

export const InteractionConfigSchema = z.object({
  zoom: ZoomConfigSchema,
  pan: PanConfigSchema,
  selection: SelectionConfigSchema,
  drag: DragConfigSchema,
  click: ClickConfigSchema,
  touch: TouchConfigSchema,
});

// ============================================================
// Filter Schemas
// ============================================================

export const FilterConfigSchema = z.object({
  nodeTypes: z.array(z.string()),
  edgeTypes: z.array(z.string()),
  showOrphans: z.boolean(),
  minDegree: z.number().int().min(0),
});

// ============================================================
// Layout Schemas
// ============================================================

export const HierarchyDirectionSchema = z.enum(["TB", "BT", "LR", "RL"]);

export const ForceLayoutConfigSchema = z.object({
  initialIterations: z.number().int().min(0).max(500),
});

export const HierarchicalLayoutConfigSchema = z.object({
  direction: HierarchyDirectionSchema,
  levelSeparation: z.number().min(20).max(500),
  nodeSeparation: z.number().min(10).max(200),
});

export const RadialLayoutConfigSchema = z.object({
  rings: z.number().int().min(1).max(20),
  ringSeparation: z.number().min(20).max(300),
  startAngle: z.number().min(0).max(Math.PI * 2),
});

export const GridLayoutConfigSchema = z.object({
  columns: z.number().int().min(0),
  cellWidth: z.number().min(20).max(500),
  cellHeight: z.number().min(20).max(500),
});

export const LayoutConfigSchema = z.object({
  defaultAlgorithm: z.enum(["force", "hierarchical", "radial", "grid"]),
  force: ForceLayoutConfigSchema,
  hierarchical: HierarchicalLayoutConfigSchema,
  radial: RadialLayoutConfigSchema,
  grid: GridLayoutConfigSchema,
});

// ============================================================
// Minimap Schemas
// ============================================================

export const MinimapCornerSchema = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

export const MinimapConfigSchema = z.object({
  enabled: z.boolean(),
  position: MinimapCornerSchema,
  width: z.number().min(50).max(400),
  height: z.number().min(50).max(400),
  opacity: z.number().min(0.1).max(1),
});

// ============================================================
// Complete Configuration Schema
// ============================================================

export const GraphConfigSchema = z.object({
  physics: PhysicsConfigSchema,
  rendering: RenderingConfigSchema,
  interaction: InteractionConfigSchema,
  filters: FilterConfigSchema,
  layout: LayoutConfigSchema,
  minimap: MinimapConfigSchema,
});

// ============================================================
// Partial Schemas for Updates (Deep Partial)
// ============================================================

// Create truly deep partial schemas for nested updates
export const PartialSimulationConfigSchema = SimulationConfigSchema.partial();
export const PartialCenterForceConfigSchema = CenterForceConfigSchema.partial();
export const PartialLinkForceConfigSchema = LinkForceConfigSchema.partial();
export const PartialChargeForceConfigSchema = ChargeForceConfigSchema.partial();
export const PartialCollisionForceConfigSchema = CollisionForceConfigSchema.partial();
export const PartialRadialForceConfigSchema = RadialForceConfigSchema.partial();

export const PartialPhysicsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  simulation: PartialSimulationConfigSchema.optional(),
  center: PartialCenterForceConfigSchema.optional(),
  link: PartialLinkForceConfigSchema.optional(),
  charge: PartialChargeForceConfigSchema.optional(),
  collision: PartialCollisionForceConfigSchema.optional(),
  radial: PartialRadialForceConfigSchema.optional(),
}).partial();

export const PartialPerformanceConfigSchema = PerformanceConfigSchema.partial();
export const PartialNodeRenderConfigSchema = NodeRenderConfigSchema.partial();
export const PartialEdgeRenderConfigSchema = EdgeRenderConfigSchema.partial();
export const PartialLabelRenderConfigSchema = LabelRenderConfigSchema.partial();
export const PartialBackgroundConfigSchema = BackgroundConfigSchema.partial();

export const PartialRenderingConfigSchema = z.object({
  performance: PartialPerformanceConfigSchema.optional(),
  nodes: PartialNodeRenderConfigSchema.optional(),
  edges: PartialEdgeRenderConfigSchema.optional(),
  labels: PartialLabelRenderConfigSchema.optional(),
  background: PartialBackgroundConfigSchema.optional(),
}).partial();

export const PartialZoomConfigSchema = ZoomConfigSchema.partial();
export const PartialPanConfigSchema = PanConfigSchema.partial();
export const PartialSelectionConfigSchema = SelectionConfigSchema.partial();
export const PartialDragConfigSchema = DragConfigSchema.partial();
export const PartialClickConfigSchema = ClickConfigSchema.partial();
export const PartialTouchConfigSchema = TouchConfigSchema.partial();

export const PartialInteractionConfigSchema = z.object({
  zoom: PartialZoomConfigSchema.optional(),
  pan: PartialPanConfigSchema.optional(),
  selection: PartialSelectionConfigSchema.optional(),
  drag: PartialDragConfigSchema.optional(),
  click: PartialClickConfigSchema.optional(),
  touch: PartialTouchConfigSchema.optional(),
}).partial();

export const PartialFilterConfigSchema = FilterConfigSchema.partial();

export const PartialForceLayoutConfigSchema = ForceLayoutConfigSchema.partial();
export const PartialHierarchicalLayoutConfigSchema = HierarchicalLayoutConfigSchema.partial();
export const PartialRadialLayoutConfigSchema = RadialLayoutConfigSchema.partial();
export const PartialGridLayoutConfigSchema = GridLayoutConfigSchema.partial();

export const PartialLayoutConfigSchema = z.object({
  defaultAlgorithm: z.enum(["force", "hierarchical", "radial", "grid"]).optional(),
  force: PartialForceLayoutConfigSchema.optional(),
  hierarchical: PartialHierarchicalLayoutConfigSchema.optional(),
  radial: PartialRadialLayoutConfigSchema.optional(),
  grid: PartialGridLayoutConfigSchema.optional(),
}).partial();

export const PartialMinimapConfigSchema = MinimapConfigSchema.partial();

export const PartialGraphConfigSchema = z.object({
  physics: PartialPhysicsConfigSchema.optional(),
  rendering: PartialRenderingConfigSchema.optional(),
  interaction: PartialInteractionConfigSchema.optional(),
  filters: PartialFilterConfigSchema.optional(),
  layout: PartialLayoutConfigSchema.optional(),
  minimap: PartialMinimapConfigSchema.optional(),
}).partial();

// ============================================================
// Preset Schema
// ============================================================

export const ConfigPresetSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200),
  config: z.record(z.string(), z.unknown()), // Accept any partial config structure
});

// ============================================================
// Default Configuration Values
// ============================================================

/**
 * Get the default configuration with all values set
 */
export function getDefaultConfig(): GraphConfig {
  return {
    physics: {
      enabled: true,
      simulation: {
        alphaMin: 0.001,
        alphaDecay: 0.0228,
        alphaTarget: 0,
        velocityDecay: 0.4,
      },
      center: {
        enabled: true,
        strength: 0.1,
      },
      link: {
        enabled: true,
        distance: 100,
        strength: 1,
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
        radius: "auto",
        strength: 0.7,
        iterations: 1,
      },
      radial: {
        enabled: false,
        strength: 0.1,
        radius: 200,
      },
    },
    rendering: {
      performance: {
        maxFPS: 60,
        pixelRatio: "auto",
        antialias: true,
      },
      nodes: {
        defaultRadius: 8,
        minRadius: 4,
        maxRadius: 24,
        borderWidth: 1,
        showShadow: false,
        shadowBlur: 10,
      },
      edges: {
        defaultWidth: 1,
        minWidth: 0.5,
        maxWidth: 5,
        opacity: 0.6,
        curvature: 0,
        showArrows: true,
        arrowSize: 6,
      },
      labels: {
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 12,
        fontWeight: "normal",
        showThreshold: 0.5,
        maxLength: 30,
        offset: 4,
      },
      background: {
        color: "#1e1e1e",
        showGrid: false,
        gridSize: 50,
        gridColor: "#333333",
      },
    },
    interaction: {
      zoom: {
        enabled: true,
        min: 0.1,
        max: 10,
        step: 1.2,
      },
      pan: {
        enabled: true,
        inertia: true,
        friction: 0.85,
      },
      selection: {
        multiSelect: true,
        modifierKey: "shift",
        boxSelect: true,
      },
      drag: {
        enabled: true,
        threshold: 5,
        showPreview: true,
      },
      click: {
        doubleClickDelay: 300,
        hoverDelay: 500,
      },
      touch: {
        enabled: true,
        pinchZoom: true,
        twoFingerPan: true,
      },
    },
    filters: {
      nodeTypes: [],
      edgeTypes: [],
      showOrphans: true,
      minDegree: 0,
    },
    layout: {
      defaultAlgorithm: "force",
      force: {
        initialIterations: 100,
      },
      hierarchical: {
        direction: "TB",
        levelSeparation: 100,
        nodeSeparation: 50,
      },
      radial: {
        rings: 5,
        ringSeparation: 80,
        startAngle: 0,
      },
      grid: {
        columns: 0,
        cellWidth: 100,
        cellHeight: 100,
      },
    },
    minimap: {
      enabled: true,
      position: "bottom-right",
      width: 150,
      height: 100,
      opacity: 0.8,
    },
  };
}

// ============================================================
// Validation Result Types
// ============================================================

/**
 * Result of a safe parse operation
 */
export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

// ============================================================
// Validation Functions
// ============================================================

/**
 * Validate a complete graph configuration
 */
export function validateConfig(config: unknown): SafeParseResult<GraphConfig> {
  return GraphConfigSchema.safeParse(config) as SafeParseResult<GraphConfig>;
}

/**
 * Validate a partial configuration update
 */
export function validatePartialConfig(config: unknown): SafeParseResult<unknown> {
  return PartialGraphConfigSchema.safeParse(config) as SafeParseResult<unknown>;
}

/**
 * Validate a preset configuration
 */
export function validatePreset(preset: unknown): SafeParseResult<z.infer<typeof ConfigPresetSchema>> {
  return ConfigPresetSchema.safeParse(preset) as SafeParseResult<z.infer<typeof ConfigPresetSchema>>;
}
