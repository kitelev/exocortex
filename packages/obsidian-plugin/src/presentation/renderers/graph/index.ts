/**
 * Graph Renderer Module
 *
 * Exports the GraphLayoutRenderer component and related types for
 * force-directed graph visualization of asset relationships.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

export { GraphLayoutRenderer } from "./GraphLayoutRenderer";
export { GraphNode } from "./GraphNode";
export { GraphEdge } from "./GraphEdge";

// Barnes-Hut algorithm for O(n log n) many-body force calculation
export { Quadtree } from "./Quadtree";
export type { QuadtreeNode, QuadtreeBounds, QuadtreePoint } from "./Quadtree";

export {
  BarnesHutForce,
  createBarnesHutForce,
  applyBarnesHutForce,
  benchmarkBarnesHut,
} from "./BarnesHutForce";
export type {
  SimulationNode,
  BarnesHutForceConfig,
} from "./BarnesHutForce";

export type {
  GraphNode as GraphNodeData,
  GraphEdge as GraphEdgeData,
  GraphData,
  GraphLayoutRendererProps,
  GraphLayoutOptions,
  GraphNodeProps,
  GraphEdgeProps,
} from "./types";

export {
  extractLabelFromWikilink,
  extractPathFromWikilink,
  rowsToNodes,
  extractEdges,
  buildGraphData,
} from "./types";

// Force-directed layout simulation (d3-force compatible)
export { ForceSimulation } from "./ForceSimulation";
export type {
  SimulationNode as ForceSimulationNode,
  SimulationLink,
  Force,
  SimulationEvent,
  SimulationEventCallback,
  ForceSimulationConfig,
  SimulationMetrics,
} from "./ForceSimulation";

// Built-in forces
export {
  forceCenter,
  forceLink,
  forceManyBody,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
  forceSemanticLink,
  DEFAULT_SEMANTIC_LINK_CONFIG,
} from "./ForceSimulation";

export type {
  ForceCenterConfig,
  ForceLinkConfig,
  ForceSemanticLinkConfig,
  ForceManyBodyConfig,
  ForceCollideConfig,
  ForceRadialConfig,
  ForceXConfig,
  ForceYConfig,
} from "./ForceSimulation";

// Configurable force parameters
export type {
  CenterForceParams,
  ChargeForceParams,
  LinkForceParams,
  CollisionForceParams,
  VelocityDecayParams,
  ForceConfiguration,
  ForcePresetName,
} from "./ForceSimulation";

export {
  FORCE_PRESETS,
  cloneForceConfiguration,
  mergeForceConfiguration,
  validateForceConfiguration,
} from "./ForceSimulation";

// Semantic physics - ontology-driven force modifiers
export {
  SemanticForceModifier,
  DEFAULT_SEMANTIC_PHYSICS_CONFIG,
} from "./SemanticForceModifier";
export type {
  SemanticLink,
  SemanticNode,
  ForceModifier,
} from "./SemanticForceModifier";

// PixiJS WebGL2 renderer for high-performance graph rendering
export { PixiGraphRenderer } from "./PixiGraphRenderer";
export type {
  PixiGraphRendererOptions,
  ViewportState,
} from "./PixiGraphRenderer";

// Node rendering with customizable shapes
export {
  NodeRenderer,
  NodeStyleResolver,
  SHAPE_DRAWERS,
  DEFAULT_NODE_STYLE,
  DEFAULT_NODE_TYPE_CONFIGS,
  calculateNodeRadius,
} from "./NodeRenderer";
export type {
  NodeShape,
  NodeVisualStyle,
  NodeTypeConfig,
  OntologyClass,
  RadiusScalingMode,
  RenderedNode,
} from "./NodeRenderer";

// Edge rendering with curved paths
export {
  EdgeRenderer,
  EdgeStyleResolver,
  DEFAULT_EDGE_STYLE,
  DEFAULT_EDGE_TYPE_CONFIGS,
  calculateEdgeEndpoints,
} from "./EdgeRenderer";
export type {
  Position,
  CurveType,
  ArrowType,
  ArrowPosition,
  EdgeVisualStyle,
  PredicateType,
  EdgeTypeConfig,
  CurvePoints,
  RenderedEdge,
} from "./EdgeRenderer";

// Label rendering with text sprites
export {
  LabelRenderer,
  LabelStyleResolver,
  DEFAULT_LABEL_STYLE,
  calculateOptimalLabelPosition,
} from "./LabelRenderer";
export type {
  LabelAnchor,
  LabelVisualStyle,
  RenderedLabel,
  ViewportInfo,
} from "./LabelRenderer";

// Dirty-checking and incremental updates for performance optimization
export {
  DirtyTracker,
  NodeEdgeIndex,
  DEFAULT_DIRTY_TRACKER_CONFIG,
} from "./DirtyTracker";
export type {
  DirtyFlag,
  DirtyTrackerConfig,
} from "./DirtyTracker";

// Incremental renderer for efficient graph updates
export { IncrementalRenderer } from "./IncrementalRenderer";
export type {
  IncrementalRendererOptions,
  RenderStats,
} from "./IncrementalRenderer";

// Visibility culling for off-screen elements
export {
  VisibilityCuller,
  DEFAULT_VISIBILITY_CULLER_CONFIG,
} from "./VisibilityCuller";
export type {
  ViewportBounds,
  NodeBounds,
  VisibilityCullerConfig,
  VisibilityCullerStats,
} from "./VisibilityCuller";

// Viewport controller for pan/zoom interactions
export {
  ViewportController,
  DEFAULT_VIEWPORT_CONTROLLER_CONFIG,
} from "./ViewportController";
export type {
  Position as ViewportPosition,
  Viewport,
  ViewportControllerConfig,
  ViewportEventType,
  ViewportEvent,
  ViewportEventListener,
} from "./ViewportController";

// Selection manager for node/edge selection with multi-select and box selection
export {
  SelectionManager,
  DEFAULT_SELECTION_MANAGER_CONFIG,
} from "./SelectionManager";
export type {
  Rect,
  NormalizedRect,
  SelectionState,
  SelectionManagerConfig,
  SelectionEventType,
  SelectionEvent,
  SelectionEventListener,
} from "./SelectionManager";

// Hover manager for node/edge hover states and tooltips
export {
  HoverManager,
  DEFAULT_HOVER_MANAGER_CONFIG,
} from "./HoverManager";
export type {
  Point,
  HoverState,
  NodeType,
  PropertyValue,
  TooltipData,
  TooltipDataProvider,
  TooltipRenderer as ITooltipRenderer,
  HoverManagerConfig,
  HoverEventType,
  HoverEvent,
  HoverEventListener,
} from "./HoverManager";

// Tooltip renderer for rich metadata display
export {
  TooltipRenderer,
  DEFAULT_TOOLTIP_RENDERER_CONFIG,
} from "./TooltipRenderer";
export type {
  TooltipRendererConfig,
} from "./TooltipRenderer";

// Tooltip data provider for triple store integration
export {
  GraphTooltipDataProvider,
  DEFAULT_GRAPH_TOOLTIP_PROVIDER_CONFIG,
} from "./GraphTooltipDataProvider";
export type {
  TripleStore,
  FileContentProvider,
  GraphTooltipDataProviderConfig,
} from "./GraphTooltipDataProvider";

// Context menu manager for right-click menus
export {
  ContextMenuManager,
  DEFAULT_CONTEXT_MENU_MANAGER_CONFIG,
} from "./ContextMenuManager";
export type {
  Point as ContextMenuPoint,
  ContextMenuState,
  ContextMenuTarget,
  ContextMenuItem,
  ContextMenuProvider,
  ContextMenuRenderer as IContextMenuRenderer,
  ContextMenuManagerConfig,
  ContextMenuEventType,
  ContextMenuEvent,
  ContextMenuEventListener,
} from "./ContextMenuManager";

// Context menu renderer for DOM-based menu display
export {
  ContextMenuRenderer,
  DEFAULT_CONTEXT_MENU_RENDERER_CONFIG,
} from "./ContextMenuRenderer";
export type {
  ContextMenuRendererConfig,
} from "./ContextMenuRenderer";

// Built-in context menu providers
export {
  NodeContextMenuProvider,
  EdgeContextMenuProvider,
  CanvasContextMenuProvider,
  SelectionContextMenuProvider,
  createDefaultProviders,
} from "./ContextMenuProviders";
export type {
  ContextMenuCallbacks,
} from "./ContextMenuProviders";

// Keyboard manager for keyboard navigation and shortcuts
export {
  KeyboardManager,
  DEFAULT_KEYBOARD_MANAGER_CONFIG,
  DEFAULT_KEY_BINDINGS,
} from "./KeyboardManager";
export type {
  ModifierState,
  KeyBinding,
  KeyBindingContext,
  ActionHandler,
  KeyboardManagerConfig,
  KeyboardEventType,
  KeyboardEvent_Custom,
  KeyboardEventListener,
} from "./KeyboardManager";

// Navigation manager for spatial navigation between nodes
export {
  NavigationManager,
  DEFAULT_NAVIGATION_MANAGER_CONFIG,
} from "./NavigationManager";
export type {
  NavigationDirection,
  NavigationMode,
  NavigationManagerConfig,
  NavigationResult,
  CandidateNode,
  NavigationEventType,
  NavigationEvent,
  NavigationEventListener,
} from "./NavigationManager";

// Focus indicator for visual feedback on keyboard focus
export {
  FocusIndicator,
  DEFAULT_FOCUS_INDICATOR_CONFIG,
  DEFAULT_FOCUS_INDICATOR_STYLE,
} from "./FocusIndicator";
export type {
  FocusIndicatorStyle,
  FocusIndicatorConfig,
  FocusState,
  FocusIndicatorRenderData,
  FocusEventType,
  FocusEvent,
  FocusEventListener,
} from "./FocusIndicator";

// Shortcut registrar for customizable keyboard shortcuts
export {
  ShortcutRegistrar,
  DEFAULT_SHORTCUT_REGISTRAR_CONFIG,
  DEFAULT_GRAPH_SHORTCUTS,
  SHORTCUT_CATEGORY_TITLES,
} from "./ShortcutRegistrar";
export type {
  ShortcutCategory,
  Shortcut,
  ShortcutConflict,
  ShortcutProfile,
  ShortcutRegistrarConfig,
  HelpSection,
  RegistrarEventType,
  RegistrarEvent,
  RegistrarEventListener,
} from "./ShortcutRegistrar";

// Hierarchical layout algorithm for tree/DAG visualization
export {
  HierarchicalLayout,
  createHierarchicalLayout,
  DEFAULT_HIERARCHICAL_OPTIONS,
  HIERARCHICAL_PRESETS,
} from "./HierarchicalLayout";
export type {
  LayoutDirection,
  RankingAlgorithm,
  CrossingMinimizationAlgorithm,
  CoordinateAssignmentAlgorithm,
  HierarchicalLayoutOptions,
  HierarchicalNode,
  HierarchicalEdge,
  HierarchicalLayoutResult,
  HierarchicalPresetName,
} from "./HierarchicalLayout";

// Radial/circular layout algorithm with focus node
export {
  RadialLayout,
  createRadialLayout,
  DEFAULT_RADIAL_OPTIONS,
  RADIAL_PRESETS,
} from "./RadialLayout";
export type {
  RadialSortBy,
  SortOrder,
  SubtreeAngleStrategy,
  RingAssignmentAlgorithm,
  EdgeRoutingStyle,
  RadialLayoutOptions,
  RadialNode,
  RadialEdge,
  RadialLayoutResult,
  RadialPresetName,
} from "./RadialLayout";

// Layout manager with smooth transitions between algorithms
export {
  LayoutManager,
  createLayoutManager,
  getEasingFunction,
  interpolatePoint,
  EASING_FUNCTIONS,
  DEFAULT_TRANSITION_OPTIONS,
  DEFAULT_LAYOUT_MANAGER_CONFIG,
} from "./LayoutManager";
export type {
  Point as LayoutPoint,
  EasingFunction,
  EasingFunctionImpl,
  LayoutTransitionOptions,
  LayoutAlgorithmName,
  LayoutAlgorithm,
  LayoutResult,
  LayoutManagerState,
  LayoutManagerConfig,
  LayoutManagerEventType,
  LayoutManagerEvent,
  LayoutManagerEventListener,
} from "./LayoutManager";

// Temporal layout algorithm for time-based data visualization
export {
  TemporalLayout,
  createTemporalLayout,
  DEFAULT_TEMPORAL_OPTIONS,
  TEMPORAL_PRESETS,
} from "./TemporalLayout";
export type {
  TimelineOrientation,
  TimeScale,
  LaneStrategy,
  GapStrategy,
  NodeAlignment,
  TemporalLayoutOptions,
  TemporalNode,
  TemporalEdge,
  Lane,
  TimeMarker,
  TemporalLayoutResult,
  TemporalPresetName,
} from "./TemporalLayout";

// Layout constraints system for user-controlled node positioning
export {
  ConstraintManager,
  createConstraintManager,
  DEFAULT_CONSTRAINT_MANAGER_CONFIG,
  ConstraintSolver,
  createConstraintSolver,
  DEFAULT_CONSTRAINT_SOLVER_CONFIG,
  SnapManager,
  createSnapManager,
  DEFAULT_SNAP_CONFIG,
  LocalStorageConstraintStore,
  createLocalStorageConstraintStore,
} from "./constraints";
export type {
  Point as ConstraintPoint,
  BoundingBox,
  ConstraintPriority,
  ConstraintType,
  BaseConstraint,
  PinConstraint,
  AlignmentConstraint,
  GroupConstraint,
  DistanceConstraint,
  RegionConstraint,
  OrderConstraint,
  LayoutConstraint,
  GroupOptions,
  AlignmentOptions,
  DistanceOptions,
  OrderOptions,
  ConstraintSolverResult,
  ConstraintSolverConfig,
  SnapResult,
  AlignmentGuide,
  ConstraintEventType,
  ConstraintEvent,
  ConstraintEventListener,
  SerializedConstraint,
  ConstraintStore,
  ConstraintManagerConfig,
  SnapConfig,
} from "./constraints";

// Layout plugin architecture for extensible layout algorithms
export {
  BaseLayoutAlgorithm,
  LayoutPluginRegistry,
  layoutPluginRegistry,
  createLayoutFactory,
  createLayoutPlugin,
  createBuiltInLayoutPlugin,
} from "./LayoutPlugin";
export type {
  LayoutCategory,
  GraphType,
  LayoutOptionType,
  LayoutOptionDefinition,
  ValidationResult,
  LayoutPluginMetadata,
  LayoutFactory,
  LayoutPlugin,
  LayoutAlgorithmInstance,
  ExtendedLayoutResult,
  LayoutProgressCallback,
  AsyncLayoutOptions,
  PluginRegistryEventType,
  PluginRegistryEvent,
  PluginRegistryEventListener,
  PluginFilter,
} from "./LayoutPlugin";

// Community detection using Louvain algorithm
export {
  detectCommunities,
  assignCommunityColors,
  CommunityLayout,
  createCommunityDetectionPlugin,
  communityDetectionPlugin,
  COMMUNITY_COLOR_PALETTES,
  COMMUNITY_DETECTION_OPTIONS,
  COMMUNITY_DETECTION_METADATA,
  DEFAULT_COMMUNITY_OPTIONS,
} from "./CommunityDetection";
export type {
  CommunityAssignment,
  Community,
  CommunityDetectionResult,
  CommunityDetectionOptions,
} from "./CommunityDetection";

// Node clustering visualization with SPARQL query execution
export {
  ClusterQueryExecutor,
  ClusterRenderer,
  DEFAULT_CLUSTER_QUERY_OPTIONS,
  DEFAULT_CLUSTER_VISUALIZATION_OPTIONS,
} from "./cluster";
export type {
  ClusterQueryOptions,
  ClusterQueryResult,
  ClusterQueryStats,
  QueryValidationResult,
  QueryValidationError,
  QueryValidationWarning,
  QueryPlan,
  QueryPlanStep,
  ClusterNode,
  ClusterEdge,
  ClusterVisualizationData,
  ClusterVisualizationOptions,
  ClusterBoundary,
  ClusterSelectionState,
  ClusterEventType,
  ClusterEvent,
  ClusterEventListener,
  TripleStoreAdapter,
  ClusterQueryExecutorConfig,
  ClusterRendererConfig,
} from "./cluster";

// Graph filtering system for semantic visualization
export {
  FilterManager,
  getFilterManager,
  resetFilterManager,
  FilterPanel,
  FilterPanelButton,
  FilterIcon,
  createTypeFilter,
  createPredicateFilter,
  createLiteralFilter,
  createPathFilter,
  createCompositeFilter,
  generateFilterId,
  DEFAULT_FILTER_PANEL_CONFIG,
} from "./filter";
export type {
  GraphFilter,
  TypeFilter,
  PredicateFilter,
  LiteralFilter,
  PathFilter,
  CustomSPARQLFilter,
  CompositeFilter,
  FilterPreset,
  AdvancedFilterState,
  TypeCounts,
  FilterPanelConfig,
  BaseFilter,
  FilterChangeCallback,
  GraphData as FilterGraphData,
} from "./filter";

// Search and highlight system for node discovery and type-based coloring
export {
  // Managers
  TypeColorManager,
  createTypeColorManager,
  DEFAULT_TYPE_COLOR_MANAGER_CONFIG,
  SearchManager,
  createSearchManager,
  DEFAULT_SEARCH_MANAGER_CONFIG,
  // Components
  SearchBox,
  SearchButton,
  ColorLegend,
  ColorPickerModal,
  // Constants and utilities
  BUILT_IN_PALETTES,
  DEFAULT_TYPE_COLORS,
  DEFAULT_SEARCH_OPTIONS,
  DEFAULT_HIGHLIGHT_STYLE,
  generateColorFromString,
  generateGoldenRatioColor,
  hslToHex,
  calculateContrastRatio,
  getRelativeLuminance,
  meetsWCAGAA,
  formatTypeUri,
} from "./search";
export type {
  // Types
  TypeColorConfig,
  ColorPalette,
  SearchMatch,
  SearchState,
  SearchOptions,
  HighlightStyle,
  LegendItem,
  LegendState,
  ColorPickerState,
  SearchEventType,
  SearchEvent,
  SearchEventListener,
  // Manager configs
  TypeColorManagerConfig,
  OntologyInfo,
  SearchManagerConfig,
  // Component props
  SearchBoxProps,
  SearchButtonProps,
  ColorLegendProps,
  ColorPickerModalProps,
} from "./search";

// Path finding system for node-to-node path discovery
export {
  // Core algorithm
  PathFinder,
  createPathFinder,
  // State management
  PathFindingManager,
  createPathFindingManager,
  DEFAULT_PATH_FINDING_MANAGER_CONFIG,
  // UI components
  PathFindingPanel,
  PathFindingButton,
  // Constants
  DEFAULT_PATH_FINDING_OPTIONS,
  DEFAULT_PATH_VISUALIZATION_STYLE,
  INITIAL_PATH_FINDING_STATE,
} from "./pathfinding";
export type {
  // Types
  PathFindingAlgorithm,
  PathDirection,
  EdgeWeightStrategy,
  PathFindingOptions,
  PathStep,
  Path,
  PathFindingResult,
  PathVisualizationStyle,
  PathFindingState,
  PathFindingEventType,
  PathFindingEvent,
  PathFindingEventListener,
  PathNode,
  AdjacencyEntry,
  PathGraph,
  // Manager config
  PathFindingManagerConfig,
  // Component props
  PathFindingPanelProps,
  PathFindingButtonProps,
} from "./pathfinding";

// Level of Detail (LOD) system for performance optimization
export {
  LODSystem,
  createLODSystem,
  LODLevel,
  DEFAULT_LOD_SETTINGS,
  DEFAULT_LOD_THRESHOLDS,
  DEFAULT_LOD_SYSTEM_CONFIG,
} from "./LODSystem";
export type {
  LODSettings,
  NodeLODSettings,
  EdgeLODSettings,
  LabelLODSettings,
  LODThreshold,
  LODSystemConfig,
  LODEventType,
  LODEvent,
  LODEventListener,
  LODStats,
} from "./LODSystem";

// Batched node renderer for high-performance instanced drawing
export {
  BatchedNodeRenderer,
  createBatchedNodeRenderer,
  DEFAULT_BATCH_CONFIG,
  DEFAULT_BATCHED_NODE_RENDERER_CONFIG,
} from "./BatchedNodeRenderer";
export type {
  BatchConfig,
  BatchNode,
  BatchRendererStats,
  BatchedNodeRendererConfig,
} from "./BatchedNodeRenderer";

// GPU memory manager for resource lifecycle management
export {
  GPUMemoryManager,
  createGPUMemoryManager,
  getGlobalMemoryManager,
  resetGlobalMemoryManager,
  MemoryPressure,
  DEFAULT_GPU_MEMORY_MANAGER_CONFIG,
} from "./GPUMemoryManager";
export type {
  ResourceType,
  ManagedResource,
  MemoryUsage,
  GPUMemoryManagerConfig,
  GPUMemoryStats,
  MemoryEventType,
  MemoryEvent,
  MemoryEventListener,
} from "./GPUMemoryManager";

// Inference visualization for ontology reasoning and neighborhood exploration
export {
  // InferenceManager
  InferenceManager,
  createInferenceManager,
  BUILT_IN_RULES,
  // NeighborhoodExplorer
  NeighborhoodExplorer,
  createNeighborhoodExplorer,
  // InferenceRenderer
  InferenceRenderer,
  createInferenceRenderer,
  INFERENCE_TYPE_BADGES,
  INFERENCE_TYPE_DESCRIPTIONS,
  // Constants
  DEFAULT_NEIGHBORHOOD_OPTIONS,
  DEFAULT_INFERENCE_STYLE,
  DEFAULT_INFERENCE_STATE,
} from "./inference";
export type {
  // Core triple types
  Triple as InferenceTriple,
  TriplePattern,
  InferenceType,
  InferenceRule,
  InferenceStep,
  Justification,
  InferredFact,
  AnnotatedTriple,
  // Neighborhood types
  NeighborhoodDirection,
  NeighborhoodExplorationOptions,
  NeighborhoodNode,
  NeighborhoodEdge,
  NeighborhoodResult,
  NeighborhoodStats,
  // Visual types
  InferenceVisualStyle,
  InferenceVisualizationState,
  InferenceEventType,
  InferenceEvent,
  InferenceEventListener,
  // Manager/Explorer types
  InferenceTripleStore,
  InferenceManagerConfig,
  NeighborhoodTripleStore,
  NeighborhoodExplorerConfig,
  // Renderer types
  InferenceEdgeRenderData,
  InferenceNodeRenderData,
  InferenceRendererConfig,
} from "./inference";

// WebGPU physics simulation for GPU-accelerated force-directed layouts
export {
  WebGPUPhysics,
  createWebGPUPhysics,
  isWebGPUAvailable,
  DEFAULT_WEBGPU_PHYSICS_CONFIG,
} from "./WebGPUPhysics";
export type {
  PhysicsNode,
  PhysicsEdge,
  WebGPUPhysicsConfig,
  WebGPUPhysicsState,
  PhysicsEventType,
  PhysicsEvent,
  PhysicsEventListener,
} from "./WebGPUPhysics";

// Viewport windowing system for virtual scrolling and large graph support
export {
  ViewportWindowManager,
  createViewportWindowManager,
  DEFAULT_WINDOWING_OPTIONS,
} from "./ViewportWindowManager";
export type {
  ViewportWindow,
  WindowingOptions,
  SpatialItem,
  WindowingStats,
  WindowingEventType,
  WindowingEvent,
  WindowingEventListener,
} from "./ViewportWindowManager";

// Performance profiling and optimization system for 100K+ node graphs
export {
  // Profiler
  PerformanceProfiler,
  createPerformanceProfiler,
  getGlobalProfiler,
  resetGlobalProfiler,
  DEFAULT_PROFILER_OPTIONS,
  // Bottleneck Detector
  BottleneckDetector,
  createBottleneckDetector,
  DEFAULT_DETECTOR_CONFIG,
  // Dashboard
  PerformanceMetricsDashboard,
  PerformanceDashboardButton,
  DEFAULT_DASHBOARD_CONFIG,
  // Auto Optimizer
  AutoOptimizer,
  createAutoOptimizer,
  getOptimizationPresets,
  DEFAULT_PERFORMANCE_TARGETS,
  DEFAULT_OPTIMIZER_CONFIG,
  DEFAULT_OPTIMIZATION_STATE,
} from "./performance";
export type {
  // Profiler types
  PerformanceMetrics,
  ProfilerOptions,
  SectionTiming,
  ProfileSection,
  PerformanceLevel,
  FrameAnalysis,
  ProfilerEventType,
  ProfilerEvent,
  ProfilerEventListener,
  // Bottleneck types
  BottleneckSeverity,
  BottleneckCategory,
  Bottleneck,
  TrendDirection,
  TrendAnalysis,
  ResourceUtilization,
  BottleneckAnalysis,
  BottleneckDetectorConfig,
  // Dashboard types
  PerformanceMetricsDashboardProps,
  DashboardConfig,
  PerformanceDashboardButtonProps,
  // Optimizer types
  OptimizationAction,
  OptimizationCategory,
  OptimizationMode,
  PerformanceTarget,
  OptimizationState,
  AutoOptimizerConfig,
  OptimizerEventType,
  OptimizerEvent,
  OptimizerEventListener,
} from "./performance";

// Memory optimization and object pooling system
export {
  // Object Pool
  ObjectPool,
  createObjectPool,
  PoolExhaustedException,
  DEFAULT_POOL_CONFIG,
  // Poolable Types
  BasePoolable,
  RenderBatch,
  EventObject,
  ComputationBuffer,
  PoolableVector2D,
  PoolableRect,
  // Pool Manager
  PoolManager,
  createPoolManager,
  getGlobalPoolManager,
  resetGlobalPoolManager,
  MemoryPressureLevel,
  POOL_NAMES,
  DEFAULT_POOL_CONFIGS,
  DEFAULT_POOL_MANAGER_CONFIG,
} from "./memory";
export type {
  // Object Pool types
  Poolable,
  PoolConfig,
  PoolMetrics,
  PoolEventType,
  PoolEvent,
  PoolEventListener,
  // Poolable Types
  NodePosition,
  EdgePosition,
  PoolableEventType,
  BufferType,
  // Pool Manager types
  PoolManagerConfig,
  PoolManagerStats,
  PoolManagerEventType,
  PoolManagerEvent,
  PoolManagerEventListener,
} from "./memory";

// 3D Graph visualization with Three.js and WebGL2
export {
  Scene3DManager,
  createScene3DManager,
  ForceSimulation3D,
  createForceSimulation3D,
  DEFAULT_SCENE_3D_CONFIG,
  DEFAULT_NODE_3D_STYLE,
  DEFAULT_EDGE_3D_STYLE,
  DEFAULT_LABEL_3D_STYLE,
  DEFAULT_ORBIT_CONTROLS_CONFIG,
  DEFAULT_FORCE_SIMULATION_3D_CONFIG,
} from "./3d";
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
  SimulationEventType as Simulation3DEventType,
  Simulation3DEvent,
  Simulation3DEventListener,
} from "./3d";

// Edge bundling for dense graphs
export {
  // Bundlers
  StubBundler,
  createStubBundler,
  FDEBBundler,
  createFDEBBundler,
  HierarchicalBundler,
  createHierarchicalBundler,
  createEdgeBundler,
  // Constants and utilities
  DEFAULT_BUNDLING_CONFIG,
  DEFAULT_HIERARCHICAL_CONFIG,
  distance as bundlingDistance,
  midpoint as bundlingMidpoint,
  normalize as bundlingNormalize,
  dot as bundlingDot,
  subtract as bundlingSubtract,
  add as bundlingAdd,
  scale as bundlingScale,
  lerp as bundlingLerp,
  projectOntoLine,
} from "./bundling";
export type {
  Vector2,
  BundlingAlgorithm,
  BundlingConfig,
  BundledEdge,
  EdgeSegment,
  BundlingResult,
  EdgeBundler,
  CompatibilityMeasures,
  HierarchicalBundlingConfig,
  HierarchyNode,
  EdgeBundlerFactory,
} from "./bundling";

// Animation system for smooth layout transitions
export {
  // Animation core
  Animation,
  AnimationLoop,
  createAnimation,
  createAnimationLoop,
  animate,
  Easing,
  getEasing,
  DEFAULT_ANIMATION_CONFIG,
  ANIMATION_PRESETS,
  // Interpolation utilities
  lerp as animationLerp,
  clamp as animationClamp,
  lerpClamped,
  inverseLerp,
  remap,
  interpolatePoint2D,
  interpolatePoint3D,
  interpolateBezierQuadratic,
  interpolateBezierCubic,
  interpolateCatmullRom,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  interpolateRgb,
  interpolateRgba,
  interpolateHsl,
  interpolateHsla,
  interpolateHex,
  interpolateHexHsl,
  interpolateOpacity,
  interpolateScale,
  interpolateRotation,
  interpolateNodePosition,
  interpolateNodePositions,
  interpolateArray,
  interpolatePointArray,
  calculateStaggeredProgress,
  interpolateStaggered,
  // Layout transition manager
  LayoutTransitionManager,
  createLayoutTransitionManager,
  transitionPositions,
  DEFAULT_TRANSITION_CONFIG,
  DEFAULT_TRANSITION_MANAGER_CONFIG,
  TRANSITION_PRESETS,
  // Node animator
  NodeAnimator,
  createNodeAnimator,
  DEFAULT_NODE_VISUAL_STATE,
  DEFAULT_ANIMATION_DURATIONS,
  DEFAULT_ANIMATION_EASINGS,
  DEFAULT_NODE_ANIMATOR_CONFIG,
  NODE_VISUAL_PRESETS,
} from "./animation";
export type {
  // Animation types
  EasingFunction as AnimationEasingFunction,
  EasingName as AnimationEasingName,
  AnimationConfig,
  AnimationState,
  IAnimation,
  IAnimationLoop,
  // Interpolation types
  Point2D as AnimationPoint2D,
  Point3D as AnimationPoint3D,
  RGBColor,
  RGBAColor,
  HSLColor,
  HSLAColor,
  NodePosition as AnimationNodePosition,
  InterpolationOptions,
  // Transition types
  TransitionNodeState,
  TransitionConfig,
  TransitionState,
  TransitionEventType,
  TransitionEvent,
  TransitionEventListener,
  TransitionCallbacks,
  LayoutTransitionManagerConfig,
  // Node animator types
  NodeVisualState,
  NodeAnimationType,
  NodeAnimationConfig,
  NodeAnimatorState,
  NodeAnimatorConfig,
  NodeAnimatorEventType,
  NodeAnimatorEvent,
  NodeAnimatorEventListener,
} from "./animation";

// Graph export functionality for PNG, JPEG, WebP, and SVG
export {
  ExportManager,
  createExportManager,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_EXPORT_MANAGER_CONFIG,
  EXPORT_MIME_TYPES,
  EXPORT_FILE_EXTENSIONS,
} from "./export";
export type {
  ExportFormat,
  ExportOptions,
  ExportBounds,
  ExportResult,
  ExportNode,
  ExportEdge,
  ExportEventType,
  ExportEvent,
  ExportEventListener,
  ExportManagerConfig,
  ExportStats,
} from "./export";

// Accessibility system for WCAG 2.1 AA compliance
export {
  // Manager
  AccessibilityManager,
  createAccessibilityManager,
  DEFAULT_ACCESSIBILITY_MANAGER_CONFIG,
  // Virtual Cursor
  VirtualCursor,
  createVirtualCursor,
  DEFAULT_VIRTUAL_CURSOR_CONFIG,
  // Constants and utilities
  DEFAULT_A11Y_CONFIG,
  DEFAULT_REDUCED_MOTION_CONFIG,
  HIGH_CONTRAST_THEMES,
  WCAG_CONTRAST_RATIOS,
  getScreenReaderCapabilities,
  // Aliased WCAG utilities to avoid conflict with search module exports
  a11yGetContrastRatio,
  a11yGetRelativeLuminance,
  a11yMeetsWCAGAA,
  a11yMeetsWCAGAAA,
} from "./accessibility";
export type {
  // Manager config
  AccessibilityManagerConfig,
  // Virtual cursor types
  VirtualCursorConfig,
  VirtualCursorNavigationResult,
  VirtualCursorEventType,
  VirtualCursorEvent,
  VirtualCursorEventListener,
  // Core types
  A11yConfig,
  A11yNode,
  A11yEdge,
  A11yEvent,
  A11yEventType,
  A11yEventListener,
  A11yNavigationDirection,
  A11yShortcut,
  Announcement,
  AnnouncementType,
  AriaLivePoliteness,
  FocusTrapConfig,
  HighContrastColors,
  ReducedMotionConfig,
  ScreenReaderCapabilities,
  ScreenReaderType,
  SkipLink,
  VirtualCursorMode,
  VirtualCursorState,
} from "./accessibility";
