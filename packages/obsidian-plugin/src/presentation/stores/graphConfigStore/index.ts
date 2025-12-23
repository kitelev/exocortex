/**
 * Graph configuration store module.
 * Exports Zustand store, hooks, presets, schemas, and types.
 */

// Store
export { useGraphConfigStore, getDefaultState, getDefaultConfig } from "./store";

// Hooks
export {
  useGraphConfig,
  useGraphConfigSection,
  usePhysicsConfig,
  useRenderingConfig,
  useInteractionConfig,
  useFilterConfig,
  useLayoutConfig,
  useMinimapConfig,
  useConfigValue,
  useSetConfig,
  useResetConfig,
  useConfigState,
  usePresets,
  useConfigImportExport,
  useConfigSubscription,
  usePhysicsSettings,
  useRenderingSettings,
} from "./hooks";

// Presets
export {
  BUILT_IN_PRESETS,
  PERFORMANCE_PRESET,
  QUALITY_PRESET,
  DENSE_PRESET,
  HIERARCHICAL_PRESET,
  ACCESSIBILITY_PRESET,
  RADIAL_PRESET,
  COMPACT_PRESET,
  getBuiltInPreset,
  isBuiltInPreset,
} from "./presets";

// Schemas
export {
  GraphConfigSchema,
  PhysicsConfigSchema,
  RenderingConfigSchema,
  InteractionConfigSchema,
  FilterConfigSchema,
  LayoutConfigSchema,
  MinimapConfigSchema,
  ConfigPresetSchema,
  validateConfig,
  validatePartialConfig,
  validatePreset,
} from "./schema";

// Types
export type {
  GraphConfig,
  GraphConfigState,
  GraphConfigActions,
  GraphConfigStore,
  ConfigPreset,
  DeepPartial,
  // Physics types
  PhysicsConfig,
  SimulationConfig,
  CenterForceConfig,
  LinkForceConfig,
  ChargeForceConfig,
  CollisionForceConfig,
  RadialForceConfig,
  // Rendering types
  RenderingConfig,
  PerformanceConfig,
  NodeRenderConfig,
  EdgeRenderConfig,
  LabelRenderConfig,
  BackgroundConfig,
  // Interaction types
  InteractionConfig,
  ZoomConfig,
  PanConfig,
  SelectionConfig,
  DragConfig,
  ClickConfig,
  TouchConfig,
  // Filter types
  FilterConfig,
  // Layout types
  LayoutConfig,
  ForceLayoutConfig,
  HierarchicalLayoutConfig,
  RadialLayoutConfig,
  GridLayoutConfig,
  HierarchyDirection,
  // Minimap types
  MinimapConfig,
  MinimapCorner,
} from "./types";
