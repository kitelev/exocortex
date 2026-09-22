---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: eee55555-5555-4555-8555-555555555555
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ae56ca4c-b610-42a4-a25d-058c23673296]]"
exo__Asset_label: ems__Task_rank
exo__Property_domain:
  - "[[ems__Task]]"
exo__Property_range: "xsd:integer"
exo__Property_severity: sh:Violation
aliases:
  - ems__Task_rank
---

Test shape (ticket 84bb4d08): typed ONLY `exo__DatatypeProperty` (pure-UID form, the form
`create --class DatatypeProperty` writes for 291/220/200 live defs) — reaches sh:datatype only
through the `exo__Class_superClass` chain declared in `tbox/`.
