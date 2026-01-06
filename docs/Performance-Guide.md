# Performance Guide

**Optimization tips and performance characteristics.**

---

## Query Performance

### IndexedGraph

**10x faster queries** through SPO/POS/OSP indexing:

```typescript
// O(1) lookup instead of O(n) scan
const tasks = store.query({
  predicate: 'rdf:type',
  object: 'ems:Task'
});
```

### LRU Cache

**90% hit rate** for repeated queries:

```typescript
// Cached for subsequent calls
store.query(pattern);  // 100ms first call
store.query(pattern);  // <1ms cached
```

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

React components memoized:

```typescript
const MemoizedComponent = React.memo(MyComponent);
```

---

## Bundle Size

Current sizes:
- React: 171kb
- Plugin: 35kb
- Total: ~206kb

---

**See also:**
- [SPARQL Performance Tips](./sparql/Performance-Tips.md)
- [Architecture](../ARCHITECTURE.md)
