---
exo__Asset_uid: smoke-create-child-task-project
exo__Asset_label: "Smoke parent project (Create Child Task)"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---

Phase 3 smoke fixture for `Create Child Task`. Class is `ems__Project` because the
upstream `Create Child Task` binding (UID `d2dc8cbc-...`) targets `ems__Project`/`ems__Area`,
not `ems__Task` (b60fcb4a handoff was incorrect on this point).
