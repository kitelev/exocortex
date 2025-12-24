/**
 * TypeColorManager - Dynamic node coloring based on RDF types
 *
 * Provides a type-based coloring system for graph nodes with:
 * - Automatic color assignment from palettes
 * - Type inheritance support (subclass inherits superclass color)
 * - Manual color overrides per type
 * - Multiple built-in color palettes
 * - WCAG contrast compliance checking
 * - Persistent color preferences
 *
 * @module presentation/renderers/graph/search
 * @since 1.0.0
 */

import type {
  TypeColorConfig,
  ColorPalette,
  LegendItem,
  LegendState,
  SearchEvent,
  SearchEventListener,
} from "./SearchTypes";
import {
  BUILT_IN_PALETTES,
  DEFAULT_TYPE_COLORS,
  generateGoldenRatioColor,
  formatTypeUri,
  meetsWCAGAA,
} from "./SearchTypes";

/**
 * Configuration for TypeColorManager
 */
export interface TypeColorManagerConfig {
  /** Initial color palette ID */
  paletteId: string;
  /** Whether to use type inheritance for colors */
  useInheritance: boolean;
  /** Custom type color configurations */
  customColors: TypeColorConfig[];
  /** Whether to ensure WCAG AA contrast */
  enforceContrast: boolean;
  /** Storage key for persisting preferences */
  storageKey: string;
}

/**
 * Default TypeColorManager configuration
 */
export const DEFAULT_TYPE_COLOR_MANAGER_CONFIG: TypeColorManagerConfig = {
  paletteId: "default",
  useInheritance: true,
  customColors: [],
  enforceContrast: true,
  storageKey: "exo-graph-type-colors",
};

/**
 * Ontology information interface for type inheritance
 */
export interface OntologyInfo {
  /** Get superclasses for a given type */
  getSuperclasses(typeUri: string): string[];
  /** Get subclasses for a given type */
  getSubclasses(typeUri: string): string[];
  /** Check if typeA is a subclass of typeB */
  isSubclassOf(typeA: string, typeB: string): boolean;
}

/**
 * Default no-op ontology info when no ontology is available
 */
const DEFAULT_ONTOLOGY_INFO: OntologyInfo = {
  getSuperclasses: () => [],
  getSubclasses: () => [],
  isSubclassOf: () => false,
};

/**
 * TypeColorManager - Manages dynamic node coloring based on RDF types
 */
export class TypeColorManager {
  private config: TypeColorManagerConfig;
  private ontologyInfo: OntologyInfo;
  private palette: ColorPalette;

  // Type color mappings
  private typeColors: Map<string, TypeColorConfig> = new Map();
  private generatedColors: Map<string, string> = new Map();
  private colorIndex = 0;

  // Legend state
  private legendState: LegendState;

  // Event listeners
  private listeners: Set<SearchEventListener> = new Set();

  constructor(
    config: Partial<TypeColorManagerConfig> = {},
    ontologyInfo: OntologyInfo = DEFAULT_ONTOLOGY_INFO
  ) {
    this.config = { ...DEFAULT_TYPE_COLOR_MANAGER_CONFIG, ...config };
    this.ontologyInfo = ontologyInfo;

    // Initialize palette
    this.palette = BUILT_IN_PALETTES.find((p) => p.id === this.config.paletteId)
      || BUILT_IN_PALETTES[0];

    // Initialize legend state
    this.legendState = {
      items: [],
      isExpanded: true,
      paletteId: this.palette.id,
      customColors: new Map(),
    };

    // Initialize default type colors
    this.initializeDefaultColors();

    // Load persisted preferences
    this.loadPreferences();
  }

  /**
   * Initialize default colors from built-in type configurations
   */
  private initializeDefaultColors(): void {
    // Add default type colors
    for (const typeConfig of DEFAULT_TYPE_COLORS) {
      this.typeColors.set(typeConfig.typeUri, typeConfig);
    }

    // Add custom colors from config
    for (const typeConfig of this.config.customColors) {
      this.typeColors.set(typeConfig.typeUri, typeConfig);
    }
  }

