# T0.2 — Per-shard + per-spec rerun rate top-10

**Task:** `8a8421f7-a22f-499d-ac8a-8454ed65c943`
**Generated:** 2026-05-01 (Asia/Almaty)
**Cohort:** post-cutover, N=41 workflow runs (Phase 3.x window 2026-04-25 → 2026-04-30)
**Baseline data:** T0.1 deliverable (`postcutover-aggregate.json` + `runs.jsonl`) + this task's gh API job-level pull (`jobs-postcutover/run-*.json` — kept transient, not committed).

---

## Critical limitation (carried over from T0.1)

`flaky-reporter.json` reports `totalFlaky=0` for **all 41 runs**. The flaky-reporter is no-op without retry attempts in the current Playwright config (RFC §3.0.5). True per-spec **rerun** rate cannot be computed. Instead we measure two adjacent signals:

1. **Per-shard / per-job failure rate** = jobs whose `conclusion=failure` ÷ total jobs (sourced from `gh run view --json jobs`).
2. **Per-spec failure incidence** = number of distinct test cases marked `✘` in Playwright's `--log-failed` output across the 8 failed e2e workflow runs.

Both omit silent reruns inside a single Playwright invocation. Per-spec retry-pass-on-second-attempt remains invisible until reporter is fixed (Phase 3.2 dependency).

---

## 1. Per-shard failure rate (post-cutover N=41)

| Job                       | Total | Success | Failure | Failure rate |
|---------------------------|------:|--------:|--------:|-------------:|
| `e2e-shard (1)`           |    41 |      41 |       0 |     **0.00%** |
| `e2e-shard (2)`           |    41 |      40 |       1 |     **2.44%** |
| `e2e-shard (3)`           |    41 |      39 |       2 |     **4.88%** |
| `e2e-shard (4)`           |    41 |      38 |       3 |     **7.32%** |
| `e2e-shard (5)`           |    41 |      40 |       1 |     **2.44%** |
| `e2e-shard (6)`           |    41 |      38 |       3 |     **7.32%** |
| `e2e-tests` (gate)        |    41 |      33 |       8 |    **19.51%** |
| `test-coverage-shard (1..6)` | 41×6 |   246 |       0 |     **0.00%** |
| `test-unit`               |    41 |      37 |       4 |     **9.76%** |
| `test-component`          |    41 |      41 |       0 |     **0.00%** |
| `test-bdd`                |    41 |      41 |       0 |     **0.00%** |
| `lint`                    |    41 |      40 |       1 |     **2.44%** |
| `typecheck`               |    41 |      41 |       0 |     **0.00%** |
| `archgate`                |    41 |      41 |       0 |     **0.00%** |
| `detect-changes`          |    41 |      41 |       0 |     **0.00%** |

**Runs with ≥1 failed job:** 12 / 41 = **29.27%** (matches T0.1 `failure_rate_pct=31.71%` to within cancellation noise).

### Findings

- **Top failing shards: `e2e-shard (4)` and `e2e-shard (6)`** at 7.32% each (3 failures / 41 runs). `e2e-shard (1)` is the **most stable** (0 failures).
- **`test-unit`** is the **single highest-failure-rate job** at 9.76%, all 4 failures on the same step `Run UI tests (jest-environment-obsidian)` and concentrated in a 6-hour window on 2026-04-25 (runs `24927476330`, `24927525365`, `24927591254`, `24927639060`). This is **not** a steady flake — it is a regression cluster, likely fixed mid-window (no failures in the subsequent 35 runs).
- `test-coverage-shard (1..6)` is **never failing** post-cutover (0/246) — confirms unit suite is deterministic; flakes live in e2e/UI integration only.
- The aggregate `e2e-tests` umbrella job at 19.5% is higher than any individual shard because it fans-in: it fails if **any** shard fails. With 6 shards averaging ~4% indep, ~6×4% ≈ 21% expected — observed 19.5%, consistent.

---

## 2. Top-N offending specs (per-spec failure incidence)

Source: 8 failed e2e workflow runs × `gh run view --log-failed` parse for Playwright `✘` lines (first-attempt failures only — retries-passing-on-second still invisible until reporter Phase 3.2).

**Total unique failing test cases:** 9
**Total failure incidents:** 11 (across the 8 failed runs)

