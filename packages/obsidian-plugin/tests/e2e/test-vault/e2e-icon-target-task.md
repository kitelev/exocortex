---
exo__Asset_uid: e2e-icon-target-task
exo__Asset_label: "Icon Target Task (root, T7.3 e2e fixture)"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---

RFC-024 §4 Phase 4 (T7.3) E2E fixture. Lives at vault root so the
`nav-file-title` is rendered without expanding any folder. The
`exolayout/layout-task-featured-binding.md` layout declares
`exo__Layout_icon: check-square` for `ems__Task`, so
`FileExplorerIconPatch` must inject `.exo-file-explorer-icon` here.
