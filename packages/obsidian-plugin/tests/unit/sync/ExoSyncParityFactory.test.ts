/**
 * ExoSyncParityFactory unit tests (E1) — JSONL journal store (rotation,
 * tolerant reads) + the guarded Obsidian Sync tri-state probe.
 */

jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  requestUrl: jest.fn(),
}));

import type { App, DataAdapter } from "obsidian";
import {
  ParityLogStore,
  detectObsidianSyncState,
} from "../../../src/infrastructure/adapters/ExoSyncParityFactory";
import type { ParityRoundRecord } from "exocortex";

/** Minimal in-memory DataAdapter surface the store touches. */
class FakeAdapter {
  readonly files = new Map<string, string>();
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT: ${path}`);
    return v;
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async append(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + content);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v === undefined) throw new Error(`ENOENT: ${from}`);
    this.files.set(to, v);
    this.files.delete(from);
  }
  async stat(path: string): Promise<{ size: number } | null> {
    const v = this.files.get(path);
    return v === undefined ? null : { size: Buffer.byteLength(v, "utf-8") };
  }
}

function record(ts: string, extra: Partial<ParityRoundRecord> = {}): ParityRoundRecord {
  return {
    version: 1,
    ts,
    trigger: "standalone",
    repos: [],
    checkedRepos: 0,
    m1Total: 0,
    m2Total: 0,
    ok: false,
    vacuous: true,
    ...extra,
  };
}

const LOG = ".obsidian/plugins/exocortex/exosync-parity-log.local.jsonl";

describe("ParityLogStore", () => {
  it("appends rounds and reads the latest back", async () => {
    const adapter = new FakeAdapter();
    const store = new ParityLogStore(adapter as unknown as DataAdapter, LOG);

    expect(await store.readLast()).toBeNull();
    await store.append(record("t1"));
    await store.append(record("t2", { m2Total: 3 }));

    const last = await store.readLast();
    expect(last?.ts).toBe("t2");
    expect(last?.m2Total).toBe(3);
    expect(adapter.files.get(LOG)!.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("tolerates a torn final line (append is not atomic)", async () => {
    const adapter = new FakeAdapter();
    const store = new ParityLogStore(adapter as unknown as DataAdapter, LOG);
    await store.append(record("good"));
    await adapter.append(LOG, '{"version":1,"ts":"torn...');

    const last = await store.readLast();
    expect(last?.ts).toBe("good");
  });

  it("ignores foreign JSON shapes in the journal", async () => {
    const adapter = new FakeAdapter();
    const store = new ParityLogStore(adapter as unknown as DataAdapter, LOG);
    await store.append(record("real"));
    await adapter.append(LOG, '{"something":"else"}\n');

    expect((await store.readLast())?.ts).toBe("real");
  });

  it("rotates single-generation past the size cap", async () => {
    const adapter = new FakeAdapter();
    const store = new ParityLogStore(adapter as unknown as DataAdapter, LOG);
    await store.append(record("old"));
    // Inflate the active file past the 1 MB cap.
    await adapter.append(LOG, `${"x".repeat(1024 * 1024)}\n`);

    await store.append(record("fresh"));

    expect(adapter.files.has(`${LOG}.1`)).toBe(true);
    const active = adapter.files.get(LOG)!;
    expect(active).toContain('"ts":"fresh"');
    expect(active).not.toContain('"ts":"old"');
    expect((await store.readLast())?.ts).toBe("fresh");
  });
});

describe("detectObsidianSyncState", () => {
  const appWith = (internalPlugins: unknown): App =>
    ({ internalPlugins }) as unknown as App;

  it("reports enabled / disabled from the internal plugin shape", () => {
    expect(
      detectObsidianSyncState(appWith({ plugins: { sync: { enabled: true } } })),
    ).toBe("enabled");
    expect(
      detectObsidianSyncState(appWith({ plugins: { sync: { enabled: false } } })),
    ).toBe("disabled");
  });

  it("degrades to unknown on any shape drift — never throws", () => {
    expect(detectObsidianSyncState(appWith(undefined))).toBe("unknown");
    expect(detectObsidianSyncState(appWith({}))).toBe("unknown");
    expect(detectObsidianSyncState(appWith({ plugins: {} }))).toBe("unknown");
    expect(
      detectObsidianSyncState(appWith({ plugins: { sync: { enabled: "yes" } } })),
    ).toBe("unknown");
    expect(
      detectObsidianSyncState(
        appWith(
          new Proxy(
            {},
            {
              get: () => {
                throw new Error("hostile shape");
              },
            },
          ),
        ),
      ),
    ).toBe("unknown");
  });
});
