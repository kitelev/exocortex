# Exocortex Development - Claude Code Instructions

> **Multi-Agent Support**: This coordination hub supports Claude Code, GitHub Copilot, Cursor, Google Jules, OpenAI Codex, Aider, and 20+ other AI coding assistants via universal `AGENTS.md` standard.
>
> **Claude Code Specific**: This file contains Claude Code-enhanced instructions with **slash commands** (`/worktree-create`, `/worktree-cleanup`, `/worktree-list`). For universal AI agent instructions, see `AGENTS.md`.

---

## 🎯 Project Context: AI-Driven Knowledge Management

**What is Exocortex?**

Exocortex is a **knowledge management system** that gives users convenient control over all their knowledge. It started as an Obsidian plugin for ontology-driven layouts (Areas → Projects → Tasks) and has evolved into a larger system with CLI capabilities and advanced semantic features.

**Core Philosophy**: AI-driven development
- This project is developed **exclusively by AI agents** (Claude Code, Copilot, Cursor, etc.)
- Each session runs **parallel and independent** of which agent is used
- **Continuous self-improvement** of AI instructions based on learned experience
- You are not just coding - you are **training future AI agents**

---

## 🚨 RULE #1 (MOST CRITICAL): WORKTREES ONLY

**⚠️ THIS IS THE MOST IMPORTANT RULE - VIOLATION IS UNACCEPTABLE ⚠️**

**The `exocortex/` directory is STRICTLY READ-ONLY.**

ALL code changes MUST happen through git worktrees in the `worktrees/` subdirectory.

### Why This Rule Exists

1. **Parallel AI agent work**: Multiple Claude Code instances work simultaneously without conflicts
2. **Safe experimentation**: Each worktree is an isolated sandbox
3. **Clean coordination**: Git worktrees show active work across all instances
4. **Prevents corruption**: Main repository stays pristine

### Enforcement

**❌ ABSOLUTELY FORBIDDEN:**
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
vim src/some-file.ts              # ❌ NEVER DO THIS!
git commit -am "changes"          # ❌ BLOCKED!
```

**✅ ONLY CORRECT WAY (Claude Code):**
```bash
# 1. Use slash command (RECOMMENDED)
/worktree-create my-feature       # Creates worktree automatically

# 2. Or manually
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree add ../worktrees/exocortex-claude1-feat-my-feature -b feature/my-feature
cd ../worktrees/exocortex-claude1-feat-my-feature

# 3. Work in worktree
vim src/some-file.ts              # ✅ CORRECT!
git commit -am "feat: changes"    # ✅ SAFE!
```

### Validation Before Starting Work

**ALWAYS verify your location:**
```bash
pwd
# MUST output: .../exocortex-development/worktrees/exocortex-claude*
# If "worktrees/" is missing → STOP IMMEDIATELY!
```

---

## 🚨 RULE #2 (SECOND MOST CRITICAL): MANDATORY SELF-IMPROVEMENT

**⚠️ EVERY COMPLETED TASK MUST PRODUCE POST-MORTEM WITH IMPROVEMENT PROPOSALS ⚠️**

This project evolves through **iterative self-improvement** of AI agent instructions. Your experience is valuable data for future Claude Code instances.

### Post-Mortem Report (MANDATORY)

After EVERY completed task, you MUST write a detailed post-mortem report documenting:

1. **What was accomplished** - Features implemented, tests added, coverage achieved
2. **Errors encountered** - EVERY error, no matter how small
3. **Solutions applied** - Exact steps that fixed each error
4. **Lessons learned** - Patterns, insights, gotchas discovered
5. **Propose documentation improvements** - Specific additions to AGENTS.md, CLAUDE.md, etc.
6. **WAIT FOR USER APPROVAL** - Present report to user, get explicit permission before editing any files

### ⚠️ CRITICAL: DO NOT AUTO-EDIT DOCUMENTATION

**You MUST NOT edit AGENTS.md, CLAUDE.md, or any instruction files without explicit user permission.**

**Correct workflow**:
1. ✅ Write post-mortem report
2. ✅ Propose improvements with exact text to add
3. ✅ **ASK user for permission**: "May I update these files?"
4. ✅ **WAIT for user approval** (Yes/No/Adjust)
5. ✅ **ONLY if approved** - edit documentation files

**Forbidden**:
- ❌ Automatically editing instruction files after task completion
- ❌ Updating documentation "based on learnings" without asking
- ❌ Committing changes to AGENTS.md, CLAUDE.md without permission

### Post-Mortem Template

```markdown
## Task: [Feature/Fix Name]

