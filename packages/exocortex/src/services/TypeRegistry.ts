/**
 * Registry for managing graph node and edge type definitions.
 * Provides type lookup, inheritance resolution, and style merging.
 */

import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { BlankNode } from "../domain/models/rdf/BlankNode";
import { Literal } from "../domain/models/rdf/Literal";
import type { Subject, Object as RDFObject } from "../domain/models/rdf/Triple";
import {
  NodeTypeDefinition,
  EdgeTypeDefinition,
  NodeStyle,
  EdgeStyle,
  NodeTypeInfo,
  EdgeTypeInfo,
  TypeSource,
  TypeFilter,
  TypeGrouping,
  TypeGroup,
  TypeValidationResult,
  TypeValidationError,
  TypeValidationWarning,
  TypeRegistryEvent,
  TypeRegistryEventCallback,
  StyleResolutionOptions,
  RDF_TYPE_PREDICATES,
  DEFAULT_NODE_STYLE,
  DEFAULT_EDGE_STYLE,
  BUILT_IN_NODE_STYLES,
  BUILT_IN_EDGE_STYLES,
  mergeNodeStyles,
  mergeEdgeStyles,
  extractLocalName,
  isClassType,
} from "../domain/models/GraphTypes";
import type { GraphNode } from "../domain/models/GraphNode";
import type { GraphEdge } from "../domain/models/GraphEdge";

/**
 * Configuration for TypeRegistry.
 */
export interface TypeRegistryConfig {
  /** Auto-register types from triple store on first query */
  autoDiscoverTypes?: boolean;
  /** Include built-in styles */
  includeBuiltInStyles?: boolean;
  /** Default style resolution options */
  styleResolution?: StyleResolutionOptions;
  /** Maximum inheritance depth for type hierarchy */
  maxInheritanceDepth?: number;
}

/**
 * Registry for managing graph type definitions.
 */
export class TypeRegistry {
  private readonly tripleStore: ITripleStore | null;
  private readonly config: Required<TypeRegistryConfig>;
  private readonly nodeTypes: Map<string, NodeTypeDefinition> = new Map();
  private readonly edgeTypes: Map<string, EdgeTypeDefinition> = new Map();
  private readonly typeHierarchy: Map<string, string[]> = new Map(); // type -> parent types
  private readonly subscribers: Set<TypeRegistryEventCallback> = new Set();
  private discoveryComplete: boolean = false;

  constructor(tripleStore: ITripleStore | null = null, config: TypeRegistryConfig = {}) {
    this.tripleStore = tripleStore;
    this.config = {
      autoDiscoverTypes: config.autoDiscoverTypes ?? true,
      includeBuiltInStyles: config.includeBuiltInStyles ?? true,
      styleResolution: config.styleResolution ?? {
        mergeStyles: true,
        inheritParentStyles: true,
        defaultNodeStyle: DEFAULT_NODE_STYLE,
        defaultEdgeStyle: DEFAULT_EDGE_STYLE,
      },
      maxInheritanceDepth: config.maxInheritanceDepth ?? 10,
    };

    if (this.config.includeBuiltInStyles) {
      this.registerBuiltInTypes();
    }
  }

  /**
   * Register a node type definition.
   */
  registerNodeType(definition: NodeTypeDefinition): void {
    const existing = this.nodeTypes.get(definition.uri);
    const eventType = existing ? "type-updated" : "type-added";

    this.nodeTypes.set(definition.uri, definition);

    // Update hierarchy if parent types specified
    if (definition.parentTypes && definition.parentTypes.length > 0) {
      this.typeHierarchy.set(definition.uri, definition.parentTypes);
    }

    this.emit({ type: eventType, typeUri: definition.uri, definition });
  }

  /**
   * Register an edge type definition.
   */
  registerEdgeType(definition: EdgeTypeDefinition): void {
    const existing = this.edgeTypes.get(definition.uri);
    const eventType = existing ? "type-updated" : "type-added";

    this.edgeTypes.set(definition.uri, definition);
    this.emit({ type: eventType, typeUri: definition.uri, definition });
  }

