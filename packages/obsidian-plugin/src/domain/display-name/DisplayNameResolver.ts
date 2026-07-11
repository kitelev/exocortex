import { DisplayNameTemplateEngine } from "./DisplayNameTemplateEngine";
import type { MetadataResolver } from "./DisplayNameTemplateEngine";
import type { PrintNameRuleService } from "./PrintNameRuleService";
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
   * Select the winning template across ALL of a note's classes (class-membership,
   * req 83be3f2f). For each class the ruleService yields its best `{template, priority}`
   * (direct rules + ancestor-inheritance walk + the per-render conditional matcher of
   * req ed4201d1); the highest-priority PARTICIPATING result across every class wins — so a
   * class-level spec participates whenever its class is present among the note's classes,
   * regardless of which one is listed first. Ties keep the earliest (first-listed) class,
   * so a single-class note is byte-identical to the pre-membership `[0]` path. Falls back to
   * the first class's TS classTemplate seed, then the default template — exactly as before.
   * The single-winning-template model still picks ONE template (no prefix composition —
   * out of scope, see req 83be3f2f).
   */
  getTemplateForClasses(
    assetClasses: string[],
    metadata?: Record<string, unknown>,
  ): string {
    if (this.ruleService && assetClasses.length > 0) {
      let best: { template: string; priority: number } | null = null;
      for (const assetClass of assetClasses) {
        const rule = this.ruleService.getTemplateForClass(assetClass, metadata);
        // Strictly-greater keeps the earliest class on a priority tie (deterministic,
        // and byte-identical to the single-class path).
        if (rule && (best === null || rule.priority > best.priority)) {
          best = rule;
        }
      }
      if (best) return best.template;
    }

    const firstClass = assetClasses[0];
    if (firstClass && this.settings.classTemplates[firstClass]) {
      return this.settings.classTemplates[firstClass];
    }

    return this.settings.defaultTemplate;
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
