import { DisplayNameTemplateEngine } from "./DisplayNameTemplateEngine";
import type { MetadataResolver } from "./DisplayNameTemplateEngine";
import type { PrintNameRuleService, ParticipatingRule } from "./PrintNameRuleService";
import type { DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

export interface DisplayNameContext {
  metadata: Record<string, unknown>;
  basename: string;
  createdDate?: Date;
}

export class DisplayNameResolver {
  constructor(
    private readonly settings: DisplayNameSettings,
    private readonly ruleService?: PrintNameRuleService | null,
    private readonly metadataResolver?: MetadataResolver | null,
  ) {}

  resolve(context: DisplayNameContext): string | null {
    const { metadata, basename, createdDate } = context;

    // Consider EVERY class the note carries (class-MEMBERSHIP), not only the first — so a
    // class-level exo__DisplayNameSpec (e.g. ems__Meeting → 👥) applies whenever its class
    // is present, regardless of order (req 83be3f2f, #3864). Pass the instance metadata so a
    // conditional spec (matchPath/matchValue) is evaluated per-render — the specialized
    // displayName tracks the instance's state.
    const assetClasses = this.extractAssetClasses(metadata);
    const template = this.getTemplateForClasses(assetClasses, metadata);
    const engine = new DisplayNameTemplateEngine(template);

    return engine.render(
      metadata,
      basename,
      createdDate,
      this.metadataResolver ?? undefined,
    );
  }

  /**
   * COMPOSE the displayName template across ALL of a note's classes (PREFIX COMPOSITION,
   * req 1a550210). This supersedes the single-winning-template model (req 83be3f2f): instead of
   * picking the one highest-priority participating spec, EVERY participating spec across the note's
   * classes (direct + ancestor-inheritance walk + the per-render matcher of req ed4201d1/d6cd2371)
   * contributes its PREFIX, composed in a deterministic order into `<composed prefixes><base label>`.
   *
   *  - a blocked Doing task composes 🚩 (isEffortBlocked host-function spec) + 🔄 (status=Doing spec)
   *    → "🚩 🔄 <label>" — the same on native links AND every plugin table (previously only DailyNote
   *    faked the 🚩 renderer-side; that residual is now removed).
   *  - de-dup guards the pre-existing "combined" specs (e.g. the Meeting ✅ 👥-Done spec that re-bakes
   *    👥) from double-printing a marker already present → a Done Meeting stays "✅ 👥 <label>".
   *  - a SINGLE participating spec composes to itself → byte-identical, no regression; NO participating
   *    spec falls back to the first class's TS classTemplate seed, then the default template — as before.
   */
  getTemplateForClasses(
    assetClasses: string[],
    metadata?: Record<string, unknown>,
  ): string {
    if (this.ruleService && assetClasses.length > 0) {
      // Gather EVERY participating spec across all of the note's classes, de-duped by spec UID so a
      // spec that applies to more than one of the note's classes contributes at most one prefix.
      const gathered: ParticipatingRule[] = [];
      const seenSpecs = new Set<string>();
      for (const assetClass of assetClasses) {
        for (const rule of this.ruleService.getParticipatingRules(assetClass, metadata)) {
          if (seenSpecs.has(rule.sourceFile)) continue;
          seenSpecs.add(rule.sourceFile);
          gathered.push(rule);
        }
      }
      if (gathered.length > 0) {
        // Deterministic compose order = priority DESC (the vault-declared compose-order field),
        // tiebreak by spec UID for full determinism. One spec → its template unchanged (byte-identical).
        gathered.sort(
          (a, b) => b.priority - a.priority || a.sourceFile.localeCompare(b.sourceFile),
        );
        return gathered.length === 1
          ? gathered[0].template
          : this.composeTemplates(gathered);
      }
    }

    const firstClass = assetClasses[0];
    if (firstClass && this.settings.classTemplates[firstClass]) {
      return this.settings.classTemplates[firstClass];
    }

    return this.settings.defaultTemplate;
  }

  /**
   * Compose ≥2 participating specs (already priority-DESC) into one template:
   * `<composed prefixes><base label>`. Each spec's PREFIX is the text before its first
   * {{placeholder}}; the base (the placeholder part = the printed label) is taken ONCE, from the
   * highest-priority spec that carries one. Prefix markers are de-duplicated by whitespace token, so
   * a spec that re-bakes a marker already present does not double it (req 1a550210, Option B —
   * e.g. the Meeting "✅ 👥"-Done spec over the plain "👥" spec composes to "✅ 👥", not "✅ 👥 👥").
   * NOTE: composition treats a prefix as space-separated marker tokens — the shipped combined specs
   * (e.g. "✅ 👥 ") space their markers, so re-baked markers de-dup correctly.
   */
  private composeTemplates(rules: ParticipatingRule[]): string {
    const seen = new Set<string>();
    const markers: string[] = [];
    let base: string | null = null;
    for (const rule of rules) {
      const { prefix, rest } = this.splitAtPlaceholder(rule.template);
      // Base label = the first (highest-priority) spec that carries a {{placeholder}} part.
      if (base === null && rest.trim() !== "") base = rest;
      for (const token of prefix.trim().split(/\s+/)) {
        if (!token || seen.has(token)) continue;
        seen.add(token);
        markers.push(token);
      }
    }
    // Degenerate: no spec carried a base placeholder — fall back to the top spec's (possibly empty) rest.
    if (base === null) base = this.splitAtPlaceholder(rules[0].template).rest;
    const composedPrefix = markers.map((m) => `${m} `).join("");
    return `${composedPrefix}${base}`;
  }

  /** Split a template at its first {{placeholder}} → prefix (leading literals) + rest (base label + suffix). */
  private splitAtPlaceholder(template: string): { prefix: string; rest: string } {
    const idx = template.indexOf("{{");
    if (idx === -1) return { prefix: template, rest: "" };
    return { prefix: template.slice(0, idx), rest: template.slice(idx) };
  }

  /**
   * Single-class variant retained for callers that have already resolved one class (and
   * direct tests). Delegates to the all-classes path — byte-identical for one class.
   */
  getTemplateForClass(
    assetClass: string | null,
    metadata?: Record<string, unknown>,
  ): string {
    return this.getTemplateForClasses(assetClass ? [assetClass] : [], metadata);
  }

  private extractAssetClasses(metadata: Record<string, unknown>): string[] {
    const instanceClass = metadata.exo__Instance_class;

    if (!instanceClass) {
      return [];
    }

    const rawValues = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

    const classes: string[] = [];
    const seen = new Set<string>();
    for (const value of rawValues) {
      const cleaned = this.cleanClassValue(value);
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        classes.push(cleaned);
      }
    }
    return classes;
  }

  private cleanClassValue(value: unknown): string | null {
    if (typeof value !== "string") return null;

    let cleaned = value
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"|"$/g, "")
      .trim();

    if (cleaned.includes("|")) {
      const last = cleaned.split("|").pop();
      cleaned = (last ?? cleaned).trim();
    }

    return cleaned || null;
  }

  getConfiguredClasses(): string[] {
    return Object.keys(this.settings.classTemplates);
  }

  hasClassTemplates(): boolean {
    return Object.keys(this.settings.classTemplates).length > 0;
  }
}

export async function createDefaultResolver(): Promise<DisplayNameResolver> {
  const { DEFAULT_DISPLAY_NAME_SETTINGS } = await import("@plugin/domain/settings/ExocortexSettings");
  return new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);
}
