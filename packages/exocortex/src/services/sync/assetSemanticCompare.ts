/**
 * Semantic (triple-set-proxy) equality of two markdown assets at the SAME
 * repo path (ExoSync E1 parity harness, RFC 4e4dc453 — M2).
 *
 * Why a proxy and not the real converter: RDF triple emission is
 * context-dependent on the WHOLE vault (wikilink resolution via
 * basename/alias indices), so a per-file `TriplesForContentFn` over remote
 * content is ill-defined without materializing the full remote tree —
 * hundreds of blob GETs per repo (the same reason the merge-gate's
 * NoteToRDFConverter composition is deferred since Phase B). The proxy
 * invariant instead: for two contents at the SAME path (same subject IRI,
 * same resolution context), canonically-equal frontmatter + equal body ⇒
 * equal emitted triple sets (the converter is deterministic). A literal
 * triple-set deep-compare over two materialized trees exists as the
 * `parity-gate` CI suite (`cli-plugin-triple-parity.integration.test.ts`)
 * and is the designated deep mechanism for Phase E2.
 *
 * Canonicalisation (asymmetries the structured merger / different YAML
 * emitters legitimately introduce):
 *  - object keys compare order-insensitively;
 *  - arrays compare as MULTISETS (RDF multi-valued properties are sets —
 *    D20 set-union merge semantics; element order is emitter-dependent);
 *  - scalars compare exactly as parsed by the injected codec (CORE_SCHEMA
 *    in production — date-like scalars round-trip as strings).
 *
 * KNOWN RESIDUAL (accepted, advisor C): codec equality is not byte-for-byte
 * Obsidian-metadataCache equality (`0123` vs `123`, `yes`/`no` booleans) —
 * a theoretical false-"format-only" on exotic scalars. Format-only drift is
 * therefore ALWAYS a counted, logged category — never silently dropped.
 */

import type { YamlCodec } from "./StructuredMerger";

export interface SemanticComparison {
  /** Both sides have canonically-equal frontmatter (or both have none). */
  frontmatterEqual: boolean;
  /** Bodies equal after newline normalisation + trailing-whitespace trim. */
  bodyEqual: boolean;
}

/** Frontmatter equal AND body equal — pure formatting drift (M2-clean). */
export function isFormatOnlyDrift(c: SemanticComparison): boolean {
  return c.frontmatterEqual && c.bodyEqual;
}

// Close delimiter anchored to line end — a frontmatter line merely STARTING
// with `---` (e.g. `----` scalar) must not end the block early (same shape
// as ChangeDetector.extractAssetUid).
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/;

function splitDoc(content: string): { fm: string | null; body: string } {
  const m = FM_RE.exec(content);
  if (!m) return { fm: null, body: content };
  return { fm: m[1], body: content.slice(m[0].length) };
}

/**
 * Canonical JSON form: sorted object keys, arrays as sorted multisets of
 * their elements' canonical serialisations. Deterministic and commutative —
 * exactly the equivalence the parity proxy needs, nothing finer.
 */
function canonicalise(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).sort().join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function normaliseBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

/**
 * Compare two markdown contents of the SAME asset path. Parse failures on
 * either frontmatter degrade to "not equal" (loud category downstream) —
 * the comparator never throws on user content.
 */
export function compareAssetSemantics(
  a: string,
  b: string,
  yaml: YamlCodec,
): SemanticComparison {
  const da = splitDoc(a);
  const db = splitDoc(b);

  let frontmatterEqual: boolean;
  if (da.fm === null && db.fm === null) {
    frontmatterEqual = true;
  } else if (da.fm === null || db.fm === null) {
    frontmatterEqual = false;
  } else {
    try {
      frontmatterEqual =
        canonicalise(yaml.parse(da.fm)) === canonicalise(yaml.parse(db.fm));
    } catch {
      // Unparseable YAML on either side — cannot prove semantic equality.
      frontmatterEqual = false;
    }
  }

  return {
    frontmatterEqual,
    bodyEqual: normaliseBody(da.body) === normaliseBody(db.body),
  };
}
