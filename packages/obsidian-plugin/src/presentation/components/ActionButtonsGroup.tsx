import React from "react";

/**
 * Props for individual action buttons within the group
 */
export interface ActionButton {
  id: string;
  label: string;
  onClick: () => void | Promise<void>;
  variant?: "primary" | "secondary" | "success" | "warning" | "danger";
  visible?: boolean;
  /** Lucide icon name (optional) */
  icon?: string;
  /** Tooltip text (optional) */
  tooltip?: string;
}

/**
 * Props for a group of related action buttons
 */
export interface ButtonGroup {
  id: string;
  title: string;
  buttons: ActionButton[];
}

/**
 * Props for the ActionButtonsGroup component
 */
export interface ActionButtonsGroupProps {
  groups: ButtonGroup[];
}

/**
 * ActionButtonsGroup Component
 *
 * Displays action buttons organized into semantic groups with beautiful styling.
 * Each group represents a logical category of actions (e.g., Status, Planning, Maintenance).
 *
 * Features:
 * - Semantic grouping with visual separators
 * - Color-coded button variants for different action types
 * - Responsive layout adapting to screen size
 * - Clean, modern design with proper spacing
 */
export const ActionButtonsGroup: React.FC<ActionButtonsGroupProps> = ({
  groups,
}) => {
  // Filter out groups with no visible buttons
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      buttons: group.buttons.filter((btn) => btn.visible !== false),
    }))
    .filter((group) => group.buttons.length > 0);

  if (visibleGroups.length === 0) {
    return null;
  }

  return (
    <div className="exocortex-action-buttons-container">
      {visibleGroups.map((group, groupIndex) => (
        <div key={group.id} className="exocortex-button-group">
          <div className="exocortex-button-group-title">{group.title}</div>
          <div className="exocortex-button-group-buttons">
            {group.buttons.map((button) => (
              <button
                key={button.id}
                className={`exocortex-action-button exocortex-action-button--${button.variant || "secondary"}`}
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  await button.onClick();
                }}
              >
                {button.label}
              </button>
            ))}
          </div>
          {groupIndex < visibleGroups.length - 1 && (
            <div className="exocortex-button-group-separator" />
          )}
        </div>
      ))}
    </div>
  );
};
