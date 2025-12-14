# ADR-0007: Command Visibility Strategy Pattern

## Status

✅ **Accepted** (Implemented)

## Context

The Command Palette should show only relevant commands based on the current note's properties. For example:
- "Create Task" only shows for Areas and Projects
- "Vote on Effort" only shows for Tasks/Projects/Meetings
- "Create Instance" only shows for Prototypes
- Commands hidden for archived assets

### Problem

How to determine command visibility without duplicating logic?

**Naive approach** (duplicated logic):
```typescript
// In CommandManager - registerCreateTaskCommand
if (isAreaOrProject(file)) {
  // Show command
}

// In ButtonGroupsBuilder - buildButtons
if (isAreaOrProject(file)) {
  // Show button
}

// Duplication! Logic in multiple places
```

## Decision

**Use Strategy Pattern with pure visibility functions**:

### Design

```typescript
// CommandVisibility.ts - All visibility strategies in one place
export interface CommandVisibilityContext {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  metadata: Record<string, any>;
  isArchived: boolean;
  currentFolder: string;
  expectedFolder: string | null;
}

// Each command has a visibility strategy (pure function)
export function canCreateTask(context: CommandVisibilityContext): boolean {
  return isAreaOrProject(context.instanceClass);
}

export function canVoteOnEffort(context: CommandVisibilityContext): boolean {
  return isEffort(context.instanceClass) && !context.isArchived;
}

export function canPlanOnToday(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;
  if (isPlannedForToday(context.metadata)) return false;  // Already planned
  return true;
}

// ... 25+ more visibility functions
```

### Usage

```typescript
// In CommandManager
private registerCreateTaskCommand(plugin: any): void {
  plugin.addCommand({
    id: 'create-task',
    name: 'Create task',
    checkCallback: (checking: boolean) => {
      const file = this.app.workspace.getActiveFile();
      if (!file) return false;

      const context = this.getContext(file);
      if (!context || !canCreateTask(context)) return false;  // ✅ Use strategy

      if (!checking) {
        this.executeCreateTask(file, context);
      }
      return true;
    },
  });
}

// In ButtonGroupsBuilder
buildButtonGroups(file: TFile, context: CommandVisibilityContext): ButtonGroup[] {
  const buttons: ButtonGroup[] = [];

  if (canCreateTask(context)) {  // ✅ Same strategy
    buttons.push({ id: 'create-task', ... });
  }

  if (canVoteOnEffort(context)) {  // ✅ Same strategy
    buttons.push({ id: 'vote', ... });
  }

  return buttons;
}
```

## Consequences

### Positive ✅

- **Single source of truth**: All visibility logic in one file
- **Reusable**: Same functions for Command Palette and UI buttons
- **Testable**: Pure functions, easy to test all combinations
- **Maintainable**: Add new rule? Add one function
- **CLI-compatible**: Can use in CLI for command filtering
- **Documented**: All 25+ rules in one place

### Negative ❌

- **Abstraction overhead**: Extra layer (Context extraction)
- **Context extraction**: Must build context object first

### Mitigations

1. **MetadataExtractor**: Handles context extraction (reusable)
2. **Context is lightweight**: Just a POJO, no performance impact
3. **Type safety**: Context interface enforced by TypeScript

## Implementation

### Context Extraction

```typescript
// MetadataExtractor.extractCommandVisibilityContext()
extractCommandVisibilityContext(file: TFile): CommandVisibilityContext {
  const cache = this.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter || {};

  return {
    instanceClass: this.extractInstanceClass(frontmatter),
    currentStatus: this.extractStatus(frontmatter),
    metadata: frontmatter,
    isArchived: this.extractIsArchived(frontmatter),
    currentFolder: file.parent?.path || "",
    expectedFolder: this.extractExpectedFolder(frontmatter),
  };
}
```

### Helper Functions

```typescript
function isEffort(instanceClass: string | string[] | null): boolean {
  return (
    hasClass(instanceClass, AssetClass.TASK) ||
    hasClass(instanceClass, AssetClass.PROJECT) ||
    hasClass(instanceClass, AssetClass.MEETING)
  );
}

function hasClass(instanceClass: string | string[] | null, targetClass: string): boolean {
  return WikiLinkHelpers.includes(instanceClass, targetClass);
}
```

## Testing

```typescript
describe('CommandVisibility', () => {
  describe('canCreateTask', () => {
    it('should return true for Area', () => {
      const context = { instanceClass: AssetClass.AREA, ... };
      expect(canCreateTask(context)).toBe(true);
    });

    it('should return false for Concept', () => {
      const context = { instanceClass: AssetClass.CONCEPT, ... };
      expect(canCreateTask(context)).toBe(false);
    });
  });

  describe('canVoteOnEffort', () => {
    it('should return true for non-archived Task', () => {
      const context = {
        instanceClass: AssetClass.TASK,
        isArchived: false,
        ...
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it('should return false for archived Task', () => {
      const context = {
        instanceClass: AssetClass.TASK,
        isArchived: true,
        ...
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });
  });
});
```

## Related

- **File**: `src/domain/commands/CommandVisibility.ts`
- **Test**: `tests/unit/CommandVisibility.test.ts`
- **Users**: CommandManager (32 commands), ButtonGroupsBuilder
- **Coverage**: 79% (target: 95% in Issue #123)

## Future

After Issue #122:
- Move `CommandVisibility.ts` to `exocortex`
- Use in both Plugin and CLI for consistent behavior
- CLI can filter available commands based on file context

---

**Date**: 2025-10-26
**Author**: @kitelev
**Related Issues**: #122 (Core Extraction), #124 (Architecture Documentation)