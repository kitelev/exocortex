import type { App, TFile } from "obsidian";

import type {
  IProfileResolver,
  ProfileResolution,
} from "./FocusProfileSwitchManager";
import {
  FOCUS_PROFILE_CLASS_UID,
  KNOWLEDGE_PROFILE_CLASS_UID,
} from "./FocusProfileSwitchManager";

/**
 * Vault-backed implementation of {@link IProfileResolver}. Reads
 * `exo__FocusProfile` ABox assets через Obsidian metadataCache.
 *
 * Profile identification: an asset is a FocusProfile when its
 * `exo__Instance_class` (string or array) contains a wikilink to the
 * FocusProfile class UID `3de846cd-...` (frozen by RFC b6ba5595).
 *
 * Frontmatter fields consumed:
 *   - `exo__Asset_uid` (string) — profile UID
 *   - `exo__Asset_label` (string, optional) — display label; falls back to
 *     `file.basename` when missing
 *   - `exo__FocusProfile_includes` (string | string[]) — declared ontology
 *     wikilinks; normalised to bare ontology URIs (без leading `[[` /
 *     trailing `]]` / alias suffix `|...`)
 *   - `exo__FocusProfile_extends` (string, optional) — parent profile
 *     wikilink → UID
 *   - `exo__FocusProfile_alwaysOnOverlay` (string | string[], optional) —
 *     overlay ontology wikilinks; normalised identically
 *
 * Shared-ontology discovery: production scans the converter's RDF graph
 * для ontology IRIs matching the `shared-` prefix pattern. v3 backward-
 * compat scope omits the discovery hook — returns empty array so the
 * `FocusProfileSwitchManager`'s TS-floor pattern match falls through
 * to the hardcoded floor.
 */
export class VaultProfileResolver implements IProfileResolver {
  private readonly app: App;

  constructor(app: App) {
    if (!app) throw new Error("VaultProfileResolver: app is required");
    this.app = app;
  }

  async resolve(profileUid: string): Promise<ProfileResolution | null> {
    if (typeof profileUid !== "string" || profileUid.length === 0) return null;
    const file = this.findFocusProfileFileByUid(profileUid);
    if (file === null) return null;

    const fm = this.readFrontmatter(file);
    if (fm === null) return null;

    const includes = this.extractWikilinkList(fm["exo__FocusProfile_includes"]);
    const alwaysOnOverlay = this.extractWikilinkList(
      fm["exo__FocusProfile_alwaysOnOverlay"],
    );
    const extendsRaw = fm["exo__FocusProfile_extends"];
    const extendsUid =
      typeof extendsRaw === "string" && extendsRaw.length > 0
        ? this.resolveExtendsToUid(extendsRaw)
        : null;
    // AC13 (RFC 13da049f Phase 6.5b) — consume `exo__FocusProfile_appliesTo`,
    // the Knowledge profile UID this Focus profile is scoped to (compat
    // constraint anchor for the AC16 runtime check). Stored as a wikilink to
    // the Knowledge profile's UID-named file; normalised to the bare UID.
    const appliesTo = this.extractFirstWikilink(
      fm["exo__FocusProfile_appliesTo"],
    );
    const label =
      typeof fm["exo__Asset_label"] === "string"
        ? (fm["exo__Asset_label"] as string)
        : file.basename;

    return {
      uid: profileUid,
      includes,
      extends: extendsUid,
      alwaysOnOverlay,
      appliesTo,
      label,
    };
  }

  async discoverSharedOntologies(): Promise<string[]> {
    // v3 backward-compat: TS-floor's hardcoded `shared-` pattern match
    // covers the empirically-relevant case (vault-2025 shared-identities).
    // Production RDF-walk discovery deferred to Phase C+D follow-up.
    return [];
  }

