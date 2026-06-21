/** ExoSync #3590 — durable per-device mount-base store (first-sync merge base). */

import {
  FileMountBaseStore,
  MOUNT_BASE_STORE_FILENAME,
  isSyncablePath,
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

describe("FileMountBaseStore", () => {
  it("round-trips a mounted SHA per repoKey through one JSON file", async () => {
    const io = new FakeIO();
    const store = new FileMountBaseStore(io);

    await store.set("o/r1#main", "sha-aaa");
    await store.set("o/r2#main", "sha-bbb");

    expect(await store.get("o/r1#main")).toBe("sha-aaa");
    expect(await store.get("o/r2#main")).toBe("sha-bbb");
    expect(await store.get("o/unknown#main")).toBeNull();
    expect(JSON.parse(io.content ?? "")).toMatchObject({ version: 1 });
  });

  it("missing file → null for every repo (conservative first-sync, never a guess)", async () => {
    const store = new FileMountBaseStore(new FakeIO());
    expect(await store.get("o/r#main")).toBeNull();
  });

  it("corrupt JSON → null, never throws (R10 — full-conflict fallback, not overwrite)", async () => {
    const io = new FakeIO();
    io.content = "{ not json !!!";
    const store = new FileMountBaseStore(io);
    expect(await store.get("o/r#main")).toBeNull();
  });

  it("a later set overwrites the recorded SHA for the same repoKey", async () => {
    const io = new FakeIO();
    const store = new FileMountBaseStore(io);
    await store.set("o/r#main", "old");
    await store.set("o/r#main", "new");
    expect(await store.get("o/r#main")).toBe("new");
  });

  it("ignores non-string / empty values in a hand-edited store (tolerant read)", async () => {
    const io = new FakeIO();
    io.content = JSON.stringify({
      version: 1,
      repos: { "o/good#main": "sha-ok", "o/bad#main": 42, "o/empty#main": "" },
    });
    const store = new FileMountBaseStore(io);
    expect(await store.get("o/good#main")).toBe("sha-ok");
    expect(await store.get("o/bad#main")).toBeNull();
    expect(await store.get("o/empty#main")).toBeNull();
  });

  it("a failed write propagates to THIS caller but the chain survives for the NEXT set", async () => {
    const io = new FakeIO();
    const store = new FileMountBaseStore(io);
    io.failNextWrite = true;
    await expect(store.set("o/r#main", "s1")).rejects.toThrow(/disk full/);
    // The store recovers — a subsequent set succeeds and persists.
    await store.set("o/r#main", "s2");
    expect(await store.get("o/r#main")).toBe("s2");
  });

  it("the store filename is Sync-excluded (`.local.` infix, refused by isSyncablePath)", () => {
    expect(MOUNT_BASE_STORE_FILENAME).toContain(".local.");
    expect(isSyncablePath(MOUNT_BASE_STORE_FILENAME)).toBe(false);
  });
});
