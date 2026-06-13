---
exo__Asset_uid: e2e-c3-cat-instance
exo__Asset_label: "Tom the Cat"
exo__Asset_isDefinedBy: "[[!kitelev]]"
exo__Instance_class:
  - "[[1ef688c9-6955-4402-ad71-7baeffe2a7d6]]"
---

# Tom the Cat

C3 capability-inheritance e2e fixture (issue #3505). `e2ecap__Cat ⊑ e2ecap__Animal`.
A Cat-level binding (`Custom Feed`) carries `exocmd__CommandBinding_overrides`
targeting the inherited Animal "Feed Animal" binding, so the inherited button is
hidden and only "Custom Feed" renders.