  /**
   * Unregister a type.
   */
  unregisterType(uri: string): void {
    const wasNode = this.nodeTypes.delete(uri);
    const wasEdge = this.edgeTypes.delete(uri);
    this.typeHierarchy.delete(uri);

    if (wasNode || wasEdge) {
      this.emit({ type: "type-removed", typeUri: uri });
    }
  }

  /**
   * Get a node type definition by URI.
   */
  getNodeType(uri: string): NodeTypeDefinition | undefined {
    return this.nodeTypes.get(uri);
  }

  /**
   * Get an edge type definition by URI.
   */
  getEdgeType(uri: string): EdgeTypeDefinition | undefined {
    return this.edgeTypes.get(uri);
  }

  /**
   * Get all registered node types.
   */
  getAllNodeTypes(): NodeTypeDefinition[] {
    return Array.from(this.nodeTypes.values());
  }

  /**
   * Get all registered edge types.
   */
  getAllEdgeTypes(): EdgeTypeDefinition[] {
    return Array.from(this.edgeTypes.values());
  }

  /**
   * Get parent types for a type (direct and inherited).
   * @param typeUri The type URI to get parents for
   * @param depth Maximum depth of inheritance to traverse (1 = direct parents only)
   */
  getParentTypes(typeUri: string, depth: number = this.config.maxInheritanceDepth): string[] {
    const parents: string[] = [];
    const visited = new Set<string>();
    const queue: Array<{ uri: string; currentDepth: number }> = [{ uri: typeUri, currentDepth: 0 }];

    while (queue.length > 0) {
      const { uri, currentDepth } = queue.shift()!;

      if (visited.has(uri)) continue;
      visited.add(uri);

      // Only traverse children if we haven't exceeded depth
      if (currentDepth >= depth) continue;

      const directParents = this.typeHierarchy.get(uri) ?? [];
      for (const parent of directParents) {
        if (!visited.has(parent)) {
          parents.push(parent);
          queue.push({ uri: parent, currentDepth: currentDepth + 1 });
        }
      }
    }

    return parents;
  }

  /**
   * Get child types for a type (direct descendants).
   */
  getChildTypes(typeUri: string): string[] {
    const children: string[] = [];
    for (const [uri, parents] of this.typeHierarchy) {
      if (parents.includes(typeUri)) {
        children.push(uri);
      }
    }
    return children;
  }

  /**
   * Check if typeA is a subtype of typeB.
   */
  isSubtypeOf(typeA: string, typeB: string): boolean {
    if (typeA === typeB) return true;
    const parents = this.getParentTypes(typeA);
    return parents.includes(typeB);
  }

  /**
   * Resolve type information for a graph node.
   */
  resolveNodeType(node: GraphNode): NodeTypeInfo {
    const types: string[] = [];
    let primaryType: string = "unknown";
    let source: TypeSource = "custom";

    // Get type from assetClass (exo:Instance_class)
    if (node.assetClass) {
      const normalizedClass = this.normalizeTypeUri(node.assetClass);
      types.push(normalizedClass);
      primaryType = normalizedClass;
      source = "exo:Instance_class";
    }

    // Get rdf:type from properties
    const rdfType = node.properties?.[RDF_TYPE_PREDICATES.RDF_TYPE] as string | undefined;
    if (rdfType && !types.includes(rdfType)) {
      types.push(rdfType);
      if (primaryType === "unknown") {
        primaryType = rdfType;
        source = "rdf:type";
      }
    }

    // Add inferred parent types
    for (const type of [...types]) {
      const parents = this.getParentTypes(type);
      for (const parent of parents) {
        if (!types.includes(parent)) {
          types.push(parent);
        }
      }
    }

    // Resolve style
    const resolvedStyle = this.resolveNodeStyle(types);

    return {
      primaryType,
      types,
      resolvedStyle,
      source,
    };
  }

