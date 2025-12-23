import { ITripleStore } from "../interfaces/ITripleStore";
import { Triple, Subject, Object as RDFObject } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { GraphNode, GraphNodeData } from "../domain/models/GraphNode";
import { GraphEdge, GraphEdgeType, createEdgeId } from "../domain/models/GraphEdge";
import {
  GraphData,
  GraphLoadOptions,
  GraphLoadResult,
  GraphStats,
  GraphChangeEvent,
  GraphChangeCallback,
  GraphSubscription,
} from "../domain/models/GraphData";

/**
 * Configuration for GraphQueryService.
 */
export interface GraphQueryServiceConfig {
  /** Default limit for queries */
  defaultLimit?: number;
  /** Maximum limit for queries */
  maxLimit?: number;
  /** Default depth for traversal */
  defaultDepth?: number;
  /** Maximum depth for traversal */
  maxDepth?: number;
  /** Include archived nodes by default */
  includeArchivedByDefault?: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL?: number;
}

/**
 * Predicate URIs used for graph relationships.
 */
const PREDICATES = {
  // Asset properties
  INSTANCE_CLASS: Namespace.EXO.term("Instance_class"),
  ASSET_LABEL: Namespace.EXO.term("Asset_label"),
  ASSET_PROTOTYPE: Namespace.EXO.term("Asset_prototype"),
  ASSET_IS_ARCHIVED: Namespace.EXO.term("Asset_isArchived"),

  // Hierarchy
  EFFORT_PARENT: Namespace.EMS.term("Effort_parent"),

  // References (wiki-links become these)
  REFERENCES: Namespace.EXO.term("references"),
  REFERENCED_BY: Namespace.EXO.term("referencedBy"),

  // RDF Type
  RDF_TYPE: Namespace.RDF.term("type"),
};

/**
 * Service for querying graph data from the triple store.
 * Provides incremental loading and subscription support.
 *
 * Performance target: load 1K nodes in <100ms
 */
export class GraphQueryService {
  private readonly tripleStore: ITripleStore;
  private readonly config: Required<GraphQueryServiceConfig>;
  private readonly subscribers: Set<GraphChangeCallback> = new Set();
  private nodeCache: Map<string, GraphNodeData> = new Map();
  private lastCacheUpdate: number = 0;

  constructor(tripleStore: ITripleStore, config: GraphQueryServiceConfig = {}) {
    this.tripleStore = tripleStore;
    this.config = {
      defaultLimit: config.defaultLimit ?? 100,
      maxLimit: config.maxLimit ?? 10000,
      defaultDepth: config.defaultDepth ?? 2,
      maxDepth: config.maxDepth ?? 10,
      includeArchivedByDefault: config.includeArchivedByDefault ?? false,
      cacheTTL: config.cacheTTL ?? 30000, // 30 seconds
    };
  }

  /**
   * Load all graph data within the given options.
   * Uses incremental loading internally for large datasets.
   */
  async loadGraphData(options: GraphLoadOptions = {}): Promise<GraphData> {
    const startTime = Date.now();
    const nodes = await this.loadNodes(options);
    const edges = await this.loadEdges(nodes, options);

    const stats = this.computeStats(nodes, edges);

    const loadTime = Date.now() - startTime;
    if (loadTime > 100 && nodes.length > 0) {
      console.debug(`GraphQueryService: loaded ${nodes.length} nodes in ${loadTime}ms (${(loadTime / nodes.length).toFixed(2)}ms/node)`);
    }

    return {
      nodes,
      edges,
      stats,
      lastUpdated: Date.now(),
      version: 1,
    };
  }

  /**
   * Load nodes incrementally with pagination.
   */
  async loadNodesIncremental(options: GraphLoadOptions = {}): Promise<GraphLoadResult> {
    const limit = Math.min(options.limit ?? this.config.defaultLimit, this.config.maxLimit);
    const offset = options.offset ?? 0;

    const allNodes = await this.loadNodes({
      ...options,
      limit: limit + 1, // Load one extra to check if there's more
      offset,
    });

    const hasMore = allNodes.length > limit;
    const nodes = hasMore ? allNodes.slice(0, limit) : allNodes;

    // Only load edges for the nodes we're returning
    const edges = await this.loadEdges(nodes, options);

    return {
      nodes,
      edges,
      hasMore,
      totalCount: undefined, // Would require separate count query
      cursor: hasMore ? String(offset + limit) : undefined,
    };
  }

