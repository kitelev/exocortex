# Branch Protection on `main`

How `main` is protected, how to read its current state, and how to change it.

> **The authority is the live GitHub API, not this page.** Nothing here transcribes the
> required-check set, and nothing here applies a protection payload — see
> [Why there is no setup script](#why-there-is-no-setup-script) for the measurement that
> retired the one we used to ship.

## Why Branch Protection?

In a multi-instance AI development environment:

- **Prevents race conditions**: only one PR merges at a time
- **Ensures quality**: the required CI checks must pass before merge
- **Eliminates version conflicts**: automatic versioning happens sequentially
- **Linear-ish history**: squash merges keep `main` readable
- **Safe rollback**: every change is a PR that can be reverted

## Required status checks

⛔ **The list is not repeated here.** Its names and count change whenever CI jobs are
added, renamed or retired, so any copy in a document is a snapshot that rots silently.

- Human-readable snapshot (single source inside the repo):
  [`docs/reference/ci/required-checks.md`](../docs/reference/ci/required-checks.md)
- Live authority — run this:

  ```bash
  gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks \
    --jq '.contexts | sort | .[]'
  ```

  Needs admin. Without admin, the same set is readable from the branch object:

  ```bash
  gh api repos/kitelev/exocortex/branches/main --jq '.protection.required_status_checks.contexts'
  ```

If the snapshot page and the API disagree, **the API wins** — fix the page.

## Reading the current protection

```bash
# Everything (admin):
gh api repos/kitelev/exocortex/branches/main/protection

# Or in the web UI:
open https://github.com/kitelev/exocortex/settings/branches
```

## Changing the protection

There are exactly two supported paths, and both exist on purpose — see
[Why there is no setup script](#why-there-is-no-setup-script) for what was removed and why.

### Path 1 — the GitHub UI (default)

Use the **GitHub UI**: _Settings → Branches → `main` → Edit_.

1. Go to <https://github.com/kitelev/exocortex/settings/branches>
2. Edit the rule whose branch-name pattern is `main`
3. For the required-check list, add/remove individual checks — the search box offers the
   check-run names CI actually produced recently, so you never type a name no workflow emits
4. Save

### Path 2 — one sub-resource at a time, read-modify-write (API, needs admin)

⛔ **Never `PUT /repos/{owner}/{repo}/branches/main/protection`.** That endpoint is a **full
replace**: every field you omit is reset and every field you spell out overwrites whatever is
live. A payload assembled by hand therefore rewrites the parts of the policy you were not
thinking about — which is exactly what happened here (see below).

✅ `PATCH` the single sub-resource you mean, and build its body **from the live value**. Adding
one required check, end to end:

```bash
NEW_CHECK='my-new-job'          # a name CI actually reports

# 1. read the live sub-resource (do not type its contents from memory)
gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks > /tmp/rsc.json

# 2. derive the new body from it — nothing is authored except the one name being added
jq --arg n "$NEW_CHECK" '{strict: .strict, contexts: (.contexts + [$n] | unique)}' \
  /tmp/rsc.json > /tmp/rsc-patch.json

# 3. apply ONLY that sub-resource (the policy fields are untouched by construction)
gh api --method PATCH \
  repos/kitelev/exocortex/branches/main/protection/required_status_checks \
  --input /tmp/rsc-patch.json

# 4. read the effect back — never trust the exit code alone
gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks \
  --jq '.contexts | sort | .[]'
```

Removing a check is the same with `(.contexts - [$n])` in step 2. For the policy fields
(`enforce_admins`, linear history, PR reviews) prefer Path 1: they have their own
sub-resources, but they are changed about once a year and the UI shows you the current value
next to the switch.

### Why there is no setup script

This page used to say "run `.github/scripts/setup-branch-protection.sh`". That script was
removed in #4494, measured against the live protection on 2026-10-02:

| field                             | what the script sent              | what was live                                                                                                                                                 |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required_status_checks.contexts` | `["build-and-test", "e2e-tests"]` | 14 real contexts — **neither** of those two among them (`build-and-test` is emitted by no workflow; `e2e-tests` exists only as a **non-required** aggregator) |
| `enforce_admins`                  | `true`                            | `false`                                                                                                                                                       |
| `required_linear_history`         | `true`                            | `false`                                                                                                                                                       |
| `required_pull_request_reviews`   | an object                         | absent                                                                                                                                                        |

Because `PUT` replaces the whole object, running it by these instructions would have swapped
the 14 live contexts for two names nothing ever reports — i.e. it would have removed the
protection as a mechanism while exiting `0` and printing "✅ configured successfully". The
script never failed; only the protection did, and that is not logged anywhere.

Re-pointing the script at the live set was rejected as a fix: a setter that derives _every_
field from the live state is an identity operation (it writes back exactly what it read), and
any field it keeps authoring re-opens the same hole. See the PR for #4494 for the full
reasoning.

## Verifying protection works

```bash
git checkout main
echo "test" >> README.md
git commit -am "test: direct push"
git push origin main
```

Expected:

```
remote: error: GH006: Protected branch update failed
 ! [remote rejected] main -> main (protected branch hook declined)
```

✅ That rejection **is** the protection working.

## AI agent workflow

```bash
# 1. Feature branch in its own worktree
git worktree add ../worktrees/exocortex-claude1-feat-my-feature -b feature/my-feature
cd ../worktrees/exocortex-claude1-feat-my-feature

# 2. Change code, 3. test locally
npm run test:all

# 4. Commit (no version bump — that is automated)
git commit -am "feat: description"

# 5. Push and open the PR
git push origin feature/my-feature
gh pr create --title "feat: description" --body "Details..."

# 6. Wait for CI, then read the per-check verdict (not the rollup)
gh pr view <N> --json state,mergeStateStatus,headRefOid
gh api "repos/kitelev/exocortex/commits/<head-sha>/check-runs?per_page=100" \
  --jq '.check_runs[] | "\(.conclusion)\t\(.name)"' | sort

# 7. All required checks green → merge (squash; rebase is not allowed here)
gh pr merge <N> --squash --delete-branch
```

## What happens on PR merge?

1. **PR merged** into `main`
2. **`.github/workflows/auto-release.yml`** runs and does the whole release in one job:
   - gates on the **required-check set** read from the API at run time
     (`.github/scripts/release-required-gate.mjs`, #4488)
   - picks the bump type from the merged commits (`BREAKING CHANGE` / `feat:` / else patch)
   - writes the new version into `package.json` + `manifest.json`, updates `CHANGELOG.md`
   - builds the plugin, creates the tag and GitHub release, publishes the CLI to npm

There is no separate versioning workflow — `pr-auto-version.yml` has not existed since the
CI rewrite (Path 2 D0 cutover, 2026-04-22).

## Troubleshooting

### Merge button is disabled

A required check has not passed (or never reported). Read the per-check verdict with the
`check-runs` command in step 6 above; a required context with **no run at all** blocks the
merge just as a failing one does.

### A status check never appears

1. Verify the job name in `.github/workflows/ci.yml` matches the required context exactly —
   matrix jobs register as `job (value)`, e.g. `e2e-shard (3)`
2. Check the run actually started: <https://github.com/kitelev/exocortex/actions>
3. Ensure the workflow triggers on `pull_request`

### Emergency bypass

**Not recommended.** Prefer fixing forward in a feature branch. If a maintainer truly must
override, use `gh pr merge --admin` on the PR rather than disabling the rule — a disabled
rule has to be re-created by hand, and that is how a protection ends up configured from
memory instead of from its live state.

## References

- [`docs/reference/ci/required-checks.md`](../docs/reference/ci/required-checks.md) — required-check snapshot + the command that prints the live set
- [GitHub branch-protection docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Branch-protection REST API](https://docs.github.com/en/rest/branches/branch-protection)
