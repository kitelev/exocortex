import type { ITripleStore } from "../interfaces/ITripleStore";
import { Namespace } from "../domain/models/rdf/Namespace";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";

/**
 * Suggestion item for autocomplete.
 * Contains all information needed to display and rank a suggestion.
 */
export interface AutocompleteSuggestion {
  /** Asset label for display */
  label: string;
  /** Full IRI of the asset */
  uri: string;
  /** File path to the asset (for wikilink format) */
  path: string;
  /** Asset class (e.g., "ems__Project") */
  assetClass: string;
  /** Whether the asset is active (for ranking) */
  isActive: boolean;
  /** Match score (higher is better) */
  matchScore: number;
  /** Last modified timestamp (for recency boost) */
  lastModified?: number;
}

/**
 * Configuration for autocomplete queries.
 */
export interface AutocompleteConfig {
  /** Maximum number of suggestions to return */
  limit?: number;
  /** Boost factor for active assets (default: 20) */
  activeBoost?: number;
  /** Boost factor for recently modified assets (default: 10) */
  recencyBoost?: number;
  /** Days considered "recent" for recency boost (default: 7) */
  recencyDays?: number;
}

/**
 * Default autocomplete configuration.
 */
export const DEFAULT_AUTOCOMPLETE_CONFIG: Required<AutocompleteConfig> = {
  limit: 10,
  activeBoost: 20,
  recencyBoost: 10,
  recencyDays: 7,
};

/**
 * Service for providing smart autocomplete suggestions for asset relations.
 *
 * Features:
 * - Filters assets by Property_range from ontology
 * - Ranks active assets higher
 * - Supports fuzzy search with Russian text
 * - Boosts recently modified assets
 *
 * @example
 * ```typescript
 * const service = new AutocompleteService(tripleStore);
 *
 * // Get suggestions for a property
 * const suggestions = await service.getSuggestions(
 *   "ems__Effort_project",
 *   "Моя зад",
 *   { limit: 10 }
 * );
 * ```
 */
export class AutocompleteService {
  private config: Required<AutocompleteConfig>;

  constructor(
    private tripleStore: ITripleStore,
    config?: AutocompleteConfig,
  ) {
    this.config = { ...DEFAULT_AUTOCOMPLETE_CONFIG, ...config };
  }

