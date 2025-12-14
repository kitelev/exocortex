# Exocortex Development - AI Agent Coordination Hub

> **Universal AI Agent Instructions**: This file follows the [AGENTS.md standard](https://agents.md/) and works with Claude Code, GitHub Copilot, Cursor, Google Jules, OpenAI Codex, Aider, and 20+ other AI coding assistants.

## 🎯 Project Context: AI-Driven Knowledge Management

**What is Exocortex?**

Exocortex is a **knowledge management system** that gives users convenient control over all their knowledge. Started as an Obsidian plugin for ontology-driven layouts (Areas → Projects → Tasks), it has evolved into a larger system with CLI capabilities and advanced semantic features.

**Core Philosophy**: AI-driven development
- This project is developed **exclusively by AI agents**
- Each session runs **parallel and independent** of which agent is used
- **Continuous self-improvement** of AI instructions based on learned experience

**Product Capabilities**:
- Renders ontology-driven layouts inside Obsidian
- Links hierarchical knowledge structures (Areas → Projects → Tasks)
- Tracks effort history and work state transitions
- Surfaces vote-based prioritization signals
- CLI tools for automation (`packages/cli`)
- Shared semantic utilities (`packages/exocortex`)

**Architecture**: Clean Architecture with strict layering
- `src/presentation` - UI components and renderers
- `src/application` - Use cases and orchestration
- `src/domain` - Pure business logic (framework-independent)
- `src/infrastructure` - I/O, external dependencies, Obsidian API
- `packages/exocortex` - Shared utilities across all packages
- `packages/cli` - Command-line interface tools

---

## 🚨 RULE #1 (MOST CRITICAL): WORKTREES ONLY

**⚠️ THIS IS THE MOST IMPORTANT RULE - VIOLATION IS UNACCEPTABLE ⚠️**

**The `exocortex/` directory is STRICTLY READ-ONLY.**

ALL code changes MUST happen through git worktrees in the `worktrees/` subdirectory.

### Why This Rule Exists

1. **Parallel AI agent work**: Multiple agents work simultaneously without conflicts
2. **Safe experimentation**: Each worktree is isolated sandbox
3. **Clean coordination**: Git worktrees show active work across all agents
4. **Prevents corruption**: Main repository stays pristine

### Enforcement

**❌ ABSOLUTELY FORBIDDEN:**
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
vim src/some-file.ts              # ❌ NEVER DO THIS!
git commit -am "changes"          # ❌ BLOCKED!
```

**✅ ONLY CORRECT WAY:**
```bash
# 1. Create worktree
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree add ../worktrees/exocortex-[agent]-[type]-[task] -b feature/[task]

# 2. Work in worktree
cd ../worktrees/exocortex-[agent]-[type]-[task]
vim src/some-file.ts              # ✅ CORRECT!
git commit -am "feat: changes"    # ✅ SAFE!
```

### Validation Before Starting Work

**ALWAYS verify your location:**
```bash
pwd
# MUST output: .../exocortex-development/worktrees/exocortex-*
# If "worktrees/" is missing → STOP IMMEDIATELY!
```

---

## 🚨 RULE #2 (SECOND MOST CRITICAL): MANDATORY SELF-IMPROVEMENT

**⚠️ EVERY COMPLETED TASK MUST PRODUCE POST-MORTEM WITH IMPROVEMENT PROPOSALS ⚠️**

This project evolves through **iterative self-improvement** of AI agent instructions. Your experience is valuable data for future agents.

### Post-Mortem Report (MANDATORY)

After EVERY completed task, you MUST:

1. **Document errors encountered** - Every error, no matter how small
2. **Describe solutions applied** - Exact steps that fixed each error
3. **Extract lessons learned** - Patterns, insights, gotchas discovered
4. **Propose documentation improvements** - Specific additions to AGENTS.md, CLAUDE.md, etc.
5. **WAIT FOR USER APPROVAL** - Present report to user, get explicit permission before editing any files

### ⚠️ CRITICAL: DO NOT AUTO-EDIT DOCUMENTATION

**You MUST NOT edit AGENTS.md, CLAUDE.md, or any instruction files without explicit user permission.**

**Correct workflow**:
1. ✅ Write post-mortem report
2. ✅ Propose improvements with exact text to add
3. ✅ **PRESENT to user and ASK for permission**
4. ✅ **WAIT for user approval**
5. ✅ **ONLY THEN** edit documentation files

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

### Errors Encountered & Solutions

1. **[Error Category]**: [Error description]
   - **Error**: [Exact error message / stack trace]
   - **Root Cause**: [Why it happened]
   - **Solution**: [Exact steps to fix]
   - **Prevention**: [How to avoid in future]

2. **[Next Error]**: ...

### Lessons Learned

- **Pattern discovered**: [New pattern found in codebase]
- **Gotcha identified**: [Unexpected behavior or edge case]
- **Best practice**: [Better way to do X]
- **Tool insight**: [How to use tool Y more effectively]

### Documentation Improvements Proposed

**Add to AGENTS.md**:
```
[Exact text to add, with section location]
```

**Add to CLAUDE.md**:
```
[Exact text to add, with section location]
```

**Add to [other-file].md**:
```
[Exact text to add, with section location]
```

### Future Agent Guidance

[Advice for next agent working on similar task]
```

### Examples: Bad vs Good Post-Mortems

**❌ BAD (vague, no actionable proposals)**:
```
Task completed successfully. Had some TypeScript errors but fixed them.
Should update docs to mention TypeScript issues.
```

**Why it's bad**:
- No specifics about errors encountered
- No exact error messages or solutions
- Vague suggestion "update docs" without exact text
- No section location or context

**✅ GOOD (specific, actionable, with exact text)**:
```markdown
## Task: Add GraphVisualizationRenderer

### Completed
- Created GraphVisualizationRenderer component in src/presentation/renderers/
- Added Cytoscape.js integration for graph rendering
- Implemented RDF triple graph layout algorithm
- Tests added: 12 unit + 3 E2E
- Coverage: 98% (2% uncovered: error edge cases)

### Errors Encountered & Solutions

1. **TypeScript Error: Property 'nodes' missing**
   - **Error**: `Property 'nodes' does not exist on type 'GraphData'. TS2339`
   - **Root Cause**: Interface GraphData in types/graph.ts was incomplete (only had 'edges')
   - **Solution**: Added `nodes: Node[]` and updated GraphData interface definition
   - **Prevention**: Always define complete interfaces BEFORE implementation

2. **E2E Test Timeout in graph rendering**
   - **Error**: `Timeout of 5000ms exceeded. Waiting for canvas element to render`
   - **Root Cause**: Cytoscape.js async rendering not awaited properly
   - **Solution**: Added explicit wait: `await page.waitForSelector('canvas.graph', {timeout: 10000})`
   - **Prevention**: For canvas/WebGL elements, use explicit waits with extended timeout

### Lessons Learned

- **Pattern discovered**: All *Renderer classes follow same lifecycle (mount → render → unmount)
- **Gotcha identified**: Cytoscape.js requires container to be visible in DOM before init
- **Best practice**: Define TypeScript interfaces in types/ directory BEFORE writing implementation
- **Tool insight**: Use `npm run typecheck -- --watch` during development for instant feedback

### Documentation Improvements Proposed

**For AGENTS.md** (Section: Troubleshooting > Common TypeScript Errors):
```markdown
### Error: Property X does not exist on type Y

**Symptom**: TypeScript compilation error `TS2339: Property 'X' does not exist on type 'Y'`

**Root Cause**: Interface definition incomplete or property name typo

**Solution**:
1. Check types/[domain].ts for interface definition
2. Add missing property with correct type: `propertyName: PropertyType`
3. Run `npm run typecheck` to verify fix

**Prevention**: Always define complete interfaces BEFORE writing implementation code
```

**For AGENTS.md** (Section: Testing > E2E Test Best Practices):
```markdown
### Canvas/WebGL Element Testing

When testing components that render to canvas (graphs, charts, WebGL):
- Use explicit waits: `await page.waitForSelector('canvas', {timeout: 10000})`
- Extend timeout (canvas rendering is slower than DOM)
- Wait for canvas context: Check canvas.getContext('2d') is not null
```

### Future Agent Guidance

When working on visualization components:
1. Check existing *Renderer classes for patterns (AreaRenderer, TaskRenderer)
2. Define TypeScript interfaces first (types/[domain].ts)
3. For canvas elements: use extended timeouts in E2E tests (10s+)
4. Test in both light and dark Obsidian themes
```

**Why it's good**:
- Specific error messages with error codes (TS2339)
- Exact solutions with code examples
- Documentation proposals include section locations
- Exact text ready to copy-paste into docs
- Future guidance is actionable and specific

### Why Self-Improvement Matters

- **Compound learning**: Each agent makes future agents smarter
- **Reduced errors**: Common pitfalls get documented and avoided
- **Better patterns**: Successful approaches become standardized
- **Faster development**: Less trial-and-error, more "known good paths"

### When to Propose Improvements

- ✅ **After every task** - Even if successful without errors
- ✅ **When discovering workarounds** - Document the correct way
- ✅ **When hitting edge cases** - Add warnings to documentation
- ✅ **When finding better patterns** - Update best practices

### How to Present Improvements

**Step 1: Write post-mortem report**
```markdown
## Post-Mortem: [Task Name]
[... errors, solutions, lessons ...]

### Proposed Documentation Improvements

**For AGENTS.md** (Section: [name]):
```
[Exact text to add]
```

**For CLAUDE.md** (Section: [name]):
```
[Exact text to add]
```
```

**Step 2: Present to user**
"I've completed the task and documented my experience. Here's my post-mortem report with proposed improvements to AGENTS.md and CLAUDE.md. **May I have your permission to update these files?**"

**Step 3: Wait for approval**
- User says "Yes" / "Approved" → Proceed with edits
- User says "No" / "Not now" → Do NOT edit files
- User provides feedback → Adjust proposals, ask again

**Step 4: ONLY if approved - update files**

**Remember**: You are not just coding - you are **proposing improvements** for future AI agents. The user decides which improvements to accept.

---

## 📁 Directory Structure

```
/Users/kitelev/Developer/exocortex-development/
├── exocortex/   # Main repository (READ-ONLY for AI agents)
│   ├── CLAUDE.md                # Complete development guidelines
│   ├── AGENTS.md                # AI agent instructions (links here)
│   └── .github/
│       └── copilot-instructions.md  # GitHub Copilot config
├── worktrees/                   # All worktrees live here (flat structure)
│   ├── exocortex-agent1-feat-graph-viz/
│   ├── exocortex-agent2-fix-mobile-ui/
│   └── exocortex-agent3-refactor-rdf/
├── AGENTS.md                    # This file - universal agent instructions
├── CLAUDE.md                    # Claude Code specific instructions
├── .cursorrules                 # Cursor IDE (legacy support)
└── .cursor/
    └── rules/
        └── worktree-coordination.mdc  # Cursor IDE (modern format)
```

---

## 🚨 RULE #3: NEVER Use `--no-verify` (ABSOLUTE PROHIBITION)

**⛔ ABSOLUTELY FORBIDDEN TO BYPASS PRE-COMMIT HOOKS ⛔**

**NEVER use `git commit --no-verify` under ANY circumstances.**

**Why this is CRITICAL:**
- Pre-commit hooks catch errors BEFORE they contaminate CI/CD pipeline
- Bypassing hooks pushes broken code that blocks ALL parallel developers
- Lint/test failures indicate REAL problems that MUST be fixed
- `--no-verify` creates technical debt and degrades codebase quality

**If pre-commit hook fails, you MUST:**
1. ✅ **FIX lint/test errors** in your files
2. ✅ **FIX pre-existing errors** if they block your commit (see below)
3. ✅ **Ask project maintainer** to address systemic lint configuration issues
4. ❌ **NEVER** use `--no-verify` as shortcut

**Handling pre-existing lint errors:**
```bash
# Scenario: Lint fails but errors are in files you didn't modify

# Step 1: Check YOUR staged files
git diff --cached --name-only
# Output: MyComponent.tsx, MyService.ts

# Step 2: Fix YOUR files first
npx eslint --fix packages/obsidian-plugin/src/presentation/components/MyComponent.tsx

# Step 3: Fix OTHER files blocking your commit
npx eslint --fix packages/obsidian-plugin/src/application/processors/SPARQLCodeBlockProcessor.ts

# Step 4: Commit ALL fixes together
git add .
git commit -m "feat: my feature + fix: resolve pre-existing lint errors"

# This keeps codebase quality high and helps everyone!
```

**Example of WRONG approach:**
```bash
# ❌ FORBIDDEN - Never do this!
git commit --no-verify -m "feat: my change"
```

**Example of CORRECT approach:**
```bash
# ✅ Fix errors, then commit
npx eslint --fix packages/obsidian-plugin/src/**/*.ts
git add .
git commit -m "feat: my feature + fix: lint errors"
```

**Enforcement:** Any PR created with commits bypassing pre-commit hooks will be **rejected**.

---

## 🔧 RULE #4: One Task = One Worktree

**Keep worktrees focused and short-lived:**

- ✅ Small, focused changes (one feature/fix per worktree)
- ✅ Clear, descriptive names following naming convention
- ✅ Short-lived (hours to 1-2 days max)
- ✅ Deleted immediately after PR merge + release

**Why**:
- Easier to review and test
- Reduces merge conflicts
- Faster CI/CD pipeline
- Clear task ownership

---

## 🏷️ Naming Conventions

**Format**: `worktrees/exocortex-[agent-id]-[type]-[description]`

**Agent IDs**: Use your AI tool name as identifier:
- `claude1`, `claude2`, `claude3` - Claude Code instances
- `copilot1`, `copilot2` - GitHub Copilot sessions
- `cursor1`, `cursor2` - Cursor IDE sessions
- `aider1`, `aider2` - Aider sessions
- `jules1`, `jules2` - Google Jules sessions

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
worktrees/exocortex-copilot2-fix-mobile-scrolling
worktrees/exocortex-cursor1-refactor-triple-store
worktrees/exocortex-aider1-perf-query-cache
```

---

## 🔄 Setup & Build Commands

### Initial Setup (First Time)
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
npm install
```

### Create Worktree
```bash
# Sync main first
cd /Users/kitelev/Developer/exocortex-development/exocortex
git fetch origin main
git pull origin main --rebase

# Create worktree
git worktree add ../worktrees/exocortex-[agent]-[type]-[task] -b feature/[task]
cd ../worktrees/exocortex-[agent]-[type]-[task]

# Install dependencies in worktree
npm install
```

> 📌 Always run `npm install` in a fresh worktree before executing tests or scripts—skipping this step causes `ts-jest` to fail with missing preset errors.

### Build & Test Commands
```bash
# Run all tests (MANDATORY before PR)
npm run test:all

# Build project
npm run build

# Run type checker
npm run typecheck

# Lint code
npm run lint

# Run unit tests only
npm test

# Run E2E tests
npm run test:e2e
```

---

## 🔄 Synchronization Protocol

### Before Starting Work
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
git fetch origin main
git pull origin main --rebase
# Now create worktree
```

### During Development
Sync before:
- Each commit (if main has changed)
- Creating PR
- After any other agent merges to main

```bash
# In your worktree:
git fetch origin main
git rebase origin/main  # Resolve conflicts if any
```

### Conflict Resolution
1. Read conflict carefully
2. Resolve in favor of latest main (others' work takes priority)
3. If incompatible, discuss with user
4. Complete rebase: `git rebase --continue`
5. Force push: `git push --force-with-lease origin [branch]`

---

## ✅ Testing Requirements

**MANDATORY before creating PR:**
```bash
npm run test:all
```

This runs:
- Unit tests (803 tests across all packages)
- E2E tests
- Type checking
- Linting

**Never commit broken code.** All tests must pass GREEN ✅ before pushing.

### Jest Constructor Function Mocking Pattern

**Problem:** Inline `.mockImplementation()` in `jest.mock()` can cause parsing errors with ts-jest in this codebase.

**Solution:** Use two-step pattern:

```typescript
// Step 1: Simple mock declaration (no implementation)
jest.mock("../../src/path/to/Component");

// Step 2: Set implementation in beforeEach
beforeEach(() => {
  (Component as jest.Mock).mockImplementation((arg1, callback) => ({
    methodName: jest.fn(() => {
      // Store callback in static property for test access
      (Component as any).lastCallback = callback;
    }),
  }));
});

// Step 3: Access callback in tests
const callback = (Component as any).lastCallback;
callback(result);
```

**When to use:**
- Modal components with callbacks
- Services with callback parameters
- Any constructor-based mocking
- When you see "Missing semicolon" errors in test files

**Example (Modal Testing):**
```typescript
// ✅ CORRECT - Modal component mock
jest.mock("../../src/presentation/modals/AreaSelectionModal");

beforeEach(() => {
  (AreaSelectionModal as jest.Mock).mockImplementation((app, onSubmit, currentArea) => ({
    open: jest.fn(() => {
      (AreaSelectionModal as any).lastCallback = onSubmit;
    }),
  }));
});

it("should handle submission", async () => {
  await command.callback();
  const callback = (AreaSelectionModal as any).lastCallback;
  await callback({ selectedArea: "Development" });
  expect(mockPlugin.settings.activeFocusArea).toBe("Development");
});

// ❌ WRONG - Inline implementation causes parsing errors
jest.mock("../../src/presentation/modals/AreaSelectionModal", () => ({
  AreaSelectionModal: jest.fn().mockImplementation((app, onSubmit) => {
    // This pattern causes "Missing semicolon" errors!
    return { open: jest.fn() };
  }),
}));
```

### GitHub Branch Protection Best Practices

**⚠️ CRITICAL: NEVER use aggregator jobs for branch protection!**

**❌ WRONG - Fake aggregator job:**
```yaml
# .github/workflows/ci.yml
build-and-test:
  needs: [build, typecheck, test-unit, test-coverage]
  steps:
    - name: All checks passed
      run: echo "Success"
```

**Problem:** `needs:` only **waits for completion**, it does NOT fail when dependencies fail!

**Real-world impact:**
- PR #305 had 3 failed checks: `test-component`, `test-coverage`, `test-unit`
- But GitHub showed "Merge allowed" because only `build-and-test` (aggregator) was required
- Aggregator job showed GREEN ✅ even though its dependencies were RED ❌
- Broken code could be merged into main branch!

**✅ CORRECT - Require individual jobs:**

```bash
# Configure branch protection via GitHub API
gh api repos/OWNER/REPO/branches/main/protection/required_status_checks -X PATCH --input - <<EOF
{
  "strict": true,
  "checks": [
    {"context": "build", "app_id": 15368},
    {"context": "typecheck", "app_id": 15368},
    {"context": "test-unit", "app_id": 15368},
    {"context": "test-coverage", "app_id": 15368},
    {"context": "test-bdd", "app_id": 15368},
    {"context": "test-component", "app_id": 15368},
    {"context": "e2e-tests", "app_id": 15368}
  ]
}
EOF
```

**Why this matters:**
- Individual job requirements provide **real protection**
- Each job must pass GREEN ✅ for PR to be mergeable
- No false positives from aggregator jobs
- Prevents broken code from reaching main branch

**Finding app_id for GitHub Actions:**
```bash
# Check existing required checks
gh api repos/OWNER/REPO/branches/main/protection/required_status_checks

# GitHub Actions app_id is typically 15368
```

**Verification after changes:**
- Create test PR with intentionally failing check
- Verify GitHub blocks merge with "Required checks have not passed"
- Do NOT rely on aggregator jobs for quality gates

---

## 📝 PR & Commit Guidelines

### Commit Message Format
Follow Conventional Commits:
```
<type>: <description>

[optional body]
[optional footer]
```

**Types**: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`

**Examples**:
```
feat: add graph visualization component
fix: resolve mobile scrolling issue
refactor: simplify RDF store queries
```

### PR Workflow

1. **Test First** (MANDATORY):
   ```bash
   npm run test:all
   ```

2. **⛔ NEVER Use `--no-verify`** (CRITICAL):
   - **ABSOLUTELY FORBIDDEN** to bypass pre-commit hooks
   - Pre-commit hooks catch errors before CI
   - Fix ALL lint errors, don't bypass
   - See RULE #3 below for enforcement

3. **Commit and Push**:
   ```bash
   git commit -am "feat: user-facing description"
   git push origin feature/my-feature
   ```

3. **Create PR**:
   ```bash
   gh pr create --title "feat: my-feature" --body "Details..."
   ```

4. **Monitor CI Pipeline**:
   ```bash
   gh pr checks --watch  # Wait for GREEN ✅
   ```

5. **Wait for Merge**:
   ```bash
   gh pr merge --auto --rebase
   ```

6. **Verify Release Created**:
   ```bash
   gh release list --limit 1
   ```

### Task NOT Complete Until:
- ✅ CI pipeline passes (build-and-test + e2e-tests)
- ✅ PR merged to main
- ✅ Auto-release workflow creates GitHub release
- ✅ Worktree cleaned up

---

## 📝 Documentation Best Practices

### Structure by Audience

Organize documentation into separate files based on target audience:

- **User-facing**: How to use the feature (tutorials, examples, quick start)
- **Developer-facing**: How to extend/customize (API reference, architecture)
- **Performance**: How to optimize (benchmarks, anti-patterns, troubleshooting)

**Example** (from SPARQL documentation):
- `User-Guide.md` - Tutorial for end users writing queries
- `Developer-Guide.md` - API reference for plugin developers
- `Query-Examples.md` - Copy-paste ready patterns
- `Performance-Tips.md` - Optimization guidance with benchmarks

### Example-Driven Documentation

Examples are more valuable than explanatory text:

1. **Provide 3-5 copy-paste examples per feature**
   - Show variations: basic → intermediate → advanced
   - Include expected output for queries/commands
   - Test examples work before documenting

2. **Format for easy copying**
   ```sparql
   SELECT ?task ?label
   WHERE {
     ?task <http://exocortex.ai/ontology#Instance_class> "ems__Task" .
     ?task <http://exocortex.ai/ontology#Asset_label> ?label .
   }
   LIMIT 10
   ```

3. **Add brief explanations**
   - What the example does
   - When to use it
   - How to adapt it

### Performance Documentation Pattern

Always include concrete numbers, not abstract statements:

- ❌ "Indexed queries are faster" (too vague)
- ✅ "Indexed queries: <10ms, unindexed: >100ms" (actionable)

**Performance docs should include:**
- Execution time ranges (<10ms, 10-100ms, >100ms)
- Complexity analysis (O(1), O(n), O(n²))
- Real-world benchmarks (with data size: "1000 notes")
- Anti-patterns with speedup factors ("100x faster", "5x speedup")
- Troubleshooting checklist

### README Integration (MANDATORY)

New features MUST be linked from README.md:

1. Add new section to README immediately after creating `docs/` files
2. Include 1-2 quick start examples in README (under 5 lines)
3. Provide clear links to detailed documentation
4. Test that all links resolve (no 404s)

**Why this matters**: Users discover features through README first.

### Documentation-Only PRs

**Expected characteristics:**
- Timeline: 60-90 minutes (research + write + review + release)
- Should pass all CI checks on first attempt (no code changes)
- Can be auto-merged immediately (low risk)
- High value: improves discoverability and reduces support burden

**Workflow:**
1. Research source code (10-15 min)
2. Create `docs/` structure
3. Write example-driven guides (60-90 min)
4. Update README with links (10 min)
5. Commit with `docs:` prefix
6. Create PR, enable auto-merge
7. Monitor until merge + release

---

## 🎨 Code Style Guidelines

### TypeScript
- Use ES modules (`import`/`export`), not CommonJS (`require`)
- Destructure imports when possible
- Prefer `const` over `let`, avoid `var`
- Use arrow functions for callbacks
- Enable strict mode in tsconfig

### Testing
- Follow BDD (Behavior-Driven Development)
- Use Gherkin syntax for test descriptions
- Aim for 100% coverage of new code
- Test files: `*.test.ts` or `*.spec.ts`

### Architecture
- Follow Clean Architecture patterns
- Domain layer must be pure (no framework dependencies)
- Use dependency injection
- Keep business logic in domain layer
- Infrastructure handles I/O and external dependencies

---

## 🎨 Component Development Patterns

### Pattern: *WithToggle Components for Table Controls

**When adding toggle buttons to table components, reuse existing WithToggle patterns:**

**Example from codebase:** `DailyTasksTableWithToggle` demonstrates:
- Multiple toggle buttons (Effort Area, Votes, Archived)
- Settings persistence via `plugin.saveSettings()`
- Layout refresh via `refresh()` callback
- Prop spreading pattern: `{...props}` to base component
- Consistent button styling (`marginBottom: 8px`, `padding: 4px 8px`, `fontSize: 12px`)

**Implementation pattern:**
```typescript
export const MyTableWithToggle: React.FC<MyTableWithToggleProps> = ({
  showFeature,
  onToggleFeature,
  ...props  // Spread remaining props to base component
}) => {
  return (
    <div className="exocortex-my-table-wrapper">
      <div className="exocortex-my-table-controls">
        <button
          className="exocortex-toggle-feature"
          onClick={onToggleFeature}
          style={{
            marginBottom: "8px",
            marginRight: "8px",  // If multiple buttons
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showFeature ? "Hide" : "Show"} Feature Name
        </button>
      </div>
      <MyTable {...props} showFeature={showFeature} />
    </div>
  );
};
```

**Renderer integration:**
```typescript
React.createElement(MyTableWithToggle, {
  items: data,
  showFeature: this.settings.featureSetting,
  onToggleFeature: async () => {
    this.settings.featureSetting = !this.settings.featureSetting;
    await this.plugin.saveSettings();
    await this.refresh();
  },
  // ... other props
})
```

**Client-side filtering in base component:**
```typescript
const sortedItems = useMemo(() => {
  let filtered = items;

  // Apply filter if toggle is off
  if (!showFeature) {
    filtered = items.filter((item) => {
      // Your filtering logic based on metadata
      return !item.metadata.some__Property;
    });
  }

  // Apply sorting...
  return filtered;
}, [items, sortState, showFeature]);  // Include showFeature in deps
```

**Benefits:**
- Consistent UX across all table components
- Proven pattern (already tested in production)
- Settings automatically persist and trigger refresh
- Easy to add multiple toggles side-by-side
- Client-side filtering sufficient for <100 item tables

**Real-world example:** See PR #326 (Archive filter for DailyNote tasks/projects)

### Pattern: Display Name Resolution

**When displaying asset names in tables/lists, always resolve the display name ONCE at the source (in the Renderer) rather than repeatedly in UI components.**

**Pattern from PR #337 (Name Sorting Fix):**

✅ **CORRECT - Resolve at Source (Renderer):**
```typescript
// In RelationsRenderer.ts
const displayLabel = enrichedMetadata.exo__Asset_label || sourceFile.basename;
const relation: AssetRelation = {
  file: sourceFile,
  path: sourcePath,
  title: displayLabel,  // ← Single source of truth
  metadata: enrichedMetadata,
  // ...
};
```

❌ **WRONG - Resolve in Component:**
```typescript
// In AssetRelationsTable.tsx (DON'T DO THIS)
const getDisplayLabel = (relation: AssetRelation): string => {
  const label = relation.metadata?.exo__Asset_label;
  return label && label.trim() !== "" ? label : relation.title;  // ← Repeated logic
};
```

**Why this matters:**
- **Single source of truth**: Display logic lives in one place, prevents inconsistencies
- **Sorting works correctly**: Sorts by displayed value, not internal identifier
- **Performance**: Resolve once instead of N times per render cycle
- **Maintainability**: Change display logic in Renderer, all components benefit automatically

**Rule**: If a property appears in tables/lists and needs display formatting (labels, icons, computed values), resolve it in the Renderer and store in the relation object's `title` or dedicated display field.

**Real-world example:** See PR #337 (Fixed Name column sorting to use `exo__Asset_label`)

### Pattern: Obsidian FileManager API for Frontmatter Updates

**When updating note frontmatter programmatically, use `app.fileManager.processFrontMatter()` instead of raw file manipulation.**

**Pattern from PR #390 (Editable Properties):**

✅ **CORRECT - Use FileManager API:**
```typescript
// In PropertyUpdateService.ts
async updateProperty(file: TFile, propertyKey: string, newValue: any): Promise<void> {
  await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
    if (newValue === null || newValue === undefined || newValue === "") {
      delete frontmatter[propertyKey];  // Remove property
    } else {
      frontmatter[propertyKey] = newValue;  // Update property
    }
  });
}
```

❌ **WRONG - Manual YAML Parsing:**
```typescript
// DON'T DO THIS - fraught with edge cases
const content = await app.vault.read(file);
const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
const yaml = YAML.parse(yamlMatch[1]);
yaml[propertyKey] = newValue;
await app.vault.modify(file, `---\n${YAML.stringify(yaml)}\n---\n${body}`);
```

**Why FileManager API is better:**
- **Automatic YAML handling**: Correctly formats all YAML types (strings, numbers, booleans, arrays, objects)
- **Preserves formatting**: Maintains indentation, comments, and key ordering
- **Type safety**: Handles special characters, multiline strings, and escape sequences correctly
- **Metadata cache sync**: Triggers automatic metadata cache updates in Obsidian
- **Error handling**: Built-in error handling for invalid frontmatter
- **Transaction safety**: Atomic updates prevent partial writes

**Testing pattern:**
```typescript
// Mock processFrontMatter in tests
mockProcessFrontMatter = jest.fn(async (file: TFile, callback: (fm: any) => void) => {
  const frontmatter = {};
  callback(frontmatter);
  // Verify frontmatter was modified correctly
});

mockApp = {
  fileManager: {
    processFrontMatter: mockProcessFrontMatter,
  },
} as unknown as App;
```

**Benefits:**
- Works with all Obsidian-supported YAML formats
- Compatible with Obsidian Mobile
- No third-party YAML parser dependency
- Respects Obsidian's internal metadata structure

**Real-world example:** See PR #390 (PropertyUpdateService + editable DateTime/Text fields)

### Pattern: React Hooks for Local/Remote State Sync

**When building editable form fields that sync with server-side data (frontmatter, settings, etc.), use `useState` for local state and `useEffect` for prop synchronization.**

**Pattern from PR #390 (Editable Properties):**

✅ **CORRECT - Local State + useEffect Sync:**
```typescript
// In TextPropertyField.tsx
const [localValue, setLocalValue] = useState(value);  // Local editing state
const inputRef = useRef<HTMLInputElement>(null);

// Sync local state when prop changes (external update)
useEffect(() => {
  setLocalValue(value);
}, [value]);

const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setLocalValue(e.target.value);  // Update local state immediately
};

const handleBlur = () => {
  if (localValue !== value) {
    onChange(localValue);  // Save to server only if changed
  }
  onBlur?.();
};

const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") {
    e.preventDefault();
    inputRef.current?.blur();  // Trigger save via onBlur
  }
  if (e.key === "Escape") {
    e.preventDefault();
    setLocalValue(value);  // Revert to original value
    inputRef.current?.blur();
  }
};
```

❌ **WRONG - Controlled Input Without Local State:**
```typescript
// DON'T DO THIS - triggers onChange on every keystroke
<input
  value={value}  // Prop value directly
  onChange={(e) => onChange(e.target.value)}  // Server update per keystroke!
/>
```

**Why local state is better:**
- **Responsive UX**: Input feels instant, no network lag per keystroke
- **Debounced saves**: Only call onChange when editing complete (onBlur)
- **Optimistic updates**: User sees changes immediately
- **Undo support**: Escape key reverts to original value
- **Reduced API calls**: onChange fires once (on blur) instead of per keystroke

**Pattern for datetime picker:**
```typescript
// In DateTimePropertyField.tsx
const [isOpen, setIsOpen] = useState(false);  // Dropdown visibility
const [localValue, setLocalValue] = useState(value || "");  // Local edit state

useEffect(() => {
  setLocalValue(value || "");  // Sync with prop changes
}, [value]);

const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const newLocalValue = e.target.value;
  setLocalValue(newLocalValue);  // Update local immediately

  const isoValue = convertToISOFormat(newLocalValue);
  onChange(isoValue);  // Save to server (safe for datetime - single change)
};
```

**Key principles:**
1. **Local state for immediate feedback** - `useState(value)`
2. **useEffect for prop sync** - External changes update local state
3. **onChange on blur, not keystroke** - Reduce server calls
4. **Escape key for undo** - Revert to original prop value
5. **Enter key for save** - Explicit save trigger

**Testing pattern:**
```typescript
it("should update local state on change", () => {
  const { getByRole } = render(<TextPropertyField value="initial" onChange={jest.fn()} />);
  const input = getByRole("textbox");

  fireEvent.change(input, { target: { value: "modified" } });
  expect(input.value).toBe("modified");  // Local state updated
});

it("should call onChange only on blur", () => {
  const onChange = jest.fn();
  const { getByRole } = render(<TextPropertyField value="initial" onChange={onChange} />);
  const input = getByRole("textbox");

  fireEvent.change(input, { target: { value: "modified" } });
  expect(onChange).not.toHaveBeenCalled();  // Not called yet

  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledWith("modified");  // Called on blur
});
```

**Real-world example:** See PR #390 (TextPropertyField + DateTimePropertyField components)

---

## 📝 YAML Frontmatter Patterns

### Working with YAML Arrays in Frontmatter

When removing properties that may contain arrays:

```yaml
aliases:
  - Alias 1
  - Alias 2
property: value
```

Use regex that captures array items (indented with 2 spaces):
```typescript
const propertyLineRegex = new RegExp(
  `\n?${property}:.*(?:\n {2}- .*)*`,  // Captures property + array items
  "gm"
);
```

**Key insight**: YAML arrays use `  - ` (2 spaces + dash). Non-capturing group `(?:...)` with `*` quantifier handles variable-length arrays.

**Example from codebase**: `FrontmatterService.removeProperty()` handles both scalar and array properties:

```typescript
// Removes both property line and array items
const updated = service.removeProperty(content, "aliases");

// Before:
// ---
// aliases:
//   - Item 1
//   - Item 2
// foo: bar
// ---

// After:
// ---
// foo: bar
// ---
```

**Test coverage required**:
- Array at beginning of frontmatter
- Array in middle of frontmatter
- Array at end of frontmatter
- Empty arrays
- Single-item arrays

**Real-world example:** See PR #331 (Archive command removes aliases property)

---

## 🔍 SPARQL & RDF Development

### Working with SPARQL & sparqljs

**Parser Output Structure:**

The `sparqljs` parser uses **different property names** for expression types:
- **Operations** (comparisons, logical): `expr.type === "operation"`
- **Function calls** (regex, concat): `expr.type === "functioncall"`
- **RDF Terms** (variables, literals, IRIs): `expr.termType === "Variable" | "Literal" | "NamedNode"`

**Always check both properties when translating expressions:**

```javascript
if (expr.type === "operation") {
  // Handle comparisons (>, <, =), logical ops (&&, ||, !)
}
else if (expr.type === "functioncall") {
  // Handle SPARQL functions (regex, concat, str, etc.)
}
else if (expr.termType) {
  // Handle variables (?x), literals ("hello"), IRIs (<http://...>)
}
else {
  throw new Error("Unsupported expression structure");
}
```

**Best Practice:** Don't rely solely on documentation—inspect actual parser output with:

```bash
node -e "const { Parser } = require('sparqljs'); \
  console.log(JSON.stringify(new Parser().parse( \
    'SELECT ?x WHERE { ?x ?p ?o . FILTER(?x > 10) }' \
  ), null, 2))"
```

### TypeScript & Algebra Translation

**Use discriminated unions for type-safe algebra operations:**

```typescript
export type AlgebraOperation =
  | BGPOperation       // { type: "bgp", triples: Triple[] }
  | FilterOperation    // { type: "filter", expression: Expression, input: AlgebraOperation }
  | JoinOperation      // { type: "join", left: AlgebraOperation, right: AlgebraOperation }
  // ...

// TypeScript ensures exhaustive switch:
switch (operation.type) {
  case "bgp": /* ... */; break;
  case "filter": /* ... */; break;
  case "join": /* ... */; break;
  // If a case is missing, TypeScript compiler error!
}
```

**Import only types used in type annotations (not just literal values):**

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

**Run typecheck before pushing:**

```bash
npm run check:types  # Catches unused imports, type errors
```

### RDF Namespace URI Standards

**CRITICAL**: RDF/RDFS/OWL ontologies MUST use **hash-style URIs**:

- ✅ CORRECT: `https://exocortex.my/ontology/exo#`
- ❌ WRONG: `https://exocortex.my/ontology/exo/`

**Why hash-style?** The `#` (fragment identifier) is the RDF standard for ontology vocabularies. It allows multiple terms to reference the same ontology document.

**Source of Truth**: Vault ontology files (`!ontology-name.md`) contain canonical URIs in `exo__Ontology_url` property.

**Before implementing SPARQL features:**
1. Read vault ontology files to get correct namespace URIs
2. Update code to match vault definitions (vault is source of truth)
3. Verify both CLI and Obsidian plugin use same `packages/exocortex/src/domain/models/rdf/Namespace.ts` constants
4. Test SPARQL queries in both environments

**Example**:
```typescript
// packages/exocortex/src/domain/models/rdf/Namespace.ts
static readonly EXO = new Namespace("exo", "https://exocortex.my/ontology/exo#");
static readonly EMS = new Namespace("ems", "https://exocortex.my/ontology/ems#");
```

**Verification**:
```bash
# Test CLI execution returns results
node packages/cli/dist/index.js sparql query test.sparql --vault /path/to/vault
# Should return > 0 results if query is correct
```

**Troubleshooting empty results:**

If SPARQL query executes without errors but returns 0 results:

1. **Check namespace URI mismatch**:
   ```bash
   # Compare code URIs
   grep -A2 "static readonly EXO" packages/exocortex/src/domain/models/rdf/Namespace.ts

   # Compare vault URIs
   grep "exo__Ontology_url" /path/to/vault/03\ Knowledge/exo/!exo.md
   ```

2. **Run diagnostic query** to see actual triple store URIs:
   ```sparql
   SELECT DISTINCT ?predicate WHERE {
     ?subject ?predicate ?object .
   } LIMIT 20
   ```

   If predicates show `http://exocortex.org/...` but query uses `https://exocortex.my/...`, that's the mismatch.

3. **Fix steps**:
   - Update `Namespace.ts` with vault's canonical URIs
   - Update all SPARQL test files with new prefixes
   - Update vault README examples
   - Verify CLI execution returns results

**Reference**: See PR #363 for complete namespace unification example.

---

## 🔐 Security Considerations

### Never Commit:
- API keys or secrets
- `.env` files with credentials
- `credentials.json` or similar files
- Private keys or certificates

### Code Security:
- Sanitize all user inputs
- Validate data at boundaries
- Avoid command injection (never use `eval()` or `new Function()` with user input)
- Use parameterized queries (prevent SQL injection)
- Implement CSRF protection
- Follow OWASP Top 10 guidelines

---

## 🤝 Multi-Agent Coordination

### Before Starting a Task

1. **Check active worktrees**:
   ```bash
   cd exocortex
   git worktree list
   ```

2. **Check open PRs**:
   ```bash
   gh pr list
   ```

3. **Avoid duplicating work** on same feature

4. **If uncertain**, ask user: "Should I work on X while another agent works on Y?"

### Parallel Work Best Practices

**✅ SAFE (independent areas):**
- Agent A: Frontend component
- Agent B: Backend service
- Agent C: Documentation
- Agent D: Tests for A's component

**⚠️ RISKY (same files):**
- Agent A: Refactor RDF store
- Agent B: Also refactor RDF store
→ **Coordinate with user first!**

---

## 🔧 Worktree Lifecycle

### 1. Create Worktree
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
git fetch origin main && git pull origin main --rebase
git worktree add ../worktrees/exocortex-[agent]-[type]-[task] -b feature/[task]
cd ../worktrees/exocortex-[agent]-[type]-[task]
npm install
```

### 2. Develop
```bash
# Work in worktree
cd /Users/kitelev/Developer/exocortex-development/worktrees/exocortex-[agent]-[type]-[task]

# Follow all rules
# Run tests frequently: npm test
# Commit often: git commit -am "progress: description"
```

### 3. Create PR and Monitor
```bash
npm run test:all  # MANDATORY
git push origin feature/[task]
gh pr create --title "type: description" --body "Details..."
gh pr checks --watch  # Wait for GREEN
```

### 4. Cleanup After Merge
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree remove ../worktrees/exocortex-[agent]-[type]-[task]
git branch -d feature/[task]
```

**⚠️ CRITICAL**: Don't cleanup while session is active in that worktree!

---

## 🆘 Troubleshooting

### "Worktree created in wrong location"
Check with `pwd` - should contain `worktrees/` in path.

Fix:
```bash
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree remove ../<wrong-name>
# Create in correct location: ../worktrees/...
```

### "Rebase conflicts"
```bash
git status  # See conflicting files
# Edit files, resolve conflicts
git add .
git rebase --continue
```

### "Tests failing"
```bash
npm test -- --verbose  # See detailed error
npm run typecheck  # Check type errors
npm run lint  # Check linting errors
```

### "Someone else is working on this"
```bash
git worktree list  # Check active work
gh pr list  # Check open PRs
# Coordinate with user or pick different task
```

### File Lookup Failures in Obsidian

**Problem**: `getFirstLinkpathDest(path, "")` returns `null` even when file exists.

**Cause**: Obsidian's metadata cache may not find files if path doesn't include `.md` extension. Wiki-links like `[[Page Name]]` extract to `"Page Name"` (no `.md`), but Obsidian's API may require full filename `"Page Name.md"`.

**Solution**: Always implement `.md` extension fallback:
```typescript
let file = this.app.metadataCache.getFirstLinkpathDest(path, "");

if (!file && !path.endsWith(".md")) {
  file = this.app.metadataCache.getFirstLinkpathDest(path + ".md", "");
}

if (file instanceof TFile) {
  // Process file
}
```

**Pattern Location**: See `AssetMetadataService.getAssetLabel()` and `getEffortArea()` for reference implementations.

**Test Coverage**: Add tests for both happy path (file found without `.md`) and fallback path (file found with `.md`):
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
```

**Related Issues**: #355 (Area inheritance fix)

### TypeScript Error: Parameter Declared But Never Used

**Problem**: TypeScript compilation fails with `error TS6138: Property 'X' is declared but its value is never read`.

**Root Cause**: Parameter declared in constructor or function but not referenced in the implementation body.

**Solution**:
```typescript
// ❌ WRONG - 'vault' declared but never used
constructor(
  private vault: Vault,
  private metadataCache: MetadataCache,
  private app: App,
) {
  // Only uses metadataCache and app, not vault
}

// ✅ CORRECT - Remove unused parameter
constructor(
  private metadataCache: MetadataCache,
  private app: App,
) {
  // Uses only what's needed
}

// Alternative: Use underscore prefix for intentionally unused
constructor(
  private _vault: Vault,  // Signals "intentionally unused"
  private app: App,
) {}
```

**Prevention**: Run `npm run check:types` locally before pushing to catch unused parameter errors early.

**Related Issues**: PR #391 (AliasSyncService unused vault parameter)

---

## 📚 Additional Documentation

For complete development rules and patterns, see:
- `exocortex/CLAUDE.md` - Comprehensive guidelines
- `exocortex/README.md` - Project features and setup
- `exocortex/ARCHITECTURE.md` - Architecture patterns
- `exocortex/docs/PROPERTY_SCHEMA.md` - Frontmatter vocabulary

---

## 🚀 Quick Start (All Agents)

```bash
# 1. Read this file (done!)

# 2. Create your worktree
cd /Users/kitelev/Developer/exocortex-development/exocortex
git fetch origin main && git pull origin main --rebase
git worktree add ../worktrees/exocortex-[your-agent]-feat-[task] -b feature/[task]
cd ../worktrees/exocortex-[your-agent]-feat-[task]
npm install

# 3. Develop following all rules
# ... code ...

# 4. Test and create PR
npm run test:all
git commit -am "feat: your awesome feature"
git push origin feature/[task]
gh pr create

# 5. After merge, cleanup
cd /Users/kitelev/Developer/exocortex-development/exocortex
git worktree remove ../worktrees/exocortex-[your-agent]-feat-[task]
git branch -d feature/[task]
```

---

**Remember**: This directory enables safe parallel development by multiple AI agents. When in doubt, sync early, sync often, and validate your location with `pwd`.

**Tool-specific instructions**: See `CLAUDE.md` (Claude Code), `.github/copilot-instructions.md` (GitHub Copilot), `.cursor/rules/` (Cursor IDE).
