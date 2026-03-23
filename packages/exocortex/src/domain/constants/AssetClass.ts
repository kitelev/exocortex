export enum AssetClass {
  AREA = "ems__Area",
  TASK = "ems__Task",
  PROJECT = "ems__Project",
  MEETING = "ems__Meeting",
  INITIATIVE = "ems__Initiative",
  TASK_PROTOTYPE = "ems__TaskPrototype",
  /** UID-based identifier for ems__TaskPrototype (Issue #2110) */
  TASK_PROTOTYPE_UID = "75302770-279e-4a59-ba85-09df29725713",
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
  /** UID-based identifier for ztlk__FleetingNote (Issue #2200) */
  FLEETING_NOTE_UID = "fca0a931-a01f-48e4-b72a-4af206c94bc7",
  /** Workflow definition for an asset class (Issue #2358) */
  WORKFLOW = "ems__Workflow",
  /** State within a workflow (Issue #2358) */
  WORKFLOW_STATE = "ems__WorkflowState",
  /** Transition between workflow states (Issue #2358) */
  WORKFLOW_TRANSITION = "ems__WorkflowTransition",
}
