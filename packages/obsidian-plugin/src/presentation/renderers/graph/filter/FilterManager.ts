/**
 * FilterManager - Manages graph filters and their application
 *
 * Provides a centralized system for managing, combining, and applying
 * filters to graph visualization data.
 *
 * @module presentation/renderers/graph/filter
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "exocortex";
import type {
  GraphFilter,
  TypeFilter,
  PredicateFilter,
  LiteralFilter,
  PathFilter,
  CompositeFilter,
  FilterPreset,
  TypeCounts,
} from "./FilterTypes";
import { generateFilterId } from "./FilterTypes";

/**
 * Callback for filter change events
 */
export type FilterChangeCallback = (filteredNodeIds: Set<string>, filteredEdgeIds: Set<string>) => void;

/**
 * Graph data container for filtering
 */
export interface GraphData {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

/**
 * FilterManager - Centralized filter management for graph visualization
 *
 * @example
 * ```typescript
 * const manager = new FilterManager();
 *
 * // Set graph data
 * manager.setGraphData(nodes, edges);
 *
 * // Add a type filter
 * manager.addFilter({
 *   type: 'type',
 *   id: 'show-tasks',
 *   enabled: true,
 *   typeUris: ['ems__Task'],
 *   include: true,
 *   includeSubclasses: false
 * });
 *
 * // Get filtered results
 * const { nodes, edges } = manager.getFilteredResults();
 * ```
 */
export class FilterManager {
  /** Active filters keyed by ID */
  private activeFilters: Map<string, GraphFilter> = new Map();

  /** Graph data for filtering */
  private graphData: GraphData = {
    nodes: new Map(),
    edges: new Map(),
  };

  /** Cached filter results */
  private cachedNodeResults: Map<string, Set<string>> = new Map();
  private cachedEdgeResults: Map<string, Set<string>> = new Map();

  /** Change listeners */
  private changeListeners: Set<FilterChangeCallback> = new Set();

  /** Saved presets */
  private presets: Map<string, FilterPreset> = new Map();

  /**
   * Set the graph data to filter
   */
  setGraphData(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): void {
    this.graphData = { nodes, edges };
    this.invalidateAllCaches();
    this.notifyListeners();
  }

  /**
   * Add or update a filter
   */
  addFilter(filter: GraphFilter): void {
    this.activeFilters.set(filter.id, filter);
    this.invalidateCache(filter.id);
    this.notifyListeners();
  }

  /**
   * Remove a filter
   */
  removeFilter(filterId: string): void {
    if (this.activeFilters.delete(filterId)) {
      this.cachedNodeResults.delete(filterId);
      this.cachedEdgeResults.delete(filterId);
      this.notifyListeners();
    }
  }

  /**
   * Toggle a filter's enabled state
   */
  toggleFilter(filterId: string): void {
    const filter = this.activeFilters.get(filterId);
    if (filter) {
      filter.enabled = !filter.enabled;
      this.invalidateCache(filterId);
      this.notifyListeners();
    }
  }

  /**
   * Enable a filter
   */
  enableFilter(filterId: string): void {
    const filter = this.activeFilters.get(filterId);
    if (filter && !filter.enabled) {
      filter.enabled = true;
      this.invalidateCache(filterId);
      this.notifyListeners();
    }
  }

  /**
   * Disable a filter
   */
  disableFilter(filterId: string): void {
    const filter = this.activeFilters.get(filterId);
    if (filter && filter.enabled) {
      filter.enabled = false;
      this.invalidateCache(filterId);
      this.notifyListeners();
    }
  }

  /**
   * Clear all filters
   */
  clearAllFilters(): void {
    this.activeFilters.clear();
    this.invalidateAllCaches();
    this.notifyListeners();
  }

  /**
   * Get all active filters
   */
  getActiveFilters(): GraphFilter[] {
    return Array.from(this.activeFilters.values());
  }

  /**
   * Get a specific filter by ID
   */
  getFilter(filterId: string): GraphFilter | undefined {
    return this.activeFilters.get(filterId);
  }

