/**
 * CommandPanel Domain Model — RFC-024 Phase 3 (Context Panels).
 *
 * Inline structure attached to `exo__Layout` via the optional
 * `exo__Layout_commandPanel` slot. Lets a layout define which command
 * buttons render above/next to its target-class view without introducing
 * a parallel class `exocmd__CommandPanel`.
 *
 * Five fields (all optional; absence is backward-compatible):
 * - `includeGroups`  — OR-merge of command group ids to include
 * - `excludeCommands`— UUIDs of specific bindings/commands to exclude
 * - `layout`         — rendering mode: inline | stacked | dropdown
 * - `featuredBinding`— UUID of a binding promoted to `primary` variant
 * - `collapsedGroups`— group ids collapsed-by-default (vault wins over TS-defaults)
 *
 * Precedence rules (RFC-024 §4 Phase 3):
 *   1. Multiple layouts for one class: sort by `exo__Layout_order` ASC
 *      (resolved outside this module — PanelResolver scope)
 *   2. `excludeCommands` trumps `includeGroups`
 *   3. `featuredBinding` overrides binding.style.variant → `primary`
 *   4. Binding-level style.variant > class-level default > plugin fallback
 *
 * Rules 2 and 3 are enforceable from the parsed structure alone and are
 * exposed here as pure helpers {@link applyCommandPanelFilter} and
 * {@link isFeaturedBinding}. Rule 1 belongs to a downstream resolver.
 *
 * @module domain/layout
 * @since RFC-024 Phase 3
 */

/**
 * Rendering mode for the command panel.
 * Distinct from `ActionPosition` (LayoutActions) — this is panel layout
 * (orientation), not action placement relative to rows.
 */
export type CommandPanelMode = "inline" | "stacked" | "dropdown";

/**
 * Parsed `exo__Layout_commandPanel` inline structure.
 *
 * All fields are optional: an empty object `{}` is a valid panel spec
 * meaning "render every applicable command with default layout".
 */
export interface CommandPanel {
  /**
   * Command-group ids whose bindings should be included (OR-merged).
   * Example: `["creation", "status"]` includes every binding tagged with
   * either group. Empty / missing means "no group filter — include all".
   */
  includeGroups?: string[];

  /**
   * UUIDs of command-bindings to exclude. Trumps `includeGroups`.
   * Values in frontmatter are wikilinks (`[[uuid]]`) that are normalised
   * to bare UUID strings for easier downstream comparison.
   */
  excludeCommands?: string[];

  /**
   * Rendering mode for the panel.
   */
  layout?: CommandPanelMode;

  /**
   * UUID of the binding that should be promoted to the `primary` variant
   * (fixes the "N primary buttons" UX anti-pattern). Stored as a bare
   * UUID string regardless of the wikilink form used in frontmatter.
   */
  featuredBinding?: string;

  /**
   * Command-group ids that should render collapsed-by-default. Vault wins
   * over the TS-side `categoryDisplayDefaults.collapsedByDefault` flag.
   * Empty / missing means "use TS defaults" (pre-RFC behaviour).
   * Same id whitelist as `includeGroups` (e.g. `creation`, `maintenance`).
   */
  collapsedGroups?: string[];
}

/**
 * Type guard for {@link CommandPanelMode}.
 */
export function isValidCommandPanelMode(
  value: unknown,
): value is CommandPanelMode {
  return value === "inline" || value === "stacked" || value === "dropdown";
}

/**
 * Strip the wikilink wrapper and alias from a value, returning the bare
 * link target (typically a UUID).
 *
 * - `"[[uuid]]"`             → `"uuid"`
 * - `"[[uuid|alias]]"`       → `"uuid"`
 * - `"[[path/to/file]]"`     → `"path/to/file"`
 * - `"uuid"` (already bare)  → `"uuid"`
 * - non-string / empty       → `null`
 */
export function normalizeBindingRef(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = trimmed.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  const ref = (match ? match[1] : trimmed).trim();
  return ref.length > 0 ? ref : null;
}

