# Memory Optimization

The Memory Optimization system provides object pooling and garbage collection optimization for high-performance graph rendering.

## Overview

Graph visualization creates many short-lived objects (vectors, events, render batches) that can cause garbage collection pauses. The memory system addresses this through:

- **ObjectPool**: Generic object pooling for any reusable object type
- **PoolManager**: Centralized management of multiple pools with memory pressure handling

## ObjectPool

The `ObjectPool` class provides high-performance object reuse:

```typescript
import { ObjectPool, Poolable } from "./presentation/renderers/graph/memory";

// Define a poolable object
class PoolableVector implements Poolable {
  x = 0;
  y = 0;
  private _inUse = false;

  reset(): void {
    this.x = 0;
    this.y = 0;
  }

  isInUse(): boolean {
    return this._inUse;
  }

  setInUse(inUse: boolean): void {
    this._inUse = inUse;
  }
}

// Create pool
const vectorPool = new ObjectPool(
  () => new PoolableVector(),
  {
    initialSize: 100,
    maxSize: 10000,
    growthFactor: 2.0,
  },
  "vectors"
);

// Acquire and use
const vec = vectorPool.acquire();
vec.x = 10;
vec.y = 20;

// Release back to pool
vectorPool.release(vec);
```

### Pool Configuration

```typescript
interface PoolConfig {
  /** Initial number of objects to create (default: 16) */
  initialSize: number;

  /** Maximum pool size (default: 1024) */
  maxSize: number;

  /** Factor to grow pool by when exhausted (default: 2.0) */
  growthFactor: number;

  /** Usage ratio threshold for shrinking pool (default: 0.25) */
  shrinkThreshold: number;

  /** Number of objects to create during warmup */
  warmupCount?: number;

  /** Whether to enable automatic shrinking (default: true) */
  autoShrink?: boolean;

  /** Minimum time between shrink operations in ms (default: 5000) */
  shrinkCooldownMs?: number;
}
```

### Pool Methods

```typescript
class ObjectPool<T extends Poolable> {
  /** Acquire an object from the pool */
  acquire(): T;

  /** Release an object back to the pool */
  release(item: T): boolean;

  /** Release multiple objects */
  releaseAll(items: T[]): number;

  /** Pre-allocate objects up to a specific size */
  preallocate(size: number): number;

  /** Grow the pool by a factor */
  grow(factor?: number): number;

  /** Shrink the pool by removing excess unused objects */
  shrink(): number;

  /** Clear all objects and reset to initial state */
  clear(): void;

  /** Get current pool metrics */
  getMetrics(): PoolMetrics;

  /** Destroy the pool and release all resources */
  destroy(): void;
}
```

### Pool Metrics

Monitor pool performance:

```typescript
interface PoolMetrics {
  /** Current pool size (total objects) */
  poolSize: number;

  /** Number of objects currently in use */
  inUseCount: number;

  /** Number of objects available */
  availableCount: number;

  /** Total acquisitions since creation */
  totalAcquisitions: number;

  /** Pool hits (object reused from pool) */
  poolHits: number;

  /** Pool misses (new object created) */
  poolMisses: number;

  /** Hit rate percentage */
  hitRate: number;

  /** Peak usage (max in use at once) */
  peakUsage: number;
}

// Example: Monitor hit rate
const metrics = vectorPool.getMetrics();
console.log(`Hit rate: ${metrics.hitRate.toFixed(1)}%`);
console.log(`Peak usage: ${metrics.peakUsage}`);
```

### Pool Events

```typescript
// Listen for pool events
const unsubscribe = vectorPool.addEventListener((event) => {
  switch (event.type) {
    case "acquire":
      console.log("Object acquired");
      break;
    case "release":
      console.log("Object released");
      break;
    case "grow":
      console.log("Pool grew:", event.data?.newSize);
      break;
    case "shrink":
      console.log("Pool shrunk:", event.data?.removed);
      break;
    case "exhausted":
      console.warn("Pool exhausted!");
      break;
  }
});

// Unsubscribe when done
unsubscribe();
```

## PoolManager

The `PoolManager` provides centralized management of multiple object pools:

```typescript
import { PoolManager, getGlobalPoolManager } from "./presentation/renderers/graph/memory";

// Use global singleton
const poolManager = getGlobalPoolManager();

// Or create custom manager
const customManager = new PoolManager({
  enablePressureManagement: true,
  memoryLimitBytes: 128 * 1024 * 1024, // 128MB
});
customManager.initializeBuiltInPools();
```

### Built-in Pools

The PoolManager includes pre-configured pools for common graph objects:

```typescript
// Built-in pool names
const POOL_NAMES = {
  RENDER_BATCH: "renderBatch", // Render command batches
  EVENT: "event", // UI events
  COMPUTATION_BUFFER: "computationBuffer", // Calculation buffers
  VECTOR2D: "vector2d", // 2D vectors
  RECT: "rect", // Rectangles
};

// Acquire from built-in pools
const batch = poolManager.acquireRenderBatch();
const event = poolManager.acquireEvent();
const vec = poolManager.acquireVector2D();
const rect = poolManager.acquireRect();

// Release back
poolManager.releaseRenderBatch(batch);
poolManager.releaseEvent(event);
poolManager.releaseVector2D(vec);
poolManager.releaseRect(rect);
```

### Custom Pool Registration

```typescript
// Register a custom pool
const myObjectPool = new ObjectPool(() => new MyObject(), {
  initialSize: 50,
  maxSize: 500,
});

poolManager.registerPool("myObjects", myObjectPool, 1, false);

// Use via manager
const pool = poolManager.getPool<MyObject>("myObjects");
const obj = pool?.acquire();
```

