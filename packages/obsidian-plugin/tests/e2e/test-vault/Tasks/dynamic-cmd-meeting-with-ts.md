---
exo__Asset_uid: e2e-meeting-with-start-timestamp
exo__Asset_label: "Meeting With Start Timestamp"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_startTimestamp: "2026-03-30T10:00:00+0500"
---

ems**Meeting instance (UID-canon `exo**Instance_class: [[1b0a5e34-…]]`, mirrors the
845 production Meeting instances) WITH startTimestamp.

The "Remove Start Timestamp" button is bound to `targetClass: ems__Task`. It must be
inherited here via the `exo__Class_superClass` walk: the instance declares the Meeting
class by UUID → `getClassAncestors` resolves `1b0a5e34` → superClass `1b20a8f0`
(ems**Task) → symbolic `ems**Task` is appended → the Task-targeted binding matches
(Issue #3295 / PR #3342).
