/**
 * FocusIndicator - Visual feedback for keyboard focus state
 *
 * Provides visual indicators for focused elements in graph visualization:
 * - Focus ring around focused node
 * - Animated pulse effect
 * - High contrast mode support
 * - Screen reader announcements
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphNode as GraphNodeData } from "./types";

/**
 * Focus indicator style options
 */
export interface FocusIndicatorStyle {
  /** Ring color (default: '#4a90d9') */
  color: string;
  /** Ring thickness in pixels (default: 3) */
  thickness: number;
  /** Ring offset from node edge in pixels (default: 4) */
  offset: number;
  /** Enable pulse animation (default: true) */
  enablePulse: boolean;
  /** Pulse animation duration in ms (default: 1000) */
  pulseDuration: number;
  /** Enable glow effect (default: true) */
  enableGlow: boolean;
  /** Glow blur radius in pixels (default: 8) */
  glowRadius: number;
  /** High contrast mode (thicker ring, no animation) */
  highContrast: boolean;
  /** Opacity of the focus ring (default: 1) */
  opacity: number;
}

/**
 * Configuration for FocusIndicator
 */
export interface FocusIndicatorConfig {
  /** Enable focus indicator (default: true) */
  enabled: boolean;
  /** Style options */
  style: FocusIndicatorStyle;
  /** Enable screen reader announcements (default: true) */
  enableAnnouncements: boolean;
  /** Announcement template (default: 'Focused on {label}') */
  announcementTemplate: string;
  /** Show focus indicator only when using keyboard (default: true) */
  keyboardOnly: boolean;
}

/**
 * Focus state for a node
 */
export interface FocusState {
  /** Node ID */
  nodeId: string;
  /** Node data */
  node: GraphNodeData;
  /** Whether node has focus ring */
  hasFocusRing: boolean;
  /** Current animation progress (0-1) */
  animationProgress: number;
  /** Timestamp when focus was gained */
  focusedAt: number;
}

/**
 * Focus indicator render data
 */
export interface FocusIndicatorRenderData {
  /** Node ID */
  nodeId: string;
  /** Center X position */
  x: number;
  /** Center Y position */
  y: number;
  /** Node radius */
  nodeRadius: number;
  /** Ring radius (node radius + offset) */
  ringRadius: number;
  /** Ring thickness */
  thickness: number;
  /** Ring color */
  color: string;
  /** Opacity (affected by animation) */
  opacity: number;
  /** Scale (for pulse animation) */
  scale: number;
  /** Glow radius */
  glowRadius: number;
  /** Whether to show glow */
  showGlow: boolean;
}

/**
 * Focus event types
 */
export type FocusEventType =
  | "focus:gained"
  | "focus:lost"
  | "focus:animation:tick"
  | "focus:announced";

/**
 * Focus event data
 */
export interface FocusEvent {
  type: FocusEventType;
  nodeId: string | null;
  previousNodeId: string | null;
  node: GraphNodeData | null;
  announcement?: string;
}

/**
 * Event listener callback type
 */
export type FocusEventListener = (event: FocusEvent) => void;

/**
 * Default style values
 */
const DEFAULT_STYLE: FocusIndicatorStyle = {
  color: "#4a90d9",
  thickness: 3,
  offset: 4,
  enablePulse: true,
  pulseDuration: 1000,
  enableGlow: true,
  glowRadius: 8,
  highContrast: false,
  opacity: 1,
};

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: FocusIndicatorConfig = {
  enabled: true,
  style: DEFAULT_STYLE,
  enableAnnouncements: true,
  announcementTemplate: "Focused on {label}",
  keyboardOnly: true,
};

/**
 * FocusIndicator class for rendering focus state
 *
 * @example
 * ```typescript
 * const focus = new FocusIndicator();
 *
 * focus.on("focus:gained", (event) => {
 *   console.log("Focus gained on:", event.nodeId);
 * });
 *
 * focus.setFocusedNode(node);
 *
 * // In render loop
 * const renderData = focus.getRenderData(nodeRadius);
 * if (renderData) {
 *   drawFocusRing(renderData);
 * }
 *
 * // Cleanup
 * focus.destroy();
 * ```
 */
