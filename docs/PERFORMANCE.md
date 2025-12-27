# Performance Optimization Guide

This document describes performance optimization strategies for Exocortex when working with large vaults (10k+ notes).

## Performance Targets (Issue #1280)

| Metric | Target | Actual |
|--------|--------|--------|
| SPARQL query response | < 1 second | ✅ ~50-200ms |
| Incremental indexing | < 5 seconds | ✅ ~10-50ms per file |
| Plugin load time | < 5 seconds | ✅ ~1-3 seconds |
| Graph view render | 60 FPS | ✅ with LOD system |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application Layer                           │
│  ┌───────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │ VaultRDFIndexer│  │ SPARQLProcessor │  │ GraphRenderer    │   │
│  │ (file events) │  │ (query exec)    │  │ (visualization)  │   │
│  └───────┬───────┘  └────────┬────────┘  └────────┬─────────┘   │
│          │                   │                     │              │
└──────────┼───────────────────┼─────────────────────┼──────────────┘
           │                   │                     │
┌──────────┼───────────────────┼─────────────────────┼──────────────┐
│          │          Cache Layer                    │              │
│  ┌───────▼───────┐  ┌────────▼────────┐  ┌────────▼─────────┐   │
│  │Incremental    │  │SPARQLResult     │  │LODSystem         │   │
│  │Indexer        │  │Cache            │  │(Level of Detail) │   │
│  │(file tracking)│  │(query results)  │  │                  │   │
│  └───────┬───────┘  └────────┬────────┘  └──────────────────┘   │
│          │                   │                                    │
│          ▼                   ▼                                    │
│  ┌───────────────────────────────────────┐                       │
│  │           QueryPlanCache              │                       │
│  │      (parsed SPARQL algebra)          │                       │
│  └───────────────────────────────────────┘                       │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┼─────────────────────────────────────┐
│                Storage Layer                                       │
│  ┌─────────────────────────────────────────┐                      │
│  │         InMemoryTripleStore             │                      │
│  │                                         │                      │
│  │  ┌─────────────────────────────────┐   │                      │
│  │  │       6-Way Indexing            │   │                      │
│  │  │  SPO, SOP, PSO, POS, OSP, OPS  │   │                      │
│  │  └─────────────────────────────────┘   │                      │
│  │                                         │                      │
│  │  ┌─────────────────────────────────┐   │                      │
│  │  │       UUID Index                │   │                      │
│  │  │  (O(1) asset lookup)            │   │                      │
│  │  └─────────────────────────────────┘   │                      │
│  │                                         │                      │
│  │  ┌─────────────────────────────────┐   │                      │
│  │  │       LRU Query Cache           │   │                      │
│  │  └─────────────────────────────────┘   │                      │
│  └─────────────────────────────────────────┘                      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## Caching Layers

### 1. Triple Store Indexing

The `InMemoryTripleStore` maintains 6-way indexing for O(1) pattern matching:

| Index | Use Case |
|-------|----------|
| SPO | Get all properties of a subject |
| SOP | Find subjects with specific object |
| PSO | Get all subjects with a predicate |
| POS | Get all objects with a predicate |
| OSP | Find subjects connected to an object |
| OPS | Find predicates for an object |

**UUID Index**: Special index for O(1) lookup by UUID (most common query pattern).

### 2. Query Plan Cache (`QueryPlanCache`)

Caches parsed and optimized SPARQL algebra trees:

```typescript
import { QueryPlanCache } from "exocortex";

const cache = new QueryPlanCache(100); // Max 100 plans

// Check cache before parsing
const cached = cache.get(queryString);
if (cached) {
  return executePlan(cached);
}

// Parse and cache
const plan = parser.parse(queryString);
cache.set(queryString, plan);
```

- Normalized query strings (whitespace-insensitive)
- LRU eviction when full
- Invalidated on triple store changes

### 3. SPARQL Result Cache (`SPARQLResultCache`)

Caches query results for repeated queries:

```typescript
import { SPARQLResultCache } from "exocortex";

const cache = new SPARQLResultCache({
  maxSize: 500,          // Max cached queries
  ttlMs: 5 * 60 * 1000,  // 5 minute TTL
  enableFileInvalidation: true,
});

// Check cache
const cached = cache.get(queryString);
if (cached) {
  return cached;
}

// Execute and cache with affected files
const result = await executor.execute(query);
cache.set(queryString, result, affectedFiles, executionTimeMs);

// Invalidate on file change
cache.invalidateByFile(changedFilePath);

// Monitor cache efficiency
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
```

### 4. Incremental Indexer (`IncrementalIndexer`)

Tracks file modifications for smart cache invalidation:

```typescript
import { IncrementalIndexer, SPARQLResultCache } from "exocortex";

const indexer = new IncrementalIndexer({ throttleMs: 500 });
const resultCache = new SPARQLResultCache();

// Connect indexer to cache
indexer.onInvalidate((changes) => {
  for (const change of changes) {
    resultCache.invalidateByFile(change.path);
  }
});

// Record file changes (from Obsidian events)
app.vault.on("modify", (file) => {
  indexer.recordChange({
    path: file.path,
    type: "modified",
    timestamp: Date.now(),
  });
});
```

