---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: 99999999-aaaa-4999-8aaa-999999999999
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: Asset I
ems__Task_sourceUrl: https://example.com/video/1
aliases:
  - Asset I
---

Asset I: no violation — an absolute URL under the `xsd:anyURI` shape `ems__Task_sourceUrl`
(ticket e55b0a07). Before the amendment every string under anyURI was an sh:datatype violation
(string tag ≠ anyURI, strict equality).
