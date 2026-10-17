import { Keymap, Plugin, TFile } from "obsidian";
import type { PaneType } from "obsidian";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";

/**
 * PropertiesLabelPatch - Patches Obsidian's Properties block to show human-readable
 * predicate labels and makes them clickable to open the predicate definition asset.
 *
 * Resolution strategy (RFC-030 — exo__Property_displayName, 2026-05-23):
 *  1. At init time walk the class hierarchy in metadataCache, computing the set
 *     of UIDs that descend from exo__Property via exo__Class_superClass triples
 *     (subClass closure). Cache as `propertyClassUids`.
 *  2. Index only assets whose `exo__Instance_class` intersects propertyClassUids
 *     (rdf:type filter). All non-property assets are skipped — this protects
 *     against label-collision shadowing from ABox concepts.
 *  3. Matching key for cache: `exo__Asset_label` (TBox convention: label of a
 *     property asset equals the raw predicate name, e.g. "ems__Effort_area").
 *  4. Short name (issue #4568): the first non-empty of `exo__Property_displayName`,
 *     `exo__Property_localName`, the local part of `exo__Asset_label` (everything
 *     after the class segment: `concept__Concept_genus` → `genus`,
 *     `tbank__Task_planned_start_timestamp` → `planned_start_timestamp`).
 *  5. Display text is decided per Properties BLOCK, not per key: a key whose short
 *     name is unique in its block reads the short name; keys of one block that
 *     would read the same read `<ClassName>.<short name>` (ClassName = local name
 *     of the property's domain class); still equal or no class name → the raw
 *     predicate, which is unique in the block. See `disambiguateBlockLabels`.
 *  6. Index collision handling: first-write-wins + `console.warn` (deterministic
 *     by `vault.getMarkdownFiles()` enumeration order). Data-side collisions are
 *     surfaced but not auto-resolved.
 *
 * Behavior changes from pre-RFC-030 mechanic:
 *  - aliases-array matching removed (was secondary fallback). For property
 *    assets following TBox convention (label == raw predicate == aliases[0])
 *    the aliases loop was always a no-op after self-match skip.
 *  - line "if (key === label) continue" skip removed. With the new matching
 *    semantics (key == label by definition), the skip would always fire and
 *    block every property asset.
 *  - rdf:type filter is hard, not optional. Legacy ims__Concept assets that
 *    used to resolve via aliases-match no longer participate. Intentional —
 *    UI resolver must operate only on canonical TBox property definitions.
 *
 * Reading Mode only. Live Preview is explicitly out of scope for first
 * iteration. Follows the MutationObserver + layout-change re-patch pattern
 * established by PropertiesLinkPatch / PropertiesUidCopyPatch.
 */

const PATCHED_ATTR = "data-exo-label-patched";
const DISPLAY_SPAN_CLASS = "exo-label-display";
const HIDDEN_INPUT_CLASS = "exo-label-hidden-input";
const CLICKABLE_CLASS = "exo-label-clickable";

// Root UID of exo__Property class (TBox-stable). All assets whose
// exo__Instance_class transitively descends from this UID via
// exo__Class_superClass qualify as "property assets" for indexing.
const EXO_PROPERTY_ROOT_UID = "38277bfa-d7f9-4a75-b856-b23276ab0db3";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface ResolvedPredicate {
  /** Short name of the property (displayName → localName → label local part). */
  shortName: string;
  /** Local name of the property's class, used as `<ClassName>.` on a block collision. */
  className: string | null;
  file: TFile;
}

/** What the index needs to know about any asset that a domain reference may name. */
interface AssetNames {
  label: string | null;
  classLocalName: string | null;
}

interface PatchRecord {
  predicate: string;
  /** Resolution the row was patched with — re-texting never consults the index. */
  resolved: ResolvedPredicate;
  propertyEl: HTMLElement;
  keyEl: HTMLElement;
  input: HTMLInputElement | null;
  displaySpan: HTMLSpanElement;
  textNode: Text | null;
  originalTextContent: string | null;
  clickHandler: (e: MouseEvent) => void;
  auxClickHandler: (e: MouseEvent) => void;
}

