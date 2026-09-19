---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: eee55555-5555-4555-8555-555555555555
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: ems__Task_hours
exo__Property_domain:
  - "[[ems__Task]]"
exo__Property_range: xsd:decimal
exo__Property_severity: sh:Violation
aliases:
  - ems__Task_hours
---

Test shape (ticket d5ad5217): range `xsd:decimal` with a WHOLE number written in YAML
(`ems__Task_hours: 20` — the live `pmbok__ChangeRequest_costImpactHours` case on
`b5a670e8`). Since d5ad5217 the converter tags `20` xsd:integer; it must still conform
to xsd:decimal by lexical form (integer ⊂ decimal), not fail on strict tag equality.
