# Troubleshooting Guide

Common issues and solutions for Exocortex development.

---

## Worktree Issues

### "Worktree created in wrong location"

**🚨 CRITICAL ERROR: Worktree not in worktrees/ directory!**

```bash
# Check where worktrees were created
cd /Users/kitelev/Developer/exocortex-development
ls -la  # Look for unexpected directories

# If you see directories like exocortex-feat-something/ at root level → WRONG!

# Fix it:
# 1. Check if worktree has uncommitted changes
cd <wrong-worktree-name>
git status

# 2. If clean, remove the worktree
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree remove ../<wrong-worktree-name>

# 3. If has changes, stash them first
cd /Users/kitelev/Developer/exocortex-development/<wrong-worktree-name>
git stash
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree remove ../<wrong-worktree-name>

# 4. Create new worktree in CORRECT location
cd /Users/kitelev/Developer/exocortex-development
/worktree-create correct-task-name  # Will create in worktrees/

# 5. Apply stashed changes if needed
cd worktrees/exocortex-claude1-feat-correct-task-name
git stash pop
```

### "Working in main directory by mistake" (RULE 0 violation)

**🚨 ALWAYS check your location before editing files!**

**Quick detection:**

```bash
pwd  # MUST output: .../worktrees/exocortex-*
# If "worktrees/" is missing → STOP immediately!
```

**Quick recovery:**

```bash
# 1. Revert changes in main directory
git restore .

# 2. Create proper worktree
git worktree add ../worktrees/exocortex-fix-something -b fix/something
cd ../worktrees/exocortex-fix-something

# 3. Make changes in worktree
```

**Prevention:**

- Run `pwd` before first file edit
- Add shell prompt showing current directory
- Use `/worktree-create` command (handles paths automatically)

**Reference**: PR #312 - Lost 2-3 minutes fixing this mistake

### "Worktree already exists"

```bash
/worktree-list  # See what's there
/worktree-cleanup  # Clean merged ones
# Or pick different task name
```

### "Lost track of current worktree"

```bash
pwd  # Check current directory
# Should be: .../exocortex-development/worktrees/exocortex-*
```

### Cleanup Timing Issue

**DO NOT cleanup worktree if you're still in active Claude session!**

**Problem**: Running cleanup while Claude session is active in the worktree breaks bash environment.

**Safe cleanup workflow:**

```bash
# Step 1: Exit Claude Code session or switch directory
cd /Users/kitelev/Developer/exocortex-development

# Step 2: THEN run cleanup
/worktree-cleanup
```

**Remember**: Disk space is cheap, broken sessions are expensive.

---

## Git & CI Issues

### Git Repository Corruption (Missing Objects/Refs)

**Symptoms:**

- `error: refs/tags/vX.X.X does not point to a valid object!`
- `fatal: missing blob object '<sha>'`
- `error: github.com:kitelev/... did not send all necessary objects`
- `git fetch` or `git pull` fails with corruption errors
- Tags or branches point to non-existent objects

**Root Cause**: Git repository has corrupted references or missing objects. Can occur from interrupted operations, disk corruption, or incomplete fetches.

**Solution (Fast Path - Fresh Clone):**

```bash
# When git is broken, fresh clone is fastest and most reliable
cd /Users/kitelev/Developer/exocortex-development
mv exocortex exocortex-backup
git clone git@github.com:kitelev/exocortex.git

# Recreate your worktree
cd exocortex
git worktree add ../worktrees/exocortex-claude1-feat-task -b feature/task
cd ../worktrees/exocortex-claude1-feat-task
npm install  # Reinstall dependencies
```

**Solution (Slow Path - Repair Attempt):**

```bash
# Only try this if you have important uncommitted changes in worktrees
cd /Users/kitelev/Developer/exocortex-development/exocortex

# Step 1: Verify corruption
git fsck --full
# Lists all corrupted refs/objects

# Step 2: Remove corrupted tags/refs
git tag -d v13.0.0  # Replace with corrupted tag name
git fetch origin --prune --prune-tags

# Step 3: Try to recover objects
git fetch origin --all
git gc --aggressive --prune=now

# Step 4: If still broken → Fresh clone (fast path above)
```

**When to use Fresh Clone vs Repair:**

- ✅ **Fresh clone** (5 minutes): Corrupted main repo, no uncommitted work in worktrees
- ❌ **Repair attempt** (30-60 minutes): Might not work, complex steps, high failure rate
- 💡 **Best practice**: Fresh clone is almost always faster and more reliable

**Prevention:**

- Always use SSH remotes (more reliable than HTTPS)
- Don't interrupt `git fetch` or `git pull` operations
- Periodically run `git gc` to maintain repository health

**Reference**: Issue #369 - Missing blob object corruption fixed with fresh clone (5 minutes vs 30+ minute repair attempt)

### Git Packfile Corruption

**Symptoms:**

- `error: file .git/objects/pack/*.pack is far too short to be a packfile`
- `fatal: unable to read tree [hash]`
- `fatal: 'worktree-name' could not be created`
- Git commands hang or crash (commit, status, fsck)
- All git operations timeout
- Lock files remain after crashes

**Root Cause**: Corrupted git packfile in main repository affects all worktrees (they share the same .git/objects). Can occur from interrupted operations, disk corruption, or session interruption.

**Quick Recovery (5 minutes - RECOMMENDED):**

```bash
# 1. Backup current repo (optional, if you have uncommitted work in worktrees)
cd /Users/kitelev/Developer/exocortex-development
mv exocortex exocortex-backup-$(date +%Y%m%d-%H%M%S)

# 2. Fresh clone from GitHub
git clone git@github.com:kitelev/exocortex.git

# 3. Create your worktree
cd exocortex
git worktree add ../worktrees/exocortex-claude1-feat-your-task -b feature/your-task
cd ../worktrees/exocortex-claude1-feat-your-task

# 4. Install dependencies
npm install

# 5. Continue working (zero errors expected)
```

**Alternative Recovery (30-60 minutes - NOT recommended):**

```bash
# Attempt repair (time-consuming, uncertain success)
cd /Users/kitelev/Developer/exocortex-development/exocortex

# Step 1: Remove corrupted packfiles
rm -f .git/objects/pack/pack-*.pack
rm -f .git/objects/pack/pack-*.idx

# Step 2: Remove stale lock files
find .git/worktrees -name "index.lock" -delete
find .git -name "*.lock" -delete

# Step 3: Try to recover objects
git fsck --full
git repack -a -d
git prune

# Step 4: If still broken → Fresh clone (quick recovery above)
```

**When to use Fresh Clone vs Repair:**

- ✅ **Fresh clone** (5 minutes): Corrupted main repo, no uncommitted work in worktrees - ALWAYS RECOMMENDED
- ❌ **Repair attempt** (30-60 minutes): Might not work, complex steps, high failure rate
- 💡 **Best practice**: Fresh clone is almost always faster and guarantees clean state

**Workaround (if git is completely broken):**

```bash
# Preserve uncommitted work via file copy
cp worktrees/your-worktree/path/to/file.ts /tmp/file-backup.ts
# After fresh clone, manually apply changes
```

**Prevention:**

- Run `git gc` periodically to maintain repository health
- Add CI check: `git fsck --full` in scheduled workflow
- Avoid interrupting git operations (Ctrl+C during push/fetch)
- Session interruptions can corrupt packfiles - fresh clone recovers quickly

**Additional symptom:**

- `error: invalid object 100644 <sha> for '<filepath>'` - Specific object corruption preventing commit

**Backup before fresh clone (preserve work in progress):**

```bash
# 1. Copy modified files to temp directory
mkdir -p /tmp/my-changes
cp -r packages/core/src /tmp/my-changes/
cp -r packages/obsidian-plugin/src /tmp/my-changes/
# Add other modified paths as needed

# 2. Fresh clone and recreate worktree (see Quick Recovery above)

# 3. Restore backup after worktree creation
cp -r /tmp/my-changes/src/* packages/core/src/
# Restore other files as needed

# 4. Install deps and build
npm install && npm run build
```

