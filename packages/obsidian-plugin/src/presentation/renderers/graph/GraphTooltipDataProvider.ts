/**
 * GraphTooltipDataProvider - Triple store integration for tooltip data
 *
 * Provides tooltip data for graph nodes and edges by querying the triple store.
 * Extracts metadata, relationships, and content previews for rich tooltip display.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type {
  TooltipDataProvider,
  TooltipData,
  NodeType,
  PropertyValue,
} from "./HoverManager";
import type { GraphNode, GraphEdge } from "./types";

/**
 * Triple store interface for querying RDF data
 */
export interface TripleStore {
  /**
   * Query triples by subject
   */
  getBySubject(subject: string): Array<{ predicate: string; object: string }>;

  /**
   * Query triples by predicate and object
   */
  getByPredicateObject(predicate: string, object: string): Array<{ subject: string }>;

  /**
   * Count triples where subject has the given predicate
   */
  countBySubjectPredicate(subject: string, predicate: string): number;
}

/**
 * File content provider for previews
 */
export interface FileContentProvider {
  /**
   * Get the content of a file for preview
   *
   * @param path - File path
   * @returns File content or null if not available
   */
  getContent(path: string): Promise<string | null>;
}

/**
 * Configuration for GraphTooltipDataProvider
 */
export interface GraphTooltipDataProviderConfig {
  /** Maximum number of properties to fetch (default: 10) */
  maxProperties: number;
  /** Maximum preview content length in characters (default: 500) */
  maxPreviewLength: number;
  /** Properties to exclude from display */
  excludedProperties: string[];
  /** Property display name mapping */
  propertyLabels: Record<string, string>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: GraphTooltipDataProviderConfig = {
  maxProperties: 10,
  maxPreviewLength: 500,
  excludedProperties: [
    "exo:Instance_class",
    "exo:Asset_uid",
    "exo:Asset_createdAt",
    "exo:Asset_modifiedAt",
  ],
  propertyLabels: {
    "exo:Asset_label": "Label",
    "ems:Effort_status": "Status",
    "ems:Effort_priority": "Priority",
    "ems:Effort_parent": "Parent",
    "ems:Task_estimatedDuration": "Duration",
    "ems:Effort_startTimestamp": "Started",
    "ems:Effort_endTimestamp": "Ended",
    "ems:Effort_area": "Area",
    "ims:Person_role": "Role",
    "ims:Person_organization": "Organization",
  },
};

/**
 * Ontology class to NodeType mapping
 */
const CLASS_TO_TYPE: Record<string, NodeType> = {
  "ems__Task": "task",
  "ems__Project": "project",
  "ems__Area": "area",
  "ims__Person": "person",
  "ims__Concept": "concept",
  "exo__Asset": "asset",
};

/**
 * Extract the local name from a URI
 */
function getLocalName(uri: string): string {
  // Handle wikilinks [[name]]
  const wikilinkMatch = uri.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  if (wikilinkMatch) {
    const path = wikilinkMatch[1];
    const parts = path.split("/");
    return parts[parts.length - 1].replace(/\.md$/, "");
  }

  // Handle URIs with hash or slash
  const hashIndex = uri.lastIndexOf("#");
  if (hashIndex !== -1) {
    return uri.slice(hashIndex + 1);
  }

  const slashIndex = uri.lastIndexOf("/");
  if (slashIndex !== -1) {
    return uri.slice(slashIndex + 1).replace(/\.md$/, "");
  }

  return uri;
}

/**
 * Format a property value for display
 */
function formatPropertyValue(value: string): string {
  // Handle wikilinks
  const wikilinkMatch = value.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (wikilinkMatch) {
    return wikilinkMatch[2] || getLocalName(wikilinkMatch[1]);
  }

  // Handle URIs
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("obsidian://")) {
    return getLocalName(value);
  }

