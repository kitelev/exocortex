import { TFile } from "obsidian";
import type { App } from "obsidian";

/**
 * A per-render VALUE-EQUALITY condition compiled from an exo__DisplayNameSpec's
 * exo__DisplayNameSpec_matchPath (→ frontmatter key) + exo__DisplayNameSpec_matchValue
 * (→ cleaned enum identity/-ies). A rule carrying a matcher is CONDITIONAL: it only
 * participates in class selection when the rendered instance's frontmatter value at
 * `matchKey` equals `matchValue` (evaluated per-render — the condition cannot be baked
 * into the compiled template because it depends on the concrete instance). v2
 * conditional-slice (RFC 92b91345, req ed4201d1).
 */
export interface ValueEqualityMatcher {
  kind: "value";
  /** Frontmatter key of the instance property the condition inspects (e.g. "ems__Effort_status"). */
  matchKey: string;
  /**
   * All identity forms of the ONE accepted value — its UID, its label, and any raw
   * wikilink form(s) — collected at compile time (dual-IRI equality). NOT a set of
   * distinct accepted values (v2 single-value slice; conjunctions/disjunctions are a
   * future exo__DisplayNameMatcher). A conditional rule matches when the instance value's
   * cleaned identity set intersects this set — so it matches whether the instance stores
   * the value as `[[<uid>]]`, `[[<uid>|label]]`, or the bare `[[<label>]]`.
   */
  matchValues: string[];
}

/**
 * A per-render COMPUTED / host-function condition compiled from an
 * exo__DisplayNameSpec's exo__DisplayNameSpec_matchHostFunction (→ the NAME of a
 * registered display-matcher host function). A rule carrying this matcher participates
 * only when the named host function returns true for the rendered instance — evaluated
 * per-render from (app, instance metadata), so it can resolve OTHER assets (a CROSS-ASSET
 * predicate) that a value-equality matcher on the instance's own frontmatter cannot
 * express. The first registered function is `isEffortBlocked`. v2 computed-slice
 * (RFC 92b91345, req d6cd2371).
 */
export interface HostFunctionMatcher {
  kind: "hostFunction";
  /** Name of a registered display-matcher host function, e.g. "isEffortBlocked". */
  hostFunction: string;
}

/**
 * A spec's per-render matcher. A spec MAY carry EITHER a value-equality matcher OR a
 * host-function matcher (v2 single-matcher slice — conjunctions/disjunctions are a
 * future exo__DisplayNameMatcher). When a spec declares both, value-equality takes
 * precedence (see compileDisplayNameSpecs).
 */
export type DisplayNameMatcher = ValueEqualityMatcher | HostFunctionMatcher;

/**
 * A registered display-matcher host function: a per-render, possibly CROSS-ASSET
 * predicate over (app, rendered-instance metadata). Seeded with isEffortBlocked. Kept
 * as an injected registry (composition-root seeding) so the engine stays free of any
 * concrete predicate — the plugin wires the real functions (see ExocortexPlugin).
 */
export type DisplayMatcherHostFunction = (
  app: App,
  metadata: Record<string, unknown>,
) => boolean;
export type DisplayMatcherHostFunctionRegistry = Record<string, DisplayMatcherHostFunction>;

export interface PrintNameRule {
  className: string;
  template: string;
  priority: number;
  sourceFile: string;
  /**
   * Present iff the spec declared a matcher — exo__DisplayNameSpec_matchPath + _matchValue
   * (value-equality) OR exo__DisplayNameSpec_matchHostFunction (host-function). Absent =
   * unconditional (v1 path).
   */
  matcher?: DisplayNameMatcher;
}

/**
 * A single participating spec exposed to the DisplayNameResolver for PREFIX COMPOSITION
 * (req 1a550210): its compiled template, its priority (the vault-declared compose-order field),
 * and the spec UID it came from (sourceFile) so the resolver can de-duplicate a spec that applies
 * to several of the note's classes. This is the multi-rule sibling of getTemplateForClass's single
 * `{ template, priority }` — the resolver composes a LIST of these instead of picking one.
 */
export interface ParticipatingRule {
  template: string;
  priority: number;
  sourceFile: string;
}

