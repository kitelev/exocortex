# Daily Planning Guide

**Organize your day with daily notes and task scheduling.**

---

## Creating Daily Notes

### Auto-Generated Format

Daily notes use `pn__DailyNote` class with date property:

```yaml
---
exo__Instance_class:
  - "[[pn__DailyNote]]"
exo__Asset_label: "2025-11-10"
pn__Day_date: "2025-11-10"  # ISO format: YYYY-MM-DD
---

# 2025-11-10

Today's focus: [Add notes here]
```

**File naming**: Use ISO date format (`2025-11-10.md`) for consistency.

---

## Scheduling Tasks

### Adding Tasks to Daily Note

1. Open task in Reading Mode
2. Click **"Plan on Today"** button

Updates task frontmatter:
```yaml
ems__Effort_scheduled_start_date: "2025-11-10"
```

### Viewing Daily Tasks

Open daily note in Reading Mode:

**Daily Tasks Section shows:**
- All tasks scheduled for this date
- Grouped by area
- Sorted by project
- Status, votes, buttons for each task

### Filtering by Focus Area

Set focus to show only specific area's tasks:

1. Click **"Set Focus Area"** button in daily note
2. Select area from dropdown
3. Daily Tasks section filters to that area only

Clear focus:
1. Click **"Set Focus Area"** again
2. Select "(No focus)" option

---

## Shifting Task Dates

### Using Arrow Buttons

From daily note or task note:
- **◀ Shift Day Backward**: Reschedule to previous day
- **▶ Shift Day Forward**: Reschedule to next day

### Bulk Rescheduling

To move multiple tasks:
1. Open each task from daily note
2. Click shift buttons
3. Tasks move to new date

---

## Planning for Evening

Schedule tasks for specific time:

1. Click **"Plan for Evening"** button
2. Task scheduled to today at 18:00

```yaml
ems__Effort_scheduled_start_date: "2025-11-10"
ems__Session_scheduled_start_time: "18:00"
```

---

## Daily Workflow

### Morning Routine

```markdown
1. Open today's daily note
2. Review scheduled tasks
3. Vote/prioritize (if needed)
4. Start first task (click "Start Effort")
5. Add focus notes in daily note content
```

### Afternoon Check-in

```markdown
1. Mark completed tasks as "Done"
2. Update progress notes
3. Adjust priorities if needed
4. Reschedule blocked tasks
```

### Evening Wrap-up

```markdown
1. Complete remaining tasks or reschedule
2. Archive finished tasks
3. Review tomorrow's schedule
4. Plan new tasks for tomorrow
```

---

## Best Practices

### Task Load

**Healthy daily load: 4-8 tasks**

Too many (>10):
- Overcommitted
- Reschedule lower priority
- Break tasks into smaller units

Too few (<3):
- Add more tasks from backlog
- May need better task breakdown

### Time Blocking

Add time blocks in daily note content:

```markdown
## Schedule

**Morning (9:00-12:00)**
- [[Build /users endpoint]]
- [[Write API tests]]

**Afternoon (13:00-17:00)**
- [[Deploy to staging]]
- [[Code review]]

**Evening (18:00-20:00)**
- [[Update documentation]]
```

### Archive Toggle

Daily notes can show/hide archived tasks:

1. Click **"Toggle Archived Assets"** button
2. Archived tasks appear greyed out
3. Click again to hide

**Use case**: Review completed work without cluttering active view.

---

## Common Patterns

### Pattern 1: Weekly Planning

Sunday evening:
```markdown
1. Create daily notes for week (Mon-Fri)
2. Review backlog tasks
3. Assign high-priority to specific days
4. Balance load across week
```

### Pattern 2: Sprint Planning

Start of sprint:
```markdown
1. Create daily notes for sprint duration
2. Distribute sprint tasks across days
3. Leave buffer days for blockers
4. Review and adjust daily
```

### Pattern 3: Time-Specific Work

For appointments/deadlines:
```markdown
1. Use "Plan for Evening" for time-specific work
2. Add time notes in task content:
   "Meeting at 14:00 - Demo API to team"
3. Set reminders in Obsidian (if plugin installed)
```

---

## Quick Reference

### Daily Note Template

```yaml
---
exo__Instance_class:
  - "[[pn__DailyNote]]"
exo__Asset_label: "YYYY-MM-DD"
pn__Day_date: "YYYY-MM-DD"
---

# YYYY-MM-DD

## Focus
[Today's main objective]

## Notes
[Context, blockers, insights]
```

### Common Commands

| Action | Command |
|--------|---------|
| Plan task | "Plan on Today" button |
| Shift forward | ▶ button |
| Shift backward | ◀ button |
| Set focus area | "Set Focus Area" button |
| Toggle archived | "Toggle Archived Assets" button |

---

**Next**: [Area Organization →](Area-Organization.md) | [Back to Project Workflow](Project-Workflow.md)
