/**
 * Command Visibility Facade
 *
 * Re-exports the CommandVisibilityContext type and shared visibility helper
 * utilities. The per-class canX predicate rules were removed together with the
 * pre-homoiconic command layer (see #3384); visibility is now driven by
 * vault-declared exocmd__Command preconditions.
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
