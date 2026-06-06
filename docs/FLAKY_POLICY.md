# Flaky Test Policy

This policy governs how the Exocortex CI pipeline detects, reports, and
gates on flaky tests. It is the operational realisation of RFC
`3cc77ba2-2ef7-4677-a198-ab490d6461f6` v2, §Phase 1.3.

> **Continuous measurement** of the policy outcomes (rerun rate, top
> offenders, per-shard breakdown) is provided by the Phase 3.4 flaky
> dashboard — see
> [`docs/history/PHASE3_DASHBOARD_README.md`](./history/PHASE3_DASHBOARD_README.md)
> for architecture, data flow, and operating runbook.

## Definitions

| Term | Definition |
| ---- | ---------- |
| **Flaky test** | A test that, within a single CI job run, failed at least once but passed on a retry (Jest `invocations > 1 && status == "passed"`). |
| **`FLAKY_THRESHOLD`** | Maximum tolerated `totalFlaky` count per shard per run. Starts at `0` and is raised only via governance below. |
| **Quarantine** | A deliberate skip or tolerated-failure recorded in `tests/quarantine.ts` with an `expiresAt ≤ 30d`, pointing to a tracking issue. |

## Gate behaviour

The `test-coverage-shard` job uploads `flaky-report-shard-${N}.json` per
shard and then evaluates the gate. The resolution order is most →
least specific:

1. **Per-shard override:** `vars.FLAKY_THRESHOLD_SHARD_{N}` where `N` ∈
   {1,2,3,4,5,6}. Use this to raise only one shard.
2. **Global default:** `vars.FLAKY_THRESHOLD`. Applies to all 6 shards.
3. **Hardcoded fallback:** `0`. Matches the Phase 0.3 empirical baseline
   (158 reports across 50 runs, `totalFlaky = 0` in all).

Gate result:

- `totalFlaky ≤ threshold` → PASS (`✅`).
- `totalFlaky > threshold` → FAIL with `::error::` + `jq .flakyTests`
  spill of the offending tests.
- `flaky-report-shard-{N}.json` missing → PASS-skip with `::notice::`.
  Expected when Jest retries are disabled for the shard.

## Governance

### Raising the threshold (`0 → N` or `N → M > N`)

1. **2-reviewer approval** on the PR that changes the repository variable
   or flat file defining the threshold.
2. **Quarantine entry required** — one entry per newly tolerated flake in
   `tests/quarantine.ts` with:
   - `file` — path to the flaky spec.
   - `testName` — exact `test(...)` title.
   - `reason` — one-line plain-English cause.
   - `issueLink` — GitHub issue tracking the root cause fix.
   - `owner` — GitHub username / team owning the fix.
   - `expiresAt` — ISO date ≤ 30 days from the raise commit date.
3. **PR description** must name the quarantine entry and the issue being
   tracked, and must quote the `flaky-report` evidence (test name and
   retry count).

### Lowering the threshold (`N → 0` or `N → M < N`)

- **1 reviewer** — tightening is low-risk.
- Remove the corresponding quarantine entry if the flake is fixed (if not,
  keep it; the quarantine entry and the threshold are independent levers).

### Measurement window reset (QA M3)

Any change to `retries`, `timeout`, `quarantine`, or `FLAKY_THRESHOLD`
**resets** the rolling window used in RFC metrics. Re-establish a new
baseline with `N = 50` runs before claiming the policy is re-stable.

## Operational runbook

### Adjust the global threshold

```bash
# Raise the global threshold (applies to all 6 shards).
gh variable set FLAKY_THRESHOLD --body '1' --repo kitelev/exocortex

# Un-raise.
gh variable set FLAKY_THRESHOLD --body '0' --repo kitelev/exocortex
```

### Adjust one shard only

```bash
# Raise shard 3 only, global stays at 0.
gh variable set FLAKY_THRESHOLD_SHARD_3 --body '1' --repo kitelev/exocortex

# Remove the shard-3 override (falls back to global).
gh variable delete FLAKY_THRESHOLD_SHARD_3 --repo kitelev/exocortex
```

### Inspect the current values

```bash
gh variable list --repo kitelev/exocortex | grep -i flaky
```

### Local reproduction

```bash
# Download the shard artifact and inspect.
gh run view <run-id> --log-failed --repo kitelev/exocortex
gh api "repos/kitelev/exocortex/actions/artifacts/<artifact-id>/zip" > flaky.zip
unzip flaky.zip && jq . flaky-report-shard-*.json
```

## Phase-0 baseline reference

- Sample: 50 most-recent main CI runs as of 2026-04-24
  (`2026-04-19 → 2026-04-24`).
- Artefacts: 135 post-restructure + 23 pre-restructure = 158 reports.
- `totalFlaky = 0` in every single report (CT retry-validated; Jest
  retry-blind).
- Conclusion: `FLAKY_THRESHOLD = 0` per-shard is the correct default.
  Full methodology: `/Users/kitelev/Developer/phase0-flaky-threshold-baseline.md`.

## Rationale — why per-shard over aggregate

Per Architect M2 + Planner Q1 (RFC v2):

- Aggregate `FLAKY_THRESHOLD` applied to `sum(shards)` masks single-shard
  regressions. `[1, 1, 1, 1, 1, 0]` vs threshold `3` (aggregate 5) fails;
  but `[5, 0, 0, 0, 0, 0]` vs threshold `3` (aggregate 5) also fails —
  yet only the latter is the genuine single-shard regression.
- Per-shard gives early-warning surface, at the cost of 6 independent
  thresholds. We keep them identical by default (all `0`) so the
  operational cost stays near zero.

## Relationship with other tools

- **`tests/quarantine.ts`** — the *what* to skip. Entries require
  `expiresAt ≤ 30d`. Independent of `FLAKY_THRESHOLD` — quarantine
  removes a failing test from the run, threshold controls tolerance for
  any remaining retry-passes.
- **`FLAKY_REPORT_FILE` (Jest reporter)** — the *evidence*. Generated by
  `packages/test-utils/src/reporters/flaky-reporter.ts`. Requires
  `jest.retryTimes()` configured somewhere in the tree; without retries,
  `invocations` never exceeds 1 and the reporter is blind.
- **CT retries (`playwright-ct.config.ts:retries:2`)** — the current only
  reporter-valid retry surface. Jest/E2E are retry-disabled at time of
  policy adoption; the gate is therefore defensive against future
  `retries:N>0` activation (Phase 3.1 of the RFC).

## Change log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2026-04-24 | ExoAssistant (RFC 3cc77ba2 Phase 1.3 author) | Initial policy. Threshold = 0 per-shard; governance described above. |
