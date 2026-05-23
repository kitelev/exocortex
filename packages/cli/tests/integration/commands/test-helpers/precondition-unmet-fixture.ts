/**
 * Precondition-unmet classifier + triple-store synthesiser (Phase 2 task
 * f68d0553, RFC v4 §7.1b follow-up).
 *
 * Given a starter-kit `exocmd__Precondition_sparqlAsk` body plus the
 * `$target` IRI the harness will substitute, this helper decides how to
 * materialise an "unmet" evaluation state and returns a ready-to-add
 * `Triple[]` set. The companion unit test at
 * `packages/cli/tests/unit/test-helpers/precondition-unmet-fixture.test.ts`
 * exercises every distinct SPARQL shape observed in the 23 active-command
 * preconditions in the starter-kit submodule.
 *
 * Shape taxonomy (empirical — classifier output is stable for the shapes
 * below; anything else falls through to `unknown` and the integration suite
 * downgrades to skip-with-reason):
 *
 *   1. **always-met**         `ASK { }`  — no unmet state exists.
 *   2. **exists-bgp**         `ASK { $target <P> ?v }` (maybe + FILTER) —
 *                             empty triple-store makes BGP fail to bind →
 *                             ASK=false → unmet.
 *   3. **exists-triple**      `ASK { $target <P> <O> }` (exact-match) —
 *                             empty store → ASK=false → unmet.
 *   4. **filter-not-exists**  `ASK { FILTER NOT EXISTS { $target <P> <O> } }`
 *                             empty store → NOT EXISTS holds → ASK=true
 *                             (MET). Synthesise `(target, P, O)` triple →
 *                             NOT EXISTS breaks → ASK=false → unmet.
 *   5. **mixed-bgp-filter-not-exists** — outer BGP `$target exo:Asset_uid ?u`
 *                             + nested FILTER NOT EXISTS. Empty store →
 *                             outer BGP fails → ASK=false → unmet. (Only
 *                             the "Missing label" precondition hits this
 *                             shape today.)
 *
 * For shapes (2), (3), (5) the classifier emits `kind: "empty-store"` —
 * callers just pass an empty `InMemoryTripleStore` to the evaluator.
 *
 * For shape (4) the classifier emits `kind: "add-triple"` + a
 * `materialiseTriples(targetIRI)` factory the caller invokes to obtain the
 * `Triple[]` to push into the store before invoking the evaluator.
 *
 * For shape (1) the classifier emits `kind: "always-met"` — the integration
 * suite reports the command as "no-unmet-state" and skips the assertion
 * without counting it toward coverage.
 *
 * Prefix expansion: follows the starter-kit convention (each precondition
 * declares its own `PREFIX ns: <iri>` line). The classifier parses the
 * prefixes out of the ASK body; callers never have to pre-strip them.
 */
import { Triple, IRI } from "exocortex";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnmetKind =
  | "always-met"
  | "empty-store"
  | "add-triple"
  | "unknown";

export interface UnmetClassification {
  readonly kind: UnmetKind;
  /** Short free-form reason (classifier note — for debug output / audits). */
  readonly reason: string;
  /**
   * Only set when `kind === "add-triple"`. Builds the triples that must be
   * added to an otherwise-empty store so the precondition evaluates to
   * `false` for the given `$target` substitution.
   */
  readonly materialiseTriples?: (targetIRI: string) => Triple[];
}

// ---------------------------------------------------------------------------
// Prefix + IRI parsing
// ---------------------------------------------------------------------------

const PREFIX_RE = /PREFIX\s+([A-Za-z][\w-]*):\s+<([^>]+)>/gi;
const ANGLE_IRI_RE = /^<([^>]+)>$/;

