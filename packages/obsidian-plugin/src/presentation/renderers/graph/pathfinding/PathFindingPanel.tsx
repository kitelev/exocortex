/**
 * PathFindingPanel - React component for path finding controls
 *
 * Provides a UI panel for:
 * - Starting/stopping path finding mode
 * - Displaying source/target selection state
 * - Showing path results
 * - Navigating between multiple paths
 * - Configuring path finding options
 *
 * @module presentation/renderers/graph/pathfinding
 * @since 1.0.0
 */

import React, { useState, useCallback, useMemo } from "react";
import type { PathFindingState, Path, PathFindingOptions } from "./PathFindingTypes";

/**
 * Props for PathFindingPanel component
 */
export interface PathFindingPanelProps {
  /** Current path finding state */
  state: PathFindingState;
  /** Callback when path finding is started */
  onStart: () => void;
  /** Callback when path finding is cancelled */
  onCancel: () => void;
  /** Callback when path is cleared */
  onClear: () => void;
  /** Callback to swap source and target */
  onSwapNodes: () => void;
  /** Callback to navigate to next path */
  onNextPath: () => void;
  /** Callback to navigate to previous path */
  onPreviousPath: () => void;
  /** Callback to select specific path */
  onSelectPath: (index: number) => void;
  /** Callback when options change */
  onOptionsChange: (options: Partial<PathFindingOptions>) => void;
  /** Custom CSS class name */
  className?: string;
}

/**
 * PathFindingPanel - UI controls for path finding
 */
