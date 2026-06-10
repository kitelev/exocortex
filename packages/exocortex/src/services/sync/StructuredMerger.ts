/**
 * ExoSync StructuredMerger (RFC 4e4dc453 A2 — D1/D20/D21).
 *
 * Pure 3-way structured merge of ONE markdown asset (base/local/remote
 * contents, identity already matched by `exo__Asset_uid` upstream — D18):
 *
 *  - **Frontmatter** — per-key 3-way merge. Multi-valued keys (any side is
 *    an array: aliases / exo__Asset_relates / exo__Instance_class / …) merge
 *    as **set-union with base-tombstones (D20)**: an element present in base
 *    but removed on one side stays removed (never resurrected by the other
 *    side); elements added on either side survive. Scalar keys follow the
 *    classic 3-way rule; both-changed-differently is a CONFLICT.
 *  - **Body** — structured section merge (D21, explicitly NOT last-write-
 *    wins). Sections split at ATX headings (fence-aware); per-section 3-way;
 *    a section modified on both sides falls back to paragraph-level diff3;
 *    overlapping paragraph edits are a CONFLICT.
 *  - Any CONFLICT outcome is handed to quarantine by the caller (D17) —
 *    this module never guesses.
 *
 * YAML parsing is injected ({@link YamlCodec}) following the platform-port
 * precedent (`Sha1Fn`, `LocalFilesPort`): the core package has no YAML
 * dependency. IMPORTANT codec contract: date-like scalars MUST round-trip as
 * plain strings (js-yaml: pass `CORE_SCHEMA`; the default schema turns
 * `2026-06-09T15:46:48` into a `Date` and corrupts untouched keys on
 * re-serialization).
 */

export interface YamlCodec {
  /** Parse a YAML document. MUST throw on malformed input. */
  parse(yamlText: string): unknown;
  /** Serialize a mapping back to YAML (no `---` delimiters). */
  stringify(value: Record<string, unknown>): string;
}

export interface AssetMergeInput {
  /** Repo-relative path (diagnostics only). */
  path: string;
  uid?: string;
  /** Content at the 3-way base; `undefined` = did not exist in base. */
  base?: string;
  /** Local content; `undefined` = deleted locally. */
  local?: string;
  /** Remote content; `undefined` = deleted remotely. */
  remote?: string;
}

export type AssetMergeOutcome =
  | { status: "merged"; content: string; warnings: string[] }
  | { status: "conflict"; reason: string };

import { diff3 } from "./diff3";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const INSTANCE_CLASS_KEY = "exo__Instance_class";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    a === undefined ||
    b === undefined ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  return ka.every((k) => deepEqual(ra[k], rb[k]));
}

/** Stable identity for set-membership of YAML values. */
function setKey(v: unknown): string {
  return typeof v === "string" ? `s:${v}` : `j:${JSON.stringify(v)}`;
}

