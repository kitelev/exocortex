# Phase 3 — E2E Retry Policy

**RFC:** Phase 3 — Flaky E2E Residual Stabilization (vault `32a64ed9-9a74-4e0c-bb26-e455605aa384`)
**Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619`
**Issue:** kitelev/exocortex#2974
**Tasks consolidated here:** T2.1 (per-spec retry) + T2.2 (retry telemetry).

## TL;DR

- **Global `retries: 0`** in `playwright-e2e.config.ts` is preserved (Decision D2 — keep main signal honest).
- **7 known-plaintive specs** opt-in to `test.describe.configure({ retries: 1 })`. Scope is intentionally per-spec, not global.
- A new **`playwright-retry-summary-reporter`** captures per-test retry counts, writes Markdown into `$GITHUB_STEP_SUMMARY` per shard, uploads JSON artefacts, and surfaces a PR-level `retried: <N>` annotation on the aggregator job.

## Rationale

Phase 2.1 silenced cascading failures but residual plaintive flakes (T0.2 ranks #1–#8, plus Cat G/I/J environmental/time-dependent specs) continued to red the pipeline ~3–4× per week. A blanket `retries: 1` would mask all flakes including new regressions; a hard `retries: 0` keeps masking pressure low but bleeds rerun cost on known offenders.

The compromise: opt-in retry on a finite, named whitelist with telemetry that surfaces *every* retry so we never lose the signal we're paying for.

## Whitelist (T2.1)

| Spec | Reason | T0.2 rank | Category |
|------|--------|-----------|----------|
| `featured-binding-promotion.spec.ts` | net-new test churn | #1 | H |
| `daily-note-tasks.spec.ts` | time-dependent | #2 | I |
| `dynamic-command-buttons-render.spec.ts` | Maintenance header 20s timeout | #3 | — |
| `starter-kit-smoke.spec.ts` | smoke flake | #4 | — |
| `table-column-alignment.spec.ts` | layout race | #5 | — |
| `effort-timestamps-auto-sync.spec.ts` | post-Phase-2.1 plaintive recurrence | #8 | J |
| `daily-navigation.spec.ts` | Xvfb environmental | — | G |

Each opt-in is a single line — `test.describe.configure({ retries: 1 })` (or merged into the existing `mode: "parallel"` configure call) — with a comment citing this RFC and the rank/category. Adding to the whitelist requires (a) appearance in T0.2 ranking or a Cat G/I/J classification and (b) a PR comment linking to the rerun-rate evidence.

## Telemetry hooks (T2.2)

- **Reporter:** `packages/obsidian-plugin/playwright-retry-summary-reporter.ts`. Listens to `onTestEnd`, increments `result.retry` counters, and on `onEnd` writes:
  - `retry-summary.md` — appended to `$GITHUB_STEP_SUMMARY` so each shard's Checks tab shows its own retry count + per-spec breakdown.
  - `retry-summary.json` — uploaded as `retry-summary-shard-{1..6}` artefacts.
- **Aggregator:** the `e2e-tests` job in `.github/workflows/ci.yml` downloads all 6 shard artefacts, sums `retried` counts, and posts a single PR-level summary (`this PR's E2E was retried: <N> times across <M> specs`).
- **Pure observability:** the reporter never fails a run. It is wired alongside the existing `no-flaky-reporter` and `flaky-reporter` (the latter was a no-op per T0.2 §1; per-spec retries activate it).

## Operating discipline

1. **Do not lift global `retries: 0`.** If you find yourself wanting to, the answer is to fix the spec or add a single line to the whitelist.
2. **Whitelist is monotonic but not permanent.** When Phase 3.4's dashboard (T4.x) shows a whitelisted spec at <0.5% rerun rate for 2 weeks, drop it. Track removals in the whitelist table above.
3. **Treat retry-summary annotations as Sev-3 noise budget.** A PR with `retried: >0` is allowed to merge but the count is monitored; sustained rises trigger a Phase 3.5 retro.
4. **Rollback:** revert this PR — both the spec opt-ins and the reporter wiring are additive and self-contained. No CI matrix changes; no global config flip.
