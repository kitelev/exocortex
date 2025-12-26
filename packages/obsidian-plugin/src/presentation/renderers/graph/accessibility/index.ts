/**
 * Accessibility Module
 *
 * Comprehensive WCAG 2.1 AA compliant accessibility features for graph visualization.
 * Supports screen readers (NVDA, VoiceOver, JAWS), keyboard navigation,
 * high contrast modes, and reduced motion preferences.
 *
 * @module presentation/renderers/graph/accessibility
 * @since 1.0.0
 */

// AccessibilityManager - Main orchestrator
export {
  AccessibilityManager,
  createAccessibilityManager,
  DEFAULT_ACCESSIBILITY_MANAGER_CONFIG,
} from "./AccessibilityManager";
export type { AccessibilityManagerConfig } from "./AccessibilityManager";

// VirtualCursor - Screen reader-friendly navigation
export {
  VirtualCursor,
  createVirtualCursor,
  DEFAULT_VIRTUAL_CURSOR_CONFIG,
} from "./VirtualCursor";
export type {
  VirtualCursorConfig,
  VirtualCursorNavigationResult,
  VirtualCursorEventType,
  VirtualCursorEvent,
  VirtualCursorEventListener,
} from "./VirtualCursor";

// Types
export type {
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
} from "./AccessibilityTypes";

// Constants and utilities
export {
  DEFAULT_A11Y_CONFIG,
  DEFAULT_REDUCED_MOTION_CONFIG,
  HIGH_CONTRAST_THEMES,
  WCAG_CONTRAST_RATIOS,
  getScreenReaderCapabilities,
  getContrastRatio,
  getRelativeLuminance,
  meetsWCAGAA,
  meetsWCAGAAA,
} from "./AccessibilityTypes";

// Aliased exports to avoid conflicts when re-exporting from parent module
// (the search module also exports getContrastRatio, getRelativeLuminance, meetsWCAGAA)
export {
  getContrastRatio as a11yGetContrastRatio,
  getRelativeLuminance as a11yGetRelativeLuminance,
  meetsWCAGAA as a11yMeetsWCAGAA,
  meetsWCAGAAA as a11yMeetsWCAGAAA,
} from "./AccessibilityTypes";
