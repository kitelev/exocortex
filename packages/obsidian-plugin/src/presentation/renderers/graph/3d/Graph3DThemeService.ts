/**
 * Graph3DThemeService - Theme-aware coloring for 3D graph visualization
 *
 * Provides ontology-based node coloring and predicate-based edge coloring
 * with support for Obsidian dark/light themes.
 *
 * Features:
 * - Obsidian theme detection (dark/light mode)
 * - Node colors by ontology namespace (exo# = blue, ems# = green, etc.)
 * - Edge colors by predicate type (rdf:type = orange)
 * - WCAG AA contrast compliance
 * - Theme change event subscription
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

import { calculateContrastRatio, meetsWCAGAA } from "../search/SearchTypes";

/**
 * Theme mode (dark or light)
 */
export type ThemeMode = "dark" | "light";

/**
 * Ontology namespace identifiers
 */
export type OntologyNamespace =
  | "exo"
  | "ems"
  | "ims"
  | "rdf"
  | "rdfs"
  | "owl"
  | "xsd"
  | "unknown";

/**
 * Color configuration for a theme
 */
export interface ThemeColors {
  /** Scene background color (hex) */
  background: string;
  /** Node colors by ontology namespace */
  nodeColors: Record<OntologyNamespace, string>;
  /** Edge colors by predicate type */
  edgeColors: {
    /** rdf:type edges (orange) */
    rdfType: string;
    /** rdfs:subClassOf edges */
    subClassOf: string;
    /** owl:sameAs edges */
    sameAs: string;
    /** Default edge color */
    default: string;
  };
  /** Label text color */
  labelColor: string;
  /** Label background color */
  labelBackground: string;
  /** Fog color (usually matches background) */
  fogColor: string;
}

/**
 * Complete theme configuration
 */
export interface Graph3DThemeConfig {
  dark: ThemeColors;
  light: ThemeColors;
}

/**
 * Default theme configuration
 *
 * Colors are designed for WCAG AA compliance:
 * - Dark mode: Colors on #1E1E1E background
 * - Light mode: Colors on #F5F5F5 background
 */
export const DEFAULT_THEME_CONFIG: Graph3DThemeConfig = {
  dark: {
    background: "#1E1E1E",
    nodeColors: {
      exo: "#4A90E2", // Blue - Exocortex core types
      ems: "#7ED321", // Green - Entity Management System (Tasks, Projects, Areas)
      ims: "#9B59B6", // Purple - Information Management System (Concepts)
      rdf: "#F5A623", // Orange - RDF core vocabulary
      rdfs: "#E67E22", // Dark Orange - RDFS vocabulary
      owl: "#E74C3C", // Red - OWL vocabulary
      xsd: "#1ABC9C", // Teal - XSD datatypes
      unknown: "#95A5A6", // Gray - Unknown namespaces
    },
    edgeColors: {
      rdfType: "#F5A623", // Orange - rdf:type
      subClassOf: "#9B59B6", // Purple - rdfs:subClassOf
      sameAs: "#3498DB", // Blue - owl:sameAs
      default: "#64748B", // Slate gray - default edges
    },
    labelColor: "#E2E8F0",
    labelBackground: "rgba(30, 30, 30, 0.85)",
    fogColor: "#1E1E1E",
  },
  light: {
    background: "#F5F5F5",
    nodeColors: {
      exo: "#2563EB", // Darker Blue for light background
      ems: "#16A34A", // Darker Green for light background
      ims: "#7C3AED", // Darker Purple for light background
      rdf: "#D97706", // Darker Orange for light background
      rdfs: "#C2410C", // Darker Dark Orange for light background
      owl: "#DC2626", // Darker Red for light background
      xsd: "#0D9488", // Darker Teal for light background
      unknown: "#6B7280", // Darker Gray for light background
    },
    edgeColors: {
      rdfType: "#D97706", // Darker Orange
      subClassOf: "#7C3AED", // Darker Purple
      sameAs: "#2563EB", // Darker Blue
      default: "#475569", // Darker Slate
    },
    labelColor: "#1E293B",
    labelBackground: "rgba(245, 245, 245, 0.85)",
    fogColor: "#F5F5F5",
  },
};