/**
 * Unwrap an Obsidian-style wikilink to a canonical UID.
 *   "[[uuid]]"              → "uuid"
 *   "[[uuid|alias]]"        → "uuid"
 *   "[[path/to/uuid]]"      → "uuid"  (strips path prefix; UID-canon TBox
 *                                       does not emit path-qualified links,
 *                                       but legacy authoring tools may —
 *                                       defensive parsing avoids silent
 *                                       BFS-closure miss for class refs)
 *   "uuid"                  → "uuid"  (when shape matches UUID v4 layout)
 *   anything else           → null
 *
 * Exported for unit testing.
 */
export function unwrapWikilinkUid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const wlMatch = trimmed.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (wlMatch) {
    // Strip any path prefix: "some/path/uuid" → "uuid". Mirrors the leniency
    // pattern from PrintNameRuleService.cleanClassValue for cross-resolver
    // consistency.
    const inner = wlMatch[1].trim();
    const lastSegment = inner.split("/").pop()?.trim() ?? "";
    if (UUID_REGEX.test(lastSegment)) return lastSegment;
    // Path-stripped form isn't a UUID — return null so the caller can skip
    // (consistent with non-UUID symbolic wikilink behavior).
    return null;
  }
  if (UUID_REGEX.test(trimmed)) return trimmed;
  return null;
}

/**
 * Normalize Obsidian YAML class-list value (scalar or array) into a sanitized
 * array of UIDs. Each element is unwrapped via `unwrapWikilinkUid` so we hold
 * canonical UIDs only.
 *
 * Exported for unit testing.
 */
export function normalizeClassList(value: unknown): string[] {
  let raw: unknown[];
  if (Array.isArray(value)) raw = value;
  else if (typeof value === "string") raw = [value];
  else return [];

  const out: string[] = [];
  for (const v of raw) {
    const uid = unwrapWikilinkUid(v);
    if (uid) out.push(uid);
  }
  return out;
}

/** Trimmed non-empty string, or null. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Split a predicate label `<prefix>__<Class>_<local>` into its class segment and
 * local part. The class segment ends at the FIRST `_` after `__`, so a local part
 * that itself contains `_` stays whole (`planned_start_timestamp`). A label
 * without `__` has neither (`aliases`); a label without a class segment has only
 * a local part (`rdfs__seeAlso` → `seeAlso`).
 */
function splitPredicateLabel(label: string): {
  classSegment: string | null;
  local: string;
} {
  const trimmed = label.trim();
  const sep = trimmed.indexOf("__");
  if (sep < 0) return { classSegment: null, local: trimmed };
  const rest = trimmed.slice(sep + 2);
  const underscore = rest.indexOf("_");
  if (underscore <= 0) return { classSegment: null, local: rest || trimmed };
  const local = rest.slice(underscore + 1);
  return {
    classSegment: rest.slice(0, underscore),
    local: local.length > 0 ? local : rest,
  };
}

/**
 * Local part of a predicate label — the short name a property reads when it has
 * neither `exo__Property_displayName` nor `exo__Property_localName`.
 *   "concept__Concept_genus"              → "genus"
 *   "tbank__Task_planned_start_timestamp" → "planned_start_timestamp"
 *   "rdfs__seeAlso"                       → "seeAlso"
 *   "aliases"                             → "aliases"
 *
 * Exported for unit testing.
 */
export function labelLocalPart(label: string): string {
  return splitPredicateLabel(label).local;
}

/**
 * Class segment of a predicate label (`ems__Effort_status` → `Effort`), or null
 * when the label has none. Last-resort class name for a property without a
 * resolvable domain.
 *
 * Exported for unit testing.
 */
export function labelClassSegment(label: string): string | null {
  return splitPredicateLabel(label).classSegment;
}

/**
 * Local name of a class from its label: the part after `__`
 * (`concept__Concept` → `Concept`); a label without `__` is taken whole.
 *
 * Exported for unit testing.
 */
