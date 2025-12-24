/**
 * SearchBox Component
 *
 * Provides a search input UI for finding and highlighting nodes in the graph.
 * Features:
 * - Text input with search icon
 * - Match count display
 * - Previous/Next navigation
 * - Clear button
 * - Keyboard shortcuts (Enter, Shift+Enter, Escape)
 *
 * @module presentation/renderers/graph/search
 * @since 1.0.0
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import type { SearchState, SearchOptions } from "./SearchTypes";

/**
 * Props for SearchBox component
 */
export interface SearchBoxProps {
  /** Current search state */
  searchState: SearchState;
  /** Callback when search query changes */
  onSearch: (query: string) => void;
  /** Callback to navigate to next match */
  onNextMatch?: () => void;
  /** Callback to navigate to previous match */
  onPreviousMatch?: () => void;
  /** Callback to clear search */
  onClear?: () => void;
  /** Callback when search options change */
  onOptionsChange?: (options: Partial<SearchOptions>) => void;
  /** Whether the search box is visible */
  isVisible?: boolean;
  /** Callback when visibility changes */
  onVisibilityChange?: (visible: boolean) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Custom CSS class */
  className?: string;
  /** Whether to auto-focus on mount/show */
  autoFocus?: boolean;
}

/**
 * SearchBox - Interactive search input for graph nodes
 */
export function SearchBox({
  searchState,
  onSearch,
  onNextMatch,
  onPreviousMatch,
  onClear,
  onOptionsChange,
  isVisible = true,
  onVisibilityChange,
  placeholder = "Search nodes...",
  className = "",
  autoFocus = false,
}: SearchBoxProps): React.ReactElement | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localQuery, setLocalQuery] = useState(searchState.query);
  const [showOptions, setShowOptions] = useState(false);

  // Sync local state with external state
  useEffect(() => {
    if (searchState.query !== localQuery) {
      setLocalQuery(searchState.query);
    }
  }, [searchState.query]);

  // Auto-focus when shown
  useEffect(() => {
    if (isVisible && autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVisible, autoFocus]);

  // Handle input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setLocalQuery(query);
      onSearch(query);
    },
    [onSearch]
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (e.shiftKey) {
          onPreviousMatch?.();
        } else {
          onNextMatch?.();
        }
        e.preventDefault();
      } else if (e.key === "Escape") {
        if (localQuery) {
          onClear?.();
          setLocalQuery("");
        } else {
          onVisibilityChange?.(false);
        }
        e.preventDefault();
      }
    },
    [localQuery, onNextMatch, onPreviousMatch, onClear, onVisibilityChange]
  );

  // Handle clear button
  const handleClear = useCallback(() => {
    setLocalQuery("");
    onClear?.();
    inputRef.current?.focus();
  }, [onClear]);

  // Toggle option
  const toggleOption = useCallback(
    (option: keyof SearchOptions) => {
      onOptionsChange?.({
        [option]: !searchState.options[option],
      });
    },
    [onOptionsChange, searchState.options]
  );

  if (!isVisible) {
    return null;
  }

  const matchCount = searchState.matches.length;
  const currentMatch = searchState.currentMatchIndex + 1;

  return (
    <div className={`exo-search-box ${className}`}>
      <div className="exo-search-box__input-wrapper">
        {/* Search icon */}
        <svg
          className="exo-search-box__icon"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          className="exo-search-box__input"
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search nodes"
        />

        {/* Match counter */}
        {searchState.isActive && matchCount > 0 && (
          <span className="exo-search-box__counter">
            {currentMatch}/{matchCount}
          </span>
        )}

        {/* No matches indicator */}
        {searchState.isActive && matchCount === 0 && localQuery.length >= 2 && (
          <span className="exo-search-box__counter exo-search-box__counter--empty">
            0
          </span>
        )}

        {/* Clear button */}
        {localQuery && (
          <button
            type="button"
            className="exo-search-box__clear-btn"
            onClick={handleClear}
            title="Clear search (Esc)"
            aria-label="Clear search"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation and options */}
      {searchState.isActive && matchCount > 0 && (
        <div className="exo-search-box__controls">
          {/* Previous button */}
          <button
            type="button"
            className="exo-search-box__nav-btn"
            onClick={onPreviousMatch}
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            disabled={matchCount <= 1}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Next button */}
          <button
            type="button"
            className="exo-search-box__nav-btn"
            onClick={onNextMatch}
            title="Next match (Enter)"
            aria-label="Next match"
            disabled={matchCount <= 1}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {/* Options toggle */}
          <button
            type="button"
            className={`exo-search-box__options-btn ${showOptions ? "exo-search-box__options-btn--active" : ""}`}
            onClick={() => setShowOptions(!showOptions)}
            title="Search options"
            aria-label="Toggle search options"
            aria-expanded={showOptions}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      )}

      {/* Options panel */}
      {showOptions && (
        <div className="exo-search-box__options-panel">
          <label className="exo-search-box__option">
            <input
              type="checkbox"
              checked={searchState.options.caseSensitive}
              onChange={() => toggleOption("caseSensitive")}
            />
            <span>Case sensitive</span>
          </label>
          <label className="exo-search-box__option">
            <input
              type="checkbox"
              checked={searchState.options.useRegex}
              onChange={() => toggleOption("useRegex")}
            />
            <span>Regular expression</span>
          </label>
          <label className="exo-search-box__option">
            <input
              type="checkbox"
              checked={searchState.options.searchLabels}
              onChange={() => toggleOption("searchLabels")}
            />
            <span>Search labels</span>
          </label>
          <label className="exo-search-box__option">
            <input
              type="checkbox"
              checked={searchState.options.searchTypes}
              onChange={() => toggleOption("searchTypes")}
            />
            <span>Search types</span>
          </label>
          <label className="exo-search-box__option">
            <input
              type="checkbox"
              checked={searchState.options.searchPaths}
              onChange={() => toggleOption("searchPaths")}
            />
            <span>Search paths</span>
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * SearchButton - Floating button to toggle search visibility
 */
export interface SearchButtonProps {
  /** Whether search is currently visible */
  isSearchVisible: boolean;
  /** Callback to toggle search visibility */
  onToggle: () => void;
  /** Whether there are active search results */
  hasResults?: boolean;
  /** Number of matches */
  matchCount?: number;
  /** Custom CSS class */
  className?: string;
}

export function SearchButton({
  isSearchVisible,
  onToggle,
  hasResults = false,
  matchCount = 0,
  className = "",
}: SearchButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className={`exo-search-button ${isSearchVisible ? "exo-search-button--active" : ""} ${className}`}
      onClick={onToggle}
      title={isSearchVisible ? "Close search (Esc)" : "Search nodes (Ctrl+F)"}
      aria-label={isSearchVisible ? "Close search" : "Open search"}
      aria-expanded={isSearchVisible}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      {hasResults && matchCount > 0 && (
        <span className="exo-search-button__badge">{matchCount}</span>
      )}
    </button>
  );
}
