/**
 * AccessibilityTypes - Type definitions for WCAG 2.1 AA compliant accessibility features
 *
 * Defines types and interfaces for comprehensive accessibility support:
 * - Screen reader announcements (NVDA, VoiceOver, JAWS)
 * - Keyboard navigation with virtual cursor
 * - High contrast mode support
 * - Reduced motion preferences
 * - Focus management
 *
 * @module presentation/renderers/graph/accessibility
 * @since 1.0.0
 */

// GraphNode type import not needed as we define our own A11yNode interface

/**
 * Accessibility configuration options
 */
export interface A11yConfig {
  /** Enable screen reader announcements (default: true) */
  enableScreenReader: boolean;
  /** Enable keyboard navigation (default: true) */
  enableKeyboardNav: boolean;
  /** Respect user's reduced motion preference (default: true) */
  respectReducedMotion: boolean;
  /** Enable high contrast mode (default: auto-detected) */
  highContrastMode: boolean;
  /** Focus indicator size in pixels (default: 3) */
  focusIndicatorSize: number;
  /** Announce node selections to screen readers (default: true) */
  announceSelections: boolean;
  /** Announce navigation changes to screen readers (default: true) */
  announceNavigations: boolean;
  /** Announce graph structure changes (default: true) */
  announceGraphChanges: boolean;
  /** Delay between announcements in ms to prevent spam (default: 500) */
  announcementDelay: number;
  /** Role description for the graph container (default: 'Knowledge graph visualization') */
  graphRoleDescription: string;
  /** Enable skip links for keyboard users (default: true) */
  enableSkipLinks: boolean;
  /** Virtual cursor navigation mode (default: 'spatial') */
  virtualCursorMode: VirtualCursorMode;
}

/**
 * Virtual cursor navigation modes
 */
export type VirtualCursorMode = "spatial" | "linear" | "semantic";

/**
 * Accessible node representation for screen readers
 */
export interface A11yNode {
  /** Node unique identifier */
  id: string;
  /** Human-readable label for the node */
  label: string;
  /** Node type/category (e.g., 'Project', 'Task', 'Area') */
  type: string;
  /** Number of connections to/from this node */
  connectionCount: number;
  /** List of connected node labels */
  connectedTo: string[];
  /** Node position for spatial navigation */
  position: { x: number; y: number };
  /** Node index in navigation order */
  index: number;
  /** Whether this node is currently selected */
  isSelected: boolean;
  /** Whether this node is currently focused */
  isFocused: boolean;
  /** Additional metadata for rich descriptions */
  metadata?: Record<string, unknown>;
}

/**
 * Accessible edge representation
 */
export interface A11yEdge {
  /** Edge unique identifier */
  id: string;
  /** Source node label */
  sourceLabel: string;
  /** Target node label */
  targetLabel: string;
  /** Relationship type/predicate */
  relationshipType: string;
  /** Edge label if available */
  label?: string;
}

/**
 * ARIA live region politeness level
 */
export type AriaLivePoliteness = "off" | "polite" | "assertive";

/**
 * Announcement types for different contexts
 */
export type AnnouncementType =
  | "navigation"
  | "selection"
  | "action"
  | "structure"
  | "error"
  | "help"
  | "status";

/**
 * Announcement configuration
 */
export interface Announcement {
  /** Message to announce */
  message: string;
  /** Politeness level (default: 'polite') */
  politeness?: AriaLivePoliteness;
  /** Type of announcement for categorization */
  type: AnnouncementType;
  /** Whether to clear previous announcements (default: false) */
  clearPrevious?: boolean;
  /** Delay before announcing in ms (default: 0) */
  delay?: number;
}

/**
 * Focus trap configuration for modal dialogs
 */
export interface FocusTrapConfig {
  /** Root element containing the focus trap */
  container: HTMLElement;
  /** Initial element to focus */
  initialFocus?: HTMLElement;
  /** Element to return focus to when trap is released */
  returnFocusTo?: HTMLElement;
  /** Allow clicking outside to close (default: false) */
  allowOutsideClick?: boolean;
  /** Callback when escape is pressed */
  onEscape?: () => void;
}

/**
 * Skip link configuration
 */
export interface SkipLink {
  /** Unique identifier */
  id: string;
  /** Visible text for the link */
  label: string;
  /** Target element ID to skip to */
  targetId: string;
  /** Optional keyboard shortcut */
  shortcut?: string;
}

/**
 * High contrast color scheme
 */
export interface HighContrastColors {
  /** Primary foreground color */
  foreground: string;
  /** Primary background color */
  background: string;
  /** Accent/link color */
  accent: string;
  /** Focus indicator color */
  focusIndicator: string;
  /** Selection highlight color */
  selection: string;
  /** Error/warning color */
  error: string;
  /** Border color */
  border: string;
}

/**
 * Default high contrast color schemes
 */
export const HIGH_CONTRAST_THEMES: Record<string, HighContrastColors> = {
  dark: {
    foreground: "#FFFFFF",
    background: "#000000",
    accent: "#FFFF00",
    focusIndicator: "#00FFFF",
    selection: "#0078D4",
    error: "#FF0000",
    border: "#FFFFFF",
  },
  light: {
    foreground: "#000000",
    background: "#FFFFFF",
    accent: "#0000FF",
    focusIndicator: "#FF6600",
    selection: "#0078D4",
    error: "#CC0000",
    border: "#000000",
  },
};

/**
 * Reduced motion configuration
 */
export interface ReducedMotionConfig {
  /** Disable all animations */
  disableAnimations: boolean;
  /** Disable transitions */
  disableTransitions: boolean;
  /** Use instant navigation instead of smooth scrolling */
  instantNavigation: boolean;
  /** Reduce parallax effects */
  reduceParallax: boolean;
}

