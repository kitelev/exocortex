/**
 * LayoutPlugin - Plugin architecture for custom layout algorithms
 *
 * Provides a plugin system for creating, registering, and sharing
 * domain-specific layouts optimized for ontology visualization patterns.
 *
 * Features:
 * - Extensible plugin interface with metadata
 * - Factory pattern for layout creation with options
 * - Option definitions for configurable parameters
 * - Base class for common layout functionality
 * - Plugin registry for discovery and management
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphData } from "./types";
import type { Point, LayoutResult, LayoutAlgorithmName } from "./LayoutManager";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Layout category for organizing and filtering plugins
 */
export type LayoutCategory =
  | "hierarchical"
  | "radial"
  | "force-based"
  | "grid"
  | "domain-specific"
  | "experimental";

/**
 * Graph type that a layout supports
 */
export type GraphType =
  | "tree"
  | "dag"
  | "general"
  | "bipartite"
  | "planar";

/**
 * Option types for layout configuration
 */
export type LayoutOptionType =
  | "number"
  | "boolean"
  | "string"
  | "select"
  | "color";

/**
 * Definition for a configurable layout option
 */
export interface LayoutOptionDefinition {
  /** Unique name for this option */
  name: string;

  /** Type of the option value */
  type: LayoutOptionType;

  /** Display label for UI */
  label: string;

  /** Description of what this option does */
  description?: string;

  /** Default value for this option */
  default: unknown;

  /** Minimum value for number options */
  min?: number;

  /** Maximum value for number options */
  max?: number;

  /** Step increment for number options */
  step?: number;

  /** Available choices for select options */
  options?: Array<{ value: string; label: string }>;

  /** Whether this is an advanced option (hidden in simple mode) */
  advanced?: boolean;

  /** Validation function for this option */
  validate?: (value: unknown) => boolean;
}

/**
 * Validation result for layout options
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Error messages keyed by option name */
  errors: Record<string, string>;

  /** Warning messages keyed by option name */
  warnings: Record<string, string>;
}

/**
 * Metadata describing a layout plugin
 */
export interface LayoutPluginMetadata {
  /** Unique identifier for this plugin */
  id: string;

  /** Display name for UI */
  name: string;

  /** Description of what this layout is good for */
  description: string;

  /** Semantic version string */
  version: string;

  /** Author name or organization */
  author?: string;

  /** Icon name or path for UI */
  icon?: string;

  /** Layout category for organization */
  category: LayoutCategory;

  /** Searchable tags */
  tags: string[];

  /** Graph types this layout supports */
  supportedGraphTypes: GraphType[];

  /** URL to documentation */
  documentationUrl?: string;

  /** Minimum number of nodes recommended */
  minNodes?: number;

  /** Maximum number of nodes recommended */
  maxNodes?: number;
}

/**
 * Factory for creating layout algorithm instances
 */
export interface LayoutFactory {
  /**
   * Create a new layout algorithm instance with options
   * @param options - Configuration options
   * @returns Layout algorithm instance
   */
  create(options?: Record<string, unknown>): LayoutAlgorithmInstance;

  /**
   * Get option definitions for this layout
   * @returns Array of option definitions
   */
  getOptionDefinitions(): LayoutOptionDefinition[];

  /**
   * Validate options before creating layout
   * @param options - Options to validate
   * @returns Validation result
   */
  validateOptions(options: Record<string, unknown>): ValidationResult;
}

/**
 * Complete layout plugin with metadata and factory
 */
export interface LayoutPlugin {
  /** Plugin metadata */
  metadata: LayoutPluginMetadata;

  /** Factory for creating layout instances */
  factory: LayoutFactory;
}

/**
 * Layout algorithm instance interface
 */
export interface LayoutAlgorithmInstance {
  /** Algorithm name for identification */
  readonly name: string;

  /** Compute layout positions for the given graph */
  layout(graph: GraphData, options?: Record<string, unknown>): LayoutResult | Promise<LayoutResult>;

  /** Get default option values */
  getDefaults(): Record<string, unknown>;

  /** Get current options */
  getOptions(): Record<string, unknown>;

  /** Set options */
  setOptions(options: Partial<Record<string, unknown>>): void;

  /** Check if layout can handle this graph */
  canLayout(graph: GraphData): boolean;

  /** Estimate layout complexity (0-1) */
  estimateComplexity(graph: GraphData): number;

