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
} from "./ForceSimulation";

export type {
  ForceCenterConfig,
  ForceLinkConfig,
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
