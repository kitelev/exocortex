# Branch Protection Setup Guide

This guide explains how to configure GitHub branch protection rules to prevent direct pushes to `main` and ensure all changes go through Pull Requests with required CI checks.

## Why Branch Protection?

In multi-instance AI development environment:
- **Prevents race conditions**: Only one PR can merge at a time
- **Ensures quality**: All CI checks must pass before merge
- **Eliminates version conflicts**: Automatic versioning happens sequentially
- **Linear history**: Rebase-only merges keep git history clean
- **Safe rollback**: Every change is a PR that can be reverted

## Required Status Checks

Before any PR can be merged to `main`, these checks MUST pass:

1. **build-and-test** - Type check, lint, build, unit tests, BDD coverage
2. **e2e-tests** - End-to-end tests in Docker environment

## Setup Methods

### Method 1: Automated Script (Recommended)

Run the provided script to configure branch protection via GitHub API:

```bash
# Navigate to project root
cd /Users/kitelev/Documents/exocortex

# Run setup script
.github/scripts/setup-branch-protection.sh
```

**Prerequisites:**
- GitHub CLI installed (`brew install gh`)
- Authenticated with GitHub (`gh auth login`)
- Admin access to repository

**What the script does:**
- ✅ Requires PR before merging to main
- ✅ Requires `build-and-test` and `e2e-tests` to pass
- ✅ Requires branches to be up to date before merging
- ✅ Requires linear history (rebase-only merges)
- ✅ Enforces rules for administrators (no bypass)
- ✅ Dismisses stale PR approvals on new commits
- ✅ Blocks direct pushes to main

**Repository merge settings (configured separately):**
- ✅ Rebase merge enabled
- ❌ Squash merge disabled
- ❌ Merge commits disabled

### Method 2: Manual Configuration via GitHub UI

If you prefer manual setup:

1. Go to **Repository Settings**
   ```
   https://github.com/kitelev/exocortex/settings
   ```

2. Navigate to **Branches** in left sidebar

3. Click **Add branch protection rule**

4. Configure:
   - **Branch name pattern**: `main`

   - **☑ Require a pull request before merging**
     - **☑ Dismiss stale pull request approvals when new commits are pushed**
     - **Required number of approvals**: `0` (for AI agents)

   - **☑ Require status checks to pass before merging**
     - **☑ Require branches to be up to date before merging**
     - **Status checks that are required**:
       - Search and add: `build-and-test`
       - Search and add: `e2e-tests`

   - **☑ Do not allow bypassing the above settings**
     - Ensures even admins follow the rules

5. Click **Create** or **Save changes**

## Verification

After setup, verify branch protection is active:

```bash
# Check protection status via CLI
gh api /repos/kitelev/exocortex/branches/main/protection

# Or visit web UI
open https://github.com/kitelev/exocortex/settings/branches
```

You should see:
- **Branch protection rule** badge next to `main` branch
- **Required status checks**: build-and-test, e2e-tests
- **Require pull request** enabled

## Testing Branch Protection

Try to push directly to main:

```bash
git checkout main
echo "test" >> README.md
git commit -am "test: direct push"
git push origin main
```

**Expected result:**
```
remote: error: GH006: Protected branch update failed
To github.com:kitelev/exocortex.git
 ! [remote rejected] main -> main (protected branch hook declined)
error: failed to push some refs
```

✅ **This is correct!** Branch protection is working.

## AI Agent Workflow After Branch Protection

With branch protection enabled, AI agents MUST use this workflow:

```bash
# 1. Create feature branch in separate worktree
git worktree add ../exocortex-feature-name -b feature/description

# 2. Make changes
cd ../exocortex-feature-name
# ... code changes ...

# 3. Test locally
npm test:all

# 4. Commit (NO version bump needed!)
git commit -am "feat: description"

# 5. Push and create PR
git push origin feature/description
gh pr create --title "feat: description" --body "Details..."

# 6. Wait for CI checks (REQUIRED!)
gh pr checks --watch

# 7. If all GREEN ✅ - auto-merge (rebase only - linear history)
gh pr merge --auto --rebase

# 8. Version bump happens automatically via pr-auto-version.yml

# 9. Release created automatically via auto-release.yml
```

## What Happens on PR Merge?

1. **PR merged** to main
2. **pr-auto-version.yml** workflow triggered:
   - Detects change type (feat/fix/BREAKING)
   - Bumps version in package.json
   - Syncs manifest.json
   - Updates CHANGELOG.md
   - Commits changes to main
3. **auto-release.yml** workflow triggered:
   - Builds plugin
   - Creates GitHub release
   - Uploads artifacts

## Troubleshooting

### PR merge button is disabled

**Cause**: Required checks not passing or not completed

**Solution**:
```bash
# Check which checks are failing
gh pr checks

# View detailed status
gh pr view --json statusCheckRollup
```

Fix the failing tests and push:
```bash
# Fix the code
git commit --amend
git push --force-with-lease origin feature-branch

# Wait for checks again
gh pr checks --watch
```

### Status check not appearing

**Cause**: Check name mismatch or workflow not running

**Solution**:
1. Verify workflow file names match required checks
2. Check workflow ran: `https://github.com/kitelev/exocortex/actions`
3. Ensure workflow triggers on `pull_request` events

### Want to bypass for emergency

**NOT RECOMMENDED** but if absolutely necessary:

1. Temporarily disable branch protection
2. Push urgent fix
3. Re-enable branch protection IMMEDIATELY
4. Create follow-up PR to test the fix properly

Better approach: Fix in feature branch, use `gh pr merge --admin` if you have override permissions.

## Maintenance

Branch protection rules are persistent. No maintenance needed unless:
- Adding new required checks (update via script or UI)
- Changing CI workflow job names (update required checks)
- Removing deprecated checks

## References

- [GitHub Branch Protection Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub CLI Manual](https://cli.github.com/manual/)
- [Status Checks API](https://docs.github.com/en/rest/checks)
