/**
 * LODSystem - Level of Detail system for zoom-based rendering optimization
 *
 * Implements automatic detail level adjustment based on zoom level and node count.
 * At lower zoom levels (zoomed out), fewer details are rendered for better performance.
 * At higher zoom levels (zoomed in), full details are shown.
 *
 * Features:
 * - Automatic LOD level calculation based on zoom
 * - Configurable detail thresholds
 * - Node count-based LOD adjustment
 * - Separate LOD settings for nodes, edges, and labels
 * - Performance metrics tracking
 * - Hysteresis to prevent LOD flickering
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

/**
 * Level of Detail enumeration
 */
export enum LODLevel {
  /** Minimal detail - dots only, no labels, simplified edges */
  MINIMAL = 0,
  /** Low detail - simple shapes, no icons, no labels */
  LOW = 1,
  /** Medium detail - shapes with borders, limited labels */
  MEDIUM = 2,
  /** High detail - full shapes, icons, all labels */
  HIGH = 3,
  /** Ultra detail - full shapes, icons, all labels, anti-aliased edges */
  ULTRA = 4,
}

/**
 * LOD threshold configuration
 */
export interface LODThreshold {
  /** Minimum zoom level for this LOD (inclusive) */
  minZoom: number;
  /** Maximum zoom level for this LOD (exclusive) */
  maxZoom: number;
  /** LOD level to apply */
  level: LODLevel;
}

/**
 * Node detail settings for each LOD level
 */
export interface NodeLODSettings {
  /** Whether to show node shapes (false = dots only) */
  showShapes: boolean;
  /** Whether to show borders */
  showBorders: boolean;
  /** Whether to show icons */
  showIcons: boolean;
  /** Whether to show shadows */
  showShadows: boolean;
  /** Radius multiplier (1.0 = normal) */
  radiusMultiplier: number;
  /** Maximum nodes to render at this LOD (-1 = unlimited) */
  maxNodes: number;
}

/**
 * Edge detail settings for each LOD level
 */
export interface EdgeLODSettings {
  /** Whether to show edges */
  showEdges: boolean;
  /** Whether to show arrows */
  showArrows: boolean;
  /** Whether to use curved edges (false = straight lines) */
  useCurves: boolean;
  /** Whether to use anti-aliasing */
  antiAlias: boolean;
  /** Line width multiplier */
  widthMultiplier: number;
  /** Maximum edges to render at this LOD (-1 = unlimited) */
  maxEdges: number;
}

/**
 * Label detail settings for each LOD level
 */
export interface LabelLODSettings {
  /** Whether to show labels */
  showLabels: boolean;
  /** Maximum label length (characters, -1 = unlimited) */
  maxLabelLength: number;
  /** Font size multiplier */
  fontSizeMultiplier: number;
  /** Maximum labels to render (-1 = unlimited) */
  maxLabels: number;
  /** Whether to use text shadows/outlines */
  useOutline: boolean;
}

/**
 * Complete LOD settings for a level
 */
export interface LODSettings {
  /** LOD level */
  level: LODLevel;
  /** Node rendering settings */
  nodes: NodeLODSettings;
  /** Edge rendering settings */
  edges: EdgeLODSettings;
  /** Label rendering settings */
  labels: LabelLODSettings;
}

/**
 * Default LOD thresholds (zoom-based)
 */
export const DEFAULT_LOD_THRESHOLDS: LODThreshold[] = [
  { minZoom: 0, maxZoom: 0.15, level: LODLevel.MINIMAL },
  { minZoom: 0.15, maxZoom: 0.3, level: LODLevel.LOW },
  { minZoom: 0.3, maxZoom: 0.7, level: LODLevel.MEDIUM },
  { minZoom: 0.7, maxZoom: 2.0, level: LODLevel.HIGH },
  { minZoom: 2.0, maxZoom: Infinity, level: LODLevel.ULTRA },
];

/**
 * Default LOD settings for each level
 */
