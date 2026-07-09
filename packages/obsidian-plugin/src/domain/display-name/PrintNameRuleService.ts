import { TFile } from "obsidian";
import type { App } from "obsidian";

/**
 * A per-render condition compiled from an exo__DisplayNameSpec's
 * exo__DisplayNameSpec_matchPath (→ frontmatter key) + exo__DisplayNameSpec_matchValue
 * (→ cleaned enum identity/-ies). A rule carrying a matcher is CONDITIONAL: it only
 * participates in class selection when the rendered instance's frontmatter value at
 * `matchKey` equals `matchValue` (evaluated per-render — the condition cannot be baked
 * into the compiled template because it depends on the concrete instance). v2
 * conditional-slice (RFC 92b91345, req ed4201d1).
 */
export interface DisplayNameMatcher {
  /** Frontmatter key of the instance property the condition inspects (e.g. "ems__Effort_status"). */
  matchKey: string;
  /**
   * Accepted identities of the expected value — BOTH the UID and the label form
   * (dual-IRI equality). A conditional rule matches when the instance value's
   * cleaned identity set intersects this set.
   */
  matchValues: string[];
}

export interface PrintNameRule {
  className: string;
  template: string;
  priority: number;
  sourceFile: string;
  /** Present iff the spec declared exo__DisplayNameSpec_matchPath + _matchValue (conditional). */
  matcher?: DisplayNameMatcher;
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
  // Conditional specialization (v2 slice — RFC 92b91345, req ed4201d1). Both present or both absent.
  matchKey?: string; // frontmatter key resolved from exo__DisplayNameSpec_matchPath
  matchValues?: string[]; // accepted identities (UID + label) from exo__DisplayNameSpec_matchValue
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

  constructor(private readonly app: App) {}

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
   * Pick the highest-priority PARTICIPATING rule from a priority-sorted list. A rule
   * participates if it is unconditional (no matcher) OR its matcher is satisfied by the
   * instance metadata. A matched conditional rule beats an unconditional one purely by
   * priority (the list is already sorted descending), so a conditional spec authored with
   * a higher priority wins over the fallback; an unmatched conditional is skipped.
   */
  private selectRule(
    rules: PrintNameRule[] | undefined,
    metadata?: Record<string, unknown>,
  ): PrintNameRule | null {
    if (!rules || rules.length === 0) return null;
    for (const rule of rules) {
      if (!rule.matcher) return rule; // unconditional — always participates
      if (metadata && this.matcherSatisfied(rule.matcher, metadata)) return rule;
    }
    return null;
  }

  /**
   * True when the instance's frontmatter value at `matcher.matchKey` equals `matchValue`
   * under dual-IRI equality: both sides are reduced to their identity set (UID + label
   * forms via extractClassKeys) and the sets must intersect. This makes the condition
   * robust whether the status is stored as `[[<uid>]]`, `[[<uid>|label]]`, or the bare
   * label — see sparql-iri-form-pre-verify.
   */
  private matcherSatisfied(
    matcher: DisplayNameMatcher,
    metadata: Record<string, unknown>,
  ): boolean {
    const instanceForms = this.extractClassKeys(metadata[matcher.matchKey]);
    if (instanceForms.length === 0) return false;
    return instanceForms.some((form) => matcher.matchValues.includes(form));
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

    // Conditional specialization (v2 slice): resolve matchPath → the frontmatter key it
    // inspects (single-hop, same wikilink resolution as a PrintedProperty ref) and
    // matchValue → the accepted identity set (UID + label). A matcher is set only when
    // BOTH are present; otherwise the spec stays unconditional (v1 path).
    const matchKey = this.resolvePropertyKey(fm.exo__DisplayNameSpec_matchPath);
    const matchValues = this.extractClassKeys(fm.exo__DisplayNameSpec_matchValue);
    const hasMatcher = matchKey !== null && matchValues.length > 0;

    rawSpecs.set(uid, {
      uid,
      classKeys,
      priority: Number.isFinite(priority) ? priority : 0,
      ...(hasMatcher ? { matchKey: matchKey ?? undefined, matchValues } : {}),
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

      const matcher: DisplayNameMatcher | undefined =
        spec.matchKey && spec.matchValues && spec.matchValues.length > 0
          ? { matchKey: spec.matchKey, matchValues: spec.matchValues }
          : undefined;

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
