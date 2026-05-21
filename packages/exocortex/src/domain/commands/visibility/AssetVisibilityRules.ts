import type { CommandVisibilityContext } from "./types";
import {
  hasClass,
  isAreaOrProject,
  hasEmptyProperties,
  needsFolderRepair,
  extractDailyNoteDate,
  isPrototypeClass,
} from "./helpers";
import { AssetClass } from "../../constants";

/**
 * Vault-specific UIDs for backward compatibility.
 * These are resolved dynamically via IVaultSettings for creation services,
 * but visibility rules still need to match raw UID strings that may appear
 * in exo__Instance_class frontmatter until full class-name resolution
 * is implemented at the plugin layer.
 *
 * @internal — prefer dynamic resolution via IVaultSettings
 */
const KNOWN_TASK_PROTOTYPE_UID = "75302770-279e-4a59-ba85-09df29725713";
const KNOWN_FLEETING_NOTE_UID = "fca0a931-a01f-48e4-b72a-4af206c94bc7";

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
  // Includes both string-based and UID-based identifiers (Issue #2110)
  if (
    hasClass(context.instanceClass, AssetClass.TASK_PROTOTYPE) ||
    hasClass(context.instanceClass, KNOWN_TASK_PROTOTYPE_UID) ||
    hasClass(context.instanceClass, AssetClass.MEETING_PROTOTYPE) ||
    hasClass(context.instanceClass, AssetClass.EVENT_PROTOTYPE) ||
    hasClass(context.instanceClass, AssetClass.PROJECT_PROTOTYPE)
  ) {
    return true;
  }

  // Check if asset is an instance of exo__Prototype (Issue #2261)
  // This covers any custom prototype class (e.g., ztlk__FleetingNotePrototype)
  if (hasClass(context.instanceClass, AssetClass.PROTOTYPE)) {
    return true;
  }

  // Check if the asset's class (resolved by plugin) is a prototype (Issue #2261)
  // This covers instances whose instanceClass is a UUID pointing to a prototype
  if (context.classIsPrototype) {
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
 * Available for: all pn__DailyNote assets (past, present, and future dates)
 */
export function canCreateTaskForDailyNote(
  context: CommandVisibilityContext,
): boolean {
  if (!hasClass(context.instanceClass, AssetClass.DAILY_NOTE)) return false;
  if (context.isArchived) return false;

  const dailyNoteDate = extractDailyNoteDate(context.metadata);
  if (!dailyNoteDate) return false;

  return true;
}

/**
 * Can execute "Copy Label" command for fleeting notes
 * Available for: ztlk__FleetingNote assets only
 * Supports both string-based and UID-based identifiers
 */
export function canCopyFleetingNoteLabel(
  context: CommandVisibilityContext,
): boolean {
  return (
    hasClass(context.instanceClass, AssetClass.FLEETING_NOTE) ||
    hasClass(context.instanceClass, KNOWN_FLEETING_NOTE_UID)
  );
}