  /** Cancel in-progress layout (for async layouts) */
  cancel?(): void;

  /** Clean up resources */
  destroy?(): void;
}

/**
 * Extended layout result with additional metadata
 */
export interface ExtendedLayoutResult extends LayoutResult {
  /** Time taken to compute layout in milliseconds */
  computeTime?: number;

  /** Algorithm-specific statistics */
  stats?: Record<string, unknown>;

  /** Whether layout was cancelled */
  cancelled?: boolean;

  /** Layout quality score (0-1) */
  qualityScore?: number;
}

/**
 * Progress callback for async layouts
 */
export type LayoutProgressCallback = (progress: number, message?: string) => void;

/**
 * Options for async layout computation
 */
export interface AsyncLayoutOptions {
  /** Progress callback */
  onProgress?: LayoutProgressCallback;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Maximum computation time in milliseconds */
  timeout?: number;
}

// ============================================================
// Base Layout Algorithm Class
// ============================================================

/**
 * Base class for layout algorithms
 *
 * Provides common functionality for layout implementations:
 * - Option management with defaults and validation
 * - Graph analysis helpers
 * - Bounding box calculation
 * - Progress tracking for async layouts
 *
 * @example
 * ```typescript
 * class MyLayout extends BaseLayoutAlgorithm {
 *   static readonly OPTION_DEFINITIONS: LayoutOptionDefinition[] = [
 *     { name: 'spacing', type: 'number', label: 'Node Spacing', default: 50 },
 *   ];
 *
 *   constructor(options?: Record<string, unknown>) {
 *     super('my-layout', options);
 *   }
 *
 *   getDefaults(): Record<string, unknown> {
 *     return { spacing: 50 };
 *   }
 *
 *   layout(graph: GraphData): LayoutResult {
 *     const spacing = this.options.spacing as number;
 *     // ... compute positions
 *     return { positions, bounds: this.calculateBounds(positions) };
 *   }
 * }
 * ```
 */
export abstract class BaseLayoutAlgorithm implements LayoutAlgorithmInstance {
  /** Algorithm name */
  readonly name: string;

  /** Current options */
  protected options: Record<string, unknown>;

  /** Whether layout is cancelled */
  protected cancelled = false;

  /** Abort controller for cancellation */
  protected abortController: AbortController | null = null;

  /**
   * Create a new layout algorithm instance
   * @param name - Algorithm name
   * @param options - Initial options (merged with defaults)
   */
  constructor(name: string, options: Record<string, unknown> = {}) {
    this.name = name;
    this.options = { ...this.getDefaults(), ...options };
  }

  /**
   * Get default option values
   * Subclasses must implement this to define their defaults
   */
  abstract getDefaults(): Record<string, unknown>;

  /**
   * Compute layout positions for the given graph
   * Subclasses must implement this with their layout algorithm
   */
  abstract layout(
    graph: GraphData,
    options?: Record<string, unknown>
  ): LayoutResult | Promise<LayoutResult>;

  /**
   * Get current options
   */
  getOptions(): Record<string, unknown> {
    return { ...this.options };
  }

  /**
   * Set options (merged with existing)
   */
  setOptions(options: Partial<Record<string, unknown>>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Check if layout can handle this graph
   * Base implementation returns true for non-empty graphs
   */
  canLayout(graph: GraphData): boolean {
    return graph.nodes.length > 0;
  }

  /**
   * Estimate layout complexity (0-1)
   * Base implementation uses node count as heuristic
   */
  estimateComplexity(graph: GraphData): number {
    const nodes = graph.nodes.length;
    const edges = graph.edges.length;

    // Simple heuristic: complexity scales with nodes and edges
    const nodeComplexity = Math.min(nodes / 1000, 1);
    const edgeComplexity = Math.min(edges / 5000, 1);

    return Math.min((nodeComplexity + edgeComplexity) / 2, 1);
  }

  /**
   * Cancel in-progress layout
   */
  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cancelled = true;
    this.abortController?.abort();
    this.abortController = null;
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Calculate bounding box from positions
   */
  protected calculateBounds(positions: Map<string, Point>): LayoutResult["bounds"] {
    if (positions.size === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const { x, y } of positions.values()) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Build adjacency list from graph
   */
  protected buildAdjacencyList(graph: GraphData): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();

    // Initialize all nodes
    for (const node of graph.nodes) {
      adjacency.set(node.id, new Set());
    }

    // Add edges
    for (const edge of graph.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      adjacency.get(sourceId)?.add(targetId);
    }

    return adjacency;
  }

  /**
   * Build bidirectional adjacency list (treat edges as undirected)
   */
  protected buildBidirectionalAdjacency(graph: GraphData): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();

    // Initialize all nodes
    for (const node of graph.nodes) {
      adjacency.set(node.id, new Set());
    }

    // Add edges in both directions
    for (const edge of graph.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      adjacency.get(sourceId)?.add(targetId);
      adjacency.get(targetId)?.add(sourceId);
    }

    return adjacency;
  }

