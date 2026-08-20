import { TFile } from "obsidian";
import { resolvePreferenceList } from "@kitelev/exocortex-core";
import type { App } from "obsidian";

/**
 * ConceptDefinitionSpecService — loads the VAULT-DECLARED concept-definition composition template.
 *
 * Delta-2 of concept-typization (req eb18a3a4). The composition of a concept's definition
 * ("<differentia> <genus>") is NOT hardcoded in TS — it is declared as vault data: a
 * `concept__ConceptDefinitionSpec` asset (appliesToClass concept__Concept) with ordered
 * `exo__PrintedProperty` / `exo__PrintedLiteral` parts (the SAME part vocabulary the homoiconic
 * displayName system uses). This service scans the vault for that spec + its parts and compiles
 * them into a `DisplayNameTemplateEngine` template string (e.g.
 * "{{concept__Concept_differentia}} {{concept__Concept_genus}}"). Editing the spec's parts/order/
 * literals in the vault changes the composition with NO code change (Homoiconicity Invariant Q1).
 *
 * Mirrors PrintNameRuleService's scan/compile, but for a DEFINITION spec (not a display-NAME spec)
 * — kept separate so PrintNameRuleService (the display-name engine) is untouched. It collects a
 * superset of exo__PrintedProperty/exo__PrintedLiteral parts and keeps only those whose
 * `exo__DisplayNamePart_of` points at a concept-definition spec, so a DisplayNameSpec's parts are
 * ignored here (and vice-versa).
 */

const CONCEPT_DEFINITION_SPEC_CLASS = "concept__ConceptDefinitionSpec";
const CONCEPT_DEFINITION_SPEC_CLASS_UID = "26358178-cf0e-4e5f-b92a-f59c6ac71908";
const PRINTED_PROPERTY_CLASS = "exo__PrintedProperty";
const PRINTED_PROPERTY_CLASS_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const PRINTED_LITERAL_CLASS = "exo__PrintedLiteral";
const PRINTED_LITERAL_CLASS_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";

interface RawSpec {
  uid: string;
  classKeys: string[]; // appliesToClass — UID + label forms
}

interface RawPart {
  specUid: string;
  order: number;
  propertyKey?: string; // exo__PrintedProperty
  literal?: string; // exo__PrintedLiteral
}

/**
 * Trailing debounce for scheduleRefresh() — collapses a burst of metadataCache "changed" events
 * into ONE scanVault. Same fix as PrintNameRuleService: an un-debounced full O(N) vault walk on
 * EVERY file change is the documented iPhone-Jetsam crash-loop root cause under a sync burst
 * (O(K·N)). The definition spec is ~4 assets and rarely changes, so 300ms trailing is imperceptible.
 */
const SPEC_RESCAN_DEBOUNCE_MS = 300;