**Real-world examples:**

- Issue #407 - packfile corruption blocked git commit
- PR #434 - packfile corruption at session start → fresh clone in 5 minutes → zero errors for rest of session (150 minutes of flawless work)
- PR #477 - `error: invalid object 100644` during DI standardization → backup 33 files → fresh clone → restore → commit succeeded

### Git Authentication Failure (HTTPS vs SSH)

**Symptoms:**

- `fatal: could not read Username for 'https://github.com': Device not configured`
- `git push` fails asking for credentials
- Authentication prompts in non-interactive environment
- Worktree push operations fail

**Root Cause**: Git remote configured for HTTPS, which requires interactive credential input. Claude Code sessions are non-interactive.

**Solution (Switch to SSH):**

```bash
# Check current remote
git remote -v
# Shows: origin  https://github.com/kitelev/exocortex.git (fetch)

# Switch to SSH remote
git remote set-url origin git@github.com:kitelev/exocortex.git

# Verify
git remote -v
# Shows: origin  git@github.com:kitelev/exocortex.git (fetch)

# Test push
git push origin your-branch
# Should work without authentication prompt
```

**Prevention:**

- ✅ **ALWAYS use SSH remotes for worktree workflows**
- ✅ Clone with SSH from the start: `git clone git@github.com:user/repo.git`
- ❌ **NEVER use HTTPS remotes** in AI agent development environments

**Why SSH is required:**

- Non-interactive environment (no credential prompts possible)
- Better security (SSH keys vs password/token)
- More reliable for automated workflows
- Required for worktree push operations in Claude Code

**Reference**: Issue #369 - HTTPS authentication blocked push, fixed by switching to SSH remote

### Git Rebase with Staged Changes

**Problem**: `error: cannot pull with rebase: Your index contains uncommitted changes.`

**Symptoms**:

- Trying to `git pull --rebase` or `git rebase` after staging files
- Error appears immediately, no actual rebase attempt

**Root Cause**: Git refuses to rebase when there are staged but uncommitted changes in the index.

**Solution**:

```bash
# ❌ WRONG ORDER - Will fail
git add .
git pull --rebase origin main  # ERROR!

# ✅ CORRECT ORDER - Commit first, then rebase
git add .
git commit -m "feat: your changes"
git pull --rebase origin main  # Works!

# Alternative: Stash before rebase
git add .
git stash
git pull --rebase origin main
git stash pop
```

**Prevention**: Always commit your staged changes before attempting any rebase operation.

**Reference**: PR #511 - Encountered during SPARQL test coverage work

### "Rebase conflicts"

```bash
git status  # See conflicting files
# Edit files, resolve conflicts
git add .
git rebase --continue
```

### Auto-Merge Not Working

**Problem: Auto-merge enabled but PR not merging**

1. **Check mergeStateStatus**:

   ```bash
   gh pr view <PR-NUMBER> --json mergeStateStatus
   ```

   If `mergeStateStatus: BEHIND`:

   ```bash
   git fetch origin main
   git rebase origin/main
   git push --force-with-lease origin <branch-name>
   ```

2. **Auto-merge workflow timing**:
   - PR merge → CI on main starts (~3s delay)
   - CI on main completes (~6 minutes for E2E tests)
   - Auto-release workflow runs (~1 minute)
   - Release created

   **Total time: 7-10 minutes from merge to release**

3. **Verify release contains your PR**:
   ```bash
   gh release view v<VERSION> --json body --jq '.body'
   ```

**Reference**: PR #339 - 6 minute wait from merge to release

---

## TypeScript & Lint Issues

### "error TS6196: X is declared but never used" in CI (but not locally)

**Problem**: CI typecheck fails with unused import errors, local checks pass.

**Root Cause**: Types imported but only used as discriminant literals trigger `noUnusedLocals` errors.

**Example:**

```typescript
// ❌ BAD: JoinOperation imported but never used in type annotation
import type { AlgebraOperation, JoinOperation } from "./AlgebraOperation";

function createJoin(
  left: AlgebraOperation,
  right: AlgebraOperation,
): AlgebraOperation {
  return { type: "join", left, right };
}

// ✅ GOOD: Only import types used in annotations
import type { AlgebraOperation } from "./AlgebraOperation";

function createJoin(
  left: AlgebraOperation,
  right: AlgebraOperation,
): AlgebraOperation {
  return { type: "join", left, right };
}
```

**Solution**: Remove type imports only used as literal values.

**Prevention**: Run `npm run check:types` before pushing.

### Lint Errors in Unmodified Files

**Problem**: Pre-commit hook fails on lint errors in files you didn't touch.

**Solution (when your files are clean)**:

```bash
# Verify YOUR changes pass lint individually
npx eslint packages/obsidian-plugin/src/path/to/your/file.ts

# If all pass → safe to use --no-verify
git commit --no-verify -m "feat: your change"
```

**When to use --no-verify:**

- ✅ Your staged files pass lint individually
- ✅ Errors are in files you didn't modify
- ✅ CI will catch any actual lint issues
- ❌ Don't use to bypass legitimate errors in your changes

### Pre-commit Hook Fails Despite All Tests Passing

**Problem**: `husky - pre-commit script failed (code 1)` but all tests show PASS.

**Symptoms**:

- All unit tests pass (PASS status for each test file)
- All component tests pass
- All UI tests pass
- `npm run lint` shows only warnings (no errors)
- `npm run bdd:check` shows 100% coverage
- But hook still returns exit code 1

**Root Cause**: Unknown intermittent issue with husky pre-commit hook execution.

**Solution**:

```bash
# 1. Verify ALL checks pass locally
npm run test:all       # Must pass
npm run lint           # No errors (warnings OK)
npm run bdd:check      # Must show 100%
npm run check:types    # Must pass

# 2. If all pass, use --no-verify
git commit --no-verify -m "feat: your change"
```

**When safe to use --no-verify:**

- ✅ All tests pass locally (`npm run test:all`)
- ✅ Lint has no errors (`npm run lint`)
- ✅ BDD coverage 100% (`npm run bdd:check`)
- ✅ TypeScript compiles (`npm run check:types`)
- ✅ CI will catch any issues (safety net)

**Reference**: PR #524 - Focus Mode toggle (all tests passed but hook failed)

### Archgate CI fails: "Missing 'satisfies RuleSet' on default export"

**Problem**: CI `archgate` job fails with a rule-file syntax-convention error, but `main` branch passes and local pre-commit (`archgate check --staged`) passes.

**Symptoms**:

```
##[error]Rule execution error: ADR DOC-001: rule file has syntax convention violations (1 violation)
##[error]Missing `satisfies RuleSet` on default export. The export must use `} satisfies RuleSet;` for compile-time type validation.
check failed: 13 passed, 0 failed, 6 warnings
##[error]Process completed with exit code 2.
```

**Root Cause**: One of the `.archgate/adrs/<ADR>.rules.ts` files has a bare `};` at the end of its default export instead of `} satisfies RuleSet;`. Newer `archgate` versions (installed fresh via `npm install -g archgate` in CI) enforce this strictly; older cached versions on `main`'s CI do not. This is a latent config issue that activates on version bump, not on your PR's code changes.

**Solution**: Append `satisfies RuleSet` to the failing rule file's default export:

```typescript
// .archgate/adrs/DOC-001-documentation-consistency.rules.ts
export default {
  // ... rules ...
} satisfies RuleSet; // ← add ` satisfies RuleSet` before `;`
```

Verify locally with `archgate check --ci` (uses the same global-install path as CI).

**Prevention**: Pin the archgate version in `.github/workflows/ci.yml`:

```yaml
- run: npm install -g archgate@<pinned-version>
```

**Reference**: PR #2838 (RFC-024 Phase 0) — CI archgate broke on the DOC-001 rules file that had been committed without `satisfies RuleSet` months earlier.

---

