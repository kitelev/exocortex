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
   * `<composed prefixes><base label><composed suffixes>`. Each spec is split into a PREFIX (leading
   * literals, before its first {{placeholder}}), a CORE (the placeholder region = the printed label,
   * taken ONCE from the highest-priority spec that carries one), and a SUFFIX (trailing literals,
   * after its last {{placeholder}}). Both prefix AND suffix markers are composed — symmetric — so a
   * suffix spec ("{{label}} (RFC)") that co-participates with a higher-priority prefix spec keeps its
   * "(RFC)" instead of being dropped. Markers are de-duplicated by whitespace token, so a spec that
   * re-bakes a marker already present does not double it (req 1a550210, Option B — e.g. the Meeting
   * "✅ 👥"-Done spec over the plain "👥" spec composes to "✅ 👥", not "✅ 👥 👥").
   * NOTE: composition treats each side as space-separated marker tokens — the shipped combined specs
   * (e.g. "✅ 👥 ") space their markers, so re-baked markers de-dup correctly.
   */
  private composeTemplates(rules: ParticipatingRule[]): string {
    const seenPrefix = new Set<string>();
    const seenSuffix = new Set<string>();
    const prefixMarkers: string[] = [];
    const suffixMarkers: string[] = [];
    let core: string | null = null;
    const collect = (raw: string, seen: Set<string>, into: string[]) => {
      for (const token of raw.trim().split(/\s+/)) {
        if (!token || seen.has(token)) continue;
        seen.add(token);
        into.push(token);
      }
    };
    for (const rule of rules) {
      const { prefix, core: ruleCore, suffix } = this.splitTemplate(rule.template);
      // Core (the label placeholder) = the first (highest-priority) spec that carries one.
      if (core === null && ruleCore !== "") core = ruleCore;
      collect(prefix, seenPrefix, prefixMarkers);
      collect(suffix, seenSuffix, suffixMarkers);
    }
    // Degenerate: no spec carried a {{placeholder}} core — the composed prefix markers stand alone.
    const composedCore = core ?? "";
    const composedPrefix = prefixMarkers.map((m) => `${m} `).join("");
    const composedSuffix = suffixMarkers.length ? ` ${suffixMarkers.join(" ")}` : "";
    return `${composedPrefix}${composedCore}${composedSuffix}`;
  }

  /**
   * Split a template into prefix (leading literals) + core (the {{placeholder}} region = the label) +
   * suffix (trailing literals). A template with no {{placeholder}} is treated as all-prefix (a pure
   * literal marker). Uses first `{{` and last `}}` so a multi-placeholder core stays intact.
   */
  private splitTemplate(template: string): {
    prefix: string;
    core: string;
    suffix: string;
  } {
    const first = template.indexOf("{{");
    const last = template.lastIndexOf("}}");
    if (first === -1 || last === -1 || last < first) {
      return { prefix: template, core: "", suffix: "" };
    }
    return {
      prefix: template.slice(0, first),
      core: template.slice(first, last + 2),
      suffix: template.slice(last + 2),
    };
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