  /**
   * Check if any filters are active
   */
  hasActiveFilters(): boolean {
    for (const filter of this.activeFilters.values()) {
      if (filter.enabled) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the count of enabled filters
   */
  getEnabledFilterCount(): number {
    let count = 0;
    for (const filter of this.activeFilters.values()) {
      if (filter.enabled) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get filtered node and edge IDs
   */
  getFilteredResults(): { nodeIds: Set<string>; edgeIds: Set<string> } {
    if (!this.hasActiveFilters()) {
      // No filters - return all nodes and edges
      return {
        nodeIds: new Set(this.graphData.nodes.keys()),
        edgeIds: new Set(this.graphData.edges.keys()),
      };
    }

    // Start with all nodes
    let visibleNodeIds: Set<string> = new Set(this.graphData.nodes.keys());

    // Apply each enabled filter (AND logic by default)
    for (const filter of this.activeFilters.values()) {
      if (!filter.enabled) continue;

      const filterResult = this.applyFilter(filter);
      visibleNodeIds = this.intersectSets(visibleNodeIds, filterResult);
    }

    // Filter edges to only include those connecting visible nodes
    const visibleEdgeIds = new Set<string>();
    for (const [edgeId, edge] of this.graphData.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target;
      if (visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId)) {
        visibleEdgeIds.add(edgeId);
      }
    }

    return { nodeIds: visibleNodeIds, edgeIds: visibleEdgeIds };
  }

  /**
   * Get filtered nodes and edges as arrays
   */
  getFilteredData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const { nodeIds, edgeIds } = this.getFilteredResults();

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const id of nodeIds) {
      const node = this.graphData.nodes.get(id);
      if (node) nodes.push(node);
    }

    for (const id of edgeIds) {
      const edge = this.graphData.edges.get(id);
      if (edge) edges.push(edge);
    }

    return { nodes, edges };
  }

  /**
   * Apply a single filter and return matching node IDs
   */
  private applyFilter(filter: GraphFilter): Set<string> {
    // Check cache first
    const cached = this.cachedNodeResults.get(filter.id);
    if (cached) {
      return cached;
    }

    let result: Set<string>;

    switch (filter.type) {
      case "type":
        result = this.applyTypeFilter(filter);
        break;
      case "predicate":
        result = this.applyPredicateFilter(filter);
        break;
      case "literal":
        result = this.applyLiteralFilter(filter);
        break;
      case "path":
        result = this.applyPathFilter(filter);
        break;
      case "sparql":
        // Custom SPARQL not implemented in basic FilterManager
        // Would require integration with TripleStore
        result = new Set(this.graphData.nodes.keys());
        break;
      case "composite":
        result = this.applyCompositeFilter(filter);
        break;
      default:
        result = new Set(this.graphData.nodes.keys());
    }

    // Cache result
    this.cachedNodeResults.set(filter.id, result);
    return result;
  }

  /**
   * Apply type filter
   */
  private applyTypeFilter(filter: TypeFilter): Set<string> {
    const matchingNodes = new Set<string>();
    const typeSet = new Set(filter.typeUris);

    for (const [id, node] of this.graphData.nodes) {
      const nodeType = node.assetClass ?? "unknown";
      const matches = typeSet.has(nodeType);

      if (filter.include === matches) {
        matchingNodes.add(id);
      }
    }

    return matchingNodes;
  }

  /**
   * Apply predicate filter
   */
  private applyPredicateFilter(filter: PredicateFilter): Set<string> {
    const matchingNodes = new Set<string>();
    const predicateSet = new Set(filter.predicateUris);

    // First, find all nodes connected by matching predicates
    const connectedNodes = new Set<string>();
    for (const edge of this.graphData.edges.values()) {
      const predicate = edge.predicate ?? edge.type;
      if (predicateSet.has(predicate)) {
        const sourceId = typeof edge.source === "string" ? edge.source : edge.source;
        const targetId = typeof edge.target === "string" ? edge.target : edge.target;

        if (filter.direction === "outgoing" || filter.direction === "both") {
          connectedNodes.add(sourceId);
        }
        if (filter.direction === "incoming" || filter.direction === "both") {
          connectedNodes.add(targetId);
        }
      }
    }

    // Return nodes based on include flag
    for (const id of this.graphData.nodes.keys()) {
      const isConnected = connectedNodes.has(id);
      if (filter.include === isConnected) {
        matchingNodes.add(id);
      }
    }

    return matchingNodes;
  }

  /**
   * Apply literal filter
   */
  private applyLiteralFilter(filter: LiteralFilter): Set<string> {
    const matchingNodes = new Set<string>();

    for (const [id, node] of this.graphData.nodes) {
      const properties = node.properties ?? {};
      const value = properties[filter.predicateUri];

      if (this.matchesLiteralValue(value, filter)) {
        matchingNodes.add(id);
      }
    }

    return matchingNodes;
  }

  /**
   * Check if a value matches the literal filter criteria
   */
  private matchesLiteralValue(value: unknown, filter: LiteralFilter): boolean {
    if (value === undefined || value === null) {
      return false;
    }

    const filterValue = filter.value;

    switch (filter.operator) {
      case "equals":
        return String(value) === String(filterValue);

      case "contains":
        return String(value).toLowerCase().includes(String(filterValue).toLowerCase());

      case "startsWith":
        return String(value).toLowerCase().startsWith(String(filterValue).toLowerCase());

      case "regex":
        try {
          const regex = new RegExp(String(filterValue), "i");
          return regex.test(String(value));
        } catch {
          return false;
        }

      case "gt":
        return Number(value) > Number(filterValue);

      case "lt":
        return Number(value) < Number(filterValue);

      case "gte":
        return Number(value) >= Number(filterValue);

      case "lte":
        return Number(value) <= Number(filterValue);

      case "between":
        if (Array.isArray(filterValue) && filterValue.length === 2) {
          const numValue = Number(value);
          return numValue >= filterValue[0] && numValue <= filterValue[1];
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Apply path filter (BFS from start node)
   */
  private applyPathFilter(filter: PathFilter): Set<string> {
    const matchingNodes = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; distance: number }> = [];

    // Start BFS from start node
    if (this.graphData.nodes.has(filter.startNode)) {
      queue.push({ id: filter.startNode, distance: 0 });
      visited.add(filter.startNode);
    }

    const predicateSet = filter.predicates ? new Set(filter.predicates) : null;

    while (queue.length > 0) {
      const current = queue.shift()!;
      matchingNodes.add(current.id);

      if (current.distance >= filter.maxDistance) {
        continue;
      }

      // Find neighbors
      for (const edge of this.graphData.edges.values()) {
        // Check predicate restriction - match either edge.type or edge.predicate
        if (predicateSet) {
          const typeMatches = edge.type && predicateSet.has(edge.type);
          const predicateMatches = edge.predicate && predicateSet.has(edge.predicate);
          if (!typeMatches && !predicateMatches) {
            continue;
          }
        }

        const sourceId = typeof edge.source === "string" ? edge.source : edge.source;
        const targetId = typeof edge.target === "string" ? edge.target : edge.target;

        let neighborId: string | null = null;
        if (sourceId === current.id && !visited.has(targetId)) {
          neighborId = targetId;
        } else if (targetId === current.id && !visited.has(sourceId)) {
          neighborId = sourceId;
        }

        if (neighborId && this.graphData.nodes.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, distance: current.distance + 1 });
        }
      }
    }

    return matchingNodes;
  }

  /**
   * Apply composite filter
   */
  private applyCompositeFilter(filter: CompositeFilter): Set<string> {
    if (filter.filters.length === 0) {
      return new Set(this.graphData.nodes.keys());
    }

    const childResults = filter.filters
      .filter((f) => f.enabled)
      .map((f) => this.applyFilter(f));

    if (childResults.length === 0) {
      return new Set(this.graphData.nodes.keys());
    }

    switch (filter.operator) {
      case "AND":
        return childResults.reduce((acc, set) => this.intersectSets(acc, set));

      case "OR":
        return childResults.reduce((acc, set) => this.unionSets(acc, set));

      case "NOT": {
        // NOT applies to the first filter only
        const allNodes = new Set(this.graphData.nodes.keys());
        return this.differenceSets(allNodes, childResults[0]);
      }

      default:
        return new Set(this.graphData.nodes.keys());
    }
  }

  /**
   * Set intersection
   */
  private intersectSets(a: Set<string>, b: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const item of a) {
      if (b.has(item)) {
        result.add(item);
      }
    }
    return result;
  }

