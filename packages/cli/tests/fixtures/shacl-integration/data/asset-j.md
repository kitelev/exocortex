---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: aaaaaaaa-bbbb-4aaa-8bbb-aaaaaaaaaaaa
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: Asset J
ems__Task_sourceUrl: not a uri
aliases:
  - Asset J
---

Asset J: one sh:datatype violation — `not a uri` is not an absolute IRI under the `xsd:anyURI`
shape `ems__Task_sourceUrl` (ticket e55b0a07; IRI.isValidIRI rejects whitespace).