  /**
   * Resolve type information for a graph edge.
   */
  resolveEdgeType(edge: GraphEdge): EdgeTypeInfo {
    const predicateUri = edge.predicate ?? edge.type;
    const source: TypeSource = edge.predicate ? "rdf:type" : "custom";

    const resolvedStyle = this.resolveEdgeStyle(predicateUri);

    return {
      primaryType: predicateUri,
      resolvedStyle,
      source,
    };
  }

  /**
   * Resolve node style from a list of types.
   */
  resolveNodeStyle(types: string[]): NodeStyle {
    const { mergeStyles, defaultNodeStyle } = this.config.styleResolution;
    let style: NodeStyle = { ...defaultNodeStyle };

    // Get all type definitions sorted by priority
    const definitions: NodeTypeDefinition[] = [];
    for (const type of types) {
      const def = this.nodeTypes.get(type);
      if (def) {
        definitions.push(def);
      }
    }

    // Sort by priority (lower first, so higher priority overwrites)
    definitions.sort((a, b) => a.priority - b.priority);

    if (mergeStyles) {
      // Merge all styles
      for (const def of definitions) {
        style = mergeNodeStyles(style, def.style);
      }
    } else if (definitions.length > 0) {
      // Use highest priority only
      const highest = definitions[definitions.length - 1];
      style = mergeNodeStyles(style, highest.style);
    }

    return style;
  }

  /**
   * Resolve edge style from a predicate URI.
   */
  resolveEdgeStyle(predicateUri: string): EdgeStyle {
    const { defaultEdgeStyle } = this.config.styleResolution;
    let style: EdgeStyle = { ...defaultEdgeStyle };

    const def = this.edgeTypes.get(predicateUri);
    if (def) {
      style = mergeEdgeStyles(style, def.style);
    }

    return style;
  }

  /**
   * Filter nodes by type.
   */
  filterNodes(nodes: GraphNode[], filter: TypeFilter): GraphNode[] {
    return nodes.filter(node => {
      const typeInfo = this.resolveNodeType(node);

      // Check include filter
      if (filter.includeNodeTypes && filter.includeNodeTypes.length > 0) {
        const matches = filter.includeNodeTypes.some(t =>
          typeInfo.types.includes(t) ||
          (filter.includeInferred && this.isSubtypeOf(typeInfo.primaryType, t))
        );
        if (!matches) return false;
      }

      // Check exclude filter
      if (filter.excludeNodeTypes && filter.excludeNodeTypes.length > 0) {
        const matches = filter.excludeNodeTypes.some(t =>
          typeInfo.types.includes(t) ||
          (filter.includeInferred && this.isSubtypeOf(typeInfo.primaryType, t))
        );
        if (matches) return false;
      }

      // Check deprecated
      if (!filter.includeDeprecated) {
        const def = this.nodeTypes.get(typeInfo.primaryType);
        if (def?.deprecated) return false;
      }

      return true;
    });
  }