/**
 * Accessibility event types
 */
export type A11yEventType =
  | "a11y:focus:change"
  | "a11y:selection:change"
  | "a11y:announcement"
  | "a11y:navigation"
  | "a11y:mode:change"
  | "a11y:config:change"
  | "a11y:error";

/**
 * Accessibility event data
 */
export interface A11yEvent {
  type: A11yEventType;
  nodeId?: string | null;
  previousNodeId?: string | null;
  node?: A11yNode | null;
  message?: string;
  mode?: string;
  config?: Partial<A11yConfig>;
  error?: Error;
}

/**
 * Accessibility event listener type
 */
export type A11yEventListener = (event: A11yEvent) => void;

/**
 * Virtual cursor state
 */
export interface VirtualCursorState {
  /** Current position (node ID) */
  currentNodeId: string | null;
  /** Previous position */
  previousNodeId: string | null;
  /** Navigation history for back/forward */
  history: string[];
  /** Current index in history */
  historyIndex: number;
  /** Current navigation mode */
  mode: VirtualCursorMode;
  /** Whether cursor is active */
  isActive: boolean;
}

/**
 * Navigation direction for virtual cursor
 */
export type A11yNavigationDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "next"
  | "previous"
  | "first"
  | "last"
  | "parent"
  | "child";

/**
 * Keyboard shortcut for accessibility actions
 */
export interface A11yShortcut {
  /** Key code */
  key: string;
  /** Required modifiers */
  modifiers?: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  };
  /** Action identifier */
  action: string;
  /** Human-readable description for screen readers */
  description: string;
  /** Category for help display */
  category: "navigation" | "selection" | "action" | "help";
}

/**
 * Default accessibility configuration
 */
export const DEFAULT_A11Y_CONFIG: A11yConfig = {
  enableScreenReader: true,
  enableKeyboardNav: true,
  respectReducedMotion: true,
  highContrastMode: false,
  focusIndicatorSize: 3,
  announceSelections: true,
  announceNavigations: true,
  announceGraphChanges: true,
  announcementDelay: 500,
  graphRoleDescription: "Knowledge graph visualization",
  enableSkipLinks: true,
  virtualCursorMode: "spatial",
};

/**
 * Default reduced motion configuration
 */
export const DEFAULT_REDUCED_MOTION_CONFIG: ReducedMotionConfig = {
  disableAnimations: true,
  disableTransitions: true,
  instantNavigation: true,
  reduceParallax: true,
};

/**
 * Screen reader type detection
 */
export type ScreenReaderType = "nvda" | "jaws" | "voiceover" | "narrator" | "orca" | "unknown";

/**
 * Screen reader capabilities
 */
export interface ScreenReaderCapabilities {
  /** Supports aria-live regions */
  supportsLiveRegions: boolean;
  /** Supports aria-describedby */
  supportsDescribedBy: boolean;
  /** Supports role="application" */
  supportsApplicationRole: boolean;
  /** Supports SVG accessibility */
  supportsSVGAccessibility: boolean;
  /** Supports virtual cursor */
  supportsVirtualCursor: boolean;
}

/**
 * Get default capabilities for a screen reader type
 */
export function getScreenReaderCapabilities(type: ScreenReaderType): ScreenReaderCapabilities {
  // All modern screen readers support these features
  const base: ScreenReaderCapabilities = {
    supportsLiveRegions: true,
    supportsDescribedBy: true,
    supportsApplicationRole: true,
    supportsSVGAccessibility: true,
    supportsVirtualCursor: true,
  };

  // Specific adjustments based on screen reader
  switch (type) {
    case "voiceover":
      // VoiceOver has excellent SVG support
      return { ...base };
    case "nvda":
      // NVDA has good overall support
      return { ...base };
    case "jaws":
      // JAWS has comprehensive support but different virtual cursor behavior
      return { ...base };
    case "narrator":
      // Windows Narrator has improving support
      return { ...base, supportsSVGAccessibility: false };
    case "orca":
      // Linux Orca screen reader
      return { ...base };
    default:
      return base;
  }
}

/**
 * WCAG 2.1 AA contrast ratio requirements
 */
export const WCAG_CONTRAST_RATIOS = {
  /** Normal text minimum contrast ratio */
  normalText: 4.5,
  /** Large text minimum contrast ratio (18pt+ or 14pt+ bold) */
  largeText: 3.0,
  /** UI components and graphical objects */
  uiComponent: 3.0,
  /** AAA level for normal text */
  normalTextAAA: 7.0,
  /** AAA level for large text */
  largeTextAAA: 4.5,
};

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.1 specification
 */
export function getRelativeLuminance(hexColor: string): number {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const toLinear = (c: number): number => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculate contrast ratio between two colors
 * Returns a value between 1 and 21
 */
export function getContrastRatio(color1: string, color2: string): number {
  const l1 = getRelativeLuminance(color1);
  const l2 = getRelativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if color combination meets WCAG AA requirements
 */
export function meetsWCAGAA(
  foreground: string,
  background: string,
  isLargeText: boolean = false
): boolean {
  const ratio = getContrastRatio(foreground, background);
  const required = isLargeText ? WCAG_CONTRAST_RATIOS.largeText : WCAG_CONTRAST_RATIOS.normalText;
  return ratio >= required;
}

/**
 * Check if color combination meets WCAG AAA requirements
 */
export function meetsWCAGAAA(
  foreground: string,
  background: string,
  isLargeText: boolean = false
): boolean {
  const ratio = getContrastRatio(foreground, background);
  const required = isLargeText ? WCAG_CONTRAST_RATIOS.largeTextAAA : WCAG_CONTRAST_RATIOS.normalTextAAA;
  return ratio >= required;
}
