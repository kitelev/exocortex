import { WikiLinkHelpers } from "../../../utilities/WikiLinkHelpers";
import { AssetClass } from "../../constants";

/**
 * Command Visibility Helper Functions
 *
 * Pure utility functions used across visibility rule files.
 * These functions handle common checks for instance classes, status, and metadata.
 */

/**
 * Check if instanceClass contains specific class
 */
export function hasClass(
  instanceClass: string | string[] | null,
  targetClass: string,
): boolean {
  if (!instanceClass) return false;

  const classes = Array.isArray(instanceClass)
    ? instanceClass
    : [instanceClass];

  return classes.some((cls) => WikiLinkHelpers.normalize(cls) === targetClass);
}

/**
 * Check if instanceClass is ems__Area or ems__Project
 */
export function isAreaOrProject(instanceClass: string | string[] | null): boolean {
  return (
    hasClass(instanceClass, AssetClass.AREA) ||
    hasClass(instanceClass, AssetClass.PROJECT)
  );
}

/**
 * Check if instanceClass is ems__Task, ems__Project, or ems__Meeting
 */
export function isEffort(instanceClass: string | string[] | null): boolean {
  return (
    hasClass(instanceClass, AssetClass.TASK) ||
    hasClass(instanceClass, AssetClass.PROJECT) ||
    hasClass(instanceClass, AssetClass.MEETING)
  );
}

/**
 * Check if current status matches target status
 */
export function hasStatus(
  currentStatus: string | string[] | null,
  targetStatus: string,
): boolean {
  if (!currentStatus) return false;

  const statusValue = Array.isArray(currentStatus)
    ? currentStatus[0]
    : currentStatus;

  if (!statusValue) return false;

  const cleanStatus = WikiLinkHelpers.normalize(statusValue);
  return cleanStatus === targetStatus;
}

/**
 * Check if asset is archived
 * Supports multiple formats: true, "true", "yes", 1
 */
export function isAssetArchived(isArchived: unknown): boolean {
  if (isArchived === true || isArchived === 1) return true;
  if (typeof isArchived === "string") {
    const lowerValue = isArchived.toLowerCase();
    return lowerValue === "true" || lowerValue === "yes";
  }
  return false;
}

/**
 * Check if metadata has empty properties
 */
export function hasEmptyProperties(metadata: Record<string, unknown>): boolean {
  if (!metadata || Object.keys(metadata).length === 0) return false;

  return Object.values(metadata).some((value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      return true;
    return false;
  });
}

/**
 * Check if folder needs repair
 */
