/**
 * AccessibilityManager - Comprehensive WCAG 2.1 AA compliant accessibility manager
 *
 * Orchestrates all accessibility features for graph visualization:
 * - Screen reader announcements (NVDA, VoiceOver, JAWS)
 * - Keyboard navigation with virtual cursor
 * - High contrast mode support
 * - Reduced motion preferences
 * - Focus management and skip links
 * - ARIA attributes and live regions
 *
 * @module presentation/renderers/graph/accessibility
 * @since 1.0.0
 */

import type { GraphNode as GraphNodeData, GraphEdge as GraphEdgeData } from "../types";
import type {
  A11yConfig,
  A11yNode,
  A11yEvent,
  A11yEventType,
  A11yEventListener,
  Announcement,
  AnnouncementType,
  AriaLivePoliteness,
  HighContrastColors,
  ReducedMotionConfig,
  SkipLink,
  FocusTrapConfig,
  ScreenReaderType,
} from "./AccessibilityTypes";
import {
  DEFAULT_A11Y_CONFIG,
  DEFAULT_REDUCED_MOTION_CONFIG,
  HIGH_CONTRAST_THEMES,
} from "./AccessibilityTypes";
import {
  VirtualCursor,
  createVirtualCursor,
  type VirtualCursorConfig,
} from "./VirtualCursor";

/**
 * AccessibilityManager configuration
 */
export interface AccessibilityManagerConfig extends Partial<A11yConfig> {
  /** Virtual cursor configuration */
  virtualCursor?: Partial<VirtualCursorConfig>;
  /** Custom high contrast colors */
  highContrastColors?: HighContrastColors;
  /** Custom skip links */
  skipLinks?: SkipLink[];
  /** Debounce time for announcements in ms (default: 150) */
  announcementDebounce?: number;
}

/**
 * Default AccessibilityManager configuration
 */
export const DEFAULT_ACCESSIBILITY_MANAGER_CONFIG: AccessibilityManagerConfig = {
  ...DEFAULT_A11Y_CONFIG,
  announcementDebounce: 150,
};

/**
 * AccessibilityManager class for WCAG 2.1 AA compliance
 *
 * @example
 * ```typescript
 * const a11y = new AccessibilityManager(container);
 *
 * // Set up nodes and edges
 * a11y.setGraphData(nodes, edges);
 *
 * // Listen for accessibility events
 * a11y.on('a11y:navigation', (event) => {
 *   console.log('Navigated to:', event.nodeId);
 * });
 *
 * // Make an announcement
 * a11y.announce('Selected node: Project Alpha', 'selection');
 *
 * // Enable high contrast mode
 * a11y.enableHighContrast();
 *
 * // Cleanup
 * a11y.destroy();
 * ```
 */
export class AccessibilityManager {
  private config: A11yConfig;
  private container: HTMLElement;
  private virtualCursor: VirtualCursor;

  // Live regions for screen reader announcements
  private politeRegion: HTMLElement | null = null;
  private assertiveRegion: HTMLElement | null = null;

  // Announcement queue and debouncing
  private announcementQueue: Announcement[] = [];
  private announcementTimer: number | null = null;
  private lastAnnouncementTime = 0;

  // Focus management
  private focusedNodeId: string | null = null;
  private _focusTrap: FocusTrapConfig | null = null;

  // Skip links
  private skipLinksContainer: HTMLElement | null = null;
  private skipLinks: SkipLink[] = [];

  // Preference detection
  private reducedMotionQuery: MediaQueryList | null = null;
  private highContrastQuery: MediaQueryList | null = null;
  private reducedMotionConfig: ReducedMotionConfig;

  // High contrast colors
  private highContrastColors: HighContrastColors;

  // Graph data
  private nodes: GraphNodeData[] = [];
  private edges: GraphEdgeData[] = [];

  // Event listeners
  private listeners: Map<A11yEventType, Set<A11yEventListener>> = new Map();

