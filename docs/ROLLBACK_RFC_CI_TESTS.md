# Rollback Procedures — RFC-CI-Tests Suite

**Audience:** repository admins performing Phase 4 branch-protection enforcement (RFC §8 Phase 4, tracked via orchestrator task `70b28b93-…`) or reacting to post-cutover regression of the RFC-CI-Tests suite (Phases 1–3 merged in v15.114.0–v15.114.8).

**Scope covered:** the three CI additions introduced by RFC-CI-Tests:

- `test-unit` / `test-coverage` jobs running `packages/cli/tests/integration/starter-kit/test-helpers/command-catalog.ts` parametrized suite (Phase 1), full 41-command parametrized suite (Phase 2), and `packages/cli/tests/integration/starter-kit/exocmd-contract.test.ts` (Phase 1).
- `e2e-shard` matrix running `packages/obsidian-plugin/tests/e2e/specs/starter-kit-smoke.spec.ts` (Phase 3).
- `packages/starter-kit-fixtures` git submodule (Phase 1; `.gitmodules`).

**Related RFC sections:** §3.1 (fixture access options), §3.4 (developer workflow impact), §7.2 (E2E smoke budget), §8 (Phase 4 handoff checklist + rollback plan), §9 (flaky-rate target <5% over 100 runs).

---

## Purpose

Describe per-trigger mitigation steps admins can execute during Phase 4 branch-protection cutover and immediately after. Each rollback path is scoped to preserve merge velocity without deleting test coverage — signal downgrades to advisory (`continue-on-error: true`) or suite trims, never full revert. The "Emergency admin rollback (nuclear)" section at the bottom documents the only non-reversible step — removing jobs from branch-protection required-checks — and is reserved for cutover-day blockers.

---

## Trigger 1 — Flaky test rate >5%

### Symptom

A specific test from the RFC-CI-Tests suite fails intermittently on PRs that don't touch related code. Surfaces as:

- PR authors re-running the same job more than once per PR.
- `flaky-report.json` artifact (already uploaded by `ci.yml` flaky-tracker — lines 163–187 for `test-unit`, 487–505 for `e2e-shard`) reports `totalFlaky > 0` on the offending test name.
- PR merge velocity drops (re-runs extend cycle time).

### Detection

1. Inspect the latest merged-to-main `flaky-test-report-unit` or `flaky-test-report-playwright` artifacts (GitHub Actions → workflow run → Artifacts).
2. Manual ratio check over the last 100 main-branch runs (matches RFC §9 target):
   ```bash
   gh run list --workflow=ci.yml --branch=main --limit=100 --json databaseId,conclusion,jobs \
     | jq -r '.[].jobs[] | select(.name | test("<job-name>")) | .conclusion' \
     | awk 'BEGIN{f=0;t=0} {t++; if($0=="failure") f++} END{printf "%.1f%%\n", 100*f/t}'
   ```
3. If the rate ≥5%, proceed to rollback. If 2–5%, open a tracking issue but do not quarantine yet (bar is 5% per §8 rollback plan).

### Rollback steps

1. Edit `.github/workflows/ci.yml`, locate the offending job (`test-unit`, `test-coverage`, or the specific `e2e-shard` matrix entry).
2. Add `continue-on-error: true` at the job level:
   ```yaml
   test-unit:
     needs: build
     runs-on: ubuntu-latest
     timeout-minutes: 7
     continue-on-error: true  # QUARANTINE: flaky >5% — track issue #NNNN
   ```
3. Commit on a fix branch (`chore(ci): quarantine <job-name> pending flaky fix`), merge through standard PR flow. The branch-protection check remains "green-or-skipped" during quarantine.
4. Open a tracking issue with: test name, flaky-report.json excerpt, links to 3 failing runs.

### Un-quarantine criteria

- Root-cause fix merged (cite commit in tracking issue).
- Flaky rate drops to **<5% over 100 consecutive main-branch runs** (RFC §9 false-positive target, §8 rollback plan threshold).
- Remove `continue-on-error: true`; re-merge via standard PR.

---

## Trigger 2 — E2E smoke subset blows 5-min shard budget

### Symptom

`e2e-shard` matrix entries running `starter-kit-smoke.spec.ts` exceed the `timeout-minutes: 5` budget (`ci.yml` line 573). RFC §7.2 sized the smoke at 7 commands targeting this budget; overage means per-test cost drifted (likely cause: Docker cold-start, test-vault fixture growth, or one newly-added spec among the 7).

