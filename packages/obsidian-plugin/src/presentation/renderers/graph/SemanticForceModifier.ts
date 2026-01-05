/**
 * SemanticForceModifier - Ontology-driven force modifiers for graph physics
 *
 * Translates RDF/OWL predicates into physical force modifiers that affect
 * the force-directed graph layout. This creates semantic clustering where:
 * - Related nodes (rdfs:subClassOf, dcterms:isPartOf) attract more strongly
 * - Unrelated nodes (owl:disjointWith) repel more strongly
 * - Nodes of different types naturally separate
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type {
  SemanticForceConfig,
  SemanticPhysicsConfig,
} from "../../stores/graphConfigStore/types";
import type { SimulationLink, SimulationNode } from "./ForceSimulation";

/**
 * Extended link interface with predicate information
 */
export interface SemanticLink<N extends SimulationNode = SimulationNode>
  extends SimulationLink<N> {
  /** RDF predicate URI for this link */
  predicate?: string;
}

/**
 * Extended node interface with type information
 */
export interface SemanticNode extends SimulationNode {
  /** rdf:type URIs for this node */
  types?: string[];
}

/**
 * Force modifier result for a link or node pair
 */
export interface ForceModifier {
  /** Attraction multiplier (>1 = stronger pull) */
  attraction: number;
  /** Repulsion multiplier (>1 = stronger push) */
  repulsion: number;
}

/**
 * Cache key for node pair type comparison
 */
type NodePairKey = string;

/**
 * SemanticForceModifier - Computes force modifiers based on ontology relationships
 *
 * @example
 * ```typescript
 * const modifier = new SemanticForceModifier(config);
 *
 * // Get modifier for a link
 * const linkMod = modifier.getLinkModifier(link);
 * const adjustedStrength = baseStrength * linkMod.attraction;
 *
 * // Get modifier for a node pair
 * const pairMod = modifier.getNodePairModifier(nodeA, nodeB);
 * const adjustedRepulsion = baseRepulsion * pairMod.repulsion;
 * ```
 */
export class SemanticForceModifier {
  private config: SemanticPhysicsConfig;
  private predicateMap: Map<string, SemanticForceConfig>;
  private typePairCache: Map<NodePairKey, ForceModifier>;
  private readonly DEFAULT_MODIFIER: ForceModifier = {
    attraction: 1.0,
    repulsion: 1.0,
  };

  constructor(config: SemanticPhysicsConfig) {
    this.config = config;
    this.predicateMap = new Map();
    this.typePairCache = new Map();
    this.buildPredicateMap();
  }

  /**
   * Build lookup map from predicate to force config
   */
  private buildPredicateMap(): void {
    this.predicateMap.clear();
    for (const predConfig of this.config.predicates) {
      this.predicateMap.set(predConfig.predicate, predConfig);
    }
  }

  /**
   * Update configuration and rebuild caches
   */
  updateConfig(config: SemanticPhysicsConfig): void {
    this.config = config;
    this.buildPredicateMap();
    this.typePairCache.clear();
  }

  /**
   * Check if semantic physics is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get force modifier for a link based on its predicate
   *
   * @param link - Link with optional predicate property
   * @returns Force modifier for attraction/repulsion
   */
  getLinkModifier<N extends SimulationNode>(
    link: SemanticLink<N>
  ): ForceModifier {
    if (!this.config.enabled) {
      return this.DEFAULT_MODIFIER;
    }

    const predicate = link.predicate;
    if (!predicate) {
      return {
        attraction: this.config.defaultAttractionMultiplier,
        repulsion: this.config.defaultRepulsionMultiplier,
      };
    }

    const config = this.predicateMap.get(predicate);
    if (config) {
      return {
        attraction: config.attractionMultiplier,
        repulsion: config.repulsionMultiplier,
      };
    }

    // Check for prefixed predicate matches (e.g., "rdfs:subClassOf" matches "http://...#subClassOf")
    const localName = this.extractLocalName(predicate);
    for (const [configPredicate, configValue] of this.predicateMap) {
      if (
        this.extractLocalName(configPredicate) === localName ||
        predicate.endsWith(configPredicate) ||
        configPredicate.endsWith(predicate)
      ) {
        return {
          attraction: configValue.attractionMultiplier,
          repulsion: configValue.repulsionMultiplier,
        };
      }
    }

    return {
      attraction: this.config.defaultAttractionMultiplier,
      repulsion: this.config.defaultRepulsionMultiplier,
    };
  }

  /**
   * Get force modifier for a pair of nodes based on their types
   *
   * @param nodeA - First node
   * @param nodeB - Second node
   * @returns Force modifier for repulsion between nodes
   */
  getNodePairModifier(nodeA: SemanticNode, nodeB: SemanticNode): ForceModifier {
    if (!this.config.enabled || !this.config.typeBasedRepulsion) {
      return this.DEFAULT_MODIFIER;
    }

    const typesA = nodeA.types || [];
    const typesB = nodeB.types || [];

    // If either node has no type information, use default
    if (typesA.length === 0 || typesB.length === 0) {
      return this.DEFAULT_MODIFIER;
    }

    // Check cache
    const cacheKey = this.getNodePairCacheKey(nodeA.id, nodeB.id);
    const cached = this.typePairCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Check if nodes share any types
    const sharedTypes = this.hasSharedTypes(typesA, typesB);

    const modifier: ForceModifier = sharedTypes
      ? this.DEFAULT_MODIFIER
      : {
          attraction: 1.0,
          repulsion: this.config.differentTypeRepulsionMultiplier,
        };

    // Cache the result
    this.typePairCache.set(cacheKey, modifier);

    return modifier;
  }