  /**
   * Walks the vault searching for the FocusProfile asset whose
   * `exo__Asset_uid` matches. Returns `null` if absent.
   *
   * Exposed for `profileLister` reuse — the plugin's command-palette
   * handler scans the vault для all FocusProfile assets, so the same
   * frontmatter discrimination logic lives here.
   */
  public findFocusProfileFileByUid(uid: string): TFile | null {
    for (const file of this.listFocusProfileFiles()) {
      const fm = this.readFrontmatter(file);
      if (fm === null) continue;
      if (fm["exo__Asset_uid"] === uid) return file;
    }
    return null;
  }

  /**
   * Walks the vault returning every FocusProfile asset. Caller filters
   * по UID / label as needed. Used by `profileLister` to populate the
   * fuzzy picker.
   */
  public listFocusProfileFiles(): TFile[] {
    return this.listProfileFilesByClass(FOCUS_PROFILE_CLASS_UID);
  }

  /**
   * Walks the vault returning every KnowledgeProfile asset (RFC 13da049f
   * Phase 6.5b AC17). Used by the «Switch knowledge profile» palette picker.
   * Dual-class assets (declaring both Focus + Knowledge) appear in BOTH
   * `listFocusProfileFiles()` and this list because the discrimination is by
   * `exo__Instance_class` membership, not exclusivity.
   */
  public listKnowledgeProfileFiles(): TFile[] {
    return this.listProfileFilesByClass(KNOWLEDGE_PROFILE_CLASS_UID);
  }

  /**
   * Walks the vault returning assets whose `exo__Instance_class` contains the
   * given class UID. Shared by {@link listFocusProfileFiles} and
   * {@link listKnowledgeProfileFiles} so the per-class fuzzy pickers (AC17)
   * and the dual-class membership rule stay in one place.
   */
  public listProfileFilesByClass(classUid: string): TFile[] {
    const out: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.readFrontmatter(file);
      if (fm === null) continue;
      if (this.instanceClassContains(fm, classUid)) out.push(file);
    }
    return out;
  }

  private instanceClassContains(
    fm: Record<string, unknown>,
    classUid: string,
  ): boolean {
    const raw = fm["exo__Instance_class"];
    const classes: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const c of classes) {
      if (typeof c !== "string") continue;
      if (c.includes(classUid)) return true;
    }
    return false;
  }

  private readFrontmatter(file: TFile): Record<string, unknown> | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm === null || fm === undefined) return null;
    return fm as Record<string, unknown>;
  }

  private extractWikilinkList(value: unknown): string[] {
    const items: unknown[] = Array.isArray(value)
      ? value
      : value !== undefined && value !== null
        ? [value]
        : [];
    const out: string[] = [];
    for (const raw of items) {
      if (typeof raw !== "string") continue;
      const cleaned = raw
        .trim()
        .replace(/^\[\[/, "")
        .replace(/\]\]$/, "")
        .split("|")[0]
        .trim();
      if (cleaned.length > 0) out.push(cleaned);
    }
    return out;
  }

  /**
   * Extract a single wikilink target as a bare UID. Accepts a string
   * (`[[<uid>]]` / `[[<uid>|alias]]`) or a single-element array (frontmatter
   * may serialise a 0..1 wikilink either way). Returns null when absent/empty.
   * Used for `exo__FocusProfile_appliesTo` (AC13, cardinality 0..1).
   */
  private extractFirstWikilink(value: unknown): string | null {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== "string") return null;
    const cleaned = first
      .trim()
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]
      .trim();
    return cleaned.length === 0 ? null : cleaned;
  }

  /**
   * `_extends` is stored as a wikilink to the parent profile's UID-named
   * file (`[[<parent-uid>]]`). Strip wikilink syntax to expose the UID
   * directly — the SwitchManager's chain walker keys by UID.
   */
  private resolveExtendsToUid(raw: string): string | null {
    const cleaned = raw
      .trim()
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]
      .trim();
    return cleaned.length === 0 ? null : cleaned;
  }
}
