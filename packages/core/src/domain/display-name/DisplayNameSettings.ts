/**
 * Display-name configuration — the settings half of the displayName engine.
 *
 * Moved here from the plugin's ExocortexSettings alongside the engine itself (req f17f7c57)
 * so `packages/core` owns the whole type surface and the CLI can construct a resolver without
 * importing the plugin. The plugin re-exports both symbols from their original path, so every
 * existing importer keeps working unchanged.
 */

/**
 * Per-class display name template configuration
 */
export interface DisplayNameSettings {
  /** Global default template (used when no class-specific template exists) */
  defaultTemplate: string;

  /** Per-class template overrides (key = class name like "ems__Task") */
  classTemplates: Record<string, string>;

  /**
   * TBox naming display-projection (RFC 78572fa9 Candidate B Phase 2). When ON (default),
   * a TBox class/property definition displays as its COMPUTED symbolic projection
   * `prefix#slug` (e.g. `ems#TaskPrototype`) — composing the namespace ontology's
   * `exo__Ontology_shortName` with the entity's `exo__Slugable_slug` (with a label-derived
   * fallback) — instead of its raw `exo__Asset_label`. Never stored; computed per-render.
   * OFF restores the raw-label display (the revert-verify axis + a user escape hatch).
   * Optional so a persisted settings object without it defaults ON (backward-compatible).
   */
  projectTBoxNames?: boolean;
}

/**
 * Default display name configuration
 *
 * FULL HOMOICONIC (#3838 part 3): classTemplates is EMPTY. Every per-class displayName
 * (the TaskPrototype/MeetingPrototype suffixes, the status/blocked prefixes, the DailyNote
 * basename) is now sourced ENTIRELY from vault exo__DisplayNameSpec assets read by
 * PrintNameRuleService (PMBOK project 47d57acf, req b4ee3caa) — no TS cold-start seed.
 *
 * Why the seeds were removable (orchestrator-verified via the live 8-surface Phase-6 smoke
 * on v16.183.0 + revert-verified tests): vault specs already WIN over any classTemplate
 * (compileDisplayNameSpecs registers them as HIGH-priority PrintNameRules), so the seeds were
 * dead-overridden once the vault scanned. Coverage lives in the vault — the unconditional
 * TaskPrototype spec e20fda38 and the MeetingPrototype spec d7bdca33 render the " (…Prototype)"
 * suffix; the pn__DailyNote seed was already DEAD (real DailyNotes key exo__Instance_class by
 * the bare UID [[b04e7a3e]], never the label pn__DailyNote — dn-2110 sweep). The only remaining
 * difference is a brief cold-start window before the vault scan — identical eventual-consistency
 * to the status emojis, which are also vault-served and already re-render on store-settle. No
 * steady-state user-visible change.
 *
 * `defaultTemplate` is the base fallback (a plain label), NOT a homoiconic seed — kept.
 */
export const DEFAULT_DISPLAY_NAME_SETTINGS: DisplayNameSettings = {
  defaultTemplate: "{{exo__Asset_label}}",

  classTemplates: {},

  projectTBoxNames: true,
};