| # | Count | Shard | In runs | Spec › Test name |
|--:|------:|:-----:|:-------:|-----------------|
| 1 | **2** | 4 | 2 | `featured-binding-promotion.spec.ts` › RFC-024 Phase 3 — featuredBinding promotion › promotes the layout's featuredBinding to `primary`, keeping exactly one primary button per panel |
| 2 | **2** | 6 | 2 | `daily-note-tasks.spec.ts` › DailyNote Tasks Table › should display only tasks for the current day |
| 3 | 1 | 3 | 1 | `dynamic-command-buttons-render.spec.ts` › Dynamic Command Button Rendering & Functionality › renders button from RDF config and executes grounding on click |
| 4 | 1 | 4 | 1 | `starter-kit-smoke.spec.ts` › Starter-kit smoke (RFC-CI-Tests Phase 3) › Create Child Task: creation, async service_call, no confirm |
| 5 | 1 | 6 | 1 | `table-column-alignment.spec.ts` › Table Column Alignment (#594) › should align header columns with data columns |
| 6 | 1 | 3 | 1 | `alias-sync-on-label-change.spec.ts` › Alias Sync on Label Change › should sync alias when exo__Asset_label changes |
| 7 | 1 | 2 | 1 | `daily-archive-filter.spec.ts` › DailyNote Archive Filter › should toggle archived tasks visibility with button click |
| 8 | 1 | 2 | 1 | `effort-timestamps-auto-sync.spec.ts` › Effort Timestamps Auto-Sync › should sync resolutionTimestamp when endTimestamp changes |
| 9 | 1 | 5 | 1 | `file-explorer-icons.spec.ts` › FileExplorerIconPatch — Phase 4 smoke › ems__Task nav-file-title carries .exo-file-explorer-icon overlay before .nav-fil... |

### Findings

- **#1 `featured-binding-promotion.spec.ts`** — failed twice on shard 4. Both incidents on RFC-024 feature branches (`task-ca6ee229`, `task-6c8d741f`); 30.6s timeout reported (`(30.6s)` suffix). Likely real test instability from RFC-024 Phase 3 work landing concurrently (PR #2971 dd9f12a0), not pure flake. **Recommend: review test setup for race against featuredBinding render.**
- **#2 `daily-note-tasks.spec.ts`** — failed twice on shard 6. The "current day" predicate is **time-dependent**; tests crossing midnight UTC or running near day-boundary can be inherently flaky. **Recommend: freeze clock via Playwright `page.clock.install()` or test fixture with stable `date.now`.**
- Tests #3–#9 each failed only once → likely either (a) genuine regression caught and fixed in same window, or (b) low-frequency flake. Need ≥1 more failure occurrence to discriminate.

### Coverage caveat

These 11 incidents represent **first-attempt failures that propagated to job-level failure**. Reruns that pass on a second attempt within the same Playwright invocation are not retried (no `retries: N` in current Playwright config — RFC §3.0.5) and therefore cannot be measured. Real flake rate (retry-pass-rate) is **lower-bound 11 / 41 runs / N specs ≈ 0.27 incidents/run**, but unbounded above until retry instrumentation lands (T1.x).

---

## 3. Cache correlation (Docker layer cache ↔ rerun rate)

### Methodology

Direct cache hit/miss instrumentation is not exported per-job. We use **median e2e-shard wall-clock duration** as a proxy for cache state — a cold Docker base image rebuild adds ~30–60s vs warm pull. For each of the 41 runs we computed the median across 6 e2e-shard durations from `jobs-postcutover/run-*.json` (`startedAt`/`completedAt` deltas).

### Result

| Statistic | Value |
|---|---|
| N runs | 41 |
| median e2e duration min / mean / max | 93s / 101s / 116s |
| Pearson r (median e2e duration ↔ run-failed binary) | **+0.358** (moderate positive) |
| Slow-half failure rate (dur > mean) | 7 / 19 = **36.8%** |
| Fast-half failure rate (dur ≤ mean) | 1 / 22 = **4.5%** |

### Interpretation

- **r = +0.358** is a moderate but non-spurious positive correlation: slower runs are meaningfully more likely to fail. With N=41 and 8 failures, this is consistent with a real signal (Fisher exact two-tailed p ≈ 0.018 on 7-vs-1 split).
- **8x failure-rate amplification** in the slow half supports the hypothesis that **cache-cold or contended runners destabilize e2e** — likely via timing-sensitive Playwright assertions (election timeouts, `waitFor*` defaults) tightening when the runner is otherwise loaded.
- **Caveat:** duration is a **proxy**. It conflates cache-cold with concurrency contention, runner image variance, and e2e-test workload variance (e.g. shard 4 with `featured-binding-promotion` legitimately runs longer). Direct cache-hit rate metric (T1.2 `flaky-reporter.json` with cache provenance) would tighten this — recommend Phase 3.2 wires `BUILDX_CACHE_FROM_HIT` into the reporter envelope.

---

## 4. Recommendations for Phase 3.x downstream tasks

Ordered by expected stabilization impact:

1. **Fix `daily-note-tasks.spec.ts` time-dependence** (#2 offender, 2 failures) — switch to deterministic clock; estimated −20% of post-cutover spec-level incidents.
2. **Audit `featured-binding-promotion.spec.ts` setup race** (#1 offender, 2 failures) — likely missing `await waitFor` on layout render; estimated −20%.
3. **Investigate `e2e-shard (4)` and `(6)` runner load** — these two shards carry both top offenders and 6/8 of all e2e failures. Consider rebalancing test distribution if hashing is currently load-blind.
4. **Land Playwright `retries: 1` for CI** (RFC §3.0.5 dependency) — only after #1-3 to avoid hiding remaining real bugs; this also unlocks `flaky-reporter` to emit non-zero `totalFlaky` in T1.x.
5. **Wire cache-state metric into `flaky-reporter.json`** — direct correlation replaces duration proxy; supports Pearson recompute with cleaner signal in T1.2+.

---

## 5. Reproducibility

```bash
cd packages/obsidian-plugin/artifacts/flaky-baseline

# Per-job conclusions (re-fetches gh API):
for rid in $(ls raw | sed 's/run-//'); do
  gh run view "$rid" --json jobs > jobs-postcutover/run-${rid}.json
done

# Per-shard / per-job tabulation: see python snippets archived in this task's
# session transcript; reproduce by parsing jobs-postcutover/*.json by job name + conclusion.

# Failed-step extraction:
for rid in 25161548873 25176805503 25164875238 25162907138 25164075002 \
           25164332207 25163195515 25164337058; do
  gh run view "$rid" --log-failed > logs-failed/run-${rid}.txt
done
# Then grep '✘' for spec offenders.
```

`jobs-postcutover/` and `logs-failed/` directories are **transient** (gitignored) — the analysis output above is the durable deliverable.