  /**
   * Get combined force modifier for a link considering both predicate and node types
   *
   * @param link - Link with source and target nodes
   * @returns Combined force modifier
   */
  getCombinedLinkModifier<N extends SemanticNode>(
    link: SemanticLink<N>
  ): ForceModifier {
    if (!this.config.enabled) {
      return this.DEFAULT_MODIFIER;
    }

    const linkMod = this.getLinkModifier(link);

    // If source/target are resolved to nodes, also consider types
    const source = link.source as N | string;
    const target = link.target as N | string;

    if (typeof source === "object" && typeof target === "object") {
      const pairMod = this.getNodePairModifier(source, target);
      return {
        attraction: linkMod.attraction,
        repulsion: Math.max(linkMod.repulsion, pairMod.repulsion),
      };
    }

    return linkMod;
  }

  /**
   * Compute attraction strength for a link
   *
   * @param baseStrength - Base link strength from physics config
   * @param link - Link to compute strength for
   * @returns Adjusted strength
   */
  computeLinkStrength<N extends SimulationNode>(
    baseStrength: number,
    link: SemanticLink<N>
  ): number {
    const modifier = this.getLinkModifier(link);
    return baseStrength * modifier.attraction;
  }

  /**
   * Compute repulsion strength between two nodes
   *
   * @param baseStrength - Base charge strength from physics config
   * @param nodeA - First node
   * @param nodeB - Second node
   * @returns Adjusted strength (more negative = stronger repulsion)
   */
  computeRepulsionStrength(
    baseStrength: number,
    nodeA: SemanticNode,
    nodeB: SemanticNode
  ): number {
    const modifier = this.getNodePairModifier(nodeA, nodeB);
    return baseStrength * modifier.repulsion;
  }

  /**
   * Clear the type pair cache (call when graph structure changes)
   */
  clearCache(): void {
    this.typePairCache.clear();
  }

  /**
   * Get the current configuration
   */
  getConfig(): SemanticPhysicsConfig {
    return this.config;
  }

  /**
   * Get all configured predicate patterns
   */
  getConfiguredPredicates(): string[] {
    return Array.from(this.predicateMap.keys());
  }

  /**
   * Check if a predicate has a specific configuration
   */
  hasPredicateConfig(predicate: string): boolean {
    if (this.predicateMap.has(predicate)) {
      return true;
    }
    const localName = this.extractLocalName(predicate);
    for (const configPredicate of this.predicateMap.keys()) {
      if (
        this.extractLocalName(configPredicate) === localName ||
        predicate.endsWith(configPredicate) ||
        configPredicate.endsWith(predicate)
      ) {
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Extract local name from URI (after # or last /) or prefixed name (after :)
   */
  private extractLocalName(uri: string): string {
    const hashIndex = uri.lastIndexOf("#");
    if (hashIndex !== -1) {
      return uri.substring(hashIndex + 1);
    }
    const slashIndex = uri.lastIndexOf("/");
    if (slashIndex !== -1) {
      return uri.substring(slashIndex + 1);
    }
    // Handle prefixed names like "rdfs:subClassOf" -> "subClassOf"
    const colonIndex = uri.lastIndexOf(":");
    if (colonIndex !== -1) {
      return uri.substring(colonIndex + 1);
    }
    return uri;
  }

  /**
   * Generate cache key for node pair (order-independent)
   */
  private getNodePairCacheKey(idA: string, idB: string): NodePairKey {
    return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
  }

  /**
   * Check if two type arrays share any common types
   */
  private hasSharedTypes(typesA: string[], typesB: string[]): boolean {
    const setA = new Set(typesA);
    for (const typeB of typesB) {
      if (setA.has(typeB)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Default semantic physics configuration
 */
export const DEFAULT_SEMANTIC_PHYSICS_CONFIG: SemanticPhysicsConfig = {
  enabled: true,
  predicates: [
    // Attraction modifiers
    { predicate: "rdfs:subClassOf", attractionMultiplier: 2.0, repulsionMultiplier: 1.0 },
    { predicate: "exo:Asset_prototype", attractionMultiplier: 1.8, repulsionMultiplier: 1.0 },
    { predicate: "dcterms:isPartOf", attractionMultiplier: 1.5, repulsionMultiplier: 1.0 },
    // Repulsion modifiers
    { predicate: "owl:disjointWith", attractionMultiplier: 1.0, repulsionMultiplier: 3.0 },
  ],
  defaultAttractionMultiplier: 1.0,
  defaultRepulsionMultiplier: 1.0,
  typeBasedRepulsion: true,
  differentTypeRepulsionMultiplier: 1.3,
};