type MetadataResolver = (wikilinkTarget: string) => Record<string, unknown> | null;

// --- exo__DisplayNameSpec (structured-RDF displayName specs, v1 thin) ---
// TBox: PMBOK project 47d57acf, onto-RFC 92b91345, req b4ee3caa. Match a spec/part
// asset's exo__Instance_class by BOTH its label and its UID (assets key either form).
const DISPLAY_NAME_SPEC_CLASS = "exo__DisplayNameSpec";
const DISPLAY_NAME_SPEC_CLASS_UID = "07eab746-0874-4676-9d98-dbaad1bc6fb8";
const PRINTED_PROPERTY_CLASS = "exo__PrintedProperty";
const PRINTED_PROPERTY_CLASS_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const PRINTED_LITERAL_CLASS = "exo__PrintedLiteral";
const PRINTED_LITERAL_CLASS_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";
// Base priority floor for compiled exo__DisplayNameSpec rules (a spec's own priority adds on top).
const DISPLAY_NAME_SPEC_BASE_PRIORITY = 1000;

interface RawDisplayNameSpec {
  uid: string;
  classKeys: string[]; // UID + label of appliesToClass (both indexed — #2110)
  priority: number;
  // Value-equality specialization (v2 slice — RFC 92b91345, req ed4201d1). Both present or both absent.
  matchKey?: string; // frontmatter key resolved from exo__DisplayNameSpec_matchPath
  matchValues?: string[]; // accepted identities (UID + label) from exo__DisplayNameSpec_matchValue
  // Host-function specialization (v2 slice — RFC 92b91345, req d6cd2371).
  hostFunction?: string; // registered host-function name from exo__DisplayNameSpec_matchHostFunction
}

interface RawDisplayNamePart {
  specUid: string;
  order: number;
  propertyKey?: string; // frontmatter key for exo__PrintedProperty
  literal?: string; // static text for exo__PrintedLiteral
}

export class PrintNameRuleService {
  private rules: Map<string, PrintNameRule[]> = new Map();
  private classHierarchy: Map<string, string[]> = new Map();
  private initialized = false;

  /**
   * @param hostFunctions Registry of display-matcher host functions (name → predicate),
   *   consulted by a host-function matcher (req d6cd2371). Defaults to empty — a spec that
   *   names an unregistered function never participates (fail-closed). The plugin seeds it
   *   with isEffortBlocked (see ExocortexPlugin); v1/value-equality specs are unaffected.
   */
  constructor(
    private readonly app: App,
    private readonly hostFunctions: DisplayMatcherHostFunctionRegistry = {},
  ) {}

  initialize(): void {
    this.scanVault();
    this.initialized = true;
  }

  /**
   * Select the winning template for a class. Rules are priority-sorted; a CONDITIONAL
   * rule (one carrying a `matcher`) only participates when the rendered instance's
   * `metadata` satisfies the matcher — evaluated per-render, so a specialized displayName
   * appears/disappears as the instance's value changes without a re-scan. Unconditional
   * rules always participate (v1 path byte-identical). When `metadata` is omitted,
   * conditional rules are skipped (no instance to test).
   */
  getTemplateForClass(
    className: string,
    metadata?: Record<string, unknown>,
  ): { template: string; priority: number } | null {
    if (!this.initialized) return null;

    const direct = this.selectRule(this.rules.get(className), metadata);
    if (direct) return { template: direct.template, priority: direct.priority };

    const ancestors = this.getAncestorClasses(className);
    for (const ancestor of ancestors) {
      const inherited = this.selectRule(this.rules.get(ancestor), metadata);
      if (inherited) return { template: inherited.template, priority: inherited.priority };
    }

    return null;
  }

