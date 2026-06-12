/**
 * ExoSync open-world / mounted-scope SHACL merge-gate (RFC 4e4dc453 A2 —
 * D17 engineering detail "Open-world / mounted-scope SHACL merge-gate").
 *
 * Validates a MERGED candidate asset before it is allowed to ship, reusing
 * the existing `ShaclLiteValidator` (explicit RFC constraint: no new
 * validator — mounted-scope is INPUT FILTERING plus violation
 * post-filtering, not new semantics):
 *
 *  - Intrinsic constraints on the merged asset (minCount, maxCount,
 *    datatype) always gate.
 *  - `sh:class` range checks gate ONLY for references whose target is part
 *    of the supplied mounted scope (a subject with type info in the
 *    candidate ∪ context triples, or `isMountedRef` when injected). A ref
 *    into an unmounted space is NOT a violation (open-world) — the RFC
 *    explicitly accepts that a dangling ref inside the mounted set is
 *    indistinguishable from an unmounted ref under the default config.
 *  - Violations whose focus node is NOT part of the candidate (pre-existing
 *    context issues) never gate a merge.
 *
 * A failed gate means the merged result must NOT ship — the caller routes
 * both versions to quarantine (D17).
 */

import type { Triple } from "../../infrastructure/sparql/algebra/AlgebraOperation";
import {
  extractUidFromIRI,
  validate,
  type ClassHierarchy,
  type ShapeRegistry,
  type Violation,
} from "../ShaclLiteValidator";

const RDF_TYPE_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Produces RDF triples for one markdown asset (production: NoteToRDFConverter adapter). */
export type TriplesForContentFn = (
  path: string,
  content: string,
) => Promise<Triple[]>;

export interface MergeShaclGateDeps {
  registry: ShapeRegistry;
  hierarchy: ClassHierarchy;
  triplesFor: TriplesForContentFn;
  /**
   * Triples of the MATERIALIZED scope (type-triples suffice): they give the
   * validator class info for refs to mounted assets, and they define the
   * default mounted-ref predicate. Empty ⇒ only intra-candidate refs are
   * checkable; everything else passes open-world.
   */
  contextTriples?: Triple[];
  /** Override the "is this ref inside the mounted scope" predicate. */
  isMountedRef?: (iri: string) => boolean;
}

export interface MergeGateVerdict {
  ok: boolean;
  /** Gating violations (candidate-focused, mounted-scope, sh:Violation). */
  violations: Violation[];
  /** sh:class violations skipped because the target ref is unmounted. */
  skippedOpenWorld: number;
}

/** Collect subject IRIs that carry type info (incl. uid-key fallback). */
function typedSubjects(triples: readonly Triple[], typePredicateIRI: string): Set<string> {
  const known = new Set<string>();
  for (const t of triples) {
    if (
      t.subject.type !== "iri" ||
      !("type" in t.predicate) ||
      t.predicate.type !== "iri" ||
      t.object.type !== "iri"
    ) {
      continue;
    }
    if (
      t.predicate.value !== typePredicateIRI &&
      t.predicate.value !== RDF_TYPE_IRI
    ) {
      continue;
    }
    known.add(t.subject.value);
    const uid = extractUidFromIRI(t.subject.value);
    if (uid) known.add(`uid:${uid}`);
  }
  return known;
}

export class MergeShaclGate {
  constructor(private readonly deps: MergeShaclGateDeps) {}

  /** Gate one merged candidate. `ok: false` ⇒ quarantine, never ship. */
  async checkMergedAsset(
    path: string,
    content: string,
  ): Promise<MergeGateVerdict> {
    const candidate = await this.deps.triplesFor(path, content);
    const context = this.deps.contextTriples ?? [];
    const all = [...candidate, ...context];

    const report = validate(all, this.deps.registry, this.deps.hierarchy);

    const focus = new Set<string>();
    for (const t of candidate) {
      if (t.subject.type === "iri") focus.add(t.subject.value);
    }

    const known = typedSubjects(all, this.deps.registry.typePredicateIRI);
    const isMounted =
      this.deps.isMountedRef ??
      ((iri: string): boolean => {
        if (known.has(iri)) return true;
        const uid = extractUidFromIRI(iri);
        return uid !== null && known.has(`uid:${uid}`);
      });

    const violations: Violation[] = [];
    let skippedOpenWorld = 0;
    for (const v of report.violations) {
      if (!focus.has(v.focusNode)) continue; // pre-existing context issue
      if (v.constraint === "class") {
        // Issue #3488: the shared validator now reports a class-range failure
        // against an *unresolvable* value (no type info in the store) as
        // `sh:Warning` instead of `sh:Violation`. ExoSync makes the open-world
        // decision itself via `isMounted`, so class-range results must reach
        // that decision regardless of the severity the validator chose:
        //   • ref OUTSIDE the mounted scope → open-world skip (never gates).
        //   • ref INSIDE the mounted scope (classless OR wrong-class) → gates
        //     the merge (a mounted target should be typed/conformant).
        if (v.actualValue !== undefined && !isMounted(v.actualValue)) {
          skippedOpenWorld++; // open-world: unmounted ref ≠ violation
          continue;
        }
        violations.push(v);
        continue;
      }
      if (v.severity !== "sh:Violation") continue; // non-class warnings don't gate
      violations.push(v);
    }

    return { ok: violations.length === 0, violations, skippedOpenWorld };
  }
}
