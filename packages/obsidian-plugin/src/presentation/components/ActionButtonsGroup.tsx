import React, { useState } from "react";

/**
 * Semantic variants for action buttons. The `muted` variant (RFC-024 Phase 0)
 * is reserved for power-user / maintenance commands that should recede
 * visually so primary actions stay prominent.
 */
export type ActionButtonVariant =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "muted";

/**
 * Props for individual action buttons within the group
 */
export interface ActionButton {
  id: string;
  label: string;
  onClick: () => void | Promise<void>;
  variant?: ActionButtonVariant;
  visible?: boolean;
}

/**
 * Props for a group of related action buttons
 */
export interface ButtonGroup {
  id: string;
  title: string;
  buttons: ActionButton[];
  /**
   * When true, the group renders as a collapsible disclosure that starts
   * collapsed on first mount. Users toggle via the header. Used for
   * power-user / rare-use groups (e.g. Maintenance) so they do not dominate
   * panel real-estate during normal work.
   */
  collapsedByDefault?: boolean;
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
 * - Optional per-group collapsible disclosure (collapsedByDefault)
 */
export const ActionButtonsGroup: React.FC<ActionButtonsGroupProps> = ({
  groups,
}) => {
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      buttons: group.buttons.filter((btn) => btn.visible !== false),
    }))
    .filter((group) => group.buttons.length > 0);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of visibleGroups) {
      if (g.collapsedByDefault) initial[g.id] = true;
    }
    return initial;
  });

  if (visibleGroups.length === 0) {
    return null;
  }

  const toggle = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="exocortex-action-buttons-container">
      {visibleGroups.map((group, groupIndex) => {
        const isCollapsible = group.collapsedByDefault === true;
        const isCollapsed = collapsed[group.id] === true;
        return (
          <div key={group.id} className="exocortex-button-group">
            {isCollapsible ? (
              <button
                type="button"
                className="exocortex-button-group-title exocortex-button-group-title--collapsible"
                aria-expanded={!isCollapsed}
                aria-controls={`exocortex-button-group-body-${group.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(group.id);
                }}
              >
                <span className="exocortex-button-group-disclosure">
                  {isCollapsed ? "▶" : "▼"}
                </span>
                {group.title}
              </button>
            ) : (
              <div className="exocortex-button-group-title">{group.title}</div>
            )}
            {!(isCollapsible && isCollapsed) && (
              <div
                className="exocortex-button-group-buttons"
                id={`exocortex-button-group-body-${group.id}`}
              >
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
            )}
            {groupIndex < visibleGroups.length - 1 && (
              <div className="exocortex-button-group-separator" />
            )}
          </div>
        );
      })}
    </div>
  );
};
