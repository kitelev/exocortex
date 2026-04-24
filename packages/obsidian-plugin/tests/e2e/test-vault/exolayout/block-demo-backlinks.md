---
exo__Instance_class: "[[exo__BacklinksTableBlock]]"
exo__Asset_uid: fixture-exolayout-demo-block
exo__Asset_label: "Demo rows (fixture)"
exo__LayoutBlock_title: "Demo Rows"
exo__BacklinksTableBlock_rowClass: "[[exo__DemoRow]]"
exo__BacklinksTableBlock_referencingProperty: "[[exo__DemoRow__target]]"
exo__BacklinksTableBlock_columns:
  - "[[exo__Asset_createdAt]]"
  - "[[exo__Asset_label]]"
exo__BacklinksTableBlock_sortOrder: "asc"
---

# Demo rows block

Phase 3 E2E smoke fixture — declares a backlinks table with exactly two
columns (`exo__Asset_createdAt`, `exo__Asset_label`) for `exo__DemoRow`
assets referencing the open note via `exo__DemoRow__target`.
