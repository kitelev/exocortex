# T1.2 — Cold-Start Distribution (RFC 32a64ed9 §3.1)

- **Generated:** 2026-04-30T20:29:03.101Z
- **Total records:** 36
- **Inputs (12 files):**
  - `run-25187245556-shard-1.jsonl` — 2 records
  - `run-25187245556-shard-2.jsonl` — 4 records
  - `run-25187245556-shard-3.jsonl` — 6 records
  - `run-25187245556-shard-4.jsonl` — 2 records
  - `run-25187245556-shard-5.jsonl` — 2 records
  - `run-25187245556-shard-6.jsonl` — 2 records
  - `run-25187249529-shard-1.jsonl` — 2 records
  - `run-25187249529-shard-2.jsonl` — 4 records
  - `run-25187249529-shard-3.jsonl` — 6 records
  - `run-25187249529-shard-4.jsonl` — 2 records
  - `run-25187249529-shard-5.jsonl` — 2 records
  - `run-25187249529-shard-6.jsonl` — 2 records

## Per-step distribution

| Step | N | min ms | P50 ms | P95 ms | P99 ms | max ms | P99/P50 |
|------|---|-------:|-------:|-------:|-------:|-------:|--------:|
| `docker_pull` | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| `container_start` | 12 | 1 | 1 | 2 | 3 | 3 | 2.89 |
| `xvfb_ready` | 12 | 19789 | 26614 | 34620 | 35036 | 35140 | 1.32 |
| `obsidian_spawn` | 6 | 41 | 50 | 64 | 66 | 66 | 1.31 |
| `plugin_load` | 6 | 14 | 39 | 52 | 53 | 53 | 1.37 |
| `vault_index` | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| `first_interaction` | 0 | n/a | n/a | n/a | n/a | n/a | n/a |

## Interpretation

Per RFC 32a64ed9 §3.1: a high P99/P50 ratio per step is a signal of environmental sensitivity.
Steps with P99/P50 ≥ 2.0 are candidates for Phase 3.2 (per-spec retry) and Phase 3.5 (X11/Xvfb investigation).
Steps with low ratio (~1.0–1.3) reflect deterministic execution and need no environmental remediation.

## Phase 3.1 findings (T1.2)

- **Top contributor by absolute time: `xvfb_ready` (P50 ≈ 27s, P99 ≈ 35s).** Dominates
  cold-start budget by 2-3 orders of magnitude vs. all node-side steps combined.
  Absolute P99 (35s) is well inside the 60s Playwright timeout, but the spread
  P50 → P99 (~8.4s) is the primary environmental noise vector — exactly what
  RFC §3.1 hypothesised for Category G (Xvfb runner contention).
- **`xvfb_ready` ratio = 1.32 (low–moderate).** Ratio alone undersells the issue
  because the absolute floor is so high — even a 1.32× spread on a 27s base
  costs the suite ~8s wall-clock per cold-start. Phase 3.5 (X11 Shm
  investigation, dpi/screen tuning, headed Chromium fallback) targets this
  step directly.
- **`container_start` ratio = 2.89 but absolute negligible (1–3ms).** Ratio is
  noise on a near-zero base; not actionable.
- **Node-side steps (`obsidian_spawn`, `plugin_load`) — small absolute (≤66ms)
  and tight ratio (~1.3).** These aren't the bottleneck. `vault_index` and
  `first_interaction` had zero samples in this window: the corresponding
  helpers are opt-in (per `docs/cold-start-telemetry-schema.md`) and not yet
  invoked by existing specs — landing them is a separate observability task,
  not a Phase 3.1 blocker.
- **Sample-size caveat.** N=12 for shell steps and N=6 for node-side steps is
  below the RFC-suggested N≥25 "stable distribution" pragmatic threshold for
  a single step in isolation. Distribution shape (P99 within ~1% of max) is
  consistent across both CI runs, suggesting the sample is representative for
  the high-impact `xvfb_ready` step. Re-running with more iterations (e.g.,
  re-dispatch `CI` workflow N=3-5 times) is a cheap follow-up to tighten the
  P95/P99 confidence band; not a gating dependency for downstream phases.

## Recommendations for downstream phases

- **Phase 3.5 (X11 Shm investigation) — highest ROI.** Focus on `xvfb_ready` —
  the single 27-35s step containing the entire Xvfb + Obsidian binary launch.
  Investigation A (Xvfb tuning), Investigation B (xvfb-run wrapper isolation),
  Investigation C (headed Chromium migration) all target this exact step.
- **Phase 3.2 (per-spec retry) — independently warranted.** Cold-start
  variance contributes to spec-level flake regardless of whether `xvfb_ready`
  is the proximate failure (the 8s P50→P99 spread can push individual spec
  steps over Playwright's 30s expect-timeout in adverse cells). Per-spec
  retry reversal is orthogonal mitigation while Phase 3.5 investigates root
  cause.
- **Telemetry coverage gap.** Existing specs trigger `obsidian_spawn` and
  `plugin_load` but not `vault_index` or `first_interaction`. Wiring the
  opt-in helpers into 1-2 representative specs would close the lifecycle
  picture for future phases. Out of scope for T1.2.

## Source data

- CI runs: `25187249529`, `25187245556` (workflow_dispatch on
  `task-00906d1c`).
- Per-shard JSONL: 30-day artifact retention, names
  `cold-start-telemetry-shard-{1..6}` per run.
- Aggregator: `packages/obsidian-plugin/scripts/aggregate-cold-start-distribution.mjs`.
- Schema: `docs/cold-start-telemetry-schema.md` (T1.1).