### Completed
- [What was implemented]
- [Tests added: X unit + Y E2E]
- [Coverage: Z%]
- [PR #XXX merged, Release vX.Y.Z created]

### Errors Encountered & Solutions

1. **[Error Category]**: [Error description]
   - **Error**: ```[Exact error message / stack trace]```
   - **Root Cause**: [Why it happened]
   - **Solution**: [Exact steps to fix]
   - **Prevention**: [How to avoid in future]

2. **[Next Error]**: ...

### Lessons Learned

- **Pattern discovered**: [New pattern found in codebase]
- **Gotcha identified**: [Unexpected behavior or edge case]
- **Best practice**: [Better way to do X]
- **Tool insight**: [How to use Claude Code / slash commands more effectively]

### Documentation Improvements Proposed

**Add to AGENTS.md** (Section: [section name]):
```
[Exact text to add]
```

**Add to CLAUDE.md** (Section: [section name]):
```
[Exact text to add]
```

**Add to exocortex/CLAUDE.md** (Section: [section name]):
```
[Exact text to add]
```

### Future Agent Guidance

[Advice for next Claude Code instance working on similar task]
```

### Why Self-Improvement Matters

- **Compound learning**: Each instance makes future instances smarter
- **Reduced errors**: Common pitfalls get documented and avoided
- **Better patterns**: Successful approaches become standardized
- **Faster development**: Less trial-and-error, more "known good paths"
- **Claude Code optimization**: Discover better slash command usage, workflows

### How to Present Your Report

**Step 1: Complete the post-mortem**
Write detailed report following the template above.

**Step 2: Present to user and ask for permission**
"I've completed [task] and documented my experience. Here's my post-mortem report with proposed improvements to AGENTS.md and CLAUDE.md. **May I have your permission to update these documentation files?**"

**Step 3: Wait for user decision**
- User says **"Yes"/"Approved"** → Proceed with edits
- User says **"No"/"Not now"** → Do NOT edit files, report is saved for future reference
- User says **"Adjust X"** → Modify proposals, present again, wait for approval

**Step 4: ONLY if approved - update documentation**
If user explicitly approves, then and only then edit AGENTS.md, CLAUDE.md, or other instruction files.

**Remember**: You propose, user decides. Never auto-edit instruction files.

### Lessons from Issue #250 (SPARQL Documentation)

**Example of successful documentation task** (completed Nov 9, 2025):

**What Made It Fast:**
- Timeline: 85 minutes total (research → merged release)
- Zero errors encountered (documentation-only PR)
- First-time CI pass (no code changes to break)
- Immediate merge (low risk, enabled auto-merge)

**Documentation Quality Patterns Applied:**
- **Structured by audience**: User-Guide, Developer-Guide, Query-Examples, Performance-Tips (4 files, ~2400 lines)
- **Example-driven**: 30+ copy-paste ready query patterns
- **Concrete numbers**: Benchmarks with execution times (<10ms, 10-100ms, >100ms), complexity (O(1) vs O(n))
- **README integration**: New "SPARQL Query System" section with links to all guides

**Workflow That Worked:**
1. Research source code (10-15 min) - Read SPARQLCodeBlockProcessor, SPARQLApi, tests
2. Create structure (5 min) - `docs/sparql/` with 4 files planned
3. Write guides (60-90 min) - Started with examples, then tutorials, then API docs
4. Integrate (10 min) - Added README section with quick start
5. Validate (5 min) - Created PR, enabled auto-merge, all checks GREEN

**Key Insights for Future Documentation:**
- Examples > explanations (users want copy-paste patterns)
- Separate files by audience (user/developer/performance) improves findability
- Performance docs need numbers ("100x faster" vs "significantly faster")
- README links are mandatory (users won't find docs/ otherwise)
- Documentation PRs are safe and fast (no debugging, quick release)

**Result:**
- PR #354 merged in 4 minutes
- Release v13.47.2 created automatically
- Complete documentation suite delivered in one session

---

## 🎯 Purpose

This directory is the **coordination hub** for parallel development of the Exocortex project by multiple Claude Code instances working simultaneously through git worktrees.

**⚠️ CRITICAL**: This is NOT a working directory. All actual development happens in isolated worktrees.

## ⚡ Quick Orientation (Read First)

- **Product context**: Exocortex is an Obsidian plugin that renders ontology-driven layouts, links Areas → Projects → Tasks, tracks effort/status history, and exposes voting signals for prioritization. Core modules live under `src/` (presentation, application, domain, infrastructure) with shared utilities in `packages/exocortex` and CLI tooling in `packages/cli`.
- **Shared vocabulary**: Tasks (`ems__Task`) roll up into Projects and Areas, layout renderers are named `*Renderer`, command orchestration flows through `CommandManager` and command visibility rules, and “Effort” refers to timestamped work-state transitions plus vote tallies.
- **Workflow baseline**: Always create a worktree under `/Users/kitelev/Developer/exocortex-development/worktrees/` (use `/worktree-create`). The main repo under `exocortex/` is read-only for agents.
- **Definition of done**: A task is finished only after its changes land through a PR, that PR is merged into `main`, and the release flow publishes successfully. Clean up the worktree afterwards.
- **Deeper docs**: Start with `exocortex/README.md` for features, `ARCHITECTURE.md` for layering, and `docs/PROPERTY_SCHEMA.md` for frontmatter vocabulary.

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

**Why `/worktree-create` is preferred over manual git commands:**

```bash
# ✅ RECOMMENDED - Slash command (automatic, fast, correct)
cd /Users/kitelev/Developer/exocortex-development
/worktree-create my-feature
# Automatically: names worktree correctly, creates in worktrees/, syncs with main, installs deps

# ❌ MANUAL - More steps, easy to make path/naming mistakes
cd exocortex
git worktree add ../worktrees/exocortex-claude1-feat-my-feature -b feature/my-feature
cd ../worktrees/exocortex-claude1-feat-my-feature
git fetch origin main && git rebase origin/main
npm install
```

**Benefits of slash command:**
- Correct naming convention enforced (`exocortex-claude1-feat-*`)
- Automatic path handling (always creates in `worktrees/`)
- Sync with main branch included
- Dependency installation handled
- Faster workflow, fewer errors

**Other essential commands** (from main repo):
```bash
/release [major|minor|patch]    # Create release (after PR merge)
npm run test:all                # MANDATORY: Run ALL tests before PR
/execute [task]                 # Complex multi-step tasks
/status                         # Check project health
/agents                         # List available agents
```

### Quick Audit Commands (Before Implementation)

**Before implementing a feature, run these commands:**

```bash
# Search for feature implementation
grep -r "feature_keyword" packages/*/src/ | grep -v node_modules

# Find helper utilities
grep -r "FeatureHelpers" packages/*/src/

# List all tables and renderers
ls packages/obsidian-plugin/src/presentation/components/*Table*.tsx
ls packages/obsidian-plugin/src/presentation/renderers/*.ts

# Check test coverage
grep -r "feature_keyword" packages/*/tests/ | grep -v node_modules

# Run specific test suite
npm run test -- --testNamePattern="feature keyword"
```

**Example (Blocker Indicator Audit):**
```bash
# 1. Search for blocker-related code
grep -r "isBlocked" packages/obsidian-plugin/src/

# 2. Find blocker helpers
grep -r "BlockerHelpers" packages/obsidian-plugin/src/

# 3. Check test coverage
grep -r "blocker" packages/obsidian-plugin/tests/component/

# Result: Feature already in 3 tables (DailyTasks, DailyProjects, AssetRelations)
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

**Install dependencies before running any scripts:**
```bash
npm install  # Prevents ts-jest preset errors in fresh worktrees
```
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

#### TypeScript tooling

- `ts-jest` in this repo cannot transpile class-level `async *` generator methods. When you need an async stream, return an `AsyncIterableIterator` from a helper/closure instead of adding `async *` on a class.

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
- ✅ **Post-mortem report written** (errors encountered, solutions, lessons learned)
- ✅ **Documentation improvements proposed** (updates to AGENTS.md, CLAUDE.md, etc.)

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

### 4. Write Post-Mortem Report (MANDATORY)

**Before cleanup, document your experience:**

```markdown
## Task: [Feature/Fix Name]

### Completed
- [What was implemented]
- [Tests added]
- [Coverage achieved]

### Errors & Solutions
1. **[Error description]**:
   - Error: [Exact error message]
   - Solution: [How it was fixed]

2. **[Next error]**:
   - Error: [Details]
   - Solution: [Fix]

### Lessons Learned
- [Key insight 1]
- [Key insight 2]
- [Best practice discovered]

### Documentation Suggestions
- Add to AGENTS.md: "[Suggestion for universal docs]"
- Add to CLAUDE.md: "[Claude Code specific tip]"
- Add to [other file]: "[Improvement]"
```

**Share this report with user** so lessons can be captured in documentation.

### 5. Cleanup After Merge

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
- ✅ **Post-mortem report written and shared**
- ✅ **Documentation improvements proposed**
- ✅ Worktree cleaned up

## 📚 Full Development Guidelines

**This file covers ONLY Claude Code-specific worktree coordination.**

### Documentation Hierarchy

1. **Universal instructions** (all AI agents):
   ```
   AGENTS.md                    # Universal standard for all AI tools
   README.md                    # Quick start and multi-agent support matrix
   ```

2. **Tool-specific instructions**:
   ```
   CLAUDE.md                    # This file - Claude Code with slash commands
   .github/copilot-instructions.md    # GitHub Copilot
   .cursor/rules/*.mdc          # Cursor IDE (modern)
   .cursorrules                 # Cursor IDE (legacy)
   ```

3. **Project-specific guidelines**:
   ```
   exocortex/CLAUDE.md              # Complete development rules
   exocortex/README.md              # Product features
   exocortex/ARCHITECTURE.md        # Architecture patterns
   exocortex/docs/PROPERTY_SCHEMA.md  # Frontmatter vocabulary
   ```

### Essential Topics in Project CLAUDE.md
- PR-based workflow (RULE 1)
- Mandatory agent usage (RULE 2)
- Test requirements (RULE 3)
- Branch protection (RULE 4)
- BDD coverage (RULE 6)
- Code style (RULE 7)
- Monorepo structure (packages/exocortex, packages/obsidian-plugin, packages/cli)
- Quality metrics (803 unit tests across all packages)
- Troubleshooting

### Multi-Agent Coordination

**Shared resources**:
- All AI agents read from same `AGENTS.md` for universal guidelines
- Tool-specific files provide enhanced features per tool
- Git worktrees prevent conflicts between parallel agents

**Communication**:
- Check active worktrees: `/worktree-list`
- Check open PRs: `gh pr list`
- Coordinate with user if working on overlapping features

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

## 🔧 Development Patterns

### Timestamp-Based Sorting Pattern

**When to use**: Sorting any time-based data chronologically

**Problem**: String-based time sort fails:
```typescript
// ❌ WRONG: String sort breaks chronological order
tasks.sort((a, b) => a.startTime.localeCompare(b.startTime));
// "23:45" > "00:15" → wrong order across midnight
```

**Solution**: Use timestamps for sorting:
```typescript
// ✅ CORRECT: Timestamp-based sort
interface Task {
  startTime: string;           // Display: "09:00"
  startTimestamp: number;       // Sort: 1736928000000
}

tasks.sort((a, b) => {
  const aTime = a.startTimestamp ? new Date(a.startTimestamp).getTime() : 0;
  const bTime = b.startTimestamp ? new Date(b.startTimestamp).getTime() : 0;
  return aTime - bTime;  // Numeric comparison
});
```

**Benefits**:
- Accurate chronological ordering
- Handles midnight boundary correctly
- Handles dates across multiple days
- Flexible display formatting (toggle between formats)

**Pattern**: Keep parallel fields (formatted string + raw timestamp)

**Example from PR #339**:
- Added `startTimestamp`/`endTimestamp` alongside `startTime`/`endTime`
- Display uses formatted string ("09:00" or "11-06 09:00")
- Sorting uses numeric timestamp comparison
- Toggle button switches display format without changing sort logic

### Documentation Task Pattern

**When creating comprehensive documentation:**

1. **Research Phase** (10-15 minutes):
   - Read source code for feature (main files + tests)
   - Identify key components and APIs
   - Note existing patterns and conventions
   - Check for existing partial docs to integrate

2. **Structure Phase** (5 minutes):
   - Create docs/ subdirectory if needed
   - Plan file structure by audience (user/developer/performance)
   - Define scope of each file
   - Identify cross-linking opportunities

3. **Writing Phase** (60-90 minutes):
   - Start with examples (Query-Examples.md pattern)
   - Write user guide with progressive complexity
   - Document developer API with TypeScript examples
   - Add performance/troubleshooting guide if applicable

4. **Integration Phase** (10 minutes):
   - Update README.md with new section
   - Add cross-links between docs
   - Verify all code examples are syntactically correct
   - Test that links resolve

5. **Validation Phase**:
   - Commit with "docs:" prefix
   - Verify CI passes (no lint errors)
   - Create PR with clear summary
   - Enable auto-merge

**Documentation Checklist:**
- [ ] Examples are copy-paste ready
- [ ] README.md updated with links
- [ ] Performance guidance includes numbers
- [ ] Cross-links between docs work
- [ ] All TypeScript examples type-check

**Expected Timeline:**
- Total: 85-90 minutes (research → release)
- Zero errors expected (documentation-only)
- First-time CI pass (no code changes)
- Immediate merge (low risk, high value)

### Obsidian File Lookup Pattern

**When looking up files via `metadataCache.getFirstLinkpathDest()`, always implement `.md` extension fallback to handle wiki-links that don't include the extension.**

**Standard Pattern**:
```typescript
let file = this.app.metadataCache.getFirstLinkpathDest(path, "");

if (!file && !path.endsWith(".md")) {
  file = this.app.metadataCache.getFirstLinkpathDest(path + ".md", "");
}

if (file instanceof TFile) {
  // Process file
}
```

**Why this matters**:
- Wiki-links like `[[Page Name]]` extract to `"Page Name"` (no `.md`)
- Obsidian's `getFirstLinkpathDest` may require full filename `"Page Name.md"`
- Without fallback, valid references fail to resolve
- This pattern prevents bugs in area inheritance, relation lookups, and any file resolution

**When to use**:
- Looking up parent/child relationships (e.g., `ems__Effort_parent`)
- Resolving prototype references (e.g., `exo__Asset_prototype`)
- Following any property that contains wiki-links to other notes
- Any file lookup based on frontmatter property values

**Test Pattern**:
```typescript
it("should resolve file with .md extension fallback", () => {
  mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
    (linkpath: string) => {
      if (linkpath === "file-name") return null;
      if (linkpath === "file-name.md") return mockFile;
      return null;
    },
  );

  const result = service.methodThatLookupsFile("[[file-name]]");

  expect(result).toBeDefined();
});

it("should not duplicate .md extension if already present", () => {
  mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
    (linkpath: string) => {
      if (linkpath === "file-name.md") return mockFile;
      return null;
    },
  );

  const result = service.methodThatLookupsFile("[[file-name.md]]");

  expect(result).toBeDefined();
  // Verify only called once (not with "file-name.md.md")
  expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(1);
});
```

**Reference Implementations**:
- `AssetMetadataService.getAssetLabel()` (lines 10-14)
- `AssetMetadataService.getEffortArea()` (lines 103-108 for parent, 131-136 for prototype)

**Real-world example**: See Issue #355 and PR #356 (Fixed area inheritance by adding `.md` fallback)

### Playwright Component Testing Patterns

**When writing Playwright Component Tests, follow these patterns to avoid common pitfalls.**

#### CSS Inline Style Assertions

**Problem**: `toHaveCSS()` computes styles to pixel values, failing for percentage-based widths.

**Solution**: Check style attribute directly:

```typescript
// ❌ WRONG - Playwright computes to pixels (e.g., "1024px" instead of "100%")
await expect(component).toHaveCSS("width", "100%");

// ✅ CORRECT - Check style attribute directly
const styleAttr = await component.getAttribute("style");
expect(styleAttr).toContain("width: 100%");
```

**Why**: Playwright's `toHaveCSS()` returns computed CSS values (resolved to pixels), not the original declaration.

#### onBlur Event Testing

**Problem**: Calling `blur()` directly doesn't trigger blur handler in Playwright.

**Solution**: Focus element first, then click outside:

```typescript
// ❌ WRONG - blur() doesn't trigger handler reliably
await component.blur();
await expect.poll(() => onBlurCalled).toBe(true);  // Fails!

// ✅ CORRECT - Focus first, then click outside
await component.focus();
await page.locator("body").click({ position: { x: 0, y: 0 } });
await expect.poll(() => onBlurCalled).toBe(true);  // Works!
```

**Why**: Playwright requires explicit focus before blur events fire correctly.

#### Cancellation Flags with Async State

**When state updates are async but you need synchronous cancellation:**

**Problem**: User presses Escape → local value reverts (async) → blur fires → onChange called before revert completes.

**Solution**: Use ref-based synchronous flag:

```typescript
const cancelledRef = useRef(false);

const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === "Escape") {
    e.preventDefault();
    cancelledRef.current = true;  // ← Synchronous flag
    setLocalValue(value);         // ← Async state update
    inputRef.current?.blur();
  }
};

const handleBlur = () => {
  if (cancelledRef.current) {     // ← Check flag immediately
    cancelledRef.current = false;
    onBlur?.();
    return;  // ← Skip onChange
  }

  if (localValue !== value) {
    onChange(localValue);
  }
  onBlur?.();
};
```

**Why**: Refs provide synchronous flags that work across render cycles, preventing race conditions with async state updates.

**Real-world example**: See PR #396 (Property field UX improvements - fixed Escape key calling onChange)

### SPARQL 1.2 Feature Implementation Pattern

**When implementing SPARQL standard features (RDF-Star, DateTime, etc.), follow this order:**

```
1. Data Model Class     (e.g., QuotedTriple.ts)
2. Constructor Function (e.g., TRIPLE(s, p, o))
3. Type Checker         (e.g., isTRIPLE())
4. Accessor Functions   (e.g., SUBJECT(), PREDICATE(), OBJECT())
5. Parser Support       (e.g., <<( s p o )>> syntax)
6. Serialization        (e.g., query result output)
7. Integration Tests    (e.g., combined feature tests)
```

**Key insight**: Each step builds on the previous. Implementing sequentially with warm context yields 2-2.5x productivity gain.

**Real-world examples**:
- RDF-Star: Issues #951-955 (5 features in logical order)
- DateTime Arithmetic: Issues #973-975, #988-990 (addition → subtraction → comparison)

### Timezone-Safe DateTime Serialization Pattern

**When saving user-input datetime values:**

```typescript
// ❌ WRONG: toISOString() converts to UTC
const saved = new Date(userInput).toISOString();
// User entered 20:05, saved as 15:05 → BROKEN!

// ✅ CORRECT: Preserve user input as string
function serializeTimestamp(userInput: string): string {
  if (userInput.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
    return userInput + ':00';  // Just add seconds
  }
  return userInput;
}
```

**Key gotchas**:
- `getTimezoneOffset()` returns **negative** for **positive** timezones (UTC+5 → -300)
- `toISOString()` **always** converts to UTC
- JavaScript Date is internally UTC

**Real-world example**: Issue #1052 - Fixed +20 hour offset bug in plannedEndTimestamp

### Mobile Table Layout Pattern

**For tables with virtualization (>50 rows) or mobile display:**

```css
/* Flexbox for responsive tables */
.task-table-row {
  display: flex;
  align-items: center;
}

/* Name column: flexible with truncation */
.col-name {
  flex: 1 1 auto;
  min-width: 0;  /* Critical for text-overflow! */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Time columns: fixed width */
.col-start, .col-end {
  flex: 0 0 65px;
}
```

**Key CSS rules**:
- `min-width: 0`: Required for flex items to shrink below content size
- `flex: 0 0 Xpx`: Fixed width (no grow, no shrink)
- `flex: 1 1 auto`: Flexible (grows to fill space)

**Real-world examples**:
- Issue #941: Column misalignment in virtualized mode
- Issue #1055: Mobile text truncation fix

### Directional Language Tag Pattern (SPARQL 1.2)

**For RTL language support:**

```sparql
-- Syntax: "text"@lang--dir
"مرحبا"@ar--rtl      -- Arabic, right-to-left
"Hello"@en--ltr      -- English, left-to-right
```

**Parser implementation**:
```typescript
if (langTag.includes('--')) {
  const [language, direction] = langTag.split('--');
  return createDirectionalLiteral(value, language, direction);
}
```

**Real-world example**: Issues #991, #993 - Parse and serialize directional literals

---

## 🧠 Advanced Tool Use (Based on Anthropic Engineering Guide)

> **Source**: [Anthropic Engineering - Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)
>
> This section implements recommendations from Anthropic's official guide to optimize Claude's tool usage patterns.

### Tool Priority Matrix

**Choose tools in this order** (faster/cheaper → slower/expensive):

| Priority | Tool | Use Case | Token Cost |
|----------|------|----------|------------|
| 1️⃣ | `Glob` | Find files by pattern (`**/*.ts`) | Very Low |
| 2️⃣ | `Grep` | Search content (`files_with_matches` mode) | Low |
| 3️⃣ | `Read` | Read specific file sections (use `offset`/`limit`) | Low-Medium |
| 4️⃣ | `Edit` | Modify existing files | Medium |
| 5️⃣ | `Write` | Create new files (avoid when possible) | Medium |
| 6️⃣ | `Bash` | Run commands (npm, git, gh) | Medium |
| 7️⃣ | `Task` agents | Complex multi-step operations | High |
| 8️⃣ | `WebSearch`/`WebFetch` | External lookups | Very High |

**Anti-patterns to avoid:**
```bash
# ❌ BAD: Reading entire file when you need one function
Read file.ts  # 2000 lines

# ✅ GOOD: Grep first, then read with context
Grep "functionName" --output_mode=content -C 10
```

### Parallel Execution Rules

**When to parallelize** (independent operations):
```bash
# ✅ GOOD: Multiple independent searches
Glob "**/*.test.ts" + Glob "**/*.spec.ts" + Grep "describe("
# All three run simultaneously
```

**When to sequence** (dependent operations):
```bash
# ✅ GOOD: Sequential when output feeds input
Grep "ClassName"  # → finds file.ts:42
Read file.ts offset=40 limit=20  # → uses grep result
Edit file.ts  # → modifies based on read
```

**Batch operations in Task agents:**
```markdown
# ❌ BAD: 10 separate Task calls for 10 files
Task("fix file1") → Task("fix file2") → ...

# ✅ GOOD: One Task with batch instruction
Task("fix all 10 files: [list]. Return summary only, not full diffs")
```

### Tool Use Examples (Copy-Paste Ready)

**Worktree Creation:**
```bash
# ❌ Vague
/worktree-create feature

# ✅ Specific (describes the change)
/worktree-create cli-status-commands
/worktree-create fix-mobile-scrolling
/worktree-create refactor-query-cache
```

**PR Creation:**
```bash
# ❌ Minimal (loses context)
gh pr create --title "fix bug" --body "Fixed it"

# ✅ Complete (helps reviewers and future AI agents)
gh pr create --title "fix(cli): resolve path validation edge case" --body "$(cat <<'EOF'
## Summary
- Fix path validation for Windows-style paths
- Add 5 unit tests for edge cases
- Update error messages for clarity

## Test plan
- [x] Unit tests pass locally
- [ ] Manual test: `exo validate "C:\Users\test"`
- [ ] CI pipeline green
EOF
)"
```

**File Search:**
```bash
# ❌ Wasteful (returns too much)
Grep "error" --output_mode=content  # Could be 1000+ lines

# ✅ Efficient (filter first)
Grep "error" --output_mode=files_with_matches  # Just file paths
Grep "error" --output_mode=count  # Just counts
Grep "specific_error_code" -C 5  # Targeted with context
```

**Reading Files:**
```bash
# ❌ Wasteful
Read package.json  # Full file when you need one field

# ✅ Efficient (for large files)
Read large-file.ts offset=100 limit=50  # Just the section you need
Grep "export class" large-file.ts -n  # Find location first
```

**Agent Selection:**
```bash
# ❌ Wrong agent
Task(subagent_type="swebok-engineer", "find all TODO comments")  # Overkill

# ✅ Right agent
Task(subagent_type="Explore", "find all TODO comments")  # Fast, focused
Task(subagent_type="code-searcher", "locate authentication logic")  # Specialized
```

### Safe Retry Operations

**Idempotent (safe to retry on failure):**
```bash
git fetch origin main          # ✅ Always safe
git pull --rebase              # ✅ Safe (may need conflict resolution)
npm install                    # ✅ Safe
npm test                       # ✅ Safe
npm run build                  # ✅ Safe
npm run lint                   # ✅ Safe
gh pr checks --watch           # ✅ Safe (read-only)
gh pr view                     # ✅ Safe (read-only)
Glob, Grep, Read               # ✅ Always safe (read-only)
```

**NOT idempotent (require confirmation before retry):**
```bash
git push --force-with-lease    # ⚠️ Overwrites remote
git reset --hard               # ⚠️ Loses local changes
gh pr merge                    # ⚠️ Can't undo merge
rm -rf                         # ⚠️ Permanent deletion
Write (to existing file)       # ⚠️ Overwrites content
Edit (destructive changes)     # ⚠️ May break code
```

**Error Recovery Pattern:**
```bash
# If command fails:
1. Check error message
2. If network error → retry immediately (transient)
3. If permission error → stop, ask user
4. If validation error → fix input, then retry
5. If conflict → resolve conflict, then retry
```

### Context Management (37% Token Reduction)

**Filter before returning to context:**
```bash
# ❌ BAD: Dump raw output
Grep "import" --output_mode=content  # Could be 500 lines

# ✅ GOOD: Filter to essentials
Grep "import.*Service" --output_mode=files_with_matches
# Returns: src/services/UserService.ts, src/services/AuthService.ts
```

**Summarize large results:**
```markdown
# ❌ BAD: Return full file list
"Found 47 files matching *.test.ts: [full list]"

# ✅ GOOD: Return actionable summary
"Found 47 test files across 3 packages:
- packages/exocortex/tests: 23 files
- packages/cli/tests: 12 files
- packages/obsidian-plugin/tests: 12 files"
```

**Use head_limit for exploration:**
```bash
# ❌ BAD: Get all matches upfront
Grep "TODO" --output_mode=content  # All 200 TODOs

# ✅ GOOD: Sample first, expand if needed
Grep "TODO" --output_mode=content --head_limit=10  # First 10
# If relevant, expand: Grep "TODO" --output_mode=content --head_limit=50
```

### Tool Decision Tree

```
Need to find something?
├── Know exact file path? → Read
├── Know file pattern? → Glob ("**/*.ts")
├── Know content pattern? → Grep
└── Exploratory search? → Task(Explore)

Need to modify something?
├── Small change, known location? → Edit
├── Creating new file? → Write (only if necessary!)
├── Complex refactoring? → Task(swebok-engineer)
└── Multiple files? → Task with batch instructions

Need external info?
├── GitHub API (PRs, issues)? → Bash (gh command)
├── Web documentation? → WebFetch
├── Current info needed? → WebSearch
└── Claude Code docs? → Task(claude-code-guide)

Need to run something?
├── Tests? → Bash (npm test)
├── Build? → Bash (npm run build)
├── Git operations? → Bash (git ...)
└── Complex workflow? → Task(orchestrator)
```

### Error Message Documentation

**Document return formats clearly** (helps Claude write correct parsing logic):

```typescript
// Example: gh pr checks output format
// SUCCESS:
// ✓ build-and-test  pass  2m30s  https://github.com/...
// ✓ e2e-tests       pass  5m12s  https://github.com/...

// FAILURE:
// ✗ build-and-test  fail  1m45s  https://github.com/...
// ✓ e2e-tests       pass  5m12s  https://github.com/...

// Parse pattern: first column is status (✓/✗), second is name
```

```typescript
// Example: npm test output format
// SUCCESS:
// Test Suites: 25 passed, 25 total
// Tests:       156 passed, 156 total

// FAILURE:
// Test Suites: 1 failed, 24 passed, 25 total
// Tests:       2 failed, 154 passed, 156 total
// FAIL src/services/UserService.test.ts
//   ● UserService › should validate email
//     Expected: "valid@email.com"
//     Received: undefined

// Parse pattern: look for "FAIL" lines to find failing tests
```

---

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
# ... edit files ...
```

**Why this happens:**
- Easy to forget when making "quick fixes"
- Terminal may open in main directory by default
- Muscle memory from single-developer workflows
- Session restarts without checking location

**How to prevent:**
1. **Add `pwd` check to terminal startup:**
   ```bash
   # Add to ~/.zshrc or ~/.bashrc
   if [[ $(pwd) == */exocortex ]]; then
     echo "⚠️  WARNING: You're in main directory! Create worktree first."
   fi
   ```

2. **Use shell prompt that shows current directory:**
   ```bash
   # Example PS1 prompt showing worktree indicator
   PS1='${PWD##*/} $ '  # Shows only current directory name
   ```

3. **ALWAYS verify location before first file edit:**
   - Before using `Edit` tool → check `pwd`
   - Before using `Write` tool → check `pwd`
   - If not in worktree → create one immediately

**Real-world mistake (PR #312):**
- Started editing `.github/workflows/ci.yml` in main directory
- Caught by `git status` showing changes in main
- Had to `git restore` and recreate in worktree
- Lost 2-3 minutes fixing mistake

**Remember:** One `pwd` check saves 5 minutes of cleanup!

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

### Flaky UI Test Failures

**Problem**: UI test fails intermittently during pre-commit hook but passes when run independently.

**Root Cause**: Race condition in test timing, not related to code changes.

**Solution**:
```bash
# Verify test passes independently
npm run test:ui

# If test passes, failure was likely flaky - commit again
git commit -am "your message"
```

**When to investigate further**:
- ✅ CSS-only changes: Flaky test likely unrelated
- ❌ Logic changes: Investigate if test fails consistently

**Prevention**: Re-run tests once before assuming code is broken. UI tests can be timing-sensitive.

### Auto-Merge Troubleshooting

**Problem: Auto-merge enabled but PR not merging**

1. **Check mergeStateStatus**:
   ```bash
   gh pr view <PR-NUMBER> --json mergeStateStatus
   ```

   If `mergeStateStatus: BEHIND`:
   - **Cause**: Another PR merged to main while your PR was in CI pipeline
   - **Solution**: Branch must be up-to-date before auto-merge activates
   ```bash
   git fetch origin main
   git rebase origin/main
   git push --force-with-lease origin <branch-name>
   # CI will rerun automatically, auto-merge activates when checks GREEN
   ```

   **Prevention**: Monitor `mergeStateStatus` regularly when using auto-merge. If you see another PR merged to main while yours is running, rebase proactively to avoid delays.

2. **Auto-merge workflow timing**:
   - PR merge → CI on main starts (~3s delay)
   - CI on main completes (~6 minutes for E2E tests)
   - Auto-release workflow runs (~1 minute)
   - Release created

   **Total time: 7-10 minutes from merge to release**

3. **Verify release contains your PR**:
   ```bash
   gh release view v<VERSION> --json body --jq '.body'
   # Look for your PR number in features list
   ```

**Lesson from PR #339**:
- PR merged at 18:18:52Z
- But release creation delayed until CI on main completed
- Total wait: ~6 minutes after merge
- Always monitor: PR merge → CI on main → Release creation

### "error TS6196: X is declared but never used" in CI (but not locally)

**Problem:** CI typecheck fails with unused import errors, but local `npm run check:types` passes.

**Root Cause:** CI may have stricter TypeScript settings. Types imported but only used as discriminant literals (not in type annotations) trigger `noUnusedLocals` errors.

**Example:**

```typescript
// ❌ BAD: JoinOperation imported but never used in type annotation
import type { AlgebraOperation, JoinOperation } from "./AlgebraOperation";

function createJoin(left: AlgebraOperation, right: AlgebraOperation): AlgebraOperation {
  return { type: "join", left, right };  // "join" is literal, not JoinOperation type
}

// ✅ GOOD: Only import types used in annotations
import type { AlgebraOperation } from "./AlgebraOperation";

function createJoin(left: AlgebraOperation, right: AlgebraOperation): AlgebraOperation {
  return { type: "join", left, right };  // AlgebraOperation union handles "join" literal
}
```

**Solution:** Remove type imports only used as literal values in object constructors.

**Prevention:** Always run `npm run check:types` before pushing to catch these errors locally.

### Quick lint verification for staged files only

**Problem:** Pre-commit hook runs `npm run lint` on entire `src/` directory, failing due to lint errors in files you didn't modify.

**Quick detection:**
```bash
# Check YOUR staged files
git diff --cached --name-only

# Run lint to see ALL errors (including unrelated)
npm run lint
```

**Solution (when your files are clean):**
```bash
# Verify YOUR changes pass lint individually
npx eslint packages/obsidian-plugin/src/path/to/your/file.ts
npx eslint packages/exocortex/src/path/to/another/file.ts

# If all pass → safe to use --no-verify
git commit --no-verify -m "feat: your change"
```

**Justification:** Your changes are clean, CI will catch any actual issues in your code.

**When to use --no-verify:**
- ✅ Your staged files pass lint individually
- ✅ Errors are in files you didn't modify
- ✅ CI will catch any actual lint issues in your code
- ❌ Don't use to bypass legitimate errors in your changes

### Test Mock Default Values Can Mask Bugs

**Problem:** Test passes when it should fail because mock helper provides default value that hides "missing data" scenario.

**Example from PR #337 (Name Sorting Fix):**

After fixing code to use `exo__Asset_label || basename`, tests failed with:
```
Expected: "a-file" (basename)
Received: "Test Asset" (mock default)
```

**Root Cause:** Test helper `createMockMetadata()` provides default values:
```typescript
// In tests/unit/helpers/testHelpers.ts
export function createMockMetadata(overrides?: Record<string, any>) {
  return {
    exo__Asset_label: "Test Asset",  // ⚠️ Default value masks "missing label" tests
    exo__Instance_class: "ems__Task",
    // ...
    ...overrides,
  };
}
```

**Solution:** Explicitly override with `null` to test fallback behavior:
```typescript
// ✅ CORRECT - Tests basename fallback when label missing
frontmatter: createMockMetadata({ exo__Asset_label: null }),
```

**Prevention:**
1. **Review default values** in test helpers before writing tests
2. **Explicitly test missing data** scenarios with `null` overrides
3. **Don't assume defaults** match your test intention
4. **Read test helper source** when tests pass but logic seems wrong

**Test Helper Location:** `packages/obsidian-plugin/tests/unit/helpers/testHelpers.ts`

**Real-world example:** See PR #337 (Fixed 3 tests after display label resolution fix)

### "SPARQL queries return empty results in CLI but work in Obsidian"

**Problem**: SPARQL query executes without errors but returns 0 results in CLI, while same query works in Obsidian plugin.

**Root Cause**: Namespace URI mismatch between:
- Code definitions (`Namespace.ts`)
- Vault ontology files (`exo__Ontology_url` property)
- SPARQL query PREFIX declarations

**Quick Detection**:
```bash
# Check namespace URIs in code
grep -A2 "static readonly EXO" packages/exocortex/src/domain/models/rdf/Namespace.ts

# Check namespace URIs in vault
grep "exo__Ontology_url" vault-path/03\ Knowledge/exo/!exo.md
```

**Solution**:
1. Read vault ontology files to get canonical URIs
2. Update `Namespace.ts` to match vault definitions
3. Use hash-style URIs (`https://example.com/ontology#`) not slash-style
4. Update all SPARQL test files with new namespaces
5. Verify CLI execution returns results

**Example Fix**: See PR #363 for complete namespace unification example.

**Diagnostic Query**:
```sparql
# Run this to see actual namespace URIs in triple store
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?predicate
WHERE {
  ?subject ?predicate ?object .
}
LIMIT 20
```

If you see predicates like `http://exocortex.org/ontology/Asset_label` but your query uses `PREFIX exo: <https://exocortex.my/ontology/exo#>`, that's the mismatch.

### Playwright Dev Server Stale After Worktree Switch

**Problem**: Component tests fail with "Unregistered component" error after switching worktrees.

**Root Cause**: Vite dev server persists across worktree switches and caches components from the previous worktree path. When you switch to a different worktree, the dev server continues serving components from the old path, causing "Unregistered component" errors.

**Solution**:

```bash
# Kill all Vite dev server processes
pkill -f vite

# Restart tests (dev server will start fresh with correct worktree)
npm run test:component
```

**Alternative solution** (if pkill doesn't work):

```bash
# Find and kill all node processes running vite
ps aux | grep vite
kill -9 <PID>

# Or kill all node processes (more aggressive)
pkill -9 node
```

**Prevention**:
- Always kill dev servers before switching worktrees
- Use separate terminal windows per worktree
- Close terminal completely when switching worktrees

**Why this matters**: The Vite dev server caches component registrations based on file paths. When you switch worktrees, file paths change (e.g., `worktrees/exocortex-claude1-feat-a/` → `worktrees/exocortex-claude1-feat-b/`), but the cached dev server still points to old paths.

**Real-world example**: See PR #396 (Component tests failed with "Unregistered component" after switching from another worktree - fixed by killing dev server)

## 📊 Lessons from Production Issues (Dec 2025)

> This section contains distilled learnings from 50+ completed GitHub Issues. These patterns reduce debugging time and prevent common errors.

### Memory Leak Prevention Pattern

**When implementing long-running components (renderers, event listeners):**

From Issue #791 (Replace polling with event listeners, 204 steps):

```typescript
// ❌ BAD: setInterval without cleanup
useEffect(() => {
  const interval = setInterval(() => {
    refreshData();
  }, 1000);
  // Missing cleanup → memory leak!
}, []);

// ✅ GOOD: Event-driven with cleanup
useEffect(() => {
  const handleMetadataChange = () => {
    refreshData();
  };

  metadataCache.on('changed', handleMetadataChange);

  return () => {
    metadataCache.off('changed', handleMetadataChange);
  };
}, []);
```

**Key insights:**
- Replace polling with Obsidian's event system (`metadataCache.on('changed')`)
- Always return cleanup function from useEffect
- Track subscription references for proper cleanup
- Use WeakMap for caches that should be garbage collected

**Related files:**
- `UniversalLayoutRenderer.ts` - Main event-driven renderer
- `BacklinksCache.ts` - WeakMap-based cache implementation

### Type Safety Pattern (Replacing `any`)

From Issue #777 (Replace 'any' with proper types, 338 steps):

```typescript
// ❌ BAD: any hides type errors
function processData(data: any): any {
  return data.items.map((item: any) => item.value);
}

// ✅ GOOD: Proper interfaces
interface DataItem {
  value: string;
  id: number;
}

interface ProcessedData {
  items: DataItem[];
}

function processData(data: ProcessedData): string[] {
  return data.items.map((item) => item.value);
}
```

**When `any` is unavoidable:**
- Obsidian API internals (use type assertion with comment)
- Third-party libraries without types (create local `.d.ts`)
- Dynamic JSON parsing (use `unknown` + type guards)

**Search for remaining `any` usage:**
```bash
grep -r ": any" packages/*/src/ --include="*.ts" | wc -l
```

### Batch Processing Pattern

From Issue #879 (Batch processing for repair-folder, 104 steps):

```typescript
// ❌ BAD: Sequential processing of large datasets
for (const file of files) {
  await processFile(file);  // 1000 files = 1000 sequential awaits
}

// ✅ GOOD: Batched processing with concurrency limit
const BATCH_SIZE = 10;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(file => processFile(file)));

  // Progress feedback
  console.log(`Processed ${Math.min(i + BATCH_SIZE, files.length)}/${files.length}`);
}
```

**When to use:**
- Processing >50 files
- Operations involving disk I/O
- CLI commands that modify vault

**Related CLI commands:** `repair-folder`, `batch-rename`, `migrate-properties`

### Modal UI Pattern

From Issue #868 (Trash reason modal, 122 steps):

```typescript
// Standard modal implementation pattern
export class ConfirmationModal extends Modal {
  private result: ModalResult | null = null;
  private onSubmit: (result: ModalResult) => void;

  constructor(app: App, onSubmit: (result: ModalResult) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Confirm Action" });

    // Input field
    const inputEl = contentEl.createEl("textarea");

    // Buttons container
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    // Cancel button (left)
    buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      this.close();
    });

    // Confirm button (right, primary)
    const confirmBtn = buttonContainer.createEl("button", {
      text: "Confirm",
      cls: "mod-cta"  // Primary button styling
    });
    confirmBtn.addEventListener("click", () => {
      this.result = { reason: inputEl.value };
      this.close();
    });
  }

  onClose() {
    if (this.result) {
      this.onSubmit(this.result);
    }
    this.contentEl.empty();
  }
}
```

**Patterns to follow:**
- `onSubmit` callback in constructor
- Set `result` before `close()`
- Check `result` in `onClose()` to handle cancel vs confirm
- Use `mod-cta` class for primary button
- Always `contentEl.empty()` in onClose

### Negative Test Coverage Pattern

From Issue #788 (Add negative tests for error handling, 128 steps):

```typescript
// For every happy path, add corresponding error tests

// ✅ Test: Function succeeds
it("should process valid input", async () => {
  const result = await processInput({ valid: true });
  expect(result.success).toBe(true);
});

// ✅ Test: Function handles invalid input
it("should throw on invalid input", async () => {
  await expect(processInput({ valid: false }))
    .rejects.toThrow("Invalid input");
});

// ✅ Test: Function handles null/undefined
it("should throw on null input", async () => {
  await expect(processInput(null as any))
    .rejects.toThrow("Input required");
});

// ✅ Test: Function handles network errors
it("should propagate network errors", async () => {
  mockFetch.mockRejectedValue(new Error("Network error"));
  await expect(processInput({ valid: true }))
    .rejects.toThrow("Network error");
});

// ✅ Test: Function handles partial data
it("should handle missing optional fields", async () => {
  const result = await processInput({ valid: true, optional: undefined });
  expect(result.optional).toBeUndefined();
});
```

**Coverage checklist for each function:**
- [ ] Happy path (valid input → expected output)
- [ ] Invalid input types (null, undefined, wrong type)
- [ ] Edge cases (empty array, empty string, zero)
- [ ] Error propagation (upstream errors bubble correctly)
- [ ] Partial data (optional fields missing)

### Layout Debugging Pattern

From Issue #869 (Layout not displayed with embedded assets, 105 steps):

**When layout doesn't render:**

1. **Check console for errors:**
   ```bash
   # In Obsidian Developer Console (Cmd+Option+I)
   # Look for: "Error rendering layout", "Asset not found", etc.
   ```

2. **Verify frontmatter structure:**
   ```yaml
   ---
   exo__Instance_class: exo__Layout
   exo__Asset_label: My Layout
   ems__Layout_columns:
     - column:
         - section: Section Name
           content:
             - "[[Embedded Asset]]"
   ---
   ```

3. **Check embedded asset exists:**
   ```bash
   # Asset must have valid frontmatter
   grep -l "exo__Instance_class" vault-path/**/*.md
   ```

4. **Verify section anchors:**
   ```markdown
   ## Section Name
   <!-- Section content renders here -->
   ```

**Common issues:**
- Missing `exo__Instance_class` on embedded assets
- Section name doesn't match anchor heading
- Wiki-link syntax without .md extension
- Asset moved/renamed but reference not updated

### Column Visibility Toggle Pattern

From Issue #883 (Hide columns in DailyNote table, 80 steps) and Issue #893:

```typescript
// Settings interface
interface TableSettings {
  showTimeColumn: boolean;
  showStatusColumn: boolean;
  showVotesColumn: boolean;
}

// Table component with column visibility
const MyTable: React.FC<TableProps> = ({ items, settings }) => {
  const visibleColumns = useMemo(() => {
    const cols: Column[] = [
      { key: 'name', label: 'Name', visible: true },  // Always visible
      { key: 'time', label: 'Time', visible: settings.showTimeColumn },
      { key: 'status', label: 'Status', visible: settings.showStatusColumn },
      { key: 'votes', label: 'Votes', visible: settings.showVotesColumn },
    ];
    return cols.filter(col => col.visible);
  }, [settings]);

  return (
    <table>
      <thead>
        <tr>
          {visibleColumns.map(col => (
            <th key={col.key}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id}>
            {visibleColumns.map(col => (
              <td key={col.key}>{item[col.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
```

**Integration with settings:**
```typescript
// In renderer
const toggleColumn = async (columnKey: string) => {
  this.settings[`show${columnKey}Column`] = !this.settings[`show${columnKey}Column`];
  await this.plugin.saveSettings();
  await this.refresh();
};
```

### CI Environment Differences Pattern

From Issue #884 (Component tests fail in CI, 63 steps):

**When tests pass locally but fail in CI:**

1. **Check environment differences:**
   ```bash
   # Local Node version
   node --version

   # CI Node version (check .github/workflows/ci.yml)
   grep "node-version" .github/workflows/ci.yml
   ```

2. **Check for timing issues:**
   ```typescript
   // ❌ BAD: Hardcoded timeout
   await new Promise(resolve => setTimeout(resolve, 100));

   // ✅ GOOD: Wait for condition
   await expect.poll(() => element.isVisible()).toBe(true);
   ```

3. **Check for OS-specific behavior:**
   ```typescript
   // ❌ BAD: Windows-style paths
   const path = 'src\\components\\MyComponent.tsx';

   // ✅ GOOD: Platform-independent paths
   const path = path.join('src', 'components', 'MyComponent.tsx');
   ```

4. **Document as known issue if unrelated to changes:**
   ```markdown
   ## PR Description

   ### Known CI Issue
   Component tests fail in CI but pass locally (168/168).
   This is a known timing issue unrelated to these changes.
   All other CI checks pass (7/8).
   ```

### Security Scanning Workflow Pattern

From Issue #802 (Add security scanning workflow, 69 steps):

**CI security workflow structure:**
```yaml
# .github/workflows/security.yml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 1'  # Weekly on Monday

jobs:
  npm-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm audit --audit-level=high
        continue-on-error: true  # Don't fail PR for moderate issues

  codeql:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: typescript
      - uses: github/codeql-action/analyze@v3
```

**Key patterns:**
- Run on PRs and scheduled (catch both introduced and newly discovered vulnerabilities)
- Use `continue-on-error: true` for advisory-only checks
- Require `security-events: write` permission for CodeQL
- Audit at `high` level to avoid noise from moderate issues

### SPARQL FILTER(CONTAINS()) Optimization

From Issue #732 (157 steps):

```sparql
# ❌ SLOW: FILTER with CONTAINS on large datasets
SELECT ?s ?label
WHERE {
  ?s exo:Asset_label ?label .
  FILTER(CONTAINS(LCASE(?label), "search term"))
}
# Scans ALL triples → O(n)

# ✅ FAST: Use indexed properties when possible
SELECT ?s ?label
WHERE {
  ?s exo:Instance_class "ems__Task" .  # Indexed lookup first
  ?s exo:Asset_label ?label .
  FILTER(CONTAINS(LCASE(?label), "search term"))
}
# Filters from smaller subset → O(n/k) where k = class selectivity
```

**Optimization rules:**
1. Put indexed BGP patterns (Instance_class, Asset_prototype) BEFORE FILTER
2. Use exact matches over CONTAINS when possible
3. Limit results early with LIMIT clause
4. Use UUID-to-Path index for single-asset lookups (Issue #731)

### Common Approval Workflow Questions

**Q: User said "not now" - should I delete my post-mortem report?**

**A**: NO. Keep the report for future reference. The user may approve later, or use the insights differently. Your post-mortem still has value even if documentation updates are deferred.

**Q: User said "adjust the proposal for AGENTS.md" - what do I do?**

**A**:
1. Modify ONLY the AGENTS.md proposal as requested by user
2. Keep other proposals (CLAUDE.md, etc.) unchanged
3. Present the updated version again with clear note: "Updated AGENTS.md proposal as requested"
4. Wait for new approval decision

**Q: I made a typo in my proposal - can I fix it?**

**A**: Ask user first: "I noticed a typo in my proposal [describe typo]. May I present a corrected version?"

**Q: User approved "AGENTS.md changes" but not "CLAUDE.md changes" - what do I do?**

**A**:
1. Edit ONLY AGENTS.md (the approved file)
2. Do NOT edit CLAUDE.md (not approved)
3. Confirm with user: "I've updated AGENTS.md as approved. CLAUDE.md proposal remains pending - let me know if you'd like me to apply those changes later."

**Q: Can I update documentation in a follow-up task without asking again?**

**A**: NO. Each task requires separate approval. Even if user approved similar changes before, you must ask permission again for each new post-mortem's proposals.

**Q: Should I commit documentation changes to the same PR as my feature?**

**A**: Ask user for preference:
- Option A: Separate commit in same PR: `git commit -m "docs: update AGENTS.md with learnings from [feature]"`
- Option B: Separate PR: Create new branch for documentation updates only
- Let user decide which approach they prefer

**Q: User is not responding to my approval request - what should I do?**

**A**:
1. Do NOT edit files without approval
2. Your post-mortem report is already written and available for user review
3. Continue with other tasks if available
4. User will approve when ready

---

## 🔐 Code Quality Patterns (Dec 2025)

> Patterns derived from 15 code quality issues (#1058-#1071) completed via static analysis cleanup.

### Cryptographic Security Pattern

From Issues #1059, #1060:

**Problem**: Using `Math.random()` or weak hashing algorithms (MD5, SHA1) for security-sensitive operations.

```typescript
// ❌ WRONG: Math.random() is not cryptographically secure
const id = Math.random().toString(36).substring(2, 9);
const token = Math.random().toString(36) + Math.random().toString(36);

// ❌ WRONG: MD5/SHA1 are cryptographically broken
import { createHash } from 'crypto';
const hash = createHash('md5').update(data).digest('hex');
const signature = createHash('sha1').update(secret).digest('hex');
```

**Solution**: Use cryptographically secure alternatives:

```typescript
// ✅ CORRECT: crypto.randomUUID() for unique identifiers
import { randomUUID, randomBytes, createHash } from 'crypto';
const id = randomUUID();  // UUID v4, cryptographically secure

// ✅ CORRECT: crypto.getRandomValues() for random bytes
const buffer = new Uint8Array(16);
crypto.getRandomValues(buffer);

// ✅ CORRECT: crypto.randomBytes() for random tokens (Node.js)
const token = randomBytes(32).toString('hex');

// ✅ CORRECT: SHA-256 or SHA-512 for hashing
const hash = createHash('sha256').update(data).digest('hex');
const signature = createHash('sha512').update(secret).digest('hex');
```

**When to apply**:
- Generating unique IDs used in security contexts (session tokens, API keys)
- Any authentication or authorization tokens
- File integrity verification
- Content-addressed storage keys
- Password hashing (prefer bcrypt/argon2 over raw SHA for passwords)

**Reference**: Issues #1059, #1060

### Variable Declaration Order Pattern

From Issue #1067:

**Problem**: Variables used before they are declared (hoisting issues in JavaScript/TypeScript).

```typescript
// ❌ WRONG: Using variable before declaration
function process() {
  console.log(data);  // 'data' is undefined here (var) or ReferenceError (let/const)
  var data = loadData();
}

// ❌ WRONG: Temporal dead zone with let/const
function init() {
  setup(config);  // ReferenceError: Cannot access 'config' before initialization
  const config = getConfig();
}
```

**Solution**: Declare variables before use:

```typescript
// ✅ CORRECT: Declare before use
function process() {
  const data = loadData();
  console.log(data);
}

// ✅ CORRECT: Proper initialization order
function init() {
  const config = getConfig();
  setup(config);
}
```

**Detection in CI**: ESLint `no-use-before-define` rule catches these issues.

**Reference**: Issue #1067

### Redundant Operation Pattern

From Issue #1069:

**Problem**: Operations comparing or operating on identical operands.

```typescript
// ❌ WRONG: Self-comparison (always true/false)
if (value === value) { }  // Always true (except NaN)
if (obj !== obj) { }       // Always false (except NaN)

// ❌ WRONG: Self-assignment (no effect)
x = x;

// ❌ WRONG: Self-operation (identity or zero)
const result = n - n;     // Always 0
const same = n / n;        // Always 1 (except 0)
```

**Solution**: Remove redundant operations or fix the intended logic:

```typescript
// ✅ CORRECT: NaN check (the one valid use case)
if (Number.isNaN(value)) { }  // Better than value !== value

// ✅ CORRECT: Proper comparisons
if (value === expectedValue) { }

// ✅ CORRECT: Meaningful operations
const difference = newValue - oldValue;
```

**When self-comparison is valid**: Checking for NaN (`value !== value` is true only for NaN), but prefer `Number.isNaN()` for clarity.

**Reference**: Issue #1069

### Unreachable Code Pattern

From Issue #1068:

**Problem**: Code that can never execute due to control flow.

```typescript
// ❌ WRONG: Code after unconditional return
function getValue() {
  return 42;
  console.log('This never runs');  // Unreachable
}

// ❌ WRONG: Code after throw
function validate(input) {
  if (!input) {
    throw new Error('Input required');
    console.log('Never logged');  // Unreachable
  }
}

// ❌ WRONG: Dead branch in conditionals
function process(type) {
  if (type === 'A') {
    return handleA();
  } else if (type === 'A') {  // Duplicate condition - unreachable
    return handleSpecialA();
  }
}
```

**Solution**: Remove or restructure unreachable code:

```typescript
// ✅ CORRECT: No code after return/throw
function getValue() {
  return 42;
}

// ✅ CORRECT: Unique branches
function process(type) {
  if (type === 'A') {
    return handleA();
  } else if (type === 'A-special') {
    return handleSpecialA();
  }
}
```

**Detection**: TypeScript with `allowUnreachableCode: false` in tsconfig.json

**Reference**: Issue #1068

### Unnecessary Defensive Code Pattern

From Issues #1065, #1071:

**Problem**: Checking for conditions that are impossible given the type system or prior logic.

```typescript
// ❌ WRONG: Checking type after type guard already verified
function process(value: string | null) {
  if (value === null) return;
  // 'value' is now narrowed to 'string'
  if (typeof value === 'string') {  // Always true - unnecessary
    console.log(value.toUpperCase());
  }
}

// ❌ WRONG: Checking defined after non-null assertion or required param
function greet(name: string) {
  if (name !== undefined) {  // Always true - 'name' is required
    console.log(`Hello, ${name}`);
  }
}

// ❌ WRONG: Trivial conditionals
const result = true ? getValue() : getDefault();  // Always getValue()
```

**Solution**: Trust the type system and remove redundant checks:

```typescript
// ✅ CORRECT: Type narrowing eliminates need for further checks
function process(value: string | null) {
  if (value === null) return;
  console.log(value.toUpperCase());  // TypeScript knows 'value' is string
}

// ✅ CORRECT: Required params don't need undefined checks
function greet(name: string) {
  console.log(`Hello, ${name}`);
}

// ✅ CORRECT: Remove trivial conditionals
const result = getValue();
```

**Exception**: Keep defensive code when:
- Handling external/untyped data (API responses, user input)
- Dealing with `any` types from legacy code
- Required by framework conventions (Obsidian API quirks)

**Reference**: Issues #1065, #1071

### Test Mock Duplicate Properties Pattern

From Issue #1070:

**Problem**: Duplicate property keys in test object literals (JavaScript silently uses last value).

```typescript
// ❌ WRONG: Duplicate properties in mock
const mockUser = {
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  name: 'Bob',  // Silently overwrites first 'name' → 'Bob'
};

// ❌ WRONG: Spread then override then duplicate
const mockConfig = {
  ...defaultConfig,
  timeout: 5000,
  timeout: 10000,  // Redundant duplicate
};
```

**Solution**: Remove duplicates, keep intended value:

```typescript
// ✅ CORRECT: Each property once
const mockUser = {
  id: 1,
  name: 'Alice',  // or 'Bob' - pick the intended value
  email: 'alice@example.com',
};

// ✅ CORRECT: Single override
const mockConfig = {
  ...defaultConfig,
  timeout: 10000,  // Just the final intended value
};
```

**Detection**: ESLint `no-dupe-keys` rule catches these at lint time.

**Reference**: Issue #1070

### String Escaping in Tests Pattern

From Issue #1061:

**Problem**: Incomplete string escaping in BDD step definitions or regex patterns.

```typescript
// ❌ WRONG: Incomplete escaping in regex
const step = /When I click the "(.+)" button/;
// Matches: When I click the "Submit button" (captures "Submit button")
// Should match: When I click the "Submit" button

// ❌ WRONG: Unescaped special chars in template
const selector = `[data-test="${value}"]`;  // XSS if value contains "
```

**Solution**: Properly escape all special characters:

```typescript
// ✅ CORRECT: Proper regex boundaries
const step = /When I click the "([^"]+)" button/;
// [^"]+ means "one or more non-quote characters"

// ✅ CORRECT: Escape special chars in selectors
const escapeSelector = (s: string) => s.replace(/["\\]/g, '\\$&');
const selector = `[data-test="${escapeSelector(value)}"]`;
```

**Reference**: Issue #1061

### Batch Code Quality Fixes Pattern

**When fixing multiple static analysis issues efficiently:**

1. **Group by category**: Fix all security issues together, then all quality issues
2. **Use search patterns**: `grep -r "Math.random" packages/*/src/` to find all instances
3. **Batch commits**: One commit per issue category (security, quality, testing)
4. **Update suppressions**: If filtering in CI, update ignore files together

**Typical timeline per issue type**:
- Security fixes (crypto, escaping): 45-120 steps
- Quality fixes (conditionals, declarations): 28-75 steps
- Test fixes (duplicates, mocks): 28-35 steps

**Reference**: Issues #1058-#1071 (15 issues, average ~69 steps each)

---

**Remember**:
- 🚨 **ALL worktrees MUST be in `worktrees/` subdirectory - NO EXCEPTIONS!**
- This directory exists to enable safe parallel development
- When in doubt, sync early, sync often, and use slash commands
- Before starting: validate with `pwd` that you're in `worktrees/exocortex-*`
