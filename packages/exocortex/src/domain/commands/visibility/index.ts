/**
 * Command Visibility Facade
 *
 * Re-exports all visibility functions for backward compatibility.
 * Allows existing code to import from single location.
 *
 * Usage:
 *   import { canCreateTask } from "domain/commands/visibility";
 *   import { canCreateTask } from "domain/commands/visibility/TaskVisibilityRules";
 */

// Types
export type { CommandVisibilityContext } from "./types";

// Helper utilities (for internal use, but exported for testing)
export {
  hasClass,
  isAreaOrProject,
  isEffort,
  hasStatus,
  isAssetArchived,
  hasEmptyProperties,
  needsFolderRepair,
  getTodayDateString,
  isPlannedForToday,
  hasPlannedStartTimestamp,
  extractDailyNoteDate,
  isCurrentDateGteDay,
  inheritsFromPrototype,
  isPrototypeClass,
} from "./helpers";

// Task visibility rules
export {
  canCreateTask,
  canCreateRelatedTask,
  canConvertTaskToProject,
} from "./TaskVisibilityRules";

// Project visibility rules
export {
  canCreateProject,
  canMoveToAnalysis,
  canMoveToToDo,
  canConvertProjectToTask,
} from "./ProjectVisibilityRules";

// Area visibility rules
export {
  canCreateChildArea,
  canSetActiveFocus,
} from "./AreaVisibilityRules";

// Effort visibility rules
export {
  canPlanOnToday,
  canPlanForEvening,
  canShiftDayBackward,
  canShiftDayForward,
  canSetDraftStatus,
  canMoveToBacklog,
  canStartEffort,
  canMarkDone,
  canTrashEffort,
  canVoteOnEffort,
  canRollbackStatus,
  canArchiveTask,
} from "./EffortVisibilityRules";

// Asset visibility rules
export {
  canCreateEvent,
  canCreateInstance,
  canCleanProperties,
  canRepairFolder,
  canRenameToUid,
  canCopyLabelToAliases,
  canCreateNarrowerConcept,
  canCreateSubclass,
  canCreateTaskForDailyNote,
} from "./AssetVisibilityRules";