### Memory Pressure Management

The PoolManager monitors memory usage and responds to pressure:

```typescript
// Configure pressure thresholds
const manager = new PoolManager({
  enablePressureManagement: true,
  pressureCheckInterval: 1000, // Check every second
  moderatePressureThreshold: 0.7, // 70% of limit
  highPressureThreshold: 0.85, // 85% of limit
  criticalPressureThreshold: 0.95, // 95% of limit
  memoryLimitBytes: 64 * 1024 * 1024, // 64MB
});

// Listen for pressure changes
manager.addEventListener((event) => {
  if (event.type === "pressureChange") {
    console.log(
      `Memory pressure: ${event.previousPressure} → ${event.newPressure}`
    );
  }
});
```

### Memory Pressure Levels

| Level      | Threshold | Action                           |
| ---------- | --------- | -------------------------------- |
| `NORMAL`   | < 70%     | No action                        |
| `MODERATE` | 70-85%    | Shrink non-essential pools       |
| `HIGH`     | 85-95%    | Aggressively shrink all pools    |
| `CRITICAL` | > 95%     | Emergency cleanup to initial sizes |

### Aggregated Statistics

```typescript
const stats = poolManager.getStats();

console.log("Pool count:", stats.poolCount);
console.log("Total objects:", stats.totalObjects);
console.log("Total in use:", stats.totalInUse);
console.log("Overall hit rate:", stats.overallHitRate.toFixed(1) + "%");
console.log("Estimated memory:", (stats.estimatedMemoryBytes / 1024 / 1024).toFixed(1) + "MB");
console.log("Pressure level:", stats.pressureLevel);

// Per-pool metrics
for (const [name, metrics] of stats.poolMetrics) {
  console.log(`${name}: ${metrics.inUseCount}/${metrics.poolSize} (${metrics.hitRate.toFixed(0)}% hit)`);
}
```

## Built-in Poolable Types

The system includes ready-to-use poolable types:

### PoolableVector2D

```typescript
const vec = poolManager.acquireVector2D();
vec.x = 100;
vec.y = 200;
const length = vec.length(); // Built-in methods
vec.normalize();
poolManager.releaseVector2D(vec);
```

### PoolableRect

```typescript
const rect = poolManager.acquireRect();
rect.x = 0;
rect.y = 0;
rect.width = 100;
rect.height = 50;
const contains = rect.contains(50, 25);
poolManager.releaseRect(rect);
```

### RenderBatch

```typescript
const batch = poolManager.acquireRenderBatch();
batch.addNode(nodeData);
batch.addEdge(edgeData);
renderer.submitBatch(batch);
poolManager.releaseRenderBatch(batch);
```

## Best Practices

### 1. Acquire Late, Release Early

```typescript
// Good: Minimal hold time
function processNodes(nodes: GraphNode[]) {
  for (const node of nodes) {
    const vec = poolManager.acquireVector2D();
    vec.x = node.x;
    vec.y = node.y;
    // Process...
    poolManager.releaseVector2D(vec);
  }
}

// Bad: Holding objects longer than needed
function processNodesBad(nodes: GraphNode[]) {
  const vectors = nodes.map(() => poolManager.acquireVector2D());
  // Now all vectors are held until end
  vectors.forEach((v) => poolManager.releaseVector2D(v));
}
```

### 2. Handle Pool Exhaustion

```typescript
import { PoolExhaustedException } from "./presentation/renderers/graph/memory";

try {
  const obj = pool.acquire();
} catch (error) {
  if (error instanceof PoolExhaustedException) {
    console.warn("Pool exhausted, using fallback");
    return new MyObject(); // Fallback to regular allocation
  }
  throw error;
}
```

### 3. Pre-warm Pools

```typescript
// Pre-allocate before intensive operations
function startAnimation() {
  poolManager.getPool("vectors")?.preallocate(1000);
  poolManager.getPool("events")?.preallocate(100);

  // Now animation won't cause allocations
  animate();
}
```

### 4. Monitor in Development

```typescript
if (process.env.NODE_ENV === "development") {
  setInterval(() => {
    const stats = poolManager.getStats();
    if (stats.overallHitRate < 80) {
      console.warn("Low pool hit rate:", stats.overallHitRate.toFixed(1) + "%");
    }
    if (stats.pressureLevel !== "normal") {
      console.warn("Memory pressure:", stats.pressureLevel);
    }
  }, 5000);
}
```

## Integration Example

Complete integration with graph rendering:

```typescript
import { getGlobalPoolManager } from "./presentation/renderers/graph/memory";

const poolManager = getGlobalPoolManager();

function render(nodes: GraphNode[], edges: GraphEdge[]) {
  // Acquire render batch
  const batch = poolManager.acquireRenderBatch();

  // Process nodes
  for (const node of nodes) {
    const vec = poolManager.acquireVector2D();
    vec.x = node.x;
    vec.y = node.y;

    batch.addNode({
      position: { x: vec.x, y: vec.y },
      style: getNodeStyle(node),
    });

    poolManager.releaseVector2D(vec);
  }

  // Submit batch
  renderer.draw(batch);

  // Release batch
  poolManager.releaseRenderBatch(batch);
}

// Cleanup on unmount
function cleanup() {
  poolManager.reset();
}
```

## See Also

- [Performance](./performance.md) - General performance optimization
- [Viewport Windowing](./viewport-windowing.md) - Virtual scrolling
- [API Reference](../api/index.md) - Full API documentation
