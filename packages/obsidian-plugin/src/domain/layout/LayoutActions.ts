/**
 * LayoutActions Domain Model
 *
 * Defines the structure for action buttons that can be displayed in layout rows.
 * Maps to ontology class: exo__LayoutActions
 *
 * @module domain/layout
 * @since 1.0.0
 */

/**
 * Position where action buttons should be displayed
 */
export type ActionPosition = "column" | "inline" | "hover" | "contextMenu";

/**
 * Reference to a command that can be executed as an action button
 */
export interface CommandRef {
  /**
   * Unique identifier of the command.
   * Corresponds to exo__Asset_uid.
   */
  uid: string;

  /**
   * Human-readable label for the command.
   * Corresponds to exo__Asset_label.
   */
  label: string;

  /**
   * Icon identifier for the button.
   * Corresponds to exo__Command_icon.
   * Uses Lucide icon names (e.g., "play-circle", "stop-circle", "check-circle")
   */
  icon?: string;

  /**
   * SPARQL ASK query to check if command is applicable.
   * The query should use $target as placeholder for the asset URI.
   * If the query returns true, the command button is visible/enabled.
   */
  preconditionSparql?: string;

  /**
   * SPARQL UPDATE query to execute when the button is clicked.
   * Uses $target for the asset URI and $now for current timestamp.
   */
  groundingSparql?: string;
}

/**
 * LayoutActions interface.
 * Defines a set of action buttons for layout rows.
 *
 * Maps to ontology class: exo__LayoutActions
 *
 * Properties from ontology:
 * - exo__LayoutActions_commands: List of command references
 * - exo__LayoutActions_position: Where to display buttons
 * - exo__LayoutActions_showLabels: Whether to show text labels
 */
export interface LayoutActions {
  /**
   * Unique identifier for the LayoutActions definition.
   * Corresponds to exo__Asset_uid.
   */
  uid: string;

  /**
   * Human-readable label.
   * Corresponds to exo__Asset_label.
   */
  label: string;

  /**
   * List of commands to display as buttons.
   * Maps to exo__LayoutActions_commands.
   */
  commands: CommandRef[];

  /**
   * Where to display the action buttons.
   * Maps to exo__LayoutActions_position.
   * @default "column"
   */
  position: ActionPosition;

  /**
   * Whether to show text labels alongside icons.
   * Maps to exo__LayoutActions_showLabels.
   * @default false
   */
  showLabels: boolean;
}

/**
 * Check if a string is a valid ActionPosition
 */
export function isValidActionPosition(value: unknown): value is ActionPosition {
  return value === "column" || value === "inline" || value === "hover" || value === "contextMenu";
}

/**
 * Create a LayoutActions object from frontmatter data.
 *
 * @param frontmatter - The YAML frontmatter object
 * @returns LayoutActions or null if required fields are missing
 */
export function createLayoutActionsFromFrontmatter(
  frontmatter: Record<string, unknown>,
): Partial<LayoutActions> | null {
  const uid = frontmatter["exo__Asset_uid"] as string | undefined;
  const label = frontmatter["exo__Asset_label"] as string | undefined;

  if (!uid || !label) {
    return null;
  }

  const positionValue = frontmatter["exo__LayoutActions_position"];
  const position: ActionPosition = isValidActionPosition(positionValue)
    ? positionValue
    : "column";

  const showLabels = frontmatter["exo__LayoutActions_showLabels"] === true;

  // Commands need to be resolved separately (they are wikilinks)
  // We return a partial object here, commands will be populated by the parser
  return {
    uid,
    label,
    commands: [], // Will be populated by LayoutParser
    position,
    showLabels,
  };
}

/**
 * Create a CommandRef object from frontmatter data.
 *
 * @param frontmatter - The YAML frontmatter object from a Command asset
 * @returns CommandRef or null if required fields are missing
 */
export function createCommandRefFromFrontmatter(
  frontmatter: Record<string, unknown>,
): Partial<CommandRef> | null {
  const uid = frontmatter["exo__Asset_uid"] as string | undefined;
  const label = frontmatter["exo__Asset_label"] as string | undefined;

  if (!uid || !label) {
    return null;
  }

  const icon = frontmatter["exo__Command_icon"] as string | undefined;

  // Note: preconditionSparql and groundingSparql come from linked assets
  // and need to be resolved separately by the parser
  return {
    uid,
    label,
    icon,
    // preconditionSparql and groundingSparql will be populated by LayoutParser
  };
}

/**
 * Check if a frontmatter object represents a LayoutActions asset.
 */
export function isLayoutActionsFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  const instanceClass = frontmatter["exo__Instance_class"];
  const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

  for (const cls of classes) {
    if (typeof cls !== "string") continue;

    // Extract class name from wikilink
    const match = cls.match(/\[\[([^\]]+)\]\]/);
    const className = match ? match[1] : cls;

    if (className === "exo__LayoutActions") {
      return true;
    }
  }

  return false;
}

/**
 * Check if a frontmatter object represents a Command asset.
 */
export function isCommandFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  const instanceClass = frontmatter["exo__Instance_class"];
  const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

  for (const cls of classes) {
    if (typeof cls !== "string") continue;

    const match = cls.match(/\[\[([^\]]+)\]\]/);
    const className = match ? match[1] : cls;

    if (className === "exocmd__Command") {
      return true;
    }
  }

  return false;
}

/**
 * Check if a frontmatter object represents a Precondition asset.
 */
export function isPreconditionFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  const instanceClass = frontmatter["exo__Instance_class"];
  const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

  for (const cls of classes) {
    if (typeof cls !== "string") continue;

    const match = cls.match(/\[\[([^\]]+)\]\]/);
    const className = match ? match[1] : cls;

    if (className === "exocmd__Precondition") {
      return true;
    }
  }

  return false;
}

/**
 * Check if a frontmatter object represents a SparqlGrounding asset.
 */
export function isSparqlGroundingFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  const instanceClass = frontmatter["exo__Instance_class"];
  const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

  for (const cls of classes) {
    if (typeof cls !== "string") continue;

    const match = cls.match(/\[\[([^\]]+)\]\]/);
    const className = match ? match[1] : cls;

    if (className === "exocmd__SparqlGrounding") {
      return true;
    }
  }

  return false;
}
