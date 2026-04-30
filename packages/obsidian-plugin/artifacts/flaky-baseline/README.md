# Flaky Baseline Artifacts (Phase 3.0 — T0.1 backfill)

**Task:** [02c9c7f8-e17a-4fb4-bf0e-8f6338e57c09](../../../../) — RFC Phase 3 Flaky e2e residual stabilization, T0.1 precondition.
**Generated:** 2026-04-30 (Asia/Almaty).
**Source:** `kitelev/exocortex` GitHub Actions CI workflow runs (workflow id 179424860).

## Methodology

**Original spec:** N≥200 main CI runs since 2026-04-25 (Phase 2.2 cutover).

**Empirical reality (2026-04-30):**
- Main-branch CI runs since 2026-04-25: 14
- All-events (PR + push) CI runs since 2026-04-25: 41
- N=200 single-cohort target **unreachable** (~5× shortfall)

**Adapted to dual-cohort design** (Orchestrator decision, Option D):
- **Primary cohort** — all-events post-cutover (N=41, 2026-04-25 → 2026-04-30)
- **Secondary cohort** — pre-cutover historical (N=200, most-recent before 2026-04-25; range 2026-04-18 → 2026-04-24)

This realises Charter Risk 5 (data sparsity) partially. The dual-cohort design preserves post-cutover regime purity for primary analysis while supplying baseline-comparison context from pre-cutover.

## Top-line stats (run conclusion)

| Cohort | N | success | failure | cancelled | failure_rate |
|---|---:|---:|---:|---:|---:|
| Post-cutover (≥2026-04-25) | 41 | 28 (68.29%) | 13 (31.71%) | 0 | **31.71%** |
| Pre-cutover (2026-04-18 → 2026-04-24) | 200 | 172 (86.0%) | 25 (12.5%) | 3 (1.5%) | **12.5%** |

**Headline observation.** Post-cutover failure rate is **~2.5× pre-cutover** (31.71% vs 12.5%). This corroborates RFC §Контекст evidence (5/9 PRs ≈ 55% rerun rate in the 2026-04-30 RFC-024 orchestration window).

### By event type (post-cutover)

| event | total | success | failure | failure_rate |
|---|---:|---:|---:|---:|
| pull_request | 27 | 19 | 8 | 29.6% |
| push (main) | 14 | 9 | 5 | 35.7% |

### By event type (pre-cutover)

| event | total | success | failure | failure_rate |
|---|---:|---:|---:|---:|
| pull_request | 126 | 102 | 21 | 16.7% |
| push (main) | 74 | 70 | 4 | 5.4% |

## flaky-reporter.json content

**Critical gap finding:** `totalFlaky=0` across **all** runs in **both** cohorts (post-cutover 41/41 + pre-cutover 200/200).

**Root cause:** `playwright-flaky-reporter.ts` records tests that pass after retry. CI config has `retries: 0` (D2 decision 2026-04-22), so no test can ever pass after retry — the reporter produces a structurally empty signal.

**Implication for Phase 3:** the flaky-reporter infrastructure is **currently no-op** as a measurement device. Phase 3.2 (per-spec `test.retry(1)`) is a precondition for the flaky-reporter to start producing usable data. Until then the only flake signal is **job-level conclusion** (success/failure) and **manual rerun count** (`gh run rerun --failed`).

This finding supersedes the RFC §3.4 assumption that "existing flaky-reporter artifacts" already encode top-10 offender data. They do not.

## Artifact collection counts

Per-shard artifact yield (number of runs that produced each artifact). Lower counts on shards 5/6 reflect detect-changes skip optimisation (shards run only when relevant paths changed).

### Post-cutover (N=41)

| artifact | runs | aggregated total tests |
|---|---:|---:|
| flaky-test-report-unit | 39 | 176,124 |
| flaky-test-report-component | 41 | 23,370 |
| flaky-report-shard-1 | 33 | 28,596 |
| flaky-report-shard-2 | 29 | 23,512 |
| flaky-report-shard-3 | 23 | 17,829 |
| flaky-report-shard-4 | 31 | 24,756 |
| flaky-report-shard-5 | 24 | 21,871 |
| flaky-report-shard-6 | 23 | 16,997 |

### Pre-cutover (N=200)

| artifact | runs | aggregated total tests |
|---|---:|---:|
| flaky-test-report-unit | 200 | 915,710 |
| flaky-test-report-component | 190 | 108,300 |
| flaky-report-shard-1 | 103 | 96,057 |
| flaky-report-shard-2 | 102 | 92,657 |
| flaky-report-shard-3 | 95 | 86,409 |
| flaky-report-shard-4 | 104 | 91,559 |
| flaky-report-shard-5 | 66 | 55,917 |
| flaky-report-shard-6 | 65 | 46,138 |

## Files

- `runs.jsonl` — post-cutover run metadata (id, branch, event, conclusion, created_at) for N=41
- `runs-historical.jsonl` — pre-cutover full pull (1000 runs back to 2026-03-01)
- `runs-historical-200.jsonl` — pre-cutover trimmed to most-recent N=200 (2026-04-18 → 2026-04-24)
- `raw/run-<id>/*.zip` — post-cutover raw artifact zips (gitignored)
- `raw-historical/run-<id>/*.zip` — pre-cutover raw artifact zips (gitignored)
- `postcutover-summary.json` — top-line stats (post-cutover)
- `postcutover-aggregate.json` — per-run + per-shard rollup (post-cutover)
- `postcutover-top-offenders.json` — empty (totalFlaky=0)
- `precutover-summary.json` / `precutover-aggregate.json` / `precutover-top-offenders.json` — same for pre-cutover
- `aggregate.py` — aggregation script (re-runnable on any `raw_dir`)

## Reproducing

```bash
# 1. Fetch run metadata (post-cutover)
gh api 'repos/kitelev/exocortex/actions/workflows/179424860/runs?created=>=2026-04-25&per_page=100' \
  --paginate \
  --jq '.workflow_runs[] | {id, head_branch, event, conclusion, created_at}' \
  > runs.jsonl

# 2. Download flaky-* artifacts per run
./download-flaky.sh runs.jsonl raw/

# 3. Aggregate
python3 aggregate.py raw/ postcutover
```

## Hand-off to T0.2 / T0.3

Subsequent gap-analysis tasks should consume:
- `postcutover-summary.json` for primary-cohort failure-rate analytics (Categories G/H/I/J/K validation)
- `precutover-summary.json` for noise-floor baseline comparison
- `runs.jsonl` + `runs-historical-200.jsonl` for run-level joins (to fetch attempt count, failed jobs, spec names from `gh run view --log` if needed)

The empty-`tests` finding above means **per-spec offender data must be sourced elsewhere** for Phase 3 (e.g. job logs, `actions/cache` failure annotations, or `test.retry(1)` enablement on identified specs in Phase 3.2).