  // Bound handlers for cleanup
  private boundReducedMotionChange: ((e: MediaQueryListEvent) => void) | null = null;
  private boundHighContrastChange: ((e: MediaQueryListEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, config?: AccessibilityManagerConfig) {
    this.container = container;
    this.config = { ...DEFAULT_A11Y_CONFIG, ...config };
    this.reducedMotionConfig = { ...DEFAULT_REDUCED_MOTION_CONFIG };
    this.highContrastColors = config?.highContrastColors ?? HIGH_CONTRAST_THEMES.dark;
    this.skipLinks = config?.skipLinks ?? [];

    // Create virtual cursor
    this.virtualCursor = createVirtualCursor({
      ...config?.virtualCursor,
      onPositionChange: (nodeId, previousNodeId) => {
        this.handleCursorMove(nodeId, previousNodeId);
      },
      onModeChange: (mode) => {
        this.emit({
          type: "a11y:mode:change",
          mode,
        });
      },
    });

    // Initialize
    this.setupLiveRegions();
    this.setupARIA();
    this.setupSkipLinks();
    this.setupMediaQueries();
    this.setupKeyboardHandler();

    // Apply initial preferences
    this.detectPreferences();
  }

  /**
   * Set up ARIA live regions for screen reader announcements
   */
  private setupLiveRegions(): void {
    // Create polite live region (for non-urgent announcements)
    this.politeRegion = document.createElement("div");
    this.politeRegion.setAttribute("role", "status");
    this.politeRegion.setAttribute("aria-live", "polite");
    this.politeRegion.setAttribute("aria-atomic", "true");
    this.politeRegion.className = "exo-a11y-live-region exo-a11y-polite";
    this.setVisuallyHiddenStyles(this.politeRegion);

    // Create assertive live region (for urgent announcements)
    this.assertiveRegion = document.createElement("div");
    this.assertiveRegion.setAttribute("role", "alert");
    this.assertiveRegion.setAttribute("aria-live", "assertive");
    this.assertiveRegion.setAttribute("aria-atomic", "true");
    this.assertiveRegion.className = "exo-a11y-live-region exo-a11y-assertive";
    this.setVisuallyHiddenStyles(this.assertiveRegion);

    // Append to document body (not container, to ensure screen readers pick them up)
    document.body.appendChild(this.politeRegion);
    document.body.appendChild(this.assertiveRegion);
  }

  /**
   * Set visually hidden styles (visible to screen readers)
   */
  private setVisuallyHiddenStyles(element: HTMLElement): void {
    element.style.cssText = `
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
  }

  /**
   * Set up ARIA attributes on the container
   */
  private setupARIA(): void {
    // Make container focusable
    if (!this.container.hasAttribute("tabindex")) {
      this.container.setAttribute("tabindex", "0");
    }

    // Set role to application for keyboard handling
    this.container.setAttribute("role", "application");
    this.container.setAttribute("aria-roledescription", this.config.graphRoleDescription);

    // Add label
    const labelId = `exo-graph-label-${Math.random().toString(36).substring(2, 9)}`;
    let label = this.container.querySelector(`#${labelId}`);
    if (!label) {
      label = document.createElement("span");
      label.id = labelId;
      label.className = "exo-a11y-label";
      this.setVisuallyHiddenStyles(label as HTMLElement);
      label.textContent = this.config.graphRoleDescription;
      this.container.insertBefore(label, this.container.firstChild);
    }
    this.container.setAttribute("aria-labelledby", labelId);

    // Add keyboard instructions
    const instructionsId = `exo-graph-instructions-${Math.random().toString(36).substring(2, 9)}`;
    let instructions = this.container.querySelector(`#${instructionsId}`);
    if (!instructions) {
      instructions = document.createElement("span");
      instructions.id = instructionsId;
      instructions.className = "exo-a11y-instructions";
      this.setVisuallyHiddenStyles(instructions as HTMLElement);
      // Screen reader instructions (visually hidden, exempt from UI text rules)
      /* eslint-disable obsidianmd/ui/sentence-case */
      instructions.textContent = "Use arrow keys to navigate between nodes. Press Enter to open a node. Press Escape to exit.";
      /* eslint-enable obsidianmd/ui/sentence-case */
      this.container.insertBefore(instructions, this.container.firstChild);
    }
    this.container.setAttribute("aria-describedby", instructionsId);
  }

  /**
   * Set up skip links for keyboard navigation
   */
  private setupSkipLinks(): void {
    if (!this.config.enableSkipLinks) return;

    this.skipLinksContainer = document.createElement("div");
    this.skipLinksContainer.className = "exo-a11y-skip-links";
    this.skipLinksContainer.setAttribute("role", "navigation");
    this.skipLinksContainer.setAttribute("aria-label", "Skip links");

    // Default skip links
    const defaultSkipLinks: SkipLink[] = [
      {
        id: "skip-to-graph",
        label: "Skip to graph",
        targetId: this.container.id || "exo-graph-container",
      },
      {
        id: "skip-to-first-node",
        label: "Skip to first node",
        targetId: "first-node",
      },
    ];

    const allSkipLinks = [...defaultSkipLinks, ...this.skipLinks];

    for (const link of allSkipLinks) {
      const a = document.createElement("a");
      a.href = `#${link.targetId}`;
      a.className = "exo-skip-link";
      a.textContent = link.label;
      if (link.shortcut) {
        a.setAttribute("aria-keyshortcuts", link.shortcut);
      }

      // Style for focus visibility only
      a.style.cssText = `
        position: absolute;
        left: -9999px;
        z-index: 9999;
        padding: 8px 16px;
        background: var(--background-primary, #fff);
        color: var(--text-normal, #000);
        text-decoration: none;
        border: 2px solid var(--interactive-accent, #0066cc);
        border-radius: 4px;
      `;

      a.addEventListener("focus", () => {
        a.classList.add("exo-skip-link-visible");
      });

      a.addEventListener("blur", () => {
        a.classList.remove("exo-skip-link-visible");
      });

      a.addEventListener("click", (e) => {
        e.preventDefault();
        this.handleSkipLinkClick(link);
      });

      this.skipLinksContainer.appendChild(a);
    }

    // Insert at the beginning of the container
    this.container.insertBefore(this.skipLinksContainer, this.container.firstChild);
  }

  /**
   * Handle skip link click
   */
  private handleSkipLinkClick(link: SkipLink): void {
    if (link.targetId === "first-node" && this.nodes.length > 0) {
      this.virtualCursor.setPosition(this.nodes[0].id);
      this.focusNode(this.nodes[0].id);
    } else {
      const target = document.getElementById(link.targetId);
      if (target) {
        target.focus();
      }
    }
  }

  /**
   * Set up media query listeners for preferences
   */
  private setupMediaQueries(): void {
    if (typeof window === "undefined") return;

    // Reduced motion preference
    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.boundReducedMotionChange = (e: MediaQueryListEvent) => {
      this.handleReducedMotionChange(e.matches);
    };
    this.reducedMotionQuery.addEventListener("change", this.boundReducedMotionChange);

    // High contrast preference
    this.highContrastQuery = window.matchMedia(
      "(prefers-contrast: more), (-ms-high-contrast: active)"
    );
    this.boundHighContrastChange = (e: MediaQueryListEvent) => {
      this.handleHighContrastChange(e.matches);
    };
    this.highContrastQuery.addEventListener("change", this.boundHighContrastChange);
  }

  /**
   * Set up keyboard handler
   */
  private setupKeyboardHandler(): void {
    this.boundKeyDown = (e: KeyboardEvent) => {
      this.handleKeyDown(e);
    };
    this.container.addEventListener("keydown", this.boundKeyDown);
  }

  /**
   * Detect and apply user preferences
   */
  private detectPreferences(): void {
    // Check reduced motion
    if (this.config.respectReducedMotion && this.reducedMotionQuery?.matches) {
      this.handleReducedMotionChange(true);
    }

    // Check high contrast
    if (this.highContrastQuery?.matches) {
      this.config.highContrastMode = true;
      this.applyHighContrast();
    }
  }

  /**
   * Handle reduced motion preference change
   */
  private handleReducedMotionChange(reducedMotion: boolean): void {
    if (!this.config.respectReducedMotion) return;

    if (reducedMotion) {
      this.reducedMotionConfig = { ...DEFAULT_REDUCED_MOTION_CONFIG };
    } else {
      this.reducedMotionConfig = {
        disableAnimations: false,
        disableTransitions: false,
        instantNavigation: false,
        reduceParallax: false,
      };
    }

    this.emit({
      type: "a11y:config:change",
      config: { respectReducedMotion: reducedMotion },
    });
  }

  /**
   * Handle high contrast preference change
   */
  private handleHighContrastChange(highContrast: boolean): void {
    this.config.highContrastMode = highContrast;

    if (highContrast) {
      this.applyHighContrast();
    } else {
      this.removeHighContrast();
    }

    this.emit({
      type: "a11y:config:change",
      config: { highContrastMode: highContrast },
    });
  }

  /**
   * Handle keyboard events
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.config.enableKeyboardNav) return;

    // Check for virtual cursor navigation
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        this.virtualCursor.navigate("up");
        break;
      case "ArrowDown":
        e.preventDefault();
        this.virtualCursor.navigate("down");
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.virtualCursor.navigate("left");
        break;
      case "ArrowRight":
        e.preventDefault();
        this.virtualCursor.navigate("right");
        break;
      case "Tab":
        if (e.shiftKey) {
          e.preventDefault();
          this.virtualCursor.navigate("previous");
        } else {
          e.preventDefault();
          this.virtualCursor.navigate("next");
        }
        break;
      case "Home":
        e.preventDefault();
        this.virtualCursor.navigate("first");
        break;
      case "End":
        e.preventDefault();
        this.virtualCursor.navigate("last");
        break;
      case "Backspace":
      case "BrowserBack":
        if (e.altKey || e.key === "BrowserBack") {
          e.preventDefault();
          this.virtualCursor.goBack();
        }
        break;
      case "BrowserForward":
        e.preventDefault();
        this.virtualCursor.goForward();
        break;
      case "?":
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          this.announceHelp();
        }
        break;
      case "m":
        if (e.altKey) {
          // Alt+M to cycle navigation modes
          e.preventDefault();
          this.cycleNavigationMode();
        }
        break;
    }
  }

  /**
   * Handle virtual cursor move
   */
  private handleCursorMove(nodeId: string | null, previousNodeId: string | null): void {
    this.focusedNodeId = nodeId;

    // Announce navigation
    if (this.config.announceNavigations && nodeId) {
      const node = this.virtualCursor.getCurrentNode();
      if (node) {
        this.announceNode(node, "navigation");
      }
    }

    this.emit({
      type: "a11y:navigation",
      nodeId,
      previousNodeId,
      node: nodeId ? this.virtualCursor.getCurrentNode() : null,
    });
  }

  /**
   * Cycle through navigation modes
   */
  private cycleNavigationMode(): void {
    const modes: Array<"spatial" | "linear" | "semantic"> = ["spatial", "linear", "semantic"];
    const currentIndex = modes.indexOf(this.virtualCursor.getMode());
    const nextIndex = (currentIndex + 1) % modes.length;
    const newMode = modes[nextIndex];

    this.virtualCursor.setMode(newMode);

    const modeNames = {
      spatial: "spatial navigation",
      linear: "linear navigation",
      semantic: "semantic navigation",
    };

    this.announce(`Switched to ${modeNames[newMode]}`, "status");
  }

  /**
   * Announce help information
   */
  private announceHelp(): void {
    const help = [
      "Keyboard shortcuts:",
      "Arrow keys: navigate spatially",
      "Tab and Shift+Tab: navigate linearly",
      "Home: go to first node",
      "End: go to last node",
      "Alt+Backspace: go back in history",
      "Alt+M: cycle navigation mode",
      "Question mark: announce this help",
    ].join(". ");

    this.announce(help, "help", "assertive");
  }

  /**
   * Set graph data for accessibility
   */
  setGraphData(nodes: GraphNodeData[], edges: GraphEdgeData[]): void {
    this.nodes = nodes;
    this.edges = edges;

    this.virtualCursor.setNodes(nodes);
    this.virtualCursor.updateConnections(
      edges.map((e) => ({
        source: typeof e.source === "string" ? e.source : e.source.id,
        target: typeof e.target === "string" ? e.target : e.target.id,
        label: e.label,
      }))
    );

    // Announce structure if enabled
    if (this.config.announceGraphChanges) {
      this.announceGraphStructure();
    }
  }

  /**
   * Announce graph structure summary
   */
  announceGraphStructure(): void {
    const nodeCount = this.nodes.length;
    const edgeCount = this.edges.length;

    const message = `Graph loaded with ${nodeCount} ${nodeCount === 1 ? "node" : "nodes"} and ${edgeCount} ${edgeCount === 1 ? "connection" : "connections"}.`;

    this.announce(message, "structure");
  }

  /**
   * Announce a node's information
   */
  announceNode(node: A11yNode, type: AnnouncementType = "navigation"): void {
    const parts: string[] = [];

    // Label and type
    parts.push(`${node.label}, ${node.type}`);

    // Connection info
    if (node.connectionCount > 0) {
      parts.push(
        `${node.connectionCount} ${node.connectionCount === 1 ? "connection" : "connections"}`
      );
    } else {
      parts.push("no connections");
    }

    // Position in list
    parts.push(`${node.index + 1} of ${this.nodes.length}`);

    // Selection state
    if (node.isSelected) {
      parts.push("selected");
    }

    const message = parts.join(", ");
    this.announce(message, type);
  }

  /**
   * Make an announcement to screen readers
   */
  announce(
    message: string,
    type: AnnouncementType = "status",
    politeness: AriaLivePoliteness = "polite"
  ): void {
    if (!this.config.enableScreenReader) return;

    const announcement: Announcement = {
      message,
      type,
      politeness,
    };

    this.queueAnnouncement(announcement);
  }

  /**
   * Queue an announcement with debouncing
   */
  private queueAnnouncement(announcement: Announcement): void {
    // For assertive announcements, announce immediately
    if (announcement.politeness === "assertive") {
      this.makeAnnouncement(announcement);
      return;
    }

    // Add to queue
    this.announcementQueue.push(announcement);

    // Debounce polite announcements
    if (this.announcementTimer !== null) {
      window.clearTimeout(this.announcementTimer);
    }

    const delay = Math.max(
      this.config.announcementDelay,
      this.lastAnnouncementTime + this.config.announcementDelay - Date.now()
    );

    this.announcementTimer = window.setTimeout(() => {
      this.processAnnouncementQueue();
    }, delay);
  }

  /**
   * Process queued announcements
   */
  private processAnnouncementQueue(): void {
    if (this.announcementQueue.length === 0) return;

    // Combine similar announcements
    const lastAnnouncement = this.announcementQueue[this.announcementQueue.length - 1];
    this.announcementQueue = [];

    this.makeAnnouncement(lastAnnouncement);
  }

  /**
   * Make an announcement to the appropriate live region
   */
  private makeAnnouncement(announcement: Announcement): void {
    const region =
      announcement.politeness === "assertive" ? this.assertiveRegion : this.politeRegion;

    if (!region) return;

    // Clear previous content (forces screen reader to re-read)
    region.textContent = "";

    // Use setTimeout to ensure the clear is processed
    setTimeout(() => {
      region.textContent = announcement.message;
      this.lastAnnouncementTime = Date.now();

      this.emit({
        type: "a11y:announcement",
        message: announcement.message,
      });
    }, 50);
  }

  /**
   * Focus on a specific node
   */
  focusNode(nodeId: string): void {
    this.virtualCursor.setPosition(nodeId);

    // Also update actual DOM focus if there's a corresponding element
    const nodeElement = this.container.querySelector(`[data-node-id="${nodeId}"]`);
    if (nodeElement instanceof HTMLElement) {
      nodeElement.focus();
    }
  }

  /**
   * Select a node and announce selection
   */
  selectNode(nodeId: string): void {
    const a11yNode = this.virtualCursor.getA11yNodes().find((n) => n.id === nodeId);
    if (a11yNode) {
      a11yNode.isSelected = !a11yNode.isSelected;

      if (this.config.announceSelections) {
        const action = a11yNode.isSelected ? "Selected" : "Deselected";
        this.announce(`${action}: ${a11yNode.label}`, "selection");
      }

      this.emit({
        type: "a11y:selection:change",
        nodeId,
        node: a11yNode,
      });
    }
  }

  /**
   * Enable high contrast mode
   * If custom colors were set via setHighContrastColors, those are used.
   * Otherwise, the theme colors are applied.
   */
  enableHighContrast(theme?: "dark" | "light"): void {
    this.config.highContrastMode = true;
    // Only apply theme colors if a theme is specified
    // This preserves custom colors set via setHighContrastColors
    if (theme) {
      this.highContrastColors = HIGH_CONTRAST_THEMES[theme];
    }
    this.applyHighContrast();

    this.announce("High contrast mode enabled", "status");
  }

  /**
   * Disable high contrast mode
   */
  disableHighContrast(): void {
    this.config.highContrastMode = false;
    this.removeHighContrast();

    this.announce("High contrast mode disabled", "status");
  }

  /**
   * Apply high contrast styles
   */
  private applyHighContrast(): void {
    this.container.classList.add("exo-high-contrast");
    this.container.style.setProperty("--exo-hc-foreground", this.highContrastColors.foreground);
    this.container.style.setProperty("--exo-hc-background", this.highContrastColors.background);
    this.container.style.setProperty("--exo-hc-accent", this.highContrastColors.accent);
    this.container.style.setProperty("--exo-hc-focus", this.highContrastColors.focusIndicator);
    this.container.style.setProperty("--exo-hc-selection", this.highContrastColors.selection);
    this.container.style.setProperty("--exo-hc-error", this.highContrastColors.error);
    this.container.style.setProperty("--exo-hc-border", this.highContrastColors.border);
  }

  /**
   * Remove high contrast styles
   */
  private removeHighContrast(): void {
    this.container.classList.remove("exo-high-contrast");
    this.container.style.removeProperty("--exo-hc-foreground");
    this.container.style.removeProperty("--exo-hc-background");
    this.container.style.removeProperty("--exo-hc-accent");
    this.container.style.removeProperty("--exo-hc-focus");
    this.container.style.removeProperty("--exo-hc-selection");
    this.container.style.removeProperty("--exo-hc-error");
    this.container.style.removeProperty("--exo-hc-border");
  }

  /**
   * Create a focus trap for modal dialogs
   */
  createFocusTrap(config: FocusTrapConfig): () => void {
    this._focusTrap = config;
    const { container, initialFocus, onEscape } = config;

    // Get focusable elements
    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = container.querySelectorAll(focusableSelector);
    const firstFocusable = focusableElements[0] as HTMLElement;
    const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

    // Focus initial element
    const elementToFocus = initialFocus || firstFocusable;
    elementToFocus?.focus();

    // Handle tab key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable?.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable?.focus();
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onEscape?.();
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    // Return cleanup function
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      this._focusTrap = null;

      // Return focus
      config.returnFocusTo?.focus();
    };
  }