  /**
   * Find root nodes (nodes with no incoming edges)
   */
  protected findRootNodes(graph: GraphData): string[] {
    const hasIncoming = new Set<string>();

    for (const edge of graph.edges) {
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      hasIncoming.add(targetId);
    }

    return graph.nodes
      .filter((node) => !hasIncoming.has(node.id))
      .map((node) => node.id);
  }

  /**
   * Find leaf nodes (nodes with no outgoing edges)
   */
  protected findLeafNodes(graph: GraphData): string[] {
    const hasOutgoing = new Set<string>();

    for (const edge of graph.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      hasOutgoing.add(sourceId);
    }

    return graph.nodes
      .filter((node) => !hasOutgoing.has(node.id))
      .map((node) => node.id);
  }

  /**
   * Calculate node degrees
   */
  protected calculateDegrees(
    graph: GraphData
  ): Map<string, { in: number; out: number; total: number }> {
    const degrees = new Map<string, { in: number; out: number; total: number }>();

    // Initialize all nodes
    for (const node of graph.nodes) {
      degrees.set(node.id, { in: 0, out: 0, total: 0 });
    }

    // Count edges
    for (const edge of graph.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const sourceDeg = degrees.get(sourceId);
      if (sourceDeg) {
        sourceDeg.out++;
        sourceDeg.total++;
      }

      const targetDeg = degrees.get(targetId);
      if (targetDeg) {
        targetDeg.in++;
        targetDeg.total++;
      }
    }

    return degrees;
  }

  /**
   * Check for cycles in the graph using DFS
   */
  protected hasCycles(graph: GraphData): boolean {
    const adjacency = this.buildAdjacencyList(graph);
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      inStack.add(nodeId);

      const neighbors = adjacency.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (dfs(neighbor)) return true;
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        if (dfs(node.id)) return true;
      }
    }

    return false;
  }

  /**
   * Get connected components
   */
  protected getConnectedComponents(graph: GraphData): string[][] {
    const adjacency = this.buildBidirectionalAdjacency(graph);
    const visited = new Set<string>();
    const components: string[][] = [];

    const bfs = (start: string): string[] => {
      const component: string[] = [];
      const queue = [start];

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;

        visited.add(nodeId);
        component.push(nodeId);

        const neighbors = adjacency.get(nodeId) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }

      return component;
    };

    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        components.push(bfs(node.id));
      }
    }

    return components;
  }

  /**
   * Check if graph is a tree (connected and acyclic)
   */
  protected isTree(graph: GraphData): boolean {
    // A tree has exactly n-1 edges for n nodes
    if (graph.edges.length !== graph.nodes.length - 1) {
      return false;
    }

    // Check connectivity
    const components = this.getConnectedComponents(graph);
    return components.length === 1;
  }

  /**
   * Calculate shortest path distances using BFS
   */
  protected shortestPathDistances(
    graph: GraphData,
    sourceId: string
  ): Map<string, number> {
    const adjacency = this.buildBidirectionalAdjacency(graph);
    const distances = new Map<string, number>();
    const queue: Array<{ nodeId: string; distance: number }> = [
      { nodeId: sourceId, distance: 0 },
    ];

    distances.set(sourceId, 0);

    while (queue.length > 0) {
      const { nodeId, distance } = queue.shift()!;

      const neighbors = adjacency.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, distance + 1);
          queue.push({ nodeId: neighbor, distance: distance + 1 });
        }
      }
    }

    return distances;
  }
}

// ============================================================
// Layout Plugin Registry
// ============================================================

/**
 * Event types for plugin registry
 */
export type PluginRegistryEventType =
  | "pluginRegistered"
  | "pluginUnregistered"
  | "pluginUpdated";

