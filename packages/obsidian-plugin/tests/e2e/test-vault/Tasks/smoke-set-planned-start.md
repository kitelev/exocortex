---
exo__Asset_uid: smoke-set-planned-start-task
exo__Asset_label: "Smoke task (Set Planned Start)"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
aliases:
  - smoke-set-planned-start-task
---

Phase 3 smoke fixture for `Set Planned Start`. No `ems__Effort_plannedStartTimestamp`
present so the grounding writes a fresh value (UX RFC P1-3 regression guard checks
the literal `$input` / `$value` placeholder is NOT persisted).