export function needsFolderRepair(
  currentFolder: string,
  expectedFolder: string | null,
): boolean {
  if (!expectedFolder) return false;

  const normalizedCurrent = currentFolder.replace(/\/$/, "");
  const normalizedExpected = expectedFolder.replace(/\/$/, "");

  return normalizedCurrent !== normalizedExpected;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Check if ems__Effort_plannedStartTimestamp is set to today's date
 * Handles timestamp format: YYYY-MM-DDTHH:MM:SS
 */
export function isPlannedForToday(metadata: Record<string, unknown>): boolean {
  const plannedTimestamp = metadata.ems__Effort_plannedStartTimestamp;
  if (!plannedTimestamp) return false;

  const todayString = getTodayDateString();

  if (typeof plannedTimestamp === "string") {
    const datePart = plannedTimestamp.split("T")[0];
    return datePart === todayString;
  }

  if (Array.isArray(plannedTimestamp) && plannedTimestamp.length > 0) {
    const datePart = String(plannedTimestamp[0]).split("T")[0];
    return datePart === todayString;
  }

  return false;
}

/**
 * Check if ems__Effort_plannedStartTimestamp property exists
 */
export function hasPlannedStartTimestamp(metadata: Record<string, unknown>): boolean {
  const plannedTimestamp = metadata.ems__Effort_plannedStartTimestamp;
  if (!plannedTimestamp) return false;

  if (typeof plannedTimestamp === "string") {
    return plannedTimestamp.trim().length > 0;
  }

  if (Array.isArray(plannedTimestamp) && plannedTimestamp.length > 0) {
    const value = String(plannedTimestamp[0]).trim();
    return value.length > 0;
  }

  return false;
}

/**
 * Extract date string from pn__DailyNote_day property
 * Handles wiki-link format: [[2025-11-11]] -> 2025-11-11
 */
export function extractDailyNoteDate(metadata: Record<string, unknown>): string | null {
  const dayProperty = metadata.pn__DailyNote_day;
  if (!dayProperty) return null;

  if (typeof dayProperty === "string") {
    const wikiLinkMatch = dayProperty.match(/\[\[(.+?)\]\]/);
    return wikiLinkMatch ? wikiLinkMatch[1] : dayProperty;
  }

  if (Array.isArray(dayProperty) && dayProperty.length > 0) {
    const firstValue = String(dayProperty[0]);
    const wikiLinkMatch = firstValue.match(/\[\[(.+?)\]\]/);
    return wikiLinkMatch ? wikiLinkMatch[1] : firstValue;
  }

  return null;
}

/**
 * Check if current date is greater than or equal to DailyNote date
 */
export function isCurrentDateGteDay(dailyNoteDate: string): boolean {
  const today = getTodayDateString();
  return today >= dailyNoteDate;
}

/**
 * Normalize a value by removing quotes, wiki-link brackets, and trimming whitespace.
 *
 * This handles various frontmatter formats:
 * - `[[exo__Prototype]]` → `exo__Prototype`
 * - `"[[exo__Prototype]]"` → `exo__Prototype`
 * - `exo__Prototype` → `exo__Prototype`
 *
 * @param value - The value to normalize
 * @returns The normalized string
 */
function normalizeWithQuotes(value: string | null | undefined): string {
  if (!value) return "";
  // Remove quotes first, then wiki-link brackets
  return value.replace(/^["']|["']$/g, "").replace(/\[\[|\]\]/g, "").trim();
}

/**
 * Maximum depth for class hierarchy traversal.
 * Prevents infinite loops in case of circular inheritance.
 */
const MAX_INHERITANCE_DEPTH = 10;

/**
 * Check if class inherits from exo__Prototype (directly or transitively)
 *
 * This function traverses the superclass chain via exo__Class_superClass property
 * until finding exo__Prototype or reaching max depth. It supports transitive inheritance
 * by looking up parent class metadata using a flat namespace pattern:
 *
 * For a class "custom__MyPrototype" with superclass "custom__BasePrototype",
 * the metadata should contain:
 * - exo__Class_superClass: "custom__BasePrototype" (current class's superclass)
 * - "custom__BasePrototype__exo__Class_superClass": "exo__Prototype" (parent's superclass)
 *
 * The function uses BFS traversal with visited set to handle:
 * - Direct inheritance: exo__Class_superClass contains exo__Prototype
 * - Transitive inheritance: Walking through multiple levels of class hierarchy
 * - Circular inheritance: Detected via visited set, returns false
 *
 * @param metadata - The frontmatter metadata containing class hierarchy information
 * @param maxDepth - Maximum traversal depth (default: 10)
 * @returns true if the class inherits from exo__Prototype
 */
export function inheritsFromPrototype(
  metadata: Record<string, unknown>,
  maxDepth: number = MAX_INHERITANCE_DEPTH,
): boolean {
  // Start with the current class's superclass
  const initialSuperClass = metadata.exo__Class_superClass;
  if (!initialSuperClass) return false;

  const visited = new Set<string>();
  const queue: Array<{ className: string; depth: number }> = [];

  // Initialize queue with direct superclasses
  const initialSuperClasses = Array.isArray(initialSuperClass)
    ? initialSuperClass
    : [initialSuperClass];

  for (const cls of initialSuperClasses) {
    const normalized = normalizeWithQuotes(cls);
    if (normalized) {
      queue.push({ className: normalized, depth: 0 });
    }
  }

  // BFS traversal of class hierarchy
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const { className, depth } = item;

    // Stop at max depth to prevent infinite loops
    if (depth > maxDepth) continue;

    // Found target class
    if (className === AssetClass.PROTOTYPE) return true;

    // Skip if already visited (handles circular inheritance)
    if (visited.has(className)) continue;
    visited.add(className);

    // Look up parent class's superclass using flat namespace pattern
    // e.g., "custom__BasePrototype__exo__Class_superClass"
    const parentSuperClassKey = `${className}__exo__Class_superClass`;
    const parentSuperClass = metadata[parentSuperClassKey];

    if (parentSuperClass) {
      const parentSuperClasses = Array.isArray(parentSuperClass)
        ? parentSuperClass
        : [parentSuperClass];

      for (const parentCls of parentSuperClasses) {
        const normalized = normalizeWithQuotes(parentCls);
        if (normalized && !visited.has(normalized)) {
          queue.push({ className: normalized, depth: depth + 1 });
        }
      }
    }
  }

  return false;
}

/**
 * Check if an asset is a prototype class definition.
 *
 * An asset is considered a prototype class if:
 * 1. It is a class definition (exo__Instance_class contains exo__Class)
 * 2. Its superclass chain includes exo__Prototype (directly or transitively via exo__Class_superClass)
 *
 * This is the main function for determining "Create Instance" button visibility
 * for any class that inherits from exo__Prototype, not just hardcoded types.
 *
 * Transitive inheritance example:
 * ```
 * exo__Prototype
 * └── custom__BasePrototype
 *     └── custom__MySpecificPrototype  ← "Create Instance" button appears here
 * ```
 *
 * The metadata should contain the full class hierarchy using flat namespace pattern:
 * - exo__Class_superClass: "custom__BasePrototype" (current class's superclass)
 * - "custom__BasePrototype__exo__Class_superClass": "exo__Prototype" (parent's superclass)
 *
 * @param instanceClass - The exo__Instance_class property value
 * @param metadata - The frontmatter metadata containing class hierarchy information
 * @returns true if the asset is a prototype class that can create instances
 */
export function isPrototypeClass(
  instanceClass: string | string[] | null,
  metadata: Record<string, unknown>,
): boolean {
  // First, check if this asset is a class definition
  if (!hasClass(instanceClass, AssetClass.CLASS)) return false;

  // Then, check if it inherits from exo__Prototype (directly or transitively)
  return inheritsFromPrototype(metadata);
}
