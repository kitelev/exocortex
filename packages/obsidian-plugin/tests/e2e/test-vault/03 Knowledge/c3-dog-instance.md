---
exo__Asset_uid: e2e-c3-dog-instance
exo__Asset_label: "Rex the Dog"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[8fcc7bfd-6166-4b69-81b2-54407e3898f4]]"
---

# Rex the Dog

C3 capability-inheritance e2e fixture (issue #3505). `e2ecap__Dog ⊑ e2ecap__Animal`.
Surfaces the inherited "Feed Animal" button (bound on the ancestor) plus the
own "Walk Dog" button (bound on the leaf). Nearest-wins ordering: "Walk Dog"
(depth 0) renders above "Feed Animal" (depth 1).
