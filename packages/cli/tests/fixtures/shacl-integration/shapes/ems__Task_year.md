---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: ddd44444-4444-4444-4444-444444444444
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: ems__Task_year
exo__Property_domain:
  - "[[ems__Task]]"
exo__Property_range: xsd:gYear
exo__Property_severity: sh:Violation
aliases:
  - ems__Task_year
---

Test shape (ticket a9b55ead): bare CURIE `xsd:gYear` range; a YAML number `1987` is tagged
xsd:decimal (until d5ad5217) / xsd:integer (since) by the converter and must conform by
lexical form under either tag.
