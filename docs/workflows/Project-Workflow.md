# Project Workflow Guide

**Managing multi-task initiatives from planning to completion.**

---

## Quick Navigation

- [Creating Projects](#creating-projects)
- [Project Lifecycle](#project-lifecycle)
- [Task Management](#task-management)
- [Tracking Progress](#tracking-progress)
- [Project Completion](#project-completion)

---

## Creating Projects

### Using Create Project Button

1. Open area note in Reading Mode
2. Click **"Create Project"**
3. Fill form:
   - **Label**: Project name
   - **Status**: `ems__EffortStatusBacklog` (default)
   - **Area**: Auto-filled

Result: `projects/project-build-api.md` created with:

```yaml
---
exo__Instance_class:
  - "[[ems__Project]]"
exo__Asset_label: Build API Server
ems__Effort_area: "[[Development]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---
# Build API Server

REST API for mobile app.
```

### Manual Creation

```yaml
---
exo__Instance_class:
  - "[[ems__Project]]"
exo__Asset_label: [Project Name]
ems__Effort_area: "[[Area Name]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
ems__Effort_votes: 0
---

# [Project Name]

## Objective
[What success looks like]

## Key Deliverables
- [ ] Deliverable 1
- [ ] Deliverable 2

## Timeline
Target: [Date or Quarter]
```

---

## Project Lifecycle

### States

```
Draft → Backlog → Analysis → ToDo → Doing → Done
```

Same as tasks, but:

- **Backlog**: Awaiting resource allocation
- **Analysis**: Defining scope, tasks, timeline
- **ToDo**: Ready to start (tasks created)
- **Doing**: Active work on tasks
- **Done**: All tasks completed

### Typical Duration

| Status   | Duration        | Percentage Complete |
| -------- | --------------- | ------------------- |
| Draft    | 1-7 days        | 0%                  |
| Backlog  | Weeks to months | 0%                  |
| Analysis | 1-5 days        | 0-10%               |
| ToDo     | Days to weeks   | 10-20%              |
| Doing    | Weeks to months | 20-95%              |
| Done     | Permanent       | 100%                |

---

## Task Management

### Creating Project Tasks

1. Open project note
2. Click **"Create Task"** repeatedly for each work item
3. Tasks auto-link to project via `ems__Effort_project`

### Breaking Down Projects

**Good project = 5-15 tasks**

Too few tasks (<3):

- May not need project structure
- Consider converting to single task

Too many tasks (>20):

- Break into milestones
- Create multiple projects
- Group related tasks

### Example: API Server Project

```
Build API Server (Project)
├── Set up Node.js environment (Task)
├── Configure Express server (Task)
├── Build /users endpoint (Task)
├── Build /posts endpoint (Task)
├── Implement authentication (Task)
├── Write API tests (Task)
├── Deploy to staging (Task)
└── Deploy to production (Task)
```

---

## Tracking Progress

### Progress Calculation

Exocortex doesn't auto-calculate progress. Track manually:

**Option 1: Checklist in content**

```markdown
## Progress

- [x] Environment setup
- [x] Express configuration
- [ ] User endpoint
- [ ] Post endpoint
- [ ] Authentication
- [ ] Tests
- [ ] Deployment
```

**Option 2: Add progress property**

```yaml
ems__Effort_progress_percentage: 40
```

**Option 3: Count completed tasks**

- 3 / 8 tasks done = 37.5% complete

### Project Dashboard

View project status from project note:

**Asset Relations section shows:**

- All child tasks
- Status of each task
- Vote counts
- Scheduled dates

**Sort by status** to see:

- What's done
- What's in progress
- What's blocked

---

## Project Completion

### Completion Criteria

Project is done when:

- [ ] All tasks completed or archived
- [ ] Deliverables met
- [ ] Documentation updated
- [ ] Stakeholders notified

### Marking Project Done

1. Verify all tasks complete
2. Click **"Mark Done"** on project note
3. Add completion summary in content:

```markdown
## Completion Summary

**Completed**: 2025-11-15
**Duration**: 3 weeks
**Tasks**: 8 completed, 2 archived (out of scope)

### Outcomes

- API deployed to production
- 95% test coverage
- Documentation published

### Lessons Learned

- Authentication took longer than expected
- Should have split user/post endpoints into separate stories
```

### Post-Completion

- Project remains in relations
- Tasks remain accessible
- Archive project if needed (optional)

---

## Best Practices

### Project Naming

**Good:**

- "Build Mobile App"
- "Migrate to Kubernetes"
- "Launch Marketing Campaign Q4"

**Bad:**

- "Project 1" (not descriptive)
- "Do stuff" (vague)
- "Fix things" (use task instead)

### Project Scope

**Clear scope indicators:**

- Specific objective
- Defined deliverables
- Measurable success criteria
- Time-bounded (even if flexible)

**Scope creep warning signs:**

- Tasks keep getting added
- No clear completion criteria
- "One more feature" syndrome

**Fix**: Create new project for scope additions

### Vote on Projects

Prioritize projects within area:

1. Open area note
2. View all projects in Asset Relations
3. Vote on high-value projects
4. Move top-voted to Analysis

---

## Common Patterns

### Pattern 1: Milestone Projects

For large initiatives:

```
Phase 1: MVP
├── Core features (Project)
├── Basic UI (Project)
└── Alpha testing (Project)

Phase 2: Enhancement
├── Advanced features (Project)
├── Polish UI (Project)
└── Beta testing (Project)
```

### Pattern 2: Epic Projects

Group related projects under area:

```
Mobile App Development (Area)
├── iOS App (Project)
├── Android App (Project)
├── Backend API (Project)
└── Shared Components (Project)
```

### Pattern 3: Recurring Projects

Quarterly/annual projects:

```
Q4 2025 Marketing (Project)
├── Content calendar (Task)
├── Social media campaigns (Task)
├── Email newsletters (Task)
└── Analytics review (Task)
```

Clone for next quarter, update dates.

---

## Quick Reference

### Essential Properties

```yaml
exo__Instance_class:
  - "[[ems__Project]]"
exo__Asset_label: [Name]
ems__Effort_area: "[[Area]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
ems__Effort_votes: 0
ems__Effort_plannedStartTimestamp: "YYYY-MM-DD" # optional
```

### Common Commands

| Action         | Command/Button                      |
| -------------- | ----------------------------------- |
| Create project | Area note → "Create Project" button |
| Create task    | Project note → "Create Task" button |
| Change status  | Status buttons or Command Palette   |
| Vote           | "Vote" button                       |
| Schedule       | "Plan on Today" button              |

---

**Next**: [Daily Planning →](Daily-Planning.md) | [Back to Task Workflow](Task-Workflow.md)
