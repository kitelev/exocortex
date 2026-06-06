# Phase 3.4 — Flaky Dashboard Architecture

> RFC Phase 3 (32a64ed9) §Phase 3.4 — Flaky-rate dashboard. Final consolidation
> doc for the dashboard infrastructure shipped via PRs #2976 (T4.1), #2979
> (T4.2), #2980 (T4.3). Written as part of T4.4.

This document is the operator-facing entry point for the three-component
flaky-rate dashboard. It explains **what each component does**, **how data
flows between them**, and **how to operate / extend the system**. Source-of-
truth for design rationale is the RFC itself; this README is the runbook.

## Goals

- **Continuous measurement** of the post-Phase 3 flaky rate against the DoD
  target `<10%` PR rerun rate (per Issue #2974, RFC §Метрики успеха).
- **Visibility** — surface the metric where developers already look (PR
  comments) instead of a buried dashboard.
- **Trend awareness** — top-10 offenders + per-shard breakdown so retries do
  not silently mask emerging flake categories (Risk 1 mitigation).

## Components

The dashboard is composed of **three independent units** glued by shared
JSON contracts. Each unit is independently testable and replaceable.

### 1. `flaky-aggregate.ts` (T4.1)

- **Path:** `packages/obsidian-plugin/scripts/flaky-aggregate.ts`
- **Role:** ETL — pulls `flaky-report*.json` artifacts from the last N
  completed `ci.yml` runs on `main` (default N=30) and emits a single
  structured `FLAKY_DASHBOARD.json` summary.
- **Inputs:** `--repo`, `--workflow`, `--branch`, `--limit`, `--output`,
  `--dry-run` (skip artifact downloads), `--input <dir>` (offline mode).
- **Output schema (excerpt):**

  ```jsonc
  {
    "generatedAt": "ISO-8601",
    "summary": {
      "totalRuns": 30,
      "runsWithFlaky": 12,
      "rerunRatePercent": 40,
      "averageFlakyPerRun": 1.6
    },
    "topOffenders": [{ "spec": "...", "occurrences": 5, "rerunRatePercent": 16 }],
    "perShard": { "1": { ... }, "2": { ... } },
    "timeline": [{ "runId": 1234, "conclusion": "success", "flakyCount": 1 }]
  }
  ```

- **Tests:** `packages/obsidian-plugin/tests/unit/flaky-aggregate.test.ts`.

### 2. `flaky-render-markdown.ts` + weekly cron (T4.2)

- **Path:** `packages/obsidian-plugin/scripts/flaky-render-markdown.ts`
- **Workflow:** `.github/workflows/flaky-dashboard.yml`
- **Role:** Pure renderer — consumes the JSON from step 1 and produces a
  human-readable `FLAKY_DASHBOARD.md` (snapshot, trend sparkline,
  top-10 offenders, per-shard breakdown, run timeline).
- **Trigger:** weekly cron `0 6 * * 1` (Mondays 06:00 UTC ≈ 11:00
  Asia/Almaty) + `workflow_dispatch` for manual / dry runs.
- **Persistence:** the workflow opens an auto-merge PR on the dedicated
  branch `chore/flaky-dashboard-refresh` whenever `FLAKY_DASHBOARD.md` /
  `.json` change. Direct pushes are not possible — `main` has 13 required
  status checks and no bypass for `github-actions[bot]`.
- **Tests:** `packages/obsidian-plugin/tests/unit/flaky-render-markdown.test.ts`.

### 3. `flaky-pr-comment.ts` + post-merge widget (T4.3)

- **Path:** `packages/obsidian-plugin/scripts/flaky-pr-comment.ts`
- **Workflow:** `.github/workflows/flaky-pr-comment.yml`
- **Role:** Surfaces the rolling rerun-rate snapshot inline on the merged
  PR — current 30 runs vs prior 30 runs delta + top-3 offenders.
- **Trigger:** `push` to `main` (after each squash-merge) +
  `workflow_dispatch` (with optional `pr` override).
- **Idempotency:** sticky comment via marker `<!-- exocortex-flaky-widget:v1 -->`.
  Existing comment is `PATCH`ed in place; only one widget per PR.
- **Tests:** `packages/obsidian-plugin/tests/unit/flaky-pr-comment.test.ts`.

## Data flow

```
        ┌────────────────────┐
        │  ci.yml runs (main)│
        │  → flaky-report*.json artifacts
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │ flaky-aggregate.ts │  (T4.1, pure ETL — testable offline)
        └─────────┬──────────┘
                  │ FLAKY_DASHBOARD.json (shared contract)
       ┌──────────┴──────────┐
       ▼                     ▼
 ┌──────────────┐     ┌─────────────────────┐
 │ render-      │     │ pr-comment.ts (T4.3)│
 │ markdown.ts  │     │  current vs prior   │
 │   (T4.2)     │     │  + top-3 offenders  │
 └──────┬───────┘     └─────────┬───────────┘
        │                       │
   FLAKY_DASHBOARD.md      sticky PR comment
   (auto-merge PR)         (PATCH-in-place)
```

The aggregator is the single source of truth — both renderers consume the
same JSON shape, so any contract change must be made there first.

## Operating the dashboard

### Trigger a manual refresh (dashboard markdown)

```bash
gh workflow run flaky-dashboard.yml \
  -f limit=30 \
  -f dry_run=false \
  -f skip_commit=false
gh run list --workflow flaky-dashboard.yml --limit 1
```

Use `dry_run=true` to validate the pipeline without hitting GitHub
artifact APIs (offline-safe). Use `skip_commit=true` to render without
opening the auto-merge refresh PR (smoke test).

### Trigger the PR widget for a specific PR

```bash
gh workflow run flaky-pr-comment.yml \
  -f pr=2980 \
  -f window=30
```

This re-renders the sticky widget on the target PR using the current
30/30 cohorts.

### Read the dashboard

- Latest markdown: `packages/obsidian-plugin/docs/FLAKY_DASHBOARD.md`
- Underlying JSON: `packages/obsidian-plugin/docs/FLAKY_DASHBOARD.json`
- Per-PR widget: scroll to the bottom of any merged PR — the sticky
  comment marked `exocortex-flaky-widget:v1`.

## Maintenance

- **Schema changes** — modify `flaky-aggregate.ts` first, regenerate
  fixtures, then update the two consumers in lockstep. The JSON contract
  is the boundary; both renderers will fail their unit tests if it breaks.
- **Window tuning** — `--limit` (aggregator) and `--window` (PR widget) are
  flag-driven; cron defaults live in the two workflow files.
- **Reporter source** — relies on `flaky-report*.json` produced by
  `playwright-flaky-reporter.ts` (Phase 1.3). If that reporter is renamed
  or moved, update the `ARTIFACT_GLOB` / `FLAKY_FILE_PATTERN` constants in
  `flaky-aggregate.ts`.
- **Quarantine interaction (Phase 3.3)** — quarantined specs (via
  `test.fixme()`) do not appear in flaky reports. The dashboard intentionally
  surfaces non-quarantined offenders so the quarantine list stays honest.

## Rollback

The three components are independently rollback-able. Any one workflow can
be disabled (`gh workflow disable <name>`) without breaking the others —
the markdown dashboard simply goes stale, or the PR widget stops updating.
The aggregator script is pure and has no external side-effects beyond
filesystem writes; reverting its commit is safe and self-contained.

## References

- RFC: `[[32a64ed9-9a74-4e0c-bb26-e455605aa384]]` — Phase 3.4 spec
- T4.1 PR: kitelev/exocortex#2976 — aggregator
- T4.2 PR: kitelev/exocortex#2979 — weekly cron + renderer
- T4.3 PR: kitelev/exocortex#2980 — PR-comment widget
- Source Issue: kitelev/exocortex#2974 — DoD `<10%` PR rerun rate
- Quarantine policy: `docs/FLAKY_POLICY.md`
- X11 strategy ADR: `packages/obsidian-plugin/docs/phase3/ADR_FLAKY_X11_STRATEGY.md`