/**
 * Create a {@link CommandPanel} from an inline frontmatter object.
 *
 * Permissive: unknown / invalid fields are dropped (never thrown). If
 * every field is absent / invalid, returns `null` so callers can omit
 * the slot entirely — preserving the non-breaking invariant for layouts
 * that never defined a command panel.
 *
 * @param raw - The inline object parsed from YAML (`exo__Layout_commandPanel`).
 * @returns A populated panel or `null` when nothing parses.
 */
export function createCommandPanelFromFrontmatter(
  raw: unknown,
): CommandPanel | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const panel: CommandPanel = {};

  const includeGroupsRaw = record["includeGroups"];
  const includeGroups = normalizeStringArray(includeGroupsRaw);
  if (includeGroups && includeGroups.length > 0) {
    panel.includeGroups = includeGroups;
  }

  const excludeCommandsRaw = record["excludeCommands"];
  const excludeCommands = normalizeRefArray(excludeCommandsRaw);
  if (excludeCommands && excludeCommands.length > 0) {
    panel.excludeCommands = excludeCommands;
  }

  const layoutRaw = record["layout"];
  if (isValidCommandPanelMode(layoutRaw)) {
    panel.layout = layoutRaw;
  } else if (typeof layoutRaw === "string" && layoutRaw.trim().length > 0) {
    console.warn(
      `[CommandPanel] exo__Layout_commandPanel.layout must be ` +
        `"inline" | "stacked" | "dropdown". Received ${JSON.stringify(
          layoutRaw,
        )} — dropping field.`,
    );
  }

  const collapsedGroupsRaw = record["collapsedGroups"];
  const collapsedGroups = normalizeStringArray(collapsedGroupsRaw);
  if (collapsedGroups && collapsedGroups.length > 0) {
    panel.collapsedGroups = collapsedGroups;
  }

  const featuredRaw = record["featuredBinding"];
  if (featuredRaw !== undefined && featuredRaw !== null) {
    const featuredRef = Array.isArray(featuredRaw)
      ? normalizeBindingRef(featuredRaw[0])
      : normalizeBindingRef(featuredRaw);
    if (featuredRef) {
      panel.featuredBinding = featuredRef;
    }
  }

  return Object.keys(panel).length > 0 ? panel : null;
}

/**
 * Precedence rule #2 (explicit, RFC-024 §5).
 *
 * Given a set of candidate commands and a panel spec, return the subset
 * that survives exclusion. `excludeCommands` trumps `includeGroups` —
 * i.e. an excluded command is dropped even when its group is included.
 * Group membership is supplied by the caller since command assets live
 * outside this domain module.
 *
 * @param candidates - Candidate commands (each with uid + optional category).
 * @param panel - Parsed command panel spec.
 * @returns Commands that pass both include-by-category and exclude-by-uid.
 */
export function applyCommandPanelFilter<
  T extends { uid: string; category?: string },
>(candidates: readonly T[], panel: CommandPanel | undefined): T[] {
  if (!panel) {
    return [...candidates];
  }

  const include = panel.includeGroups;
  const exclude = new Set(panel.excludeCommands ?? []);

  return candidates.filter((candidate) => {
    if (exclude.has(candidate.uid)) {
      return false;
    }
    if (include && include.length > 0) {
      if (!candidate.category || !include.includes(candidate.category)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Precedence rule #3 (explicit, RFC-024 §5).
 *
 * @param panel - Parsed command panel spec.
 * @param bindingUid - UUID of the binding whose variant is being resolved.
 * @returns `true` if this binding is the panel's featured binding and
 *          therefore overrides its own `style.variant` to `primary`.
 */
export function isFeaturedBinding(
  panel: CommandPanel | undefined,
  bindingUid: string,
): boolean {
  return (
    panel?.featuredBinding !== undefined && panel.featuredBinding === bindingUid
  );
}

function normalizeStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  const source = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of source) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        out.push(trimmed);
      }
    }
  }
  return out;
}

function normalizeRefArray(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  const source = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of source) {
    const ref = normalizeBindingRef(entry);
    if (ref) {
      out.push(ref);
    }
  }
  return out;
}
