---
exo__Instance_class: "[[exo__Document]]"
exo__Asset_label: "ExoQL Test Page"
exo__Asset_uid: e2e-exoql-test-page
---

# ExoQL Test Page

This page tests ExoQL code block rendering.

```exoql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label
WHERE {
  ?asset exo:Asset_label ?label .
}
LIMIT 5
```
