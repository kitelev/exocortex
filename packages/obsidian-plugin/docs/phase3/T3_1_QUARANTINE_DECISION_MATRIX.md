# T3.1 — Quarantine Decision Matrix per Spec

**Task:** `f87f229e-aec2-4b5c-bd86-48a206ed0886`
**Phase:** RFC Phase 3.3 — Quarantine activation (analysis-only deliverable; no code change in this commit)
**Generated:** 2026-05-01 (Asia/Almaty)
**RFC:** `32a64ed9-9a74-4e0c-bb26-e455605aa384`
**Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619`
**Predecessors:**
- T0.2 — `artifacts/flaky-baseline/T0_2_TOP_OFFENDERS.md` (per-shard + per-spec rerun rate)
- T0.3 — `docs/PHASE3_GAP_ANALYSIS.md` (Categories G/H/I/J/K validation)
- T2.1/T2.3 — `retry(1)` per-spec landed for 7 plaintive specs (commits `688d9163`, `6ead0baa`, MERGED v15.138.0)

---

## §1 Decision buckets

Per RFC §3.3 + brief, every flaky spec is assigned exactly one of four decisions:

| Bucket | Action | Trigger | Tracking |
|---|---|---|---|
| **stabilize** | Keep enabled, rely on existing `retry(1)` + Phase 3.1 cold-start helpers | Retry-sufficient: low-incidence + no actionable root cause yet | Phase 3.4 dashboard rerun-rate trend |
| **fix** | Keep enabled, schedule root-cause work (deterministic clock / setup race fix) | Recurrent (≥2 incidents) AND root cause hypothesised in T0.2/T0.3 | GitHub issue with investigation owner + 30-day expiry |
| **quarantine** | `test.fixme()` + tracking issue + 30-day expiry per Charter Risk 4 | Cannot stabilize within one sprint AND retry insufficient | GitHub issue + auto-revert if stale |
| **track** | Keep enabled, no further action; relies on Phase 3.4 dashboard to disambiguate | Single incident — flake-vs-regression unresolvable at N=41 | Re-evaluate at N≥100 or when incident #2 lands |

**Notes:**
- "stabilize" and "fix" both keep the spec **enabled**; the difference is whether a follow-up engineering ticket is required.
- "quarantine" is the only bucket that disables the spec.
- "delete" is offered by the brief as a fifth option ("obsolete spec"); after audit none of the candidates qualify.

---

## §2 Candidate population

T0.2 §2 enumerated 9 unique failing specs across the post-cutover N=41 cohort (8 failed runs × 11 spec incidents):

| Rank | Spec | Incidents | Shard(s) | Has `retry(1)` post-T2.1? |
|---:|---|---:|:---:|:---:|
| 1 | `featured-binding-promotion.spec.ts` | 2 | 4 | ✅ |
| 2 | `daily-note-tasks.spec.ts` | 2 | 6 | ✅ |
| 3 | `dynamic-command-buttons-render.spec.ts` | 1 | 3 | ✅ |
| 4 | `starter-kit-smoke.spec.ts` | 1 | 4 | ✅ |
| 5 | `table-column-alignment.spec.ts` | 1 | 6 | ✅ |
| 6 | `alias-sync-on-label-change.spec.ts` | 1 | 3 | ❌ |
| 7 | `daily-archive-filter.spec.ts` | 1 | 2 | ❌ |
| 8 | `effort-timestamps-auto-sync.spec.ts` | 1 | 2 | ✅ |
| 9 | `file-explorer-icons.spec.ts` | 1 | 5 | ❌ |
| — | `daily-navigation.spec.ts` | 0* | — | ✅ |

\* Added by T2.1 as a pre-emptive Cat-G plaintive spec (no incident in N=41 but historically plaintive — rationale in commit `688d9163`).

---

## §3 Decision matrix

Each row records: bucket assignment, rationale (1-2 sentences citing T0.2/T0.3 evidence), and the follow-up action if any.

| # | Spec | Cat (T0.3) | Bucket | Rationale | Follow-up |
|--:|---|:---:|:---:|---|---|
| 1 | `featured-binding-promotion.spec.ts` | H | **fix** | Recurrent (2 / 41), net-new from RFC-024 T6.4 (PR #2971). T0.2 §2 finding: 30.6s timeout suggests setup race against `featuredBinding` layout render — actionable root cause. `retry(1)` reduces noise but does not fix the race. | Open issue: "Audit `featured-binding-promotion` setup race — add `await waitFor` on layout render"; assign T0.2 §4 priority #2; 30-day expiry. |
| 2 | `daily-note-tasks.spec.ts` | I (time-dep) | **fix** | Recurrent (2 / 41). T0.2 §2 finding: "current day" predicate is time-dependent — tests crossing UTC midnight are inherently flaky. Deterministic clock via `page.clock.install()` fully resolves; `retry(1)` only papers over. | Open issue: "Pin `daily-note-tasks` to deterministic clock (`page.clock.install()` or fixture)"; T0.2 §4 priority #1; 30-day expiry. |
| 3 | `dynamic-command-buttons-render.spec.ts` | Maintenance timeout | **stabilize** | Single incident (1 / 41). Already covered by `retry(1)` (T2.1). Maintenance-header timeout signature suggests Cat-G environmental — fits the "retry-sufficient" profile. | Re-evaluate at N≥100; escalate to **fix** if incident #2 lands. |
| 4 | `starter-kit-smoke.spec.ts` | Cat G | **stabilize** | Single incident (1 / 41) on shard 4 (top-failing shard). Already covered by `retry(1)`. Async `service_call` step is the likely Cat-G surface. | Re-evaluate at N≥100. |
| 5 | `table-column-alignment.spec.ts` | Cat G (#594) | **stabilize** | Single incident (1 / 41) on shard 6 (top-failing shard). Already covered by `retry(1)`. Layout-alignment assertion is timing-sensitive under load. | Re-evaluate at N≥100. |
| 6 | `alias-sync-on-label-change.spec.ts` | unclear | **track** | Single incident (1 / 41). No `retry(1)` yet (not in T2.1 set). Insufficient evidence to discriminate flake vs regression. Adding retry pre-emptively risks masking a real bug per Charter Risk 1. | None — rely on Phase 3.4 dashboard; revisit at incident #2. |
| 7 | `daily-archive-filter.spec.ts` | unclear | **track** | Single incident (1 / 41). No `retry(1)`. Toggle-button-click pattern resembles Cat-G but N=1 cannot confirm. | None — rely on Phase 3.4 dashboard; revisit at incident #2. |
| 8 | `effort-timestamps-auto-sync.spec.ts` | J (Phase 2.1 plaintive) | **stabilize** | Single incident (1 / 41) but T0.3 §4 J flags this as the canonical Phase 2.1 helper edge case. Already covered by `retry(1)` (T2.1). T0.3 §4 verdict downgrades J to "subsumed by G" — fixing G fixes J; no separate action needed. | Re-evaluate at N≥100; expectation: incidence drops as Phase 3.1 Xvfb work tightens warmup. |
| 9 | `file-explorer-icons.spec.ts` | Phase 4 smoke | **track** | Single incident (1 / 41). No `retry(1)`. Recently-shipped FileExplorerIconPatch — could be either a flake or a real Phase-4 regression. Phase 3.4 dashboard is the right disambiguator. | None — rely on Phase 3.4 dashboard; if incident #2 lands within 30 days, escalate to **fix** with FileExplorerIconPatch owner. |
| 10 | `daily-navigation.spec.ts` | G | **stabilize** | Zero incidents in N=41 but added pre-emptively by T2.1 as a historically Cat-G plaintive spec. `retry(1)` already covers. | Re-evaluate at N≥100; if zero incidents persist, consider removing `retry(1)` per Risk 1 (avoid masking). |

---

## §4 Aggregate decision counts

| Bucket | N | Specs |
|---|---:|---|
| stabilize | 5 | `dynamic-command-buttons-render`, `starter-kit-smoke`, `table-column-alignment`, `effort-timestamps-auto-sync`, `daily-navigation` |
| fix | 2 | `featured-binding-promotion`, `daily-note-tasks` |
| quarantine | 0 | — |
| track | 3 | `alias-sync-on-label-change`, `daily-archive-filter`, `file-explorer-icons` |
| delete | 0 | — |
| **Total** | **10** | |

---

## §5 Why zero quarantines

The RFC §3.3 plan estimated "3-5 specs go quarantine". The empirical Phase 3.0 evidence (T0.2 + T0.3) re-shapes this estimate to **0 quarantines** for these reasons:

1. **K finding from T0.3 §4** — the dominant Phase 3 problem is **measurement (`totalFlaky=0` reporter no-op)**, not regression coverage erosion. Quarantining specs before measurement is fixed risks hiding the very signal Phase 3.4 needs to drive future decisions.
2. **G dominance** — T0.3 §6.1 ranks Cat G (Xvfb runner contention) as dominant. Quarantine does not address G; it merely silences its symptoms. The right fix for G is Phase 3.1 Xvfb profiling + the existing `retry(1)` safety net, not removal of test cases.
3. **Charter Risk 4** — every quarantine erodes regression coverage. With only **2 specs** showing recurrence (rank 1-2) and **both having actionable root causes**, the cost-benefit favours **fix** over **quarantine**.
4. **Sample size** — T0.3 §3.1 notes the post-cutover N=41 has wide Wilson CIs ([19%, 47%]). At this N, single-incident specs cannot be distinguished from one-off regressions. Quarantining them would be statistical noise-driven, not evidence-driven.

The matrix therefore commits to **fix** for the two recurrent specs (rank 1-2) and **track** for the three single-incident specs without retry coverage. **stabilize** absorbs the remaining five, all of which already carry `retry(1)` and have low-frequency profiles consistent with the residual Cat-G flake floor.

If at N≥100 the dashboard shows that a "track" spec accumulates ≥2 further incidents without a discoverable root cause, it escalates to **quarantine** at that point — RFC §3.3 stays a live framework, not a one-shot decision.

---

## §6 Downstream actions (NOT executed in this task — analysis only)

Per Charter §4 Phase 3.3 DoD this deliverable is analysis-only. The implied follow-up tickets are:

1. **Issue: stabilize `featured-binding-promotion.spec.ts` setup race** (T0.2 §4 #2; bucket=fix; owner: TBD; 30-day expiry).
2. **Issue: pin `daily-note-tasks.spec.ts` to deterministic clock** (T0.2 §4 #1; bucket=fix; owner: TBD; 30-day expiry).
3. **`tests/quarantine.ts`**: leave `QUARANTINED_TESTS = []` empty for now — no quarantines from this matrix. Re-evaluate after Phase 3.4 dashboard produces non-zero `totalFlaky` data (post-T2.x) at N≥100.
4. **Phase 3.4 dashboard re-render** — already a known follow-up per T0.3 §6.2 new risk; add `track`-bucket specs to its watchlist.

These actions are explicitly **out of scope** for T3.1 (Phase 3.3 analysis). They will be filed by the orchestrator or follow-on tasks.

---

## §7 Reproducibility

The matrix above is fully derivable from:

- T0.2: `packages/obsidian-plugin/artifacts/flaky-baseline/T0_2_TOP_OFFENDERS.md` (commit `9531fded`)
- T0.3: `packages/obsidian-plugin/docs/PHASE3_GAP_ANALYSIS.md`
- T2.1 retry coverage: commit `688d9163` (Author: Claude Task 02c9c7f8) — `tests/e2e/specs/*.spec.ts` `test.describe.configure({ retries: 1 })` declarations
- RFC: `32a64ed9-9a74-4e0c-bb26-e455605aa384` §3.3 decision rubric
- Charter: `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619` §4 Risk 4 (regression-coverage erosion guard)

To re-derive at higher N (post-T2.x, N≥100): re-run T0.2 reproducibility steps (`gh run view --log-failed`-based incidence count), then re-apply §1 bucket triggers per spec. Single-incident → `track`; ≥2 incidents + actionable hypothesis → `fix`; ≥2 incidents + no hypothesis + retry insufficient → `quarantine`.
