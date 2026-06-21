/**
 * Property constants for workflow ontology classes (Issue #2358).
 *
 * These constants define the frontmatter property names used by
 * ems__Workflow, ems__WorkflowState, and ems__WorkflowTransition assets.
 */

/** Properties for ems__Workflow assets */
export const WorkflowProperty = {
  /** Which asset class this workflow applies to (wikilink to class) */
  TARGET_CLASS: "ems__Workflow_targetClass",
  /** Starting status for new assets using this workflow */
  INITIAL_STATE: "ems__Workflow_initialState",
  /** Terminal statuses where workflow ends (array of wikilinks) */
  TERMINAL_STATES: "ems__Workflow_terminalStates",
  /** Whether this is the default workflow for the target class */
  IS_DEFAULT: "ems__Workflow_isDefault",
} as const;

/** Properties for ems__WorkflowState assets */
export const WorkflowStateProperty = {
  /** Parent workflow this state belongs to (wikilink) */
  WORKFLOW: "ems__WorkflowState_workflow",
  /** Linked EffortStatus value (wikilink) */
  STATUS: "ems__WorkflowState_status",
  /** Display order (number) */
  ORDER: "ems__WorkflowState_order",
  /** Whether this state can be skipped (boolean) */
  OPTIONAL: "ems__WorkflowState_optional",
  /** Timestamps to set when entering this state (array of property names) */
  TIMESTAMP_ON_ENTER: "ems__WorkflowState_timestampOnEnter",
  /** Badge color for UI display (CSS color string) */
  BADGE_COLOR: "ems__WorkflowState_badgeColor",
} as const;

/** Properties for ems__WorkflowTransition assets */
export const WorkflowTransitionProperty = {
  /** Parent workflow this transition belongs to (wikilink) */
  WORKFLOW: "ems__WorkflowTransition_workflow",
  /** Source status (wikilink) */
  FROM: "ems__WorkflowTransition_from",
  /** Target status (wikilink) */
  TO: "ems__WorkflowTransition_to",
  /** Button label text */
  LABEL: "ems__WorkflowTransition_label",
  /** Lucide icon name for the button */
  ICON: "ems__WorkflowTransition_icon",
  /** Whether this is a rollback transition */
  IS_ROLLBACK: "ems__WorkflowTransition_isRollback",
} as const;

/** Property on any effort asset to override the default workflow */
export const EFFORT_WORKFLOW_PROPERTY = "ems__Effort_workflow";