/**
 * Event data for plugin registry events
 */
export interface PluginRegistryEvent {
  type: PluginRegistryEventType;
  plugin: LayoutPlugin;
}

/**
 * Event listener for plugin registry
 */
export type PluginRegistryEventListener = (event: PluginRegistryEvent) => void;

/**
 * Filter criteria for finding plugins
 */
export interface PluginFilter {
  /** Filter by category */
  category?: LayoutCategory;

  /** Filter by supported graph type */
  graphType?: GraphType;

  /** Filter by tag */
  tag?: string;

  /** Search by name or description */
  search?: string;

  /** Filter by minimum nodes supported */
  minNodes?: number;

  /** Filter by maximum nodes supported */
  maxNodes?: number;
}

/**
 * Registry for managing layout plugins
 *
 * Provides plugin discovery, registration, and lifecycle management
 *
 * @example
 * ```typescript
 * const registry = new LayoutPluginRegistry();
 *
 * // Register a plugin
 * registry.register(myLayoutPlugin);
 *
 * // Find plugins by category
 * const hierarchicalPlugins = registry.findPlugins({ category: 'hierarchical' });
 *
 * // Create a layout instance
 * const layout = registry.createLayout('my-layout-id', { spacing: 100 });
 * ```
 */
export class LayoutPluginRegistry {
  private plugins: Map<string, LayoutPlugin> = new Map();
  private eventListeners: Map<PluginRegistryEventType, Set<PluginRegistryEventListener>> = new Map();

  constructor() {
    // Initialize event listener maps
    const eventTypes: PluginRegistryEventType[] = [
      "pluginRegistered",
      "pluginUnregistered",
      "pluginUpdated",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }
  }

  /**
   * Register a layout plugin
   * @param plugin - Plugin to register
   * @throws Error if plugin with same ID already exists
   */
  register(plugin: LayoutPlugin): void {
    const id = plugin.metadata.id;

    if (this.plugins.has(id)) {
      throw new Error(`Plugin with ID "${id}" is already registered`);
    }

    this.plugins.set(id, plugin);
    this.emit("pluginRegistered", { type: "pluginRegistered", plugin });
  }

  /**
   * Unregister a layout plugin
   * @param pluginId - ID of plugin to unregister
   * @returns true if plugin was unregistered, false if not found
   */
  unregister(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    this.plugins.delete(pluginId);
    this.emit("pluginUnregistered", { type: "pluginUnregistered", plugin });
    return true;
  }

  /**
   * Update an existing plugin
   * @param plugin - Updated plugin (must have same ID)
   * @throws Error if plugin not found
   */
  update(plugin: LayoutPlugin): void {
    const id = plugin.metadata.id;

    if (!this.plugins.has(id)) {
      throw new Error(`Plugin with ID "${id}" is not registered`);
    }

    this.plugins.set(id, plugin);
    this.emit("pluginUpdated", { type: "pluginUpdated", plugin });
  }

  /**
   * Get a plugin by ID
   * @param pluginId - Plugin ID
   * @returns Plugin or undefined if not found
   */
  get(pluginId: string): LayoutPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Check if a plugin is registered
   * @param pluginId - Plugin ID
   * @returns true if registered
   */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Get all registered plugins
   * @returns Array of all plugins
   */
  getAll(): LayoutPlugin[] {
    return [...this.plugins.values()];
  }

