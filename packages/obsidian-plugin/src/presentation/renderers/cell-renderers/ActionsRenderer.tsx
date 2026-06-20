/**
 * ActionsRenderer - Renders action buttons for layout rows
 *
 * Displays a set of command buttons based on LayoutActions configuration.
 * Each button can:
 * - Show an icon and/or label
 * - Have visibility controlled by a SPARQL ASK precondition
 * - Execute a SPARQL UPDATE when clicked
 *
 * @module presentation/renderers/cell-renderers
 * @since 1.0.0
 */
import React, { useState, useEffect, useCallback } from "react";
import type { CommandRef, LayoutActions } from "../../../domain/layout";

/**
 * Icon mapping from Lucide icon names to emoji or Unicode symbols.
 * These match common command icons from the ontology.
 */
const iconMap: Record<string, string> = {
  // Task status icons
  "play-circle": "▶️",
  "play": "▶️",
  "stop-circle": "⏹️",
  "stop": "⏹️",
  "check-circle": "✅",
  "check": "✅",
  "circle-check": "✅",
  "pause-circle": "⏸️",
  "pause": "⏸️",

  // Common action icons
  "refresh-cw": "🔄",
  "rotate-cw": "🔄",
  "trash-2": "🗑️",
  "trash": "🗑️",
  "edit": "✏️",
  "pencil": "✏️",
  "plus": "➕",
  "plus-circle": "➕",
  "minus": "➖",
  "minus-circle": "➖",
  "star": "⭐",
  "heart": "❤️",
  "flag": "🚩",
  "archive": "📦",
  "folder": "📁",
  "file": "📄",
  "copy": "📋",
  "link": "🔗",
  "eye": "👁️",
  "eye-off": "🙈",
  "clock": "⏰",
  "calendar": "📅",
  "user": "👤",
  "users": "👥",
  "mail": "📧",
  "send": "📤",
  "download": "📥",
  "upload": "📤",
  "settings": "⚙️",
  "more-horizontal": "⋯",
  "more-vertical": "⋮",
};

/**
 * Get display icon for a command
 */
function getIcon(iconName?: string): string {
  if (!iconName) return "⚡";
  return iconMap[iconName] || iconMap[iconName.toLowerCase()] || "⚡";
}

/**
 * Props for ActionsRenderer component
 */
export interface ActionsRendererProps {
  /**
   * The LayoutActions definition
   */
  actions: LayoutActions;

  /**
   * URI of the asset this row represents
   */
  assetUri: string;

  /**
   * Path to the asset file (for display)
   */
  assetPath?: string;

  /**
   * Callback to check if a command precondition is satisfied.
   * Returns true if the command should be visible/enabled.
   * @param sparql - The SPARQL ASK query with $target placeholder
   * @param assetUri - The URI to substitute for $target
   */
  onCheckPrecondition?: (sparql: string, assetUri: string) => Promise<boolean>;

  /**
   * Callback to execute a command grounding.
   * @param sparql - The SPARQL UPDATE query with $target and $now placeholders
   * @param assetUri - The URI to substitute for $target
   */
  onExecuteCommand?: (sparql: string, assetUri: string) => Promise<void>;

  /**
   * Whether buttons are disabled (e.g., during execution)
   */
  disabled?: boolean;

  /**
   * Callback to surface a user-facing error message (e.g. a Notice toast).
   *
   * Without this, action-button failures — a missing executor, a command with
   * no grounding, or an execution that throws — are swallowed to the console
   * and the button silently no-ops (#3628). When provided, those conditions are
   * reported to the user instead of failing silently.
   */
  onError?: (message: string) => void;

  /**
   * Custom class name
   */
  className?: string;
}

/**
 * State for each command button
 */
interface CommandState {
  visible: boolean;
  loading: boolean;
  executing: boolean;
}

/**
 * ActionsRenderer - Renders action buttons for a layout row
 */