  /**
   * Filter edges by type.
   */
  filterEdges(edges: GraphEdge[], filter: TypeFilter): GraphEdge[] {
    return edges.filter(edge => {
      const predicateUri = edge.predicate ?? edge.type;

      // Check include filter
      if (filter.includeEdgeTypes && filter.includeEdgeTypes.length > 0) {
        if (!filter.includeEdgeTypes.includes(predicateUri)) {
          return false;
        }
      }

      // Check exclude filter
      if (filter.excludeEdgeTypes && filter.excludeEdgeTypes.length > 0) {
        if (filter.excludeEdgeTypes.includes(predicateUri)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Group nodes by type.
   */
  groupNodesByType(
    nodes: GraphNode[],
    edges: GraphEdge[],
    grouping: TypeGrouping = {}
  ): TypeGroup[] {
    const {
      groupByNodeType = true,
      groupByParentType = false,
      groupLevel = 0,
      maxGroups = 20,
      customGroupFn,
    } = grouping;

    const groups = new Map<string, { nodeIds: Set<string>; label: string }>();

    for (const node of nodes) {
      const typeInfo = this.resolveNodeType(node);

      let groupId: string;
      if (customGroupFn) {
        groupId = customGroupFn(typeInfo.types);
      } else if (groupByParentType && typeInfo.types.length > groupLevel) {
        groupId = typeInfo.types[groupLevel] ?? typeInfo.primaryType;
      } else if (groupByNodeType) {
        groupId = typeInfo.primaryType;
      } else {
        groupId = "all";
      }

      if (!groups.has(groupId)) {
        const def = this.nodeTypes.get(groupId);
        const label = def?.label ?? extractLocalName(groupId);
        groups.set(groupId, { nodeIds: new Set(), label });
      }
      groups.get(groupId)!.nodeIds.add(node.id);
    }

    // Limit groups if needed
    let groupArray = Array.from(groups.entries()).map(([id, data]) => ({
      id,
      label: data.label,
      nodeIds: Array.from(data.nodeIds),
    }));

    if (groupArray.length > maxGroups) {
      // Sort by size and keep top N
      groupArray.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
      const topGroups = groupArray.slice(0, maxGroups - 1);
      const otherNodes = groupArray.slice(maxGroups - 1).flatMap(g => g.nodeIds);
      topGroups.push({ id: "other", label: "Other", nodeIds: otherNodes });
      groupArray = topGroups;
    }

    // Calculate edge statistics for each group
    const nodeToGroup = new Map<string, string>();
    for (const group of groupArray) {
      for (const nodeId of group.nodeIds) {
        nodeToGroup.set(nodeId, group.id);
      }
    }

    return groupArray.map((g, index) => {
      const nodeIdSet = new Set(g.nodeIds);
      const internalEdgeIds: string[] = [];
      const externalEdgeIds: string[] = [];

      for (const edge of edges) {
        const sourceInGroup = nodeIdSet.has(edge.source);
        const targetInGroup = nodeIdSet.has(edge.target);

        if (sourceInGroup && targetInGroup) {
          if (edge.id) internalEdgeIds.push(edge.id);
        } else if (sourceInGroup || targetInGroup) {
          if (edge.id) externalEdgeIds.push(edge.id);
        }
      }

      // Generate color based on index
      const hue = (index * 137.5) % 360; // Golden angle for good distribution
      const color = `hsl(${hue}, 70%, 50%)`;

      return {
        id: g.id,
        label: g.label,
        nodeIds: g.nodeIds,
        internalEdgeIds,
        externalEdgeIds,
        color,
        stats: {
          nodeCount: g.nodeIds.length,
          internalEdgeCount: internalEdgeIds.length,
          externalEdgeCount: externalEdgeIds.length,
        },
      };
    });
  }

  /**
   * Validate types for nodes and edges.
   */
  validateTypes(nodes: GraphNode[], edges: GraphEdge[]): TypeValidationResult {
    const errors: TypeValidationError[] = [];
    const warnings: TypeValidationWarning[] = [];

    // Validate node types
    for (const node of nodes) {
      const typeInfo = this.resolveNodeType(node);

      // Check if type is registered
      if (typeInfo.primaryType !== "unknown") {
        const def = this.nodeTypes.get(typeInfo.primaryType);
        if (!def && typeInfo.source !== "inferred") {
          warnings.push({
            code: "UNREGISTERED_NODE_TYPE",
            message: `Node type "${typeInfo.primaryType}" is not registered`,
            elementId: node.id,
            suggestion: `Register the type with registerNodeType()`,
          });
        }

        // Check for deprecated types
        if (def?.deprecated) {
          warnings.push({
            code: "DEPRECATED_NODE_TYPE",
            message: `Node uses deprecated type "${typeInfo.primaryType}"`,
            elementId: node.id,
            suggestion: `Migrate to a non-deprecated type`,
          });
        }
      } else {
        warnings.push({
          code: "MISSING_NODE_TYPE",
          message: `Node has no type information`,
          elementId: node.id,
          suggestion: `Add exo:Instance_class or rdf:type to the node`,
        });
      }
    }

    // Validate edge types
    for (const edge of edges) {
      const predicateUri = edge.predicate ?? edge.type;
      const def = this.edgeTypes.get(predicateUri);

      // Check domain/range constraints
      if (def?.domain && def.domain.length > 0) {
        const sourceNode = nodes.find(n => n.id === edge.source);
        if (sourceNode) {
          const sourceTypeInfo = this.resolveNodeType(sourceNode);
          const domainMatch = def.domain.some(d => sourceTypeInfo.types.includes(d));
          if (!domainMatch) {
            errors.push({
              code: "DOMAIN_VIOLATION",
              message: `Edge source does not match expected domain`,
              elementId: edge.id,
              expected: def.domain,
              actual: sourceTypeInfo.types,
            });
          }
        }
      }

      if (def?.range && def.range.length > 0) {
        const targetNode = nodes.find(n => n.id === edge.target);
        if (targetNode) {
          const targetTypeInfo = this.resolveNodeType(targetNode);
          const rangeMatch = def.range.some(r => targetTypeInfo.types.includes(r));
          if (!rangeMatch) {
            errors.push({
              code: "RANGE_VIOLATION",
              message: `Edge target does not match expected range`,
              elementId: edge.id,
              expected: def.range,
              actual: targetTypeInfo.types,
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Discover and register types from the triple store.
   */
  async discoverTypes(): Promise<void> {
    if (!this.tripleStore || this.discoveryComplete) return;

    // Find all rdfs:Class and owl:Class definitions
    const classTriples = await this.tripleStore.match(
      undefined,
      new IRI(RDF_TYPE_PREDICATES.RDF_TYPE),
      undefined
    );

    for (const triple of classTriples) {
      const typeUri = this.getObjectValue(triple.object);
      if (!typeUri) continue;

      if (isClassType(typeUri)) {
        // This is a class definition
        const classUri = this.getSubjectValue(triple.subject);
        if (classUri) {
          await this.discoverNodeType(classUri);
        }
      }
    }

    // Find subclass relationships for hierarchy
    const subClassTriples = await this.tripleStore.match(
      undefined,
      new IRI(RDF_TYPE_PREDICATES.RDFS_SUBCLASS_OF),
      undefined
    );

    for (const triple of subClassTriples) {
      const childUri = this.getSubjectValue(triple.subject);
      const parentUri = this.getObjectValue(triple.object);
      if (childUri && parentUri) {
        const existing = this.typeHierarchy.get(childUri) ?? [];
        if (!existing.includes(parentUri)) {
          existing.push(parentUri);
          this.typeHierarchy.set(childUri, existing);

          // Update node type definition if exists
          const def = this.nodeTypes.get(childUri);
          if (def) {
            def.parentTypes = existing;
          }
        }
      }
    }

    this.discoveryComplete = true;
    this.emit({ type: "hierarchy-updated", rootTypes: this.getRootTypes() });
  }

  /**
   * Subscribe to registry events.
   */
  subscribe(callback: TypeRegistryEventCallback): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Clear all registered types.
   */
  clear(): void {
    this.nodeTypes.clear();
    this.edgeTypes.clear();
    this.typeHierarchy.clear();
    this.discoveryComplete = false;

    if (this.config.includeBuiltInStyles) {
      this.registerBuiltInTypes();
    }
  }

  // Private methods

  private registerBuiltInTypes(): void {
    // Register built-in node types
    for (const [uri, style] of Object.entries(BUILT_IN_NODE_STYLES)) {
      this.nodeTypes.set(uri, {
        uri,
        label: extractLocalName(uri),
        source: "custom",
        style: mergeNodeStyles(DEFAULT_NODE_STYLE, style),
        priority: 1,
      });
    }

    // Register built-in edge types
    for (const [uri, style] of Object.entries(BUILT_IN_EDGE_STYLES)) {
      this.edgeTypes.set(uri, {
        uri,
        label: extractLocalName(uri),
        source: "custom",
        style: mergeEdgeStyles(DEFAULT_EDGE_STYLE, style),
        priority: 1,
      });
    }
  }

  private async discoverNodeType(classUri: string): Promise<void> {
    if (this.nodeTypes.has(classUri) || !this.tripleStore) return;

    // Get label and comment
    const labelTriples = await this.tripleStore.match(
      new IRI(classUri),
      new IRI(RDF_TYPE_PREDICATES.RDFS_LABEL),
      undefined
    );
    const commentTriples = await this.tripleStore.match(
      new IRI(classUri),
      new IRI(RDF_TYPE_PREDICATES.RDFS_COMMENT),
      undefined
    );

    const label = labelTriples.length > 0
      ? this.getObjectValue(labelTriples[0].object) ?? extractLocalName(classUri)
      : extractLocalName(classUri);

    const description = commentTriples.length > 0
      ? this.getObjectValue(commentTriples[0].object)
      : undefined;

    // Determine source
    let source: TypeSource = "rdfs:Class";
    const typeTriples = await this.tripleStore.match(
      new IRI(classUri),
      new IRI(RDF_TYPE_PREDICATES.RDF_TYPE),
      undefined
    );
    for (const t of typeTriples) {
      const typeValue = this.getObjectValue(t.object);
      if (typeValue === RDF_TYPE_PREDICATES.OWL_CLASS) {
        source = "owl:Class";
        break;
      }
    }

    // Get built-in style if available
    const builtInStyle = BUILT_IN_NODE_STYLES[classUri] ?? BUILT_IN_NODE_STYLES[extractLocalName(classUri)];

    const definition: NodeTypeDefinition = {
      uri: classUri,
      label,
      description,
      source,
      style: mergeNodeStyles(DEFAULT_NODE_STYLE, builtInStyle ?? {}),
      priority: 1,
    };

    this.registerNodeType(definition);
  }

  private normalizeTypeUri(typeValue: string): string {
    // Handle wiki-link format [[ems__Task]]
    const wikiLinkMatch = typeValue.match(/^\[\[(.+?)\]\]$/);
    if (wikiLinkMatch) {
      return wikiLinkMatch[1];
    }
    return typeValue;
  }

  private getSubjectValue(subject: Subject): string | undefined {
    if (subject instanceof IRI) {
      return subject.value;
    }
    if (subject instanceof BlankNode) {
      return `_:${subject.id}`;
    }
    // QuotedTriple - use duck typing
    if (typeof subject === "object" && subject !== null && "termType" in subject) {
      return subject.toString();
    }
    return undefined;
  }

  private getObjectValue(object: RDFObject): string | undefined {
    if (object instanceof Literal) {
      return object.value;
    }
    if (object instanceof IRI) {
      return object.value;
    }
    if (object instanceof BlankNode) {
      return `_:${object.id}`;
    }
    return undefined;
  }

  private getRootTypes(): string[] {
    // Types that have no parents
    const allParents = new Set<string>();
    for (const parents of this.typeHierarchy.values()) {
      for (const p of parents) {
        allParents.add(p);
      }
    }

    const rootTypes: string[] = [];
    for (const uri of this.nodeTypes.keys()) {
      if (!this.typeHierarchy.has(uri) || this.typeHierarchy.get(uri)!.length === 0) {
        // Also check if this type is a parent of something (otherwise it's just a leaf)
        if (allParents.has(uri)) {
          rootTypes.push(uri);
        }
      }
    }

    return rootTypes;
  }

  private emit(event: TypeRegistryEvent): void {
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error("TypeRegistry: error in subscriber callback", error);
      }
    }
  }
}