  /**
   * Get all plugin IDs
   * @returns Array of plugin IDs
   */
  getIds(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Find plugins matching filter criteria
   * @param filter - Filter criteria
   * @returns Array of matching plugins
   */
  findPlugins(filter: PluginFilter): LayoutPlugin[] {
    return this.getAll().filter((plugin) => {
      const meta = plugin.metadata;

      // Filter by category
      if (filter.category && meta.category !== filter.category) {
        return false;
      }

      // Filter by graph type
      if (filter.graphType && !meta.supportedGraphTypes.includes(filter.graphType)) {
        return false;
      }

      // Filter by tag
      if (filter.tag && !meta.tags.includes(filter.tag)) {
        return false;
      }

      // Filter by search term
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const nameMatch = meta.name.toLowerCase().includes(searchLower);
        const descMatch = meta.description.toLowerCase().includes(searchLower);
        const tagMatch = meta.tags.some((tag) => tag.toLowerCase().includes(searchLower));
        if (!nameMatch && !descMatch && !tagMatch) {
          return false;
        }
      }

      // Filter by node count
      if (filter.minNodes !== undefined && meta.maxNodes !== undefined) {
        if (meta.maxNodes < filter.minNodes) {
          return false;
        }
      }
      if (filter.maxNodes !== undefined && meta.minNodes !== undefined) {
        if (meta.minNodes > filter.maxNodes) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Find plugins suitable for a given graph
   * @param graph - Graph data
   * @returns Array of suitable plugins sorted by relevance
   */
  findSuitablePlugins(graph: GraphData): LayoutPlugin[] {
    const nodeCount = graph.nodes.length;

    return this.getAll()
      .filter((plugin) => {
        const meta = plugin.metadata;

        // Check node count bounds
        if (meta.minNodes !== undefined && nodeCount < meta.minNodes) {
          return false;
        }
        if (meta.maxNodes !== undefined && nodeCount > meta.maxNodes) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by category preference (domain-specific first)
        const categoryOrder: Record<LayoutCategory, number> = {
          "domain-specific": 0,
          hierarchical: 1,
          radial: 2,
          "force-based": 3,
          grid: 4,
          experimental: 5,
        };

        return (
          (categoryOrder[a.metadata.category] ?? 10) -
          (categoryOrder[b.metadata.category] ?? 10)
        );
      });
  }

  /**
   * Create a layout algorithm instance from a plugin
   * @param pluginId - Plugin ID
   * @param options - Layout options
   * @returns Layout algorithm instance
   * @throws Error if plugin not found
   */
  createLayout(pluginId: string, options?: Record<string, unknown>): LayoutAlgorithmInstance {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" not found`);
    }

    return plugin.factory.create(options);
  }

  /**
   * Get option definitions for a plugin
   * @param pluginId - Plugin ID
   * @returns Array of option definitions
   * @throws Error if plugin not found
   */
  getOptionDefinitions(pluginId: string): LayoutOptionDefinition[] {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" not found`);
    }

    return plugin.factory.getOptionDefinitions();
  }

  /**
   * Validate options for a plugin
   * @param pluginId - Plugin ID
   * @param options - Options to validate
   * @returns Validation result
   * @throws Error if plugin not found
   */
  validateOptions(pluginId: string, options: Record<string, unknown>): ValidationResult {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" not found`);
    }

    return plugin.factory.validateOptions(options);
  }

  /**
   * Get plugins grouped by category
   * @returns Map of category to plugins
   */
  getByCategory(): Map<LayoutCategory, LayoutPlugin[]> {
    const byCategory = new Map<LayoutCategory, LayoutPlugin[]>();

    for (const plugin of this.plugins.values()) {
      const category = plugin.metadata.category;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(plugin);
    }

    return byCategory;
  }

  /**
   * Add event listener
   */
  on(eventType: PluginRegistryEventType, listener: PluginRegistryEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: PluginRegistryEventType, listener: PluginRegistryEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Clear all plugins
   */
  clear(): void {
    const plugins = [...this.plugins.values()];
    for (const plugin of plugins) {
      this.unregister(plugin.metadata.id);
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: PluginRegistryEventType, event: PluginRegistryEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in LayoutPluginRegistry event listener:", error);
        }
      }
    }
  }
}

// ============================================================
// Factory Helper Functions
// ============================================================

/**
 * Create a simple layout factory from an algorithm class
 *
 * @example
 * ```typescript
 * class MyLayout extends BaseLayoutAlgorithm { ... }
 *
 * const factory = createLayoutFactory(MyLayout, [
 *   { name: 'spacing', type: 'number', label: 'Spacing', default: 50 },
 * ]);
 * ```
 */
