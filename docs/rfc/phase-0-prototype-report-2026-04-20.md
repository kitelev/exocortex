# Phase-0 Prototype Report — RFC-CI-Tests

**Project:** CI Test Coverage for Starter-Kit Dynamic Commands (RFC v2/v3)
**Parent project UUID:** `9b4f1f59-d771-4c1b-b8e4-feb06984c06c`
**Synthesis task UUID:** `69871588-e240-49a4-bf68-38a82963c431`
**Source RFC:** `/Users/kitelev/Developer/rfc-ci-button-testing-2026-04-20.md` (v3 at input, v4 after this task)
**Date:** 2026-04-20
**Author:** Claude (child session `claude-child-69871588`)

---

## Executive Summary

Phase 0 of RFC-CI-Tests ran four prototype gates (0a strategy ladder, 0b mutation predictor, 0c wall-time benchmark, 0d coverage-delta pilot) to de-risk Phase 1 before the full 44-Command integration suite is written. **All four gates now PASS** after one Phase-1-entry migration (Option C, shipped as [`exocortex-starter-kit#81`](https://github.com/kitelev/exocortex-starter-kit/pull/81)).

| Gate | Criterion | Measurement | Verdict | Evidence |
|------|-----------|-------------|:-------:|----------|
| 0a — ladder | S5 fallback ≤ 30% | 22.73% (post-migration) | ✅ PASS | §1 + `phase0-extract-target-class-ladder-2026-04-20.md` + `phase1-post-migration-ladder-2026-04-20.md` |
| 0b — predictor | ≤ 5 per-command branches | 3 / 5 | ✅ PASS (2 headroom) | §2 + `phase0-predict-mutation-prototype-2026-04-20.md` |
| 0c — wall-time | suite ≤ 180 000 ms on GHA | 613 ms projected | ✅ PASS (99.66% headroom) | §3 + `phase0-benchmark-wall-time-2026-04-20.md` + PR #2884 |
| 0d — coverage | ≤ 1 pp drop per metric | +0.04 pp branches, 0 others | ✅ PASS (tautological) | §4 + `phase0-coverage-delta-2026-04-20.md` |

**Overall verdict: PROCEED to Phase 1.** No re-scope required. One scope expansion captured: RFC §12 PR-readiness gate now codifies the Phase-1 helper-coverage commitment (§4 findings made this an enforcement-level concern, not just aspiration — see §7).

**Side outcomes of Phase 0 (not part of gate evaluation but material for Phase 1 planning):**

- **Authoritative Command count: 44**, not 51 as RFC v1/v2 repeated. SPARQL count via `?cmd exo:Instance_class exocmd:Command`. Reconciled in RFC v3 §4.0 + new §4.0a.
- **Option C migration applied** (8 creation commands tagged with `exocmd__Command_targetClass`) — PR #81 merged, post-merge Validate + Auto Release green.
- **Coverage matrix:** P-mutation coverage 26→34 of 44 Commands (59.1% → 77.3%) after migration.
- **Orthogonal bug surfaced:** [kitelev/exocortex#2883](https://github.com/kitelev/exocortex/issues/2883) — CLI `dyncommand exec` derives `targetIRI` as vault-relative path instead of `obsidian://vault/...` IRI. Non-blocking for Phase 1 (in-process harness bypasses it), but blocks subprocess-based integration. §6.

**Technical debt acknowledged (§6):** #2883 normalization, `updateProperty` CLI service stub (~50 LOC to wire), Create Area host-binding anomaly. None blocks Phase 1 entry.

---

## §1 — Strategy Classification (Gate 0a)

**Prototype task:** `7804d300-4290-4551-8818-2c7e2c75ac81` — Done 2026-04-20.
**Report:** `/Users/kitelev/Developer/phase0-extract-target-class-ladder-2026-04-20.md`
**Companion:** `/Users/kitelev/Developer/phase1-post-migration-ladder-2026-04-20.md`

The `extractTargetClassFromCommand(cmd)` ladder resolves each Command's host class via a five-strategy cascade (RFC §7.1a). Phase 0 gate: Strategy-5 (fallback) ratio must be ≤ 30% over the full 44-Command dataset.

### 1.1 Pre-migration baseline (2026-04-20, starter-kit commit `eda3b8c`)

| Strategy | Count | Percentage | Interpretation |
|----------|------:|-----------:|----------------|
| S1 — explicit `Command_targetClass` | 0 | 0.0% | Not populated on any Command |
| S2 — precondition `$target` triple | 19 | 43.2% | Status/criticality/maintenance preconditions |
| S3 — grounding `targetProperty` domain | 5 | 11.4% | `Set Planned Start`, `Set Scheduled Date`, etc. |
| S4 — class-flip from `Grounding_targetValue` | 2 | 4.5% | `Convert to Task`, `Convert to Project` |
| S5 — fallback `ems__Task` | **18** | **40.9%** | Creation (8) + `service_call` (9) + host-function (1) |
| Total | 44 | 100.0% | |

Dataset discrepancy: RFC v1/v2 stated **51 Commands**; SPARQL-authoritative count is **44**. The 7-item gap is ontology assets that reference the Command class UUID but are not Command instances themselves (property / class stubs). Reconciled in RFC v3 §4.0 + §4.0a.

**Pre-migration gate: FAIL — S5 = 40.9%, re-scope required.**

### 1.2 Re-scope decision — Option C (hybrid, user-approved)

Three options were surfaced in the Phase 0 report:

- **Option A — full migration.** Tag all 18 fallbacks with `exocmd__Command_targetClass`. Maximum fidelity, but forces `service_call` commands (genuinely polymorphic) into a single host class.
- **Option B — accept S5 residue.** Narrow "P-mutation coverage" claim to 26/44 (59.1%). Honest but concedes 41% dispatch-only.
- **Option C — hybrid (chosen).** Migrate 8 creation commands only (natural primary host is known from binding); keep 9 `service_call` + 1 host-function as S5 dispatch-only (RDF does not express their semantic host).

Option C was the classifier-author recommendation and the user's selection. Rationale: creation commands benefit most from explicit metadata (users expect e.g. "Create Child Task" enabled on Projects, not Areas); `service_call` commands are genuinely polymorphic and S5-dispatch-only is an honest contract.

### 1.3 Post-migration (Phase-1 entry task `1894db7c`)

| Strategy | Pre | Post | Δ |
|----------|----:|-----:|--:|
| S1 | 0 (0.0%) | **8 (18.2%)** | +8 |
| S2 | 19 (43.2%) | 19 (43.2%) | 0 |
| S3 | 5 (11.4%) | 5 (11.4%) | 0 |
| S4 | 2 (4.5%) | 2 (4.5%) | 0 |
| S5 | 18 (40.9%) | **10 (22.7%)** | −8 |

**Post-migration gate: PASS — S5 = 22.73% ≤ 30%.** Headroom = 7.27 pp; coverage-matrix improvement (S1+S2+S3+S4 = P-mutation candidates) 26 → 34 (77.3%).

Migration artifact: [`kitelev/exocortex-starter-kit#81`](https://github.com/kitelev/exocortex-starter-kit/pull/81), commits `91d9e37` (new `exocmd__Command_targetClass` ObjectProperty stub, UID `4fee233c-7d02-4973-8936-b01835b4b829`) + `94a7dc9` (wire the property on 8 creation Commands). 9 files changed, 28 insertions.

### 1.4 S5 residue (honest dispatch-only)

10 commands remain in S5 after Option C — structurally impossible to ladder-resolve from RDF:

- **9 `service_call` commands** (host class encoded in TypeScript service, not RDF): `Clean Properties`, `Copy Label to Aliases`, `Plan for Evening`, `Plan on Today`, `Repair Folder`, `Rollback Status`, `Shift Day Backward`, `Shift Day Forward`, `Vote on Effort`.
- **1 host-function precondition** (opaque to SPARQL): `Rename to UID` (uses `exocmd:Precondition_hostFunction: hasNonUidFilename`).

Phase 1 harness treats these as P-dispatch-only: assert `Result.success` + message shape, skip frontmatter-diff assertion.

---

## §2 — Composite Mutation Predictor (Gate 0b)

**Prototype task:** `0f77f5a4-9c60-45f5-a217-764bda03cdc3` — Done 2026-04-20.
**Report:** `/Users/kitelev/Developer/phase0-predict-mutation-prototype-2026-04-20.md`
**Runnable prototype:** `/tmp/phase0-predictor-test/predictor.mjs` (3/3 self-tests pass)

The `predictMutationForGrounding(cmd, userInput, targetIRI)` function mirrors `GroundingExecutor.ts` to derive the expected frontmatter-diff for a Command + input. Phase 0 gate: ≤ 5 per-command special-case branches required to green the 2 target composites (Set Status Doing, Convert to Task).

### 2.1 Architecture

- Structural type dispatch on `grounding.type` (`property_set` / `property_delete` / `composite` / `service_call` / `create_instance`) — **NOT** counted toward the gate (mirrors the 4-row RFC §7.1 grounding-shape table).
- `substituteVariables` copied verbatim from `GroundingExecutor.ts:527-549` (placeholders `$target`, `$nowLocal`, `$now`, `$today`, `$input`, `$value`).
- `extractClassFromTargetValue` copied verbatim from `GroundingExecutor.ts:30-37` — handles the Literal-vs-IRI edge case for class-flip.
- Per-command branches live only inside `predictServiceCall` — three short-circuits that mirror `GroundingExecutor.ts:344` / `:370` / `:373`:
  1. `serviceId === "convertToTask"` → class-flip to `ems__Task`.
  2. `serviceId === "updateProperty" && cls === "ems__Task"` → class-flip via composite.
  3. `serviceId === "updateProperty" && cls === "ems__Project"` → class-flip via composite.

### 2.2 Validation

Self-test (`node /tmp/phase0-predictor-test/predictor.mjs`):

```
✅ 1. Set Status Doing (composite): PASS
✅ 2. Convert to Task (class-flip, IRI shape): PASS
✅ 3. Convert to Task (class-flip, Literal shape): PASS
Summary: 3/3 passing
Per-command branches: 3 / 5 — gate PASS (2 branches of headroom).
```

Cross-verification against existing `GroundingExecutor.test.ts` — the predictor's substitution layer shares source with the executor, so existing executor tests certify predictor substitution semantics.

**Gate verdict: PASS (3 / 5 branches, 2 headroom).**

### 2.3 Shape detail (critical for Phase 1 test matchers)

The class-flip writes `exo__Instance_class` as a **JSON-array-as-literal-string** — `'["[[ems__Task]]"]'` — not a parsed array. Phase 1 matchers must assert string equality on raw frontmatter, not YAML-deep-equals. Memory: `reference_class_flip_frontmatter_json_array_string`.

### 2.4 Orthogonal bug surfaced (not blocking Phase 0)

Attempted end-to-end validation via `dyncommand exec` against in-vault fixtures failed with `preconditionPassed: false`. Root cause: CLI derives `targetIRI` from vault-relative path (`dynamic-command.ts:289`) but the triple store indexes subjects as `obsidian://vault/<encodeURI(path)>`. Filed as [`kitelev/exocortex#2883`](https://github.com/kitelev/exocortex/issues/2883). Phase 1 harness bypasses via direct `PreconditionEvaluator.evaluate(…, fullIRI)` call (jest-amortized benchmark harness already does this — §3).

---

## §3 — Wall-time Benchmark (Gate 0c)

**Prototype task:** `dd3bdaaa-c873-4763-9e55-4471124bd663` — Done 2026-04-20.
**Report:** `/Users/kitelev/Developer/phase0-benchmark-wall-time-2026-04-20.md`
**Authoritative PR:** [`kitelev/exocortex#2884`](https://github.com/kitelev/exocortex/pull/2884) (merged, released as v15.113.1).
**GHA run:** [`24663123355`](https://github.com/kitelev/exocortex/actions/runs/24663123355)

Phase 0 gate: projected 132-scenario Phase 1 suite on GHA `ubuntu-latest` must stay under the 180 000 ms (3 min) `test-unit` budget (RFC v3 §9).

### 3.1 Methodology

Two independent measurements on GHA (Node 22, linux-x64):

- **Jest-amortized (primary, gate input):** one `beforeAll` builds the triple store (amortized 222.95 ms), then 15 parametrized `it` scenarios (5 commands × 3 scenarios) run `CommandResolver.loadCommand` + `PreconditionEvaluator.evaluate` + `GroundingExecutor.execute` bracketed by `performance.now()`. Matches the exact shape RFC §7.1 prescribes for Phase 1.
- **Subprocess (reference only):** `node dist/index.js dyncommand exec --dry-run` per invocation. Establishes end-user CLI cost for future decisions; not gate input.

### 3.2 Measurements

| Metric | Jest-amortized | Subprocess |
|--------|---------------:|-----------:|
| Avg per scenario / invocation | **2.96 ms** | 313 ms |
| `buildTripleStore` one-shot | 222.95 ms | (rebuilt every invocation) |
| 132-scenario projection | **613 ms** | 41 316 ms |
| Gate threshold (RFC v3 §9) | 180 000 ms | (not gated) |
| Headroom | **99.66%** | — |

Composite groundings (Set Status Doing, Set Status Done) dominate the in-process cost (~5–7 ms avg) because they perform multiple frontmatter writes + `$nowLocal` substitution. The 67× ratio between jest-amortized and subprocess (613 ms vs 41 s) quantifies the value of RFC §7.1's in-process choice.

### 3.3 Sensitivity analysis

| Per-scenario cost multiplier | Projected suite | Verdict |
|-----------------------------:|----------------:|:-------:|
| 1× (measured) | 613 ms | PASS (99.7% headroom) |
| 10× (full frontmatter diffs) | 4.1 s | PASS (97.7% headroom) |
| 100× (pathological) | 39.3 s | PASS (78.2% headroom) |
| 454× | ≈ 180 s | boundary |

**Gate verdict: PASS — 613 ms projected, 99.66% headroom.** Even under a 100× pessimistic cost, the suite finishes in 40 s.

### 3.4 Phase-1 operational impact

- `buildTripleStore` dominates jest-amortized cost (~223 ms vs ~3 ms per scenario). Phase 1 MUST do it once per test file (`beforeAll`), not per-scenario — otherwise the 132-scenario suite would take ~29 s instead of ~613 ms. This matches RFC §7.1 `describe.each` shape exactly.
- `createRelatedTask` path and `updateProperty` CLI stub (≈ 52% of starter-kit groundings) will turn the suite red on ~23 commands until wired. Phase 1 prep task: wire `updateProperty` in `CliServiceRegistryPopulator` (≤ 50 LOC).
- Permanent CI telemetry: `.github/workflows/benchmark-phase0.yml` runs on PR path changes to harness files + `workflow_dispatch`. Artifacts retained 30 days.

---

## §4 — Coverage-Delta Pilot (Gate 0d)

**Prototype task:** `c91f0395-23ec-4996-bc21-1d1a71a76300` — Done 2026-04-20.
**Report:** `/Users/kitelev/Developer/phase0-coverage-delta-2026-04-20.md`

Phase 0 gate: ≤ 1 pp drop in any of {statements, branches, functions, lines} on `packages/cli/` module coverage between pre-pilot (`942c057d`) and post-pilot (`6cdafb7d`) commits on main.

### 4.1 Measurements

| Metric | Pre (`942c057d`) | Post (`6cdafb7d`) | Δ | Gate (≤ 1 pp drop) |
|--------|------:|-------:|---:|:------------------:|
| statements | 71.32% | 71.32% | **0.00 pp** | ✅ PASS |
| branches | 61.50% | 61.54% | **+0.04 pp** | ✅ PASS |
| functions | 83.70% | 83.70% | **0.00 pp** | ✅ PASS |
| lines | 71.66% | 71.66% | **0.00 pp** | ✅ PASS |

### 4.2 Verdict is tautological (acknowledged)

PR #2884 is test-only: the diff adds `packages/cli/tests/integration/phase0-benchmark/benchmark.test.ts` (459 LOC) + a workflow YAML + a shell script. None of these match `collectCoverageFrom` (`src/**/*.ts`). Therefore `statements.total` / `branches.total` / `functions.total` / `lines.total` are byte-identical pre and post. The +0.04 pp branches delta reflects the benchmark exercising one additional conditional path.

**The tautology is informative, not a failure.** It empirically proves the Phase 0 commitment of §9.1: "test-only additive pattern is threshold-neutral." Phase 1 will not be test-only — it ships helpers.

### 4.3 Phase-1 projection — the motivating risk (direct input to §7)

Phase 1 adds ≈ 600–800 LOC of test helpers per RFC §9.1 (`command-catalog.ts`, `fixture-factory.ts`, `predict-mutation.ts`, `user-input-factory.ts`, `extract-target-class.ts`). Current `statements.covered` = 3261 / `statements.total` = 4572 = 71.32%. If 800 LOC of helper `statements.total` ships **without** corresponding `statements.covered`:

```
new_statements_pct = 3261 / (4572 + 728) ≈ 61.52%
```

That is **3.5 pp below the 65% CI threshold**, below the floor hard-enforced in `ci.yml` `test-coverage` job. The §9.1 "helpers have own unit tests" commitment is therefore **not self-enforcing** — it must become a PR-gate or the Phase 1 PR will fail its own coverage check.

**This projection is the direct motivation for the RFC §12 PR-readiness gate item** added in this task's RFC v4 edit (§7 of this report + RFC §12). The causation chain is: Phase 0 pilot ⇒ tautological gate PASS ⇒ Phase 1 helper-coverage projection −3.5 pp ⇒ §12 enforcement.

---

## §5 — Phase-1 Entry Migration Postmortem (`1894db7c`)

**Task:** `1894db7c-fc0f-414c-96c3-63598bb1f2fb` — Done 2026-04-20 (Review-promoted).
**Plan:** `/Users/kitelev/Developer/option-c-migration-plan-2026-04-20.md`
**Re-run ladder:** `/Users/kitelev/Developer/phase1-post-migration-ladder-2026-04-20.md`

### 5.1 Deliverables shipped

1. **RFC v3** — reconciled "51 Commands" drift → "44 Commands" across §4.0, §4.0a, §7.1a, §7.4.3, §8, §9, §13.
2. **PR [`starter-kit#81`](https://github.com/kitelev/exocortex-starter-kit/pull/81)** — merged; 2 commits (`91d9e37` + `94a7dc9`); 9 files changed, 28 insertions.
3. **Post-merge validation:** Validate workflow + Auto Release both green; starter-kit point-release cut automatically.

### 5.2 Coverage-matrix outcome

| Measure | Pre-migration | Post-migration |
|---------|--------------:|---------------:|
| S1-S4 commands (P-mutation candidates) | 26 / 44 (59.1%) | **34 / 44 (77.3%)** |
| S5 dispatch-only commands | 18 / 44 (40.9%) | **10 / 44 (22.7%)** |
| Phase 0 §7.1a gate | FAIL | **PASS** |

### 5.3 Cross-repo decision — single-source convention

The 8 creation commands are tagged with the primary host binding (derived from `CommandBinding_targetClass`). Secondary host bindings continue to route via separate `CommandBinding` files — no grounding regression. Property `exocmd__Command_targetClass` is single-valued by symmetry with `exocmd__Command_grounding`.

### 5.4 Known anomaly (non-blocking)

`Create Area` currently binds to `ems__Task` (the only `CommandBinding` in starter-kit). Semantically Areas are top-level containers; this is likely a starter-kit oversight. Phase 1 ladder honors current binding for fidelity. Future cleanup PR may re-bind; that change must co-migrate `Command_targetClass`. Not blocking.

---

## §6 — Open Technical Debt

Enumerated to steer Phase 1 prep; none blocks Phase 0 → Phase 1 transition.

| # | Item | Severity | Phase 1 impact | Owner |
|--:|------|:--------:|----------------|-------|
| 1 | [`kitelev/exocortex#2883`](https://github.com/kitelev/exocortex/issues/2883) — CLI `dyncommand exec` derives `targetIRI` as vault-relative path; triple-store indexes `obsidian://vault/<encodeURI(path)>` | P1 | Positive-precondition CLI commands silently return `precondition_failed`. Phase 1 jest harness bypasses via direct IRI construction. Subprocess path and end-user CLI inherit the bug. | Phase 1 prep |
| 2 | `updateProperty` CLI service stub | P2 | ≈ 52% of starter-kit groundings use `service_call updateProperty`. Currently throws `CliServiceNotImplementedError`. Phase 1 suite will go red on ~23 commands until wired (≤ 50 LOC; plugin service already exists for reuse). | Phase 1 prep |
| 3 | `Create Area` host-binding anomaly | P3 | `Create Area` binds to `ems__Task` instead of `ems__Area` / root. Ladder honors current binding. Cleanup deferred to post-Phase-1 starter-kit PR. | Future |

All three items already recorded in memory (`reference_orchestrator_pattern_2026_04_20`, `feedback_cli_service_call_silent_success`, `feedback_dynamic_command_targetiri_path_not_obsidian_iri`).

---

## §7 — Recommendation

**Proceed to Phase 1.**

All four Phase 0 gates pass after the Option C migration (§1 + §5). The 0d coverage-delta pilot surfaced a non-blocking but structurally important Phase-1 risk (§4.3): helper code without self-coverage projects −3.5 pp statements, below the CI floor. This has been addressed in RFC v4 by adding a PR-readiness gate item at §12 (user-approved text, verbatim):

> "All helpers under `tests/integration/**/test-helpers/` MUST have own unit tests in `tests/unit/**/test-helpers/`. Phase 0 pilot publishes coverage delta table; > 1pp drop = gate FAIL → add helper tests or reduce helper LOC before Phase 1 PR."

This escalates the §9.1 aspirational commitment to PR-level enforcement. The §9.1 path convention (`packages/cli/tests/integration/starter-kit/` and `packages/cli/tests/unit/services/test-helpers/`) uses a different naming than the user-approved `tests/integration/**/test-helpers/`; Phase 1 implementation should reconcile this (either move helpers under a `test-helpers/` subdir or treat both forms as equivalent). Flagged in RFC v4 §13 entry for Phase-1 resolution.

### 7.1 Phase-1 entry checklist (for downstream tasks)

- ✅ Ladder gate PASS (22.73% S5)
- ✅ Predictor gate PASS (3 / 5 branches)
- ✅ Wall-time gate PASS (613 ms projected)
- ✅ Coverage-delta gate PASS (+0.04 pp branches, 0 elsewhere)
- ✅ Option C migration merged (starter-kit #81)
- ✅ Permanent benchmark workflow shipped (`benchmark-phase0.yml`, PR #2884)
- ✅ RFC §12 PR-readiness gate published (this task, v4)
- ☐ Phase 1 prep (out of scope): wire `updateProperty` CLI service + fix #2883 targetIRI normalization

Phase 1 (build CLI test harness against 34 migrated Commands + 10 dispatch-only) is unblocked.

---

## Appendix — Artifact Index

| Artifact | Path / URL |
|----------|------------|
| This synthesis doc | `/Users/kitelev/Developer/Phase-0-prototype-report.md` |
| RFC v3→v4 source | `/Users/kitelev/Developer/rfc-ci-button-testing-2026-04-20.md` |
| Phase 0 — ladder (0a) | `/Users/kitelev/Developer/phase0-extract-target-class-ladder-2026-04-20.md` |
| Phase 0 — predictor (0b) | `/Users/kitelev/Developer/phase0-predict-mutation-prototype-2026-04-20.md` |
| Phase 0 — benchmark (0c) | `/Users/kitelev/Developer/phase0-benchmark-wall-time-2026-04-20.md` |
| Phase 0 — coverage (0d) | `/Users/kitelev/Developer/phase0-coverage-delta-2026-04-20.md` |
| Phase 1 — Option C plan | `/Users/kitelev/Developer/option-c-migration-plan-2026-04-20.md` |
| Phase 1 — post-migration ladder | `/Users/kitelev/Developer/phase1-post-migration-ladder-2026-04-20.md` |
| Benchmark harness PR | [`kitelev/exocortex#2884`](https://github.com/kitelev/exocortex/pull/2884) (merged, v15.113.1) |
| Migration PR | [`kitelev/exocortex-starter-kit#81`](https://github.com/kitelev/exocortex-starter-kit/pull/81) (merged) |
| Predictor prototype | `/tmp/phase0-predictor-test/predictor.mjs` |
| Runnable benchmark workflow | `.github/workflows/benchmark-phase0.yml` (exocortex main) |