export const DEFAULT_LOD_SETTINGS: Map<LODLevel, LODSettings> = new Map([
  [
    LODLevel.MINIMAL,
    {
      level: LODLevel.MINIMAL,
      nodes: {
        showShapes: false,
        showBorders: false,
        showIcons: false,
        showShadows: false,
        radiusMultiplier: 0.5,
        maxNodes: 10000,
      },
      edges: {
        showEdges: true,
        showArrows: false,
        useCurves: false,
        antiAlias: false,
        widthMultiplier: 0.5,
        maxEdges: 50000,
      },
      labels: {
        showLabels: false,
        maxLabelLength: 0,
        fontSizeMultiplier: 0,
        maxLabels: 0,
        useOutline: false,
      },
    },
  ],
  [
    LODLevel.LOW,
    {
      level: LODLevel.LOW,
      nodes: {
        showShapes: true,
        showBorders: false,
        showIcons: false,
        showShadows: false,
        radiusMultiplier: 0.7,
        maxNodes: 5000,
      },
      edges: {
        showEdges: true,
        showArrows: false,
        useCurves: false,
        antiAlias: false,
        widthMultiplier: 0.7,
        maxEdges: 20000,
      },
      labels: {
        showLabels: false,
        maxLabelLength: 0,
        fontSizeMultiplier: 0,
        maxLabels: 0,
        useOutline: false,
      },
    },
  ],
  [
    LODLevel.MEDIUM,
    {
      level: LODLevel.MEDIUM,
      nodes: {
        showShapes: true,
        showBorders: true,
        showIcons: false,
        showShadows: false,
        radiusMultiplier: 1.0,
        maxNodes: 2000,
      },
      edges: {
        showEdges: true,
        showArrows: true,
        useCurves: false,
        antiAlias: false,
        widthMultiplier: 1.0,
        maxEdges: 5000,
      },
      labels: {
        showLabels: true,
        maxLabelLength: 20,
        fontSizeMultiplier: 0.8,
        maxLabels: 500,
        useOutline: false,
      },
    },
  ],
  [
    LODLevel.HIGH,
    {
      level: LODLevel.HIGH,
      nodes: {
        showShapes: true,
        showBorders: true,
        showIcons: true,
        showShadows: false,
        radiusMultiplier: 1.0,
        maxNodes: 1000,
      },
      edges: {
        showEdges: true,
        showArrows: true,
        useCurves: true,
        antiAlias: true,
        widthMultiplier: 1.0,
        maxEdges: 2000,
      },
      labels: {
        showLabels: true,
        maxLabelLength: 50,
        fontSizeMultiplier: 1.0,
        maxLabels: 200,
        useOutline: true,
      },
    },
  ],
  [
    LODLevel.ULTRA,
    {
      level: LODLevel.ULTRA,
      nodes: {
        showShapes: true,
        showBorders: true,
        showIcons: true,
        showShadows: true,
        radiusMultiplier: 1.0,
        maxNodes: -1, // Unlimited
      },
      edges: {
        showEdges: true,
        showArrows: true,
        useCurves: true,
        antiAlias: true,
        widthMultiplier: 1.0,
        maxEdges: -1, // Unlimited
      },
      labels: {
        showLabels: true,
        maxLabelLength: -1, // Unlimited
        fontSizeMultiplier: 1.0,
        maxLabels: -1, // Unlimited
        useOutline: true,
      },
    },
  ],
]);

/**
 * LOD System configuration
 */
export interface LODSystemConfig {
  /** Custom LOD thresholds (overrides defaults) */
  thresholds?: LODThreshold[];

  /** Custom LOD settings per level (merges with defaults) */
  settings?: Partial<Record<LODLevel, Partial<LODSettings>>>;

  /** Hysteresis margin to prevent LOD flickering (default: 0.05) */
  hysteresisMargin?: number;

  /** Whether to enable node count-based LOD adjustment (default: true) */
  enableNodeCountAdjustment?: boolean;

  /** Node count threshold for LOD downgrade (default: 1000) */
  nodeCountThreshold?: number;

  /** Whether to enable performance-based LOD adjustment (default: true) */
  enablePerformanceAdjustment?: boolean;

  /** Target frame time in ms (default: 16.67 for 60fps) */
  targetFrameTime?: number;

  /** Frame time threshold for LOD downgrade (default: 33 for 30fps) */
  performanceThreshold?: number;
}

/**
 * Default LOD System configuration
 */
export const DEFAULT_LOD_SYSTEM_CONFIG: Required<LODSystemConfig> = {
  thresholds: DEFAULT_LOD_THRESHOLDS,
  settings: {},
  hysteresisMargin: 0.05,
  enableNodeCountAdjustment: true,
  nodeCountThreshold: 1000,
  enablePerformanceAdjustment: true,
  targetFrameTime: 16.67,
  performanceThreshold: 33,
};

/**
 * LOD change event type
 */
export type LODEventType = "levelChange" | "settingsChange";

/**
 * LOD change event
 */
export interface LODEvent {
  /** Event type */
  type: LODEventType;
  /** Previous LOD level */
  previousLevel: LODLevel;
  /** New LOD level */
  newLevel: LODLevel;
  /** Current zoom */
  zoom: number;
  /** Node count */
  nodeCount: number;
  /** Current settings */
  settings: LODSettings;
}

