/**
 * Animation Module
 *
 * Exports animation infrastructure for smooth graph transitions,
 * including easing functions, interpolation utilities, layout
 * transition management, and node-level animations.
 *
 * @module presentation/renderers/graph/animation
 * @since 1.0.0
 */

// ============================================================
// AnimationSystem - Core animation infrastructure
// ============================================================

export {
  // Classes
  Animation,
  AnimationLoop,
  // Factory functions
  createAnimation,
  createAnimationLoop,
  animate,
  // Easing functions
  Easing,
  getEasing,
  // Constants
  DEFAULT_ANIMATION_CONFIG,
  ANIMATION_PRESETS,
} from "./AnimationSystem";

export type {
  EasingFunction,
  EasingName,
  AnimationConfig,
  AnimationState,
  IAnimation,
  IAnimationLoop,
} from "./AnimationSystem";

// ============================================================
// Interpolation - Value interpolation utilities
// ============================================================

export {
  // Number interpolation
  lerp,
  clamp,
  lerpClamped,
  inverseLerp,
  remap,
  // Point interpolation
  interpolatePoint2D,
  interpolatePoint3D,
  interpolateBezierQuadratic,
  interpolateBezierCubic,
  interpolateCatmullRom,
  // Color conversion
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  // Color interpolation
  interpolateRgb,
  interpolateRgba,
  interpolateHsl,
  interpolateHsla,
  interpolateHex,
  interpolateHexHsl,
  // Opacity and scale
  interpolateOpacity,
  interpolateScale,
  interpolateRotation,
  // Node positions
  interpolateNodePosition,
  interpolateNodePositions,
  // Arrays
  interpolateArray,
  interpolatePointArray,
  // Staggered
  calculateStaggeredProgress,
  interpolateStaggered,
} from "./Interpolation";

export type {
  Point2D,
  Point3D,
  RGBColor,
  RGBAColor,
  HSLColor,
  HSLAColor,
  NodePosition,
  InterpolationOptions,
} from "./Interpolation";

// ============================================================
// LayoutTransitionManager - Layout transition orchestration
// ============================================================

export {
  // Class
  LayoutTransitionManager,
  // Factory functions
  createLayoutTransitionManager,
  transitionPositions,
  // Constants
  DEFAULT_TRANSITION_CONFIG,
  DEFAULT_TRANSITION_MANAGER_CONFIG,
  TRANSITION_PRESETS,
} from "./LayoutTransitionManager";

export type {
  TransitionNodeState,
  TransitionConfig,
  TransitionState,
  TransitionEventType,
  TransitionEvent,
  TransitionEventListener,
  TransitionCallbacks,
  LayoutTransitionManagerConfig,
} from "./LayoutTransitionManager";

// ============================================================
// NodeAnimator - Individual node animations
// ============================================================

export {
  // Class
  NodeAnimator,
  // Factory function
  createNodeAnimator,
  // Constants
  DEFAULT_NODE_VISUAL_STATE,
  DEFAULT_ANIMATION_DURATIONS,
  DEFAULT_ANIMATION_EASINGS,
  DEFAULT_NODE_ANIMATOR_CONFIG,
  NODE_VISUAL_PRESETS,
} from "./NodeAnimator";

export type {
  NodeVisualState,
  NodeAnimationType,
  NodeAnimationConfig,
  NodeAnimatorState,
  NodeAnimatorConfig,
  NodeAnimatorEventType,
  NodeAnimatorEvent,
  NodeAnimatorEventListener,
} from "./NodeAnimator";