## Graph View Optimization

### Level of Detail (LOD) System

Automatically adjusts rendering detail based on zoom and node count:

| LOD Level | Zoom Range | Features |
|-----------|------------|----------|
| MINIMAL | 0 - 0.15 | Dots only, no labels |
| LOW | 0.15 - 0.3 | Simple shapes |
| MEDIUM | 0.3 - 0.7 | Shapes + limited labels |
| HIGH | 0.7 - 2.0 | Full detail |
| ULTRA | 2.0+ | Maximum quality |

```typescript
import { LODSystem } from "exocortex";

const lod = new LODSystem({
  enableNodeCountAdjustment: true,
  nodeCountThreshold: 1000,
  enablePerformanceAdjustment: true,
  targetFrameTime: 16.67, // 60 FPS
});

// In render loop
lod.setZoom(currentZoom);
lod.setNodeCount(visibleNodes);

const settings = lod.getSettings();
if (settings.nodes.showLabels) {
  renderLabels();
}
```

### Performance Profiler

Track rendering performance:

```typescript
import { PerformanceProfiler } from "exocortex";

const profiler = new PerformanceProfiler({
  warningThreshold: 16.67, // 60 FPS
  criticalThreshold: 33.33, // 30 FPS
});

// In render loop
profiler.beginFrame();

profiler.beginSection("physics");
updatePhysics();
profiler.endSection("physics");

profiler.beginSection("render");
render();
profiler.endSection("render");

profiler.endFrame();

// Get analysis
const analysis = profiler.getAnalysis();
if (analysis.level === "critical") {
  reduceLOD();
}
```

## Benchmarking

Run benchmarks to measure performance:

```bash
cd packages/exocortex

# Default: 10k notes, 100 queries
npx ts-node benchmarks/indexing-benchmark.ts

# Custom configuration
npx ts-node benchmarks/indexing-benchmark.ts --notes 50000 --queries 500 --verbose
```

### Benchmark Output

```
╔════════════════════════════════════════════════════════════════╗
║  Exocortex Performance Benchmark Suite                         ║
║  Vault Size: 10,000 notes | Queries: 100                       ║
╚════════════════════════════════════════════════════════════════╝

Running: Full Indexing...
✅ Full Indexing (target: <1666ms)
   Avg: 450.123ms | Min: 420.000ms | Max: 520.000ms
   P50: 445.000ms | P95: 500.000ms | P99: 515.000ms

Running: Incremental Update...
✅ Incremental Update (single file) (target: <10ms)
   Avg: 2.500ms | Min: 1.200ms | Max: 5.000ms

Running: Simple Match...
✅ Simple Match (by subject) (target: <1ms)
   Avg: 0.050ms | Min: 0.020ms | Max: 0.150ms

══════════════════════════════════════════════════════════════════
SUMMARY
══════════════════════════════════════════════════════════════════

Total Benchmarks: 6
  ✅ Passed:  6
  ❌ Failed:  0
```

## Best Practices

### 1. Query Optimization

```sparql
# BAD: Scans all triples
SELECT ?s ?label WHERE {
  ?s ?p ?o .
  ?s exo:Asset_label ?label .
}

# GOOD: Uses index efficiently
SELECT ?s ?label WHERE {
  ?s exo:Asset_class ems:Task .
  ?s exo:Asset_label ?label .
}
```

### 2. Limit Results

```sparql
# Always add LIMIT for exploratory queries
SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100
```

### 3. Use UUID Lookups

```typescript
// BAD: Linear scan
const triples = await store.match(undefined, labelPred, undefined);
const result = triples.find(t => t.subject.value.includes(uuid));

// GOOD: O(1) lookup
const subjects = await store.findSubjectsByUUID(uuid);
```

### 4. Batch Updates

```typescript
// BAD: Many small updates
for (const triple of triples) {
  await store.add(triple);
}

// GOOD: Single batch
await store.addAll(triples);
```

### 5. Monitor Cache Efficiency

```typescript
// Periodically check cache stats
setInterval(() => {
  const stats = resultCache.getStats();
  if (stats.hitRate < 0.5) {
    console.warn("Low cache hit rate:", stats);
  }
}, 60000);
```

## Troubleshooting

### Slow Initial Load

1. Check file count with `vault.getMarkdownFiles().length`
2. Consider lazy loading non-essential files
3. Use `StreamingLoader` for progressive loading

### Low Cache Hit Rate

1. Check TTL settings (too short = many misses)
2. Verify file invalidation is working correctly
3. Consider increasing cache size

### Graph View Lag

1. Enable LOD system
2. Reduce initial zoom level
3. Limit visible nodes with viewport culling
4. Check `PerformanceProfiler` for bottlenecks

### Memory Issues

1. Monitor with `store.count()` for triple count
2. Use `CompactGraphStore` for memory-constrained environments
3. Implement pagination for large result sets