/**
 * LOD event listener callback
 */
export type LODEventListener = (event: LODEvent) => void;

/**
 * LOD System statistics
 */
export interface LODStats {
  /** Current LOD level */
  currentLevel: LODLevel;
  /** Current zoom */
  currentZoom: number;
  /** Node count */
  nodeCount: number;
  /** LOD changes in this session */
  levelChanges: number;
  /** Average frame time (ms) */
  averageFrameTime: number;
  /** Whether performance adjustment is active */
  performanceAdjustmentActive: boolean;
}

/**
 * LODSystem - Manages level of detail for graph rendering
 *
 * @example
 * ```typescript
 * const lodSystem = new LODSystem();
 *
 * // Set initial state
 * lodSystem.setZoom(1.0);
 * lodSystem.setNodeCount(500);
 *
 * // Get current settings
 * const settings = lodSystem.getSettings();
 * console.log(settings.nodes.showIcons); // true at zoom 1.0
 *
 * // Listen for LOD changes
 * lodSystem.addEventListener((event) => {
 *   console.log(`LOD changed from ${event.previousLevel} to ${event.newLevel}`);
 * });
 *
 * // Update zoom (triggers LOD recalculation)
 * lodSystem.setZoom(0.2);
 * ```
 */
export class LODSystem {
  /** Configuration */
  private config: Required<LODSystemConfig>;

  /** LOD settings map */
  private lodSettings: Map<LODLevel, LODSettings>;

  /** LOD thresholds */
  private thresholds: LODThreshold[];

  /** Current LOD level */
  private currentLevel: LODLevel = LODLevel.HIGH;

  /** Current zoom */
  private currentZoom: number = 1.0;

  /** Current node count */
  private nodeCount: number = 0;

  /** Event listeners */
  private listeners: Set<LODEventListener> = new Set();

  /** Statistics */
  private stats: LODStats;

  /** Frame times for performance tracking */
  private frameTimes: number[] = [];
  private readonly MAX_FRAME_SAMPLES = 30;

  /** Previous zoom for hysteresis */
  private previousZoom: number = 1.0;

  constructor(config: LODSystemConfig = {}) {
    this.config = { ...DEFAULT_LOD_SYSTEM_CONFIG, ...config };
    this.thresholds = this.config.thresholds;

    // Initialize LOD settings with defaults and custom overrides
    this.lodSettings = new Map();
    for (const [level, defaultSettings] of DEFAULT_LOD_SETTINGS) {
      const customSettings = this.config.settings?.[level];
      if (customSettings) {
        this.lodSettings.set(level, this.mergeSettings(defaultSettings, customSettings));
      } else {
        this.lodSettings.set(level, { ...defaultSettings });
      }
    }

    // Initialize statistics
    this.stats = {
      currentLevel: this.currentLevel,
      currentZoom: this.currentZoom,
      nodeCount: 0,
      levelChanges: 0,
      averageFrameTime: 0,
      performanceAdjustmentActive: false,
    };
  }

  /**
   * Merge LOD settings with custom overrides
   */
  private mergeSettings(base: LODSettings, custom: Partial<LODSettings>): LODSettings {
    return {
      level: custom.level ?? base.level,
      nodes: { ...base.nodes, ...custom.nodes },
      edges: { ...base.edges, ...custom.edges },
      labels: { ...base.labels, ...custom.labels },
    };
  }

  /**
   * Calculate LOD level from zoom
   */
  private calculateLevelFromZoom(zoom: number): LODLevel {
    // Apply hysteresis to prevent flickering at LOD boundaries
    const hysteresis = this.config.hysteresisMargin;
    const effectiveZoom = this.applyHysteresis(zoom, this.previousZoom, hysteresis);

    for (const threshold of this.thresholds) {
      if (effectiveZoom >= threshold.minZoom && effectiveZoom < threshold.maxZoom) {
        return threshold.level;
      }
    }

    // Default to HIGH if no threshold matches
    return LODLevel.HIGH;
  }

  /**
   * Apply hysteresis to prevent LOD flickering
   */
  private applyHysteresis(
    currentZoom: number,
    previousZoom: number,
    margin: number
  ): number {
    // If moving to higher zoom, use current - margin
    // If moving to lower zoom, use current + margin
    // This creates a "dead zone" at LOD boundaries
    if (currentZoom > previousZoom) {
      return currentZoom - margin;
    } else if (currentZoom < previousZoom) {
      return currentZoom + margin;
    }
    return currentZoom;
  }

