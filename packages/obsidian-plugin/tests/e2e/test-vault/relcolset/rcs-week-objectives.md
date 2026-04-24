---
exo__Instance_class: "[[ui__RelationColumnSet]]"
exo__Asset_uid: fixture-rcs-week-objectives
exo__Asset_label: "Week Objectives columns (RCS fixture)"
ui__RelationColumnSet_label: "Week Objectives columns"
ui__RelationColumnSet_targetClass: "[[ems__WeeklyObjective]]"
ui__RelationColumnSet_referencingProperty: "[[ems__WeeklyObjective__week]]"
ui__RelationColumnSet_columns:
  - "exo__Asset_createdAt"
  - "exo__Asset_label"
ui__RelationColumnSet_priority: 10
---

# Week Objectives columns

Configures the UniversalLayout auto-backlinks columns for `ems__WeeklyObjective`
rows grouped under `ems__WeeklyObjective__week`. Consumed by the Phase 3 E2E
smoke spec.
