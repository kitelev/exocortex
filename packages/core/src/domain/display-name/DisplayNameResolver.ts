import { DisplayNameTemplateEngine } from "./DisplayNameTemplateEngine";
import type { MetadataResolver } from "./DisplayNameTemplateEngine";
import type { PrintNameRuleService, ParticipatingRule } from "./PrintNameRuleService";
import type { DisplayNameSettings } from "./DisplayNameSettings";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "./DisplayNameSettings";

export interface DisplayNameContext {
  metadata: Record<string, unknown>;
  basename: string;
  createdDate?: Date;
}

/**
 * WHY the rendered name looks the way it does — reported by the engine rather than inferred by
 * a caller comparing the output against the raw label (req f17f7c57).
 *
 * The inference is not merely imprecise, it INVERTS in a reachable case: a spec that composes to
 * exactly the filename stem (easy in a UID-canon vault — a spec printing exo__Asset_uid) reads as
 * "nothing composed this", which is the opposite of the truth and happens to be the very alarm
 * the CLI oracle exists to raise. Only the engine knows whether a rule participated.
 */
export type DisplayNameProvenance =
  /** ≥1 vault exo__DisplayNameSpec participated (incl. per-render matchers). */
  | "spec"
  /** The TBox `prefix#slug` projection fired (a class/property definition). */
  | "tboxProjection"
  /** No vault spec; a settings-level classTemplates entry matched. */
  | "classTemplate"
  /** Nothing matched — settings.defaultTemplate rendered it. */
  | "default";

export interface ResolvedDisplayName {
  displayName: string | null;
  provenance: DisplayNameProvenance;
}

/**
 * The exo__Slugable-mixin metaclasses. A note whose exo__Instance_class is one of these
 * (matched by UID OR label form) is a TBox naming entity that displays as `prefix#slug`
 * (RFC 78572fa9 Candidate B Phase 2). exo__Class + exo__Property carry the exo__Slugable
 * mixin directly; the three concrete property metaclasses inherit it via exo__Property.
 * Verified against the live TBox (vault-my exoas-exo, 2026-07-29).
 */
const SLUGABLE_METACLASS_KEYS: ReadonlySet<string> = new Set<string>([
  "8619c4fc-64f1-4869-b17e-e34186cacca9",
  "exo__Class",
  "38277bfa-d7f9-4a75-b856-b23276ab0db3",
  "exo__Property",
  "9a1cf31c-9d41-4ef3-9023-584a8d087d16",
  "exo__ObjectProperty",
  "ae56ca4c-b610-42a4-a25d-058c23673296",
  "exo__DatatypeProperty",
  "84756998-3b4e-4989-91cc-a5d5c23664d4",
  "exo__URLProperty",
]);

export class DisplayNameResolver {
  constructor(
    private readonly settings: DisplayNameSettings,
    private readonly ruleService?: PrintNameRuleService | null,
    private readonly metadataResolver?: MetadataResolver | null,
  ) {}

  /** Unchanged public shape — every existing caller keeps `string | null`. */
  resolve(context: DisplayNameContext): string | null {
    return this.resolveWithProvenance(context).displayName;
  }

  /**
   * Same rendering, plus WHY. Additive: `resolve` delegates here, so there is one code path and
   * the provenance cannot drift from the name it explains.
   */
  resolveWithProvenance(context: DisplayNameContext): ResolvedDisplayName {
    const { metadata, basename, createdDate } = context;

    // Consider EVERY class the note carries (class-MEMBERSHIP), not only the first — so a
    // class-level exo__DisplayNameSpec (e.g. ems__Meeting → 👥) applies whenever its class
    // is present, regardless of order (req 83be3f2f, #3864). Pass the instance metadata so a
    // conditional spec (matchPath/matchValue) is evaluated per-render — the specialized
    // displayName tracks the instance's state.
    const assetClasses = this.extractAssetClasses(metadata);

    // TBox naming display-projection (RFC 78572fa9 Candidate B Phase 2, req 318af6a2): a
    // class-def / property-def displays as its COMPUTED `prefix#slug` (e.g. ems#TaskPrototype)
    // instead of the raw exo__Asset_label. Subordinate to a participating exo__DisplayNameSpec
    // and disabled by projectTBoxNames=false; never fires for ABox instances. Returns null to
    // fall through to the normal template path.
    const projection = this.computeTBoxNamingProjection(assetClasses, metadata);
    if (projection !== null) return { displayName: projection, provenance: "tboxProjection" };

    const { template, separator, provenance } = this.resolveRenderSpec(assetClasses, metadata);
    const engine = new DisplayNameTemplateEngine(
      template,
      separator ? { separator } : {},
    );

    return {
      displayName: engine.render(
        metadata,
        basename,
        createdDate,
        this.metadataResolver ?? undefined,
      ),
      provenance,
    };
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
    return this.resolveRenderSpec(assetClasses, metadata).template;
  }

