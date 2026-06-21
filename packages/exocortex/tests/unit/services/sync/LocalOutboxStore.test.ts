/**
 * ExoSync deferred-push outbox store (offline conflict resolution).
 * Store mechanics over an in-memory single-file IO mirroring WatermarkFileIO.
 */

import { describe, expect, it } from "@jest/globals";
import {
  LocalOutboxStore,
  OUTBOX_STORE_FILENAME,
  type OutboxEntry,
  type WatermarkFileIO,
} from "../../../../src";

function memIO(): WatermarkFileIO & { content: string | null } {
  const state: { content: string | null } = { content: null };
  return {
    get content(): string | null {
      return state.content;
    },
    set content(v: string | null) {
      state.content = v;
    },
    async read(): Promise<string | null> {
      return state.content;
    },
    async writeAtomic(c: string): Promise<void> {
      state.content = c;
    },
  };
}

const ENTRY: Omit<OutboxEntry, "version"> = {
  repoKey: "o/r#main",
  path: "a.md",
  chosenContent: "chosen body",
  resolvedTo: "local",
  baseRemoteSha: "remote-sha-1",
  resolvedAt: "",
};

describe("LocalOutboxStore", () => {
  it("enqueues a resolution and lists/has it back; stamps resolvedAt when empty", async () => {
    const store = new LocalOutboxStore({
      io: memIO(),
      now: () => "2026-06-21T12:00:00Z",
    });
    await store.enqueue(ENTRY);

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      repoKey: "o/r#main",
      path: "a.md",
      chosenContent: "chosen body",
      resolvedTo: "local",
      baseRemoteSha: "remote-sha-1",
      resolvedAt: "2026-06-21T12:00:00Z",
    });
    expect(await store.has("o/r#main", "a.md")).toBe(true);
    expect(await store.has("o/r#main", "missing.md")).toBe(false);
  });

  it("preserves a caller-supplied resolvedAt", async () => {
    const store = new LocalOutboxStore({ io: memIO(), now: () => "later" });
    await store.enqueue({ ...ENTRY, resolvedAt: "2020-01-01T00:00:00Z" });
    expect((await store.list())[0].resolvedAt).toBe("2020-01-01T00:00:00Z");
  });

  it("listForRepo scopes by repoKey", async () => {
    const store = new LocalOutboxStore({ io: memIO() });
    await store.enqueue({ ...ENTRY, repoKey: "o/r1#main", path: "a.md" });
    await store.enqueue({ ...ENTRY, repoKey: "o/r2#main", path: "b.md" });
    expect((await store.listForRepo("o/r1#main")).map((e) => e.path)).toEqual([
      "a.md",
    ]);
  });

  it("remove drops the entry (no-op when absent)", async () => {
    const store = new LocalOutboxStore({ io: memIO() });
    await store.enqueue(ENTRY);
    await store.remove("o/r#main", "a.md");
    expect(await store.list()).toHaveLength(0);
    await expect(store.remove("o/r#main", "a.md")).resolves.toBeUndefined();
  });

  it("tolerant read: corrupt/absent file → empty, never throws", async () => {
    const io = memIO();
    io.content = "}{ not json";
    const store = new LocalOutboxStore({ io });
    expect(await store.list()).toEqual([]);
    expect(await store.has("o/r#main", "a.md")).toBe(false);
  });

  it("serializes concurrent enqueues without clobbering", async () => {
    const store = new LocalOutboxStore({ io: memIO() });
    await Promise.all([
      store.enqueue({ ...ENTRY, path: "a.md" }),
      store.enqueue({ ...ENTRY, path: "b.md" }),
      store.enqueue({ ...ENTRY, path: "c.md" }),
    ]);
    expect((await store.list()).map((e) => e.path).sort()).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });

  it("uses the Sync-excluded `.local.` filename convention", () => {
    expect(OUTBOX_STORE_FILENAME).toContain(".local.");
    expect(OUTBOX_STORE_FILENAME).toBe("exosync-outbox.local.json");
  });
});