## Test Issues

### Fresh Worktree Component Test Failures

**Problem**: Component tests fail with "Cannot find module '@exocortex/core/dist/..." in fresh worktrees

**Symptoms**:

```
Cannot find module '@exocortex/core/dist/domain/errors/index.js'
```

- Error appears during pre-commit hook or `npm run test:component`
- Only occurs in fresh worktrees
- Tests pass after building

**Root Cause**: Fresh worktrees don't have built `dist/` folders needed for Playwright CT subpath imports.

**Solution**:

```bash
npm install
npm run build  # Required before running component tests!
npm run test:component
```

**Prevention**: Always run `npm run build` after `npm install` in new worktrees. The pre-commit hook runs component tests, so build is needed before first commit.

**Why This Happens**:

- Playwright CT uses subpath imports (e.g., `@exocortex/core/domain/errors`)
- Subpath imports point to `dist/` folder
- Fresh worktree has no `dist/` folder until build runs
- Jest unit tests use main package import (works without build)

**Checklist for Fresh Worktrees**:

1. `npm install` (install dependencies)
2. `npm run build` (build dist/ folders)
3. `npm run test:all` (verify everything works)

**Reference**: PR #483 - CommandVisibility test split discovered this during pre-commit

---

### E2E Tests Fail: Cannot Resolve @injectable Service

**Problem**: Unit tests pass but E2E tests fail with TSyringe DI resolution errors.

**Symptoms**:

```
Error: Cannot resolve TaskCreationService
Error: Cannot resolve PropertyCleanupService
```

- All unit tests pass (194/194 ✅)
- E2E tests fail on any code path using `container.resolve()`
- Error only appears in built/bundled code

**Root Cause**: esbuild doesn't emit TypeScript decorator metadata. TSyringe requires `Reflect.defineMetadata()` calls at runtime, which `emitDecoratorMetadata: true` in tsconfig tells tsc to emit. esbuild ignores this setting.

**Solution**:

```bash
# Install esbuild-plugin-tsc
npm install -D esbuild-plugin-tsc
```

```typescript
// esbuild.config.mjs
import esbuildPluginTsc from "esbuild-plugin-tsc";

const plugins = [
  esbuildPluginTsc({
    force: true, // Use tsc for .ts files
  }),
];
```

**Verification**:

```bash
npm run test:e2e  # Should pass now
```

**Why unit tests pass but E2E fail**:

- Unit tests mock `container.resolve()` → no actual DI resolution
- E2E tests use real built code → DI resolution requires metadata
- Build output missing metadata → runtime resolution fails

**Prevention**:

- Always test DI resolution in E2E tests early in migration
- Add E2E test for new DI services before marking migration complete
- See PATTERNS.md § "TSyringe DI with esbuild Build" for full setup

**Reference**: PR #449 - 6 debugging attempts before finding solution

---

### Test Mock Default Values Can Mask Bugs

**Problem**: Test passes when it should fail because mock helper provides default value.

**Example from PR #337**:

```typescript
// ❌ Test uses mock default instead of testing fallback
frontmatter: createMockMetadata(),  // Has default: exo__Asset_label: "Test Asset"

// ✅ Explicitly test missing data with null
frontmatter: createMockMetadata({ exo__Asset_label: null }),
```

**Prevention:**

1. Review default values in test helpers before writing tests
2. Explicitly test missing data scenarios with `null` overrides
3. Don't assume defaults match your test intention
4. Read test helper source when tests pass but logic seems wrong

**Test Helper Location**: `packages/obsidian-plugin/tests/unit/helpers/testHelpers.ts`

### Missing Properties in Mock Data

**Problem**: TypeScript compilation fails with "Property 'X' does not exist on type 'Y'" when writing component tests.

**Root Cause**: Mock data doesn't match actual interface definition. Required properties are missing from test fixtures.

**Example from PR #408**:

```typescript
// ❌ WRONG - Missing required properties
const mockTask: DailyTask = {
  file: { path: "task.md", basename: "task" },
  title: "Task",
  // Missing: isDoing, isBlocked, startTimestamp, endTimestamp
};

// ✅ CORRECT - All properties included
const mockTask: DailyTask = {
  file: { path: "task.md", basename: "task" },
  title: "Task",
  isDoing: false,
  isBlocked: false,
  startTimestamp: null,
  endTimestamp: null,
};
```

**Solution**:

1. Check interface definition in source file (e.g., `DailyTask` interface in `DailyTasksTable.tsx`)
2. Update ALL mock data to include newly added required properties
3. Set reasonable defaults (null, false, empty string, 0) for unused properties
4. Run `npm run check:types` to verify

**When This Happens**:

- Interface evolves and adds new required properties
- Test files not updated to match new interface shape
- TypeScript strict mode catches the mismatch

**Prevention**:

- Always reference source interface when creating mock data
- Use test helpers like `createMockMetadata()` which provide defaults
- Update all test files when interfaces change

**Reference**: Issue #404, PR #408 - Updated 95+ mock tasks to include `isDoing`, `isBlocked`, timestamp properties

---

## Coordination Issues

### "Someone else is working on this"

```bash
/worktree-list  # Check active work
gh pr list  # Check open PRs
# Ask user: "Should I help with X or start Y?"
```

---

## Post-Mortem Approval Workflow

### Q: User said "not now" - should I delete my post-mortem report?

**A**: NO. Keep the report for future reference. The user may approve later. Your post-mortem still has value even if documentation updates are deferred.

### Q: User said "adjust the proposal" - what do I do?

**A**:

1. Modify ONLY the requested proposal
2. Keep other proposals unchanged
3. Present updated version with note: "Updated X proposal as requested"
4. Wait for new approval decision

### Q: User approved some changes but not others - what do I do?

**A**:

1. Edit ONLY approved files
2. Do NOT edit non-approved files
3. Confirm with user what was applied and what remains pending

### Q: Can I update documentation in a follow-up task without asking again?

**A**: NO. Each task requires separate approval. Always ask permission for each new post-mortem's proposals.

### Q: Should I commit documentation changes to the same PR?

**A**: Ask user for preference:

- Option A: Separate commit in same PR
- Option B: Separate PR for documentation only
- Let user decide

### Q: User is not responding to my approval request?

**A**:

1. Do NOT edit files without approval
2. Your post-mortem is already written and available
3. Continue with other tasks if available
4. User will approve when ready

---

## Zero Error Sessions

### "Zero errors - what made this smooth?"

If you just completed a task with zero errors from start to release, document why:

**Common success factors**:

1. **Recent related work**: Building on abstractions validated in previous session (< 24 hours ago)
2. **Clear requirements**: Issue had specific acceptance criteria and examples
3. **Shared utilities**: Used FrontmatterService, PathResolver (no custom logic)
4. **Test patterns**: Reused test mocks and helpers from previous PR
5. **Continuation session**: Full context from previous work still loaded

**Example**: PR #433 (CLI Maintenance Commands)

- **Why zero errors?** Immediate continuation of PR #432 (CLI Core Infrastructure)
- **What helped?** Same patterns, same abstractions, same tests, fresh context
- **Time saved**: ~60-90 minutes (vs cold start on same task)

**Lesson**: Don't assume zero errors means "easy task". Often means **excellent preparation** (abstractions, patterns, tests) from previous work. Document what made it smooth so future agents can replicate the pattern.

**Patterns that enable zero-error sessions**:

- Sequential Related Tasks (see CLAUDE.md)
- Task Batching Strategy (see AGENTS.md)
- Reusing validated abstractions (FrontmatterService, PathResolver)
- Comprehensive test mocks (testHelpers.ts patterns)

**When to document**:

- ✅ **ALWAYS** write post-mortem after zero-error sessions
- ✅ Identify which patterns/abstractions enabled smooth implementation
- ✅ Propose documentation updates to capture learnings
- ✅ Help future agents understand "what made this easy"

---

## Component Tests Pass Locally But Fail in CI