/**
 * Event types for theme changes
 */
export type Graph3DThemeEventType = "themeChange";

/**
 * Theme change event payload
 */
export interface Graph3DThemeEvent {
  type: Graph3DThemeEventType;
  mode: ThemeMode;
  colors: ThemeColors;
}

/**
 * Theme event listener callback
 */
export type Graph3DThemeEventListener = (event: Graph3DThemeEvent) => void;

/**
 * Graph3DThemeService - Manages theming for 3D graph visualization
 *
 * @example
 * ```typescript
 * const themeService = new Graph3DThemeService();
 *
 * // Get current theme colors
 * const colors = themeService.getThemeColors();
 *
 * // Get node color by URI
 * const nodeColor = themeService.getNodeColor("https://exocortex.my/ontology/exo#Asset");
 *
 * // Get edge color by predicate
 * const edgeColor = themeService.getEdgeColor("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
 *
 * // Listen for theme changes
 * themeService.on("themeChange", (event) => {
 *   scene.background = new THREE.Color(event.colors.background);
 * });
 *
 * // Cleanup
 * themeService.destroy();
 * ```
 */
export class Graph3DThemeService {
  private config: Graph3DThemeConfig;
  private currentMode: ThemeMode;
  private listeners: Set<Graph3DThemeEventListener> = new Set();
  private mutationObserver: MutationObserver | null = null;

  constructor(config: Partial<Graph3DThemeConfig> = {}) {
    this.config = {
      dark: { ...DEFAULT_THEME_CONFIG.dark, ...config.dark },
      light: { ...DEFAULT_THEME_CONFIG.light, ...config.light },
    };

    // Detect initial theme
    this.currentMode = this.detectObsidianTheme();

    // Setup theme change observer
    this.setupThemeObserver();
  }

  /**
   * Detect Obsidian's current theme mode
   *
   * Obsidian uses `theme-dark` or `theme-light` class on the body element
   */
  detectObsidianTheme(): ThemeMode {
    if (typeof document === "undefined") {
      return "dark"; // Default to dark in non-browser environments
    }

    const body = document.body;

    // Check Obsidian's theme class
    if (body.classList.contains("theme-light")) {
      return "light";
    }

    if (body.classList.contains("theme-dark")) {
      return "dark";
    }

    // Fallback: Check system preference
    if (typeof window !== "undefined" && window.matchMedia) {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
      return prefersDark.matches ? "dark" : "light";
    }

    return "dark"; // Default to dark mode
  }

