import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { IRI, Literal, Triple } from "exocortex";
import { CombinedCacheManager } from "../../../src/cache/CombinedCacheManager.js";

const PRED = new IRI("https://example.org/p");

function makeTriple(s: string, o: string): Triple {
  return new Triple(new IRI(`https://example.org/${s}`), PRED, new Literal(o));
}

describe("CombinedCacheManager", () => {
  let tempRoot: string;
  let primary: string;
  let alsoA: string;
  let alsoB: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ccm-test-"));
    primary = path.join(tempRoot, "primary");
    alsoA = path.join(tempRoot, "also-a");
    alsoB = path.join(tempRoot, "also-b");
    await fs.ensureDir(primary);
    await fs.ensureDir(alsoA);
    await fs.ensureDir(alsoB);
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  describe("cache key stability", () => {
    it("produces the same cache file regardless of --also ordering", () => {
      const c1 = new CombinedCacheManager(primary, [alsoA, alsoB]);
      const c2 = new CombinedCacheManager(primary, [alsoB, alsoA]);
      expect(c1.getCachePath()).toBe(c2.getCachePath());
    });

    it("dedupes duplicate --also paths (primary + repeated also)", () => {
      const c1 = new CombinedCacheManager(primary, [alsoA, alsoA, alsoB]);
      const c2 = new CombinedCacheManager(primary, [alsoA, alsoB]);
      expect(c1.getCachePath()).toBe(c2.getCachePath());
      expect(c1.getAlsoVaultPaths()).toEqual(c2.getAlsoVaultPaths());
    });

    it("dedupes --also entry that points at the primary vault", () => {
      const c1 = new CombinedCacheManager(primary, [primary, alsoA]);
      const c2 = new CombinedCacheManager(primary, [alsoA]);
      expect(c1.getCachePath()).toBe(c2.getCachePath());
      expect(c1.getAlsoVaultPaths()).toEqual([alsoA]);
    });

    it("differs when the vault set differs (cache isolation)", () => {
      const c1 = new CombinedCacheManager(primary, [alsoA]);
      const c2 = new CombinedCacheManager(primary, [alsoB]);
      expect(c1.getCachePath()).not.toBe(c2.getCachePath());
    });

    it("places combined cache under primary vault's .exocortex/cache/", () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      expect(c.getCachePath()).toContain(
        path.join(primary, ".exocortex", "cache"),
      );
      expect(c.getCachePath()).toMatch(/combined-[a-f0-9]+\.json$/);
    });
  });

  describe("save + load round-trip", () => {
    it("persists triples and reads them back via loadFromCache", async () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      const original = [makeTriple("s1", "o1"), makeTriple("s2", "o2")];
      await c.saveTriples(original);

      expect(await c.isCacheValid()).toBe(true);
      const loaded = await c.loadFromCache();
      expect(loaded.length).toBe(original.length);
      expect((loaded[0].subject as IRI).value).toBe("https://example.org/s1");
      expect((loaded[0].object as Literal).value).toBe("o1");
    });

    it("loadIfValid returns null when no cache exists yet", async () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      const result = await c.loadIfValid();
      expect(result).toBeNull();
    });

    it("loadIfValid returns LoadOrBuildResult when cache is valid", async () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      await c.saveTriples([makeTriple("x", "y")]);
      const result = await c.loadIfValid();
      expect(result).not.toBeNull();
      expect(result?.cacheHit).toBe(true);
      expect(result?.triples.length).toBe(1);
    });
  });

  describe("invalidation", () => {
    it("isCacheValid returns false after a participating vault is mutated", async () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      await c.saveTriples([makeTriple("s", "o")]);
      expect(await c.isCacheValid()).toBe(true);

      // Mutate the alsoA vault directory mtime by writing a file
      await new Promise((r) => setTimeout(r, 10));
      await fs.writeFile(path.join(alsoA, "new-file.md"), "---\n---\n");

      expect(await c.isCacheValid()).toBe(false);
    });

    it("invalidate() removes the cache file", async () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      await c.saveTriples([makeTriple("s", "o")]);
      expect(await c.isCacheValid()).toBe(true);

      await c.invalidate();
      expect(await fs.pathExists(c.getCachePath())).toBe(false);
      expect(await c.isCacheValid()).toBe(false);
    });

    it("isCacheValid returns false when participating vault no longer exists", async () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      await c.saveTriples([makeTriple("s", "o")]);

      await fs.remove(alsoA);
      expect(await c.isCacheValid()).toBe(false);
    });

    it("isCacheValid returns false when the --also set changed since cache built", async () => {
      const cBuilder = new CombinedCacheManager(primary, [alsoA]);
      await cBuilder.saveTriples([makeTriple("s", "o")]);

      // A reader instance configured for a different --also set must not
      // accept the previous cache file even though the cache key differs;
      // we exercise the path-set membership check explicitly by checking
      // the wrong-set instance reports invalid.
      const cReader = new CombinedCacheManager(primary, [alsoA, alsoB]);
      expect(await cReader.isCacheValid()).toBe(false);
    });
  });

  describe("getCacheStats", () => {
    it("returns null when no cache file exists", async () => {
      const c = new CombinedCacheManager(primary, [alsoA]);
      expect(await c.getCacheStats()).toBeNull();
    });

    it("returns triple count + valid flag + vault list after save", async () => {
      const c = new CombinedCacheManager(primary, [alsoA, alsoB]);
      const triples = [makeTriple("a", "1"), makeTriple("b", "2"), makeTriple("c", "3")];
      await c.saveTriples(triples);

      const stats = await c.getCacheStats();
      expect(stats).not.toBeNull();
      expect(stats?.tripleCount).toBe(3);
      expect(stats?.isValid).toBe(true);
      expect(stats?.vaultPaths.sort()).toEqual(
        [primary, alsoA, alsoB].sort(),
      );
      expect(stats?.sizeBytes).toBeGreaterThan(0);
    });
  });

  describe("computeCacheKey", () => {
    it("produces a 16-char hex digest", () => {
      const key = CombinedCacheManager.computeCacheKey(["/a", "/b"]);
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });

    it("is deterministic for identical inputs", () => {
      const a = CombinedCacheManager.computeCacheKey(["/x", "/y"]);
      const b = CombinedCacheManager.computeCacheKey(["/x", "/y"]);
      expect(a).toBe(b);
    });
  });
});
