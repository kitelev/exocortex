# PHASE3_GAP_ANALYSIS.md — RFC Phase 3 (Flaky E2E Residual Stabilization) Gap Analysis

**RFC:** `32a64ed9-9a74-4e0c-bb26-e455605aa384`
**Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619`
**Task:** T0.3 (`9505b844-59e9-4308-973b-0a0b51fad86f`)
**Generated:** 2026-05-01 (Asia/Almaty)
**Predecessors:** T0.1 (commit `dde4aa0d` — dual-cohort backfill), T0.2 (commit `9531fded` — per-shard + per-spec rerun rate)
**Status:** Phase 3.0 final analysis deliverable — drives re-ordering of Phase 3.x downstream tasks.

---

## §1 Context

The CI Path 2 D0 cutover landed on **2026-04-22** (13 required checks, see `../../CLAUDE.md`), with the broader Phase 2.2 fixture-drift detector activating **2026-04-25**. RFC Phase 3 (this RFC) was scoped to investigate whether the residual flake rate observed post-cutover is a stable steady state or a regression that the original CI Speedup project missed.

T0.1 collected the **dual-cohort dataset**:

| Cohort | Window | N runs | Source |
|---|---|---:|---|
| Pre-cutover baseline | 2026-04-01 → 2026-04-21 | 200 | historical workflow runs (gh API) |
| Post-cutover residual | 2026-04-25 → 2026-04-30 | 41 | post-Phase 2.2 main-branch runs |

T0.2 added **per-shard / per-spec / cache-correlation** decomposition over the post-cutover cohort, and surfaced one critical structural limitation that re-orders the rest of Phase 3 (see §4 Category K and §5).

This document validates the five Categories G/H/I/J/K originally hypothesised in RFC §Проблема against the empirical data, identifies the dominant categories, and recommends a re-ordering of the Phase 3.x execution plan.

---

## §2 Methodology

### §2.1 Dual-cohort design

The Charter's **Risk 5** ("statistical N=200 baseline takes weeks to accumulate") was **partially realised** during Phase 3.0 execution — the post-cutover cohort accumulated only **N=41** runs in the window the team allotted to Phase 3.0 (1 day per Charter §4 Phase 3.0 budget). Mitigation per Risk 5 was to backfill the **pre-cutover** cohort (N=200) from already-existing artifacts so a **comparison** is possible even without N=200 post-cutover.

This means **failure-rate deltas between cohorts** are statistically interpretable, but **absolute post-cutover failure-rate confidence intervals** are wide. Specifically the post-cutover 31.71% has 95% Wilson CI ≈ [19%, 47%]; the pre-cutover 12.5% has CI ≈ [8.4%, 17.9%]. The two intervals do not overlap → the **degradation signal is real**, but the magnitude (2.5× point estimate) carries ±0.7× uncertainty.

### §2.2 Signals available vs missing

| Signal | Available? | Source | Notes |
|---|---|---|---|
| Per-job conclusion (success/failure) | ✅ | `gh run view --json jobs` | Authoritative per-job |
| Per-spec first-attempt failure | ✅ | `gh run view --log-failed` ✘ grep | Misses retry-pass-on-second |
| **Per-spec retry-pass rate** | ❌ | (would need `flaky-reporter.json`) | **`totalFlaky=0/41` — reporter no-op** |
| E2E job duration (cache proxy) | ✅ | `startedAt`/`completedAt` deltas | Conflates cache cold + runner contention |
| Direct cache-hit rate | ❌ | (would need BUILDX_CACHE_FROM_HIT instrumentation) | T1.2 dependency |
| X11 / Xvfb error counts | ⚠️ partial | log scraping | Already addressed Phase 3.5 (PR #2978) |

The **`totalFlaky=0/41`** observation is the load-bearing finding of T0.2 §1 and §2 caveat — it means the entire Phase 3 measurement programme cannot quantify retry-pass-rate **until** Phase 3.2 lands `retries: 1` to make the reporter non-trivial. See §5.

---

## §3 Quantitative findings

### §3.1 Aggregate failure rate

| Cohort | N runs | Failed runs | Failure rate | 95% Wilson CI |
|---|---:|---:|---:|---|
| Pre-cutover (2026-04-01 → 04-21) | 200 | 25 | **12.5%** | [8.4%, 17.9%] |
| Post-cutover (2026-04-25 → 04-30) | 41 | 13 | **31.71%** | [19.0%, 47.4%] |

**Delta: +19.2 percentage points (≈ 2.54× multiplicative).** Wilson CIs are disjoint → degradation is statistically real at α=0.05; magnitude estimate is precise to within roughly ±20% of itself.

### §3.2 Per-shard failure rate (post-cutover, T0.2 §1)

```
e2e-shard (1) ┃                                      0.00%
e2e-shard (2) ┃███                                    2.44%
e2e-shard (3) ┃██████                                 4.88%
e2e-shard (4) ┃█████████                              7.32%  ← TIED #1
e2e-shard (5) ┃███                                    2.44%
e2e-shard (6) ┃█████████                              7.32%  ← TIED #1
e2e-tests (▼) ┃████████████████████████              19.51%  (umbrella, fans-in)
test-unit     ┃████████████                           9.76%  (regression cluster, see §3.4)
```

**Top offenders: shards (4) and (6) carry 6 of 8 e2e failures (75%).** Shard (1) is a control — never failed in 41 runs.

### §3.3 Per-spec failure incidence (post-cutover, T0.2 §2)

| Rank | Count | Spec | Shard | Hypothesis |
|---:|---:|---|:---:|---|
| 1 | 2 | `featured-binding-promotion.spec.ts` | 4 | net-new spec from RFC-024 T6.4 (PR #2971); race on layout render |
| 2 | 2 | `daily-note-tasks.spec.ts` | 6 | time-dependent ("current day" predicate near UTC midnight) |
| 3-9 | 1 each | (7 specs, see T0.2 §2) | 2,3,4,5,6 | one-off — cannot discriminate flake from regression |

**Two specs account for 36% (4/11) of all spec-level incidents.** Both are concentrated on the two highest-failing shards — strong signal that **shard load + a spec-level defect compound**, not pure environmental noise.

### §3.4 Cache correlation (T0.2 §3)

Pearson **r = +0.358** (median e2e-shard wall-clock duration vs run-failed binary, N=41).
Slow-half (duration > mean) failure rate: **36.8%** (7/19).
Fast-half failure rate: **4.5%** (1/22).

**Slow runs fail ~8× more often than fast runs.** Fisher exact two-tailed p ≈ 0.018. Duration is a noisy proxy (it conflates cache-cold with runner contention with workload variance), but the magnitude of the split forecloses the null hypothesis "duration is unrelated to failure."

### §3.5 Regression cluster (anomaly, T0.2 §1 finding)

`test-unit` — 4 failures all on the same step (`Run UI tests (jest-environment-obsidian)`) within a 6-hour window on **2026-04-25** (runs `24927476330` … `24927639060`). Zero failures in the subsequent 35 runs. **Not a steady flake — a regression cluster, fixed mid-window.** This contributes to the post-cutover 31.71% headline number but is **not** the recurrent flake target Phase 3 should chase.

If we exclude this cluster, post-cutover failure rate drops to **9 / 37 ≈ 24.3%**, still a 1.94× degradation vs pre-cutover but materially smaller than the 2.54× headline. **The "true" residual flake rate is probably in the 20-25% range, not 31%.**

---

## §4 Categories G/H/I/J/K validation

Each hypothesised category from RFC §Проблема was scored against the T0.1+T0.2 evidence. Verdict legend: ✅ confirmed, ⚠️ partially confirmed, ❌ not supported, 🔵 already addressed downstream.

### G — Xvfb runner contention (CI runner CPU / Docker cache variance)

**Verdict: ✅ CONFIRMED — dominant environmental driver.**

- Cache correlation **r=+0.358**, slow-half failure rate **8× the fast-half** (§3.4). This is the textbook signature of CPU/IO contention on Xvfb + Obsidian cold-start: when runner is already loaded (slower wall-clock), Playwright's default `waitFor*` timeouts tighten relative to the actual render budget.
- Top shards (4) and (6) carry 75% of e2e failures (§3.2) but the work distribution across shards is hash-balanced, not load-balanced — this is consistent with G if shard-4 happens to draw the longer-running specs and is therefore more sensitive to a contended runner.
- **Evidence count:** N=41 runs, 8 e2e failures, r=0.358, p≈0.018.

### H — net-new specs flake instantly (environmental noise hits new code)

**Verdict: ✅ CONFIRMED — `featured-binding-promotion.spec.ts` is canonical instance.**

- This spec was created in RFC-024 T6.4 (PR #2971, merged `dd9f12a0` 2026-04-30), and **immediately** entered the post-cutover flaky cohort with 2 failures in the next handful of runs (§3.3 rank #1).
- The 30.6s timeout signature reported in T0.2 §2 finding #1 is consistent with H: a brand-new spec, with no time spent stabilising its waitFor budget against contended Xvfb, hits the floor immediately.
- **Evidence count:** 1 spec, 2 incidents, both within ~24h of merge.
- This validates the RFC's worry that **environmental noise is endemic** rather than concentrated in legacy code — H is **not** a "fix the old specs" problem, it is a **"the floor is too low for any spec"** problem and therefore couples tightly to Category G.

### I — X11 Shm::PutImageRequest infrastructure errors

**Verdict: 🔵 ALREADY ADDRESSED downstream — exclude from Phase 3.x re-ordering.**

- Phase 3.5 (Xvfb tuning) already shipped via PR #2978 (`ecf18d7e`) on **2026-04-30** — adopting T5.1 V1+V2 Xvfb config. This work landed in parallel with T0.1/T0.2 collection, so its impact is *partly inside* the post-cutover N=41 window.
- T0.2 did not surface X11 Shm errors in the failed-step grep — the 8 failed e2e runs concentrated on Playwright timeout / assertion failures, not X11 errors. This suggests Phase 3.5 already worked OR the sample is too small to see the residual.
- **Evidence count:** 0 X11 Shm incidents in 41 post-cutover runs. **Either I is solved or under-detected at N=41.**
- **Action:** keep Phase 3.5 as shipped; revisit if X11 signatures reappear at N≥100.

### J — Phase 2.1 helper insufficient against Category G

**Verdict: ⚠️ PARTIALLY CONFIRMED — supportive evidence, not load-bearing.**

- The original RFC evidence for J was that `effort-timestamps-auto-sync` flake **returns** post-Phase 2.1 refactor. T0.2 §2 ranks this spec at #8 with **1 incident in 41 runs** — present but not high-frequency.
- More importantly, J is a **structural claim** about the Phase 2.1 cold-start helper. The cache correlation in §3.4 (slow runs fail 8× more) directly supports it: a cold-start helper that ensures *deterministic warmup* does nothing about *runner contention during warmup*. The helper handles a different failure mode than the dominant one.
- **Evidence count:** 1 spec recurrence + structural inference from cache-correlation data.
- **Verdict downgrade rationale:** J is real but it is essentially "G is dominant and the existing helper does not address G." It does not need separate countermeasures — fixing G fixes J.

### K — fixture-drift warn-only insufficient + ⚠️ amended: flaky-reporter no-op

**Verdict: ✅ CONFIRMED — but the dominant K-class symptom is the reporter no-op, NOT fixture drift.**

The original RFC framing of K was "Phase 2.2 fixture-drift detector warns, doesn't block — accumulated drift contributes to Category G via subtle state pollution." T0.2 surfaced a more critical and immediately actionable variant of K:

- **`totalFlaky=0` for all 41 post-cutover runs.** The flaky-reporter exists, runs, emits artifacts (T0.1 dual-cohort backfill confirmed), but has nothing to report because the Playwright config has `retries: 0` (RFC §3.0.5 D2 decision). A reporter that emits zero on every run is a **measurement failure, not a green light.**
- **Implication:** Phase 3.4 (flaky-rate dashboard, currently shipped via PR #2979 weekly cron, `d22ff7f0`) is rendering charts based on `totalFlaky=0` — i.e. dashboards that say "everything is fine" while the underlying CI fails 31.71% of runs. **Phase 3.4 is currently unable to drive any decision.**
- **Evidence count:** 41/41 runs with `totalFlaky=0`, despite 13 actual failed runs and 11 spec incidents.
- This is the most consequential finding of Phase 3.0 and it re-orders the rest of Phase 3 (see §5).

---

## §5 Recommended re-ordering of Phase 3.x

### §5.1 Original Charter §4 dependency graph

```
Phase 3.0 (gap analysis)
   ├─→ Phase 3.1 (Xvfb profiling)
   │      ├─→ Phase 3.2 (retry policy)
   │      └─→ Phase 3.3 (quarantine)
   ├─→ Phase 3.4 (dashboard) ── parallel
   ├─→ Phase 3.5 (X11 Shm)   ── parallel (DONE)
   └─→ Phase 3.6 (validation gate, all-of)