  /**
   * Adjust LOD based on node count
   */
  private adjustForNodeCount(level: LODLevel): LODLevel {
    if (!this.config.enableNodeCountAdjustment) {
      return level;
    }

    // If node count exceeds threshold, reduce LOD
    const threshold = this.config.nodeCountThreshold;
    if (this.nodeCount > threshold * 10 && level > LODLevel.MINIMAL) {
      return Math.max(LODLevel.MINIMAL, level - 2) as LODLevel;
    } else if (this.nodeCount > threshold * 3 && level > LODLevel.LOW) {
      return Math.max(LODLevel.LOW, level - 1) as LODLevel;
    } else if (this.nodeCount > threshold && level > LODLevel.MEDIUM) {
      return LODLevel.MEDIUM;
    }

    return level;
  }

  /**
   * Adjust LOD based on performance
   */
  private adjustForPerformance(level: LODLevel): LODLevel {
    if (!this.config.enablePerformanceAdjustment || this.frameTimes.length < 10) {
      return level;
    }

    const avgFrameTime = this.getAverageFrameTime();
    this.stats.performanceAdjustmentActive = avgFrameTime > this.config.targetFrameTime;

    // If frame time exceeds threshold, reduce LOD
    if (avgFrameTime > this.config.performanceThreshold && level > LODLevel.MINIMAL) {
      return Math.max(LODLevel.MINIMAL, level - 1) as LODLevel;
    } else if (avgFrameTime > this.config.targetFrameTime * 1.5 && level > LODLevel.LOW) {
      return Math.max(LODLevel.LOW, level - 1) as LODLevel;
    }

    return level;
  }

