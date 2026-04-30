import React, { useEffect, useRef, useState } from "react";
import { setIcon } from "obsidian";

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
  /**
   * Optional Lucide icon name (RFC-024 §4 Phase 2 — T5.3).
   *
   * When set, the button renders an SVG icon to the left of the label using
   * Obsidian's `setIcon` helper, which writes the bundled Lucide SVG into the
   * supplied element. The DOM-mutation bridge is implemented inside
   * `ActionButtonsGroup` via `useRef` + `useEffect`, so callers may simply
   * propagate `command.icon` from the resolved binding.
   *
   * No-op when undefined or empty — preserves the no-icon baseline established
   * before T5.3.
   */
  icon?: string;
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
 * Renders a single action button.
 *
 * RFC-024 §4 Phase 2 — T5.3: when `button.icon` is set, an icon container is
 * mounted before the label and `setIcon(ref, iconName)` is invoked from a
 * `useEffect` whose cleanup empties the container before the next icon swap
 * (and on unmount). This keeps the React/Obsidian boundary explicit — Obsidian
 * mutates the DOM, React owns the container reference and lifecycle.
 *
 * The Obsidian `setIcon` helper writes the Lucide SVG into the supplied
 * element. We intentionally do not memoize on `button.icon`: a fresh render
 * with the same icon name is harmless (cleanup empties the host element first)
 * and keeps the swap path identical to the mount path.
 */
const ActionButtonView: React.FC<{ button: ActionButton }> = ({ button }) => {
  const iconRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const host = iconRef.current;
    if (host === null) return;
    if (!button.icon) return;
    setIcon(host, button.icon);
    return () => {
      // Drop the SVG before the next icon name takes effect (or on unmount)
      // so we do not stack icons under DOM mutation in development StrictMode.
      while (host.firstChild) host.removeChild(host.firstChild);
    };
  }, [button.icon]);

  return (
    <button
      className={`exocortex-action-button exocortex-action-button--${button.variant || "secondary"}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await button.onClick();
      }}
    >
      {button.icon ? (
        <span
          ref={iconRef}
          className="exocortex-action-button-icon"
          aria-hidden="true"
        />
      ) : null}
      <span className="exocortex-action-button-label">{button.label}</span>
    </button>
  );
};

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
                  <ActionButtonView key={button.id} button={button} />
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