  /**
   * Load persisted color preferences from localStorage
   * Note: Using localStorage directly for graph renderer preferences is acceptable
   * as these preferences are not vault-specific.
   */
  private loadPreferences(): void {
    try {
      // eslint-disable-next-line no-restricted-globals
      const stored = localStorage.getItem(this.config.storageKey);
      if (stored) {
        const preferences = JSON.parse(stored) as {
          paletteId?: string;
          customColors?: Record<string, string>;
          hiddenTypes?: string[];
        };

        // Apply palette preference
        if (preferences.paletteId) {
          const palette = BUILT_IN_PALETTES.find(
            (p) => p.id === preferences.paletteId
          );
          if (palette) {
            this.palette = palette;
            this.legendState.paletteId = palette.id;
          }
        }

        // Apply custom color overrides
        if (preferences.customColors) {
          for (const [typeUri, color] of Object.entries(
            preferences.customColors
          )) {
            this.legendState.customColors.set(typeUri, color);
          }
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Save color preferences to localStorage
   */
  private savePreferences(): void {
    try {
      const preferences = {
        paletteId: this.palette.id,
        customColors: Object.fromEntries(this.legendState.customColors),
      };
      // eslint-disable-next-line no-restricted-globals
      localStorage.setItem(
        this.config.storageKey,
        JSON.stringify(preferences)
      );
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Get color for a type, with inheritance support
   *
   * @param typeUri - The type URI to get color for
   * @returns TypeColorConfig with color information
   */
  getTypeColor(typeUri: string): TypeColorConfig {
    // Check for custom override first
    const customColor = this.legendState.customColors.get(typeUri);
    if (customColor) {
      const base = this.typeColors.get(typeUri);
      return {
        typeUri,
        color: customColor,
        icon: base?.icon,
        shape: base?.shape,
        priority: base?.priority ?? 0,
        displayName: base?.displayName ?? formatTypeUri(typeUri),
      };
    }

    // Check for explicit type configuration
    const explicit = this.typeColors.get(typeUri);
    if (explicit) {
      return explicit;
    }

    // Check for inherited color from superclass
    if (this.config.useInheritance) {
      const superclasses = this.ontologyInfo.getSuperclasses(typeUri);
      for (const superclass of superclasses) {
        const superConfig = this.typeColors.get(superclass);
        if (superConfig) {
          // Create inherited config with lower priority
          return {
            ...superConfig,
            typeUri,
            priority: superConfig.priority - 1,
            displayName: formatTypeUri(typeUri),
          };
        }
      }
    }

    // Generate a new color
    return this.generateTypeColor(typeUri);
  }

  /**
   * Generate a new color for a previously unseen type
   */
  private generateTypeColor(typeUri: string): TypeColorConfig {
    // Check cache first
    let color = this.generatedColors.get(typeUri);

    if (!color) {
      // Generate using golden ratio for distinct colors
      color = generateGoldenRatioColor(this.colorIndex++);

      // Ensure WCAG AA contrast if enabled
      if (this.config.enforceContrast) {
        let attempts = 0;
        while (
          !meetsWCAGAA(color, this.palette.background, true) &&
          attempts < 10
        ) {
          color = generateGoldenRatioColor(this.colorIndex++);
          attempts++;
        }
      }

      this.generatedColors.set(typeUri, color);
    }

    return {
      typeUri,
      color,
      priority: 0,
      displayName: formatTypeUri(typeUri),
    };
  }

  /**
   * Set custom color for a type
   *
   * @param typeUri - The type URI
   * @param color - The new color in hex format
   */
  setTypeColor(typeUri: string, color: string): void {
    this.legendState.customColors.set(typeUri, color);
    this.savePreferences();

    // Emit event
    this.emit({
      type: "color:change",
      typeUri,
      color,
    });
  }

  /**
   * Reset a type color to default (remove custom override)
   *
   * @param typeUri - The type URI to reset
   */
  resetTypeColor(typeUri: string): void {
    this.legendState.customColors.delete(typeUri);
    this.savePreferences();

    const defaultColor = this.getTypeColor(typeUri);
    this.emit({
      type: "color:change",
      typeUri,
      color: defaultColor.color,
    });
  }

  /**
   * Register a new type configuration
   *
   * @param config - Type color configuration
   */
  registerType(config: TypeColorConfig): void {
    this.typeColors.set(config.typeUri, config);
  }

  /**
   * Set the current color palette
   *
   * @param paletteId - Palette ID to use
   */
  setPalette(paletteId: string): void {
    const palette = BUILT_IN_PALETTES.find((p) => p.id === paletteId);
    if (palette) {
      this.palette = palette;
      this.legendState.paletteId = paletteId;

      // Clear generated colors to regenerate with new palette
      this.generatedColors.clear();
      this.colorIndex = 0;

      this.savePreferences();

      this.emit({
        type: "palette:change",
        paletteId,
      });
    }
  }

  /**
   * Get the current color palette
   */
  getPalette(): ColorPalette {
    return this.palette;
  }

  /**
   * Get all available palettes
   */
  getAvailablePalettes(): ColorPalette[] {
    return [...BUILT_IN_PALETTES];
  }

  /**
   * Update legend state with current node types
   *
   * @param typeCounts - Map of type URI to node count
   */
  updateLegend(typeCounts: Map<string, number>): void {
    const items: LegendItem[] = [];

    for (const [typeUri, count] of typeCounts) {
      const colorConfig = this.getTypeColor(typeUri);
      items.push({
        typeUri,
        displayName: colorConfig.displayName ?? formatTypeUri(typeUri),
        color: colorConfig.color,
        icon: colorConfig.icon,
        shape: colorConfig.shape,
        count,
        visible: colorConfig.visible !== false,
      });
    }

    // Sort by priority then by count
    items.sort((a, b) => {
      const configA = this.typeColors.get(a.typeUri);
      const configB = this.typeColors.get(b.typeUri);
      const priorityA = configA?.priority ?? 0;
      const priorityB = configB?.priority ?? 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }
      return b.count - a.count;
    });

    this.legendState.items = items;
  }

  /**
   * Get current legend state
   */
  getLegendState(): LegendState {
    return { ...this.legendState };
  }

  /**
   * Toggle legend visibility
   *
   * @param typeUri - Optional specific type to toggle, or all if not specified
   */
  toggleLegendVisibility(typeUri?: string): void {
    if (typeUri) {
      const item = this.legendState.items.find((i) => i.typeUri === typeUri);
      if (item) {
        item.visible = !item.visible;
        this.emit({
          type: "legend:toggle",
          typeUri,
          visible: item.visible,
        });
      }
    } else {
      this.legendState.isExpanded = !this.legendState.isExpanded;
    }
  }

  /**
   * Get color as hex number for PixiJS
   *
   * @param typeUri - Type URI
   * @returns Color as hex number
   */
  getColorAsNumber(typeUri: string): number {
    const config = this.getTypeColor(typeUri);
    return parseInt(config.color.replace("#", ""), 16);
  }

  /**
   * Export color configuration for sharing
   */
  exportConfig(): string {
    const config = {
      paletteId: this.palette.id,
      customColors: Object.fromEntries(this.legendState.customColors),
      typeConfigs: Array.from(this.typeColors.values()),
    };
    return JSON.stringify(config, null, 2);
  }

  /**
   * Import color configuration
   *
   * @param configJson - JSON string of color configuration
   */
  importConfig(configJson: string): void {
    try {
      const config = JSON.parse(configJson) as {
        paletteId?: string;
        customColors?: Record<string, string>;
        typeConfigs?: TypeColorConfig[];
      };

      if (config.paletteId) {
        this.setPalette(config.paletteId);
      }

      if (config.customColors) {
        for (const [typeUri, color] of Object.entries(config.customColors)) {
          this.legendState.customColors.set(typeUri, color);
        }
      }

      if (config.typeConfigs) {
        for (const typeConfig of config.typeConfigs) {
          this.registerType(typeConfig);
        }
      }

      this.savePreferences();
    } catch (e) {
      console.error("Failed to import color configuration:", e);
    }
  }

  /**
   * Add event listener
   */
  addEventListener(listener: SearchEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: SearchEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit event to listeners
   */
  private emit(event: SearchEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error("Error in type color event listener:", e);
      }
    }
  }

  /**
   * Set ontology info for type inheritance
   */
  setOntologyInfo(ontologyInfo: OntologyInfo): void {
    this.ontologyInfo = ontologyInfo;
  }

  /**
   * Clear all generated colors and reset to defaults
   */
  reset(): void {
    this.generatedColors.clear();
    this.legendState.customColors.clear();
    this.colorIndex = 0;

    try {
      // eslint-disable-next-line no-restricted-globals
      localStorage.removeItem(this.config.storageKey);
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Destroy the manager and clean up resources
   */
  destroy(): void {
    this.listeners.clear();
    this.typeColors.clear();
    this.generatedColors.clear();
    this.legendState.customColors.clear();
  }
}

/**
 * Create a TypeColorManager instance
 */
export function createTypeColorManager(
  config?: Partial<TypeColorManagerConfig>,
  ontologyInfo?: OntologyInfo
): TypeColorManager {
  return new TypeColorManager(config, ontologyInfo);
}
