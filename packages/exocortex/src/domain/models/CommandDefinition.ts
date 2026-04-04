import { GroundingType } from "../constants/GroundingType";

/**
 * Domain model for a dynamic command (RFC-009 Section 4.2.1).
 *
 * Represents WHAT to do and WHEN it is available.
 * Immutable after construction.
 */
export interface CommandDefinition {
  /** Asset UID of the command */
  readonly id: string;
  /** Human-readable label (e.g., "Remove start timestamp") */
  readonly name: string;
  /** Lucide icon name (e.g., "clock-x") */
  readonly icon?: string;
  /** Precondition that determines when the command is available */
  readonly precondition?: PreconditionDefinition;
  /** Action to execute when the command is invoked */
  readonly grounding: GroundingDefinition;
  /** Text shown in confirmation dialog */
  readonly confirmMessage?: string;
  /** Text shown after successful execution */
  readonly successMessage?: string;
  /** Category for grouping (e.g., "maintenance", "status") */
  readonly category?: string;
}

/**
 * Domain model for a precondition (RFC-009 Section 4.2.2).
 *
 * Determines WHEN a command button should be visible.
 * Uses SPARQL ASK query evaluated against the target asset.
 *
 * Variables in SPARQL:
 * - `$target` replaced with IRI of the current asset
 * - `$now` replaced with current timestamp (ISO 8601)
 * - `$user` replaced with IRI of the current user
 */
export interface PreconditionDefinition {
  /** Asset UID of the precondition */
  readonly id: string;
  /** Human-readable description (e.g., "Asset has startTimestamp") */
  readonly label: string;
  /** SPARQL ASK query (evaluated against triple store) */
  readonly sparqlAsk?: string;
  /** Host function name (evaluated via registered TypeScript function) */
  readonly hostFunction?: string;
}

/**
 * Domain model for a grounding action (RFC-009 Section 4.2.3).
 *
 * Defines WHAT happens when a command is executed.
 */
export interface GroundingDefinition {
  /** Asset UID of the grounding */
  readonly id: string;
  /** Human-readable description (e.g., "Delete startTimestamp") */
  readonly label: string;
  /** Type of grounding action */
  readonly type: GroundingType;
  /** Frontmatter property name (for property_delete / property_set) */
  readonly targetProperty?: string;
  /** Value to set (for property_set) */
  readonly targetValue?: string;
  /** SPARQL UPDATE query (for sparql_update) */
  readonly sparqlUpdate?: string;
  /** Ordered sub-steps (for composite type) */
  readonly steps?: readonly GroundingDefinition[];
}

/**
 * Domain model for a command binding (RFC-009 Section 4.2.4).
 *
 * Binds a command to a context: WHO sees the button.
 *
 * Resolution priority (specific → general):
 * 1. targetAsset — only for a specific asset
 * 2. targetPrototype — for all instances of a prototype
 * 3. targetClass — for all assets of a class
 *
 * At least one of targetClass, targetPrototype, targetAsset is required.
 */
export interface CommandBindingDefinition {
  /** Asset UID of the binding */
  readonly id: string;
  /** Human-readable description */
  readonly label: string;
  /** Reference to the Command asset (UID) */
  readonly commandRef: string;
  /** Apply to all assets of this class */
  readonly targetClass?: string;
  /** Apply to all instances of this prototype */
  readonly targetPrototype?: string;
  /** Apply to a specific asset */
  readonly targetAsset?: string;
  /** Where to render the button */
  readonly position?: string;
  /** Sort order (default: 100) */
  readonly order?: number;
  /** Button group name */
  readonly group?: string;
  /** Binding-level precondition overriding command-level precondition */
  readonly precondition?: PreconditionDefinition;
}

// -- Type Guards --

/**
 * Checks if frontmatter represents an exocmd__Command asset.
 * Uses exact class matching (not CONTAINS) to avoid false positives.
 */
export function isCommandFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__Command");
}

/**
 * Checks if frontmatter represents an exocmd__Precondition asset.
 */
export function isPreconditionFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__Precondition");
}

/**
 * Checks if frontmatter represents an exocmd__Grounding asset.
 */
export function isGroundingFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__Grounding");
}

/**
 * Checks if frontmatter represents an exocmd__CommandBinding asset.
 */
export function isCommandBindingFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__CommandBinding");
}

/**
 * Shared helper: checks if frontmatter's exo__Instance_class contains a specific class.
 * Handles both single string and array formats, with wikilink extraction.
 */
function hasInstanceClass(
  frontmatter: Record<string, unknown>,
  className: string,
): boolean {
  const instanceClass = frontmatter["exo__Instance_class"];
  if (instanceClass == null) {
    return false;
  }

  const classes = Array.isArray(instanceClass)
    ? instanceClass
    : [instanceClass];

  for (const cls of classes) {
    if (typeof cls !== "string") continue;

    // Extract class name from wikilink: [[exocmd__Command]] → exocmd__Command
    // Also handles [[uuid|Label]] format: extract the first part before |
    const match = cls.match(/\[\[([^|\]]+)/);
    const extracted = match ? match[1] : cls;

    if (extracted === className) {
      return true;
    }
  }

  return false;
}
