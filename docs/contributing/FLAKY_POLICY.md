# Flaky Test Policy

This policy governs how the Exocortex CI pipeline detects, reports, and
gates on flaky tests. It originated as the operational realisation of RFC
`3cc77ba2-2ef7-4677-a198-ab490d6461f6` v2, §Phase 1.3, and was reworked
after the `FLAKY_THRESHOLD` gate was removed (audit epic #3384, PR #3396).

> **Continuous measurement** of policy outcomes (rerun rate, top
> offenders, per-shard breakdown) is provided by the Phase 3.4 flaky
> dashboard — see
> [`docs/history/PHASE3_DASHBOARD_README.md`](../history/PHASE3_DASHBOARD_README.md)
> for architecture, data flow, and operating runbook.

## Definitions

| Term               | Definition                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Flaky test**     | A test that, within a single CI job run, failed at least once but passed on a retry.                                   |
| **`@flaky-track`** | A Playwright tag that opts a known-flaky E2E spec into `retries: 1` while its root cause is tracked in a GitHub issue. |
| **Quarantine**     | A deliberate skip or tolerated-failure recorded in `tests/quarantine.ts`, pointing to a tracking issue.                |

## Current model (post-#3396)

### What was removed

The per-shard **`FLAKY_THRESHOLD` gate** (the "Enforce FLAKY*THRESHOLD" step
in `test-coverage-shard`, configured via `vars.FLAKY_THRESHOLD` /
`vars.FLAKY_THRESHOLD_SHARD*{N}`repository variables) was **removed** in
PR #3396 (commit`788d06ef`, audit epic #3384). It was a no-op while Jest
retries are disabled: with no retries there is never a flaky report, so the
gate always skipped. Do **not** use the old
`gh variable set FLAKY_THRESHOLD ...` runbook — the variables are no longer
read by any workflow.

### What is active

1. **Strict zero-retry default for E2E.** `playwright-e2e.config.ts` sets
   `retries: 0` so flakes surface immediately instead of being masked.

2. **Two-project `@flaky-track` routing** (Issue #3350, PR #3355).
   `playwright-e2e.config.ts` defines two Playwright projects:
   - `e2e` — untagged specs (`grepInvert: /@flaky-track/`), `retries: 0`.
   - `e2e-flaky-track` — specs tagged `@flaky-track` (`grep: /@flaky-track/`),
     `retries: 1`.

   `playwright-shard-config-factory.ts` mirrors this routing inside each of
   the 6 CI shards, so every spec runs in exactly one project. Removing the
   tag from a spec automatically restores the strict 0-retry contract.

3. **NoFlakyReporter** (`packages/obsidian-plugin/playwright-no-flaky-reporter.ts`)
   fails CI (`process.exitCode = 1`) whenever an E2E test passed only after a
   retry — and is **tag-aware**: it skips `@flaky-track`-tagged tests so the
   project-level `retries: 1` tolerance is not neutralized.

4. **Retry observability.** `playwright-retry-summary-reporter.ts` writes a
   per-shard `retry-summary.json`; CI aggregates them into the GitHub Actions
   job summary ("E2E retry summary — aggregated across shards": total
   retries, retried specs, flaky-passed, failed-after-retry). Pure
   observability; never fails the run.

5. **Component tests** run with `retries: 2` in CI
   (`playwright-ct.config.ts`). A **warn-only** "Track Flaky Tests
   (Component)" CI step prints the `flaky-report-playwright.json` count if
   any CT test passed after retry — it warns but does not fail the job.

6. **Quarantine** (`tests/quarantine.ts`) — the _what to skip_ lever,
   currently empty by design (T3.1 decision matrix). See below.

## Governance

### Tagging a spec `@flaky-track`

Tagging is the documented, reviewable way to tolerate a known flake while the
root cause is being fixed. Requirements for the PR that adds the tag:

1. **Tracking issue** — a GitHub issue describing the flake (symptom, failure
   evidence from CI, suspected cause). Reference it next to the tag, e.g.
   `tag: ["@flaky-track", "@issue-2987"]` or a comment with the issue number.
2. **Evidence** — quote the retry evidence (spec name, run link) in the PR
   description.
3. **Exit criterion** — the tag is temporary; remove it in the PR that fixes
   the root cause. Removal needs no ceremony: untagged specs automatically
   return to the strict 0-retry + NoFlakyReporter contract.

### Quarantining a test

`tests/quarantine.ts` exports `QUARANTINED_TESTS: QuarantinedTest[]`. The
`QuarantinedTest` type (defined in
`packages/test-utils/src/reporters/quarantine.ts`) has fields:

- `file` _(required)_ — path to the spec file.
- `name` _(required)_ — the exact test title.
- `issue` _(optional)_ — link to the tracking GitHub issue.
- `reason` _(optional)_ — one-line cause description.
- `quarantinedAt` _(optional)_ — ISO date the test was quarantined.
- `expiresAt` _(optional)_ — ISO date the quarantine expires.
- `owner` _(optional)_ — who quarantined the test.

Anti-rot rules (Charter §4 Risk 4):

1. Every quarantined test MUST link a tracking issue.
2. Quarantine is temporary — default 30-day expiry
   (`QUARANTINE_CONFIG.maxQuarantineDays`); the manager warns past expiry.
3. Add a clear `reason` (root-cause hypothesis or symptom).
4. Tests must be fixed or removed — never left in quarantine indefinitely.
5. Promote a spec to quarantine only after dashboard evidence shows ≥2
   incidents AND `@flaky-track` retries have proven insufficient.

## Operational runbook

### Inspect retry behaviour of a CI run

```bash
# Job summary contains the aggregated "E2E retry summary" section.
gh run view <run-id> --repo kitelev/exocortex

# Failed-job logs (NoFlakyReporter prints "FLAKY TEST DETECTED" with location):
gh run view <run-id> --log-failed --repo kitelev/exocortex
```

### Reproduce a flaky shard locally

```bash
# Run the shard config that hosts the spec (see playwright-shard-assignments.json):
cd packages/obsidian-plugin
npx playwright test -c playwright.shard-<N>.config.ts
```

### Add / remove a `@flaky-track` tag

```typescript
// In the spec file:
test.describe(
  "alias sync on label change",
  { tag: ["@flaky-track", "@issue-2987"] },
  () => {
    // ...
  },
);
```

Open a PR per the governance rules above; remove the tag in the fix PR.

## Relationship with other tools

- **`tests/quarantine.ts`** — the _what_ to skip; machinery in
  `@kitelev/exocortex-test-utils` (`packages/test-utils/src/reporters/quarantine.ts`).
- **Jest flaky reporter**
  (`packages/test-utils/src/reporters/flaky-reporter.ts`, wired in
  `packages/obsidian-plugin/jest.config.js` under CI) — evidence collection
  for Jest runs. Requires `jest.retryTimes()` to ever observe a retry;
  Jest retries are currently disabled, so it is effectively dormant.
- **`E2E Desktop Smoke`** (`.github/workflows/e2e-desktop.yml`) — separate
  macOS/Windows smoke matrix (label-gated + nightly), independent of the
  PR-blocking Docker E2E shards.

## Change log

| Date       | Author                                          | Change                                                                                                    |
| ---------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 2026-04-24 | ExoAssistant (RFC 3cc77ba2 Phase 1.3 author)    | Initial policy. `FLAKY_THRESHOLD = 0` per-shard; variable-based gate governance.                          |
| 2026-06-04 | Issue #3350 / PR #3355                          | `@flaky-track` two-project routing added (`retries: 1` for tagged specs); NoFlakyReporter made tag-aware. |
| 2026-06-05 | Audit epic #3384 / PR #3396 (commit `788d06ef`) | Per-shard `FLAKY_THRESHOLD` gate removed as a no-op.                                                      |
| 2026-06-10 | Docs audit                                      | Policy rewritten around the post-#3396 model (this document).                                             |