function parsePrefixes(ask: string): Map<string, string> {
  const map = new Map<string, string>();
  let m: RegExpExecArray | null;
  PREFIX_RE.lastIndex = 0;
  while ((m = PREFIX_RE.exec(ask)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Expand a token that is either `prefix:local` or `<absoluteIRI>` to the
 * full absolute IRI string. Returns undefined when the token is a variable
 * (`?v`, `$v`) or an unresolvable prefix.
 */
export function expandToken(
  token: string,
  prefixes: ReadonlyMap<string, string>,
): string | undefined {
  const trimmed = token.trim();
  const angle = trimmed.match(ANGLE_IRI_RE);
  if (angle) return angle[1];
  if (trimmed.startsWith("?") || trimmed.startsWith("$")) return undefined;
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return undefined;
  const ns = trimmed.slice(0, colonIdx);
  const local = trimmed.slice(colonIdx + 1);
  const base = prefixes.get(ns);
  if (!base) return undefined;
  return `${base}${local}`;
}

/**
 * Collapse whitespace for stable regex matching. We deliberately do NOT strip
 * `# …` comments: the starter-kit preconditions embed `#` inside absolute IRIs
 * (`<https://exocortex.my/ontology/ems#EffortStatusToDo>`), and a generic
 * `s/#.*$//g` removes the IRI suffix alongside the comment. The submodule does
 * not use SPARQL line-comments, so a commentless pass is sufficient.
 */
function normalise(ask: string): string {
  return ask.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Shape detection
// ---------------------------------------------------------------------------

/**
 * Extract the outer ASK body — everything between the ASK keyword's opening
 * `{` and its matching closing `}`. Delegates brace matching to a minimal
 * counter (SPARQL ASK bodies rarely nest deeper than FILTER NOT EXISTS).
 * Returns undefined when the ASK body cannot be located.
 */
function extractAskBody(body: string): string | undefined {
  const askIdx = body.search(/\bASK\b/i);
  if (askIdx < 0) return undefined;
  const openIdx = body.indexOf("{", askIdx);
  if (openIdx < 0) return undefined;
  let depth = 0;
  for (let i = openIdx; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(openIdx + 1, i).trim();
    }
  }
  return undefined;
}

/**
 * Decide how to construct an unmet-state triple store for a precondition
 * SPARQL ASK. Pure function over the ASK string — no IO, no evaluation.
 */
export function classifyPreconditionUnmet(
  sparqlAsk: string,
): UnmetClassification {
  const prefixes = parsePrefixes(sparqlAsk);
  const normalised = normalise(sparqlAsk);
  const askBody = extractAskBody(normalised);
  if (askBody === undefined) {
    return {
      kind: "unknown",
      reason: "ASK body not locatable",
    };
  }

  // Shape 1 — `ASK { }`.
  if (askBody === "") {
    return {
      kind: "always-met",
      reason: "ASK body is empty (always-visible precondition)",
    };
  }

  // Shape 4 — `ASK { FILTER NOT EXISTS { $target <P> <O> } }`.
  const filterOnly = askBody.match(
    /^FILTER\s+NOT\s+EXISTS\s*\{\s*(\$target)\s+(\S+)\s+(\S+)\s*\.?\s*\}\s*\.?\s*$/i,
  );
  if (filterOnly) {
    const predToken = filterOnly[2];
    const objToken = filterOnly[3];
    const predIRI = expandToken(predToken, prefixes);
    const objIRI = expandToken(objToken, prefixes);
    if (predIRI && objIRI) {
      return {
        kind: "add-triple",
        reason: `filter-not-exists shape; add ($target, ${predIRI}, ${objIRI})`,
        materialiseTriples: (targetIRI) => [
          new Triple(new IRI(targetIRI), new IRI(predIRI), new IRI(objIRI)),
        ],
      };
    }
    return {
      kind: "unknown",
      reason: `filter-not-exists shape but prefix expansion failed for "${predToken}" / "${objToken}"`,
    };
  }

  // Shape 2/3/5 — any BGP that binds `$target <P>` somewhere. Empty store
  // defeats every such ASK because `$target` never binds. We don't need to
  // distinguish the sub-shapes for the coverage assertion — they all share
  // the same empty-store mechanism.
  if (/\$target\s+/.test(askBody)) {
    return {
      kind: "empty-store",
      reason: "BGP binds $target; empty store → ASK=false",
    };
  }

  return {
    kind: "unknown",
    reason: "no recognised ASK shape (no $target BGP, no FILTER NOT EXISTS)",
  };
}
