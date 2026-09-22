---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: 88888888-eeee-4888-8eee-888888888888
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: Asset H
ems__Task_hours: 20
ems__Task_weight: 7
aliases:
  - Asset H
---

Asset H: CONFORMS — whole number `20` under range xsd:decimal (`ems__Task_hours`) and `7`
under range xsd:integer (`ems__Task_weight`); both are tagged xsd:integer by the converter
since ticket d5ad5217 (parity with the JSON-LD parser) and conform by lexical form / tag.
