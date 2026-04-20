---
exo__Asset_uid: smoke-set-status-doing-task
exo__Asset_label: "Smoke task (Set Status Doing)"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[ems__Task]]"
---

Phase 3 smoke fixture for `Set Status Doing` (composite grounding — sets
`ems__Effort_status` AND `ems__Effort_startTimestamp`).

No `ems__Effort_status` present so:

- Existing test-vault `e2e-cmd-set-status-doing` ("Start", precondition `Status is Backlog`) → hidden.
- Starter-kit `e941b3bb` (relabeled "Start", precondition `Not in Doing status`) → visible
  (and bound via `targetAsset` to this asset only — divergence #5 — to avoid clashing with
  `e2e-cmd-set-status-doing` on other Backlog tasks in the vault).

After click, the composite grounding `23727560-…` writes `Doing` + `$nowLocal` timestamp.