  /**
   * Load nodes connected to a root node up to a specified depth.
   * Uses breadth-first traversal.
   */
  async loadConnectedNodes(rootId: string, options: GraphLoadOptions = {}): Promise<GraphLoadResult> {
    const depth = Math.min(options.depth ?? this.config.defaultDepth, this.config.maxDepth);
    const limit = Math.min(options.limit ?? this.config.maxLimit, this.config.maxLimit);

    const visited = new Set<string>();
    const nodeQueue: Array<{ id: string; currentDepth: number }> = [{ id: rootId, currentDepth: 0 }];
    const nodes: GraphNode[] = [];

    while (nodeQueue.length > 0 && nodes.length < limit) {
      const { id, currentDepth } = nodeQueue.shift()!;

      if (visited.has(id)) continue;
      visited.add(id);

      const node = await this.getNodeById(id, options);
      if (!node) continue;

      nodes.push(node);

      // If we haven't reached max depth, queue connected nodes
      if (currentDepth < depth) {
        const connectedIds = await this.getConnectedNodeIds(id);
        for (const connectedId of connectedIds) {
          if (!visited.has(connectedId)) {
            nodeQueue.push({ id: connectedId, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    const edges = await this.loadEdges(nodes, options);

    return {
      nodes,
      edges,
      hasMore: nodeQueue.length > 0,
      totalCount: visited.size + nodeQueue.length,
    };
  }

  /**
   * Get a single node by ID (path or URI).
   */
  async getNodeById(id: string, options: GraphLoadOptions = {}): Promise<GraphNode | null> {
    // Check cache first
    const cached = this.getCachedNode(id);
    if (cached) {
      return { ...cached } as GraphNode;
    }

    const subjectIRI = this.idToIRI(id);
    const triples = await this.tripleStore.match(subjectIRI, undefined, undefined);

    if (triples.length === 0) {
      return null;
    }

    const node = this.triplesToNode(id, triples, options);
    if (node) {
      this.cacheNode(node);
    }
    return node;
  }

  /**
   * Subscribe to graph changes.
   */
  subscribe(callback: GraphChangeCallback): GraphSubscription {
    this.subscribers.add(callback);
    return {
      unsubscribe: () => {
        this.subscribers.delete(callback);
      },
    };
  }

  /**
   * Notify subscribers of a change.
   */
  notifyChange(event: GraphChangeEvent): void {
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error("GraphQueryService: error in subscriber callback", error);
      }
    }
    // Invalidate cache on changes
    this.invalidateCache();
  }

  /**
   * Get graph statistics.
   */
  async getStats(): Promise<GraphStats> {
    const nodes = await this.loadNodes({ includeArchived: true });
    const edges = await this.loadEdges(nodes, {});
    return this.computeStats(nodes, edges);
  }

  /**
   * Clear internal caches.
   */
  clearCache(): void {
    this.nodeCache.clear();
    this.lastCacheUpdate = 0;
  }

  // Private methods

  private async loadNodes(options: GraphLoadOptions): Promise<GraphNode[]> {
    const includeArchived = options.includeArchived ?? this.config.includeArchivedByDefault;
    const limit = options.limit ?? this.config.maxLimit;
    const offset = options.offset ?? 0;

    // Get all subjects that have an Instance_class (these are our assets)
    const classTriples = await this.tripleStore.match(undefined, PREDICATES.INSTANCE_CLASS, undefined);

    // Filter by class if specified
    let filteredTriples = classTriples;
    if (options.classes && options.classes.length > 0) {
      const classSet = new Set(options.classes);
      filteredTriples = classTriples.filter(triple => {
        const classValue = this.getObjectValue(triple.object);
        return classValue && classSet.has(classValue);
      });
    }

    // Get unique subjects
    const subjects = new Set<string>();
    for (const triple of filteredTriples) {
      subjects.add(this.subjectToId(triple.subject));
    }

    // Apply pagination
    const subjectArray = Array.from(subjects);
    const pagedSubjects = subjectArray.slice(offset, offset + limit);

    // Load nodes in parallel for performance
    const nodePromises = pagedSubjects.map(id => this.getNodeById(id, options));
    const nodesOrNull = await Promise.all(nodePromises);

    // Filter out nulls and archived if needed
    const nodes = nodesOrNull.filter((node): node is GraphNode => {
      if (!node) return false;
      if (!includeArchived && node.isArchived) return false;
      return true;
    });

    return nodes;
  }

  private async loadEdges(nodes: GraphNode[], options: GraphLoadOptions): Promise<GraphEdge[]> {
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges: GraphEdge[] = [];
    const seenEdges = new Set<string>();

    for (const node of nodes) {
      const subjectIRI = this.idToIRI(node.id);

      // Get all outgoing relationships
      const outgoingTriples = await this.tripleStore.match(subjectIRI, undefined, undefined);

      for (const triple of outgoingTriples) {
        const edge = this.tripleToEdge(node.id, triple, nodeIds);
        if (edge && !seenEdges.has(edge.id!)) {
          // Filter by edge type if specified
          if (!options.edgeTypes || options.edgeTypes.includes(edge.type)) {
            seenEdges.add(edge.id!);
            edges.push(edge);
          }
        }
      }
    }

    return edges;
  }

  private async getConnectedNodeIds(nodeId: string): Promise<string[]> {
    const subjectIRI = this.idToIRI(nodeId);
    const connectedIds: string[] = [];

    // Get outgoing connections
    const outgoing = await this.tripleStore.match(subjectIRI, undefined, undefined);
    for (const triple of outgoing) {
      const targetId = this.objectToId(triple.object);
      if (targetId) {
        connectedIds.push(targetId);
      }
    }

    // Get incoming connections (backlinks)
    const incoming = await this.tripleStore.match(undefined, undefined, subjectIRI);
    for (const triple of incoming) {
      connectedIds.push(this.subjectToId(triple.subject));
    }

    return [...new Set(connectedIds)];
  }

  private triplesToNode(id: string, triples: Triple[], options: GraphLoadOptions): GraphNode | null {
    const properties: Record<string, unknown> = {};
    let assetClass: string | undefined;
    let label: string | undefined;
    let prototype: string | undefined;
    let parent: string | undefined;
    let isArchived = false;

    for (const triple of triples) {
      const predicateUri = triple.predicate.value;
      const value = this.getObjectValue(triple.object);

      if (predicateUri === PREDICATES.INSTANCE_CLASS.value) {
        assetClass = value;
      } else if (predicateUri === PREDICATES.ASSET_LABEL.value) {
        label = value;
      } else if (predicateUri === PREDICATES.ASSET_PROTOTYPE.value) {
        prototype = this.objectToId(triple.object) ?? value;
      } else if (predicateUri === PREDICATES.EFFORT_PARENT.value) {
        parent = this.objectToId(triple.object) ?? value;
      } else if (predicateUri === PREDICATES.ASSET_IS_ARCHIVED.value) {
        isArchived = value === "true" || value === "1";
      } else {
        // Store other properties
        const propName = this.predicateToPropertyName(predicateUri);
        if (propName) {
          properties[propName] = value;
        }
      }
    }

    // Skip archived nodes unless requested
    if (isArchived && !(options.includeArchived ?? this.config.includeArchivedByDefault)) {
      return null;
    }

    const path = this.idToPath(id);
    const title = label ?? this.pathToTitle(path);

    return {
      id,
      path,
      title,
      label: title,
      assetClass,
      isArchived,
      uri: id.startsWith("http") ? id : undefined,
      prototype,
      parent,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
    };
  }

  private tripleToEdge(sourceId: string, triple: Triple, nodeIds: Set<string>): GraphEdge | null {
    const predicateUri = triple.predicate.value;
    const targetId = this.objectToId(triple.object);

    // Skip if target is not a node or is the same as source
    if (!targetId || !nodeIds.has(targetId) || targetId === sourceId) {
      return null;
    }

    // Determine edge type from predicate
    const type = this.predicateToEdgeType(predicateUri);
    if (!type) {
      return null;
    }

    const id = createEdgeId(sourceId, targetId, type, predicateUri);
    const label = this.predicateToLabel(predicateUri);

    return {
      id,
      source: sourceId,
      target: targetId,
      type,
      predicate: predicateUri,
      label,
    };
  }

  private predicateToEdgeType(predicateUri: string): GraphEdgeType | null {
    if (predicateUri === PREDICATES.EFFORT_PARENT.value) {
      return "hierarchy";
    }
    if (predicateUri === PREDICATES.ASSET_PROTOTYPE.value) {
      return "prototype";
    }
    if (predicateUri === PREDICATES.REFERENCES.value) {
      return "forward-link";
    }
    if (predicateUri === PREDICATES.REFERENCED_BY.value) {
      return "backlink";
    }

    // Skip non-relationship predicates
    if (predicateUri.includes("Asset_") || predicateUri.includes("Instance_")) {
      return null;
    }

    return "semantic";
  }

  private predicateToLabel(predicateUri: string): string {
    // Extract local name from URI
    const hashIndex = predicateUri.lastIndexOf("#");
    const slashIndex = predicateUri.lastIndexOf("/");
    const separatorIndex = Math.max(hashIndex, slashIndex);

    if (separatorIndex >= 0) {
      return predicateUri.substring(separatorIndex + 1);
    }
    return predicateUri;
  }

  private predicateToPropertyName(predicateUri: string): string | null {
    const label = this.predicateToLabel(predicateUri);
    // Convert from URI local name to property name
    return label.replace(/_/g, "__").replace(/#/g, "_");
  }

  private computeStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
    const nodesByClass: Record<string, number> = {};
    const edgesByType: Record<GraphEdgeType, number> = {
      "backlink": 0,
      "forward-link": 0,
      "hierarchy": 0,
      "prototype": 0,
      "semantic": 0,
      "reference": 0,
    };

    for (const node of nodes) {
      const cls = node.assetClass ?? "unknown";
      nodesByClass[cls] = (nodesByClass[cls] ?? 0) + 1;
    }

    for (const edge of edges) {
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
    }

    // Calculate in/out degrees
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (const edge of edges) {
      outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    // Update node degrees
    for (const node of nodes) {
      node.inDegree = inDegree.get(node.id) ?? 0;
      node.outDegree = outDegree.get(node.id) ?? 0;
      node.weight = node.inDegree + node.outDegree;
    }

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByClass,
      edgesByType,
      computedAt: Date.now(),
    };
  }

  // Helper methods for ID/URI conversion

  private idToIRI(id: string): IRI {
    if (id.startsWith("http://") || id.startsWith("https://")) {
      return new IRI(id);
    }
    // Convert path to obsidian:// URI
    return new IRI(`obsidian://vault/${encodeURIComponent(id)}`);
  }

  private subjectToId(subject: Subject): string {
    if (subject instanceof IRI) {
      const uri = subject.value;
      // Convert obsidian:// URI back to path
      if (uri.startsWith("obsidian://vault/")) {
        return decodeURIComponent(uri.replace("obsidian://vault/", ""));
      }
      return uri;
    }
    return subject.toString();
  }

  private objectToId(object: RDFObject): string | null {
    if (object instanceof IRI) {
      const uri = object.value;
      if (uri.startsWith("obsidian://vault/")) {
        return decodeURIComponent(uri.replace("obsidian://vault/", ""));
      }
      return uri;
    }
    return null;
  }

  private getObjectValue(object: RDFObject): string | undefined {
    if (object instanceof Literal) {
      return object.value;
    }
    if (object instanceof IRI) {
      return object.value;
    }
    return undefined;
  }

  private idToPath(id: string): string {
    if (id.startsWith("obsidian://vault/")) {
      return decodeURIComponent(id.replace("obsidian://vault/", ""));
    }
    if (id.startsWith("http://") || id.startsWith("https://")) {
      // Extract path from URI
      const match = id.match(/\/([^/]+\.md)$/);
      if (match) {
        return match[1];
      }
    }
    return id;
  }

  private pathToTitle(path: string): string {
    // Remove .md extension and get basename
    const basename = path.split("/").pop() ?? path;
    return basename.replace(/\.md$/, "");
  }

  // Cache methods

  private getCachedNode(id: string): GraphNodeData | null {
    if (Date.now() - this.lastCacheUpdate > this.config.cacheTTL) {
      this.clearCache();
      return null;
    }
    return this.nodeCache.get(id) ?? null;
  }

  private cacheNode(node: GraphNodeData): void {
    this.nodeCache.set(node.id, node);
    if (this.lastCacheUpdate === 0) {
      this.lastCacheUpdate = Date.now();
    }
  }

  private invalidateCache(): void {
    this.clearCache();
  }
}
