import { GroundingType } from "../constants/GroundingType";
import type {
  CommandVariant,
  LabelClass,
  StyleSource,
} from "../constants/CommandBindingStyleEnums";

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
  /**
   * SPARQL-based label template with `{sparql}` placeholders.
   * Each `{...}` block is executed as a SPARQL SELECT query;
   * the first binding of the first result row replaces the placeholder.
   *
   * Example: `"Vote ({SELECT (COUNT(?v) AS ?n) WHERE { $target exo:vote ?v }})"` → `"Vote (3)"`
   *
   * Variable substitution (same as PreconditionEvaluator):
   * - `$target` → `<targetIRI>`
   */
  readonly labelTemplate?: string;
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
  /**
   * Reference (UID) of an `exoql__Query` asset whose body holds an ASK SPARQL
   * block (RFC c78cc5c8 Phase 1a). Evaluated through the `evaluateWithExoEval`
   * pipeline (allowlist + flag + executor). Mutually exclusive with `sparqlAsk`.
   */
  readonly query?: string;
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
  /** Class to instantiate (for create_instance, e.g., "gtd__InboxItem") */
  readonly targetClass?: string;
  /** Prototype asset IRI or UUID (for create_instance) */
  readonly targetPrototype?: string;
  /** Vault-relative folder path (for create_instance, e.g., "01 Inbox") */
  readonly targetFolder?: string;
  /**
   * Frontmatter property name on the newly created instance where the plugin
   * writes the `[[$target]]` wikilink back to the source asset (for
   * `create_instance` grounding).
   *
   * If absent → fallback to hardcoded `exo__Asset_source`.
   */
  readonly linkBackProperty?: string;
  /**
   * Integer delta for `property_increment` grounding (Issue #3134).
   * Supports negative values. Default 1 when omitted.
   */
  readonly incrementBy?: number;
  /**
   * ISO-8601 duration literal for `property_shift` grounding (Issue #3134).
   * Accepts xsd:dayTimeDuration (`P1D`, `-PT2H`, `P1DT12H`) and
   * xsd:yearMonthDuration (`P1M`, `P1Y2M`) shapes.
   */
  readonly shiftDelta?: string;
  /**
   * Property defaults applied to a newly created instance BEFORE userInput
   * is merged (for `create_instance` grounding, Issue #3136 — Q3.b closure).
   * Values pass through `substituteVariables`, so tokens like `$today`,
   * `$todayStart`, `$targetFolder`, `$target` are resolved at execution time.
   *
   * Authored on grounding ассеты as a JSON literal in the
   * `exocmd__Grounding_propertyDefaults` RDF triple, e.g.
   * `'{"ems__Effort_plannedStartTimestamp": "$today"}'`.
   *
   * userInput keys override defaults; class / prototype / back-link wiring
   * is unaffected by this map.
   */
  readonly propertyDefaults?: Record<string, string>;
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
  /**
   * Per-binding button variant override (RFC command-variant-split,
   * f1dc284a-eadc-4d0e-8e72-323e999ea510). Populated from
   * `exocmd__CommandBinding_variant` frontmatter literal. When absent, UI
   * falls back to category-default variant (then `secondary`).
   */
  readonly variant?: CommandVariant;
  /** Binding-level precondition overriding command-level precondition */
  readonly precondition?: PreconditionDefinition;
  /**
   * Resolved visual style (RFC-024 §4 Phase 2).
   *
   * Populated by CommandResolver applying the fallback chain:
   * 1. `exocmd__CommandBinding_style` wikilink → load referenced
   *    CommandBindingStyle asset (preferred — reusable across bindings).
   * 2. `exocmd__CommandBinding_variant` inline literal → synthesize
   *    minimal style with only `variant` set.
   * 3. Neither present → `style` is `undefined`; UI applies category-based
   *    default via `resolveDefaultVariantForCategory(command.category)`.
   *
   * Invalid enum values are coerced (lowercase + trim) and dropped to
   * `undefined` after warning (RFC-024 §5 — never crash).
   */
  readonly style?: CommandBindingStyleDefinition;
}

/**
 * Domain model for `exocmd__CommandBindingStyle` (RFC-024 §4 Phase 2).
 *
 * Resolved visual properties for a command binding. Constructed by
 * CommandResolver from either a referenced style asset (full definition)
 * or an inline `CommandBinding_variant` shorthand (variant only).
 *
 * All fields are optional — caller (UI layer) supplies its own defaults.
 */
export interface CommandBindingStyleDefinition {
  /** Asset UID of the style asset (or synthetic `inline:<binding-uid>` for shorthand) */
  readonly id: string;
  /** Human-readable label of the style asset (empty for inline shorthand) */
  readonly label: string;
  /** Semantic button variant whitelist value */
  readonly variant?: CommandVariant;
  /** Boolean — render the existing Command_icon (default true at UI layer) */
  readonly showIcon?: boolean;
  /** Typographic modifier whitelist value */
  readonly labelClass?: LabelClass;
  /** Literal text for the aria-label attribute */
  readonly ariaLabel?: string;
  /** Literal text for the title attribute (Obsidian tooltip convention) */
  readonly tooltip?: string;
  /** Chord string (e.g. "Mod+Shift+D") — registered with `exo-cmd-` namespace */
  readonly keyboardShortcut?: string;
  /** Governance marker — user wins over vendor per precedence matrix */
  readonly source?: StyleSource;
  /** True iff this style was synthesized from inline `CommandBinding_variant` */
  readonly inline: boolean;
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
