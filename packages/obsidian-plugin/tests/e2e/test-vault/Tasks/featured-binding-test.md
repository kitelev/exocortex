---
exo__Asset_uid: e2e-task-featured-binding
exo__Asset_label: "Featured Binding Test Task"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_startTimestamp: "2026-04-30T09:00:00+0500"
---

RFC-024 §3 Phase 3 e2e fixture for `featuredBinding` invariant:
exactly one binding (`e2e-bind-status-done-for-tasks` → "Complete")
must be promoted to the `primary` action-button variant in this
task's command panel; all other visible bindings keep their
group-default variant.

Status `Doing` is required so the precondition `Status is Doing`
on the `Complete` command passes and its binding renders.