  /**
   * Set union
   */
  private unionSets(a: Set<string>, b: Set<string>): Set<string> {
    const result = new Set<string>(a);
    for (const item of b) {
      result.add(item);
    }
    return result;
  }

  /**
   * Set difference (a - b)
   */
  private differenceSets(a: Set<string>, b: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const item of a) {
      if (!b.has(item)) {
        result.add(item);
      }
    }
    return result;
  }

  /**
   * Invalidate cache for a specific filter
   */
  private invalidateCache(filterId: string): void {
    this.cachedNodeResults.delete(filterId);
    this.cachedEdgeResults.delete(filterId);
  }

  /**
   * Invalidate all caches
   */
  private invalidateAllCaches(): void {
    this.cachedNodeResults.clear();
    this.cachedEdgeResults.clear();
  }

  /**
   * Subscribe to filter changes
   */
  subscribe(callback: FilterChangeCallback): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of filter changes
   */
  private notifyListeners(): void {
    const { nodeIds, edgeIds } = this.getFilteredResults();
    for (const listener of this.changeListeners) {
      listener(nodeIds, edgeIds);
    }
  }

  /**
   * Get type counts for filter panel
   */
  getTypeCounts(): TypeCounts {
    const nodeTypes = new Map<string, number>();
    const edgeTypes = new Map<string, number>();

    for (const node of this.graphData.nodes.values()) {
      const type = node.assetClass ?? "unknown";
      nodeTypes.set(type, (nodeTypes.get(type) ?? 0) + 1);
    }

    for (const edge of this.graphData.edges.values()) {
      const type = edge.type ?? "unknown";
      edgeTypes.set(type, (edgeTypes.get(type) ?? 0) + 1);
    }

    return { nodeTypes, edgeTypes };
  }

