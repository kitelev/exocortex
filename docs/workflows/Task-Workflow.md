# Task Workflow Guide

**Complete lifecycle of a task from creation to completion.**

---

## Table of Contents

1. [Workflow States](#workflow-states)
2. [Creating Tasks](#creating-tasks)
3. [Moving Through Statuses](#moving-through-statuses)
4. [Planning Tasks](#planning-tasks)
5. [Working on Tasks](#working-on-tasks)
6. [Completing Tasks](#completing-tasks)
7. [Archiving and Cleanup](#archiving-and-cleanup)
8. [Best Practices](#best-practices)

---

## Workflow States

Exocortex tasks follow a structured lifecycle:

```
Draft → Backlog → Analysis → ToDo → Doing → Done
  ↓                                          ↓
Archive                                   Archive
```

### Status Descriptions

| Status | Purpose | Typical Duration | Next Actions |
|--------|---------|------------------|--------------|
| **Draft** | Initial idea, not committed | Hours to days | Move to Backlog or Archive |
| **Backlog** | Committed work, awaiting analysis | Days to weeks | Move to Analysis |
| **Analysis** | Being planned and scoped | Hours to days | Move to ToDo |
| **ToDo** | Ready to start, prioritized | Days to weeks | Plan on specific day, Start Effort |
| **Doing** | Actively working | Hours to days | Mark Done |
| **Done** | Completed | Permanent | Archive (optional) |

---

## Creating Tasks

### Method 1: Button (Recommended)

1. Open parent project note in Reading Mode
2. Click **"Create Task"** button
3. Fill form:
   - **Label**: Descriptive name
   - **Status**: Usually `ems__EffortStatusToDo`
   - **Area**: Auto-filled from project

**Advantages**: Auto-generates UID, fills relationships, creates in correct folder.

### Method 2: Command Palette

1. Cmd/Ctrl + P
2. Type "Create Task"
3. Fill form (same as button)

### Method 3: Manual Creation

Create `tasks/task-build-endpoint.md`:

```yaml
---
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: Build /users endpoint
ems__Effort_area: "[[Development]]"
ems__Effort_project: "[[Build API Server]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---

# Build /users endpoint

REST endpoint for user CRUD operations.

## Acceptance Criteria
- GET /users returns list
- POST /users creates user
- PUT /users/:id updates user
- DELETE /users/:id removes user
```

### Related Tasks (Sub-tasks)

For sub-tasks, use `ems__Effort_parent`:

```yaml
---
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: Write endpoint tests
ems__Effort_area: "[[Development]]"
ems__Effort_project: "[[Build API Server]]"
ems__Effort_parent: "[[Build /users endpoint]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
```

**Use cases for sub-tasks:**
- Breaking large tasks into steps
- Dependencies between tasks
- Tracking sub-components

---

## Moving Through Statuses

### Using Action Buttons

Buttons appear contextually based on current status:

| Current Status | Available Buttons |
|----------------|-------------------|
| Draft | Set Draft Status, Move to Backlog, Archive |
| Backlog | Move to Analysis, Archive |
| Analysis | Move to ToDo, Move to Backlog |
| ToDo | Start Effort (→ Doing), Move to Analysis |
| Doing | Mark Done, Move to ToDo |
| Done | Archive |

**Click button → Status updates automatically → Timestamp recorded**

### Using Command Palette

Cmd/Ctrl + P → Type status command:
- "Set Draft Status"
- "Move to Backlog"
- "Move to Analysis"
- "Move to ToDo"
- "Start Effort"
- "Mark Done"

### Manual Status Change

Edit frontmatter directly:

```yaml
ems__Effort_status: "[[ems__EffortStatusDoing]]"
```

**⚠️ Warning**: Manual changes don't record timestamps. Use buttons/commands for proper tracking.

### Status Timestamps

Exocortex automatically tracks status changes:

```yaml
ems__Effort_status_changes:
  - status: "[[ems__EffortStatusToDo]]"
    timestamp: "2025-11-10T08:00:00Z"
  - status: "[[ems__EffortStatusDoing]]"
    timestamp: "2025-11-10T09:30:00Z"
  - status: "[[ems__EffortStatusDone]]"
    timestamp: "2025-11-10T14:15:00Z"
```

**Use timestamps to:**
- Analyze time-in-status
- Track work duration
- Generate velocity metrics

---

## Planning Tasks

### Scheduling for Specific Days

1. Open task in Reading Mode
2. Click **"Plan on Today"** button

Result:
```yaml
ems__Effort_scheduled_start_date: "2025-11-10"
```

Task now appears in `2025-11-10.md` daily note's **Daily Tasks** section.

### Planning for Evening

1. Click **"Plan for Evening"** button

Result:
```yaml
ems__Effort_scheduled_start_date: "2025-11-10"
ems__Session_scheduled_start_time: "18:00"
```

### Shifting Days

Use arrow buttons to reschedule:
- **◀ Shift Day Backward**: Moves task to previous day
- **▶ Shift Day Forward**: Moves task to next day

**Example**: Task planned for Nov 10 → Click ▶ → Now planned for Nov 11

### Planning Multiple Tasks

1. Open daily note (`2025-11-10.md`)
2. Click "Plan on Today" on each task you want to schedule
3. View aggregate plan in daily note

---

## Working on Tasks

### Starting Work

1. Open task in Reading Mode
2. Click **"Start Effort"** button

Changes:
```yaml
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_started_on: "2025-11-10T09:30:00Z"
```

### Tracking Progress

Add progress notes in the task content:

```markdown
# Build /users endpoint

## Progress Log

### 2025-11-10 09:30
- Set up Express router
- Implemented GET /users

### 2025-11-10 11:00
- Implemented POST /users
- Added validation
```

### Pausing Work

If you need to pause:
1. Click "Move to ToDo" (returns to ready-to-start state)
2. Add note in content explaining why paused

### Switching Tasks

No special action needed:
- Start new task (click "Start Effort" on different task)
- Both tasks show as "Doing" until completed
- Use timestamps to track actual work time

---

## Completing Tasks

### Marking Done

1. Open task in Reading Mode
2. Click **"Mark Done"** button

Changes:
```yaml
ems__Effort_status: "[[ems__EffortStatusDone]]"
ems__Effort_completed_on: "2025-11-10T14:15:00Z"
```

### Verification Checklist

Before marking done:
- [ ] All acceptance criteria met
- [ ] Sub-tasks completed (if any)
- [ ] Documentation updated
- [ ] Tests passing

### Post-Completion

After marking done:
- Task still appears in relations
- Task appears in daily note (if scheduled)
- Use "Archive" to hide from active views (optional)

---

## Archiving and Cleanup

### When to Archive

Archive tasks that are:
- Completed and no longer need visibility
- Cancelled/abandoned efforts
- Duplicates or mistakes

### Archiving a Task

1. Open task in Reading Mode
2. Click **"Archive"** button

Changes:
```yaml
exo__Asset_archived: true
```

Archived tasks:
- Hidden from daily note by default (toggle with "Show Archived")
- Hidden from relations (unless explicitly shown)
- Still searchable in Obsidian

### Trashing a Task

For permanent removal:
1. Click **"Trash"** button
2. Confirm deletion
3. Task moved to Obsidian trash

**⚠️ Warning**: Use sparingly. Archiving is usually better for historical reference.

### Bulk Cleanup

Use "Clean Properties" command to:
- Remove empty properties
- Format inconsistent values
- Fix malformed wiki-links

---

## Best Practices

### Task Naming

**Good names:**
- "Build /users REST endpoint"
- "Fix login redirect bug"
- "Write getting-started documentation"

**Bad names:**
- "Task 1" (not descriptive)
- "Do the thing" (vague)
- "Fix bug" (which bug?)

### Task Sizing

**Ideal task duration: 2-6 hours**

Too large (>8 hours):
- Break into sub-tasks
- Convert to project if multi-day

Too small (<30 minutes):
- Combine with related tasks
- Consider checklist instead

### Status Discipline

**Do:**
- ✅ Move tasks through statuses consistently
- ✅ Use buttons/commands (not manual edits)
- ✅ Keep tasks in appropriate status
- ✅ Archive completed tasks regularly

**Don't:**
- ❌ Skip Analysis for complex tasks
- ❌ Leave tasks in "Doing" overnight
- ❌ Keep hundreds of "Done" tasks unarchived
- ❌ Edit timestamps manually

### Daily Planning

**Morning routine:**
1. Open today's daily note
2. Review planned tasks
3. Adjust priorities (vote/re-order)
4. Start first task

**Evening routine:**
1. Mark completed tasks as "Done"
2. Reschedule incomplete tasks (◀ / ▶)
3. Archive finished tasks
4. Plan tomorrow

### Sub-Task Management

**When to use sub-tasks:**
- Task > 8 hours effort
- Clear sequential dependencies
- Different skill sets required

**When NOT to use:**
- Simple checklists (use markdown lists instead)
- Parallel work (create separate tasks)
- Micro-management (trust yourself!)

---

## Common Patterns

### Pattern 1: Backlog Grooming

Weekly review of backlog:
```markdown
1. Open area note
2. Review all "Backlog" tasks in relations
3. Vote on high-priority tasks
4. Move top-voted to "Analysis"
5. Archive abandoned tasks
```

### Pattern 2: Sprint Planning

Plan tasks for week/sprint:
```markdown
1. Filter tasks by "ToDo" status
2. Vote to prioritize
3. Estimate effort for top tasks
4. Schedule high-priority tasks to specific days
5. Sum total effort to check capacity
```

### Pattern 3: Blocked Task

Handle dependencies:
```markdown
1. Move task to "Analysis"
2. Add blocking reason in content:
   "Blocked by: [[API authentication]] must complete first"
3. Link to blocking task
4. When unblocked, move back to "ToDo"
```

### Pattern 4: Recurring Tasks

For weekly/monthly tasks:
```markdown
1. Create template task
2. Clone task for each occurrence
3. Update date-specific details
4. Schedule to appropriate days
```

---

## Quick Reference

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Command palette | Cmd/Ctrl + P |
| Switch to Reading Mode | Cmd/Ctrl + E |
| Quick switcher | Cmd/Ctrl + O |
| Search | Cmd/Ctrl + Shift + F |

### Status Transitions

```
Common paths:
- New task: Create → ToDo → Doing → Done → Archive
- Complex task: Create → Backlog → Analysis → ToDo → Doing → Done
- Cancelled: Any → Archive
```

### Property Quick Copy

Essential task frontmatter:
```yaml
---
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: [Task Name]
ems__Effort_area: "[[Area Name]]"
ems__Effort_project: "[[Project Name]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
ems__Effort_scheduled_start_date: "YYYY-MM-DD"
---
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Task not in daily note | Check `ems__Effort_scheduled_start_date` matches daily note's `pn__Day_date` |
| Buttons don't appear | Verify `exo__Instance_class` contains `"[[ems__Task]]"` |
| Status won't change | Check for typos in status wiki-link |
| Task disappeared | Check if accidentally archived (`exo__Asset_archived: true`) |

---

**Next**: [Project Workflows →](Project-Workflow.md) | [Back to Getting Started](../Getting-Started.md)