  /**
   * Setup MutationObserver to detect Obsidian theme changes
   */
  private setupThemeObserver(): void {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const newMode = this.detectObsidianTheme();
          if (newMode !== this.currentMode) {
            this.currentMode = newMode;
            this.emit({
              type: "themeChange",
              mode: newMode,
              colors: this.getThemeColors(),
            });
          }
        }
      }
    });

    this.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Also listen to system theme changes
    if (typeof window !== "undefined" && window.matchMedia) {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
      prefersDark.addEventListener("change", (e) => {
        // Only update if Obsidian doesn't have explicit theme
        const body = document.body;
        if (
          !body.classList.contains("theme-light") &&
          !body.classList.contains("theme-dark")
        ) {
          const newMode = e.matches ? "dark" : "light";
          if (newMode !== this.currentMode) {
            this.currentMode = newMode;
            this.emit({
              type: "themeChange",
              mode: newMode,
              colors: this.getThemeColors(),
            });
          }
        }
      });
    }
  }

  /**
   * Get current theme mode
   */
  getThemeMode(): ThemeMode {
    return this.currentMode;
  }

  /**
   * Get theme colors for current mode
   */
  getThemeColors(): ThemeColors {
    return this.config[this.currentMode];
  }

  /**
   * Get background color as hex number for Three.js
   */
  getBackgroundColorNumber(): number {
    const colors = this.getThemeColors();
    return parseInt(colors.background.replace("#", ""), 16);
  }

  /**
   * Get fog color as hex number for Three.js
   */
  getFogColorNumber(): number {
    const colors = this.getThemeColors();
    return parseInt(colors.fogColor.replace("#", ""), 16);
  }

  /**
   * Extract ontology namespace from URI
   *
   * @param uri - Full URI or prefixed name
   * @returns Detected namespace
   */
  extractNamespace(uri: string): OntologyNamespace {
    const lowerUri = uri.toLowerCase();

    // Check for W3C standard namespaces first (most specific checks)
    if (
      lowerUri.includes("w3.org/1999/02/22-rdf-syntax-ns") ||
      uri.startsWith("rdf:") ||
      uri.startsWith("rdf__")
    ) {
      return "rdf";
    }
    if (
      lowerUri.includes("w3.org/2000/01/rdf-schema") ||
      uri.startsWith("rdfs:") ||
      uri.startsWith("rdfs__")
    ) {
      return "rdfs";
    }
    if (
      lowerUri.includes("w3.org/2002/07/owl") ||
      uri.startsWith("owl:") ||
      uri.startsWith("owl__")
    ) {
      return "owl";
    }
    if (
      lowerUri.includes("w3.org/2001/xmlschema") ||
      uri.startsWith("xsd:") ||
      uri.startsWith("xsd__")
    ) {
      return "xsd";
    }

    // Check for Exocortex namespace patterns (ems, ims, exo)
    // These must be checked in specific order and use more precise matching
    if (
      uri.startsWith("ems__") ||
      uri.startsWith("ems#") ||
      uri.startsWith("ems:") ||
      uri.includes("/ems#") ||
      lowerUri.includes("ontology/ems#")
    ) {
      return "ems";
    }
    if (
      uri.startsWith("ims__") ||
      uri.startsWith("ims#") ||
      uri.startsWith("ims:") ||
      uri.includes("/ims#") ||
      lowerUri.includes("ontology/ims#")
    ) {
      return "ims";
    }
    if (
      uri.startsWith("exo__") ||
      uri.startsWith("exo#") ||
      uri.startsWith("exo:") ||
      uri.includes("/exo#") ||
      lowerUri.includes("ontology/exo#")
    ) {
      return "exo";
    }

    return "unknown";
  }

  /**
   * Get node color based on URI/type
   *
   * @param uri - Node URI or type
   * @returns Hex color string
   */
  getNodeColor(uri: string): string {
    const namespace = this.extractNamespace(uri);
    const colors = this.getThemeColors();
    return colors.nodeColors[namespace];
  }

  /**
   * Get node color as hex number for Three.js
   *
   * @param uri - Node URI or type
   * @returns Hex color number
   */
  getNodeColorNumber(uri: string): number {
    const color = this.getNodeColor(uri);
    return parseInt(color.replace("#", ""), 16);
  }

  /**
   * Get edge color based on predicate URI
   *
   * @param predicateUri - Predicate URI
   * @returns Hex color string
   */
  getEdgeColor(predicateUri: string): string {
    const colors = this.getThemeColors();
    const lowerUri = predicateUri.toLowerCase();

    // rdf:type
    if (
      lowerUri.includes("rdf-syntax-ns#type") ||
      predicateUri === "rdf:type" ||
      predicateUri === "rdf__type" ||
      lowerUri.endsWith("#type")
    ) {
      return colors.edgeColors.rdfType;
    }

    // rdfs:subClassOf
    if (
      lowerUri.includes("rdf-schema#subclassof") ||
      predicateUri === "rdfs:subClassOf" ||
      predicateUri === "rdfs__subClassOf"
    ) {
      return colors.edgeColors.subClassOf;
    }

    // owl:sameAs
    if (
      lowerUri.includes("owl#sameas") ||
      predicateUri === "owl:sameAs" ||
      predicateUri === "owl__sameAs"
    ) {
      return colors.edgeColors.sameAs;
    }

    return colors.edgeColors.default;
  }

  /**
   * Get edge color as hex number for Three.js
   *
   * @param predicateUri - Predicate URI
   * @returns Hex color number
   */
  getEdgeColorNumber(predicateUri: string): number {
    const color = this.getEdgeColor(predicateUri);
    return parseInt(color.replace("#", ""), 16);
  }

  /**
   * Get label style for current theme
   */
  getLabelStyle(): { color: string; backgroundColor: string } {
    const colors = this.getThemeColors();
    return {
      color: colors.labelColor,
      backgroundColor: colors.labelBackground,
    };
  }

  /**
   * Check if a color meets WCAG AA contrast with current background
   *
   * @param color - Color to check (hex string)
   * @returns True if contrast is sufficient
   */
  meetsContrastRequirement(color: string): boolean {
    const colors = this.getThemeColors();
    return meetsWCAGAA(color, colors.background, true);
  }

  /**
   * Get contrast ratio with current background
   *
   * @param color - Color to check (hex string)
   * @returns Contrast ratio (1-21)
   */
  getContrastRatio(color: string): number {
    const colors = this.getThemeColors();
    return calculateContrastRatio(color, colors.background);
  }

  /**
   * Manually set theme mode (useful for testing or overrides)
   *
   * @param mode - Theme mode to set
   */
  setThemeMode(mode: ThemeMode): void {
    if (mode !== this.currentMode) {
      this.currentMode = mode;
      this.emit({
        type: "themeChange",
        mode,
        colors: this.getThemeColors(),
      });
    }
  }

  /**
   * Add event listener for theme changes
   *
   * @param eventType - Event type (currently only "themeChange")
   * @param listener - Callback function
   */
  on(eventType: Graph3DThemeEventType, listener: Graph3DThemeEventListener): void {
    if (eventType === "themeChange") {
      this.listeners.add(listener);
    }
  }

  /**
   * Remove event listener
   *
   * @param eventType - Event type
   * @param listener - Callback function to remove
   */
  off(eventType: Graph3DThemeEventType, listener: Graph3DThemeEventListener): void {
    if (eventType === "themeChange") {
      this.listeners.delete(listener);
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: Graph3DThemeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in Graph3DThemeService event listener:", error);
      }
    }
  }

  /**
   * Destroy the service and cleanup resources
   */
  destroy(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.listeners.clear();
  }
}