export function classNameFromLabel(label: string): string | null {
  const trimmed = label.trim();
  const sep = trimmed.indexOf("__");
  const name = sep >= 0 ? trimmed.slice(sep + 2) : trimmed;
  return name.length > 0 ? name : null;
}

/**
 * Text of a non-UID domain reference: `[[person__Person]]` / `[[person__Person|P]]`
 * / bare `person__Person` → `person__Person`; anything else → null.
 */
function symbolicReference(value: unknown): string | null {
  const trimmed = nonEmptyString(value);
  if (!trimmed) return null;
  const wlMatch = trimmed.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  const inner = wlMatch ? wlMatch[1].trim() : trimmed;
  const lastSegment = inner.split("/").pop()?.trim() ?? "";
  return lastSegment.length > 0 ? lastSegment : null;
}

/** One key of a Properties block, as the disambiguation sees it. */
export interface BlockKey {
  /**
   * The text the key reads natively — the raw frontmatter key. For a key without
   * a property definition this is also what it keeps reading.
   */
  key: string;
  /** Short name when the key has a property definition; null = key is not patched. */
  shortName: string | null;
  /** Local name of the property's class; null = no `<ClassName>.` form exists. */
  className: string | null;
}

/**
 * Decide the text of every DEFINED key of ONE Properties block (issue #4568):
 *  1. a short name no other key of the block reads → the short name;
 *  2. a short name another key of the block also reads (a defined key's short
 *     name or an undefined key's raw text) → `<ClassName>.<short name>`;
 *  3. that text still equal to another key's text, or no ClassName → the raw
 *     predicate (frontmatter keys are unique in a block).
 * Order-independent: the result does not depend on the order of `keys`.
 * Returns a map raw key → text for defined keys only.
 *
 * Exported for unit testing.
 */
export function disambiguateBlockLabels(keys: BlockKey[]): Map<string, string> {
  const countTexts = (texts: Array<string | null>): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const text of texts) {
      if (text === null) continue;
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    return counts;
  };

  const firstTexts = keys.map((k) => k.shortName ?? k.key);
  const firstCounts = countTexts(firstTexts);

  // null = the key needs its raw predicate (prefix impossible).
  const secondTexts: Array<string | null> = keys.map((k) => {
    if (k.shortName === null) return k.key;
    if ((firstCounts.get(k.shortName) ?? 0) <= 1) return k.shortName;
    return k.className ? `${k.className}.${k.shortName}` : null;
  });
  const secondCounts = countTexts(secondTexts);

  const result = new Map<string, string>();
  keys.forEach((k, i) => {
    if (k.shortName === null) return;
    const text = secondTexts[i];
    const wasPrefixed = text !== k.shortName;
    if (text === null || (wasPrefixed && (secondCounts.get(text) ?? 0) > 1)) {
      result.set(k.key, k.key);
      return;
    }
    result.set(k.key, text);
  });
  return result;
}