  // Handle timestamps
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    try {
      const date = new Date(value);
      return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return value;
    }
  }

  // Handle JS date format
  if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4}/.test(value)) {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Get property display name
 */
function getPropertyDisplayName(predicate: string, config: GraphTooltipDataProviderConfig): string {
  // Check custom labels first
  if (config.propertyLabels[predicate]) {
    return config.propertyLabels[predicate];
  }

  // Extract local name and format
  const localName = getLocalName(predicate);

  // Remove common prefixes and format
  const formatted = localName
    .replace(/^(Asset_|Effort_|Task_|Person_|Project_|Area_|Concept_)/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * GraphTooltipDataProvider - Provides tooltip data from triple store
 *
 * @example
 * ```typescript
 * const provider = new GraphTooltipDataProvider({
 *   tripleStore: myTripleStore,
 *   fileContentProvider: myFileProvider,
 * });
 *
 * // Set node/edge data for lookups
 * provider.setNodes(nodes);
 * provider.setEdges(edges);
 *
 * // Get tooltip data
 * const data = await provider.getTooltipData("node1", "node");
 * ```
 */
export class GraphTooltipDataProvider implements TooltipDataProvider {
  private config: GraphTooltipDataProviderConfig;
  private tripleStore: TripleStore | null = null;
  private fileContentProvider: FileContentProvider | null = null;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private nodeToEdges: Map<string, { incoming: GraphEdge[]; outgoing: GraphEdge[] }> = new Map();

  constructor(options?: {
    config?: Partial<GraphTooltipDataProviderConfig>;
    tripleStore?: TripleStore;
    fileContentProvider?: FileContentProvider;
  }) {
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
    this.tripleStore = options?.tripleStore ?? null;
    this.fileContentProvider = options?.fileContentProvider ?? null;
  }

  /**
   * Set the triple store
   */
  setTripleStore(tripleStore: TripleStore): void {
    this.tripleStore = tripleStore;
  }

  /**
   * Set the file content provider
   */
  setFileContentProvider(provider: FileContentProvider): void {
    this.fileContentProvider = provider;
  }

  /**
   * Set nodes and build lookup maps
   */
  setNodes(nodes: GraphNode[]): void {
    this.nodes.clear();
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
    this.buildEdgeLookup();
  }

  /**
   * Set edges and build lookup maps
   */
  setEdges(edges: GraphEdge[]): void {
    this.edges.clear();
    for (const edge of edges) {
      this.edges.set(edge.id, edge);
    }
    this.buildEdgeLookup();
  }

  /**
   * Build edge lookup maps for relationship counting
   */
  private buildEdgeLookup(): void {
    this.nodeToEdges.clear();

    for (const edge of this.edges.values()) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      // Add to source node (outgoing)
      let sourceData = this.nodeToEdges.get(sourceId);
      if (!sourceData) {
        sourceData = { incoming: [], outgoing: [] };
        this.nodeToEdges.set(sourceId, sourceData);
      }
      sourceData.outgoing.push(edge);

      // Add to target node (incoming)
      let targetData = this.nodeToEdges.get(targetId);
      if (!targetData) {
        targetData = { incoming: [], outgoing: [] };
        this.nodeToEdges.set(targetId, targetData);
      }
      targetData.incoming.push(edge);
    }
  }

  /**
   * Get tooltip data for a node or edge
   */
  async getTooltipData(id: string, type: "node" | "edge"): Promise<TooltipData> {
    if (type === "node") {
      return this.getNodeTooltipData(id);
    } else {
      return this.getEdgeTooltipData(id);
    }
  }

  /**
   * Get tooltip data for a node
   */
  private async getNodeTooltipData(nodeId: string): Promise<TooltipData> {
    const node = this.nodes.get(nodeId);

    if (!node) {
      return {
        id: nodeId,
        title: nodeId,
        type: "unknown",
        properties: [],
        incomingCount: 0,
        outgoingCount: 0,
      };
    }

    // Get node type from metadata or triple store
    const nodeType = this.getNodeType(node);

    // Get properties from triple store
    const properties = await this.getNodeProperties(node);

    // Get relationship counts
    const edgeData = this.nodeToEdges.get(nodeId);
    const incomingCount = edgeData?.incoming.length ?? 0;
    const outgoingCount = edgeData?.outgoing.length ?? 0;

    // Get content preview
    const preview = await this.getContentPreview(node.path);

    return {
      id: nodeId,
      title: node.label,
      type: nodeType,
      properties,
      incomingCount,
      outgoingCount,
      preview,
      path: node.path,
    };
  }

  /**
   * Get tooltip data for an edge
   */
  private async getEdgeTooltipData(edgeId: string): Promise<TooltipData> {
    const edge = this.edges.get(edgeId);

    if (!edge) {
      return {
        id: edgeId,
        title: edgeId,
        type: "unknown",
        properties: [],
        incomingCount: 0,
        outgoingCount: 0,
      };
    }

    const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

    const sourceNode = this.nodes.get(sourceId);
    const targetNode = this.nodes.get(targetId);

    const properties: PropertyValue[] = [];

    // Add source and target as properties
    if (sourceNode) {
      properties.push({
        name: "From",
        value: sourceNode.label,
        uri: sourceNode.path,
      });
    }

    if (targetNode) {
      properties.push({
        name: "To",
        value: targetNode.label,
        uri: targetNode.path,
      });
    }

    // Add property type
    if (edge.property) {
      properties.push({
        name: "Relation",
        value: getPropertyDisplayName(edge.property, this.config),
      });
    }

    // Add weight if present
    if (edge.weight !== undefined) {
      properties.push({
        name: "Weight",
        value: String(edge.weight),
      });
    }

    return {
      id: edgeId,
      title: edge.label || getLocalName(edge.property || "Relation"),
      type: "asset", // Edges are generic
      properties,
      incomingCount: 0,
      outgoingCount: 0,
    };
  }

  /**
   * Get node type from metadata or ontology class
   */
  private getNodeType(node: GraphNode): NodeType {
    // Check node group first
    if (node.group) {
      const typeFromGroup = CLASS_TO_TYPE[node.group];
      if (typeFromGroup) {
        return typeFromGroup;
      }
    }

    // Check metadata
    if (node.metadata) {
      const instanceClass = node.metadata["exo:Instance_class"] as string | undefined;
      if (instanceClass) {
        const className = getLocalName(instanceClass);
        const typeFromClass = CLASS_TO_TYPE[className];
        if (typeFromClass) {
          return typeFromClass;
        }
      }
    }

    // Try to get from triple store
    if (this.tripleStore) {
      const triples = this.tripleStore.getBySubject(node.id);
      for (const triple of triples) {
        if (triple.predicate.includes("Instance_class")) {
          const className = getLocalName(triple.object);
          const typeFromClass = CLASS_TO_TYPE[className];
          if (typeFromClass) {
            return typeFromClass;
          }
        }
      }
    }

    return "asset";
  }

  /**
   * Get properties from triple store
   */
  private async getNodeProperties(node: GraphNode): Promise<PropertyValue[]> {
    const properties: PropertyValue[] = [];

    // Use metadata first if available
    if (node.metadata) {
      for (const [key, value] of Object.entries(node.metadata)) {
        if (this.config.excludedProperties.some((p) => key.includes(p) || key.includes(getLocalName(p)))) {
          continue;
        }

        const displayName = getPropertyDisplayName(key, this.config);
        const displayValue = formatPropertyValue(String(value));

        properties.push({
          name: displayName,
          value: displayValue,
        });

        if (properties.length >= this.config.maxProperties) {
          break;
        }
      }
    }

    // Add from triple store if available and we have room for more
    if (this.tripleStore && properties.length < this.config.maxProperties) {
      const triples = this.tripleStore.getBySubject(node.id);

      for (const triple of triples) {
        if (properties.length >= this.config.maxProperties) {
          break;
        }

        // Skip excluded properties
        if (this.config.excludedProperties.some((p) => triple.predicate.includes(getLocalName(p)))) {
          continue;
        }

        // Skip if already added from metadata
        const displayName = getPropertyDisplayName(triple.predicate, this.config);
        if (properties.some((p) => p.name === displayName)) {
          continue;
        }

        const displayValue = formatPropertyValue(triple.object);

        properties.push({
          name: displayName,
          value: displayValue,
        });
      }
    }

    return properties;
  }

  /**
   * Get content preview from file
   */
  private async getContentPreview(path: string): Promise<string | undefined> {
    if (!this.fileContentProvider) {
      return undefined;
    }

    try {
      const content = await this.fileContentProvider.getContent(path);
      if (!content) {
        return undefined;
      }

      // Remove frontmatter
      let text = content;
      const frontmatterMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
      if (frontmatterMatch) {
        text = content.slice(frontmatterMatch[0].length);
      }

      // Remove markdown formatting
      text = text
        .replace(/^#+\s+/gm, "") // Remove headers
        .replace(/\*\*([^*]+)\*\*/g, "$1") // Remove bold
        .replace(/\*([^*]+)\*/g, "$1") // Remove italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove links
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, path, label) => label || getLocalName(path)) // Remove wikilinks
        .replace(/`([^`]+)`/g, "$1") // Remove inline code
        .replace(/```[\s\S]*?```/g, "") // Remove code blocks
        .replace(/^\s*[-*+]\s+/gm, "• ") // Simplify lists
        .replace(/^\s*\d+\.\s+/gm, "") // Remove numbered lists
        .replace(/\n{3,}/g, "\n\n") // Collapse multiple newlines
        .trim();

      if (text.length > this.config.maxPreviewLength) {
        text = text.slice(0, this.config.maxPreviewLength);
        // Try to break at word boundary
        const lastSpace = text.lastIndexOf(" ");
        if (lastSpace > this.config.maxPreviewLength - 50) {
          text = text.slice(0, lastSpace);
        }
        text += "...";
      }

      return text || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<GraphTooltipDataProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): GraphTooltipDataProviderConfig {
    return { ...this.config };
  }

  /**
   * Destroy and release resources
   */
  destroy(): void {
    this.nodes.clear();
    this.edges.clear();
    this.nodeToEdges.clear();
    this.tripleStore = null;
    this.fileContentProvider = null;
  }
}

/**
 * Default GraphTooltipDataProvider configuration
 */
export const DEFAULT_GRAPH_TOOLTIP_PROVIDER_CONFIG = DEFAULT_CONFIG;
