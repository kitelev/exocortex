# Templates

Standard templates for post-mortems, reports, and documentation.

---

## Post-Mortem Report Template

After EVERY completed task, write a detailed post-mortem following this template:

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

**Add to PATTERNS.md** (Section: [section name]):
```
[Exact text to add]
```

**Add to TROUBLESHOOTING.md** (Section: [section name]):
```
[Exact text to add]
```

### Future Agent Guidance

[Advice for next Claude Code instance working on similar task]
```

---

## Post-Mortem Example: Zero-Error Implementation

**Use this example when you complete a task with zero errors:**

```markdown
## Task: CLI Creation Commands (Issue #423)

### Completed
- Implemented 4 CLI commands: create-task, create-meeting, create-area, create-project
- Tests added: 25 unit tests (100% coverage of new code)
- Coverage: All 1770 unit tests + 55 UI + 345 component tests passed first try
- PR #435 merged, Release v13.64.0 created
- Timeline: 2 hours from start to release

### Errors Encountered & Solutions

**Result: ZERO ERRORS during development** 🎉

Only workflow issue:
1. **Auto-merge rebase not allowed**:
   - **Attempted**: `gh pr merge 435 --auto --rebase`
   - **Error**: Repository settings disable rebase merge
   - **Solution**: Changed to `--squash` which succeeded
   - **Prevention**: Always use `--squash` for this repository

### Lessons Learned

**Why zero errors happened:**
- **Warm context**: Sequential related tasks (PR #432-434 before #435) = 2-2.5x productivity
- **Pattern research**: Read @exocortex/core creation services before implementing
- **Ontology verification**: Checked which asset classes have which properties
- **Comprehensive tests**: 25 unit tests caught potential issues early

**Patterns discovered:**
- Areas don't have `ems__Effort_status` (only efforts: tasks/projects/meetings)
- Meetings use same creation pattern as tasks (no separate service)
- MetadataHelpers.buildFileContent() handles array formatting automatically

**Best practices:**
- Research > implementation: 15 min reading code saved 2+ hours debugging
- Sequential related tasks leverage warm context for faster development
- Copy proven patterns from @exocortex/core instead of reinventing

### Documentation Improvements Proposed

**Add to CLAUDE.md** (Section: "Why Self-Improvement Matters"):
```
### Example: Zero-Error Implementation

**Task**: CLI Creation Commands (Issue #423)
**Result**: Zero errors from start to release

**Why it succeeded:**
- Warm context from sequential related tasks (2-2.5x productivity)
- Pattern research before implementation
- Comprehensive tests catching issues early
```

**Add to CLAUDE.md** (Section: "Development Patterns"):
```
### Shared Utility Pattern for Cross-Table Features

Quick audit commands to check if feature already exists before implementing...
```

### Future Agent Guidance

**For next CLI command implementation:**
1. Read packages/core/src/services/*CreationService.ts for patterns
2. Check ontology to determine which properties apply to which classes
3. Use MetadataHelpers.buildFileContent() for file assembly
4. Follow test pattern: mock process.exit() and expect throw
5. Use sequential task batching (2-2.5x faster than isolated tasks)

**Expected timeline:**
- With these patterns documented: 1.5 hours (25% faster)
- First task in batch: 2 hours (research included)
- Subsequent tasks: 1 hour (warm context)
```

---

## How to Present Post-Mortem

**Step 1: Complete the post-mortem**
Write detailed report following the template above.

**Step 2: Present to user and ask for permission**
"I've completed [task] and documented my experience. Here's my post-mortem report with proposed improvements to [files]. **May I have your permission to update these documentation files?**"

**Step 3: Wait for user decision**
- User says **"Yes"/"Approved"** → Proceed with edits
- User says **"No"/"Not now"** → Do NOT edit files
- User says **"Adjust X"** → Modify proposals, present again

**Step 4: ONLY if approved - update documentation**
Only edit files after explicit user approval.

**Remember**: You propose, user decides. Never auto-edit instruction files.