### Detection

1. Check `e2e-shard` step timings:
   ```bash
   gh run view <run-id> --log | grep -E "(starter-kit-smoke|Done in [0-9]+m [0-9]+s)" | head -20
   ```
2. Per-shard wall-clock via GitHub Actions UI → Workflow runs → shard N → Timing column.
3. Threshold: any shard exceeds **4m30s** (30s headroom under the 5-min timeout) on ≥3 consecutive main runs → act. One-off overage = monitor, do not act.
4. Confirm the offending shard is the one running `starter-kit-smoke.spec.ts` (4-shard matrix distributes tests — memory `feedback_e2e_shard_cancellation_kills_artifact_upload` notes cancellation kills `if: always()` artifact upload, so prefer live-tail over artifact inspection once budget is already tight).

### Rollback steps

1. Edit `packages/obsidian-plugin/tests/e2e/specs/starter-kit-smoke.spec.ts`.
2. Reduce from 7 → 5 commands per RFC §8 rollback plan. **Drop-set:**
   - `Plan on Today` (category: planning, direct fast-path; covered indirectly by other planning specs)
   - `Set Zone to Today` (category: criticality-renamed-to-zone; covered by contract test class-flip invariant once UX RFC P0-2 ships)
3. **Keep-set (5):** `Create Child Task`, `Archive Completed`, `Set Result`, `Set Planned Start`, `Set Status Doing` — preserves: creation-async + destructive-confirm + input-modal + date-input + composite-grounding coverage (RFC §7.2 coverage-gap mapping).
4. Commit (`test(plugin): trim starter-kit smoke 7→5 per RFC §8 budget rollback`), merge through standard PR flow.
5. Verify next main run: shard wall-time drops below 4m30s.

### Revert criteria

- Per-test cost regression root-caused (Docker layer, fixture growth, new spec cost).
- Bench re-run on a spike branch shows 7-command suite fits 5-min budget with ≥30s headroom.
- Restore the two dropped tests; commit `test(plugin): restore 7-command starter-kit smoke`.

---

## Trigger 3 — Submodule friction ≥3 contributor instances

### Symptom

`packages/starter-kit-fixtures` git submodule (Phase 1, `.gitmodules`) creates friction documented per RFC §3.4:

- Contributor PR comments / issues reporting forgotten `git submodule update` (tests pass locally on stale pin, fail in CI on fresh pin).
- Parallel-agent conflicts where two worktrees update submodule HEAD to divergent starter-kit commits.
- Onboarding time to first green CI run exceeds 30 min attributable to submodule setup.

### Detection

1. Count contributor-reported submodule incidents: search repo issues + PR comments for `submodule`, `submodules: recursive`, `starter-kit-fixtures`, `git submodule update` over trailing 30 days.
2. Threshold: **≥3 distinct contributor instances OR ≥2 parallel-agent conflicts** (RFC §3.4 decision rule).
3. Parallel-agent conflicts are detectable via `git log --all --format='%H %s' -- .gitmodules packages/starter-kit-fixtures | head -20` showing submodule-bump commits on conflicting branches.

### Rollback steps — migrate submodule → npm package (RFC §3.1 option B)

1. Publish starter-kit repository as `@kitelev/exocortex-starter-kit` to npm:
   ```bash
   cd exocortex-starter-kit
   npm version patch  # or starter-kit's own semver cadence
   npm publish --access public
   ```
2. In exocortex repo worktree:
   ```bash
   # Remove submodule
   git submodule deinit -f packages/starter-kit-fixtures
   git rm -f packages/starter-kit-fixtures
   rm -rf .git/modules/packages/starter-kit-fixtures
   git commit -m "chore(ci): remove starter-kit-fixtures submodule"

   # Add npm devDependency (CLI package — where helpers import from)
   cd packages/cli
   npm install --save-dev @kitelev/exocortex-starter-kit@<pinned-version>
   ```
3. Update test-helper imports in `packages/cli/tests/integration/starter-kit/test-helpers/command-catalog.ts`. Current (submodule, ESM — `import.meta.url` per `packages/cli` `"type": "module"`):
   ```ts
   const root = fileURLToPath(new URL('../../../../../../packages/starter-kit-fixtures/exocmd', import.meta.url));
   ```
   Migrated (npm):
   ```ts
   import { createRequire } from 'node:module';
   const require = createRequire(import.meta.url);
   const root = path.resolve(
     path.dirname(require.resolve('@kitelev/exocortex-starter-kit/package.json')),
     'exocmd'
   );
   ```