/**
 * Factory function to create Graph3DThemeService
 */
export function createGraph3DThemeService(
  config?: Partial<Graph3DThemeConfig>
): Graph3DThemeService {
  return new Graph3DThemeService(config);
}

/**
 * Color palette documentation for reference
 *
 * ## Ontology Namespace Colors
 *
 * | Namespace | Dark Mode | Light Mode | Description |
 * |-----------|-----------|------------|-------------|
 * | exo#      | #4A90E2   | #2563EB    | Exocortex core types (Asset, etc.) |
 * | ems#      | #7ED321   | #16A34A    | Entity Management (Task, Project, Area) |
 * | ims#      | #9B59B6   | #7C3AED    | Information Management (Concept) |
 * | rdf:      | #F5A623   | #D97706    | RDF core vocabulary |
 * | rdfs:     | #E67E22   | #C2410C    | RDFS vocabulary |
 * | owl:      | #E74C3C   | #DC2626    | OWL vocabulary |
 * | xsd:      | #1ABC9C   | #0D9488    | XSD datatypes |
 * | unknown   | #95A5A6   | #6B7280    | Unknown namespaces |
 *
 * ## Edge Colors (by Predicate)
 *
 * | Predicate      | Dark Mode | Light Mode | Description |
 * |----------------|-----------|------------|-------------|
 * | rdf:type       | #F5A623   | #D97706    | Type relationships |
 * | rdfs:subClassOf| #9B59B6   | #7C3AED    | Inheritance |
 * | owl:sameAs     | #3498DB   | #2563EB    | Identity |
 * | default        | #64748B   | #475569    | Other predicates |
 *
 * ## Theme Backgrounds
 *
 * | Mode  | Background | Contrast Requirement |
 * |-------|------------|---------------------|
 * | Dark  | #1E1E1E    | WCAG AA (3:1 for large text) |
 * | Light | #F5F5F5    | WCAG AA (3:1 for large text) |
 */