  /**
   * The template PLUS its vault-declared separator (issue #4012). The separator must travel as
   * METADATA beside the template, never inside it: composeTemplates collapses N specs into ONE
   * string, after which an embedded separator would be indistinguishable from an ordinary
   * literal. When several specs compose, the separator is taken from the spec that contributed
   * the CORE (the highest-priority participating spec carrying a placeholder) — deterministic.
   * getTemplateForClasses stays a string-returning wrapper, so every existing caller is
   * untouched.
   */
  private resolveRenderSpec(
    assetClasses: string[],
    metadata?: Record<string, unknown>,
  ): { template: string; separator?: string; provenance: DisplayNameProvenance } {
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
          ? {
              template: gathered[0].template,
              ...(gathered[0].separator ? { separator: gathered[0].separator } : {}),
              provenance: "spec",
            }
          : { ...this.composeTemplates(gathered), provenance: "spec" };
      }
    }

    const firstClass = assetClasses[0];
    if (firstClass && this.settings.classTemplates[firstClass]) {
      return {
        template: this.settings.classTemplates[firstClass],
        provenance: "classTemplate",
      };
    }

    return { template: this.settings.defaultTemplate, provenance: "default" };
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
  private composeTemplates(rules: ParticipatingRule[]): {
    template: string;
    separator?: string;
  } {
    const seenPrefix = new Set<string>();
    const seenSuffix = new Set<string>();
    const prefixMarkers: string[] = [];
    const suffixMarkers: string[] = [];
    let core: string | null = null;
    // The separator belongs to whichever spec contributes the CORE (issue #4012).
    let coreSeparator: string | undefined;
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
      if (core === null && ruleCore !== "") {
        core = ruleCore;
        coreSeparator = rule.separator;
      }
      collect(prefix, seenPrefix, prefixMarkers);
      collect(suffix, seenSuffix, suffixMarkers);
    }
    // Degenerate: no spec carried a {{placeholder}} core — the composed prefix markers stand alone.
    const composedCore = core ?? "";
    const composedPrefix = prefixMarkers.map((m) => `${m} `).join("");
    const composedSuffix = suffixMarkers.length ? ` ${suffixMarkers.join(" ")}` : "";
    return {
      template: `${composedPrefix}${composedCore}${composedSuffix}`,
      ...(coreSeparator ? { separator: coreSeparator } : {}),
    };
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

  /**
   * TBox naming display-projection (RFC 78572fa9 Candidate B Phase 2). A TBox naming entity —
   * a class-def or property-def — displays as its COMPUTED symbolic projection `prefix#slug`
   * (e.g. `ems#TaskPrototype`, `ems#Effort_status`) instead of its raw exo__Asset_label
   * (`ems__TaskPrototype`). NEVER stored — composed per-render from the naming fields:
   *
   *   slug    = exo__Slugable_slug ?? <label local-name>  (the part after the label's first `__`)
   *   prefix  = <isDefinedBy ontology>.exo__Ontology_shortName ?? <label prefix>  (before `__`)
   *   display = prefix ? `${prefix}#${slug}` : slug
   *
   * Returns null (→ the normal template path) when: the projection is disabled
   * (settings.projectTBoxNames === false); the note is not a TBox naming entity; a participating
   * exo__DisplayNameSpec exists (an explicit author override wins); or no slug can be resolved.
   * ABox instances never match the detection, so their displayName is byte-identical. The
   * fallback chain covers entities/ontologies missing the Phase-1 naming fields (RFC v4: the 22
   * orphan-namespace prefixes with no ontology anchor display via the label-prefix fallback).
   */
  private computeTBoxNamingProjection(
    assetClasses: string[],
    metadata: Record<string, unknown>,
  ): string | null {
    if (this.settings.projectTBoxNames === false) return null;
    if (!this.isTBoxNamingEntity(assetClasses)) return null;

    // A participating exo__DisplayNameSpec is an explicit author override → let it win.
    if (this.ruleService) {
      for (const assetClass of assetClasses) {
        if (
          this.ruleService.getParticipatingRules(assetClass, metadata).length >
          0
        ) {
          return null;
        }
      }
    }

    const label =
      typeof metadata.exo__Asset_label === "string"
        ? metadata.exo__Asset_label.trim()
        : "";
    const [labelPrefix, labelLocal] = this.splitPrefixedLabel(label);

    const slugField =
      typeof metadata.exo__Slugable_slug === "string"
        ? metadata.exo__Slugable_slug.trim()
        : "";
    const slug = slugField || labelLocal;
    if (!slug) return null; // no slug field AND the label is not `prefix__Local` → cannot project.

    const prefix = this.resolveOntologyShortName(metadata) ?? labelPrefix;
    return prefix ? `${prefix}#${slug}` : slug;
  }

  /**
   * True when a note is a TBox naming entity — its exo__Instance_class is one of the
   * exo__Slugable-mixin metaclasses (class / property metaclasses). Detection is by the
   * METACLASS ONLY, deliberately NOT by the mere presence of exo__Slugable_slug: the slug is a
   * TBox concern (RFC 78572fa9 v3 points 8/11 — free-form ABox instances keep their label and
   * never carry a slug), so keying detection on the metaclass is (a) population-independent — it
   * fires for every one of the 762 Phase-1-populated defs AND every unpopulated one (with a
   * label-derived fallback), and (b) cannot hijack the display of an ABox instance that happens
   * to carry a slug field (an ABox instance is never a Slugable metaclass instance).
   */
  private isTBoxNamingEntity(assetClasses: string[]): boolean {
    return assetClasses.some((c) => SLUGABLE_METACLASS_KEYS.has(c));
  }

  /**
   * Resolve the note's namespace ontology (exo__Asset_isDefinedBy → ontology frontmatter, via
   * the metadataResolver two-hop) and return its exo__Ontology_shortName (trimmed) — the
   * canonical prefix. null when there is no metadataResolver, no isDefinedBy, or the ontology
   * carries no shortName (→ the caller falls back to the label-derived prefix). This reads the
   * SAME field the future query-input name-resolver (Candidate E) will use, so DISPLAY and
   * QUERY stay symmetric.
   */
  private resolveOntologyShortName(
    metadata: Record<string, unknown>,
  ): string | null {
    if (!this.metadataResolver) return null;
    const isDefinedBy = this.firstString(metadata.exo__Asset_isDefinedBy);
    if (!isDefinedBy) return null;
    const ontologyFm = this.metadataResolver(isDefinedBy);
    const shortName = ontologyFm?.exo__Ontology_shortName;
    return typeof shortName === "string" && shortName.trim()
      ? shortName.trim()
      : null;
  }

  /**
   * Split a `prefix__LocalName` label into [prefix, localName] on the FIRST `__` separator
   * (the prefix may itself contain single underscores, e.g. `ztlk_v2__X`; `__` is the
   * separator). Returns [null, null] when the label has no `__` separator or an empty part.
   */
  private splitPrefixedLabel(label: string): [string | null, string | null] {
    const idx = label.indexOf("__");
    if (idx <= 0) return [null, null];
    const prefix = label.slice(0, idx);
    const local = label.slice(idx + 2);
    if (!local) return [null, null];
    return [prefix, local];
  }

  /** First trimmed non-empty string of a scalar-or-array value, else null. */
  private firstString(value: unknown): string | null {
    let raw = value;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      raw = raw[0];
    }
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed || null;
  }

  getConfiguredClasses(): string[] {
    return Object.keys(this.settings.classTemplates);
  }

  hasClassTemplates(): boolean {
    return Object.keys(this.settings.classTemplates).length > 0;
  }
}

/**
 * A resolver over the default settings and no vault specs — the "no configuration" baseline.
 *
 * Was `async` only because it lazily imported the defaults across the plugin package boundary;
 * now that the settings live beside this file the await is gone. Kept async so the (currently
 * zero) callers of the exported signature are unaffected — see req f17f7c57 §Non-goals: the
 * move must be behaviourally neutral, and a signature change is a behaviour change.
 */
export async function createDefaultResolver(): Promise<DisplayNameResolver> {
  return new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);
}
