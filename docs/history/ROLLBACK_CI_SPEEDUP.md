# Rollback Procedures — CI Pipeline Speedup (Phases 1–3)

**Audience:** repository admins / AI agents reverting an individual CI speedup optimization that caused regression (flaky tests, correctness drift, branch-protection friction) or performing a full rollback of the ≤2-min CI initiative.

**Scope covered:** optimizations landed for the "Exocortex CI Pipeline Speedup ≤2min" project (orchestrator parent `e5939fb2`). Eight shipped PRs across three phases:

| Phase | PR | Merge commit | Optimization |
|---|---|---|---|
| 1a | [#2902](https://github.com/kitelev/exocortex/pull/2902) | `2330091a` | Fixture consolidation — 9 E2E specs `beforeEach` → `beforeAll` |
| 1b | [#2904](https://github.com/kitelev/exocortex/pull/2904) | `5ded7f30` | Event-based waits — 18 `waitForTimeout` sites replaced |
| 1c | — | — | Shard rebalance (no-op — current Playwright matrix already balanced; tracked for completeness) |
| 2a | [#2900](https://github.com/kitelev/exocortex/pull/2900) | `366d90a0` | `test-unit` stubbed to `npm run test:ui` (dedupe ↔ `test-coverage`) |
| 2b | [#2903](https://github.com/kitelev/exocortex/pull/2903) | `4f010e78` | `test-coverage` parallelized via `jest --shard=X/4` matrix |
| 2c | [#2906](https://github.com/kitelev/exocortex/pull/2906) | `2ba9ceb0` | Playwright CT `workers: 1 → 2` |
| 3a | [#2907](https://github.com/kitelev/exocortex/pull/2907) | `ca5d7746` | Composite action `.github/actions/setup-node-pnpm` (12 jobs) |
| 3b | [#2908](https://github.com/kitelev/exocortex/pull/2908) + [#2913](https://github.com/kitelev/exocortex/pull/2913) | `1223b0e4` + `6db64d79` | `paths-filter` docs-only skip + matrix-skip hotfix |

**Related artefacts:**

- RFC: `/Users/kitelev/Developer/rfc-ci-speedup-2026-04-21.md` §11.2 (rollback plan).
- CI workflow: `.github/workflows/ci.yml`, composite `.github/actions/setup-node-pnpm/action.yml`.
- Known-good post-merge baseline: commit `6db64d79` (2026-04-22 04:23 UTC).

---

## Purpose

Document per-optimization revert procedure. Each section names the target PR, the `git revert` command, expected CI regression (wall-clock delta), side-effects on dependent jobs/workflows, and the verification checklist a reviewer runs before re-approving the revert PR.

**Non-destructive:** every rollback here is a standard `git revert` on `main` via a fix-branch PR. Force-push is forbidden (per repo rules); rewriting history on `main` is not part of any rollback path documented below.

**Revert dependencies** (important — several PRs are not independently revertable without follow-up):

- **#2913 is a hotfix to #2908.** Reverting #2908 without also reverting #2913 leaves branch protection requiring `e2e-shard (1..4)` check-runs whose producing pattern was deleted — docs-only PRs will block. Pair the reverts.
- **#2907 (composite action) is referenced by 11+ job call-sites.** A clean `git revert` restores the inline `setup-node` + `npm ci` + `npm run build` blocks. Verify no post-#2907 PR introduced a new call-site that references `./.github/actions/setup-node-pnpm` and is not covered by the revert diff.
- **#2900 is a stub, not an additive change.** "Revert" restores the original `test:unit` script body (`scripts/test-ci-batched.sh` full invocation) as it stood in v15.114.10. The stub currently delegates to `npm run test:ui` (`packages/obsidian-plugin/jest.ui.config.js`, 53 tests only).

---

## Known-good baseline (2026-04-22)

Reference snapshot captured on `main` at commit `6db64d79` (post-#2913). Produced by `gh run view 24759957496 --json jobs` on run `24759957496`.

| Metric | Value | Notes |
|---|---|---|
| Critical path (workflow total wall-clock) | **3m36s** | `createdAt` 04:19:40 → `updatedAt` 04:23:16 UTC |
| `build` | 31s | cache-hit via composite action |
| `typecheck` | 19s | |
| `lint` | 24s | |
| `archgate` | 38s | |
| `test-unit` | 47s | stub (runs `test:ui`, 53 tests) |
| `test-coverage-shard (1..4)` | 33–45s | jest `--shard=X/4` matrix |
| `test-coverage` (aggregator) | 18s | downloads + merges per-shard coverage via `scripts/merge-coverage.js` |
| `test-component` | 145s | Playwright CT, 2 workers |
| `performance-tests` | 69s | |
| `test-bdd` | 15s | |
| `e2e-shard (1..4)` | 89–150s | 4-way parallel Playwright E2E (Docker) |
| `e2e-tests` (aggregator) | 26s | blob-report merge |

**Critical path breakdown:** `build` (31s) → `test-component` (145s) is the widest non-e2e arm; `e2e-shard (1)` (150s) + `e2e-tests` (26s) = 176s is the longest aggregated arm. Post-merge main runs have observed ±15s variance; quote ranges, not single values.

**Reference runs for comparison:**

- Pre-optimization floor (Phase 0 baseline, v15.114.4 `13684b4c`, pre-#2902): RFC §2 quotes ~5m15s critical path.
- Post-#2908 pre-hotfix (`1223b0e4`, run `24759676112`): 3m10s total (lower variance sample).
- Phase 3 exit gate `≤135s` for critical path **not met** at task-level — delegated to sibling task `574476fc` (parallel optimization work, file-orthogonal to this doc).

---

## Phase 1a — Fixture consolidation (beforeAll)

### Target

PR [#2902](https://github.com/kitelev/exocortex/pull/2902) — merge commit `2330091a`. 9 E2E specs refactored from `beforeEach` to `beforeAll` file-creation, with describe-level parallel opt-in.

### Rollback command

```bash
# On a fresh worktree from main
git worktree add ../worktrees/revert-phase1a-fixtures -b ci/revert-phase1a-fixtures origin/main
cd ../worktrees/revert-phase1a-fixtures
git revert 2330091a
git push origin ci/revert-phase1a-fixtures
gh pr create --title "Revert: fixture consolidation beforeEach→beforeAll (Phase 1a)" \
  --body "Reverts #2902 — see docs/history/ROLLBACK_CI_SPEEDUP.md Phase 1a. Reason: <regression-ID>"
```

### Expected side-effects (wall-clock regression)

Per post-merge measurements in `project_ci_speedup_phase1_fixtures_done.md`:

- `e2e-shard (2)` regains **~19s** (152s → 171s range)
- `e2e-shard (3)` regains **~27s**
- `e2e-shard (4)` regains **~27s**
- `e2e-shard (1)` regains **~4s**
- Aggregate post-merge slowdown: **+77s** across all 4 shards

Branch protection: all `e2e-shard (N)` check-runs still register. No schema change to required checks.

### Verification checklist post-revert

- [ ] `gh pr checks <revert-pr>` — all 11 required checks green on revert PR.
- [ ] Post-merge main: `gh run list --branch main --workflow ci.yml -L 3` — first run succeeds.
- [ ] Compare `e2e-shard` timings vs §"Known-good baseline" above — expect +20s to +30s per shard.
- [ ] No flakiness regression: 5 consecutive main runs all-green (any shard failure → new investigation).

---

## Phase 1b — Event-based waits

### Target

PR [#2904](https://github.com/kitelev/exocortex/pull/2904) — merge commit `5ded7f30`. 18 `waitForTimeout` sites replaced with content-specific `expect(locator).toContainText(..., { timeout })` or similar event-based waits across 5 specs.

### Rollback command

```bash
git worktree add ../worktrees/revert-phase1b-waits -b ci/revert-phase1b-waits origin/main
cd ../worktrees/revert-phase1b-waits
git revert 5ded7f30
git push origin ci/revert-phase1b-waits
gh pr create --title "Revert: event-based waits (Phase 1b)" \
  --body "Reverts #2904 — see docs/history/ROLLBACK_CI_SPEEDUP.md Phase 1b. Reason: <regression-ID>"
```

### Expected side-effects

- `e2e-shard (2)` regresses **~148s → ~206s** (+58s, back to pre-optimization baseline per memory `project_ci_speedup_phase1_event_waits_done.md`).
- Risk of **re-introducing flakiness** — the original blind sleeps masked race conditions that event-based waits exposed and corrected. Revert may surface latent flakes.
- See `feedback_e2e_shared_launcher_stale_dom_content_specific_wait.md`: after #2902 (`beforeAll` refactor) naked `waitForSelector` is unsafe (stale-DOM risk). If reverting #2904 alone while #2902 still applies, specs using stale waits may flake.

### Verification checklist

- [ ] All required checks green on revert PR.
- [ ] Post-merge main: 10 consecutive runs — flaky rate <5%.
- [ ] If flakiness >5%: escalate to targeted per-spec restoration (keep some event-based waits, revert only the 3–4 that caused the original triggering regression).
- [ ] Compare `e2e-shard` times — expect shard-2 +50–60s.

---

## Phase 1c — Shard rebalance (no-op)

### Target

No PR. The 4-way `e2e-shard` matrix (`ci.yml` line 748) was audited during Phase 1 (task `222b33f0`, audit report `/Users/kitelev/Developer/ci-speedup-phase1-audit-2026-04-21.md`) and found balanced — no rebalance change landed.

### Rollback command

No revert applicable. Section retained per AC §"Per-phase section for each shipped optimization" for completeness.

### Notes

If future work changes shard count (e.g. 4 → 8) and rolls back, document the specific PR here. Current state: `strategy.matrix.shard: [1, 2, 3, 4]` unchanged since before Phase 1.

---

## Phase 2a — `test-unit` ↔ `test-coverage` dedupe

### Target

PR [#2900](https://github.com/kitelev/exocortex/pull/2900) — merge commit `366d90a0`. `test-unit` CI job stubbed to `npm run test:ui` (53 tests, `jest-environment-obsidian` isolation) — no longer duplicates the full unit suite that `test-coverage` already runs with instrumentation.

### Rollback command

```bash
git worktree add ../worktrees/revert-phase2a-testunit -b ci/revert-phase2a-testunit origin/main
cd ../worktrees/revert-phase2a-testunit
git revert 366d90a0
git push origin ci/revert-phase2a-testunit
gh pr create --title "Revert: test-unit stub (Phase 2a)" \
  --body "Reverts #2900 — see docs/history/ROLLBACK_CI_SPEEDUP.md Phase 2a. Reason: <regression-ID>"
```

### Expected side-effects

- `test-unit` wall-clock **~47s → ~190–230s** (restores pre-stub full-suite run via `scripts/test-ci-batched.sh`).
- Duplicate execution: `test-unit` and `test-coverage-shard (1..4)` both run the same unit suite (minus `jest-environment-obsidian` coverage — that remains in `test-unit`'s UI-only jest config).
- Branch protection: `test-unit` name unchanged — no gate re-registration needed.

### Critical pre-revert verification

Per `feedback_ci_job_stub_for_branch_protection.md`: the `test-unit` name **is currently in branch protection required checks**. Verify before revert:

```bash
gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks --jq '.contexts'
```

If `test-unit` listed → safe to revert (name stays green post-revert). If removed → revert does not blur signal but double-check no check-run rename occurred.

### Verification checklist

- [ ] Required checks green on revert PR.
- [ ] Coverage numbers on revert PR and post-merge main within ±0.1pp of baseline (v15.114.11 measured 0.00pp delta; expect same on revert).
- [ ] `test-unit` duration restored to pre-#2900 range (≥180s).
- [ ] No regressions in `jest-environment-obsidian` coverage — `test:ui` integration still green.

---

## Phase 2b — `test-coverage` jest `--shard=X/4` matrix

### Target

PR [#2903](https://github.com/kitelev/exocortex/pull/2903) — merge commit `4f010e78`. `test-coverage` job parallelized via 4-way jest shard matrix with post-merge aggregation through `scripts/merge-coverage.js` (istanbul-lib-coverage merge, ~70 LOC).

### Rollback command

```bash
git worktree add ../worktrees/revert-phase2b-shard -b ci/revert-phase2b-shard origin/main
cd ../worktrees/revert-phase2b-shard
git revert 4f010e78
git push origin ci/revert-phase2b-shard
gh pr create --title "Revert: test-coverage jest --shard matrix (Phase 2b)" \
  --body "Reverts #2903 — see docs/history/ROLLBACK_CI_SPEEDUP.md Phase 2b. Reason: <regression-ID>"
```

### Expected side-effects

- Single-threaded `test-coverage` wall-clock **~82s → ~192s** (+110s; reverts the −57% delta from project memory).
- `scripts/merge-coverage.js` **deleted** by revert. No consumer outside `test-coverage` job depends on it (verified via `grep -r "merge-coverage" .github/ packages/`).
- Branch protection: `test-coverage-shard (1..4)` checks **removed** by revert — replaced by single `test-coverage` check. Per memory `feedback_matrix_skip_vs_singleton_check_run.md`, shard check-run names `(1)`, `(2)`, `(3)`, `(4)` will stop registering. If they are required checks in branch protection, revert blocks all future PRs until checks are also removed from protection.

### Critical pre-revert action

```bash
# Check if test-coverage-shard (N) are required:
gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks --jq '.contexts' | grep test-coverage-shard
```

If present: coordinate with repo-admin to drop `test-coverage-shard (N)` checks from branch protection **before** merging the revert PR. Otherwise all post-revert PRs will stall.

### Verification checklist

- [ ] Coverage delta on revert PR ≤0.1pp across statements/branches/functions/lines (v15.114.14 validation: 0.00pp).
- [ ] `test-coverage` restored as single job in `ci.yml`.
- [ ] Branch protection context list updated (if shard checks were required).
- [ ] Post-merge main 3 runs — `test-coverage` wall-clock ~190–220s.

---

## Phase 2c — Playwright CT `workers: 1 → 2`

### Target

PR [#2906](https://github.com/kitelev/exocortex/pull/2906) — merge commit `2ba9ceb0`. Single-line config change in `packages/obsidian-plugin/playwright-ct.config.ts` (`workers: 2`).

### Rollback command

```bash
git worktree add ../worktrees/revert-phase2c-ctworkers -b ci/revert-phase2c-ctworkers origin/main
cd ../worktrees/revert-phase2c-ctworkers
git revert 2ba9ceb0
git push origin ci/revert-phase2c-ctworkers
gh pr create --title "Revert: Playwright CT workers 1→2 (Phase 2c)" \
  --body "Reverts #2906 — see docs/history/ROLLBACK_CI_SPEEDUP.md Phase 2c. Reason: <regression-ID>"
```

### Expected side-effects

- `test-component` step-level regresses **~63s → ~91s** (+28s, −31% step-level gain from memory `project_ci_speedup_phase2_fcbe6dc2_done.md`).
- `test-component` job-level regresses ~151s → ~187s (+36s, −19% job-level).
- Minimum blast radius: 1 config file. No branch-protection interaction, no dependent scripts.

### Verification checklist

- [ ] CT tests all-green on revert PR (worker contention bugs, if any, go away with worker count reduction).
- [ ] Post-merge main `test-component` duration regressed to pre-#2906 range.
- [ ] No regressions in other jobs (config change is scoped to playwright-ct only).

---

## Phase 3a — Composite action `setup-node-pnpm`

### Target

PR [#2907](https://github.com/kitelev/exocortex/pull/2907) — merge commit `ca5d7746`. Created `.github/actions/setup-node-pnpm/action.yml` (67 LOC) + referenced from 12 jobs in `ci.yml` (`uses: ./.github/actions/setup-node-pnpm`).

### Rollback command

```bash
git worktree add ../worktrees/revert-phase3a-composite -b ci/revert-phase3a-composite origin/main
cd ../worktrees/revert-phase3a-composite
git revert ca5d7746
git push origin ci/revert-phase3a-composite
gh pr create --title "Revert: composite action setup-node-pnpm (Phase 3a)" \
  --body "Reverts #2907 — see docs/history/ROLLBACK_CI_SPEEDUP.md Phase 3a. Reason: <regression-ID>"
```

**Pre-revert check:** any PR merged after #2907 that introduced a 13th call-site (`uses: ./.github/actions/setup-node-pnpm`) that is **not** covered by the revert diff will break:

```bash
git log --oneline ca5d7746..origin/main -- .github/workflows/ .github/actions/
grep -rn "setup-node-pnpm" .github/ | wc -l   # expected 12 at time of #2907
```

If new call-sites exist (count >12), manually add inline-setup blocks to them **in the revert PR** before merging. Otherwise those jobs will fail with `local action not found` once the composite is deleted.

### Expected side-effects

- Per-job regression: `+0` to `+10s` (cache-hit savings revert). Memory `project_ci_speedup_phase3_44b3219a_done.md` notes real baseline `npm ci` was already 10s → cache-hit saves only ~8s/job in practice (projected spec 30s → 5–10s did not materialize).
- `.github/actions/setup-node-pnpm/` directory removed.
- No branch-protection impact (composite doesn't add/remove job names).

### Verification checklist

- [ ] All 12 call-sites of the composite restored to inline `actions/setup-node@v4` + `npm ci` + `npm run build` blocks in the revert diff.
- [ ] Any post-#2907 call-site (if any) hand-migrated inside the revert PR.
- [ ] Post-merge main: 3 runs green, per-job wall-clock regressed by the expected ~8s.

---

## Phase 3b — `paths-filter` docs-only skip (+ matrix-skip hotfix)

### Target

Two PRs — revert as a **pair** (hotfix depends on base):

- PR [#2908](https://github.com/kitelev/exocortex/pull/2908) — merge commit `1223b0e4`. Added `detect-changes` job via `dorny/paths-filter@v3`; e2e-shard gated on `needs.detect-changes.outputs.code`.
- PR [#2913](https://github.com/kitelev/exocortex/pull/2913) — merge commit `6db64d79`. **Hotfix** — replaced job-level `if:` on `strategy.matrix` with step-level `RUN_E2E` env + per-step `if:` so individual `e2e-shard (1..4)` check-runs always register on docs-only PRs.

### Rollback command

```bash
git worktree add ../worktrees/revert-phase3b-pathfilter -b ci/revert-phase3b-pathfilter origin/main
cd ../worktrees/revert-phase3b-pathfilter
# Revert hotfix first (most recent), then base
git revert 6db64d79
git revert 1223b0e4
git push origin ci/revert-phase3b-pathfilter
gh pr create --title "Revert: paths-filter docs-only skip + hotfix (Phase 3b)" \
  --body "Reverts #2913 + #2908 — see docs/history/ROLLBACK_CI_SPEEDUP.md Phase 3b. Reason: <regression-ID>"
```

### ⚠ Matrix-skip gotcha (do not "simplify")

Per memory `feedback_matrix_skip_vs_singleton_check_run.md` and the #2913 postmortem:

> GitHub job-level `if:` applied to a `strategy.matrix` job registers only the **base** check-run name. Parenthesised per-cell names like `e2e-shard (1)`, `(2)`, `(3)`, `(4)` are **never created** when the job-level `if:` evaluates to `false`. Branch protection requires those per-cell names → the PR blocks.

Consequence for future maintainers considering a "cleaner" gating refactor:

- **NEVER** replace the step-level `if: env.RUN_E2E == 'true'` pattern on matrix jobs with a job-level `if:`.
- The only correct docs-only-skip pattern for matrix jobs on branch-protected repos is: **always run the job shell**, but skip each heavy step individually. `#2913` is the canonical implementation of this pattern.

### Expected side-effects

- Docs-only PRs regain **full e2e cost** (~2–3 min critical path) instead of ~15–30s skip.
- `detect-changes` job removed entirely (~5s saved on every run — negligible).
- `force-e2e` label override gone; all PRs run e2e unconditionally.
- No branch-protection changes needed — same 4 `e2e-shard (N)` + `e2e-tests` check-run names always register.

### Verification checklist

- [ ] Revert PR's own CI triggers full e2e (since removing path-filter reverts the skip-on-docs gate — this PR is docs-only but will now run e2e).
- [ ] Post-merge main docs-only PRs from next week: confirm wall-clock regression (docs PRs back to ~3min, not ~30s).
- [ ] No matrix check-run registration issues: `gh pr view <post-revert-pr> --json statusCheckRollup` shows `e2e-shard (1..4)` all present.

---

## Emergency admin rollback (nuclear — full CI speedup revert)

Reserved for cases where per-optimization revert is insufficient (e.g. multiple cascading regressions, or the ≤2-min CI initiative is being wound down wholesale).

### When to use

- Three or more per-phase reverts queued simultaneously.
- Widespread CI instability tracing to multiple speedup interactions (e.g. fixture consolidation + event-waits + shard matrix interaction).
- Project-level decision to abandon the ≤2-min objective.

### Steps

1. **Do not rewrite history.** No `git reset` on `main`; no force-push.
2. Revert all 8 optimization PRs in reverse chronological order (newest first, to minimize conflict noise):
   ```
   git revert 6db64d79   # #2913 (Phase 3b hotfix)
   git revert 1223b0e4   # #2908 (Phase 3b base)
   git revert ca5d7746   # #2907 (Phase 3a composite)
   git revert 2ba9ceb0   # #2906 (Phase 2c CT workers)
   git revert 4f010e78   # #2903 (Phase 2b shard matrix)
   git revert 366d90a0   # #2900 (Phase 2a test-unit stub)
   git revert 5ded7f30   # #2904 (Phase 1b event-waits)
   git revert 2330091a   # #2902 (Phase 1a fixtures)
   ```
3. Open a single batched revert PR: `Revert: full CI speedup Phases 1–3 (emergency rollback)`.
4. Restore any branch-protection checks that were added as part of Phase 2b / 2a transitions (coordinate with repo admin — see each Phase section's "Critical pre-revert" callouts).
5. Post-merge verification: critical path returns to pre-optimization baseline of ~5m15s (RFC §2 Phase 0 number).

### Restoration criteria for re-attempting speedup

- Root-cause identified for all triggering regressions (one issue per reverted phase).
- New RFC revision scoping replacement approach (e.g. alternative test-coverage parallelization strategy).
- Incident post-mortem filed under project `e5939fb2` retrospective.

---

## Log

Append one-line entries per rollback event. Format: `YYYY-MM-DD · <phase> · <summary> · <restoration-PR-or-TBD>`.

- 2026-04-22 · n/a · Doc created on branch `ci/rollback-doc` (task `7ca72790`). No rollbacks executed — reference-only publication. Dry-run revert validation: `git revert 2ba9ceb0` (Phase 2c, minimum blast radius) applied cleanly on ephemeral branch — no merge-conflict resolution required.

---

## References

- RFC: `/Users/kitelev/Developer/rfc-ci-speedup-2026-04-21.md` §11.2 (rollback plan entry).
- Orchestrator project: `e5939fb2-0e1f-418c-93a1-619faaf9f6b3` (`Exocortex CI Pipeline Speedup ≤2min`).
- Sibling rollback doc: `docs/history/ROLLBACK_RFC_CI_TESTS.md` (RFC-CI-Tests suite — separate project, distinct scope).
- CI workflow: `.github/workflows/ci.yml`.
- Composite action: `.github/actions/setup-node-pnpm/action.yml`.
- Coverage merge helper: `scripts/merge-coverage.js`.
- Project memory (per-phase done reports):
  - `project_ci_speedup_phase1_fixtures_done.md`
  - `project_ci_speedup_phase1_event_waits_done.md`
  - `project_ci_speedup_phase2_fcbe6dc2_done.md` (CT workers)
  - `project_ci_speedup_phase2_761ca21e_done.md` (test-unit stub)
  - `project_ci_speedup_phase2_9346c5be_done.md` (shard matrix)
  - `project_ci_speedup_phase3_44b3219a_done.md` (composite action)
  - `project_ci_speedup_phase3_path_filter_done.md` (paths-filter + hotfix)
- Matrix-skip pattern lesson: `feedback_matrix_skip_vs_singleton_check_run.md`.
