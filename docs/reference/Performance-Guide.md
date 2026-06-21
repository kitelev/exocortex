# Performance Guide

**Optimization tips and performance characteristics.**

---

## Query Performance

### Indexed triple store

`InMemoryTripleStore` (`packages/core/src/infrastructure/rdf/InMemoryTripleStore.ts`) maintains six permutation indexes (SPO, SOP, PSO, POS, OSP, OPS), so any combination of bound subject / predicate / object is answered by index lookup instead of a full scan:

```typescript
import { Namespace } from "@kitelev/exocortex-core";

// Bound predicate + object → served by the POS index
const taskTriples = await store.match(
  undefined, // any subject
  Namespace.RDF.term("type"), // rdf:type
  Namespace.EMS.term("Task"), // ems:Task
);
```

A dedicated UUID index additionally accelerates `FILTER(CONTAINS(STR(?s), "<uuid>"))` patterns, which are common in vault queries.

### LRU cache

The triple store keeps an LRU cache (1000 entries) of `match()` results, invalidated on every write:

```typescript
await store.match(s, p, o); // computed, then cached
await store.match(s, p, o); // served from cache until the next add/remove
```

The `exocortex` package also exports `QueryPlanCache` and `SPARQLResultCache` (`src/infrastructure/sparql/cache/`) as building blocks for embedders that want plan/result caching on top of the engine.

---

## Mobile Optimization

### Platform Detection

```typescript
if (Platform.isMobile) {
  // Use smaller batch sizes
  const batchSize = 10;
} else {
  const batchSize = 50;
}
```

### Touch Gestures

- Momentum scrolling
- Haptic feedback
- Optimized tap targets (44px min)

---

## Rendering Optimization

### Virtual Scrolling

Large lists use virtual scrolling:

- Only renders visible items
- Maintains 60 FPS
- Handles 1000+ items smoothly

### Memoization

React components use `useMemo` hooks to avoid recomputing derived data (sorting, grouping, filtering) on every render:

```typescript
const sortedRows = useMemo(
  () => sortRows(rows, sortColumn, sortDirection),
  [rows, sortColumn, sortDirection],
);
```

---

## Bundle Size

Current sizes:

- React: 171kb
- Plugin: 35kb
- Total: ~206kb

---

**See also:**

- [Architecture](../../ARCHITECTURE.md)