  /**
   * Return ALL participating rules for a class — the list the DisplayNameResolver composes into a
   * multi-prefix displayName (PREFIX COMPOSITION, req 1a550210). Mirrors getTemplateForClass's
   * direct-shadows-ancestor precedence: if ANY direct rule participates, EVERY participating direct
   * rule is returned (priority-DESC, already sorted); otherwise the participating rules of the first
   * ancestor level that has any. Each entry carries its spec sourceFile so the resolver can de-dup a
   * spec that applies to several of the note's classes. Empty when no rule participates (the resolver
   * then falls back to classTemplates / the default label). getTemplateForClass (single winner) is
   * retained for direct callers and byte-identical to `getParticipatingRules(...)[0]`.
   */
  getParticipatingRules(
    className: string,
    metadata?: Record<string, unknown>,
  ): ParticipatingRule[] {
    if (!this.initialized) return [];

    const direct = this.participatingOf(this.rules.get(className), metadata);
    if (direct.length > 0) return direct;

    for (const ancestor of this.getAncestorClasses(className)) {
      const inherited = this.participatingOf(this.rules.get(ancestor), metadata);
      if (inherited.length > 0) return inherited;
    }
    return [];
  }

  /**
   * Pick the highest-priority PARTICIPATING rule from a priority-sorted list — the single-winner
   * accessor still used by getTemplateForClass and direct tests. A rule participates if it is
   * unconditional (no matcher) OR its matcher is satisfied by the instance metadata (ruleParticipates).
   */
  private selectRule(
    rules: PrintNameRule[] | undefined,
    metadata?: Record<string, unknown>,
  ): PrintNameRule | null {
    if (!rules || rules.length === 0) return null;
    for (const rule of rules) {
      if (this.ruleParticipates(rule, metadata)) return rule;
    }
    return null;
  }

  /** Every participating rule from a (priority-sorted) list — the multi-rule sibling of selectRule. */
  private participatingOf(
    rules: PrintNameRule[] | undefined,
    metadata?: Record<string, unknown>,
  ): ParticipatingRule[] {
    if (!rules || rules.length === 0) return [];
    const out: ParticipatingRule[] = [];
    for (const rule of rules) {
      if (this.ruleParticipates(rule, metadata)) {
        out.push({
          template: rule.template,
          priority: rule.priority,
          sourceFile: rule.sourceFile,
        });
      }
    }
    return out;
  }

  /**
   * True when a rule participates in selection: unconditional (no matcher — v1 path, always
   * participates) OR its matcher is satisfied by the rendered instance metadata (per-render). When
   * `metadata` is omitted a conditional rule cannot be tested, so it is skipped.
   */
  private ruleParticipates(
    rule: PrintNameRule,
    metadata?: Record<string, unknown>,
  ): boolean {
    if (!rule.matcher) return true;
    if (!metadata) return false; // conditional rule but no instance to test → skipped
    return this.matcherSatisfied(rule.matcher, metadata);
  }

  /**
   * True when the rendered instance satisfies the rule's matcher, dispatched by kind:
   *  - "hostFunction": look the named function up in the injected registry and call it
   *    with (app, metadata) — a per-render, possibly cross-asset predicate (req d6cd2371).
   *    An UNREGISTERED name never participates (fail-closed): a conditional prefix must
   *    not appear when its predicate can't be evaluated.
   *  - "value": the instance's frontmatter value at `matcher.matchKey` equals `matchValue`
   *    under dual-IRI equality — both sides reduced to their identity set (UID + label
   *    forms via extractClassKeys) and the sets must intersect, so it is robust whether the
   *    status is stored as `[[<uid>]]`, `[[<uid>|label]]`, or the bare label (req ed4201d1;
   *    see sparql-iri-form-pre-verify).
   */
  private matcherSatisfied(
    matcher: DisplayNameMatcher,
    metadata: Record<string, unknown>,
  ): boolean {
    if (matcher.kind === "hostFunction") {
      const fn = this.hostFunctions[matcher.hostFunction];
      if (!fn) return false;
      return fn(this.app, metadata);
    }
    const instanceForms = this.extractClassKeys(metadata[matcher.matchKey]);
    if (instanceForms.length === 0) return false;
    return instanceForms.some((form) => matcher.matchValues.includes(form));
  }

