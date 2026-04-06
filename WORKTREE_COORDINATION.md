# Exocortex Development - Worktree Coordinator

## 🎯 Purpose

This directory is the **coordination hub** for parallel development of the Exocortex Obsidian plugin by multiple Claude Code instances working simultaneously through git worktrees.

**⚠️ CRITICAL**: This is NOT a working directory. All actual development happens in isolated worktrees.

**🚨 MANDATORY PATH RULE**: ALL worktrees MUST be created in the `worktrees/` subdirectory:
- ✅ CORRECT: `/Users/kitelev/Developer/exocortex-development/worktrees/exocortex-claude1-feat-xyz/`
- ❌ WRONG: `/Users/kitelev/Developer/exocortex-development/exocortex-claude1-feat-xyz/`

**DO NOT pollute this coordination directory with worktrees!** Use `/worktree-create` command which handles paths automatically.

## 📁 Directory Structure

```
/Users/kitelev/Developer/exocortex-development/
├── exocortex/   # Main repository (READ-ONLY for Claude instances)
│   └── CLAUDE.md                # Complete development guidelines
├── worktrees/                   # All worktrees live here (flat structure)
│   ├── exocortex-claude1-feat-graph-viz/
│   ├── exocortex-claude2-fix-mobile-ui/
│   └── exocortex-claude3-refactor-rdf/
└── CLAUDE.md                    # This file - worktree coordination rules
```

## 🚨 Golden Rules

### RULE 0: Never Work in Main Repository

**❌ FORBIDDEN:**
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
# ... make edits ... ❌ BLOCKED!
```

**✅ REQUIRED:**
```bash
cd /Users/kitelev/Developer/exocortex-development
/worktree-create my-feature  # Use slash command
cd worktrees/exocortex-[instance]-[task]
# ... work here ... ✅ SAFE
```

### RULE 0.5: ALL Worktrees MUST Live in worktrees/ Directory

**🚨 CRITICAL PATH REQUIREMENT:**

ALL worktrees MUST be created inside `/Users/kitelev/Developer/exocortex-development/worktrees/`

**❌ ABSOLUTELY FORBIDDEN:**
```bash
# DON'T create worktrees in root coordination directory!
cd /Users/kitelev/Developer/exocortex-development
git worktree add exocortex-feat-something    # ❌ WRONG PATH!
git worktree add ./my-feature                # ❌ WRONG PATH!
git worktree add feature/something           # ❌ WRONG PATH!

# These pollute the coordination directory and break organization!
```

**✅ ONLY CORRECT WAY:**
```bash
# Option 1: Use slash command (RECOMMENDED - handles paths automatically)
cd /Users/kitelev/Developer/exocortex-development
/worktree-create my-feature  # Creates: worktrees/exocortex-claude1-feat-my-feature

