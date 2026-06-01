import {
  SwitchCacheLayer,
  type FileBlob,
} from "../../src/infrastructure/adapters/SwitchCacheLayer";

const KB = 1024;

function blob(size: number, fill: number = 0): FileBlob {
  return new Uint8Array(size).fill(fill);
}

function makeFiles(spec: Array<[string, number]>): Map<string, FileBlob> {
  const out = new Map<string, FileBlob>();
  for (const [path, size] of spec) out.set(path, blob(size));
  return out;
}

interface Clock {
  current: number;
  advance: (ms: number) => void;
}

function makeClock(start = 1_000_000): Clock {
  let current = start;
  return {
    get current() {
      return current;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

// ─── cacheAssetSpace / restoreCachedAssetSpace ───────────────────────────

describe("SwitchCacheLayer.cacheAssetSpace / restoreCachedAssetSpace", () => {
  it("stores files и retrieves them as a copy", async () => {
    const cache = new SwitchCacheLayer();
    const files = makeFiles([["assetspaces/exo/a.md", 100], ["assetspaces/exo/b.md", 200]]);
    await cache.cacheAssetSpace("uid-1", files);

    const restored = await cache.restoreCachedAssetSpace("uid-1");
    expect(restored).not.toBeNull();
    expect(restored!.size).toBe(2);
    expect(restored!.get("assetspaces/exo/a.md")!.byteLength).toBe(100);
  });

  it("returned files map is decoupled (mutation does not affect cache)", async () => {
    const cache = new SwitchCacheLayer();
    await cache.cacheAssetSpace("uid-1", makeFiles([["x", 10]]));
    const first = await cache.restoreCachedAssetSpace("uid-1");
    first!.delete("x");

    const second = await cache.restoreCachedAssetSpace("uid-1");
    expect(second!.has("x")).toBe(true);
  });

  it("returns null for unknown asUid", async () => {
    const cache = new SwitchCacheLayer();
    expect(await cache.restoreCachedAssetSpace("nope")).toBeNull();
  });

  it("overwrites existing entry for same asUid", async () => {
    const cache = new SwitchCacheLayer();
    await cache.cacheAssetSpace("uid-1", makeFiles([["a", 100]]));
    await cache.cacheAssetSpace("uid-1", makeFiles([["b", 200], ["c", 300]]));
    const restored = await cache.restoreCachedAssetSpace("uid-1");
    expect(restored!.has("a")).toBe(false);
    expect(restored!.size).toBe(2);
  });

  it("refuses entry larger than maxBytes без adding to cache", async () => {
    const cache = new SwitchCacheLayer({ maxBytes: 1 * KB });
    await cache.cacheAssetSpace("huge", makeFiles([["x", 2 * KB]]));
    expect(await cache.restoreCachedAssetSpace("huge")).toBeNull();
    expect(cache.getCacheStats().count).toBe(0);
  });
});

// ─── LRU eviction ─────────────────────────────────────────────────────────

describe("SwitchCacheLayer LRU eviction", () => {
  it("evicts oldest entry when new entry exceeds cap", async () => {
    const clock = makeClock();
    const cache = new SwitchCacheLayer({ maxBytes: 500, now: () => clock.current });

    await cache.cacheAssetSpace("old", makeFiles([["x", 300]]));
    clock.advance(1000);
    await cache.cacheAssetSpace("mid", makeFiles([["y", 100]]));
    clock.advance(1000);
    // total = 400, adding 300 → would be 700 → evict 'old' (oldest touched)
    await cache.cacheAssetSpace("new", makeFiles([["z", 300]]));

    expect(await cache.restoreCachedAssetSpace("old")).toBeNull();
    expect(await cache.restoreCachedAssetSpace("mid")).not.toBeNull();
    expect(await cache.restoreCachedAssetSpace("new")).not.toBeNull();
  });

  it("restore touches lastTouched (resets LRU position)", async () => {
    const clock = makeClock();
    const cache = new SwitchCacheLayer({ maxBytes: 500, now: () => clock.current });

    await cache.cacheAssetSpace("a", makeFiles([["x", 200]]));
    clock.advance(1000);
    await cache.cacheAssetSpace("b", makeFiles([["y", 200]]));
    clock.advance(1000);

    // Touch 'a' so 'b' becomes oldest
    await cache.restoreCachedAssetSpace("a");
    clock.advance(1000);

    // Adding 'c' (200B) brings total to 600 → must evict the oldest-touched: 'b'
    await cache.cacheAssetSpace("c", makeFiles([["z", 200]]));

    expect(await cache.restoreCachedAssetSpace("a")).not.toBeNull();
    expect(await cache.restoreCachedAssetSpace("b")).toBeNull();
    expect(await cache.restoreCachedAssetSpace("c")).not.toBeNull();
  });

  it("explicit evictOldest reduces cache to target size", async () => {
    const clock = makeClock();
    const cache = new SwitchCacheLayer({ maxBytes: 1 * KB, now: () => clock.current });

    await cache.cacheAssetSpace("a", makeFiles([["1", 300]]));
    clock.advance(100);
    await cache.cacheAssetSpace("b", makeFiles([["2", 300]]));
    clock.advance(100);
    await cache.cacheAssetSpace("c", makeFiles([["3", 300]]));

    // Force evict to 400 bytes — should drop 'a' and 'b'
    await cache.evictOldest(400);
    expect(cache.getCacheStats().count).toBe(1);
    expect(await cache.restoreCachedAssetSpace("c")).not.toBeNull();
  });

  it("evictOldest is no-op when already under target", async () => {
    const cache = new SwitchCacheLayer({ maxBytes: 1 * KB });
    await cache.cacheAssetSpace("a", makeFiles([["x", 100]]));
    await cache.evictOldest(500);
    expect(cache.getCacheStats().count).toBe(1);
  });
});

// ─── getCacheStats ────────────────────────────────────────────────────────

describe("SwitchCacheLayer.getCacheStats", () => {
  it("returns zero stats on empty cache", () => {
    const cache = new SwitchCacheLayer();
    expect(cache.getCacheStats()).toEqual({
      count: 0,
      totalSize: 0,
      oldestEntry: null,
    });
  });

  it("aggregates count and totalSize across entries", async () => {
    const clock = makeClock(0);
    const cache = new SwitchCacheLayer({ now: () => clock.current });
    await cache.cacheAssetSpace("a", makeFiles([["x", 100]]));
    clock.advance(5000);
    await cache.cacheAssetSpace("b", makeFiles([["y", 200], ["z", 50]]));

    const stats = cache.getCacheStats();
    expect(stats.count).toBe(2);
    expect(stats.totalSize).toBe(350);
    // oldestEntry from 'a' (cachedAt=0)
    expect(stats.oldestEntry).toBe(new Date(0).toISOString());
  });
});