export const ActionsRenderer: React.FC<ActionsRendererProps> = ({
  actions,
  assetUri,
  assetPath,
  onCheckPrecondition,
  onExecuteCommand,
  onError,
  disabled = false,
  className,
}) => {
  const { commands, showLabels, position } = actions;

  // State for each command
  const [commandStates, setCommandStates] = useState<Record<string, CommandState>>(() => {
    const initial: Record<string, CommandState> = {};
    for (const cmd of commands) {
      initial[cmd.uid] = {
        visible: !cmd.preconditionSparql, // Visible by default if no precondition
        loading: !!cmd.preconditionSparql, // Loading if has precondition
        executing: false,
      };
    }
    return initial;
  });

  // Check preconditions on mount and when assetUri changes
  useEffect(() => {
    const checkPreconditions = async () => {
      if (!onCheckPrecondition) {
        // No precondition checker, show all commands
        setCommandStates((prev) => {
          const next: Record<string, CommandState> = {};
          for (const cmd of commands) {
            next[cmd.uid] = { ...prev[cmd.uid], visible: true, loading: false };
          }
          return next;
        });
        return;
      }

      // Check each command's precondition
      for (const cmd of commands) {
        if (!cmd.preconditionSparql) {
          setCommandStates((prev) => ({
            ...prev,
            [cmd.uid]: { ...prev[cmd.uid], visible: true, loading: false },
          }));
          continue;
        }

        try {
          const result = await onCheckPrecondition(cmd.preconditionSparql, assetUri);
          setCommandStates((prev) => ({
            ...prev,
            [cmd.uid]: { ...prev[cmd.uid], visible: result, loading: false },
          }));
        } catch (error) {
          console.error(`Precondition check failed for ${cmd.label}:`, error);
          // Hide on error
          setCommandStates((prev) => ({
            ...prev,
            [cmd.uid]: { ...prev[cmd.uid], visible: false, loading: false },
          }));
        }
      }
    };

    checkPreconditions();
  }, [assetUri, commands, onCheckPrecondition]);

  // Handle button click
  const handleClick = useCallback(
    async (cmd: CommandRef, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Surface why a click had no effect instead of silently bailing (#3628):
      // a command with no grounding, or no executor wired by the host, used to
      // log to the console and no-op — indistinguishable from a broken button.
      if (!cmd.groundingSparql) {
        const message = `No action is configured for "${cmd.label}".`;
        console.warn(message);
        onError?.(message);
        return;
      }
      if (!onExecuteCommand) {
        const message = `Cannot run "${cmd.label}": no command executor is available for layout actions.`;
        console.warn(message);
        onError?.(message);
        return;
      }

      // Set executing state
      setCommandStates((prev) => ({
        ...prev,
        [cmd.uid]: { ...prev[cmd.uid], executing: true },
      }));

      try {
        await onExecuteCommand(cmd.groundingSparql, assetUri);

        // After execution, re-check all preconditions (state may have changed)
        if (onCheckPrecondition) {
          for (const c of commands) {
            if (!c.preconditionSparql) continue;
            try {
              const result = await onCheckPrecondition(c.preconditionSparql, assetUri);
              setCommandStates((prev) => ({
                ...prev,
                [c.uid]: { ...prev[c.uid], visible: result },
              }));
            } catch {
              // Keep current visibility on error
            }
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`Command execution failed for ${cmd.label}:`, error);
        onError?.(`Failed to run "${cmd.label}": ${detail}`);
      } finally {
        setCommandStates((prev) => ({
          ...prev,
          [cmd.uid]: { ...prev[cmd.uid], executing: false },
        }));
      }
    },
    [assetUri, commands, onCheckPrecondition, onExecuteCommand, onError],
  );

  // Render a single button
  const renderButton = (cmd: CommandRef) => {
    const state = commandStates[cmd.uid];
    if (!state) return null;

    // Hide if loading or not visible
    if (state.loading) {
      return (
        <span
          key={cmd.uid}
          className="exo-action-button exo-action-button-loading"
          title="Loading..."
        >
          ⏳
        </span>
      );
    }

    if (!state.visible) {
      return null;
    }

    const icon = getIcon(cmd.icon);
    const isDisabled = disabled || state.executing;

    return (
      <button
        key={cmd.uid}
        className={`exo-action-button ${state.executing ? "exo-action-button-executing" : ""} ${isDisabled ? "exo-action-button-disabled" : ""}`}
        onClick={(e) => handleClick(cmd, e)}
        disabled={isDisabled}
        title={cmd.label}
        aria-label={cmd.label}
        data-command-uid={cmd.uid}
      >
        <span className="exo-action-button-icon">{state.executing ? "⏳" : icon}</span>
        {showLabels && <span className="exo-action-button-label">{cmd.label}</span>}
      </button>
    );
  };

  // Get position-specific class
  const positionClass = `exo-actions-${position || "column"}`;

  return (
    <div
      className={`exo-actions-container ${positionClass} ${className || ""}`}
      data-asset-uri={assetUri}
      data-asset-path={assetPath}
    >
      {commands.map(renderButton)}
    </div>
  );
};

export default ActionsRenderer;