/** Multi-valued coercion: absent/null → ∅, scalar → singleton, array as-is. */
function toElements(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * D20 set-union with base-tombstones:
 * merged = (L ∩ R) ∪ (L − B) ∪ (R − B) — deleted-on-one-side stays deleted,
 * added-on-either-side survives. Order: local order first, then remote-only
 * additions in remote order. Duplicates collapse (set semantics).
 */
function mergeSet(baseV: unknown, localV: unknown, remoteV: unknown): unknown[] {
  const b = new Set(toElements(baseV).map(setKey));
  const local = toElements(localV);
  const remote = toElements(remoteV);
  const l = new Set(local.map(setKey));
  const r = new Set(remote.map(setKey));

  const keep = (k: string): boolean =>
    (l.has(k) && r.has(k)) || (l.has(k) && !b.has(k)) || (r.has(k) && !b.has(k));

  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of [...local, ...remote]) {
    const k = setKey(v);
    if (seen.has(k) || !keep(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

type FmMergeResult =
  | { ok: true; value: Record<string, unknown>; warnings: string[] }
  | { ok: false; reason: string };

/**
 * Per-key 3-way frontmatter merge (D1/D20). Output key order: base order
 * for surviving keys, then local additions, then remote additions.
 */
function mergeFrontmatter(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): FmMergeResult {
  const warnings: string[] = [];
  const orderedKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const k of [
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]) {
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      orderedKeys.push(k);
    }
  }

  const out: Record<string, unknown> = {};
  for (const key of orderedKeys) {
    const b = base[key];
    const l = local[key];
    const r = remote[key];

    if (Array.isArray(b) || Array.isArray(l) || Array.isArray(r)) {
      if (!(key in local) && !(key in remote)) continue; // deleted both sides
      const merged = mergeSet(b, l, r);
      const baseKeys = new Set(toElements(b).map(setKey));
      const addedLocal = toElements(l).some((v) => !baseKeys.has(setKey(v)));
      const addedRemote = toElements(r).some((v) => !baseKeys.has(setKey(v)));
      if (addedLocal && addedRemote && !deepEqual(toElements(l), toElements(r))) {
        warnings.push(
          `both sides added values to multi-valued key "${key}" — union kept (D20)`,
        );
      }
      if (merged.length > 0) out[key] = merged;
      continue;
    }

    // Scalar 3-way (absence — `undefined` — is a first-class state, so a
    // delete on one side + an edit on the other is a CONFLICT, not a guess).
    if (deepEqual(l, r)) {
      if (l !== undefined) out[key] = l;
      continue; // both deleted, or both changed identically
    }
    if (deepEqual(l, b)) {
      if (r !== undefined) out[key] = r;
      continue; // remote-only change (or remote delete)
    }
    if (deepEqual(r, b)) {
      if (l !== undefined) out[key] = l;
      continue; // local-only change (or local delete)
    }
    return {
      ok: false,
      reason: `frontmatter key "${key}" changed differently on both sides`,
    };
  }

  return { ok: true, value: out, warnings };
}

interface Section {
  /** Trimmed heading line, or "" for the preamble. */
  heading: string;
  /** Exact section text, heading line included (lines joined with \n). */
  text: string;
}

const FENCE_RE = /^(```|~~~)/;
const ATX_RE = /^#{1,6}\s/;

/**
 * Split a body into ATX-heading sections (preamble first, omitted when
 * empty). Fence-aware: a `# heading` line inside a ``` / ~~~ block does NOT
 * start a section (advisor HIGH catch — naive splitting recombines
 * half-fences). Setext headings are not boundaries (documented limitation).
 * Invariant: `sections.map(s => s.text).join("\n") === body`.
 */
export function splitSections(body: string): Section[] {
  const lines = body.split("\n");
  const sections: Section[] = [];
  let currentLines: string[] | null = null;
  let currentHeading = "";
  let inFence = false;

  const flush = (): void => {
    if (currentLines !== null) {
      sections.push({ heading: currentHeading, text: currentLines.join("\n") });
    }
  };

  for (const line of lines) {
    if (FENCE_RE.test(line.trimStart())) inFence = !inFence;
    if (!inFence && ATX_RE.test(line)) {
      flush();
      currentLines = [line];
      currentHeading = line.trim();
      continue;
    }
    if (currentLines === null) {
      currentLines = [];
      currentHeading = "";
    }
    currentLines.push(line);
  }
  flush();
  return sections;
}

/** Paragraph units of one section (blank-line separated; heading included). */
function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/);
}

function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

/**
 * Section keying for the 3-way alignment. Unique headings key by heading
 * text (stable under moves). Duplicate headings pair by occurrence index,
 * which is positionally stable ONLY when every version has the same count —
 * otherwise the merge must conflict (advisor HIGH catch: shifted indices
 * silently pair unrelated sections).
 */
type KeyedSections = Map<string, Section>;

function keySections(
  sections: Section[],
): { keyed: KeyedSections; order: string[] } {
  const counts = new Map<string, number>();
  const keyed: KeyedSections = new Map();
  const order: string[] = [];
  for (const s of sections) {
    const n = counts.get(s.heading) ?? 0;
    counts.set(s.heading, n + 1);
    const key = `${s.heading}\u0000${n}`;
    keyed.set(key, s);
    order.push(key);
  }
  return { keyed, order };
}

function headingCounts(sections: Section[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sections) {
    counts.set(s.heading, (counts.get(s.heading) ?? 0) + 1);
  }
  return counts;
}

type BodyMergeResult =
  | { ok: true; body: string; warnings: string[] }
  | { ok: false; reason: string };

/** Structured body merge (D21): sections → paragraphs → conflict. */
function mergeBody(base: string, local: string, remote: string): BodyMergeResult {
  if (local === remote) return { ok: true, body: local, warnings: [] };
  if (local === base) return { ok: true, body: remote, warnings: [] };
  if (remote === base) return { ok: true, body: local, warnings: [] };

  const warnings: string[] = [];
  const bSecs = splitSections(base);
  const lSecs = splitSections(local);
  const rSecs = splitSections(remote);

  // Duplicate-heading stability guard: any heading duplicated in some
  // version must have the SAME count in all three, or occurrence-index
  // pairing would align unrelated sections.
  const bCounts = headingCounts(bSecs);
  const lCounts = headingCounts(lSecs);
  const rCounts = headingCounts(rSecs);
  const allHeadings = new Set([
    ...bCounts.keys(),
    ...lCounts.keys(),
    ...rCounts.keys(),
  ]);
  for (const h of allHeadings) {
    const counts = [bCounts.get(h) ?? 0, lCounts.get(h) ?? 0, rCounts.get(h) ?? 0];
    if (Math.max(...counts) > 1 && new Set(counts).size > 1) {
      return {
        ok: false,
        reason: `duplicate heading "${h || "(preamble)"}" count differs across versions — occurrence pairing unstable`,
      };
    }
  }

  const b = keySections(bSecs);
  const l = keySections(lSecs);
  const r = keySections(rSecs);

  // Per-key 3-way membership + content.
  const mergedByKey = new Map<string, string>();
  const allKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const k of [...b.order, ...l.order, ...r.order]) {
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      allKeys.push(k);
    }
  }

  for (const key of allKeys) {
    const heading = key.slice(0, key.lastIndexOf("\u0000"));
    const bt = b.keyed.get(key)?.text;
    const lt = l.keyed.get(key)?.text;
    const rt = r.keyed.get(key)?.text;

    if (lt === rt) {
      if (lt !== undefined) mergedByKey.set(key, lt);
      continue; // identical (or deleted on both sides)
    }
    if (lt === bt) {
      if (rt !== undefined) mergedByKey.set(key, rt);
      continue; // remote-only change / delete
    }
    if (rt === bt) {
      if (lt !== undefined) mergedByKey.set(key, lt);
      continue; // local-only change / delete
    }
    // Both sides changed the section differently.
    if (lt === undefined || rt === undefined) {
      return {
        ok: false,
        reason: `section "${heading || "(preamble)"}": deleted on one side, modified on the other`,
      };
    }
    if (bt === undefined) {
      return {
        ok: false,
        reason: `section "${heading || "(preamble)"}": added differently on both sides`,
      };
    }
    const para = diff3(
      splitParagraphs(bt),
      splitParagraphs(lt),
      splitParagraphs(rt),
    );
    if (para.ok) {
      mergedByKey.set(key, joinParagraphs(para.merged));
      continue;
    }
    // Paragraph units can be too coarse (a whole fenced code block is one
    // paragraph; adjacent paragraphs edited on opposite sides share one
    // unstable region) — fall back to line-level diff3, exactly git's
    // granularity. Same-line divergence still conflicts.
    const line = diff3(bt.split("\n"), lt.split("\n"), rt.split("\n"));
    if (!line.ok) {
      return {
        ok: false,
        reason: `section "${heading || "(preamble)"}": overlapping paragraph edits`,
      };
    }
    mergedByKey.set(key, line.merged.join("\n"));
  }

  // Order: prefer the side that re-ordered (3-way on the key sequences);
  // divergent re-orders keep local order + remote-only additions appended
  // (order divergence is non-destructive — warn, don't conflict).
  const surviving = (order: string[]): string[] =>
    order.filter((k) => mergedByKey.has(k));
  const bOrder = surviving(b.order);
  const lOrder = surviving(l.order);
  const rOrder = surviving(r.order);
  const sameSeq = (x: string[], y: string[]): boolean =>
    x.length === y.length && x.every((v, i) => v === y[i]);

  const sharedLB = lOrder.filter((k) => bOrder.includes(k));
  const sharedRB = rOrder.filter((k) => bOrder.includes(k));
  const baseSharedL = bOrder.filter((k) => lOrder.includes(k));
  const baseSharedR = bOrder.filter((k) => rOrder.includes(k));

  let skeleton: string[];
  if (sameSeq(sharedLB, baseSharedL)) {
    skeleton = rOrder; // local kept base order → remote's order wins
  } else if (sameSeq(sharedRB, baseSharedR)) {
    skeleton = lOrder; // remote kept base order → local's order wins
  } else {
    skeleton = lOrder;
    warnings.push(
      "section order diverged on both sides — local order kept, remote additions appended",
    );
  }

  const orderedKeys: string[] = [];
  const emitted = new Set<string>();
  for (const k of skeleton) {
    if (mergedByKey.has(k) && !emitted.has(k)) {
      emitted.add(k);
      orderedKeys.push(k);
    }
  }
  for (const k of [...lOrder, ...rOrder]) {
    if (mergedByKey.has(k) && !emitted.has(k)) {
      emitted.add(k);
      orderedKeys.push(k);
    }
  }

  const body = orderedKeys
    .map((k) => mergedByKey.get(k) as string)
    .join("\n");
  return { ok: true, body, warnings };
}