export class FocusIndicator {
  private config: FocusIndicatorConfig;
  private focusState: FocusState | null = null;
  private isKeyboardNavigation = false;
  private animationFrameId: number | null = null;

  // ARIA live region for announcements
  private liveRegion: HTMLElement | null = null;

  // Event listeners
  private listeners: Map<FocusEventType, Set<FocusEventListener>> = new Map();

  constructor(config?: Partial<FocusIndicatorConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      style: { ...DEFAULT_STYLE, ...config?.style },
    };

    if (this.config.enableAnnouncements && typeof document !== "undefined") {
      this.createLiveRegion();
    }
  }

  /**
   * Create ARIA live region for screen reader announcements
   */
  private createLiveRegion(): void {
    this.liveRegion = document.createElement("div");
    this.liveRegion.setAttribute("role", "status");
    this.liveRegion.setAttribute("aria-live", "polite");
    this.liveRegion.setAttribute("aria-atomic", "true");
    this.liveRegion.className = "sr-only focus-indicator-announcer";
    this.liveRegion.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(this.liveRegion);
  }

  /**
   * Set the focused node
   *
   * @param node - Node to focus, or null to clear focus
   */
  setFocusedNode(node: GraphNodeData | null): void {
    const previousNodeId = this.focusState?.nodeId ?? null;

    if (node === null) {
      this.focusState = null;
      this.stopAnimation();

      this.emit({
        type: "focus:lost",
        nodeId: null,
        previousNodeId,
        node: null,
      });
      return;
    }

    // Skip if already focused on same node
    if (this.focusState?.nodeId === node.id) {
      return;
    }

    this.focusState = {
      nodeId: node.id,
      node,
      hasFocusRing: true,
      animationProgress: 0,
      focusedAt: Date.now(),
    };

    // Emit focus gained event
    this.emit({
      type: "focus:gained",
      nodeId: node.id,
      previousNodeId,
      node,
    });

    // Make announcement
    if (this.config.enableAnnouncements) {
      this.announce(node);
    }

    // Start animation if enabled
    if (this.config.style.enablePulse && !this.config.style.highContrast) {
      this.startAnimation();
    }
  }

  /**
   * Get the currently focused node ID
   */
  getFocusedNodeId(): string | null {
    return this.focusState?.nodeId ?? null;
  }

  /**
   * Get the currently focused node
   */
  getFocusedNode(): GraphNodeData | null {
    return this.focusState?.node ?? null;
  }

  /**
   * Check if a node is focused
   */
  isNodeFocused(nodeId: string): boolean {
    return this.focusState?.nodeId === nodeId;
  }

  /**
   * Set keyboard navigation mode
   */
  setKeyboardNavigation(isKeyboard: boolean): void {
    this.isKeyboardNavigation = isKeyboard;
  }

  /**
   * Check if focus indicator should be shown
   */
  shouldShowIndicator(): boolean {
    if (!this.config.enabled) return false;
    if (!this.focusState) return false;
    if (this.config.keyboardOnly && !this.isKeyboardNavigation) return false;
    return true;
  }

  /**
   * Get render data for the focus indicator
   *
   * @param nodeRadius - Radius of the focused node
   * @returns Render data or null if no focus
   */
  getRenderData(nodeRadius?: number): FocusIndicatorRenderData | null {
    if (!this.shouldShowIndicator()) return null;
    if (!this.focusState) return null;

    const { style } = this.config;
    const { node, animationProgress } = this.focusState;

    const radius = nodeRadius ?? node.size ?? 8;
    const ringRadius = radius + style.offset;

    // Calculate animation values
    let opacity = style.opacity;
    let scale = 1;

    if (style.enablePulse && !style.highContrast) {
      // Pulse animation: fade in/out and scale
      const pulseProgress = Math.sin(animationProgress * Math.PI * 2) * 0.5 + 0.5;
      opacity = style.opacity * (0.7 + pulseProgress * 0.3);
      scale = 1 + pulseProgress * 0.1;
    }

    // High contrast overrides
    let thickness = style.thickness;
    if (style.highContrast) {
      thickness = style.thickness * 1.5;
      opacity = 1;
    }

    return {
      nodeId: this.focusState.nodeId,
      x: node.x ?? 0,
      y: node.y ?? 0,
      nodeRadius: radius,
      ringRadius: ringRadius * scale,
      thickness,
      color: style.color,
      opacity,
      scale,
      glowRadius: style.enableGlow ? style.glowRadius : 0,
      showGlow: style.enableGlow && !style.highContrast,
    };
  }

  /**
   * Announce focus change to screen readers
   */
  private announce(node: GraphNodeData): void {
    if (!this.liveRegion) return;

    const announcement = this.config.announcementTemplate.replace(
      "{label}",
      node.label || node.id
    );

    this.liveRegion.textContent = announcement;

    this.emit({
      type: "focus:announced",
      nodeId: node.id,
      previousNodeId: null,
      node,
      announcement,
    });
  }

  /**
   * Start pulse animation
   */
  private startAnimation(): void {
    if (this.animationFrameId !== null) return;
    this.tick();
  }

  /**
   * Stop pulse animation
   */
  private stopAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Animation tick
   */
  private tick = (): void => {
    if (!this.focusState) {
      this.stopAnimation();
      return;
    }

    const now = Date.now();
    const elapsed = now - this.focusState.focusedAt;
    const duration = this.config.style.pulseDuration;

    // Update animation progress (loops)
    this.focusState.animationProgress = (elapsed % duration) / duration;

    this.emit({
      type: "focus:animation:tick",
      nodeId: this.focusState.nodeId,
      previousNodeId: null,
      node: this.focusState.node,
    });

    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  /**
   * Update focused node position (call when node moves)
   */
  updateNodePosition(x: number, y: number): void {
    if (this.focusState) {
      this.focusState.node = {
        ...this.focusState.node,
        x,
        y,
      };
    }
  }

  /**
   * Update node data (call when node data changes)
   */
  updateNode(node: GraphNodeData): void {
    if (this.focusState && this.focusState.nodeId === node.id) {
      this.focusState.node = node;
    }
  }

  /**
   * Add event listener
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   */
  on(type: FocusEventType, listener: FocusEventListener): void {
    let typeListeners = this.listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      this.listeners.set(type, typeListeners);
    }
    typeListeners.add(listener);
  }

  /**
   * Remove event listener
   *
   * @param type - Event type
   * @param listener - Callback function to remove
   */
  off(type: FocusEventType, listener: FocusEventListener): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: FocusEvent): void {
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        listener(event);
      }
    }
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to merge
   */
  setConfig(config: Partial<FocusIndicatorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      style: { ...this.config.style, ...config?.style },
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): FocusIndicatorConfig {
    return {
      ...this.config,
      style: { ...this.config.style },
    };
  }

  /**
   * Set style options
   *
   * @param style - Partial style to merge
   */
  setStyle(style: Partial<FocusIndicatorStyle>): void {
    this.config.style = { ...this.config.style, ...style };
  }

  /**
   * Get current style
   */
  getStyle(): FocusIndicatorStyle {
    return { ...this.config.style };
  }

  /**
   * Enable high contrast mode
   */
  enableHighContrast(): void {
    this.config.style.highContrast = true;
    this.config.style.enablePulse = false;
    this.config.style.enableGlow = false;
    this.config.style.thickness = DEFAULT_STYLE.thickness * 1.5;
    this.stopAnimation();
  }

  /**
   * Disable high contrast mode
   */
  disableHighContrast(): void {
    this.config.style.highContrast = false;
    this.config.style.enablePulse = DEFAULT_STYLE.enablePulse;
    this.config.style.enableGlow = DEFAULT_STYLE.enableGlow;
    this.config.style.thickness = DEFAULT_STYLE.thickness;

    if (this.focusState && this.config.style.enablePulse) {
      this.startAnimation();
    }
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable focus indicator
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable focus indicator
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Destroy the focus indicator and cleanup
   */
  destroy(): void {
    this.stopAnimation();

    if (this.liveRegion && this.liveRegion.parentNode) {
      this.liveRegion.parentNode.removeChild(this.liveRegion);
    }
    this.liveRegion = null;

    this.focusState = null;
    this.listeners.clear();
  }
}

/**
 * Default FocusIndicator configuration
 */
export const DEFAULT_FOCUS_INDICATOR_CONFIG = DEFAULT_CONFIG;

/**
 * Default FocusIndicator style
 */
export const DEFAULT_FOCUS_INDICATOR_STYLE = DEFAULT_STYLE;
