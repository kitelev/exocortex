/**
 * ExoSync Phase 1 (perf) — durable per-device local mtime-manifest store.
 *
 * Sibling contract to {@link FileWatermarkStore}: per-repoKey records in one
 * JSON file, tolerant on read (corrupt/missing ⇒ `null` ⇒ the engine re-hashes
 * every file — NEVER a wrong skip), atomic on write, lossless RMW across repos.
 */

import {
  FileLocalManifestStore,
  LOCAL_MANIFEST_STORE_FILENAME,
  isSyncablePath,
  type LocalManifestRecord,
  type WatermarkFileIO,
} from "../../../../src";

class FakeIO implements WatermarkFileIO {
  content: string | null = null;
  writes = 0;
  failNextWrite = false;
  async read(): Promise<string | null> {
    return this.content;
  }
  async writeAtomic(content: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("disk full");
    }
    this.writes++;
    this.content = content;
  }
}

const record = (sha: string): LocalManifestRecord => ({
  version: 1,
  lastFullRehashMs: 1700,
  files: {
    "a.md": { mtimeMs: 1000, size: 42, blobSha: `blob-${sha}`, uid: "u1" },
    "b.md": { mtimeMs: 1001, size: 7, blobSha: `blob2-${sha}` },
  },
});

describe("FileLocalManifestStore", () => {
  it("round-trips records per repoKey through one JSON file", async () => {
    const io = new FakeIO();
    const store = new FileLocalManifestStore(io);

    await store.set("o/r1#main", record("s1"));
    await store.set("o/r2#main", record("s2"));

    expect(await store.get("o/r1#main")).toEqual(record("s1"));
    expect(await store.get("o/r2#main")).toEqual(record("s2"));
    expect(await store.get("o/unknown#main")).toBeNull();
    expect(JSON.parse(io.content ?? "")).toMatchObject({ version: 1 });
  });

  it("missing file → null for every repo (full re-hash path)", async () => {
    const store = new FileLocalManifestStore(new FakeIO());
    expect(await store.get("o/r#main")).toBeNull();
  });

  it("corrupt JSON → null, never throws (R10 — re-hash, not wrong skip)", async () => {
    const io = new FakeIO();
    io.content = "{ not json !!!";
    const store = new FileLocalManifestStore(io);
    expect(await store.get("o/r#main")).toBeNull();

    // Wrong shape (missing lastFullRehashMs / files) → rejected → null.
    io.content = JSON.stringify({ version: 1, repos: { "o/r#main": "junk" } });
    expect(await store.get("o/r#main")).toBeNull();
    io.content = JSON.stringify({
      version: 1,
      repos: { "o/r#main": { version: 1, files: {} } }, // no lastFullRehashMs
    });
    expect(await store.get("o/r#main")).toBeNull();
  });

  it("a failed write propagates to the caller but keeps the chain alive", async () => {
    const io = new FakeIO();
    const store = new FileLocalManifestStore(io);
    io.failNextWrite = true;
    await expect(store.set("o/r#main", record("s1"))).rejects.toThrow(
      "disk full",
    );
    // Next write must still run (chain not poisoned).
    await store.set("o/r#main", record("s2"));
    expect(await store.get("o/r#main")).toEqual(record("s2"));
  });

  it("the store filename carries the Sync-excluded `.local.` infix", () => {
    expect(LOCAL_MANIFEST_STORE_FILENAME).toContain(".local.");
    // Symmetric guard: the engine's allowlist must REFUSE to sync it.
    expect(isSyncablePath(LOCAL_MANIFEST_STORE_FILENAME)).toBe(false);
  });
});
