# ADR-0005: Effort Voting System for Prioritization

## Status

✅ **Accepted** (Implemented in v12.29.0)

## Context

Users need a way to collaboratively prioritize tasks and projects. The system must:
- Be simple to use (one-click voting)
- Work asynchronously (no coordination required)
- Influence task sorting automatically
- Be non-destructive (no data loss)
- Support both UI and CLI voting

### Problem

Traditional prioritization methods:

1. **Manual numbering**: `priority: 1`, `priority: 2`
   - Hard to maintain ordering
   - Requires renumbering when priorities change
   - Not collaborative

2. **Due dates**: `dueDate: 2025-10-30`
   - Only works for time-sensitive tasks
   - Doesn't capture importance vs urgency
   - Conflicts when multiple tasks due same day

3. **Tags**: `#urgent`, `#important`
   - Subjective, no quantification
   - Hard to sort programmatically
   - No aggregate priority signal

## Decision

**Implement vote counting system**:

### Property

```yaml
ems__Effort_votes: 3
```

- **Type**: Integer (non-negative)
- **Default**: 0 (or missing property)
- **Increment**: +1 per vote
- **Decrement**: Not supported (votes only go up)

### Command

```
Exocortex: Vote on Effort
```

- Available on Tasks, Projects, Meetings (not archived)
- Increments `ems__Effort_votes` by 1
- Shows notice: "Voted! New count: 4"

### Sorting

Efforts sorted by:
1. Non-trashed before trashed
2. Not-done before done
3. **Higher votes before lower votes** ⭐
4. Earlier start time before later start time

### UI

- Toggleable column in Daily Tasks table
- Shows vote count: "Vote (3)"
- Click to vote (increments by 1)
- Setting: `showEffortVotes` (default: true)

## Consequences

### Positive ✅

- **Simple**: One click to vote, no complex UI
- **Collaborative**: Multiple users can vote independently
- **Automatic sorting**: Higher-voted tasks float to top
- **Non-destructive**: Voting doesn't change task content
- **Visible feedback**: Vote count shows consensus
- **Flexible**: Users decide what "vote" means (importance, urgency, value)
- **CLI-friendly**: Easy to increment via CLI

### Negative ❌

- **No downvoting**: Can only increase votes
- **No vote removal**: Can't undo votes
- **No voting history**: Don't track who voted
- **Unbounded**: No maximum vote count

### Mitigations

1. **Reset mechanism**: Future feature to reset votes (e.g., weekly)
2. **Archive old tasks**: Done/trashed tasks removed from active view
3. **Semantic meaning**: Document what votes mean in your workflow
4. **Manual edit**: Users can manually edit frontmatter if needed

## Implementation

### Service

```typescript
// EffortVotingService.ts
export class EffortVotingService {
  async incrementEffortVotes(effortFile: TFile): Promise<number> {
    const content = await this.vault.read(effortFile);
    const currentVotes = this.extractVoteCount(content);
    const newVoteCount = currentVotes + 1;

    const updatedContent = this.updateFrontmatterWithVotes(content, newVoteCount);
    await this.vault.modify(effortFile, updatedContent);

    return newVoteCount;
  }

  private extractVoteCount(content: string): number {
    const match = content.match(/ems__Effort_votes:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private updateFrontmatterWithVotes(content: string, voteCount: number): string {
    // Creates or updates ems__Effort_votes property
    // Preserves Unix/Windows line endings
  }
}
```

### Visibility

```typescript
export function canVoteOnEffort(context: CommandVisibilityContext): boolean {
  return isEffort(context.instanceClass) && !context.isArchived;
}
```

### Sorting

```typescript
// EffortSortingHelpers.sortByPriority()
static sortByPriority<T extends EffortItem>(a: T, b: T): number {
  // 1. Non-trashed first
  if (a.isTrashed !== b.isTrashed) return a.isTrashed ? 1 : -1;

  // 2. Not-done first
  if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;

  // 3. Higher votes first ⭐
  const aVotes = a.metadata.ems__Effort_votes || 0;
  const bVotes = b.metadata.ems__Effort_votes || 0;
  if (aVotes !== bVotes) return bVotes - aVotes;

  // 4. Earlier start time first
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);

  return 0;
}
```

## Alternatives Considered

### Alternative 1: Priority levels

```yaml
priority: high|medium|low
```

**Rejected because**:
- Subjective, no quantification
- Hard to compare across users
- No aggregate signal

### Alternative 2: Point system

```yaml
importance: 8
urgency: 5
value: 10
total: 23
```

**Rejected because**:
- Too complex for quick prioritization
- Requires thinking about multiple dimensions
- Hard to use casually

### Alternative 3: Weighted voting

```yaml
votes:
  - user: alice, weight: 2
  - user: bob, weight: 1
```

**Rejected because**:
- Requires user tracking (privacy concern)
- Too complex for solo users
- Collaboration features not primary use case

## Related

- **Property**: `ems__Effort_votes`
- **Service**: `EffortVotingService`
- **UI**: Vote button in ActionButtonsGroup
- **Setting**: `showEffortVotes` toggle
- **Command**: "Vote on Effort" in Command Palette

## Future Enhancements

- [ ] Vote decay (votes decrease over time)
- [ ] Vote reset (weekly/monthly reset)
- [ ] Vote removal (undo last vote)
- [ ] Vote comments (why you voted)
- [ ] Vote delegation (vote on behalf of team)

---

**Date**: 2025-10-26
**Author**: @kitelev
**Related Issues**: #124 (Architecture Documentation)