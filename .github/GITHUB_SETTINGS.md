# GitHub Repository Settings

## Automated Configuration (Completed)

### 1. Workflow Triggers for Draft PRs

**Status:** ✅ Configured

**File:** `.github/workflows/ci.yml`

**Changes:**
```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches:
      - main
```

**Effect:** CI workflows now trigger automatically on:
- `opened` - When PR is created (including Draft)
- `synchronize` - When new commits are pushed
- `reopened` - When closed PR is reopened
- `ready_for_review` - When Draft PR is marked ready

### 2. Merge Strategy Configuration

**Status:** ✅ Configured via GitHub API

**Settings Applied:**
```json
{
  "allow_merge_commit": false,
  "allow_squash_merge": true,
  "allow_rebase_merge": false,
  "allow_auto_merge": true
}
```

**Effect:**
- ✅ **Squash merge ONLY** - All commits combined into single new commit
- ✅ **Combined with `required_linear_history: true`** - Ensures linear history (no merge commits)
- ✅ **Combined with `strict: true`** - Requires branch to be up-to-date before merge (manual rebase needed)
- ❌ **Regular rebase disabled** - Only squash merge allowed
- ❌ **Merge commits disabled** - No merge bubbles in history
- ✅ **Auto-merge enabled** - PRs can be auto-merged when checks pass

**What actually happens during squash merge:**
1. GitHub creates a NEW commit on top of main with combined changes
2. This is NOT a git rebase - it's a new commit
3. Linear history is maintained (no merge commit branches)

**Developer workflow:**
```bash
# If main has changed, manually update your branch:
git fetch origin main
git rebase origin/main
git push --force-with-lease

# Then squash merge (GitHub creates new commit on main)
gh pr merge --squash
```

### 3. Branch Protection Rules

**Status:** ✅ Already configured (no changes needed)

**Current Protection on `main` branch:**
```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build-and-test", "e2e-tests"]
  },
  "enforce_admins": true,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

**Effect:**
- ✅ **Required checks:** build-and-test + e2e-tests must pass
- ✅ **Strict mode:** Branch must be up-to-date with main before merge
- ✅ **Linear history:** Only rebase/squash merges allowed
- ✅ **Admins follow rules:** No bypass for administrators
- ❌ **Force push disabled:** Cannot rewrite main history
- ❌ **Deletions disabled:** Cannot delete main branch

### 4. GitHub Actions Permissions

**Status:** ✅ Configured

**Settings:**
```json
{
  "enabled": true,
  "allowed_actions": "all",
  "default_workflow_permissions": "read"
}
```

**Effect:**
- ✅ Actions enabled for all workflows
- ✅ All GitHub Actions allowed (no restrictions)
- ℹ️ Default permissions: read-only (workflows request specific permissions)

## Manual Configuration Required

### 5. Fork PR Workflow Approval Settings

**Status:** ⚠️ Cannot be configured via API (manual setup)

**Location:** Repository Settings > Actions > General > Fork pull request workflows

**Recommended Setting:**
- Select: **"Require approval for first-time contributors who recently created their account"**

  OR (for private repo / trusted contributors only):

- Select: **"Run workflows from fork pull requests" (no approval required)**

**Why:** This determines if fork PRs require manual approval before running workflows. Since this is your personal repository and you're the primary contributor, you likely want workflows to run automatically.

**Steps to configure:**
1. Go to: https://github.com/kitelev/exocortex/settings/actions
2. Scroll to "Fork pull request workflows from outside collaborators"
3. Select your preferred option (recommended: "first-time contributors" or "run automatically")

## Summary of Changes Made

### Automated Changes (via scripts)

1. **Modified:** `.github/workflows/ci.yml`
   - Added explicit PR event types to trigger on Draft PRs
   - No longer requires PR to be "ready for review" before running checks

2. **Updated via GitHub API:** Repository merge settings
   - Enabled squash merge (was disabled)
   - Kept rebase merge enabled
   - Kept merge commits disabled

### What Already Existed (no changes needed)

1. Branch protection on `main` with required checks
2. Linear history enforcement
3. Auto-merge capability
4. GitHub Actions enabled

### Manual Step Required

1. Configure fork PR workflow approval policy in web UI (see section 5 above)

## Verification Commands

To verify the configuration from command line:

```bash
# Check merge settings
gh api repos/kitelev/exocortex | jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge, allow_auto_merge}'

# Check branch protection
gh api repos/kitelev/exocortex/branches/main/protection | jq '{required_status_checks, required_linear_history, enforce_admins}'

# Check Actions permissions
gh api repos/kitelev/exocortex/actions/permissions | jq '{enabled, allowed_actions}'
```

## Expected Workflow Behavior

### Creating a Draft PR

```bash
# Create Draft PR
gh pr create --draft --title "feat: new feature" --body "WIP"

# Workflows trigger automatically (build-and-test + e2e-tests)
# No manual approval needed (you are the repo owner)
```

### Merging a PR

```bash
# If main has changed since you created the branch:
git fetch origin main
git rebase origin/main  # Manually rebase your branch
git push --force-with-lease

# Then squash merge
gh pr merge 123 --squash --auto

# Or let GitHub choose (will use squash as it's the only allowed method)
gh pr merge 123 --auto
```

**What happens during squash merge:**
1. ✅ GitHub creates NEW commit on top of main with all your changes
2. ✅ All your commits are combined into this one commit
3. ✅ Linear history is maintained (no merge commit branches)

**Note:** This is NOT git rebase - GitHub creates a new commit. If you want your commits rebased, do `git rebase origin/main` manually before merging.

**Requirements:**
- ✅ All checks must pass (build-and-test + e2e-tests)
- ✅ Branch must be up-to-date with main (`strict: true` enforces this)
- ✅ Linear history maintained (squash merge + no merge commits)
- ✅ Auto-merge when conditions met

## Rollback Instructions

If you need to revert these changes:

```bash
# Revert workflow changes
cd /Users/kitelev/Developer/exocortex-development/exocortex
git checkout HEAD~1 .github/workflows/ci.yml

# Revert merge settings (re-enable rebase, disable squash)
gh api -X PATCH repos/kitelev/exocortex \
  -f allow_squash_merge=false \
  -f allow_rebase_merge=true

# Note: Branch protection rules were not changed, no rollback needed
```

## References

- [GitHub Actions: Events that trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request)
- [GitHub: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub: About merge methods](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)
