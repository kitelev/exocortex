import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";

const { QueryResultCache } = await import("../../../src/cache/QueryResultCache.js");
const { computeVaultSignature } = await import("../../../src/cache/vaultSignature.js");

/**
 * Issue #3983 — the query-result cache is now vault-mtime-aware: a coarse content
 * signature captured at cache time is compared on read, so a `set-property` /
 * `apply` mutation invalidates the stale cached result without `--no-cache`.
 *
 * Revert-verify: remove the signature comparison in `QueryResultCache.get` and
 * the "vault changed" case returns the stale result instead of null → RED.
 */
describe("QueryResultCache — vault-signature invalidation (#3983)", () => {
  let tempDir: string;
  let cache: InstanceType<typeof QueryResultCache>;
  const QUERY = "SELECT * WHERE { ?s ?p ?o }";
  const RESULT = { type: "select", count: 1, bindings: [{ s: "x" }] };
  const TTL = 300;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "qcache-sig-"));
    cache = new QueryResultCache({ cacheDir: tempDir });
  });
  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("returns the cached result when the vault signature is unchanged", async () => {
    await cache.set(QUERY, RESULT, TTL, "sigA");
    expect(await cache.get(QUERY, TTL, "sigA")).toEqual(RESULT);
  });

  it("invalidates (returns null) when the vault signature has changed", async () => {
    await cache.set(QUERY, RESULT, TTL, "sigA");
    // vault changed since caching → different signature → stale
    expect(await cache.get(QUERY, TTL, "sigB")).toBeNull();
    // and the stale entry is removed (subsequent get with the SAME old sig misses)
    expect(await cache.get(QUERY, TTL, "sigA")).toBeNull();
  });

  it("falls back to TTL-only when the caller supplies no signature (backward compat)", async () => {
    await cache.set(QUERY, RESULT, TTL, "sigA");
    // no signature passed → do not signature-check → still a hit
    expect(await cache.get(QUERY, TTL)).toEqual(RESULT);
  });

  it("does not falsely invalidate a legacy entry stored without a signature", async () => {
    // entry cached before this feature (no vaultSignature persisted)
    await cache.set(QUERY, RESULT, TTL);
    // a signature is now supplied on read, but the stored entry has none → TTL-only
    expect(await cache.get(QUERY, TTL, "anySig")).toEqual(RESULT);
  });

  it("still honours TTL expiry regardless of signature", async () => {
    await cache.set(QUERY, RESULT, 0, "sigA"); // ttl 0 → immediately expired
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.get(QUERY, 0, "sigA")).toBeNull();
  });
});

describe("computeVaultSignature (#3983)", () => {
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-sig-"));
    await fs.ensureDir(path.join(vaultDir, "assetspaces", "kitelev", "ns"));
    await fs.writeFile(path.join(vaultDir, "assetspaces", "kitelev", "ns", "a.md"), "a");
    await fs.writeFile(path.join(vaultDir, "assetspaces", "kitelev", "ns", "b.md"), "b");
  });
  afterEach(async () => {
    await fs.remove(vaultDir);
  });

  it("is stable for an unchanged vault", async () => {
    const s1 = await computeVaultSignature(vaultDir);
    const s2 = await computeVaultSignature(vaultDir);
    expect(s1).not.toBeNull();
    expect(s1).toMatch(/^[a-f0-9]{64}$/);
    expect(s2).toBe(s1);
  });

  it("changes when a nested asset is edited in place (the set-property case)", async () => {
    const before = await computeVaultSignature(vaultDir);
    // advance mtime of a deeply-nested file (root dir mtime would NOT change)
    const nested = path.join(vaultDir, "assetspaces", "kitelev", "ns", "a.md");
    await new Promise((r) => setTimeout(r, 10));
    await fs.utimes(nested, new Date(), new Date());
    const after = await computeVaultSignature(vaultDir);
    expect(after).not.toBe(before);
  });

  it("changes when an asset is added", async () => {
    const before = await computeVaultSignature(vaultDir);
    await fs.writeFile(path.join(vaultDir, "assetspaces", "kitelev", "ns", "c.md"), "c");
    const after = await computeVaultSignature(vaultDir);
    expect(after).not.toBe(before);
  });

  it("returns null for a non-existent vault (caller falls back to TTL-only)", async () => {
    expect(await computeVaultSignature(path.join(vaultDir, "does-not-exist"))).toBeNull();
  });
});
