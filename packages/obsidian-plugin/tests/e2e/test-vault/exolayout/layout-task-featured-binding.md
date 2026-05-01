---
exo__Asset_uid: e2e-layout-task-featured-binding
exo__Asset_label: "Task Layout (featuredBinding test)"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[exo__TableLayout]]"
exo__Layout_targetClass: "[[ems__Task]]"
exo__Layout_priority: 100
exo__Layout_icon: check-square
exo__Layout_commandPanel:
  featuredBinding: "[[e2e-bind-status-done-for-tasks]]"
  collapsedGroups:
    - maintenance
---

RFC-024 §3 Phase 3 e2e fixture: a TaskLayout for `ems__Task` whose
`commandPanel` promotes the `Complete` binding to the `primary`
variant (singleton invariant — Phase 3 §"Метрики успеха").

`exo__Layout_priority: 100` keeps this fixture out of conflict with
the demo-class layout (different `targetClass`) and signals "lowest
wins" precedence is irrelevant here — there is no other layout
targeting `ems__Task` in the test vault.

`includeGroups` and `excludeCommands` are intentionally omitted so
all preconditioned bindings still render; only `featuredBinding`
modifies the `Complete` button's variant from `success` (status
group default) to `primary`.

`collapsedGroups: [maintenance]` exercises the RFC layout-collapsedGroups
extension: vault-supplied override re-asserting the TS-default
collapse for the `maintenance` category. Behaviour-neutral against
pre-RFC fixtures (TS default also collapses maintenance), but ensures
the parsed-panel → `resolveCategoryCollapsed(id, panel)` precedence
chain is exercised on a real fixture.