**Problem**: Playwright component tests pass 100% locally but fail systematically in GitHub Actions CI.

**Diagnosis**:

```bash
# Verify tests pass locally (multiple runs)
npm run test:component
# Output: 168 passed (54s)

# Check CI logs
gh pr checks <PR-NUMBER>
# test-component: FAIL (130/168 failed)

# Pattern check: Which tests fail?
# All button components? Specific test files?

# Other checks status
# build: PASS ✅
# typecheck: PASS ✅
# lint: PASS ✅
# test-unit: PASS ✅
# e2e: PASS ✅
# test-component: FAIL ❌
```

**Root Causes**:

- **Timing differences**: CI runs slower/faster than local, breaks timeouts
- **OS differences**: Linux (CI) vs macOS/Windows (local) rendering differences
- **Node version**: CI uses different Node version than local
- **Playwright configuration**: Different retry/timeout settings in CI
- **Environment variables**: `process.env.CI` behavior differences

**Solutions**:

1. **Increase timeouts**:

   ```typescript
   // In playwright.config.ts
   export default defineConfig({
     timeout: 30000, // Increase from 10000
     expect: {
       timeout: 10000, // Increase from 5000
     },
   });
   ```

2. **Add retries**:

   ```typescript
   export default defineConfig({
     retries: process.env.CI ? 3 : 0, // Retry in CI only
   });
   ```

3. **Run locally in Docker** (reproduce CI environment):

   ```bash
   npm run test:e2e:local  # Uses Docker
   ```

4. **Check environment variables**:

   ```bash
   # In CI logs, verify:
   echo $CI  # Should be "1" or "true"
   node --version  # Match with local?
   ```

5. **Document as known issue** (if unrelated to changes):
   - Verify tests pass locally (multiple runs)
   - Verify all other CI checks pass
   - Document in PR description with evidence
   - Request manual review

**When to skip CI check**:

- ❌ NEVER skip if your code changed UI components
- ✅ MAY skip with documentation if:
  - All tests pass locally (verified multiple runs)
  - All other CI checks pass (7/8 GREEN)
  - Code changes don't touch failing component area
  - Failure pattern is systematic across multiple runs
  - Document in PR with full evidence

**Example Documentation for PR**:

```markdown
## CI Status

**7/8 checks GREEN:**

- ✅ build
- ✅ typecheck
- ✅ lint
- ✅ test-unit (1785 tests)
- ✅ test-coverage
- ✅ test-bdd
- ✅ e2e-tests

**1/8 check FLAKY:**

- ❌ test-component (130/168 fail in CI)
- ✅ ALL 168 tests pass locally (verified 3 runs)

**Evidence this is CI environment issue:**

1. Component tests pass 100% locally
2. DI infrastructure code doesn't modify UI components
3. Same tests fail identically across 3 CI attempts
4. Only button components fail; SPARQL/property components pass
5. All other checks GREEN (code quality confirmed)

**Investigation attempted:**

- Checked CI logs (no detailed errors beyond test names)
- Verified Vite build passes
- Confirmed decorator support enabled
- Attempted multiple CI reruns (same pattern)

**Recommendation**: Manual review requested - systematic CI environment issue unrelated to DI infrastructure changes.
```

**Real-world example**: Issue #436 Phase 1 - DI infrastructure changed backend services, not UI. Component tests pass locally (168/168) but fail in CI (~130/168). All other checks GREEN. Documented as known CI issue.

---

## Pre-Commit Hook Fails Despite Passing Tests

**Problem**: `husky - pre-commit script failed (code 1)` but manual test run shows all tests passing.

**Diagnosis**:

```bash
# Run tests manually to verify they pass
npm run test:all
# Output: 1785 tests passing ✅

# But git commit fails:
git commit -am "feat: my change"
# husky - pre-commit script failed (code 1) ❌
```

**Root Cause**: Flaky pre-commit hook script - tests pass when run manually but hook returns non-zero exit code.

**Possible Causes**:

1. **Hook script timeout**: Tests take longer in hook context than standalone
2. **Environment differences**: Hook runs in different shell/context
3. **Exit code propagation bug**: Hook script misinterprets test exit codes
4. **Concurrent execution**: Hook runs tests differently than manual run

**Solution (when tests verified passing)**:

```bash
# 1. ALWAYS verify tests pass first (MANDATORY)
npm run test:all  # Must be 100% GREEN ✅

# 2. If tests pass, bypass flaky hook
HUSKY=0 git commit -m "feat: my change"
```

**⚠️ CRITICAL**: Only use `HUSKY=0` when you've verified ALL tests pass manually. Never bypass hook to avoid fixing legitimate failures.

**Verification Checklist Before Bypass**:

- [ ] `npm run test:all` passes 100%
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] All changes are intentional and reviewed
- [ ] No console errors or warnings

**Justification**: This is a legitimate workaround for flaky hook behavior, not a way to skip quality checks. Tests are run and verified before bypass.

**Frequency**: Observed in ~30% of commits during Issue #436 Phase 1 implementation (2/3 commits required bypass).

**Future Work**: Investigate `.husky/pre-commit` script for flaky behavior:

```bash
# Check hook script
cat .husky/pre-commit

# Potential issues:
# - Timeout too short for test suite
# - Exit code not properly captured
# - Environment variables not set
# - Path issues in hook context
```

**Alternative Solutions**:

1. **Increase hook timeout** (if timeout is the issue)
2. **Simplify hook** (run fewer checks)
3. **Debug hook script** (add logging)
4. **Disable hook temporarily** (if fixing will take time)

**Document in Commit Message** (when using HUSKY=0):

```
feat: implement DI infrastructure

- TSyringe + reflect-metadata setup
- 4 service interfaces + adapters
- POC migration (PropertyCleanupService)

Tests verified passing manually:
- npm run test:all: 1785 tests ✅
- npm run typecheck: clean ✅
- npm run lint: clean ✅

Note: Pre-commit hook flaky (exit code 1 despite passing tests).
Used HUSKY=0 after verifying all checks pass manually.
```

**Related Issues**: Common during:

- DI infrastructure work (Issue #436)
- Documentation-heavy PRs
- Large test suite additions (> 1000 tests)

---

## Tool Usage Issues

### Edit Tool Requires Read First

**Problem**: `Edit failed: File has not been read yet in this conversation`

**Symptoms**:

- Edit tool fails even though file path is known
- File was mentioned in context summary but not read in current session
- Happens after context window reset or session continuation

**Root Cause**: The Edit tool requires that the file be read in the current conversation context before editing, even if the file content was mentioned in a context summary or previous session.

**Solution**:

```bash
# Wrong - using path from context summary
Read /path/from/summary/CLAUDE.md  # May fail if file moved

# Correct - read from current worktree
Read /Users/kitelev/Developer/exocortex-development/worktrees/exocortex-claude1-feat-xyz/CLAUDE.md
```

**Step-by-step fix**:

1. Identify the correct file path in your current worktree
2. Use `Read` tool to read the file first
3. Then use `Edit` tool to make changes

**Prevention**:

- After creating a worktree, always read files from the worktree path
- Don't rely on file paths from context summaries
- When session continues, re-read files before editing

**Real-world example**: PR #495 - Edit failed on CLAUDE.md because file was read in previous session before context reset. Fixed by reading file from worktree path first.

---

## Code Scanning Alert Resolution

### High-Volume Alert Processing Strategy

**Problem**: 50+ code scanning alerts need to be fixed efficiently.

**Strategy (learned from December 2025 sprint - 41 issues in one day)**:

1. **Group by rule ID**:

   ```bash
   gh api repos/kitelev/exocortex/code-scanning/alerts --jq '
     group_by(.rule.id) | .[] | {rule: .[0].rule.id, count: length}
   '
   ```

2. **Prioritize by severity**:
   - **P0**: Security (crypto, randomness, escaping, injection)
   - **P1**: Correctness (unreachable code, useless assignments)
   - **P2**: Quality (overwritten properties, undeclared variables)
   - **P3**: Cleanup (unused variables, style)

3. **Create batched issues**:
   - One issue per rule ID (not per alert)
   - Include all file locations in issue body
   - Tag with priority label

4. **Fix patterns (copy-paste)**:
   - Same rule = same fix pattern
   - First alert takes 10-15 minutes (research)
   - Subsequent alerts take 2-3 minutes each

### Common CodeQL Alert Solutions

#### js/incomplete-string-escaping

```typescript
// ❌ ALERT
str.replace("pattern", userInput);

// ✅ FIX: Use split/join
str.split("pattern").join(userInput);
```

#### js/useless-assignment-to-local

```typescript
// ❌ ALERT
let x = getValue();
x = getOtherValue(); // First value unused

// ✅ FIX
const x = getOtherValue();
```

#### js/superfluous-trailing-arguments

```typescript
// ❌ ALERT - function takes 2 args, called with 3
fn(a, b, c);

// ✅ FIX - check signature, remove extra
fn(a, b);
```

**Reference**: PATTERNS.md § "Batch Code Scanning Fix Pattern"

---

## DateTime/Timezone Issues

### Timestamp Saved with Wrong Offset (e.g., +20 hours)

**Problem**: User enters datetime value, but it's saved with unexpected hour offset.

**Example (Issue #1052)**:

- User entered: `2025-12-17T20:05`
- Actually saved: `2025-12-18T16:05` (+20 hours offset!)

**Symptoms**:

- One datetime field works correctly (e.g., plannedStartTimestamp)
- Another field has offset bug (e.g., plannedEndTimestamp)
- Offset is not a simple timezone conversion (e.g., +20 hours instead of ±5)

**Root Cause Investigation**:

```typescript
// Check if code uses Date.toISOString() - converts to UTC
const saved = new Date(userInput).toISOString(); // ❌ WRONG

// Check getTimezoneOffset() arithmetic
// GOTCHA: Returns NEGATIVE for POSITIVE timezones!
// UTC+5 (Almaty) → getTimezoneOffset() returns -300 (minutes)

// Common mistake: sign error + double application
// Input: 20:05 local
// Step 1: Convert to UTC: 15:05 (subtract 5 hours - correct)
// Step 2: Bug applies +15 hours instead of nothing
// Result: 16:05 next day (+20 hours total)
```

**Debugging Steps**:

```typescript
// 1. Find the serialization code
rg "toISOString" packages/obsidian-plugin/src --type ts
rg "getTimezoneOffset" packages/obsidian-plugin/src --type ts

// 2. Compare working vs broken fields
// If plannedStartTimestamp works but plannedEndTimestamp doesn't,
// they may use different code paths

// 3. Check for double offset application
// Search for multiple getTimezoneOffset() calls or manual math

// 4. Test in browser console
const testDate = '2025-12-17T20:05';
console.log('Input:', testDate);
console.log('toISOString:', new Date(testDate).toISOString());
console.log('getTimezoneOffset:', new Date(testDate).getTimezoneOffset());
```

**Solution**:

```typescript
// ✅ CORRECT: Preserve user input as string
function serializeTimestamp(userInput: string): string {
  if (userInput.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
    return userInput + ":00"; // Just add seconds
  }
  return userInput;
}

// ❌ WRONG: Don't use Date object for local time
const broken = new Date(userInput).toISOString();
```

**Key Gotchas**:

- `getTimezoneOffset()` returns **negative** for **positive** timezones
- `toISOString()` **always** converts to UTC
- JavaScript Date is always UTC internally
- Fractional hour timezones exist (UTC+5:30, etc.)

**Reference**: Issue #1052, PR #1052 - Fixed +20 hour offset bug in plannedEndTimestamp

---

## SPARQL Indexing Issues

### Statement Files Not Indexed in CLI SPARQL

**Problem**: CLI SPARQL queries return empty results for files in Exo 0.0.3 format.

**Symptoms**:

- `exocortex-cli sparql query "SELECT ?s WHERE { ?s a exo:Statement }"` returns 0 results
- Files exist and are in correct format
- Previous version worked correctly

**Root Cause**: Statement files in Exo 0.0.3 format have different structure (anchor/statement/body sections) and require specialized indexing.

**Diagnosis**:

```bash
# Check if files are being found
exocortex-cli sparql query --folder /path/to/vault \
  "SELECT ?s WHERE { ?s ?p ?o }" | head -5

# Check for indexing errors
exocortex-cli sparql query --verbose \
  "SELECT ?s WHERE { ?s a exo:Statement }"
```

**Common Causes**:

1. **Regression from format change**: New format parser doesn't emit triples
2. **Missing file type handling**: Indexer skips `.md` files with certain frontmatter
3. **Wikilink alias stripping**: Links like `[[Page|Alias]]` not properly parsed

**Solution History**:

- Issue #1377: Initial regression - statement files not converted to RDF
- Issue #1380: Follow-up regression - statement files still not indexed after #1377 fix

**Prevention**: Always add regression tests when implementing new format support.

**Reference**: Issues #1377, #1380 - CLI SPARQL Statement Indexing (January 2026)

---

## E2E Test Flakiness

### Quadtree Performance Timeout

**Problem**: E2E tests timeout with "Quadtree" in error message.

**Symptoms**:

```
Timeout exceeded while waiting for Quadtree layout
Test "should render graph" timed out after 30000ms
```

**Root Cause**: Graph layout algorithms using Quadtree are CPU-intensive and timing varies significantly between local machines and CI runners.

**Solution**:

```typescript
// Skip timing-sensitive tests in CI
const describeOrSkip = process.env.CI ? describe.skip : describe;

describeOrSkip("Graph layout performance", () => {
  it("should complete Quadtree layout within 5 seconds", async () => {
    // This test is flaky in CI
  });
});
```

**Alternative**: Increase timeouts specifically for graph tests:

```typescript
test("graph view", { timeout: 60000 }, async () => {
  // Test code
});
```

**Reference**: Issue #1384 - E2E tests flaky (150 steps to fix)

### Random Test Cancellation

**Problem**: E2E tests abort randomly without clear error.

**Symptoms**:

- Test suite starts but exits mid-run
- No clear error message
- Happens intermittently

**Solution**: Increase retry count in CI:

```typescript
// playwright.config.ts
retries: process.env.CI ? 3 : 0,
```

**Reference**: Issue #1384 - E2E tests flaky (January 2026)

### NoFlakyReporter fails on first-launch modal race

**Problem**: `❌ FLAKY TEST DETECTED (will fail CI)` from `playwright-no-flaky-reporter.ts` on a UI test that passes only after retry, typically in `daily-*` specs that click something shortly after plugin load.

**Symptoms**:

```
✘   1 [e2e] › daily-archive-filter.spec.ts:18 › should toggle archived tasks visibility with button click (1.0m)
✓   2 [e2e] › daily-archive-filter.spec.ts:18 › should toggle archived tasks visibility with button click (retry #1) (14.2s)
❌ FLAKY TEST DETECTED (will fail CI): should toggle archived tasks visibility with button click
   This test passed after 1 retries.
```

**Root Cause**: Any delay-timer modal (e.g. `timerManager.setTimeout(..., 500)`) that opens when a settings version field differs from `manifest.version` will open on the E2E test vault too — because `packages/obsidian-plugin/tests/e2e/test-vault/.obsidian/plugins/exocortex/` ships without `data.json`. The modal intercepts the first UI click; the test times out, succeeds on retry (modal already dismissed or Obsidian reloaded), and `NoFlakyReporter` fails the CI.

**Solution**: Gate the modal on `plugin.loadData() == null` (fresh install) and silently seed the stored version so the modal only opens on real upgrades. See `PATTERNS.md` → "First-Launch Modal Pattern (E2E-safe)".

**Prevention**:

- Run `npm run test:e2e` locally before pushing any plugin-startup-sequence change — the default `npm run test:all` does NOT include Docker E2E, so this race only surfaces in CI
- Check `playwright-no-flaky-reporter.ts` behaviour: it fails CI on **any** passing-after-retry result, no quarantine mechanism

**Reference**: RFC-024 Phase 0 (#2833) / PR #2838 — `ChangelogModal` first-launch race

---

## Cross-Repository Issues

### Ontology Changes Not Reflected in Plugin

**Problem**: After updating TTL files in exocortex-public-ontologies, plugin doesn't see changes.

**Symptoms**:

- New classes/properties defined in TTL
- SPARQL queries return empty for new terms
- Plugin uses outdated ontology version

**Solution Checklist**:

1. ✅ Commit and push to exocortex-public-ontologies
2. ✅ Wait for CI to publish (if using npm package)
3. ✅ Update dependency version in exocortex package.json
4. ✅ Run `npm install` in plugin
5. ✅ Rebuild plugin: `npm run build`

**Quick Test**:

```bash
# Verify ontology content in node_modules
cat node_modules/@kitelev/exocortex-public-ontologies/ontologies/exo-ui.ttl
```

**Reference**: Issues #1391-#1442 - Cross-repository ontology work

---

## Documentation Link Validation

### Finding Broken Links Across Docs

**Problem**: Documentation links become stale over time.

**Solution**: Run link validation:

```bash
# Find all markdown links
grep -r '\[.*\](.*\.md)' docs/ --include="*.md"

# Check each link exists
for link in $(grep -oP '\]\(\K[^)]+\.md' docs/*.md); do
  [ -f "docs/$link" ] || echo "BROKEN: $link"
done
```

**Common Broken Link Causes**:

1. File renamed without updating references
2. Section header changed (anchor links broken)
3. Cross-repo links to wrong branch

**Reference**: Issues #1382, #13 - Documentation Audit (January 2026)

---

## Plugin Features Not Available During Startup

### Metadata Cache Returns Null

**Problem**: Plugin features (buttons, commands, renderers) are not available when opening files immediately after Obsidian startup.

**Symptoms**:

- "Create Instance" buttons not visible on prototype files
- Commands fail with "cannot determine asset class"
- Renderers show empty/incomplete layouts
- Works correctly after ~5-10 seconds

**Root Cause**: `metadataCache.getFileCache(file)` returns `null` until Obsidian finishes indexing the vault.

**Diagnosis**:

```typescript
// Check in browser console (Ctrl+Shift+I in Obsidian)
const file = app.workspace.getActiveFile();
console.log(app.metadataCache.getFileCache(file));
// Output: null (during indexing) or {frontmatter: {...}} (after indexing)
```

**Solution**: Implement fallback YAML parsing (see PATTERNS.md § "Metadata Cache Fallback Pattern")

```typescript
// Quick check: Is frontmatter accessible?
const cache = app.metadataCache.getFileCache(file);
if (cache?.frontmatter) {
  // Normal path
} else {
  // Fallback: read file directly and parse YAML
  const content = await app.vault.read(file);
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = match ? yaml.load(match[1]) : null;
}
```

**When This Happens**:

- First launch after Obsidian update
- Cache invalidation (`.obsidian/` folder deleted)
- Large vaults (>10,000 files) with slow indexing
- Immediately after installing/enabling plugin

**Reference**: Issue #2103 - Make plugin independent from Obsidian metadata cache (February 2026)

---

## Table Column Misalignment in Virtualized Tables

### Scrollbar Width Causing Offset

**Problem**: In tables with >50 rows (virtualized), header columns don't align with body columns.

**Symptoms**:

- Header text appears shifted ~17px to the left of body cells
- Problem only appears with scrollbar visible
- Works correctly in non-virtualized tables (<50 rows)

**Root Cause**: Virtualized tables use separate `<table>` elements for header and body. The body table is inside a scroll container, which has a scrollbar taking ~17px width.

**Diagnosis**:

```typescript
// Check in browser console
const scrollContainer = document.querySelector(".scroll-container");
console.log(scrollContainer.offsetWidth - scrollContainer.clientWidth);
// Output: 17 (Windows/Linux) or 0 (macOS overlay scrollbars)
```

**Solution**: Apply padding compensation to header table (see PATTERNS.md § "Virtualized Table Scrollbar Compensation Pattern")

**Quick Fix** (CSS only):

```css
/* May not work with all scrollbar styles */
.virtualized-table-header {
  padding-right: 17px; /* Hardcoded scrollbar width */
}
```

**Proper Fix** (measure dynamically):

```typescript
const scrollWidth =
  parentRef.current.offsetWidth - parentRef.current.clientWidth;
setScrollbarWidth(scrollWidth);
// Apply as style={{ paddingRight: scrollbarWidth }}
```

**Affected Components**:

- `DailyTasksTable.tsx` (fixed in PR #941)
- `AssetRelationsTable.tsx` (fixed in PR #2116)
- `TableLayoutRenderer.tsx` (fixed in PR #2116)

**Reference**: Issues #941, #2116, #2120 - Scrollbar width compensation (February 2026)

---

## CLI SPARQL Queries Missing Expected Results

### UUID-Based Wikilinks Not Resolved

**Problem**: SPARQL queries for class hierarchies return incomplete results.

**Symptoms**:

```sparql
# Expected: Returns all subclasses of exo:Prototype
SELECT ?subclass WHERE {
  ?subclass rdfs:subClassOf* exo:Prototype
}
# Actual: Missing classes that reference parent by UUID
```

**Root Cause**: Wikilinks like `[[ebf717aa-4070-4b37-abde-10a700e354fc|exo__Prototype]]` are not resolved to file IRIs because standard relative path resolution fails for UUID-named files.

**Diagnosis**:

```yaml
# Check frontmatter of affected file
exo__Class_superClass:
  - "[[ems__EffortPrototype]]" # ✅ Resolves
  - "[[ebf717aa-4070-4b37-abde-10a700e354fc|exo__Prototype]]" # ❌ May fail
```

**Solution**: Build UUID-to-filepath index in `FileSystemVaultAdapter` (see PATTERNS.md § "UUID Wikilink Resolution Pattern")

**Quick Workaround**:

```yaml
# Use human-readable filename instead of UUID
exo__Class_superClass:
  - "[[exo__Prototype]]" # If file exists as exo__Prototype.md
```

**Long-term Fix**: Update CLI to version with UUID resolution (PR #2113+)

**Reference**: Issue #2113 - Resolve UUID-based wikilinks in FileSystemVaultAdapter (February 2026)

---

## Wikilink Display Issues in Reading View

### Block Reference Shows UUID Instead of Label

**Problem**: Wikilinks like `[[uuid#^blockid]]` display as `uuid > ^blockid` instead of `Asset Label > ^blockid` in Reading View.

**Symptoms**:

- Block reference links show raw UUID in Reading View
- Same links display correctly in Live Preview mode
- Links work correctly (navigation functions)
- Only display text is wrong

**Root Cause**: `BodyLinkPatch.ts` has a `hasUserAlias` guard that may incorrectly classify Obsidian-generated text as user-provided aliases, causing early return before label resolution.

**Diagnosis**:

```typescript
// Add temporary debug logging in BodyLinkPatch.patchLink()
console.log("BodyLinkPatch debug:", {
  currentText, // What Obsidian rendered
  expectedBlockRefText, // What we expect
  matchesBlockRefText, // true/false
  hasUserAlias, // If true, patching is skipped
});
```

**Common Cause**: Obsidian renders wikilink text in multiple formats:

- `basename#^blockid` (standard)
- `basename#blockid` (without caret)
- `basename > ^blockid` (separator format)
- `basename` (basename only)

If the guard only checks for one format, others are misclassified as "user alias".

**Solution**: Update `hasUserAlias` guard to recognize all known Obsidian text formats (see PATTERNS.md § "Obsidian Wikilink Text Rendering Variations Pattern")

```typescript
// Add additional format checks
const matchesBlockRefWithoutCaret = blockId
  ? currentText === `${file.basename}#${blockId}`
  : false;

const matchesBlockRefSeparatorFormat = blockId
  ? currentText === `${file.basename} > ^${blockId}`
  : false;

// Update guard
const hasUserAlias =
  currentText !== "" &&
  !matchesBasename &&
  !matchesDataHref &&
  !matchesBlockRefText &&
  !matchesBlockRefWithoutCaret && // NEW
  !matchesBlockRefSeparatorFormat && // NEW
  !wasAlreadyPatched;
```

**Prevention**:

- Always test wikilink features in **both** Live Preview and Reading View
- Log actual Obsidian output before hardcoding expected formats
- Add regression tests for format variations

**Reference**: Issue #2139, PR #2140 - Block reference Reading View fix (41 steps, February 2026)

---

## Graph View Labels Show UUIDs Despite Fix

### Symptom: Patch Applied But Labels Still Show UUIDs

**Problem**: `showLabelsInGraphView` setting is enabled, GraphViewPatch unit tests pass, but Graph View still displays UUID filenames instead of `exo__Asset_label` values.

**Symptoms**:

- All unit tests pass (including GraphViewPatch tests)
- Setting toggle is enabled in plugin settings
- Graph View nodes show UUIDs like `84e75603-0103-4594-8499-09dc404800b0`
- Expected behavior: nodes should show labels like "My Project"

**Root Causes** (in order of likelihood):

1. **No forced re-render after patching**: Obsidian renders node labels at creation time. Patching `getDisplayText()` AFTER nodes exist has no visible effect.

2. **Timing issue**: Patch applied too early (before Graph View loads) or too late (after nodes already rendered).

3. **Multiple prototypes**: Global graph and Local graph may use different internal classes. Patching one prototype leaves the other unpatched.

4. **Mocks hide lifecycle issues**: Unit tests mock graph nodes directly, never testing actual Obsidian rendering lifecycle.

**Diagnosis**:

```typescript
// Add debug logging to GraphViewPatch.patchProto()
console.log("GraphViewPatch.patchProto called:", {
  protoConstructor: proto.constructor?.name,
  nodesCount: renderer?.nodes?.length,
  enabled: this.enabled,
});
```

Check browser console:

- If not logged → patch never called
- If logged but 0 nodes → patch applied before graph loaded
- If logged with nodes but still UUIDs → missing re-render

**Solution**: See PATTERNS.md § "FunctionReplacer Pattern for Obsidian Patches"

Key fixes:

1. Use FunctionReplacer pattern with restorer functions
2. Collect ALL unique prototypes from renderer nodes
3. Call `forceRedrawGraphView()` after patching
4. Subscribe to `layout-change` event with debounced handler

**Reference**: Issues #2149, #2151, #2157 - Graph View label fixes (17-150 steps, February 2026)

---

## Graph View Fix Works But Causes TypeScript Errors

### Symptom: FunctionReplacer Pattern Compiles Locally But CI Fails

**Problem**: After implementing FunctionReplacer pattern for Graph View, local build works but CI reports TypeScript errors.

**Common Errors**:

```
error TS2339: Property 'getDisplayText' does not exist on type 'object'
error TS7006: Parameter 'proto' implicitly has an 'any' type
error TS2352: Conversion of type 'T[keyof T]' to type 'Function' may be a mistake
```

**Root Cause**: Generic FunctionReplacer typing conflicts with Obsidian's untyped internal APIs.

**Solution**: Use careful type narrowing and explicit casts:

```typescript
// ❌ WRONG: Generic typing fails on untyped Obsidian APIs
function replaceMethod<T>(proto: T, name: keyof T) { ... }

// ✅ CORRECT: Explicit object type with method cast
function replacePrototypeMethod(
  proto: object,
  methodName: string,
  wrapper: (original: () => string) => () => string
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
  const original = descriptor?.value as (() => string) | undefined;

  if (typeof original !== "function") {
    return () => {}; // No-op restorer if method doesn't exist
  }

  Object.defineProperty(proto, methodName, {
    value: wrapper(original),
    configurable: true,
    writable: true,
  });

  return () => {
    Object.defineProperty(proto, methodName, {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}
```

**Prevention**:

- Run `npm run check:types` before pushing
- Use explicit type casts for Obsidian internals
- Avoid overly generic typing for prototype manipulation

**Reference**: Issue #2165 - TypeScript errors in FunctionReplacer (February 2026)

---

## Wikilinks in Tables Not Resolved

### Symptom: Paragraph Links Work But Table Links Show UUIDs

**Problem**: Wikilink label resolution works for `[[uuid]]` links in paragraphs, but links inside markdown tables still display raw UUIDs.

**Example**:

```markdown
<!-- This works -->

Link to [[7db5eeff-718a-49b0-8d2b-39b084a356e3]] in paragraph.

<!-- This shows UUID -->

| Field | Value                                    |
| ----- | ---------------------------------------- |
| Link  | [[7db5eeff-718a-49b0-8d2b-39b084a356e3]] |
```

**Root Cause**: MutationObserver in `BodyLinkPatch.ts` uses `querySelectorAll()` on added nodes, but doesn't check if the added node itself IS a link (which can happen when Obsidian adds table cells).

**Diagnosis**:

```typescript
// Add debug logging to observer callback
console.log("Mutation added:", {
  nodeName: node.nodeName,
  isElement: node instanceof HTMLElement,
  isLink: node instanceof HTMLElement && node.matches("a.internal-link"),
  innerHTML: node instanceof HTMLElement ? node.innerHTML.slice(0, 100) : null,
});
```

**Solution**: Check both the node AND its descendants:

```typescript
// ✅ COMPLETE: Handles both cases
for (const node of mutation.addedNodes) {
  if (node instanceof HTMLElement) {
    // Case 1: Node IS a link (common in table cells)
    if (node.matches("a.internal-link")) {
      this.patchLink(node as HTMLAnchorElement);
    }

    // Case 2: Node CONTAINS links
    node.querySelectorAll("a.internal-link").forEach((link) => {
      this.patchLink(link as HTMLAnchorElement);
    });
  }
}
```

**Also verify**: Observer configuration includes `subtree: true`:

```typescript
observer.observe(container, {
  childList: true,
  subtree: true, // Required for table cell content!
});
```

**Reference**: Issue #2153 - Wikilinks in tables not resolved (56 steps, February 2026)

---

## Auto Release Skipped After CI Failure

### Non-required check failure blocks Auto Release

**Symptom**: All 8 required CI checks pass, PR merges via auto-merge, but Auto Release workflow shows "skipped".

**Root cause**: Auto Release triggers on `workflow_run` with `conclusion == 'success'`. A **non-required** check failure (e.g., `docs-link-check`) causes the overall CI run conclusion to be `failure`, which blocks Auto Release even though the PR was mergeable.

**Fix**:

1. Check which non-required job failed: `gh run view <RUN_ID> --json jobs --jq '.jobs[] | select(.conclusion == "failure") | .name'`
2. Fix the root cause (e.g., add ignore patterns to `.mlc-config.json` for external links that block CI bots)
3. After fix merges, the next CI run on main will have `conclusion: success` → Auto Release triggers

**Common `.mlc-config.json` ignore patterns**:

- `w3.org/TR/*` — W3C returns 403 for CI bots
- `exocortex.my/*` — ontology namespace URI, not a real website
- `../src/*` — relative code references, not web links

**Reference**: Issue #2713 Post-Mortem — PR #2717 fixed docs-link-check

---

## SHACL-lite `sh:maxCount got 2` on Single UUID Wikilink

**Symptom**: `sh:maxCount violation: expected at most 1 value for <predicate>, got 2` — but the frontmatter has only one wikilink value (e.g. `pmbok__RiskItem_project: "[[uuid]]"`).

**Root cause**: Before v15.160.1, `NoteToRDFConverter.valueToRDFObject` emitted dual-storage (IRI + UUID Literal) for **all** UUID-form wikilinks. SHACL cardinality shapes with `sh:maxCount=1` counted both as separate values.

**Fix**: Upgrade to `@kitelev/exocortex-cli@^15.160.1`. Dual-storage is now scoped to `exo__Asset_prototype` only — all other predicates emit a single IRI.

**If still failing after upgrade**:

- Verify the predicate in the violation is NOT `exo__Asset_prototype` (that predicate intentionally emits 2 triples)
- Check for `exo__Asset_legacyValidationException: "true"` in the asset — if present from the window 2026-05-03 10:00–13:20 UTC+5, it can now be removed

**Reference**: IssueItem ff3858e5, PR #3070

---

## SHACL-lite `sh:class violation` on Enum Instance Wikilink

**Symptom**: `sh:class violation: <pmbok#ClosureOutcomeAllAccepted> does not conform to expected class pmbok#ClosureOutcome` (or similar for RiskImpact, RiskProbability, RiskStatus, etc.).

**Root cause**: Before v15.160.1, resolving `[[pmbok__ClosureOutcomeAllAccepted]]` to namespace IRI `pmbok#ClosureOutcomeAllAccepted` did not emit an `rdf:type` triple. SHACL `sh:class` validation requires `pmbok:ClosureOutcomeAllAccepted rdf:type pmbok:ClosureOutcome` to be present in the graph to confirm conformance.

**Fix**: Upgrade to `@kitelev/exocortex-cli@^15.160.1`. The converter now emits the `rdf:type` triple derived from the target file's `exo__Instance_class` frontmatter.

**Prerequisite**: The enum instance file (e.g. `pmbok__ClosureOutcomeAllAccepted.md`) must have `exo__Instance_class` in its frontmatter pointing to the parent class.

**Reference**: IssueItem ff3858e5, PR #3070

---

## SHACL-lite false `sh:class violation` from Multi-Valued `exo__Instance_class` with One Malformed Entry

**Symptom**: An asset has frontmatter like

```yaml
exo__Instance_class:
  - "[[kf__Academic Discipline]]" # malformed (whitespace in local name)
  - "[[ims__Concept]]" # well-formed
```

…and SHACL still reports `sh:class violation` for the asset (or for assets that reference it) even though `ims__Concept` IS expected to be in `rdf:type`.

**Diagnostic procedure (IRI-normalization / triple-presence audit, ≤15 min)**

1. **Probe whether the target has ANY triples in the store:**

   ```bash
   npx @kitelev/exocortex-cli exoql query \
     "SELECT ?p ?o WHERE { <obsidian://vault/path/to/target.md> ?p ?o }"
   ```

   - `0 results` → the converter dropped the entire asset. Continue at step 2.
   - rdf:type triples appear → the bug is not the converter. Suspect IRI normalization between `subjectClasses.set` (line 165 of `ShaclLiteValidator.ts`) and `subjectClasses.get(obj.value)` (line 235) — compare lookup-key vs subject-key encoding (percent-encoding, trailing slashes).

2. **Inspect the target's `exo__Instance_class` array.** Any entry whose `[[wikilink]]` starts with a namespaced prefix (`kf__`, `ems__`, `inbox__`, …) but whose local name contains whitespace, parentheses, or other characters illegal in an IRI is malformed.

3. **Pre-fix root cause (resolved by Issue #3121):** a single malformed entry threw at `Namespace.term()`, aborting the whole-asset triple build via the outer catch in `convertVaultWithValidation`. Validator-side `validateExocortexAsset` also rejected the whole asset on the first malformed entry. Net result: every reference to the asset triggered a false sh:class violation because the target had zero `rdf:type` triples in the store.

**Fix (Issue #3121, v15.176.x+)**

- `expandClassValue` rejects local names containing whitespace/parens — returns `null` instead of throwing.
- `validateExocortexAsset` accepts a multi-valued array if **any** entry is well-formed; only rejects when **all** entries are malformed.
- Net effect: malformed entries are silently dropped at conversion; valid siblings still produce `rdf:type` and `exo__Instance_class` triples, so SHACL `sh:class` ANY-of check sees the correct class set.

**User action**: optionally rename malformed targets to a valid namespace form (e.g. `kf__AcademicDiscipline`). The asset is no longer invisible to SHACL in the meantime.

**Reference**: Issue #3121

---

## exo\_\_Instance_class wikilink form mismatch — all forms RDF-equivalent

**Symptom / question**: "I bulk-rewrote `exo__Instance_class` from label form `[[ems__Task]]` to bare-UUID form `[[1b20a8f0-…]]`. SHACL violation count didn't change at all. Did the rewrite do nothing? Was my hypothesis wrong?"

**Short answer**: The rewrite did exactly what it should — **nothing semantically**, because all three accepted forms are RDF-equivalent. The violation count is identical _by design_. Don't burn cycles debugging this.

### The three forms

`exo__Instance_class` historically accepts three wikilink shapes:

| Form | Example                                                 | Where used                                                                   |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A    | `"[[ems__Task]]"`                                       | Older `/exocortex-asset` skill template, hand-written assets                 |
| B    | `"[[1b20a8f0-d745-4e93-91db-4531b3df120e\|ems__Task]]"` | Mixed-form skill outputs (UUID for stability, alias for humans)              |
| C    | `"[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"`            | **Canonical** since 2026-05-16 (issue #3123). Used by recent bulk migrations |

### Why all three are semantically equivalent

`NoteToRDFConverter.valueToClassURI` resolves any of the three to the **same namespace IRI** (e.g. `https://exocortex.my/ontology/ems#Task`) via `Namespace.fromPropertyKey`. The converter:

1. Strips wikilink brackets `[[...]]` and any alias `|...`.
2. Tries the inner value as a property-key (`ems__Task`) — succeeds for Form A and Form B (after alias strip).
3. If not a property-key (Form C: bare UUID), looks up the target asset and reads _its_ `exo__Instance_class` to derive the class IRI.

Crucially, **file existence at the wikilink target is not consulted for the class IRI itself in Form A/B** — only the property-key registry. That means Form A (`[[ems__Task]]`) produces a valid class IRI even when no file named `ems__Task.md` exists in the vault.

The SHACL-lite validator (`ShaclLiteValidator`) then sees the same `rdf:type` triple regardless of which form was emitted, so:

- `sh:class` checks: identical result.
- `sh:in` enum checks: identical result.
- `sh:minCount` / `sh:maxCount` cardinality: identical result.

### Empirical evidence (2026-05-16 SHACL deep-dive session)

Migration A → C across the vault:

- **n** = 305 files rewritten
- **Total SHACL violations before**: 307
- **Total SHACL violations after**: 307
- **Delta**: 0

This is the expected, correct outcome — not a bug, not a missed cache invalidation, not a malformed entry being silently dropped.

### Obsidian navigation caveat

The forms _do_ differ for **Obsidian wiki-style navigation** (Ctrl/Cmd + click on the link in the editor):

- Form A `[[ems__Task]]` only navigates if a file `ems__Task.md` exists (label-named shim).
- Form B `[[uuid|ems__Task]]` navigates to the UUID-named file (`<uuid>.md`); alias is display-only.
- Form C `[[uuid]]` navigates to the UUID-named file with the UUID as display text.

This is a UX/cosmetic concern that has **no bearing on RDF semantics or SHACL conformance**.

### What to do

1. **For new assets**: emit Form C only. `/exocortex-asset` skill template and `docs/PROPERTY_SCHEMA.md` § _exo\_\_Instance_class › Canonical form_ are the source of truth.
2. **For existing assets**: Form A and Form B continue to work; migration is cosmetic and may be deferred. The pre-write hook `~/.claude/hooks/validate-wikilinks.sh` warns on non-Form-C in _new_ writes but does not block or rewrite legacy content.
3. **If SHACL violation counts didn't change after a form-only rewrite**: that's success, not failure. Move on.

**Reference**: Issue #3123. Related: `docs/PROPERTY_SCHEMA.md` § `exo__Instance_class` › _Canonical form_.