  /**
   * Resolve exo__DisplayNameSpec_matchValue into ALL identity forms of the single
   * accepted value — the raw wikilink form(s) PLUS, via one compile-time second hop, the
   * referenced asset's UID and label. This closes the dual-IRI gap fully: a matchValue
   * authored UID-canon `[[<uid>]]` still matches an instance whose value is stored as the
   * bare label `[[<label>]]` (and vice versa), because both the UID and the label end up
   * in the accepted set. The hop runs once per spec at scanVault — no per-render cost.
   */
  private resolveMatchValues(value: unknown): string[] {
    const raw = this.extractClassKeys(value);
    if (raw.length === 0) return [];
    const forms = new Set<string>(raw);
    for (const id of raw) {
      const file =
        this.app.metadataCache.getFirstLinkpathDest(id, "") ??
        this.app.metadataCache.getFirstLinkpathDest(id.endsWith(".md") ? id : `${id}.md`, "");
      if (!(file instanceof TFile)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const uid = fm?.exo__Asset_uid;
      const label = fm?.exo__Asset_label;
      if (typeof uid === "string" && uid.trim()) forms.add(uid.trim());
      if (typeof label === "string" && label.trim()) forms.add(label.trim());
    }
    return [...forms];
  }

  /**
   * Resolve exo__DisplayNameSpec_matchHostFunction to the registered host-function NAME
   * it references. Unlike matchPath/matchValue (which are wikilinks to property/enum
   * assets), this is a plain STRING datatype value — the name of a registered
   * display-matcher host function (e.g. "isEffortBlocked"). Takes the first element if an
   * array; strips surrounding wikilink brackets / quotes / whitespace defensively.
   */
  private resolveHostFunctionName(value: unknown): string | null {
    let raw = value;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      raw = raw[0];
    }
    if (typeof raw !== "string") return null;

    const cleaned = raw
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"|"$/g, "")
      .trim();
    return cleaned || null;
  }

  createMetadataResolver(): MetadataResolver {
    return (wikilinkTarget: string): Record<string, unknown> | null => {
      const cleaned = wikilinkTarget
        .replace(/^\[\[|\]\]$/g, "")
        .replace(/^"|"$/g, "")
        .trim();

      if (!cleaned) return null;

      let file = this.app.metadataCache.getFirstLinkpathDest(cleaned, "");
      if (!file && !cleaned.endsWith(".md")) {
        file = this.app.metadataCache.getFirstLinkpathDest(cleaned + ".md", "");
      }

      if (!(file instanceof TFile)) {
        return null;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      return cache?.frontmatter ? { ...cache.frontmatter } : null;
    };
  }

  refresh(): void {
    this.scanVault();
  }

  private scanVault(): void {
    this.rules.clear();
    this.classHierarchy.clear();

    const rawSpecs = new Map<string, RawDisplayNameSpec>();
    const rawParts: RawDisplayNamePart[] = [];

    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const instanceClass = this.cleanClassValue(fm.exo__Instance_class);

      if (
        instanceClass === DISPLAY_NAME_SPEC_CLASS ||
        instanceClass === DISPLAY_NAME_SPEC_CLASS_UID
      ) {
        this.collectDisplayNameSpec(fm, rawSpecs);
      } else if (
        instanceClass === PRINTED_PROPERTY_CLASS ||
        instanceClass === PRINTED_PROPERTY_CLASS_UID ||
        instanceClass === PRINTED_LITERAL_CLASS ||
        instanceClass === PRINTED_LITERAL_CLASS_UID
      ) {
        this.collectDisplayNamePart(fm, rawParts);
      }

      const superClass = this.cleanClassValue(fm.exo__Class_superClass);
      if (superClass && instanceClass) {
        const cleanedChild = this.cleanClassValue(fm.exo__Asset_label) || instanceClass;

        const existing = this.classHierarchy.get(cleanedChild);
        if (existing) {
          existing.push(superClass);
        } else {
          this.classHierarchy.set(cleanedChild, [superClass]);
        }
      }
    }

    this.compileDisplayNameSpecs(rawSpecs, rawParts);
  }

  /** Collect a raw exo__DisplayNameSpec instance (appliesToClass + priority). */
  private collectDisplayNameSpec(
    fm: Record<string, unknown>,
    rawSpecs: Map<string, RawDisplayNameSpec>,
  ): void {
    const uid = typeof fm.exo__Asset_uid === "string" ? fm.exo__Asset_uid.trim() : "";
    if (!uid) return;

    const classKeys = this.extractClassKeys(fm.exo__DisplayNameSpec_appliesToClass);
    if (classKeys.length === 0) return;

    const rawPriority = fm.exo__DisplayNameSpec_priority;
    const priority =
      typeof rawPriority === "number"
        ? rawPriority
        : typeof rawPriority === "string" && rawPriority.trim() !== ""
          ? Number(rawPriority)
          : 0;

    // Value-equality specialization (v2 slice): resolve matchPath → the frontmatter key it
    // inspects (single-hop, same wikilink resolution as a PrintedProperty ref) and
    // matchValue → the accepted identity set (all forms of the ONE accepted value). A
    // value-equality matcher is set only when BOTH are present.
    const matchKey = this.resolvePropertyKey(fm.exo__DisplayNameSpec_matchPath);
    const matchValues = this.resolveMatchValues(fm.exo__DisplayNameSpec_matchValue);
    const hasValueMatcher = matchKey !== null && matchValues.length > 0;

    // Host-function specialization (v2 slice, req d6cd2371): resolve matchHostFunction →
    // the registered host-function NAME (a plain string, not a wikilink). Carried on the
    // raw spec; the union matcher is built in compileDisplayNameSpecs. Absent both → the
    // spec stays unconditional (v1 path).
    const hostFunction = this.resolveHostFunctionName(fm.exo__DisplayNameSpec_matchHostFunction);

    rawSpecs.set(uid, {
      uid,
      classKeys,
      priority: Number.isFinite(priority) ? priority : 0,
      ...(hasValueMatcher ? { matchKey: matchKey ?? undefined, matchValues } : {}),
      ...(hostFunction ? { hostFunction } : {}),
    });
  }

  /** Collect a raw exo__PrintedProperty / exo__PrintedLiteral part (of + order + payload). */
  private collectDisplayNamePart(
    fm: Record<string, unknown>,
    rawParts: RawDisplayNamePart[],
  ): void {
    const specUid = this.cleanClassValue(fm.exo__DisplayNamePart_of);
    if (!specUid) return;

    const rawOrder = fm.exo__DisplayNamePart_order;
    const order =
      typeof rawOrder === "number"
        ? rawOrder
        : typeof rawOrder === "string" && rawOrder.trim() !== ""
          ? Number(rawOrder)
          : NaN;
    if (!Number.isFinite(order)) return;

    // exo__PrintedProperty → resolve the referenced property's frontmatter key (all wikilink forms).
    const propertyKey = this.resolvePropertyKey(fm.exo__PrintedProperty_property);
    const rawLiteral = fm.exo__PrintedLiteral_literal;
    const literal = typeof rawLiteral === "string" ? rawLiteral : undefined;

    if (propertyKey) {
      rawParts.push({ specUid, order, propertyKey });
    } else if (literal !== undefined) {
      rawParts.push({ specUid, order, literal });
    }
  }

  /**
   * Compile collected specs + parts into template strings and register them as
   * high-priority PrintNameRules (so they win over the TS classTemplates cold-start
   * seeds). Each spec is indexed under BOTH its class UID and label.
   */
  private compileDisplayNameSpecs(
    rawSpecs: Map<string, RawDisplayNameSpec>,
    rawParts: RawDisplayNamePart[],
  ): void {
    const partsBySpec = new Map<string, RawDisplayNamePart[]>();
    for (const part of rawParts) {
      const arr = partsBySpec.get(part.specUid);
      if (arr) arr.push(part);
      else partsBySpec.set(part.specUid, [part]);
    }

    for (const spec of rawSpecs.values()) {
      const parts = (partsBySpec.get(spec.uid) ?? []).slice().sort((a, b) => a.order - b.order);
      if (parts.length === 0) continue;

      const template = parts
        .map((p) => (p.propertyKey ? `{{${p.propertyKey}}}` : (p.literal ?? "")))
        .join("");
      if (!template.trim()) continue;

      const priority = DISPLAY_NAME_SPEC_BASE_PRIORITY + spec.priority;

      // Build the union matcher. A spec MAY carry EITHER a value-equality matcher OR a
      // host-function matcher (v2 single-matcher slice). If a spec somehow declares both,
      // value-equality takes precedence (deterministic; conjunctions are a future
      // exo__DisplayNameMatcher).
      let matcher: DisplayNameMatcher | undefined;
      if (spec.matchKey && spec.matchValues && spec.matchValues.length > 0) {
        matcher = { kind: "value", matchKey: spec.matchKey, matchValues: spec.matchValues };
      } else if (spec.hostFunction) {
        matcher = { kind: "hostFunction", hostFunction: spec.hostFunction };
      }

      for (const classKey of spec.classKeys) {
        if (!classKey) continue;
        const rule: PrintNameRule = {
          className: classKey,
          template,
          priority,
          sourceFile: spec.uid,
          ...(matcher ? { matcher } : {}),
        };
        const existing = this.rules.get(classKey);
        if (existing) {
          existing.push(rule);
          existing.sort((a, b) => b.priority - a.priority);
        } else {
          this.rules.set(classKey, [rule]);
        }
      }
    }
  }

  /**
   * Resolve an exo__PrintedProperty_property reference to the frontmatter KEY it prints.
   * Handles every wikilink form so a spec authored either way works:
   *  - `[[uid|label]]` → the alias is the key (fast path, no hop);
   *  - `[[exo__Asset_label]]` → the bare target is already the key;
   *  - `[[<uid>]]` (UID-canon strip-alias) → second hop: read the referenced property
   *    asset's exo__Asset_label (which equals its frontmatter key).
   */
  private resolvePropertyKey(value: unknown): string | null {
    let raw = value;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      raw = raw[0];
    }
    if (typeof raw !== "string") return null;

    const cleaned = raw
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"|"$/g, "")
      .trim();
    if (!cleaned) return null;

    if (cleaned.includes("|")) {
      const label = cleaned.split("|").pop()?.trim();
      return label || null;
    }

    const target = cleaned.replace(/\.md$/, "").trim();
    if (!target) return null;

    // Second hop: resolve the bare target to a property asset and use its label.
    const file =
      this.app.metadataCache.getFirstLinkpathDest(target, "") ??
      this.app.metadataCache.getFirstLinkpathDest(
        target.endsWith(".md") ? target : `${target}.md`,
        "",
      );
    if (file instanceof TFile) {
      const label = this.app.metadataCache.getFileCache(file)?.frontmatter?.exo__Asset_label;
      if (typeof label === "string" && label.trim()) return label.trim();
    }

    // Fallback: the bare value is itself the frontmatter key.
    return target;
  }

  /**
   * Extract the class match-keys from an appliesToClass wikilink. Returns BOTH the
   * link target (UID) and the alias/label when a "|" is present, so an asset whose
   * exo__Instance_class keys by UID (`[[<uid>]]`) OR by label (`[[<uid>|label]]`)
   * both match the same spec (#2110 dual-keying).
   */
  private extractClassKeys(value: unknown): string[] {
    let raw = value;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return [];
      raw = raw[0];
    }
    if (typeof raw !== "string") return [];

    const cleaned = raw
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"|"$/g, "")
      .trim();
    if (!cleaned) return [];

    if (cleaned.includes("|")) {
      const [target, label] = cleaned.split("|");
      return [target.trim().replace(/\.md$/, ""), label.trim()].filter(
        (k): k is string => Boolean(k),
      );
    }
    return [cleaned.replace(/\.md$/, "")];
  }

  private getAncestorClasses(className: string): string[] {
    const ancestors: string[] = [];
    const visited = new Set<string>();
    const queue = [className];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const parents = this.classHierarchy.get(current);
      if (parents) {
        for (const parent of parents) {
          if (!visited.has(parent)) {
            ancestors.push(parent);
            queue.push(parent);
          }
        }
      }
    }

    return ancestors;
  }

  private cleanClassValue(value: unknown): string | null {
    if (!value) return null;

    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      return this.cleanClassValue(value[0]);
    }

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

  getRulesCount(): number {
    let count = 0;
    for (const rules of this.rules.values()) {
      count += rules.length;
    }
    return count;
  }
}
