/** ExoSync A3 — durable per-device watermark store (D8/D22/R10). */

import {
  FileWatermarkStore,
  WATERMARK_STORE_FILENAME,
  isSyncablePath,
  type WatermarkFileIO,
  type WatermarkRecord,
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

const record = (sha: string): WatermarkRecord => ({
  lastSyncedSha: sha,
  rootTreeSha: `tree-${sha}`,
  files: [{ path: "a.md", blobSha: `blob-${sha}`, uid: "u1" }],
});

describe("FileWatermarkStore", () => {
  it("round-trips records per repoKey through one JSON file", async () => {
    const io = new FakeIO();
    const store = new FileWatermarkStore(io);

    await store.set("o/r1#main", record("s1"));
    await store.set("o/r2#main", record("s2"));

    expect(await store.get("o/r1#main")).toEqual(record("s1"));
    expect(await store.get("o/r2#main")).toEqual(record("s2"));
    expect(await store.get("o/unknown#main")).toBeNull();
    expect(JSON.parse(io.content ?? "")).toMatchObject({ version: 1 });
  });

  it("missing file → null for every repo (first-sync path, D22)", async () => {
    const store = new FileWatermarkStore(new FakeIO());
    expect(await store.get("o/r#main")).toBeNull();
  });

  it("corrupt JSON → null, never throws (R10 — full-conflict, not overwrite)", async () => {
    const io = new FakeIO();
    io.content = "{ not json !!!";
    const store = new FileWatermarkStore(io);
    expect(await store.get("o/r#main")).toBeNull();

    io.content = JSON.stringify({ version: 1, repos: { "o/r#main": "junk" } });
    expect(await store.get("o/r#main")).toBeNull();
  });

  it("serializes concurrent sets — both records survive (lossless RMW)", async () => {
    const io = new FakeIO();
    const store = new FileWatermarkStore(io);

    await Promise.all([
      store.set("o/r1#main", record("s1")),
      store.set("o/r2#main", record("s2")),
    ]);

    expect(await store.get("o/r1#main")).toEqual(record("s1"));
    expect(await store.get("o/r2#main")).toEqual(record("s2"));
  });

  it("a failed write rejects its caller but does not poison later sets", async () => {
    const io = new FakeIO();
    const store = new FileWatermarkStore(io);
    io.failNextWrite = true;

    await expect(store.set("o/r1#main", record("s1"))).rejects.toThrow(
      "disk full",
    );
    await store.set("o/r2#main", record("s2"));
    expect(await store.get("o/r2#main")).toEqual(record("s2"));
  });

  it("the recommended filename is excluded from sync (gitignore allowlist)", () => {
    expect(WATERMARK_STORE_FILENAME).toContain(".local.");
    expect(isSyncablePath(WATERMARK_STORE_FILENAME)).toBe(false);
    // even a hypothetical .md variant stays excluded via the .local. infix
    expect(isSyncablePath("notes/exosync-journal.local.md")).toBe(false);
    expect(isSyncablePath("notes/asset.conflict.md")).toBe(false);
    expect(isSyncablePath("notes/asset.md")).toBe(true);
  });
});