export const PathFindingPanel: React.FC<PathFindingPanelProps> = ({
  state,
  onStart,
  onCancel,
  onClear,
  onSwapNodes,
  onNextPath,
  onPreviousPath,
  onSelectPath: _onSelectPath,
  onOptionsChange,
  className,
}) => {
  // _onSelectPath is available for future path list dropdown
  void _onSelectPath;
  const [showOptions, setShowOptions] = useState(false);

  // Get current path
  const currentPath = useMemo(() => {
    if (!state.result || state.result.paths.length === 0) {
      return null;
    }
    return state.result.paths[state.currentPathIndex];
  }, [state.result, state.currentPathIndex]);

  // Handle algorithm change
  const handleAlgorithmChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onOptionsChange({
        algorithm: e.target.value as PathFindingOptions["algorithm"],
      });
    },
    [onOptionsChange]
  );

  // Handle direction change
  const handleDirectionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onOptionsChange({
        direction: e.target.value as PathFindingOptions["direction"],
      });
    },
    [onOptionsChange]
  );

  // Handle max length change
  const handleMaxLengthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value > 0) {
        onOptionsChange({ maxLength: value });
      }
    },
    [onOptionsChange]
  );

  // Format path length for display
  const formatPathInfo = useCallback((path: Path | null) => {
    if (!path) return "";
    return `${path.length} edge${path.length !== 1 ? "s" : ""}`;
  }, []);

  // Inactive state - show start button
  if (!state.isActive) {
    return (
      <div className={`exo-pathfinding-panel exo-pathfinding-inactive ${className || ""}`}>
        <button
          className="exo-pathfinding-start-btn"
          onClick={onStart}
          title="Find path between two nodes"
        >
          <span className="exo-pathfinding-icon">⤮</span>
          Find Path
        </button>
      </div>
    );
  }

  return (
    <div className={`exo-pathfinding-panel exo-pathfinding-active ${className || ""}`}>
      {/* Header */}
      <div className="exo-pathfinding-header">
        <span className="exo-pathfinding-title">Path Finding</span>
        <button
          className="exo-pathfinding-close-btn"
          onClick={onCancel}
          title="Cancel path finding"
        >
          ✕
        </button>
      </div>

      {/* Selection state */}
      <div className="exo-pathfinding-selection">
        {/* Source node */}
        <div
          className={`exo-pathfinding-node-slot ${
            state.sourceNode ? "exo-pathfinding-node-selected" : ""
          } ${state.selectionStep === "source" ? "exo-pathfinding-node-waiting" : ""}`}
        >
          <span className="exo-pathfinding-node-label">Source:</span>
          <span className="exo-pathfinding-node-value">
            {state.sourceNode ? state.sourceNode.label : "Click a node..."}
          </span>
        </div>

        {/* Swap button */}
        {state.sourceNode && state.targetNode && (
          <button
            className="exo-pathfinding-swap-btn"
            onClick={onSwapNodes}
            title="Swap source and target"
          >
            ⇅
          </button>
        )}

        {/* Target node */}
        <div
          className={`exo-pathfinding-node-slot ${
            state.targetNode ? "exo-pathfinding-node-selected" : ""
          } ${state.selectionStep === "target" ? "exo-pathfinding-node-waiting" : ""}`}
        >
          <span className="exo-pathfinding-node-label">Target:</span>
          <span className="exo-pathfinding-node-value">
            {state.targetNode ? state.targetNode.label : "Click a node..."}
          </span>
        </div>
      </div>

      {/* Searching indicator */}
      {state.isSearching && (
        <div className="exo-pathfinding-searching">
          <span className="exo-pathfinding-spinner">⟳</span>
          Searching...
        </div>
      )}

      {/* Results */}
      {state.result && !state.isSearching && (
        <div className="exo-pathfinding-results">
          {state.result.found ? (
            <>
              {/* Path info */}
              <div className="exo-pathfinding-found">
                <span className="exo-pathfinding-found-icon">✓</span>
                <span className="exo-pathfinding-found-text">
                  Path found: {formatPathInfo(currentPath)}
                </span>
              </div>

              {/* Navigation for multiple paths */}
              {state.result.paths.length > 1 && (
                <div className="exo-pathfinding-navigation">
                  <button
                    className="exo-pathfinding-nav-btn"
                    onClick={onPreviousPath}
                    title="Previous path"
                  >
                    ◀
                  </button>
                  <span className="exo-pathfinding-path-counter">
                    {state.currentPathIndex + 1} / {state.result.paths.length}
                  </span>
                  <button
                    className="exo-pathfinding-nav-btn"
                    onClick={onNextPath}
                    title="Next path"
                  >
                    ▶
                  </button>
                </div>
              )}

              {/* Path details */}
              {currentPath && (
                <div className="exo-pathfinding-path-details">
                  <div className="exo-pathfinding-path-steps">
                    {currentPath.steps.map((step, index) => (
                      <React.Fragment key={step.node.id}>
                        <span
                          className={`exo-pathfinding-step-node ${
                            index === 0
                              ? "exo-pathfinding-step-source"
                              : index === currentPath.steps.length - 1
                              ? "exo-pathfinding-step-target"
                              : ""
                          }`}
                        >
                          {step.node.label}
                        </span>
                        {index < currentPath.steps.length - 1 && (
                          <span className="exo-pathfinding-step-arrow">→</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {/* Clear button */}
              <button
                className="exo-pathfinding-clear-btn"
                onClick={onClear}
              >
                Clear Path
              </button>
            </>
          ) : (
            <>
              {/* No path found */}
              <div className="exo-pathfinding-not-found">
                <span className="exo-pathfinding-not-found-icon">✗</span>
                <span className="exo-pathfinding-not-found-text">
                  {state.result.error || "No path found"}
                </span>
              </div>

              {/* Stats */}
              <div className="exo-pathfinding-stats">
                <span>Visited {state.result.nodesVisited} nodes</span>
                <span>in {state.result.searchTimeMs.toFixed(1)}ms</span>
              </div>

              {/* Clear button */}
              <button
                className="exo-pathfinding-clear-btn"
                onClick={onClear}
              >
                Try Again
              </button>
            </>
          )}
        </div>
      )}

      {/* Options toggle */}
      <button
        className="exo-pathfinding-options-toggle"
        onClick={() => setShowOptions(!showOptions)}
      >
        {showOptions ? "▲ Hide Options" : "▼ Show Options"}
      </button>

      {/* Options panel */}
      {showOptions && (
        <div className="exo-pathfinding-options">
          {/* Algorithm */}
          <div className="exo-pathfinding-option">
            <label>Algorithm:</label>
            <select
              value={state.options.algorithm}
              onChange={handleAlgorithmChange}
            >
              <option value="bfs">BFS (Shortest)</option>
              <option value="dijkstra">Dijkstra (Weighted)</option>
              <option value="bidirectional">Bidirectional (Fast)</option>
            </select>
          </div>

          {/* Direction */}
          <div className="exo-pathfinding-option">
            <label>Direction:</label>
            <select
              value={state.options.direction}
              onChange={handleDirectionChange}
            >
              <option value="both">Both (Undirected)</option>
              <option value="outgoing">Outgoing Only</option>
              <option value="incoming">Incoming Only</option>
            </select>
          </div>

          {/* Max length */}
          <div className="exo-pathfinding-option">
            <label>Max Length:</label>
            <input
              type="number"
              min="1"
              max="50"
              value={state.options.maxLength}
              onChange={handleMaxLengthChange}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Props for PathFindingButton component
 */
export interface PathFindingButtonProps {
  /** Whether path finding is active */
  isActive: boolean;
  /** Callback when button is clicked */
  onClick: () => void;
  /** Custom CSS class name */
  className?: string;
}

/**
 * PathFindingButton - Simple button to toggle path finding mode
 */
export const PathFindingButton: React.FC<PathFindingButtonProps> = ({
  isActive,
  onClick,
  className,
}) => {
  return (
    <button
      className={`exo-pathfinding-button ${isActive ? "exo-pathfinding-button-active" : ""} ${className || ""}`}
      onClick={onClick}
      title={isActive ? "Exit path finding mode" : "Find path between nodes"}
    >
      <span className="exo-pathfinding-button-icon">⤮</span>
    </button>
  );
};

export default PathFindingPanel;