export class PropertiesLabelPatch {
  private app: Plugin["app"];
  private plugin: Plugin;
  private observer: MutationObserver | null = null;
  private enabled = false;
  private resolveCache: Map<string, ResolvedPredicate> = new Map();
  private propertyClassUids: Set<string> = new Set();
  private assetNamesByUid: Map<string, AssetNames> = new Map();
  private indexBuilt = false;
  private patched: PatchRecord[] = [];
  private recordsByEl: WeakMap<HTMLElement, PatchRecord> = new WeakMap();
  private readonly logger = LoggerFactory.create("PropertiesLabelPatch");

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.buildIndex();
    this.patchAllPropertiesBlocks();
    this.setupObserver();

    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.invalidateIndex();
        this.patchAllPropertiesBlocks();
      })
    );

    // Obsidian fires "resolved" once the initial vault parse finishes. On a
    // fresh-vault/tarball install this arrives AFTER enable() runs — plugin
    // starts 500ms post-load, but metadata parsing can still be in flight —
    // so without this listener the index built at enable() sees null
    // frontmatters for every property def file and readable labels never
    // appear. Subscribing here makes the feature work on the supported
    // starter-kit install path. Finding 4, UX audit 2026-04-14.
    this.plugin.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.invalidateIndex();
        this.patchAllPropertiesBlocks();
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on("layout-change", () => {
        window.setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        window.setTimeout(() => this.patchAllPropertiesBlocks(), 100);
      })
    );
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.restoreAll();
  }

  cleanup(): void {
    this.disable();
  }

  private invalidateIndex(): void {
    this.indexBuilt = false;
    this.resolveCache.clear();
    this.propertyClassUids.clear();
    this.assetNamesByUid.clear();
  }

  /**
   * Build the Set of UIDs for `exo__Property` and all its (transitive) subclasses
   * by walking the class-hierarchy graph defined by `exo__Class_superClass`
   * triples in the metadataCache. Pure metadata-cache approach — no SPARQL
   * engine dependency. Synchronous; runs once per `buildIndex` invocation.
   *
   * BFS fixpoint: starting from `EXO_PROPERTY_ROOT_UID`, repeatedly include any
   * class whose `exo__Class_superClass` contains an already-included UID, until
   * no additions in a pass.
   *
   * The same pass records every asset's label and `exo__Class_localName` into
   * `assetNamesByUid` — the class names a property's `exo__Property_domain` may
   * point at (issue #4568). One walk instead of two: the index is invalidated
   * on every metadataCache change and rebuilt on the next unpatched key.
   */
  private resolvePropertyClassUids(files: TFile[]): Set<string> {
    // childUid → Set<parentUid> from frontmatter exo__Class_superClass
    const superClassMap: Map<string, Set<string>> = new Map();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const uidRaw = fm["exo__Asset_uid"];
      if (typeof uidRaw !== "string") continue;
      const uid = uidRaw.trim();
      if (!uid) continue;

      this.assetNamesByUid.set(uid, {
        label: nonEmptyString(fm["exo__Asset_label"]),
        classLocalName: nonEmptyString(fm["exo__Class_localName"]),
      });

      const supers = normalizeClassList(fm["exo__Class_superClass"]);
      // Include root with empty parents too so a vault containing
      // exo__Property itself but no subclasses still seeds the Set.
      superClassMap.set(uid, new Set(supers));
    }

    const result = new Set<string>([EXO_PROPERTY_ROOT_UID]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [childUid, parentUids] of superClassMap) {
        if (result.has(childUid)) continue;
        for (const parentUid of parentUids) {
          if (result.has(parentUid)) {
            result.add(childUid);
            changed = true;
            break;
          }
        }
      }
    }
    return result;
  }

  /**
   * Insert a cache entry, but if `key` already maps to a *different* file,
   * keep the first write and log a collision warning. Deterministic by
   * `vault.getMarkdownFiles()` enumeration order.
   */
  private setWithCollisionGuard(
    key: string,
    value: ResolvedPredicate
  ): void {
    const existing = this.resolveCache.get(key);
    if (existing && existing.file.path !== value.file.path) {
      // INFO, not WARN: the warn level routes to an Obsidian Notice by default
      // (DEFAULT_LOG_CHANNELS), and the index can be rebuilt after every
      // metadataCache change — a data-side collision would toast on every
      // edit. INFO keeps the former console-only surfacing.
      this.logger.info(
        `Label collision for key "${key}": ` +
          `keeping ${existing.file.path}, ignoring ${value.file.path}`
      );
      return;
    }
    this.resolveCache.set(key, value);
  }

  private buildIndex(): void {
    if (this.indexBuilt) return;
    this.resolveCache.clear();
    this.propertyClassUids.clear();
    this.assetNamesByUid.clear();

    let files: TFile[] = [];
    if (typeof this.app.vault.getMarkdownFiles === "function") {
      const result = this.app.vault.getMarkdownFiles();
      if (Array.isArray(result)) {
        files = result;
      }
    }

    // Step 1: resolve subClass closure for exo__Property.
    // Done once per index build; ~138 known property assets and ~30 class
    // assets in current TBox, BFS converges in 2-3 passes.
    this.propertyClassUids = this.resolvePropertyClassUids(files);

    // Step 2: index property-class ассеты only.
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const rawLabel = fm["exo__Asset_label"];
      if (typeof rawLabel !== "string") continue;
      const label = rawLabel.trim();
      if (!label) continue;

      // rdf:type filter — assets whose exo__Instance_class contains at least
      // one UID from the property-class closure.
      const classUids = normalizeClassList(fm["exo__Instance_class"]);
      if (classUids.length === 0) continue;
      if (!classUids.some((uid) => this.propertyClassUids.has(uid))) continue;

      // Short name: displayName > localName > label local part. Empty or
      // whitespace-only values count as missing (issue #4568).
      const shortName =
        nonEmptyString(fm["exo__Property_displayName"]) ??
        nonEmptyString(fm["exo__Property_localName"]) ??
        labelLocalPart(label);

      this.setWithCollisionGuard(label, {
        shortName,
        className: this.resolveClassName(fm["exo__Property_domain"], label),
        file,
      });
    }

    this.indexBuilt = true;
  }

  /**
   * ClassName for `<ClassName>.<short name>` (issue #4568): the first resolvable
   * class of `exo__Property_domain` — its `exo__Class_localName`, else the part of
   * its label after `__`; a symbolic domain (`[[person__Person]]`) is read the
   * same way. No resolvable domain → the class segment of the property's own
   * label (`ems__Effort_status` → `Effort`); none → null.
   */
  private resolveClassName(domain: unknown, propertyLabel: string): string | null {
    const entries = Array.isArray(domain) ? domain : domain == null ? [] : [domain];
    for (const entry of entries) {
      const uid = unwrapWikilinkUid(entry);
      if (uid) {
        const names = this.assetNamesByUid.get(uid);
        if (!names) continue;
        const name =
          names.classLocalName ??
          (names.label ? classNameFromLabel(names.label) : null);
        if (name) return name;
        continue;
      }
      const symbolic = symbolicReference(entry);
      const name = symbolic ? classNameFromLabel(symbolic) : null;
      if (name) return name;
    }
    return labelClassSegment(propertyLabel);
  }

  private resolvePredicate(predicate: string): ResolvedPredicate | null {
    if (!this.indexBuilt) this.buildIndex();
    const cached = this.resolveCache.get(predicate);
    return cached ?? null;
  }

  private patchAllPropertiesBlocks(): void {
    if (!this.enabled) return;

    if (typeof this.app.workspace.getLeavesOfType === "function") {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      if (Array.isArray(leaves)) {
        for (const leaf of leaves) {
          const container = leaf.view.containerEl;
          this.patchPropertiesBlock(container);
        }
      }
    }
  }

  private patchPropertiesBlock(container: HTMLElement): void {
    const metadataContainer = container.querySelector<HTMLElement>(".metadata-container");
    if (!metadataContainer) return;
    this.patchBlock(metadataContainer);
  }

  /** Patch every key of one Properties block — the disambiguation context. */
  private patchBlock(metadataContainer: HTMLElement): void {
    const rows = metadataContainer.querySelectorAll<HTMLElement>(".metadata-property");
    this.patchRows(Array.from(rows));
  }

  /**
   * Decide the text of every key of one block together (issue #4568), then patch
   * the unpatched rows and re-text the already patched ones — a key added later
   * may turn an earlier unique short name into a collision, and a removed one
   * may undo it.
   */
  private patchRows(rows: HTMLElement[]): void {
    const entries: Array<{
      row: HTMLElement;
      predicate: string;
      resolved: ResolvedPredicate | null;
    }> = [];
    // One key per predicate: a block transiently holding two rows of the same
    // key (re-render) must not read that key as colliding with itself.
    const blockKeys = new Map<string, BlockKey>();

    for (const row of rows) {
      const record = this.recordsByEl.get(row);
      // A patched text-node key no longer holds the predicate in its text, so
      // the predicate of a patched row comes from its record.
      const predicate = record ? record.predicate : this.extractPredicate(row);
      if (!predicate) continue;
      // A patched row keeps the resolution it was patched with. Resolving it
      // again would rebuild the whole-vault index after EVERY metadataCache
      // change even when every key of the block is already patched — the
      // index is only invalidated there, and origin behaviour was to skip
      // patched rows before resolving (review of #4568, HIGH).
      const resolved = record ? record.resolved : this.resolvePredicate(predicate);
      entries.push({ row, predicate, resolved });
      blockKeys.set(predicate, {
        key: predicate,
        shortName: resolved ? resolved.shortName : null,
        className: resolved ? resolved.className : null,
      });
    }

    const texts = disambiguateBlockLabels(Array.from(blockKeys.values()));

    for (const { row, predicate, resolved } of entries) {
      if (!resolved) continue;
      const text = texts.get(predicate) ?? resolved.shortName;
      const record = this.recordsByEl.get(row);
      if (record) {
        this.retextRecord(record, text);
      } else {
        this.patchProperty(row, predicate, resolved, text);
      }
    }
  }

  private retextRecord(record: PatchRecord, text: string): void {
    if (record.displaySpan.textContent === text) return;
    record.displaySpan.textContent = text;
    record.displaySpan.setAttribute(
      "aria-label",
      `Open definition: ${text} (${record.predicate})`
    );
  }

  private patchProperty(
    propertyEl: HTMLElement,
    predicate: string,
    resolved: ResolvedPredicate,
    text: string
  ): void {
    if (propertyEl.getAttribute(PATCHED_ATTR) === "true") return;

    const keyEl = propertyEl.querySelector<HTMLElement>(".metadata-property-key");
    if (!keyEl) return;

    // CRITICAL: we MUST NOT mutate `input.value`. Obsidian's native Properties
    // block treats the input as the canonical frontmatter-key editor — writing
    // to `input.value` and then clicking on the field persists the new value as
    // a rename of the frontmatter key, which corrupts the asset. Instead we
    // keep the original input intact, hide it, and insert a sibling span that
    // displays the readable label and owns the click handler.
    const input = keyEl.querySelector<HTMLInputElement>("input");
    const displaySpan = keyEl.ownerDocument.createElement("span");
    displaySpan.className = `${DISPLAY_SPAN_CLASS} ${CLICKABLE_CLASS}`;
    displaySpan.textContent = text;
    displaySpan.setAttribute("role", "link");
    displaySpan.setAttribute("tabindex", "0");
    displaySpan.setAttribute(
      "aria-label",
      `Open definition: ${text} (${predicate})`
    );
    displaySpan.setAttribute("data-exo-predicate", predicate);

    let textNode: Text | null = null;
    let originalTextContent: string | null = null;

    if (input) {
      input.classList.add(HIDDEN_INPUT_CLASS);
      input.parentNode?.insertBefore(displaySpan, input);
    } else {
      textNode = this.findPredicateTextNode(keyEl, predicate);
      if (textNode) {
        originalTextContent = textNode.textContent ?? null;
        textNode.textContent = "";
        textNode.parentNode?.insertBefore(displaySpan, textNode.nextSibling);
      } else {
        // Nothing recognizable to replace — append the display span as a
        // best-effort fallback (the key DOM is non-standard), so the user
        // still sees the readable label and click target.
        keyEl.appendChild(displaySpan);
      }
    }

    const clickHandler = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      this.openDefinition(resolved.file, e);
    };
    // auxclick: middle-mouse-button (button === 1) opens in a new tab, matching
    // Obsidian's native internal-link behavior. Other auxclick buttons (e.g. 2
    // = right click) are ignored — they should fall through to native context
    // menu handling.
    const auxClickHandler = (e: MouseEvent): void => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      this.openDefinition(resolved.file, e);
    };
    displaySpan.addEventListener("click", clickHandler);
    displaySpan.addEventListener("auxclick", auxClickHandler);

    keyEl.classList.add(CLICKABLE_CLASS);
    propertyEl.setAttribute(PATCHED_ATTR, "true");
    const record: PatchRecord = {
      predicate,
      resolved,
      propertyEl,
      keyEl,
      input,
      displaySpan,
      textNode,
      originalTextContent,
      clickHandler,
      auxClickHandler,
    };
    this.patched.push(record);
    this.recordsByEl.set(propertyEl, record);
  }

  private extractPredicate(propertyEl: HTMLElement): string | null {
    // Obsidian's `data-property-key` attribute is lowercased (e.g. `exo__asset_uid`),
    // but the index is keyed on the original-case predicate from frontmatter
    // (e.g. `exo__Asset_uid`). The `<input>` inside `.metadata-property-key` holds
    // the original-case value, so always prefer it when present.
    const keyEl = propertyEl.querySelector<HTMLElement>(".metadata-property-key");
    if (keyEl) {
      const input = keyEl.querySelector<HTMLInputElement>("input");
      if (input?.value?.trim()) {
        return input.value.trim();
      }
      const text = (keyEl.textContent || "").trim().replace(/\u200B/g, "");
      if (text.length > 0) return text;
    }

    const attr = propertyEl.getAttribute("data-property-key");
    if (attr && attr.trim().length > 0) return attr.trim();

    return null;
  }

  private findPredicateTextNode(keyEl: HTMLElement, predicate: string): Text | null {
    const walker = document.createTreeWalker(keyEl, NodeFilter.SHOW_TEXT, null);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent || "").trim().replace(/\u200B/g, "");
      if (text === predicate) return node as Text;
      node = walker.nextNode();
    }
    return null;
  }

  private openDefinition(file: TFile, event?: MouseEvent): void {
    // Match Obsidian's native link behavior:
    //   plain click           → same tab (getLeaf(false) reuses current leaf)
    //   Cmd/Ctrl click        → new tab        ('tab')
    //   Cmd/Ctrl+Alt click    → split pane     ('split')
    //   Cmd/Ctrl+Alt+Shift    → new window     ('window')
    //   middle-mouse click    → new tab        (resolved via auxclick handler
    //                                           that delegates here with e.button=1)
    // `Keymap.isModEvent` returns the correct PaneType (or false) for the
    // platform-default modifier (Cmd on mac, Ctrl elsewhere).
    let leafArg: PaneType | boolean = false;
    if (event) {
      if (event.type === "auxclick" && event.button === 1) {
        leafArg = "tab";
      } else {
        leafArg = Keymap.isModEvent(event);
      }
    }
    const leaf = this.app.workspace.getLeaf(leafArg as PaneType | boolean);
    if (leaf && typeof (leaf as { openFile?: (f: TFile) => Promise<void> }).openFile === "function") {
      void (leaf as { openFile: (f: TFile) => Promise<void> }).openFile(file);
    }
  }

  private setupObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // nodeType, not `instanceof HTMLElement` / Obsidian's `instanceOf`:
          // the latter is absent from the jsdom suites that drive the plugin.
          const el = node as HTMLElement;

          if (el.classList?.contains("metadata-container")) {
            this.patchPropertiesBlock(el.parentElement || el);
          } else if (el.querySelector?.(".metadata-container")) {
            this.patchPropertiesBlock(el);
          } else if (el.classList?.contains("metadata-property")) {
            // A key added to a block re-decides the whole block: it may collide
            // with keys already patched (issue #4568).
            const block = el.closest<HTMLElement>(".metadata-container");
            if (block) this.patchBlock(block);
            else this.patchRows([el]);
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private restoreAll(): void {
    for (const record of this.patched) {
      try {
        record.displaySpan.removeEventListener("click", record.clickHandler);
        record.displaySpan.removeEventListener("auxclick", record.auxClickHandler);
        record.displaySpan.remove();

        if (record.input) {
          record.input.classList.remove(HIDDEN_INPUT_CLASS);
        } else if (record.textNode && record.originalTextContent !== null) {
          record.textNode.textContent = record.originalTextContent;
        }

        record.keyEl.classList.remove(CLICKABLE_CLASS);
        record.propertyEl.removeAttribute(PATCHED_ATTR);
      } catch {
        // Best-effort restore; ignore individual failures
      }
    }
    this.patched = [];
    this.recordsByEl = new WeakMap();
  }
}
