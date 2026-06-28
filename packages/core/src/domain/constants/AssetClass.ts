export enum AssetClass {
  AREA = "ems__Area",
  TASK = "ems__Task",
  PROJECT = "ems__Project",
  /**
   * Action — a subclass of `ems__Effort` (RL#3, RFC pn__DailyNote toggles).
   * Used by the daily-efforts-by-class partition to carve `ems__Action`
   * instances of the day into their own «Actions» block, distinct from the
   * inclusive «Tasks» catch-all. The TBox `ems__Action` asset already declares
   * `exo__Class_superClass = ems__Effort`, so day-scoped Effort queries already
   * include actions; this enum entry names the class for the partition split.
   */
  ACTION = "ems__Action",
  MEETING = "ems__Meeting",
  INITIATIVE = "ems__Initiative",
  TASK_PROTOTYPE = "ems__TaskPrototype",
  MEETING_PROTOTYPE = "ems__MeetingPrototype",
  EVENT_PROTOTYPE = "exo__EventPrototype",
  PROJECT_PROTOTYPE = "ems__ProjectPrototype",
  EVENT = "exo__Event",
  DAILY_NOTE = "pn__DailyNote",
  CONCEPT = "ims__Concept",
  SESSION_START_EVENT = "ems__SessionStartEvent",
  SESSION_END_EVENT = "ems__SessionEndEvent",
  PROTOTYPE = "exo__Prototype",
  CLASS = "exo__Class",
  FLEETING_NOTE = "ztlk__FleetingNote",
  /** Workflow definition for an asset class (Issue #2358) */
  WORKFLOW = "ems__Workflow",
  /** State within a workflow (Issue #2358) */
  WORKFLOW_STATE = "ems__WorkflowState",
  /** Transition between workflow states (Issue #2358) */
  WORKFLOW_TRANSITION = "ems__WorkflowTransition",
  /** Dynamic command definition (RFC-009, Issue #2427) */
  COMMAND = "exocmd__Command",
  /** Precondition for command visibility (RFC-009, Issue #2427) */
  PRECONDITION = "exocmd__Precondition",
  /** Grounding action for command execution (RFC-009, Issue #2427) */
  GROUNDING = "exocmd__Grounding",
  /** Binding of command to asset context (RFC-009, Issue #2427) */
  COMMAND_BINDING = "exocmd__CommandBinding",
}