export class ConceptDefinitionSpecService {
  private templates: Map<string, string> = new Map(); // appliesToClass key → compiled template
  private initialized = false;
  private scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly app: App) {}

  initialize(): void {
    this.scanVault();
    this.initialized = true;
  }

  /** Immediate rescan — for the rare cold-start ("resolved") rebuild, not the high-frequency path. */
  refresh(): void {
    this.scanVault();
  }

  /**
   * Debounced rescan for the high-frequency metadataCache "changed" handler. A burst of K change
   * events (e.g. a sync pull) collapses into ONE scanVault ~300ms after the last event, instead of
   * K full O(N) vault walks (the crash-loop fix — mirrors PrintNameRuleService.scheduleRefresh).
   */
  scheduleRefresh(): void {
    if (this.scanDebounceTimer !== null) {
      clearTimeout(this.scanDebounceTimer);
    }
    this.scanDebounceTimer = setTimeout(() => {
      this.scanDebounceTimer = null;
      this.scanVault();
      this.initialized = true;
    }, SPEC_RESCAN_DEBOUNCE_MS);
  }

  /** The compiled definition-composition template for a concept class, or null if no spec applies. */
  getTemplate(className: string): string | null {
    if (!this.initialized) return null;
    return this.templates.get(className) ?? null;
  }

  private scanVault(): void {
    this.templates.clear();

    const rawSpecs = new Map<string, RawSpec>();
    const rawParts: RawPart[] = [];

    let files: TFile[] = [];
    if (typeof this.app.vault.getMarkdownFiles === "function") {
      const result = this.app.vault.getMarkdownFiles();
      if (Array.isArray(result)) files = result;
    }
    for (const file of files) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      const instanceClass = this.cleanValue(fm.exo__Instance_class);
      if (
        instanceClass === CONCEPT_DEFINITION_SPEC_CLASS ||
        instanceClass === CONCEPT_DEFINITION_SPEC_CLASS_UID
      ) {
        this.collectSpec(fm, rawSpecs);
      } else if (
        instanceClass === PRINTED_PROPERTY_CLASS ||
        instanceClass === PRINTED_PROPERTY_CLASS_UID ||
        instanceClass === PRINTED_LITERAL_CLASS ||
        instanceClass === PRINTED_LITERAL_CLASS_UID
      ) {
        this.collectPart(fm, rawParts);
      }
    }

    this.compile(rawSpecs, rawParts);
  }

  private collectSpec(fm: Record<string, unknown>, rawSpecs: Map<string, RawSpec>): void {
    const uid = typeof fm.exo__Asset_uid === "string" ? fm.exo__Asset_uid.trim() : "";
    if (!uid) return;
    const classKeys = this.extractClassKeys(
      fm.concept__ConceptDefinitionSpec_appliesToClass,
    );
    if (classKeys.length === 0) return;
    rawSpecs.set(uid, { uid, classKeys });
  }

  private collectPart(fm: Record<string, unknown>, rawParts: RawPart[]): void {
    const specUid = this.cleanValue(fm.exo__DisplayNamePart_of);
    if (!specUid) return;

    const rawOrder = fm.exo__DisplayNamePart_order;
    const order =
      typeof rawOrder === "number"
        ? rawOrder
        : typeof rawOrder === "string" && rawOrder.trim() !== ""
          ? Number(rawOrder)
          : NaN;
    if (!Number.isFinite(order)) return;

    const propertyKey = this.resolvePropertyKey(fm.exo__PrintedProperty_property);
    const rawLiteral = fm.exo__PrintedLiteral_literal;
    const literal = typeof rawLiteral === "string" ? rawLiteral : undefined;

    if (propertyKey) {
      rawParts.push({ specUid, order, propertyKey });
    } else if (literal !== undefined) {
      rawParts.push({ specUid, order, literal });
    }
  }

  private compile(rawSpecs: Map<string, RawSpec>, rawParts: RawPart[]): void {
    const partsBySpec = new Map<string, RawPart[]>();
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

      for (const classKey of spec.classKeys) {
        if (classKey && !this.templates.has(classKey)) {
          this.templates.set(classKey, template);
        }
      }
    }
  }

  /**
   * Resolve an exo__PrintedProperty_property reference to the frontmatter KEY it prints
   * (mirrors PrintNameRuleService.resolvePropertyKey): `[[uid|label]]` → label; a bare `[[uid]]`
   * → second-hop the referenced property asset's exo__Asset_label; else the bare target.
   */
  private resolvePropertyKey(value: unknown): string | null {
    // ⛤ A MULTI-VALUE property is an ordered PREFERENCE LIST, exactly as it is
    // for display-name — one vault predicate, one semantics (#4050). This used
    // to take `value[0]` and drop the rest silently: an author writing a
    // 4-candidate list here got the first printed unconditionally, with no
    // diagnostic, while the same shape worked in display-name.
    //
    // The compiled `a|b|c` needs nothing further downstream: parts render
    // through the SAME `DisplayNameTemplateEngine`, which already walks the
    // candidates and returns the first non-empty one.
    return resolvePreferenceList(value, (v) => this.resolveOnePropertyKey(v));
  }

  /** Resolve ONE reference to its frontmatter key, through Obsidian's metadataCache. */
  private resolveOnePropertyKey(value: unknown): string | null {
    const raw = value;
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
    return target;
  }

  /** Both link-target (UID) and alias/label of an appliesToClass wikilink (dual-keying). */
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

  private cleanValue(value: unknown): string | null {
    if (!value) return null;
    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      return this.cleanValue(value[0]);
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
}