  /**
   * Get autocomplete suggestions for a property.
   *
   * @param propertyUri - Property URI (e.g., "ems__Effort_project")
   * @param query - Search query (partial label)
   * @param config - Optional configuration overrides
   * @returns Array of suggestions sorted by relevance
   */
  async getSuggestions(
    propertyUri: string,
    query: string,
    config?: AutocompleteConfig,
  ): Promise<AutocompleteSuggestion[]> {
    const effectiveConfig = { ...this.config, ...config };

    // 1. Get property range from ontology
    const rangeClasses = await this.getPropertyRange(propertyUri);

    // 2. If no range defined, return empty (or could query all assets)
    if (rangeClasses.length === 0) {
      // Fallback: try to infer from property name
      const inferredClass = this.inferClassFromProperty(propertyUri);
      if (inferredClass) {
        rangeClasses.push(inferredClass);
      }
    }

    // 3. Get assets of the target classes
    const suggestions: AutocompleteSuggestion[] = [];

    for (const rangeClass of rangeClasses) {
      const classAssets = await this.getAssetsOfClass(rangeClass);
      suggestions.push(...classAssets);
    }

    // 4. Score and filter by query
    const scored = suggestions
      .map((s) => ({
        ...s,
        matchScore: this.calculateMatchScore(s, query, effectiveConfig),
      }))
      .filter((s) => s.matchScore > 0);

    // 5. Sort by score (descending) and return top N
    return scored
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, effectiveConfig.limit);
  }

  /**
   * Get suggestions filtered by specific class(es).
   *
   * @param classFilter - Array of class names to filter by
   * @param query - Search query
   * @param config - Optional configuration overrides
   */
  async getSuggestionsByClass(
    classFilter: string[],
    query: string,
    config?: AutocompleteConfig,
  ): Promise<AutocompleteSuggestion[]> {
    const effectiveConfig = { ...this.config, ...config };

    const suggestions: AutocompleteSuggestion[] = [];

    for (const className of classFilter) {
      const classAssets = await this.getAssetsOfClass(className);
      suggestions.push(...classAssets);
    }

    const scored = suggestions
      .map((s) => ({
        ...s,
        matchScore: this.calculateMatchScore(s, query, effectiveConfig),
      }))
      .filter((s) => s.matchScore > 0);

    return scored
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, effectiveConfig.limit);
  }

  /**
   * Get the rdfs:range of a property from the ontology.
   */
  private async getPropertyRange(propertyUri: string): Promise<string[]> {
    const propertyIri = this.toFullIri(propertyUri);
    const ranges: string[] = [];

    // Query for rdfs:range
    const rangeTriples = await this.tripleStore.match(
      new IRI(propertyIri),
      Namespace.RDFS.term("range"),
      undefined,
    );

    for (const triple of rangeTriples) {
      if (triple.object instanceof IRI) {
        const className = this.toClassName(triple.object.value);
        if (className) {
          ranges.push(className);
        }
      }
    }

    return ranges;
  }

  /**
   * Get all assets of a specific class.
   */
  private async getAssetsOfClass(
    className: string,
  ): Promise<AutocompleteSuggestion[]> {
    const classIri = this.toFullIri(className);
    const suggestions: AutocompleteSuggestion[] = [];

    // Find all instances of this class
    const instanceTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      new IRI(classIri),
    );

    for (const triple of instanceTriples) {
      if (triple.subject instanceof IRI) {
        const suggestion = await this.buildSuggestion(
          triple.subject,
          className,
        );
        if (suggestion) {
          suggestions.push(suggestion);
        }
      }
    }

    return suggestions;
  }

  /**
   * Build a suggestion from an asset IRI.
   */
  private async buildSuggestion(
    assetIri: IRI,
    assetClass: string,
  ): Promise<AutocompleteSuggestion | null> {
    // Get label
    const labelTriples = await this.tripleStore.match(
      assetIri,
      Namespace.EXO.term("Asset_label"),
      undefined,
    );

    let label = "";
    for (const triple of labelTriples) {
      if (triple.object instanceof Literal) {
        label = triple.object.value;
        break;
      }
    }

    // If no label, try to extract from URI
    if (!label) {
      label = this.extractLabelFromUri(assetIri.value);
    }

    if (!label) {
      return null;
    }

    // Check if asset is active (has Active status)
    const isActive = await this.checkIfActive(assetIri);

    // Extract path from URI for wikilink format
    const path = this.extractPathFromUri(assetIri.value);

    return {
      label,
      uri: assetIri.value,
      path,
      assetClass,
      isActive,
      matchScore: 0, // Will be calculated later
    };
  }

  /**
   * Check if an asset has active status.
   */
  private async checkIfActive(assetIri: IRI): Promise<boolean> {
    // Check for ems:Effort_status = Active
    const statusTriples = await this.tripleStore.match(
      assetIri,
      Namespace.EMS.term("Effort_status"),
      undefined,
    );

    for (const triple of statusTriples) {
      const statusValue =
        triple.object instanceof Literal
          ? triple.object.value
          : triple.object instanceof IRI
            ? triple.object.value
            : "";

      if (
        statusValue.includes("Active") ||
        statusValue.includes("EffortStatus_Active")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate match score for a suggestion based on query.
   */
  private calculateMatchScore(
    suggestion: AutocompleteSuggestion,
    query: string,
    config: Required<AutocompleteConfig>,
  ): number {
    if (!query || query.length === 0) {
      // No query - just return base score with active boost
      return suggestion.isActive ? 100 + config.activeBoost : 100;
    }

    const labelLower = suggestion.label.toLowerCase();
    const queryLower = query.toLowerCase();

    let score = 0;

    // Exact match
    if (labelLower === queryLower) {
      score = 100;
    }
    // Starts with query
    else if (labelLower.startsWith(queryLower)) {
      score = 80;
    }
    // Contains query
    else if (labelLower.includes(queryLower)) {
      score = 60;
    }
    // Fuzzy match
    else if (this.fuzzyMatch(queryLower, labelLower)) {
      score = 40;
    }
    // No match
    else {
      return 0;
    }

    // Apply active boost
    if (suggestion.isActive) {
      score += config.activeBoost;
    }

    // Apply recency boost if lastModified is available
    if (suggestion.lastModified) {
      const daysSinceModified =
        (Date.now() - suggestion.lastModified) / (1000 * 60 * 60 * 24);
      if (daysSinceModified <= config.recencyDays) {
        score += config.recencyBoost * (1 - daysSinceModified / config.recencyDays);
      }
    }

    return score;
  }

  /**
   * Simple fuzzy match - checks if all chars of query appear in order.
   * Works well with Russian and other Unicode text.
   */
  private fuzzyMatch(query: string, target: string): boolean {
    let queryIndex = 0;
    for (let i = 0; i < target.length && queryIndex < query.length; i++) {
      if (target[i] === query[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === query.length;
  }

  /**
   * Infer target class from property name.
   * E.g., "ems__Effort_project" -> "ems__Project"
   */
  private inferClassFromProperty(propertyUri: string): string | null {
    // Common patterns:
    // ems__Effort_project -> ems__Project
    // ems__Task_area -> ems__Area
    // ems__Effort_parent -> (same class or generic Asset)

    const lowerUri = propertyUri.toLowerCase();

    if (lowerUri.includes("project")) {
      return "ems__Project";
    }
    if (lowerUri.includes("area")) {
      return "ems__Area";
    }
    if (lowerUri.includes("task")) {
      return "ems__Task";
    }
    if (lowerUri.includes("effort")) {
      return "ems__Effort";
    }

    return null;
  }

  /**
   * Convert property/class name to full IRI.
   */
  private toFullIri(name: string): string {
    if (name.startsWith("http://") || name.startsWith("https://")) {
      return name;
    }

    const match = name.match(/^([a-z]+)__(.+)$/);
    if (match) {
      const [, prefix, localName] = match;
      switch (prefix) {
        case "ems":
          return `https://exocortex.my/ontology/ems#${localName}`;
        case "exo":
          return `https://exocortex.my/ontology/exo#${localName}`;
        default:
          return `https://exocortex.my/ontology/${prefix}#${localName}`;
      }
    }

    return name;
  }

  /**
   * Convert full IRI to class name format.
   */
  private toClassName(iri: string): string | null {
    const match = iri.match(/https:\/\/exocortex\.my\/ontology\/([a-z]+)#(.+)$/);
    if (match) {
      const [, prefix, localName] = match;
      return `${prefix}__${localName}`;
    }
    return null;
  }

  /**
   * Extract label from asset URI.
   * Handles obsidian:// URIs and file paths.
   */
  private extractLabelFromUri(uri: string): string {
    // Handle obsidian://vault/... URIs
    if (uri.startsWith("obsidian://")) {
      const decoded = decodeURIComponent(uri);
      const lastSlash = decoded.lastIndexOf("/");
      if (lastSlash >= 0) {
        let name = decoded.substring(lastSlash + 1);
        // Remove .md extension
        if (name.endsWith(".md")) {
          name = name.substring(0, name.length - 3);
        }
        return name;
      }
    }

    // Handle file paths
    const lastSlash = uri.lastIndexOf("/");
    if (lastSlash >= 0) {
      let name = uri.substring(lastSlash + 1);
      if (name.endsWith(".md")) {
        name = name.substring(0, name.length - 3);
      }
      return name;
    }

    return "";
  }

  /**
   * Extract path from URI for wikilink format.
   */
  private extractPathFromUri(uri: string): string {
    // For obsidian:// URIs, extract the file path
    if (uri.startsWith("obsidian://vault/")) {
      const decoded = decodeURIComponent(uri.substring("obsidian://vault/".length));
      // Remove leading vault name if present
      const slashIndex = decoded.indexOf("/");
      if (slashIndex >= 0) {
        return decoded.substring(slashIndex + 1);
      }
      return decoded;
    }

    return uri;
  }
}
