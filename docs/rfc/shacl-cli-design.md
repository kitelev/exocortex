# SHACL CLI Design Document

- **Issue:** [#2816](https://github.com/kitelev/exocortex/issues/2816)
- **RFC (vault):** `85ecddf2-b6a9-40be-9a4b-239a02c675b4` — RFC: SHACL validation в `@kitelev/exocortex-cli`
- **Parent RFC (vault):** `b8f662fb-542a-476a-8a40-ff3a3edfa007` — RFC: Specification-Based CI
- **Status:** **DEFERRED** (reflects RFC pivot 2026-04-16)
- **Created:** 2026-04-18

## TL;DR

- The underlying RFC (`85ecddf2`) is in status **DEFERRED**. The parent RFC (`b8f662fb`) resolved the SHACL-validation need via `shacl-engine` + thin adapter + contract-test (Alternative E). Until revival gates trigger, **no implementation work in `packages/cli/src/shacl/` should begin**.
- This document is a revival-ready specification: it records the locked scope, the API surface, the pre-work blockers, and the resolution of RFC open questions, so that implementation (issues #2817–#2831) can start without re-debate once revival gates trigger.
- The single largest pre-work blocker is the existing `TurtleParser`, which fails on 100% of representative SHACL shape files (see §5). Any revival must begin by either extending the parser or adopting an external parser.

## 1. Context

- The CLI package (`@kitelev/exocortex-cli`) is the primary RDF+SPARQL engine for CI pipelines in ontology-plugin repos (parent RFC Principle 6).
- The parent RFC originally proposed embedding a W3C SHACL Core validator inside the CLI to preserve the "one parser / one engine / one source of truth" principle.
- Critical review of the original plan (2026-04-16) identified blockers (F1–F5 in RFC `85ecddf2`): TurtleParser cannot parse SHACL shapes; drift is theoretical (no incident data); effort 5–7 weeks solo is misaligned with benefit; scope in original proposal (16 issues) vastly exceeds starter-kit's real needs (6 constraints).
- The parent RFC pivoted to Alternative E: `shacl-engine` (recommended: `rdf-validate-shacl` per parent RFC second-review) behind an `InMemoryTripleStore → DatasetCore` adapter, with a property-based contract test. Revival of SHACL-in-CLI is gated behind drift evidence.

## 2. Revival Gates

Implementation of this design **must not start** until all three gates pass.

| Gate | Condition | Source of truth |
|------|-----------|-----------------|
| G1 | ≥2 documented drift incidents between `shacl-engine` + adapter and the plugin | `/Users/kitelev/Developer/exocortex-drift-log.md` (append-only) |
| G2 | Maintainer bandwidth available to track W3C SHACL errata (Risk 5 in RFC `85ecddf2`) | Explicit maintainer decision in milestone #72 reopening |
| G3 | TurtleParser pre-work complete (see §5) | Linked parser-coverage issue CLOSED |

A drift incident is defined (OQ5 resolution, §8) as: `shacl-engine` adapter path reports `sh:conforms = true` while the plugin's runtime behavior breaks on the same asset (or vice versa), reproducible on a real vault fixture.

## 3. Locked MVP Scope — 6 Constraints

The MVP scope is cut from the original RFC's full W3C SHACL Core list down to **6 constraints**, matching documented starter-kit needs (`sh:minCount`, `sh:maxCount`, `sh:class`, `sh:datatype`, `sh:pattern`, `sh:in`).

| Constraint | W3C IRI | Included | Rationale |
|------------|---------|----------|-----------|
| `sh:minCount` | `sh:MinCountConstraintComponent` | ✅ IN | Required-property enforcement (e.g. `ems__Effort_status` required on every `ems__Task`) |
| `sh:maxCount` | `sh:MaxCountConstraintComponent` | ✅ IN | Functional-property enforcement (e.g. single `ems__Effort_status`) |
| `sh:class` | `sh:ClassConstraintComponent` | ✅ IN | Wikilink target-class correctness |
| `sh:datatype` | `sh:DatatypeConstraintComponent` | ✅ IN | Timestamp/integer well-formed literals |
| `sh:pattern` | `sh:PatternConstraintComponent` | ✅ IN | UUID regex validation on `exo__Asset_uid` |
| `sh:in` | `sh:InConstraintComponent` | ✅ IN | Enum-style status value restriction |
| `sh:nodeKind` | `sh:NodeKindConstraintComponent` | ❌ OUT (accepted gap) | Starter-kit has no IRI-vs-literal ambiguity that warrants this |
| `sh:minLength`, `sh:maxLength` | string | ❌ OUT | No documented starter-kit use case |
| `sh:minInclusive`, `sh:maxInclusive`, `sh:minExclusive`, `sh:maxExclusive` | value range | ❌ OUT | No documented starter-kit use case |
| `sh:languageIn`, `sh:uniqueLang` | string | ❌ OUT | Mono-lingual vault |
| `sh:hasValue` | values | ❌ OUT | Redundant with `sh:in` + cardinality |
| `sh:not`, `sh:and`, `sh:or`, `sh:xone` | logical | ❌ OUT | No combinatorial constraints in starter-kit |
| `sh:node`, `sh:property`, `sh:qualifiedValueShape` | shape-based | ❌ OUT | Flat validation only in MVP |
| `sh:equals`, `sh:disjoint`, `sh:lessThan`, `sh:lessThanOrEquals` | property-pair | ❌ OUT | No cross-property temporal logic in MVP |
| `sh:closed`, `sh:ignoredProperties` | closed shapes | ❌ OUT | Open-world assumption preserved |
| **SHACL-SPARQL** (`sh:sparql`) | advanced | ❌ OUT (strict) | Out of MVP per RFC; separate future RFC |
| **SHACL Rules / inference** (`sh:rule`) | advanced | ❌ OUT (strict) | Out of MVP per RFC; separate future RFC |
| **SHACL Advanced Features** | advanced | ❌ OUT (strict) | Out of MVP per RFC |

Accepted-gap rationale: starter-kit fixture survey (RFC `85ecddf2` section F5) showed that the 6 included constraints cover every currently documented validation need. Remaining 14 constraints can be added individually on demand behind the same architecture.

## 4. CLI API Surface

Subcommand: `exocortex-cli shacl validate`.

| Flag | Type | Default | Required | Description | Example |
|------|------|---------|----------|-------------|---------|
| `--shapes` | glob(s) | — | yes | One or more glob patterns for `.ttl` shape files | `--shapes 'shapes/*.ttl'` |
| `--data` | path | — | yes | Path to a data directory (recursively scanned) or a single `.md`/`.ttl` file | `--data vault/` |
| `--format` | enum | `text` | no | Output format: `text` (human), `json` (machine), `earl` (W3C test reporting) | `--format json` |
| `--severity` | enum | `violation` | no | Minimum severity to report: `violation`, `warning`, `info`. Filters output only; does not change exit code semantics | `--severity warning` |
| `--help` | flag | — | no | Show help and exit 0 | `--help` |

Exit codes:

| Exit | Meaning |
|------|---------|
| `0` | `sh:conforms = true` — no violations at or above the `--severity` threshold |
| `1` | `sh:conforms = false` — one or more violations present |
| `2` | Error — shapes parse failure, data not found, unknown flag, or internal failure |

Example invocation:

```bash
exocortex-cli shacl validate \
  --shapes 'shapes/*.ttl' \
  --data vault/ \
  --format json \
  --severity violation
```

## 5. TurtleParser Pre-work (Blocker for G3)

### 5.1 Current State

`packages/exocortex/src/infrastructure/rdf/parsers/TurtleParser.ts` (112 LoC) wraps `NTriplesParser` after a guard on lines 44–48 that throws on any statement containing `;` or `,`. It does not support:

- Predicate list shortcut (`subject pred1 obj1 ; pred2 obj2 .`)
- Object list shortcut (`subject pred obj1 , obj2 .`)
- Blank-node shortcut (`[ pred obj ]`)
- RDF list / collection syntax (`( a b c )`)

### 5.2 Audit Against 5 Representative SHACL Shape Files

Audit harness: `/tmp/shacl-audit/run-audit.mjs` (not committed), invoking `TurtleParser.parse()` on each fixture.

| Fixture | Construct exercised | TurtleParser result | First failing line |
|---------|---------------------|---------------------|--------------------|
| `01-node-shape.ttl` | `sh:NodeShape` + blank-node `sh:property` + predicate list | ❌ FAILED | line 5: `;` / `,` guard |
| `02-class-constraint.ttl` | `sh:class` via blank-node `sh:property` | ❌ FAILED | line 4: `;` / `,` guard |
| `03-pattern-in.ttl` | `sh:pattern` + `sh:in ( ... )` RDF list | ❌ FAILED | line 4: `;` / `,` guard |
| `04-cardinality.ttl` | `sh:minCount` / `sh:maxCount` with predicate list | ❌ FAILED | line 4: `;` / `,` guard |
| `05-datatype.ttl` | `sh:datatype xsd:dateTime` + xsd prefix | ❌ FAILED | line 5: `;` / `,` guard |

**Coverage result: 0 / 5 (0%).** Every representative SHACL shape exercises at least `;` or `,`, both of which are explicitly rejected. Any revival of SHACL-in-CLI must start by removing this limitation.

### 5.3 Two Resolution Paths

| Path | Description | Cost | Preserves "zero new dep" (RFC M4) |
|------|-------------|------|-----------------------------------|
| **P1 — Extend in-house parser** | Implement predicate/object list shortcuts, blank nodes, and RDF lists in `TurtleParser.ts` (or a new `TurtleParserFull.ts`). Cover with a parser-level test suite; ideally borrow W3C Turtle test cases | High (2–3 weeks solo) | ✅ Yes |
| **P2 — Adopt N3.js** | Replace `TurtleParser` with `n3` (npm) and map its output to our `Triple` model | Low (2–3 days) | ❌ No — breaks M4 |

Recommendation on revival: choose **P2** unless M4 is explicitly reaffirmed by the maintainer. `n3` is the de-facto Node Turtle parser, battle-tested across the RDF-JS ecosystem. P1 is only preferable if "zero runtime dependencies" remains a hard constraint.

### 5.4 Prior Art Warning

`packages/exocortex/dist/services/shacl/` exists as an orphan artifact without matching `src/` sources. It contained `ShaclValidator` that used `rdf-validate-shacl` with a fallback to the custom parser. The source was deleted; `dist/` was not cleaned. Implementers should treat this as historical noise, not as a reusable asset. A separate cleanup issue should be filed (see §9).

## 6. Internal Architecture

```
packages/cli/src/shacl/
├── ShapesParser.ts        # Turtle → Shape[]  (depends on §5 pre-work)
├── ShapesGraph.ts         # Shape registry + target resolution (sh:targetClass / sh:targetNode / sh:targetSubjectsOf / sh:targetObjectsOf)
├── Validator.ts           # Orchestrator: shapes × data graph → ValidationReport
├── constraints/
│   ├── cardinality.ts     # sh:minCount, sh:maxCount
│   ├── datatype.ts        # sh:datatype, sh:class
│   ├── string.ts          # sh:pattern
│   └── values.ts          # sh:in
└── ValidationReport.ts    # W3C-shaped report + serializers (text/JSON/EARL)
```

Module responsibilities:

- **ShapesParser** — parse `.ttl` shape files into the typed `Shape[]` array defined in §7. Requires full Turtle support (blank nodes, RDF lists).
- **ShapesGraph** — resolve each shape's target set against the data graph (via `InMemoryTripleStore.match()`).
- **Validator** — for each `(shape, targetNode)` pair, dispatch to the constraint modules in `constraints/`. Aggregate `ConstraintResult[]` into a single `ValidationReport`.
- **constraints/** — each file exports a pure function `(target, shape, store) => ConstraintResult[]`. One file per locked-scope category. No constraint-category sprawl.
- **ValidationReport** — canonical W3C-shaped report (`sh:conforms`, `sh:result[]`) with three serializers.

No adapter layer in this architecture — the validator reads through the existing `InMemoryTripleStore` API directly, identical to the SPARQL path. This is what preserves Principle 6 if/when this design is activated.

## 7. TypeScript Interfaces

```typescript
// Core shape types

export type Severity = "Violation" | "Warning" | "Info";

export interface Shape {
  id: string;                          // IRI or blank-node identifier
  targets: ShapeTarget[];              // at least one of sh:targetClass/targetNode/targetSubjectsOf/targetObjectsOf
  properties: PropertyShape[];
  severity?: Severity;                 // default "Violation"
}

export type ShapeTarget =
  | { kind: "targetClass"; classIri: string }
  | { kind: "targetNode"; nodeIri: string }
  | { kind: "targetSubjectsOf"; predicateIri: string }
  | { kind: "targetObjectsOf"; predicateIri: string };

export interface NodeShape extends Shape {}   // MVP: identical to Shape

export interface PropertyShape {
  path: string;                        // predicate IRI (MVP: simple paths only, no property path expressions)
  constraints: Constraint[];
  severity?: Severity;
  message?: string;                    // sh:message override
}

// Locked-scope constraints (union of 6)

export type Constraint =
  | { kind: "minCount"; value: number }
  | { kind: "maxCount"; value: number }
  | { kind: "class"; classIri: string }
  | { kind: "datatype"; datatypeIri: string }
  | { kind: "pattern"; regex: string; flags?: string }
  | { kind: "in"; values: RdfTerm[] };

export type RdfTerm =
  | { kind: "iri"; value: string }
  | { kind: "literal"; value: string; datatype?: string; language?: string }
  | { kind: "bnode"; id: string };

// Reporting

export interface ConstraintResult {
  focusNode: RdfTerm;
  resultPath?: string;
  value?: RdfTerm;
  severity: Severity;
  sourceConstraintComponent: string;   // e.g. "sh:MinCountConstraintComponent"
  message: string;
}

export interface ValidationReport {
  conforms: boolean;
  results: ConstraintResult[];
}

// Public entry point

export interface Validator {
  validate(shapes: Shape[], store: ITripleStore): ValidationReport;
}
```

These interfaces compile under `strict: true` and cover every locked-scope constraint without exposing union members for deferred categories.

## 8. Open RFC Questions — Resolution

| OQ | Question | Resolution |
|----|----------|------------|
| OQ1 | Use internal Store API or expose an RDF/JS `DatasetCore` façade? | **Decided — internal Store API.** The no-adapter architecture in §6 is the whole point of Principle 6; adding an RDF/JS façade duplicates the parent-RFC adapter path and defeats the revival rationale |
| OQ2 | Shapes discovery via `--shapes` flag or convention-based auto-discovery (`shapes/*.ttl`)? | **Decided — explicit `--shapes` flag.** Auto-discovery is invisible in CI logs and can silently miss files after refactors. Auto-discovery can be re-evaluated after real usage feedback |
| OQ3 | SHACL Advanced Features (`sh:rule`, inference) — part of this RFC or separate? | **Decided — separate future RFC.** Out of MVP, strict boundary |
| OQ4 | `--fix` mode for auto-repair of trivial violations? | **Deferred.** Re-evaluate after real usage accumulates. No design commitment |
| OQ5 | Definition of "drift incident" for revival trigger | **Decided — see §2.** `shacl-engine` `sh:conforms = true` while plugin runtime breaks on the same asset (or vice versa), reproducible on a real vault fixture |

## 9. Related Follow-up Work

The following issues should be filed or updated when this design is activated (not created by this PR):

1. **TurtleParser full Turtle support** (§5) — prerequisite for any shape parsing. Owner: parser module. Decide P1 vs P2 at revival time.
2. **`cli convert` subcommand** — referenced as B1 in parent RFC second-review. Not a blocker for this design (Validator reads through `InMemoryTripleStore` directly), but complementary.
3. **Cleanup orphan `packages/exocortex/dist/services/shacl/`** — delete stale compiled SHACL artifacts now that `src/` is gone.

## 10. Risk Register (Summary)

- **R1 — Scope creep beyond the 6 locked constraints.** Mitigation: §3 table is normative; any addition requires design-doc amendment PR, not ad-hoc code.
- **R2 — TurtleParser pre-work underestimated.** Mitigation: audit in §5 is already worst-case (0% pass) — implementers cannot be more optimistic than 0%.
- **R3 — W3C errata drift.** Mitigation: revival gate G2 explicitly requires maintainer bandwidth commitment.
- **R4 — Revival triggered without drift evidence.** Mitigation: gate G1 is a hard precondition; drift log is append-only.

## 11. Acceptance

This design is **accepted as a revival-ready specification**. It does not authorize any implementation work in `packages/cli/src/shacl/`. Implementation issues #2817–#2831 remain in backlog and reopen only after §2 gates pass.

On revival, downstream issues should link this document's section numbers (not paraphrase). Any divergence from §§3–7 requires an amendment PR to this file before implementation.