  /**
   * Get reduced motion configuration
   */
  getReducedMotionConfig(): ReducedMotionConfig {
    return { ...this.reducedMotionConfig };
  }

  /**
   * Check if reduced motion is active
   */
  isReducedMotionActive(): boolean {
    return this.config.respectReducedMotion && this.reducedMotionConfig.disableAnimations;
  }

  /**
   * Check if high contrast mode is active
   */
  isHighContrastActive(): boolean {
    return this.config.highContrastMode;
  }

  /**
   * Get current configuration
   */
  getConfig(): A11yConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<A11yConfig>): void {
    this.config = { ...this.config, ...config };

    this.emit({
      type: "a11y:config:change",
      config,
    });
  }

  /**
   * Get virtual cursor
   */
  getVirtualCursor(): VirtualCursor {
    return this.virtualCursor;
  }

  /**
   * Get focused node ID
   */
  getFocusedNodeId(): string | null {
    return this.focusedNodeId;
  }

  /**
   * Check if a focus trap is currently active
   */
  hasFocusTrap(): boolean {
    return this._focusTrap !== null;
  }

  /**
   * Get high contrast colors
   */
  getHighContrastColors(): HighContrastColors {
    return { ...this.highContrastColors };
  }

  /**
   * Set custom high contrast colors
   */
  setHighContrastColors(colors: Partial<HighContrastColors>): void {
    this.highContrastColors = { ...this.highContrastColors, ...colors };

    if (this.config.highContrastMode) {
      this.applyHighContrast();
    }
  }

  /**
   * Detect screen reader type (best effort)
   * Note: Accurate screen reader detection is challenging. This provides
   * a best-effort heuristic based on platform and environment clues.
   */
  detectScreenReader(): ScreenReaderType {
    // Check for NVDA via ARIA attribute patterns
    if (
      typeof document !== "undefined" &&
      document.body.getAttribute("aria-describedby")?.includes("nvda")
    ) {
      return "nvda";
    }

    // Check for VoiceOver via speechSynthesis (commonly available when VoiceOver is active)
    // Note: We intentionally detect macOS/iOS via speechSynthesis presence
    // as a proxy for VoiceOver since accurate screen reader detection is difficult
    if (typeof (window as unknown as { speechSynthesis: unknown }).speechSynthesis !== "undefined") {
      return "voiceover";
    }

    return "unknown";
  }

  /**
   * Add event listener
   */
  on(type: A11yEventType, listener: A11yEventListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  off(type: A11yEventType, listener: A11yEventListener): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Emit event
   */
  private emit(event: A11yEvent): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("AccessibilityManager event listener error:", error);
        }
      }
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    // Clear announcement timer
    if (this.announcementTimer !== null) {
      window.clearTimeout(this.announcementTimer);
    }

    // Remove live regions
    if (this.politeRegion?.parentNode) {
      this.politeRegion.parentNode.removeChild(this.politeRegion);
    }
    if (this.assertiveRegion?.parentNode) {
      this.assertiveRegion.parentNode.removeChild(this.assertiveRegion);
    }

    // Remove skip links
    if (this.skipLinksContainer?.parentNode) {
      this.skipLinksContainer.parentNode.removeChild(this.skipLinksContainer);
    }

    // Remove media query listeners
    if (this.reducedMotionQuery && this.boundReducedMotionChange) {
      this.reducedMotionQuery.removeEventListener("change", this.boundReducedMotionChange);
    }
    if (this.highContrastQuery && this.boundHighContrastChange) {
      this.highContrastQuery.removeEventListener("change", this.boundHighContrastChange);
    }

    // Remove keyboard listener
    if (this.boundKeyDown) {
      this.container.removeEventListener("keydown", this.boundKeyDown);
    }

    // Remove high contrast styles
    if (this.config.highContrastMode) {
      this.removeHighContrast();
    }

    // Destroy virtual cursor
    this.virtualCursor.destroy();

    // Clear event listeners
    this.listeners.clear();

    // Clear references
    this.politeRegion = null;
    this.assertiveRegion = null;
    this.skipLinksContainer = null;
    this._focusTrap = null;
    this.nodes = [];
    this.edges = [];
  }
}

/**
 * Create an AccessibilityManager with default configuration
 */
export function createAccessibilityManager(
  container: HTMLElement,
  config?: AccessibilityManagerConfig
): AccessibilityManager {
  return new AccessibilityManager(container, config);
}
