import React from "react";

export type ViewMode = "table" | "list" | "graph" | "graph3d";

export interface ViewModeSelectorProps {
  currentMode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  availableModes: ViewMode[];
}

export const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({
  currentMode,
  onModeChange,
  availableModes,
}) => {
  const modeLabels: Record<ViewMode, string> = {
    table: "table",
    list: "list",
    graph: "graph",
    graph3d: "3D graph",
  };

  const modeIcons: Record<ViewMode, string> = {
    table: "▤",
    list: "☰",
    graph: "●—●",
    graph3d: "◇",
  };

  return (
    <div className="sparql-view-mode-selector">
      {availableModes.map((mode) => (
        <button
          key={mode}
          className={`sparql-view-mode-button ${currentMode === mode ? "active" : ""}`}
          onClick={() => onModeChange(mode)}
          aria-label={`switch to ${mode} view`}
          aria-pressed={currentMode === mode}
        >
          <span className="sparql-view-mode-icon">{modeIcons[mode]}</span>
          <span className="sparql-view-mode-label">{modeLabels[mode]}</span>
        </button>
      ))}
    </div>
  );
};