export class StructuredMerger {
  constructor(private readonly codec: YamlCodec) {}

  /** 3-way merge one asset. CONFLICT outcomes go to quarantine (D17). */
  mergeAsset(input: AssetMergeInput): AssetMergeOutcome {
    const { path, base, local, remote } = input;

    // File-level existence matrix. Convergent cases are normally consumed
    // upstream (SyncEngine), but stay correct here for direct callers.
    if (local === undefined && remote === undefined) {
      return { status: "conflict", reason: `${path}: gone on both sides — nothing to merge` };
    }
    if (local === undefined || remote === undefined) {
      return {
        status: "conflict",
        reason: `${path}: ${local === undefined ? "deleted locally, modified remotely" : "modified locally, deleted remotely"} (delete-vs-modify)`,
      };
    }
    if (local === remote) {
      return { status: "merged", content: local, warnings: [] };
    }
    if (base !== undefined && local === base) {
      return { status: "merged", content: remote, warnings: [] };
    }
    if (base !== undefined && remote === base) {
      return { status: "merged", content: local, warnings: [] };
    }

    const baseDoc = this.splitDoc(base ?? "");
    const localDoc = this.splitDoc(local);
    const remoteDoc = this.splitDoc(remote);
    if (baseDoc === null || localDoc === null || remoteDoc === null) {
      return {
        status: "conflict",
        reason: `${path}: unparseable frontmatter on ${baseDoc === null ? "base" : localDoc === null ? "local" : "remote"} side`,
      };
    }

    const fm = mergeFrontmatter(
      baseDoc.frontmatter,
      localDoc.frontmatter,
      remoteDoc.frontmatter,
    );
    if (!fm.ok) {
      return { status: "conflict", reason: `${path}: ${fm.reason}` };
    }

    // Cross-tombstone type-loss guard (advisor catch): both sides kept SOME
    // class but their tombstones cancel to none → neither side intended a
    // typeless asset. (One side intentionally emptying the key is allowed.)
    const baseClasses = toElements(baseDoc.frontmatter[INSTANCE_CLASS_KEY]);
    const localClasses = toElements(localDoc.frontmatter[INSTANCE_CLASS_KEY]);
    const remoteClasses = toElements(remoteDoc.frontmatter[INSTANCE_CLASS_KEY]);
    const mergedClasses = toElements(fm.value[INSTANCE_CLASS_KEY]);
    if (
      baseClasses.length > 0 &&
      localClasses.length > 0 &&
      remoteClasses.length > 0 &&
      mergedClasses.length === 0
    ) {
      return {
        status: "conflict",
        reason: `${path}: cross-tombstones removed all ${INSTANCE_CLASS_KEY} values — typeless merge refused`,
      };
    }

    const body = mergeBody(baseDoc.body, localDoc.body, remoteDoc.body);
    if (!body.ok) {
      return { status: "conflict", reason: `${path}: ${body.reason}` };
    }

    const warnings = [...fm.warnings, ...body.warnings];

    // Verbatim shortcut: when the merge semantically equals one side, return
    // that side's exact text — avoids re-serialization noise (quoting,
    // comments) on the untouched side.
    if (
      deepEqual(fm.value, localDoc.frontmatter) &&
      body.body === localDoc.body
    ) {
      return { status: "merged", content: local, warnings };
    }
    if (
      deepEqual(fm.value, remoteDoc.frontmatter) &&
      body.body === remoteDoc.body
    ) {
      return { status: "merged", content: remote, warnings };
    }

    let yaml: string;
    try {
      yaml = this.codec.stringify(fm.value);
    } catch (err) {
      return {
        status: "conflict",
        reason: `${path}: merged frontmatter failed to serialize (${err instanceof Error ? err.message : String(err)})`,
      };
    }
    if (!yaml.endsWith("\n")) yaml += "\n";
    const content = `---\n${yaml}---\n${body.body}`;
    return { status: "merged", content, warnings };
  }

  /** Frontmatter/body split; `null` = malformed YAML (conflict upstream). */
  private splitDoc(
    content: string,
  ): { frontmatter: Record<string, unknown>; body: string } | null {
    const m = FM_RE.exec(content);
    if (!m) return { frontmatter: {}, body: content };
    const body = content.slice(m[0].length);
    try {
      const parsed = this.codec.parse(m[1]);
      if (parsed === null || parsed === undefined) {
        return { frontmatter: {}, body };
      }
      if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return { frontmatter: parsed as Record<string, unknown>, body };
    } catch {
      return null;
    }
  }
}