export function createLayoutFactory<T extends BaseLayoutAlgorithm>(
  LayoutClass: new (options?: Record<string, unknown>) => T,
  optionDefinitions: LayoutOptionDefinition[]
): LayoutFactory {
  return {
    create(options?: Record<string, unknown>): T {
      return new LayoutClass(options);
    },

    getOptionDefinitions(): LayoutOptionDefinition[] {
      return optionDefinitions;
    },

    validateOptions(options: Record<string, unknown>): ValidationResult {
      const errors: Record<string, string> = {};
      const warnings: Record<string, string> = {};

      for (const def of optionDefinitions) {
        const value = options[def.name];

        // Skip if no value and not required
        if (value === undefined) continue;

        // Type validation
        switch (def.type) {
          case "number": {
            if (typeof value !== "number" || isNaN(value)) {
              errors[def.name] = `${def.label} must be a number`;
              continue;
            }
            if (def.min !== undefined && value < def.min) {
              errors[def.name] = `${def.label} must be at least ${def.min}`;
            }
            if (def.max !== undefined && value > def.max) {
              errors[def.name] = `${def.label} must be at most ${def.max}`;
            }
            break;
          }
          case "boolean": {
            if (typeof value !== "boolean") {
              errors[def.name] = `${def.label} must be true or false`;
            }
            break;
          }
          case "string": {
            if (typeof value !== "string") {
              errors[def.name] = `${def.label} must be a string`;
            }
            break;
          }
          case "select": {
            if (def.options && !def.options.some((opt) => opt.value === value)) {
              errors[def.name] = `${def.label} must be one of the available options`;
            }
            break;
          }
          case "color": {
            if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/i.test(value)) {
              warnings[def.name] = `${def.label} should be a hex color (e.g., #FF0000)`;
            }
            break;
          }
        }

        // Custom validation
        if (def.validate && !def.validate(value)) {
          errors[def.name] = `${def.label} failed custom validation`;
        }
      }

      return {
        valid: Object.keys(errors).length === 0,
        errors,
        warnings,
      };
    },
  };
}

/**
 * Create a complete layout plugin from an algorithm class
 *
 * @example
 * ```typescript
 * const myPlugin = createLayoutPlugin(
 *   MyLayout,
 *   {
 *     id: 'my-layout',
 *     name: 'My Layout',
 *     description: 'A custom layout algorithm',
 *     version: '1.0.0',
 *     category: 'domain-specific',
 *     tags: ['custom', 'ontology'],
 *     supportedGraphTypes: ['dag', 'tree'],
 *   },
 *   [
 *     { name: 'spacing', type: 'number', label: 'Spacing', default: 50 },
 *   ]
 * );
 *
 * registry.register(myPlugin);
 * ```
 */
export function createLayoutPlugin<T extends BaseLayoutAlgorithm>(
  LayoutClass: new (options?: Record<string, unknown>) => T,
  metadata: LayoutPluginMetadata,
  optionDefinitions: LayoutOptionDefinition[]
): LayoutPlugin {
  return {
    metadata,
    factory: createLayoutFactory(LayoutClass, optionDefinitions),
  };
}

// ============================================================
// Global Registry Instance
// ============================================================

/**
 * Global layout plugin registry singleton
 */
export const layoutPluginRegistry = new LayoutPluginRegistry();

// ============================================================
// Built-in Plugin Adapters
// ============================================================

/**
 * Adapter to convert existing LayoutManager layouts to plugins
 * This allows seamless integration of new plugin system with existing layouts
 */
export function createBuiltInLayoutPlugin(
  layoutName: LayoutAlgorithmName,
  metadata: Partial<LayoutPluginMetadata>,
  optionDefinitions: LayoutOptionDefinition[] = []
): LayoutPlugin {
  const defaultMetadata: LayoutPluginMetadata = {
    id: `builtin-${layoutName}`,
    name: layoutName.charAt(0).toUpperCase() + layoutName.slice(1),
    description: `Built-in ${layoutName} layout algorithm`,
    version: "1.0.0",
    category: "force-based",
    tags: ["built-in"],
    supportedGraphTypes: ["general"],
  };

  return {
    metadata: { ...defaultMetadata, ...metadata },
    factory: {
      create(options?: Record<string, unknown>): LayoutAlgorithmInstance {
        return {
          name: layoutName,
          layout(_graph: GraphData): LayoutResult {
            // This would delegate to LayoutManager's built-in layout
            // The actual implementation connects through LayoutManager
            throw new Error(`Built-in layout "${layoutName}" should be used through LayoutManager`);
          },
          getDefaults: () => ({}),
          getOptions: () => options ?? {},
          setOptions: () => {},
          canLayout: () => true,
          estimateComplexity: () => 0.5,
        };
      },
      getOptionDefinitions: () => optionDefinitions,
      validateOptions: (_options) => ({
        valid: true,
        errors: {},
        warnings: {},
      }),
    },
  };
}
