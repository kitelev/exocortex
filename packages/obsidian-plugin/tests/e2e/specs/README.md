# E2E specs — shared fixture invariant & ordering contract

Author: RFC `3cc77ba2` Phase 2.2 — Option C (docs + ordering contract).
Decision record: `~/vault-2025/03 Knowledge/inbox/1e13509c-cc5e-4ef1-a334-af7b3d67cbd9.md` (session 3, 2026-04-25).

## Shared fixture invariant

Specs in this directory execute against a **shared** vault under `tests/e2e/test-vault/`. The vault is mounted read-write into the Docker Obsidian container and **is not restored** between tests or between specs unless the test does so explicitly.

Consequences:

- A test that mutates a fixture file (via `fs.writeFileSync`, `app.fileManager.processFrontMatter`, or plugin-triggered writes) leaves the fixture in a drifted state for every subsequent test in the same shard.
- Plugin logging emits to `test-vault/.obsidian/plugins/exocortex/exocortex-logs.txt` (since #3186). The drift detector should not see it because `.obsidian/` is outside the vault content tree, but any future log writes that escape the plugin data directory would resurface here as ambient noise.
- Specs do **not** declare or rely on a cross-spec ordering contract. Parallel/shuffled execution must still pass. Any spec that requires a specific neighbour state must set that state itself in `beforeAll`/`beforeEach` rather than depend on the order Playwright happens to choose.

## Fixture drift detector

The Playwright reporter `../reporters/fixture-drift-reporter.ts` hashes every non-ignored file in `test-vault/` before and after each test. A test that leaves any non-ignored file changed is recorded in `test-results/fixture-drift.json` (inside the container → surfaced to `e2e-test-artifacts-<shard>` via the `FIXTURE_DRIFT_OUTPUT` env var passed from CI, see `.github/workflows/ci.yml`). The reporter is **warn-only** — drift never fails CI. It exists as an early-warning signal so that future classes of flake can be classified quickly.

At the time of the Phase 2.2 decision (2026-04-25, run `24904690787`) the detector reported 54/64 tests drift. Most drift is ambient (`exocortex-logs.txt`) or locally-contained plugin writes; one canonical spec (`effort-timestamps-auto-sync.spec.ts`, Category F in the RFC audit) mutates `Tasks/timestamp-sync-task.md` with no rollback. Left as-is per Option C.

## When to add a per-spec cleanup

The N=19 post-D0 variance audit that informed Option C showed:

- test-step wall-clock variance ≤ 5 s excluding the D0 transition run — below the RFC v2 `> 15 s → Option B` threshold;
- e2e retry rate 21 % (4/19) driven by **selector timeout / browser-closed / assertion / infra-timeout** modes — **not** by drift-correlated specs.

If a retry in CI turns out to be caused by drift (a failed test explicitly reads a file another test mutated), add spec-local cleanup rather than rolling out a global hook. The reference pattern is `dynamic-command-buttons-render.spec.ts` (lines 32–43): `fs.readFileSync` snapshot in `beforeEach`, `fs.writeFileSync` restore in `afterEach`. Keep the scope to the one file the spec mutates.

If drift-correlated retries become systemic (≥ 3 specs across ≥ 2 shards), escalate to Option A (`afterEach` whitelist driven by `fixture-drift.json`) and re-open RFC 3cc77ba2 Phase 2.2.

## Docker cache (RFC Phase 2.3) — skipped

Phase 2.3 (Docker buildx `--cache-from=type=gha`) was marked optional in RFC v2 and is **not** pursued. Rationale: `feedback_ci_runner_variance_dwarfs_measurement.md` established that runner scheduling variance dominates image-level variance in this repository; delta < 5 % baseline is expected, below the RFC skip criterion.

## Running a single spec locally

```
npm run test:e2e -- packages/obsidian-plugin/tests/e2e/specs/<name>.spec.ts
```

Tests run inside Docker only. Never invoke Playwright against a host-side Obsidian — see `PATTERNS.md` § Docker E2E.
