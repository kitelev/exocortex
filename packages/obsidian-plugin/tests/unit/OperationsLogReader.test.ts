import type { App } from "obsidian";

import { OperationsLogReader } from "../../src/infrastructure/adapters/OperationsLogReader";

function makeFakeApp(): { app: App; files: Map<string, string> } {
  const files = new Map<string, string>();
  const app = {
    vault: {
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => {
          const v = files.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
      },
    },
  } as unknown as App;
  return { app, files };
}

const DEFAULT_PATH = ".exocortex/switch-journal.jsonl";

function makeEntry(opts: {
  phase: "starting" | "completed" | "failed";
  targetUid: string;
  ts: string;
  elapsedMs?: number;
  error?: string;
}): string {
  return JSON.stringify(opts);
}

describe("OperationsLogReader.readLast", () => {
  it("returns empty array when journal does not exist", async () => {
    const { app } = makeFakeApp();
    const reader = new OperationsLogReader({ app });
    expect(await reader.readLast()).toEqual([]);
  });

  it("returns empty array on empty journal file", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, "");
    const reader = new OperationsLogReader({ app });
    expect(await reader.readLast()).toEqual([]);
  });

  it("returns last 10 entries newest-first", async () => {
    const { app, files } = makeFakeApp();
    const lines: string[] = [];
    for (let i = 0; i < 15; i++) {
      lines.push(makeEntry({
        phase: "completed",
        targetUid: `uid-${i}`,
        ts: `2026-06-01T00:0${i % 10}:00.000Z`,
        elapsedMs: i * 100,
      }));
    }
    files.set(DEFAULT_PATH, lines.join("\n") + "\n");
    const reader = new OperationsLogReader({ app });
    const entries = await reader.readLast();
    expect(entries).toHaveLength(10);
    // newest first → uid-14
    expect(entries[0].targetUid).toBe("uid-14");
    expect(entries[9].targetUid).toBe("uid-5");
  });

  it("honours custom limit parameter", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, [
      makeEntry({ phase: "completed", targetUid: "u1", ts: "1", elapsedMs: 100 }),
      makeEntry({ phase: "completed", targetUid: "u2", ts: "2", elapsedMs: 200 }),
      makeEntry({ phase: "completed", targetUid: "u3", ts: "3", elapsedMs: 300 }),
    ].join("\n"));
    const reader = new OperationsLogReader({ app });
    const entries = await reader.readLast(2);
    expect(entries.map((e) => e.targetUid)).toEqual(["u3", "u2"]);
  });

  it("skips malformed lines silently", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, [
      makeEntry({ phase: "completed", targetUid: "u1", ts: "1", elapsedMs: 100 }),
      "{ broken json",
      makeEntry({ phase: "completed", targetUid: "u2", ts: "2", elapsedMs: 200 }),
    ].join("\n"));
    const reader = new OperationsLogReader({ app });
    const entries = await reader.readLast();
    // Both valid entries returned, malformed skipped
    expect(entries.map((e) => e.targetUid)).toEqual(["u2", "u1"]);
  });

  it("uses labelLookup to resolve profile labels", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, makeEntry({
      phase: "completed",
      targetUid: "long-uuid-here",
      ts: "1",
      elapsedMs: 100,
    }));
    const reader = new OperationsLogReader({ app });
    const labels = new Map([["long-uuid-here", "profile-base"]]);
    const entries = await reader.readLast(10, (uid) => labels.get(uid) ?? null);
    expect(entries[0].profileLabel).toBe("profile-base");
  });

  it("falls back к UID[:8] when label lookup returns null", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, makeEntry({
      phase: "completed",
      targetUid: "ae00f219-base-uid",
      ts: "1",
      elapsedMs: 100,
    }));
    const reader = new OperationsLogReader({ app });
    const entries = await reader.readLast(10, () => null);
    expect(entries[0].profileLabel).toBe("ae00f219");
  });

  it("preserves elapsedMs=null when entry lacks the field (e.g. starting/failed phases)", async () => {
    const { app, files } = makeFakeApp();
    files.set(DEFAULT_PATH, [
      makeEntry({ phase: "starting", targetUid: "u1", ts: "1" }),
      makeEntry({ phase: "failed", targetUid: "u2", ts: "2", error: "boom" }),
    ].join("\n"));
    const reader = new OperationsLogReader({ app });
    const entries = await reader.readLast();
    expect(entries[0].status).toBe("failed");
    expect(entries[0].elapsedMs).toBeNull();
    expect(entries[0].error).toBe("boom");
    expect(entries[1].elapsedMs).toBeNull();
  });
});

describe("OperationsLogReader.parseLine", () => {
  it("parses well-formed entry", () => {
    const line = makeEntry({ phase: "completed", targetUid: "u", ts: "t", elapsedMs: 5 });
    const parsed = OperationsLogReader.parseLine(line);
    expect(parsed).toEqual({ phase: "completed", targetUid: "u", ts: "t", elapsedMs: 5 });
  });

  it("returns null for invalid JSON", () => {
    expect(OperationsLogReader.parseLine("not json")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(OperationsLogReader.parseLine(JSON.stringify({ phase: "completed" }))).toBeNull();
    expect(OperationsLogReader.parseLine(JSON.stringify({ targetUid: "u" }))).toBeNull();
  });

  it("returns null for unknown phase value", () => {
    const line = JSON.stringify({ phase: "weird", targetUid: "u", ts: "t" });
    expect(OperationsLogReader.parseLine(line)).toBeNull();
  });
});

describe("OperationsLogReader.formatEntry", () => {
  it("formats entry as pipe-delimited string", () => {
    const formatted = OperationsLogReader.formatEntry({
      ts: "2026-06-01T00:00:00Z",
      targetUid: "u",
      profileLabel: "profile-base",
      status: "completed",
      elapsedMs: 150,
      error: null,
    });
    expect(formatted).toBe("2026-06-01T00:00:00Z | profile-base | 150ms | completed");
  });

  it("substitutes — when elapsedMs is null", () => {
    const formatted = OperationsLogReader.formatEntry({
      ts: "t",
      targetUid: "u",
      profileLabel: "profile-base",
      status: "failed",
      elapsedMs: null,
      error: "boom",
    });
    expect(formatted).toContain("| — |");
  });
});
