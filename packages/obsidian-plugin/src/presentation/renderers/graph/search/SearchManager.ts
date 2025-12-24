/**
 * SearchManager - Node search and highlighting system
 *
 * Provides search functionality for graph nodes with:
 * - Text-based search in labels, types, and paths
 * - Regex support
 * - Match highlighting
 * - Navigation between matches
 * - Search result ranking
 *
 * @module presentation/renderers/graph/search
 * @since 1.0.0
 */

import type {
  SearchMatch,
  SearchState,
  SearchOptions,
  HighlightStyle,
  SearchEvent,
  SearchEventListener,
} from "./SearchTypes";
import {
  DEFAULT_SEARCH_OPTIONS,
  DEFAULT_HIGHLIGHT_STYLE,
} from "./SearchTypes";
import type { GraphNode } from "../types";

/**
 * Configuration for SearchManager
 */
export interface SearchManagerConfig {
  /** Search options */
  searchOptions: SearchOptions;
  /** Highlight style for matched nodes */
  highlightStyle: HighlightStyle;
}

/**
 * Default SearchManager configuration
 */
export const DEFAULT_SEARCH_MANAGER_CONFIG: SearchManagerConfig = {
  searchOptions: DEFAULT_SEARCH_OPTIONS,
  highlightStyle: DEFAULT_HIGHLIGHT_STYLE,
};

/**
 * SearchManager - Manages node search and highlighting
 */