```

### §5.2 Proposed re-ordering

The **K finding (flaky-reporter no-op)** breaks the original assumption that Phase 3.4 dashboard can be built independently of Phase 3.2 retry policy. Without `retries: 1`, the dashboard has no signal. Therefore:

```
Phase 3.0 (gap analysis)                                            ← THIS DOC
   ├─→ Phase 3.2 (retry policy)         ◄── PROMOTE: precondition
   │      └─→ Phase 3.4 (dashboard)     ◄── DEMOTE: now depends on 3.2
   ├─→ Phase 3.1 (Xvfb profiling)       ◄── parallel-able with 3.2
   │      └─→ Phase 3.3 (quarantine)
   ├─→ Phase 3.5 (X11 Shm)              ── DONE (PR #2978)
   └─→ Phase 3.6 (validation gate)
```

**Concrete changes:**

1. **Promote Phase 3.2 (retry policy `retries: 1`)** to run *immediately* after Phase 3.0, in parallel with Phase 3.1. Justification: until `retries: 1` lands, the reporter is no-op and the dashboard is meaningless. This is the single highest-leverage action in all of Phase 3.
2. **Demote Phase 3.4 (dashboard)** to depend on Phase 3.2 instead of running parallel. Justification: shipping a dashboard with `totalFlaky=0` data has already happened (PR #2979) and produced charts that don't drive decisions. Re-running Phase 3.4 *after* 3.2 will produce the first useful flaky-rate signal.
3. **Keep Phase 3.1 (Xvfb profiling)** parallel-able. Justification: profiling does not require the reporter signal; it produces independent `time` / `perf` evidence about cold-start variance.
4. **Phase 3.3 (quarantine)** still depends on Phase 3.1 (need stabilization-per-spec evidence). Phase 3.3 input list should be informed by T0.2 §2 top-N (currently `featured-binding-promotion`, `daily-note-tasks`).
5. **Phase 3.6 (validation gate)** unchanged — depends on all of 3.1, 3.2, 3.3, 3.4 complete + N≥100 post-Phase-3 sample.

### §5.3 Priority recommendation (T0.3 top recommendation)

> **Promote Phase 3.2 (Playwright `retries: 1`) to immediate-next slot — it is the single precondition that unblocks measurement of Phase 3.4 and therefore every downstream evidence-based decision in Phase 3.**

A secondary recommendation, in priority order, is the T0.2 §4 list reproduced for completeness:

1. Fix `daily-note-tasks.spec.ts` time-dependence (deterministic clock).
2. Audit `featured-binding-promotion.spec.ts` setup race.
3. Investigate `e2e-shard (4)` and `(6)` runner load — consider load-aware shard rebalance.
4. (After 1-3 above) land Playwright `retries: 1` per §5.3 primary recommendation.
5. Wire cache-state metric into `flaky-reporter.json` (replaces duration proxy).

Items 1-3 reduce the *count* of failures the reporter would otherwise see; item 4 makes the reporter capable of seeing them; item 5 sharpens the cause attribution. Sequence is intentional.

---

## §6 Conclusions and downstream implications

### §6.1 Dominant categories

Ranked by attributable share of the post-cutover residual:

1. **G (Xvfb runner contention) — DOMINANT.** Carries the cache correlation (r=0.358, 8× slow/fast split) and the shard concentration (75% on shards 4+6). All other categories interact with G.
2. **H (net-new specs flake instantly) — STRUCTURAL co-dominant.** Validates the "endemic floor" framing — H is not a separate failure mode from G, it is what G looks like when a new spec lands without a stabilisation buffer.
3. **K (flaky-reporter no-op) — MEASUREMENT-CRITICAL.** Not a flake source itself, but the reason the team currently cannot quantify any of the others. Resolving K (= shipping Phase 3.2 `retries: 1`) is the highest-leverage Phase 3 action.
4. **J (Phase 2.1 helper insufficient) — STRUCTURAL secondary.** Real but subsumed by G — fixing G fixes J.
5. **I (X11 Shm) — ALREADY ADDRESSED.** No incidents at N=41; Phase 3.5 (PR #2978) appears effective; revisit at N≥100.

### §6.2 Charter risk register update

- **Risk 5 (N=200 takes weeks):** *partially realised* — N=41 actual vs N=200 ideal in the Phase 3.0 window. Mitigation (pre-cutover backfill) successful for relative comparison but absolute post-cutover CIs remain wide. Recommendation: extend post-cutover sampling to N≥100 before Phase 3.6 validation gate.
- **Risk 1 (Phase 3.2 retries mask real bugs):** elevated by §5.3 promotion. Mitigation: Phase 3.4 dashboard tracking retry-count trends becomes the explicit safeguard. If `retries: 1` lands without the dashboard observing it, the original Risk 1 concern compounds.
- **New risk (T0.3 finding):** Phase 3.4 dashboard already shipped (PR #2979) with no-op data. **Action:** add a Phase 3.4-bis ticket to re-render the dashboard once Phase 3.2 lands and `totalFlaky` becomes non-zero. Without this, the team will have a dashboard that visually says "we shipped Phase 3.4" but operationally still says nothing.

### §6.3 Definition of done check (Phase 3.0)

Per Charter §4 Phase 3.0:

| Criterion | Status |
|---|---|
| `PHASE3_GAP_ANALYSIS.md` written | ✅ this document |
| Categories G/H/I/J/K validated against evidence | ✅ §4 |
| Dominant category identified | ✅ §6.1 — G dominant, K measurement-critical |
| Statistical re-baseline | ✅ T0.1 (N=200 pre + N=41 post), §3.1 |
| Top offenders ranked | ✅ T0.2 §2 reproduced in §3.3 |
| Recommended re-ordering | ✅ §5 |

Phase 3.0 is **complete**. Recommended next slot: **Phase 3.2** (retry policy) per §5.3.

---

## §7 Reproducibility

All evidence in this document is derived from two committed predecessors:

- **T0.1** (commit `dde4aa0d`) — `packages/obsidian-plugin/artifacts/flaky-baseline/postcutover-aggregate.json` + `runs.jsonl`.
- **T0.2** (commit `9531fded`) — `packages/obsidian-plugin/artifacts/flaky-baseline/T0_2_TOP_OFFENDERS.md`.

To reproduce the §3.4 cache correlation calculation:

```bash
cd packages/obsidian-plugin/artifacts/flaky-baseline
# 1) For each of 41 runs, compute median e2e-shard duration from jobs-postcutover/run-*.json
# 2) Map run id → failed (1) / passed (0) from runs.jsonl
# 3) Pearson r between (median_duration, failed_binary) → 0.358
```

`jobs-postcutover/` is gitignored (transient); regenerate via:

```bash
for rid in $(ls raw | sed 's/run-//'); do
  gh run view "$rid" --json jobs > jobs-postcutover/run-${rid}.json
done
```
