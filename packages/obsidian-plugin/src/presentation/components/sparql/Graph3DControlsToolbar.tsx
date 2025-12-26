/**
 * Graph3DControlsToolbar Component
 *
 * Provides UI controls for 3D graph visualization:
 * - Camera reset (return to default view)
 * - Auto-rotate toggle
 * - Labels visibility toggle
 * - Fullscreen mode toggle
 *
 * Keyboard shortcuts:
 * - R: Reset camera
 * - A: Toggle auto-rotate
 * - L: Toggle labels
 * - F: Toggle fullscreen
 *
 * @module presentation/components/sparql
 * @since 1.0.0
 */

import React, { useCallback, useEffect } from "react";

/**
 * Control state for 3D graph visualization
 */
export interface Graph3DControlState {
  /** Whether auto-rotate is enabled */
  autoRotate: boolean;
  /** Whether labels are visible */
  labelsVisible: boolean;
  /** Whether fullscreen mode is active */
  isFullscreen: boolean;
}

/**
 * Props for Graph3DControlsToolbar
 */
export interface Graph3DControlsToolbarProps {
  /** Current control state */
  state: Graph3DControlState;
  /** Callback when camera reset is requested */
  onCameraReset: () => void;
  /** Callback when auto-rotate is toggled */
  onAutoRotateToggle: () => void;
  /** Callback when labels visibility is toggled */
  onLabelsToggle: () => void;
  /** Callback when fullscreen is toggled */
  onFullscreenToggle: () => void;
  /** Custom CSS class */
  className?: string;
}

/**
 * Icon components for toolbar buttons
 */
const CameraResetIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const AutoRotateIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M23 4v6h-6" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    {isActive && <circle cx="12" cy="12" r="3" fill="currentColor" />}
  </svg>
);

const LabelsIcon: React.FC<{ isVisible: boolean }> = ({ isVisible }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="5" width="18" height="14" rx="2" ry="2" />
    <line x1="7" y1="10" x2="17" y2="10" />
    <line x1="7" y1="14" x2="14" y2="14" />
    {!isVisible && (
      <>
        <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2.5" stroke="currentColor" />
      </>
    )}
  </svg>
);

const FullscreenIcon: React.FC<{ isFullscreen: boolean }> = ({ isFullscreen }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {isFullscreen ? (
      <>
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </>
    ) : (
      <>
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </>
    )}
  </svg>
);

/**
 * Graph3DControlsToolbar - Floating toolbar for 3D graph controls
 *
 * @example
 * ```tsx
 * <Graph3DControlsToolbar
 *   state={{ autoRotate: false, labelsVisible: true, isFullscreen: false }}
 *   onCameraReset={() => resetCamera()}
 *   onAutoRotateToggle={() => toggleAutoRotate()}
 *   onLabelsToggle={() => toggleLabels()}
 *   onFullscreenToggle={() => toggleFullscreen()}
 * />
 * ```
 */
export const Graph3DControlsToolbar: React.FC<Graph3DControlsToolbarProps> = ({
  state,
  onCameraReset,
  onAutoRotateToggle,
  onLabelsToggle,
  onFullscreenToggle,
  className = "",
}) => {
  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case "r":
          event.preventDefault();
          onCameraReset();
          break;
        case "a":
          event.preventDefault();
          onAutoRotateToggle();
          break;
        case "l":
          event.preventDefault();
          onLabelsToggle();
          break;
        case "f":
          event.preventDefault();
          onFullscreenToggle();
          break;
      }
    },
    [onCameraReset, onAutoRotateToggle, onLabelsToggle, onFullscreenToggle]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <div
      className={`exo-graph3d-toolbar ${className}`}
      role="toolbar"
      aria-label="3D Graph Controls"
      data-testid="graph3d-controls-toolbar"
    >
      <button
        type="button"
        className="exo-graph3d-toolbar__btn"
        onClick={onCameraReset}
        title="Reset camera (R)"
        aria-label="Reset camera to default view"
        data-testid="graph3d-btn-reset"
      >
        <CameraResetIcon />
      </button>

      <button
        type="button"
        className={`exo-graph3d-toolbar__btn ${state.autoRotate ? "exo-graph3d-toolbar__btn--active" : ""}`}
        onClick={onAutoRotateToggle}
        title={`Auto-rotate: ${state.autoRotate ? "ON" : "OFF"} (A)`}
        aria-label={`Toggle auto-rotate, currently ${state.autoRotate ? "on" : "off"}`}
        aria-pressed={state.autoRotate}
        data-testid="graph3d-btn-autorotate"
      >
        <AutoRotateIcon isActive={state.autoRotate} />
      </button>

      <button
        type="button"
        className={`exo-graph3d-toolbar__btn ${state.labelsVisible ? "exo-graph3d-toolbar__btn--active" : ""}`}
        onClick={onLabelsToggle}
        title={`Labels: ${state.labelsVisible ? "visible" : "hidden"} (L)`}
        aria-label={`Toggle labels visibility, currently ${state.labelsVisible ? "visible" : "hidden"}`}
        aria-pressed={state.labelsVisible}
        data-testid="graph3d-btn-labels"
      >
        <LabelsIcon isVisible={state.labelsVisible} />
      </button>

      <div className="exo-graph3d-toolbar__separator" />

      <button
        type="button"
        className={`exo-graph3d-toolbar__btn ${state.isFullscreen ? "exo-graph3d-toolbar__btn--active" : ""}`}
        onClick={onFullscreenToggle}
        title={`Fullscreen: ${state.isFullscreen ? "exit" : "enter"} (F)`}
        aria-label={`${state.isFullscreen ? "Exit" : "Enter"} fullscreen mode`}
        aria-pressed={state.isFullscreen}
        data-testid="graph3d-btn-fullscreen"
      >
        <FullscreenIcon isFullscreen={state.isFullscreen} />
      </button>
    </div>
  );
};