export class SearchManager {
  private config: SearchManagerConfig;
  private nodes: GraphNode[] = [];
  private nodeTypes: Map<string, string[]> = new Map(); // nodeId -> types
  private state: SearchState;
  private listeners: Set<SearchEventListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<SearchManagerConfig> = {}) {
    this.config = {
      searchOptions: {
        ...DEFAULT_SEARCH_OPTIONS,
        ...config.searchOptions,
      },
      highlightStyle: {
        ...DEFAULT_HIGHLIGHT_STYLE,
        ...config.highlightStyle,
      },
    };

    this.state = {
      query: "",
      isActive: false,
      matches: [],
      currentMatchIndex: -1,
      options: this.config.searchOptions,
    };
  }

  /**
   * Set the nodes to search
   *
   * @param nodes - Array of graph nodes
   * @param nodeTypes - Optional map of node IDs to their RDF types
   */
  setNodes(nodes: GraphNode[], nodeTypes?: Map<string, string[]>): void {
    this.nodes = nodes;
    this.nodeTypes = nodeTypes ?? new Map();

    // Re-run search if active
    if (this.state.isActive && this.state.query) {
      this.performSearch(this.state.query);
    }
  }

  /**
   * Execute a search query
   *
   * @param query - Search query string
   * @param immediate - Skip debounce and search immediately
   */
  search(query: string, immediate = false): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Check minimum characters
    if (query.length < this.config.searchOptions.minChars) {
      if (this.state.isActive) {
        this.clear();
      }
      this.state.query = query;
      return;
    }

    if (immediate) {
      this.performSearch(query);
    } else {
      this.debounceTimer = setTimeout(() => {
        this.performSearch(query);
        this.debounceTimer = null;
      }, this.config.searchOptions.debounceMs);
    }
  }

  /**
   * Perform the actual search
   */
  private performSearch(query: string): void {
    this.state.query = query;
    this.state.isActive = true;
    this.state.matches = [];

    if (!query.trim()) {
      this.emit({ type: "search:clear" });
      return;
    }

    this.emit({ type: "search:start", query });

    const options = this.config.searchOptions;
    const matches: SearchMatch[] = [];

    // Prepare search pattern
    let pattern: RegExp;
    try {
      if (options.useRegex) {
        pattern = new RegExp(
          query,
          options.caseSensitive ? "" : "i"
        );
      } else {
        // Escape regex special characters for literal search
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        pattern = new RegExp(
          escaped,
          options.caseSensitive ? "" : "i"
        );
      }
    } catch {
      // Invalid regex, return empty results
      this.state.matches = [];
      this.state.currentMatchIndex = -1;
      this.emit({
        type: "search:update",
        query,
        matches: [],
      });
      return;
    }

    // Search through all nodes
    for (const node of this.nodes) {
      // Search in labels
      if (options.searchLabels && node.label) {
        const match = pattern.exec(node.label);
        if (match) {
          matches.push({
            nodeId: node.id,
            matchedText: node.label,
            matchedField: "label",
            score: this.calculateScore(match[0], node.label, "label"),
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
          });
          continue; // One match per node is enough
        }
      }

      // Search in paths
      if (options.searchPaths && node.path) {
        const match = pattern.exec(node.path);
        if (match) {
          matches.push({
            nodeId: node.id,
            matchedText: node.path,
            matchedField: "path",
            score: this.calculateScore(match[0], node.path, "path"),
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
          });
          continue;
        }
      }

      // Search in types
      if (options.searchTypes) {
        const types = this.nodeTypes.get(node.id) ?? [];
        for (const type of types) {
          const match = pattern.exec(type);
          if (match) {
            matches.push({
              nodeId: node.id,
              matchedText: type,
              matchedField: "type",
              score: this.calculateScore(match[0], type, "type"),
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
            break; // One match per node is enough
          }
        }
      }
    }

    // Sort by score (highest first)
    matches.sort((a, b) => b.score - a.score);

    // Limit results
    this.state.matches = matches.slice(0, options.maxResults);
    this.state.currentMatchIndex = matches.length > 0 ? 0 : -1;

    this.emit({
      type: "search:update",
      query,
      matches: this.state.matches,
    });

    // Highlight first match if available
    if (this.state.currentMatchIndex >= 0) {
      this.emit({
        type: "match:highlight",
        selectedMatch: this.state.matches[0],
      });
    }
  }

  /**
   * Calculate match score for ranking
   */
  private calculateScore(
    matchedPart: string,
    fullText: string,
    field: string
  ): number {
    let score = 100;

    // Boost for exact match
    if (matchedPart.toLowerCase() === fullText.toLowerCase()) {
      score += 50;
    }

    // Boost for match at start
    if (fullText.toLowerCase().startsWith(matchedPart.toLowerCase())) {
      score += 30;
    }

    // Boost for match in label vs other fields
    if (field === "label") {
      score += 20;
    } else if (field === "type") {
      score += 10;
    }

    // Penalty for long texts with short matches
    const matchRatio = matchedPart.length / fullText.length;
    score += matchRatio * 20;

    return score;
  }

  /**
   * Navigate to next match
   */
  nextMatch(): SearchMatch | null {
    if (this.state.matches.length === 0) {
      return null;
    }

    this.state.currentMatchIndex =
      (this.state.currentMatchIndex + 1) % this.state.matches.length;

    const match = this.state.matches[this.state.currentMatchIndex];

    this.emit({
      type: "match:select",
      selectedMatch: match,
    });

    return match;
  }

  /**
   * Navigate to previous match
   */
  previousMatch(): SearchMatch | null {
    if (this.state.matches.length === 0) {
      return null;
    }

    this.state.currentMatchIndex =
      (this.state.currentMatchIndex - 1 + this.state.matches.length) %
      this.state.matches.length;

    const match = this.state.matches[this.state.currentMatchIndex];

    this.emit({
      type: "match:select",
      selectedMatch: match,
    });

    return match;
  }

  /**
   * Select a specific match by index
   */
  selectMatch(index: number): SearchMatch | null {
    if (index < 0 || index >= this.state.matches.length) {
      return null;
    }

    this.state.currentMatchIndex = index;
    const match = this.state.matches[index];

    this.emit({
      type: "match:select",
      selectedMatch: match,
    });

    return match;
  }

  /**
   * Select a specific match by node ID
   */
  selectMatchByNodeId(nodeId: string): SearchMatch | null {
    const index = this.state.matches.findIndex((m) => m.nodeId === nodeId);
    if (index >= 0) {
      return this.selectMatch(index);
    }
    return null;
  }

  /**
   * Clear the current search
   */
  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.state = {
      query: "",
      isActive: false,
      matches: [],
      currentMatchIndex: -1,
      options: this.config.searchOptions,
    };

    this.emit({ type: "search:clear" });
  }

  /**
   * Check if a node is a match
   */
  isMatch(nodeId: string): boolean {
    return this.state.matches.some((m) => m.nodeId === nodeId);
  }

  /**
   * Check if a node is the currently selected match
   */
  isCurrentMatch(nodeId: string): boolean {
    if (this.state.currentMatchIndex < 0) {
      return false;
    }
    return this.state.matches[this.state.currentMatchIndex]?.nodeId === nodeId;
  }

  /**
   * Get current search state
   */
  getState(): SearchState {
    return { ...this.state };
  }

  /**
   * Get highlight style
   */
  getHighlightStyle(): HighlightStyle {
    return { ...this.config.highlightStyle };
  }

  /**
   * Update search options
   */
  setOptions(options: Partial<SearchOptions>): void {
    this.config.searchOptions = {
      ...this.config.searchOptions,
      ...options,
    };
    this.state.options = this.config.searchOptions;

    // Re-run search if active
    if (this.state.isActive && this.state.query) {
      this.performSearch(this.state.query);
    }
  }

  /**
   * Update highlight style
   */
  setHighlightStyle(style: Partial<HighlightStyle>): void {
    this.config.highlightStyle = {
      ...this.config.highlightStyle,
      ...style,
    };
  }

  /**
   * Get all matched node IDs
   */
  getMatchedNodeIds(): Set<string> {
    return new Set(this.state.matches.map((m) => m.nodeId));
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
        console.error("Error in search event listener:", e);
      }
    }
  }

  /**
   * Destroy the manager and clean up resources
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.listeners.clear();
    this.nodes = [];
    this.nodeTypes.clear();
  }
}

/**
 * Create a SearchManager instance
 */
export function createSearchManager(
  config?: Partial<SearchManagerConfig>
): SearchManager {
  return new SearchManager(config);
}
