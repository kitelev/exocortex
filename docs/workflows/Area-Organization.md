# Area Organization Guide

**Structure your knowledge domains with hierarchical areas.**

---

## What Are Areas?

Areas represent broad domains of work:
- **Development**: All software projects
- **Marketing**: Campaigns, content, outreach
- **Operations**: Infrastructure, processes
- **Personal**: Personal projects, learning

**Key principle**: Areas are long-lived categories, not temporary projects.

---

## Creating Areas

### Simple Area

```yaml
---
exo__Instance_class:
  - "[[ems__Area]]"
exo__Asset_label: Development
---

# Development

All software engineering efforts.
```

### Area with Parent

```yaml
---
exo__Instance_class:
  - "[[ems__Area]]"
exo__Asset_label: Frontend Development
ems__Area_parent: "[[Development]]"
---

# Frontend Development

React, UI/UX, client-side work.
```

---

## Area Hierarchies

### Building Hierarchies

```
Company (Area)
├── Engineering (Area)
│   ├── Backend (Area)
│   ├── Frontend (Area)
│   └── DevOps (Area)
├── Product (Area)
└── Marketing (Area)
```

**Implementation**:
```yaml
# Backend.md
ems__Area_parent: "[[Engineering]]"

# Engineering.md
ems__Area_parent: "[[Company]]"
```

### Viewing Hierarchies

Open area note in Reading Mode:

**Area Hierarchy Tree section shows:**
- Interactive collapsible tree
- All parent/child relationships
- Click areas to navigate

---

## Managing Projects in Areas

### Viewing Area's Projects

Open area note → **Asset Relations section**:
- All projects with `ems__Effort_area: [[This Area]]`
- Sort by status, votes, name
- Click to open project

### Creating Projects in Area

1. Click **"Create Project"** button
2. Project auto-assigned to area

---

## Best Practices

### Area Granularity

**Good areas**:
- Stable domains (not changing frequently)
- 5-15 projects per area
- Clear boundaries

**Too broad**:
- "Work" (split into domains)
- "Everything" (not useful)

**Too narrow**:
- "React Components" (use project instead)
- "Q4 2025" (use project with time bounds)

### Depth Limits

**Recommended hierarchy depth: 2-3 levels**

Example (good):
```
Company → Engineering → Backend  (3 levels)
```

Example (too deep):
```
Company → Engineering → Backend → API → Users → Authentication  (6 levels)
```

**Fix**: Flatten or use projects for specific work.

---

## Common Patterns

### Pattern 1: By Department

```
Sales (Area)
├── Outbound Sales (Area)
└── Customer Success (Area)

Marketing (Area)
├── Content (Area)
└── Social Media (Area)
```

### Pattern 2: By Technology

```
Engineering (Area)
├── Web (Area)
│   ├── Frontend (Area)
│   └── Backend (Area)
└── Mobile (Area)
    ├── iOS (Area)
    └── Android (Area)
```

### Pattern 3: By Product

```
Product Line A (Area)
├── Feature Development (Area)
└── Maintenance (Area)

Product Line B (Area)
├── Feature Development (Area)
└── Maintenance (Area)
```

---

## Quick Reference

### Area Frontmatter

```yaml
---
exo__Instance_class:
  - "[[ems__Area]]"
exo__Asset_label: [Area Name]
ems__Area_parent: "[[Parent Area]]"  # optional
---
```

### Common Commands

| Action | Command |
|--------|---------|
| Create area | Command Palette → "Create Instance" → ems__Area |
| Create project in area | Area note → "Create Project" button |
| View hierarchy | Open area note in Reading Mode → Area Hierarchy Tree |

---

**Next**: [Effort Voting →](Effort-Voting.md) | [Back to Daily Planning](Daily-Planning.md)