# Option 2: Manual creation (must specify worktrees/ path!)
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree add ../worktrees/exocortex-claude1-feat-my-feature -b feature/my-feature
#                   ^^^^^^^^^^^^ MUST include worktrees/ prefix!
```

**Why this matters:**
- Keeps coordination directory clean (only `exocortex/`, `worktrees/`, `CLAUDE.md`)
- Makes cleanup obvious (`rm -rf worktrees/*` after merge)
- Prevents confusion about what's a worktree vs. what's infrastructure
- Allows parallel instances to easily list all active work

**Validation before starting work:**
```bash
pwd  # Check you're in right place
# Should output: /Users/kitelev/Developer/exocortex-development/worktrees/exocortex-*
# If missing "worktrees/" in path → STOP! Wrong location!
```

### RULE 1: One Task = One Worktree

- Small, focused changes
- Clear, descriptive names
- Short-lived (hours to 1-2 days max)
- Deleted immediately after PR merge

## 🏷️ Naming Conventions

**Format**: `worktrees/exocortex-[instance-id]-[type]-[description]`

**Instance IDs**: `claude1`, `claude2`, `claude3`, `claude4`, `claude5`

**Types**:
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code refactoring
- `perf` - Performance improvement
- `test` - Test addition/modification
- `docs` - Documentation
- `exp` - Experimental/research work

**Examples**:
```
worktrees/exocortex-claude1-feat-graph-viz
worktrees/exocortex-claude2-fix-mobile-scrolling
worktrees/exocortex-claude3-refactor-triple-store
worktrees/exocortex-claude4-perf-query-cache
worktrees/exocortex-claude5-exp-owl-reasoning
```

**Why this matters**:
- Prevents name collisions between parallel instances
- Makes it obvious who owns which task
- Easy to identify task type at a glance
- Simplifies cleanup (can grep by instance or type)

## 🔄 Synchronization Protocol

### Before Starting Work

**ALWAYS sync before creating worktree:**
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
git fetch origin main
git pull origin main --rebase
# Now create worktree
```

### During Development

**Sync frequency**:
- Before each commit (if main has changed)
- Before creating PR
- After any other instance merges to main

**Sync command in worktree:**
```bash
git fetch origin main
git rebase origin/main  # Resolve conflicts if any
```

### Conflict Resolution

If rebase fails:
1. Read conflict carefully
2. Resolve in favor of latest main (others' work takes priority)
3. If your changes are incompatible, discuss with user
4. Complete rebase: `git rebase --continue`
5. Force push: `git push --force-with-lease origin [branch]`

## 🎮 Quick Command Reference

**⚠️ ALWAYS use these slash commands for worktree management:**

```bash
/worktree-create [task-name]    # Create new worktree with proper naming
/worktree-list                  # Show all active worktrees
/worktree-cleanup               # Remove merged/stale worktrees
```

**Other essential commands** (from main repo):
```bash
/release [major|minor|patch]    # Create release (after PR merge)
npm run test:all                # MANDATORY: Run ALL tests before PR
/execute [task]                 # Complex multi-step tasks
/status                         # Check project health
/agents                         # List available agents
```

## 🔧 Worktree Lifecycle

### 1. Create Worktree

```bash
# Use slash command (recommended)
/worktree-create my-feature

# Or manually:
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree add ../worktrees/exocortex-claude1-feat-my-feature -b feature/my-feature
cd ../worktrees/exocortex-claude1-feat-my-feature
git fetch origin main && git rebase origin/main
```

### 2. Develop

```bash
# Work in worktree
cd /Users/kitelev/Developer/exocortex-development/worktrees/exocortex-claude1-feat-my-feature

# Follow all rules from exocortex/CLAUDE.md
# - Use agents for complex tasks
# - Run npm run test:all before creating PR
# - Never commit broken code
```

### 3. Create PR and Monitor Until Merge

**🚨 CRITICAL: Creating PR is NOT the end! Task is complete only after merge + release.**

```bash
# Test first (MANDATORY)
npm run test:all

# Commit and push
git commit -am "feat: user-facing description"
git push origin feature/my-feature

# Create PR
gh pr create --title "feat: my-feature" --body "Details..."

# MANDATORY: Monitor CI pipeline
gh pr checks --watch  # Wait for GREEN ✅

# Fix if checks fail (RED ❌)
# ... make fixes ...
git commit --amend --no-edit
git push --force-with-lease origin feature/my-feature

# MANDATORY: Wait for merge
gh pr merge --auto --rebase

# MANDATORY: Verify release created
gh release list --limit 1
```

**DO NOT consider task complete until:**
- ✅ CI pipeline passes (build-and-test + e2e-tests)
- ✅ PR merged to main
- ✅ Auto-release workflow creates GitHub release

### ⚠️ CRITICAL: Cleanup Timing

**DO NOT cleanup worktree if you're still in active Claude session!**

**Problem**: Running cleanup while Claude session is active in the worktree will break bash environment:
- Current directory becomes invalid (deleted)
- All subsequent bash commands fail with "exit code 1"
- Session becomes unusable

**Safe cleanup workflow:**

```bash
# Step 1: Exit Claude Code session or switch to different directory
cd /Users/kitelev/Developer/exocortex-development

# Step 2: THEN run cleanup
/worktree-cleanup

# Or manually:
cd exocortex
git worktree remove ../worktrees/exocortex-[instance]-[type]-[task]
git branch -D [branch-name]
```

**Alternative**: Keep worktree until:
- Session ends naturally
- You switch to different worktree
- You explicitly exit Claude Code

**Remember**: Disk space is cheap, broken sessions are expensive. Better to cleanup later than break active work.

---

### 4. Cleanup After Merge

```bash
# Use slash command (recommended)
/worktree-cleanup

# Or manually:
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree remove ../worktrees/exocortex-claude1-feat-my-feature
git branch -d feature/my-feature
```

## 🤝 Multi-Instance Coordination

### Task Assignment Strategy

**Before starting a new task:**

1. Check active worktrees: `/worktree-list`
2. Check open PRs: `gh pr list`
3. Avoid duplicating work on same feature
4. If uncertain, ask user: "Should I work on X while another instance works on Y?"

### Parallel Work Best Practices

**✅ SAFE (independent areas):**
- Instance A: Frontend component
- Instance B: Backend service
- Instance C: Documentation
- Instance D: Tests for A's component
- Instance E: Performance optimization

**⚠️ RISKY (same files):**
- Instance A: Refactor RDF store
- Instance B: Also refactor RDF store
→ **Coordinate with user first!**

### Communication Through Git

**Branch names are communication:**
```bash
git worktree list
# Shows what everyone is working on
# If you see: feature/graph-visualization
# Don't create: feature/graph-viz-improvements (too similar!)
```

### Parallel Releases & Auto-Versioning

**🚨 CRITICAL: Multiple AI agents work in parallel - releases happen independently!**

**How parallel releases work:**

```
Timeline example (Nov 1, 2025):
14:24 - Agent A: Creates PR #252 (Votes toggle)
14:29 - Agent B: PR #251 merged → Release v13.8.0 created
14:34 - Agent A: PR #252 merged → Release v13.9.0 created
```

**Key insights:**

1. **Auto-versioning is SEQUENTIAL**: Each merged PR triggers automatic version bump
   - v13.8.0 → PR #251 (parallel work)
   - v13.9.0 → PR #252 (your work)
   - Releases created in merge order, NOT creation order

2. **Don't assume version numbers**:
   - ❌ WRONG: "My PR will be v13.8.0" (may be v13.9.0 or v13.10.0)
   - ✅ CORRECT: Wait for merge, then check `gh release list --limit 1`

3. **Monitor until RELEASE, not just merge**:
   ```bash
   # Step 1: Wait for PR merge
   gh pr checks --watch

   # Step 2: Wait for auto-release workflow
   sleep 10  # Give workflow time to trigger

   # Step 3: Verify YOUR release was created
   gh release list --limit 3
   # Look for release with YOUR PR number in changelog
   ```

4. **Parallel work means unpredictable ordering**:
   - Agent A starts first, Agent B starts later
   - Agent B may merge first (simpler changes, faster CI)
   - Agent A merges second → gets next version number
   - **This is NORMAL and EXPECTED**

5. **Check release notes to confirm**:
   ```bash
   # View latest release
   gh release view v13.9.0 --json body

   # Verify YOUR PR # is in the changelog
   # If not found → check next release (v13.10.0, etc.)
   ```

**Example scenario:**

```bash
# You create PR #252 and see v13.8.0 as "Latest"
gh release list --limit 1
# v13.8.0  Latest  v13.8.0  2025-11-01T14:29:05Z

# While your CI runs, another agent's PR merges first
# After YOUR PR merges, check again:
gh release list --limit 1
# v13.9.0  Latest  v13.9.0  2025-11-01T14:39:47Z  ← YOUR release

# Verify it contains your PR:
gh release view v13.9.0 --json body
# "### Features\n- add Votes column toggle (#252)"  ← YOUR work!
```

**Task completion checklist:**
- ✅ PR merged to main
- ✅ CI checks all GREEN
- ✅ Auto-release workflow completed
- ✅ **YOUR PR number appears in release notes**
- ✅ Worktree cleaned up

## 📚 Full Development Guidelines

**This file covers ONLY worktree coordination.**

For complete development rules, see:
```
exocortex/CLAUDE.md
```

Essential topics covered there:
- PR-based workflow (RULE 1)
- Mandatory agent usage (RULE 2)
- Test requirements (RULE 3)
- Branch protection (RULE 4)
- BDD coverage (RULE 6)
- Code style (RULE 7)
- Monorepo structure (packages/exocortex, packages/obsidian-plugin, packages/cli)
- Architecture patterns
- Quality metrics (11,400+ tests across all packages)
- Troubleshooting

## ⚡ Quick Start

**New instance starting work?**

```bash
# 1. Read this file (you're doing it!)
# 2. Read main guidelines
cat exocortex/CLAUDE.md

# 3. Create your worktree
/worktree-create my-first-task

# 4. Develop following all rules
cd worktrees/exocortex-claude1-feat-my-first-task
# ... code ...

# 5. Test and release
npm run test:all
git commit -am "feat: my awesome feature"
git push origin feature/my-first-task
gh pr create

# 6. After merge, cleanup
/worktree-cleanup
```

## 🆘 Troubleshooting

### "Worktree created in wrong location"

**🚨 CRITICAL ERROR: Worktree not in worktrees/ directory!**

```bash
# Check where worktrees were created
cd /Users/kitelev/Developer/exocortex-development
ls -la  # Look for unexpected directories (not worktrees/, exocortex/, or CLAUDE.md)

# If you see directories like:
# - exocortex-feat-something/
# - feature-xyz/
# - my-worktree/
# These are in the WRONG location!

# Fix it:
# 1. Check if worktree has uncommitted changes
cd <wrong-worktree-name>
git status

# 2. If clean, just remove the worktree
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

### "Worktree already exists"
```bash
/worktree-list  # See what's there
/worktree-cleanup  # Clean merged ones
# Or pick different task name
```

### "Rebase conflicts"
```bash
git status  # See conflicting files
# Edit files, resolve conflicts
git add .
git rebase --continue
```

### "Someone else is working on this"
```bash
/worktree-list  # Check active work
gh pr list  # Check open PRs
# Ask user: "Should I help with X or start Y?"
```

### "Lost track of current worktree"
```bash
pwd  # Check current directory
# Should be: /Users/kitelev/Developer/exocortex-development/worktrees/exocortex-*
# If missing "worktrees/" in path → STOP! You're in the wrong place!
```

---

**Remember**:
- 🚨 **ALL worktrees MUST be in `worktrees/` subdirectory - NO EXCEPTIONS!**
- This directory exists to enable safe parallel development
- When in doubt, sync early, sync often, and use slash commands
- Before starting: validate with `pwd` that you're in `worktrees/exocortex-*`