  /**
   * Get average frame time from samples
   */
  private getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 0;
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    return sum / this.frameTimes.length;
  }

  /**
   * Recalculate LOD level
   */
  private recalculateLOD(): void {
    // Calculate base level from zoom
    let newLevel = this.calculateLevelFromZoom(this.currentZoom);

    // Adjust for node count
    newLevel = this.adjustForNodeCount(newLevel);

    // Adjust for performance
    newLevel = this.adjustForPerformance(newLevel);

    // Check if level changed
    if (newLevel !== this.currentLevel) {
      const previousLevel = this.currentLevel;
      this.currentLevel = newLevel;
      this.stats.levelChanges++;

      // Emit event
      this.emitEvent({
        type: "levelChange",
        previousLevel,
        newLevel,
        zoom: this.currentZoom,
        nodeCount: this.nodeCount,
        settings: this.getSettings(),
      });
    }

    // Update previous zoom for next hysteresis calculation
    this.previousZoom = this.currentZoom;

    // Update stats
    this.stats.currentLevel = this.currentLevel;
    this.stats.currentZoom = this.currentZoom;
    this.stats.nodeCount = this.nodeCount;
    this.stats.averageFrameTime = this.getAverageFrameTime();
  }

  /**
   * Emit an LOD event to all listeners
   */
  private emitEvent(event: LODEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("LOD event listener error:", error);
      }
    }
  }

  /**
   * Set current zoom level
   *
   * @param zoom - Current zoom level
   */
  setZoom(zoom: number): void {
    if (zoom !== this.currentZoom) {
      this.currentZoom = zoom;
      this.recalculateLOD();
    }
  }

  /**
   * Set current node count
   *
   * @param count - Number of nodes in the graph
   */
  setNodeCount(count: number): void {
    if (count !== this.nodeCount) {
      this.nodeCount = count;
      this.recalculateLOD();
    }
  }

  /**
   * Record a frame time for performance tracking
   *
   * @param frameTime - Frame render time in milliseconds
   */
  recordFrameTime(frameTime: number): void {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > this.MAX_FRAME_SAMPLES) {
      this.frameTimes.shift();
    }

    // Recalculate LOD if performance adjustment is enabled
    if (this.config.enablePerformanceAdjustment) {
      this.recalculateLOD();
    }
  }

  /**
   * Get current LOD level
   *
   * @returns Current LOD level
   */
  getLevel(): LODLevel {
    return this.currentLevel;
  }

  /**
   * Get current LOD settings
   *
   * @returns Current LOD settings
   */
  getSettings(): LODSettings {
    const settings = this.lodSettings.get(this.currentLevel);
    if (!settings) {
      // Fallback to HIGH if not found
      return this.lodSettings.get(LODLevel.HIGH)!;
    }
    return settings;
  }

  /**
   * Get LOD settings for a specific level
   *
   * @param level - LOD level to get settings for
   * @returns LOD settings for the level
   */
  getSettingsForLevel(level: LODLevel): LODSettings {
    return this.lodSettings.get(level) ?? this.lodSettings.get(LODLevel.HIGH)!;
  }

  /**
   * Get node LOD settings
   *
   * @returns Current node LOD settings
   */
  getNodeSettings(): NodeLODSettings {
    return this.getSettings().nodes;
  }

  /**
   * Get edge LOD settings
   *
   * @returns Current edge LOD settings
   */
  getEdgeSettings(): EdgeLODSettings {
    return this.getSettings().edges;
  }

  /**
   * Get label LOD settings
   *
   * @returns Current label LOD settings
   */
  getLabelSettings(): LabelLODSettings {
    return this.getSettings().labels;
  }

  /**
   * Check if icons should be shown at current LOD
   *
   * @returns Whether to show icons
   */
  shouldShowIcons(): boolean {
    return this.getSettings().nodes.showIcons;
  }

  /**
   * Check if labels should be shown at current LOD
   *
   * @returns Whether to show labels
   */
  shouldShowLabels(): boolean {
    return this.getSettings().labels.showLabels;
  }

  /**
   * Check if arrows should be shown at current LOD
   *
   * @returns Whether to show arrows
   */
  shouldShowArrows(): boolean {
    return this.getSettings().edges.showArrows;
  }

  /**
   * Check if curved edges should be used at current LOD
   *
   * @returns Whether to use curved edges
   */
  shouldUseCurves(): boolean {
    return this.getSettings().edges.useCurves;
  }

  /**
   * Get maximum nodes to render at current LOD
   *
   * @returns Maximum nodes (-1 = unlimited)
   */
  getMaxNodes(): number {
    return this.getSettings().nodes.maxNodes;
  }

  /**
   * Get maximum edges to render at current LOD
   *
   * @returns Maximum edges (-1 = unlimited)
   */
  getMaxEdges(): number {
    return this.getSettings().edges.maxEdges;
  }

  /**
   * Get maximum labels to render at current LOD
   *
   * @returns Maximum labels (-1 = unlimited)
   */
  getMaxLabels(): number {
    return this.getSettings().labels.maxLabels;
  }

  /**
   * Add an event listener
   *
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  addEventListener(listener: LODEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove an event listener
   *
   * @param listener - Callback function to remove
   */
  removeEventListener(listener: LODEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Get LOD system statistics
   *
   * @returns Current statistics
   */
  getStats(): LODStats {
    return { ...this.stats };
  }

  /**
   * Force a specific LOD level (overrides automatic calculation)
   *
   * @param level - LOD level to force
   */
  forceLevel(level: LODLevel): void {
    if (level !== this.currentLevel) {
      const previousLevel = this.currentLevel;
      this.currentLevel = level;
      this.stats.currentLevel = level;

      this.emitEvent({
        type: "levelChange",
        previousLevel,
        newLevel: level,
        zoom: this.currentZoom,
        nodeCount: this.nodeCount,
        settings: this.getSettings(),
      });
    }
  }

  /**
   * Reset to automatic LOD calculation
   */
  resetToAutomatic(): void {
    this.recalculateLOD();
  }

  /**
   * Update custom settings for a level
   *
   * @param level - LOD level to update
   * @param settings - Partial settings to merge
   */
  updateSettings(level: LODLevel, settings: Partial<LODSettings>): void {
    const current = this.lodSettings.get(level);
    if (current) {
      this.lodSettings.set(level, this.mergeSettings(current, settings));

      // Emit settings change event if this is the current level
      if (level === this.currentLevel) {
        this.emitEvent({
          type: "settingsChange",
          previousLevel: level,
          newLevel: level,
          zoom: this.currentZoom,
          nodeCount: this.nodeCount,
          settings: this.getSettings(),
        });
      }
    }
  }

  /**
   * Reset frame time samples
   */
  resetFrameTimes(): void {
    this.frameTimes = [];
    this.stats.averageFrameTime = 0;
  }

  /**
   * Get LOD level name as string
   *
   * @param level - LOD level
   * @returns Human-readable level name
   */
  static getLevelName(level: LODLevel): string {
    switch (level) {
      case LODLevel.MINIMAL:
        return "Minimal";
      case LODLevel.LOW:
        return "Low";
      case LODLevel.MEDIUM:
        return "Medium";
      case LODLevel.HIGH:
        return "High";
      case LODLevel.ULTRA:
        return "Ultra";
      default:
        return "Unknown";
    }
  }

  /**
   * Destroy the LOD system
   */
  destroy(): void {
    this.listeners.clear();
    this.frameTimes = [];
  }
}

/**
 * Create an LOD System instance
 *
 * @param config - Configuration options
 * @returns LODSystem instance
 */
export function createLODSystem(config?: LODSystemConfig): LODSystem {
  return new LODSystem(config);
}
