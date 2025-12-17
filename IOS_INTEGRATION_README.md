# iOS Live Activities Integration Worktree

This worktree is dedicated to iOS Live Activities integration development for the Exocortex Obsidian plugin.

## Purpose

This isolated workspace allows AI agents to work on iOS-specific features without affecting the main repository or other parallel development efforts.

## Branch

- **Branch name**: `feature/ios-live-activities`
- **Base**: `main` (6b4cb9a)
- **Purpose**: Implement iOS Live Activities integration

## What is iOS Live Activities?

iOS Live Activities allow the Exocortex plugin to display active tasks on the iPhone lock screen via:
1. Obsidian plugin detects when task status changes to "DOING"
2. Plugin launches iOS companion app via URL scheme
3. iOS app displays Live Activity on lock screen with timer
4. User can complete task from lock screen

## Development Guidelines

### For AI Agents

1. **Always work in this worktree** - Never modify files in `/exocortex/` directly
2. **Keep sync with main**: Run `git fetch origin main && git rebase origin/main` regularly
3. **Follow TypeScript conventions**: See `.github/copilot-instructions.md`
4. **Run tests before PR**: `npm run test:all`
5. **Document changes**: Update this README as features are added

### Installation (Known Issue)

**Note**: As of 2025-11-02, there are npm workspace dependency issues during `npm install`. This is a project-wide issue unrelated to iOS integration work. Workaround:

```bash
# Option 1: Copy node_modules from main repo (temporary)
cp -r /Users/kitelev/Developer/exocortex-development/exocortex/node_modules .

# Option 2: Install ignoring scripts
npm install --ignore-scripts
```

**This dependency issue needs to be resolved separately and is not blocking iOS integration code development.**

## Features to Implement

Tracked in GitHub Issues with milestone "iOS Live Activities":

- [x] #273 - Worktree Setup (this)
- [ ] #276 - Status Detection Service
- [ ] #281 - Error Handling
- [ ] #282 - Documentation
- [ ] #285 - Plugin Release

## Testing

```bash
# Run all tests
npm run test:all

# Run specific tests
npm test -- TaskTrackingService

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Architecture

```
src/
├── services/
│   └── TaskTrackingService.ts  (NEW - detects DOING status)
├── models/
│   └── TaskData.ts              (NEW - task data model)
└── main.ts                      (UPDATE - initialize service)
```

## Integration Flow

```
1. User changes task status to [[ems__EffortStatusDoing]]
   ↓
2. TaskTrackingService.handleFileChange() triggered
   ↓
3. Service generates exocortex://task/start?... URL
   ↓
4. window.open() launches iOS companion app
   ↓
5. iOS app creates Live Activity on lock screen
   ↓
6. User completes task → callback URL updates Obsidian
```

## Related Files

- Implementation plan: `/IOS_LIVE_ACTIVITIES_IMPLEMENTATION_PLAN.md`
- Task executor: `/IOS-LIVE-ACTIVITIES-TASK-EXECUTOR-PROMPT.md`
- Instructions: `/.github/copilot-instructions.md`

## Status

- **Created**: 2025-11-02 by GitHub Copilot CLI
- **Branch**: feature/ios-live-activities
- **State**: Ready for development
- **Next task**: Issue #276 (Status Detection Service)

---

**Note for Human**: This worktree was created by AI agent as part of Issue #273. You can now assign iOS integration tasks to AI agents who will work in this isolated environment.