  /**
   * Get all unique node types in the graph
   */
  getNodeTypes(): string[] {
    const types = new Set<string>();
    for (const node of this.graphData.nodes.values()) {
      if (node.assetClass) {
        types.add(node.assetClass);
      }
    }
    return Array.from(types).sort();
  }

  /**
   * Get all unique edge types in the graph
   */
  getEdgeTypes(): string[] {
    const types = new Set<string>();
    for (const edge of this.graphData.edges.values()) {
      if (edge.type) {
        types.add(edge.type);
      }
    }
    return Array.from(types).sort();
  }

  /**
   * Save current filters as a preset
   */
  savePreset(name: string, description?: string): FilterPreset {
    const preset: FilterPreset = {
      id: generateFilterId("preset"),
      name,
      description,
      filters: Array.from(this.activeFilters.values()),
    };
    this.presets.set(preset.id, preset);
    return preset;
  }

  /**
   * Load a preset
   */
  loadPreset(presetId: string): boolean {
    const preset = this.presets.get(presetId);
    if (!preset) {
      return false;
    }

    this.clearAllFilters();
    for (const filter of preset.filters) {
      this.activeFilters.set(filter.id, { ...filter });
    }
    this.invalidateAllCaches();
    this.notifyListeners();
    return true;
  }

  /**
   * Delete a preset
   */
  deletePreset(presetId: string): boolean {
    return this.presets.delete(presetId);
  }

  /**
   * Get all presets
   */
  getPresets(): FilterPreset[] {
    return Array.from(this.presets.values());
  }

  /**
   * Create quick filter by node type
   */
  quickFilterByType(typeUri: string, include = true): string {
    const filterId = generateFilterId("type");
    this.addFilter({
      type: "type",
      id: filterId,
      enabled: true,
      typeUris: [typeUri],
      include,
      includeSubclasses: false,
    });
    return filterId;
  }

  /**
   * Create quick filter by edge type
   */
  quickFilterByEdgeType(edgeType: string, include = true): string {
    const filterId = generateFilterId("predicate");
    this.addFilter({
      type: "predicate",
      id: filterId,
      enabled: true,
      predicateUris: [edgeType],
      include,
      direction: "both",
    });
    return filterId;
  }

  /**
   * Create quick path filter from a node
   */
  quickFilterByPath(nodeId: string, maxDistance = 2): string {
    const filterId = generateFilterId("path");
    this.addFilter({
      type: "path",
      id: filterId,
      enabled: true,
      startNode: nodeId,
      maxDistance,
    });
    return filterId;
  }

  /**
   * Get filter statistics
   */
  getStats(): {
    totalFilters: number;
    enabledFilters: number;
    totalNodes: number;
    filteredNodes: number;
    totalEdges: number;
    filteredEdges: number;
  } {
    const { nodeIds, edgeIds } = this.getFilteredResults();
    return {
      totalFilters: this.activeFilters.size,
      enabledFilters: this.getEnabledFilterCount(),
      totalNodes: this.graphData.nodes.size,
      filteredNodes: nodeIds.size,
      totalEdges: this.graphData.edges.size,
      filteredEdges: edgeIds.size,
    };
  }

  /**
   * Serialize filters to JSON-safe format
   */
  serializeFilters(): object[] {
    return Array.from(this.activeFilters.values()).map((filter) => ({
      ...filter,
    }));
  }

  /**
   * Deserialize and load filters from JSON
   */
  loadFilters(filters: GraphFilter[]): void {
    this.clearAllFilters();
    for (const filter of filters) {
      this.activeFilters.set(filter.id, filter);
    }
    this.invalidateAllCaches();
    this.notifyListeners();
  }
}

/**
 * Create a singleton filter manager instance
 */
let filterManagerInstance: FilterManager | null = null;

/**
 * Get the global FilterManager instance
 */
export function getFilterManager(): FilterManager {
  if (!filterManagerInstance) {
    filterManagerInstance = new FilterManager();
  }
  return filterManagerInstance;
}

/**
 * Reset the global FilterManager instance (for testing)
 */
export function resetFilterManager(): void {
  filterManagerInstance = null;
}