4. Update `ci.yml` — remove `submodules: recursive` from checkout steps (lines 147, 202, 584 — `test-unit`, `test-coverage`, `e2e-shard`):
   ```yaml
   - name: Checkout
     uses: actions/checkout@v6
     # submodules line removed — starter-kit pulled via npm
   ```
5. Commit on a migration branch (`chore(ci): migrate starter-kit-fixtures submodule → @kitelev/exocortex-starter-kit npm package`), open PR, full pipeline.
6. Update `AGENTS.md` / `CLAUDE.md` contributor instructions — replace "remember `git submodule update`" with "`npm install` pulls the pinned starter-kit version".

### Revert criteria

Submodule option B does not carry a revert trigger — it's a one-way structural change. If npm-package option itself creates publish-pipeline friction, re-evaluate RFC §3.1 options C (clone-at-setup) or D (snapshot) in a follow-up RFC revision.

---

## Emergency admin rollback (nuclear)

Reserved for **Phase 4 cutover-day blockers** — cases where enforcing the new required-checks in branch protection blocks an urgent unrelated PR (hotfix, security patch) and per-trigger rollback is too slow.

### When to use

- All three per-trigger rollbacks above are inapplicable or would take >2 hours.
- A high-priority PR (hotfix / security) is blocked on an RFC-CI-Tests check that cannot be unblocked on its own merits within the current incident window.
- Admin availability is confirmed — this path requires repo-admin permissions.

### Steps

1. **Remove the failing RFC-CI-Tests check(s) from required-checks list** — do **not** delete the jobs from `ci.yml`. Settings → Branches → Branch protection rule for `main` → Require status checks → uncheck the specific checks (e.g., `test-unit / test-coverage`, `e2e-shard / smoke-starter-kit`, contract-test job if split).
2. The unchecked jobs keep running on PRs but become **advisory** (green box, not a gate).
3. Commit an admin note to `docs/ROLLBACK_RFC_CI_TESTS.md` Log (below) with: incident ID, which checks were downgraded, unblocked PR URL, restoration ETA.
4. **Do not** merge the unblocked PR and forget — schedule the required-checks restoration within 48h of the incident.

### Restoration criteria

- Incident PR merged.
- Root-cause of the RFC-CI-Tests failure identified and fixed (or downgraded to per-trigger rollback above).
- Re-add the checks to branch-protection required-checks list. Verify via a test PR that the gate fires.

### Post-incident

Log the incident under **Log** below. File a follow-up issue with label `rfc-ci-tests-rollback` documenting root-cause and preventive action (e.g., flaky-rate alert <5% before 70b28b93 re-enforcement).

---

## Log

Append one-line entries per rollback event. Format: `YYYY-MM-DD · <trigger> · <summary> · <restoration-PR-or-TBD>`.

- 2026-04-21 · Phase 4 cutover · Branch-protection amended to 11 required checks (Option B — `test-bdd` retained; `build`/`e2e-tests` removed; `e2e-shard (1..4)` + `lint` added) via `gh api PATCH` at 17:02+05. Baseline → `/Users/kitelev/Developer/branch-protection-baseline-2026-04-21.pretty.json`; post-amend → `/Users/kitelev/Developer/branch-protection-postamend-2026-04-21.pretty.json`. Coordination task `70b28b93-…`. No rollback event — enforcement cutover only.

---

## References

- RFC: `docs/rfc/rfc-ci-button-testing-2026-04-20.md` (§3.1 options, §3.4 decision rule, §7.2 E2E budget, §8 Phase 4 handoff + rollback plan, §9 success metrics).
- CI workflow: `.github/workflows/ci.yml` (`test-unit`, `test-coverage`, `e2e-shard` jobs; flaky-report infra lines 163–187 / 487–505).
- Submodule: `.gitmodules` → `packages/starter-kit-fixtures` → `https://github.com/kitelev/exocortex-starter-kit`.
- Phase 4 tasks: `f5cc7758` (pre-cutover ≥5-green monitoring), `d79c774e` (this document), `70b28b93` (admin branch-protection PR — references this doc).
