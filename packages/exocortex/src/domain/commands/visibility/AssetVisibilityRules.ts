import type { CommandVisibilityContext } from "./types";
import {
  hasClass,
  isAreaOrProject,
  hasEmptyProperties,
  needsFolderRepair,
  extractDailyNoteDate,
  isCurrentDateGteDay,
  isPrototypeClass,
} from "./helpers";
import { AssetClass } from "../../constants";

/**
 * Asset Visibility Rules
 *
 * Contains visibility logic for general Asset commands.
 */

/**
 * Can execute "Create Event" command
 * Available for: ems__Area and ems__Project assets
 */
export function canCreateEvent(context: CommandVisibilityContext): boolean {
  return isAreaOrProject(context.instanceClass);
}

/**
 * Can execute "Create Instance" command
 * Available for: Any asset class that inherits from exo__Prototype
 *
 * This includes:
 * - Known prototype classes: ems__TaskPrototype, ems__MeetingPrototype, exo__EventPrototype, ems__ProjectPrototype
 * - Any custom class with exo__Class_superClass pointing to exo__Prototype (directly or transitively)
 *
 * The check works in two modes:
 * 1. Instance mode: Asset is an instance of a prototype class (checked via instanceClass)
 * 2. Class definition mode: Asset is a class that inherits from exo__Prototype (checked via metadata)
 */
export function canCreateInstance(context: CommandVisibilityContext): boolean {
  // Check for known prototype instance classes (backward compatibility)
  if (
    hasClass(context.instanceClass, AssetClass.TASK_PROTOTYPE) ||
    hasClass(context.instanceClass, AssetClass.MEETING_PROTOTYPE) ||
    hasClass(context.instanceClass, AssetClass.EVENT_PROTOTYPE) ||
    hasClass(context.instanceClass, AssetClass.PROJECT_PROTOTYPE)
  ) {
    return true;
  }

  // Check if asset is a class definition that inherits from exo__Prototype
  return isPrototypeClass(context.instanceClass, context.metadata);
}

/**
 * Can execute "Clean Empty Properties" command
 * Available for: Any asset with empty properties
 */
export function canCleanProperties(context: CommandVisibilityContext): boolean {
  return hasEmptyProperties(context.metadata);
}

/**
 * Can execute "Repair Folder" command
 * Available for: Any asset in wrong folder (based on exo__Asset_isDefinedBy)
 */
export function canRepairFolder(context: CommandVisibilityContext): boolean {
  return needsFolderRepair(context.currentFolder, context.expectedFolder);
}

/**
 * Can execute "Rename to UID" command
 * Available for: Any asset where filename doesn't match exo__Asset_uid
 * Excluded: ims__Concept assets (concepts should keep their semantic names)
 */
export function canRenameToUid(
  context: CommandVisibilityContext,
  currentFilename: string,
): boolean {
  const uid = context.metadata.exo__Asset_uid;
  if (!uid) return false;

  if (hasClass(context.instanceClass, AssetClass.CONCEPT)) return false;

  return currentFilename !== uid;
}

/**
 * Can execute "Copy Label to Aliases" command
 * Available for: Assets with exo__Asset_label that don't have this label in aliases yet
 */
export function canCopyLabelToAliases(
  context: CommandVisibilityContext,
): boolean {
  const label = context.metadata.exo__Asset_label;
  if (!label || typeof label !== "string" || label.trim() === "") return false;

  const trimmedLabel = label.trim();
  const aliases = context.metadata.aliases;

  if (!aliases) return true;

  if (!Array.isArray(aliases)) return true;

  if (aliases.length === 0) return true;

  return !aliases.some((alias) => {
    if (typeof alias !== "string") return false;
    return alias.trim() === trimmedLabel;
  });
}

/**
 * Can execute "Create Narrower Concept" command
 * Available for: ims__Concept assets
 */
export function canCreateNarrowerConcept(
  context: CommandVisibilityContext,
): boolean {
  return hasClass(context.instanceClass, AssetClass.CONCEPT);
}

/**
 * Can execute "Create Subclass" command
 * Available for: exo__Class assets
 */
export function canCreateSubclass(
  context: CommandVisibilityContext,
): boolean {
  return hasClass(context.instanceClass, AssetClass.CLASS);
}

/**
 * Can execute "Create Task for DailyNote" command
 * Available for: pn__DailyNote assets when current date >= pn__DailyNote_day
 */
export function canCreateTaskForDailyNote(
  context: CommandVisibilityContext,
): boolean {
  if (!hasClass(context.instanceClass, AssetClass.DAILY_NOTE)) return false;
  if (context.isArchived) return false;

  const dailyNoteDate = extractDailyNoteDate(context.metadata);
  if (!dailyNoteDate) return false;

  return isCurrentDateGteDay(dailyNoteDate);
}
