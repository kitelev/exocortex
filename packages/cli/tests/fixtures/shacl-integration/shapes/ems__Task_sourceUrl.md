---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: eee66666-6666-4666-8666-666666666666
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ae56ca4c-b610-42a4-a25d-058c23673296]]"
exo__Asset_label: ems__Task_sourceUrl
exo__Property_domain:
  - "[[ems__Task]]"
exo__Property_range: "xsd:anyURI"
exo__Property_severity: sh:Violation
aliases:
  - ems__Task_sourceUrl
---

Test shape (ticket e55b0a07): range `xsd:anyURI` in the pure-UID `exo__DatatypeProperty` form
(the form of the one live anyURI def, `lit__Conspect_sourceUrl`). The converter tags every YAML
string `xsd:string`, so this range is reachable only through the string-tag lexicon of
`literalConformsToDatatype` (`IRI.isValidIRI`).
