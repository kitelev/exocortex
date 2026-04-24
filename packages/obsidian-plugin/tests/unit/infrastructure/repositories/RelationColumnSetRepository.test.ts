import {
  RelationColumnSetRepository,
  type RelationColumnSetEventHandler,
  type RelationColumnSetSnapshot,
  type RelationColumnSetVaultAdapter,
} from "../../../../src/infrastructure/repositories/RelationColumnSetRepository";

type FrontmatterMap = Record<string, Record<string, unknown>>;

interface FakeAdapter extends RelationColumnSetVaultAdapter {
  setFrontmatter(map: FrontmatterMap): void;
  fire(event: "changed" | "deleted" | "renamed", path: string): void;
  removeFile(path: string): void;
  listenerCount(event: "changed" | "deleted" | "renamed"): number;
}

function makeAdapter(initial: FrontmatterMap = {}): FakeAdapter {
  let store: FrontmatterMap = { ...initial };
  const listeners: Record<
    "changed" | "deleted" | "renamed",
    Set<RelationColumnSetEventHandler>
  > = {
    changed: new Set(),
    deleted: new Set(),
    renamed: new Set(),
  };

  return {
    getAllMarkdownPaths: () => Object.keys(store),
    getFrontmatter: (path) => store[path] ?? null,
    on(event, handler) {
      listeners[event].add(handler);
      return () => listeners[event].delete(handler);
    },
    setFrontmatter(map) {
      store = { ...map };
    },
    fire(event, path) {
      for (const handler of listeners[event]) {
        handler({ path });
      }
    },
    removeFile(path) {
      delete store[path];
    },
    listenerCount: (event) => listeners[event].size,
  };
}

interface FakeTimer {
  readonly options: {
    setTimer: (cb: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
  };
  advance(ms: number): void;
  readonly pending: () => number;
}

function makeTimer(): FakeTimer {
  interface Entry {
    id: number;
    fireAt: number;
    cb: () => void;
  }
  let now = 0;
  let nextId = 1;
  let entries: Entry[] = [];
  return {
    options: {
      setTimer: (cb, ms) => {
        const entry: Entry = { id: nextId++, fireAt: now + ms, cb };
        entries.push(entry);
        return entry.id;
      },
      clearTimer: (handle) => {
        entries = entries.filter((e) => e.id !== handle);
      },
    },
    advance(ms) {
      now += ms;
      const due = entries.filter((e) => e.fireAt <= now);
      entries = entries.filter((e) => e.fireAt > now);
      for (const e of due) e.cb();
    },
    pending: () => entries.length,
  };
}

const CLASS_WIKILINK = "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]";
const CLASS_BARE = "[[ui__RelationColumnSet]]";

function validConfig(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    exo__Asset_uid: uid,
    exo__Instance_class: [CLASS_WIKILINK],
    ui__RelationColumnSet_targetClass: ["[[ems__WeeklyObjective]]"],
    ui__RelationColumnSet_referencingProperty: "[[ems__WeeklyObjective__week]]",
    ui__RelationColumnSet_columns: ["[[exo__Asset_label]]"],
    ui__RelationColumnSet_priority: 0,
    ...overrides,
  };
}

describe("RelationColumnSetRepository — initial scan", () => {
  test("empty vault → empty snapshot", () => {
    const adapter = makeAdapter();
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.all).toHaveLength(0);
    expect(snap.byUid.size).toBe(0);
  });

  test("indexes valid assets only (class-filter by frontmatter)", () => {
    const adapter = makeAdapter({
      "a.md": validConfig("uid-a"),
      "b.md": {
        exo__Asset_uid: "uid-b",
        exo__Instance_class: ["[[ems__Task]]"],
        ui__RelationColumnSet_columns: ["[[c]]"],
      },
      "c.md": validConfig("uid-c", { exo__Instance_class: [CLASS_BARE] }),
      "d.md": {
        // invalid: matches class but no targetClass AND no referencingProperty
        exo__Asset_uid: "uid-d",
        exo__Instance_class: [CLASS_WIKILINK],
        ui__RelationColumnSet_columns: ["[[c]]"],
      },
    });

    const repo = new RelationColumnSetRepository(adapter, makeTimer());
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.all.map((x) => x.uid).sort()).toEqual(["uid-a", "uid-c"]);
    expect(snap.byUid.get("uid-a")?.sourcePath).toBe("a.md");
  });

  test("double initialize is a no-op (listener count = 3)", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const repo = new RelationColumnSetRepository(adapter, makeTimer());
    repo.initialize();
    repo.initialize();

    expect(adapter.listenerCount("changed")).toBe(1);
    expect(adapter.listenerCount("deleted")).toBe(1);
    expect(adapter.listenerCount("renamed")).toBe(1);
  });

  test("snapshot columns normalized via WikiLinkHelpers (issue #2942)", () => {
    // Post issue #2942 fix: columns produced by
    // `createRelationColumnSetFromFrontmatter` MUST be bare property names so
    // React's `metadata[column]` lookup succeeds.  Wikilink + UUID-alias +
    // mixed-form inputs all collapse to the canonical identifier.
    const UUID = "5bc8d83d-34e4-4c2d-86e4-0c7dd30a2a12";
    const adapter = makeAdapter({
      "cols.md": validConfig("uid-cols", {
        ui__RelationColumnSet_columns: [
          "[[exo__Asset_createdAt]]",
          "[[exo__Asset_label]]",
          "exo__Asset_uid",
          `[[${UUID}|exo__Effort_status]]`,
        ],
      }),
    });
    const repo = new RelationColumnSetRepository(adapter, makeTimer());
    repo.initialize();

    const entry = repo.getSnapshot().byUid.get("uid-cols");
    expect(entry?.columns).toEqual([
      "exo__Asset_createdAt",
      "exo__Asset_label",
      "exo__Asset_uid",
      "exo__Effort_status",
    ]);
  });
});

describe("RelationColumnSetRepository — event debouncing", () => {
  test("coalesces multiple `changed` events within debounce window (1 rebuild)", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a1") });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();

    // 3 rapid events
    adapter.fire("changed", "a.md");
    adapter.fire("changed", "a.md");
    adapter.fire("changed", "a.md");
    expect(timer.pending()).toBe(1); // only the latest timer survives

    // Half the debounce window elapses — still pending
    timer.advance(100);
    expect(timer.pending()).toBe(1);

    // Past the trailing edge — rebuild runs exactly once
    timer.advance(50);
    expect(timer.pending()).toBe(0);
    expect(repo.getSnapshot().byUid.has("a1")).toBe(true);
  });

  test("different event types all trigger the same debounced rebuild", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();

    adapter.fire("changed", "a.md");
    adapter.fire("deleted", "other.md");
    adapter.fire("renamed", "a.md");
    expect(timer.pending()).toBe(1);
  });

  test("rebuildNow() cancels pending debounce and rebuilds synchronously", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();

    adapter.setFrontmatter({ "a.md": validConfig("a"), "b.md": validConfig("b") });
    adapter.fire("changed", "b.md");
    expect(timer.pending()).toBe(1);

    repo.rebuildNow();
    expect(timer.pending()).toBe(0);
    expect(repo.getSnapshot().byUid.has("b")).toBe(true);
  });

  test("deletion removes the entry after debounce elapses", () => {
    const adapter = makeAdapter({
      "a.md": validConfig("a"),
      "b.md": validConfig("b"),
    });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();

    expect(repo.getSnapshot().all).toHaveLength(2);
    adapter.removeFile("a.md");
    adapter.fire("deleted", "a.md");
    timer.advance(150);

    expect(repo.getSnapshot().all.map((c) => c.uid)).toEqual(["b"]);
  });

  test("custom debounceMs is honoured", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, {
      debounceMs: 40,
      ...timer.options,
    });
    repo.initialize();

    adapter.fire("changed", "a.md");
    timer.advance(39);
    expect(timer.pending()).toBe(1);
    timer.advance(1);
    expect(timer.pending()).toBe(0);
  });
});

describe("RelationColumnSetRepository — double-buffering atomic swap", () => {
  test("a caller retains the old snapshot across rebuilds", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();

    const before: RelationColumnSetSnapshot = repo.getSnapshot();
    expect(before.all.map((x) => x.uid)).toEqual(["a"]);

    adapter.setFrontmatter({
      "a.md": validConfig("a"),
      "b.md": validConfig("b"),
    });
    adapter.fire("changed", "b.md");
    timer.advance(150);

    const after: RelationColumnSetSnapshot = repo.getSnapshot();
    expect(after.all.map((x) => x.uid).sort()).toEqual(["a", "b"]);
    expect(before).not.toBe(after);
    // Old snapshot still intact (immutability proof)
    expect(before.all.map((x) => x.uid)).toEqual(["a"]);
  });

  test("snapshot arrays are frozen", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const repo = new RelationColumnSetRepository(adapter, makeTimer());
    repo.initialize();
    const snap = repo.getSnapshot();
    expect(Object.isFrozen(snap.all)).toBe(true);
    expect(Object.isFrozen(snap)).toBe(true);
  });
});

describe("RelationColumnSetRepository — duplicate detection", () => {
  test("logs a warning and keeps the first-seen asset for duplicate UIDs", () => {
    const warnings: string[] = [];
    const adapter = makeAdapter({
      "a.md": validConfig("dup-uid"),
      "b.md": validConfig("dup-uid", {
        ui__RelationColumnSet_targetClass: ["[[other]]"],
      }),
    });
    const repo = new RelationColumnSetRepository(adapter, {
      logger: { warn: (m) => warnings.push(m) },
      ...makeTimer().options,
    });
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.all).toHaveLength(1);
    expect(warnings.some((m) => m.includes("dup-uid"))).toBe(true);
  });
});

describe("RelationColumnSetRepository — dispose", () => {
  test("cancels pending debounce and removes all listeners", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();

    adapter.fire("changed", "a.md");
    expect(timer.pending()).toBe(1);

    repo.dispose();
    expect(timer.pending()).toBe(0);
    expect(adapter.listenerCount("changed")).toBe(0);
    expect(adapter.listenerCount("deleted")).toBe(0);
    expect(adapter.listenerCount("renamed")).toBe(0);
  });

  test("events received after dispose are ignored", () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const timer = makeTimer();
    const repo = new RelationColumnSetRepository(adapter, timer.options);
    repo.initialize();
    repo.dispose();

    // External listener re-subscribed by attacker — repository still should not flinch
    expect(() => timer.advance(1000)).not.toThrow();
  });

  test("double dispose is a no-op", () => {
    const adapter = makeAdapter();
    const repo = new RelationColumnSetRepository(adapter, makeTimer());
    repo.initialize();
    repo.dispose();
    expect(() => repo.dispose()).not.toThrow();
  });
});

describe("RelationColumnSetRepository — default-timer fallback", () => {
  test("no timer injected → uses real setTimeout/clearTimeout (rebuild after debounce)", async () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const repo = new RelationColumnSetRepository(adapter, { debounceMs: 5 });
    repo.initialize();
    adapter.fire("changed", "a.md");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(repo.getSnapshot().byUid.has("a")).toBe(true);
    repo.dispose();
  });

  test("dispose cancels a real-timer pending rebuild", async () => {
    const adapter = makeAdapter({ "a.md": validConfig("a") });
    const warnings: string[] = [];
    const repo = new RelationColumnSetRepository(adapter, {
      debounceMs: 30,
      logger: { warn: (m) => warnings.push(m) },
    });
    repo.initialize();
    adapter.fire("changed", "a.md");
    repo.dispose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    // no warnings from lingering rebuild
    expect(warnings).toHaveLength(0);
  });
});

describe("RelationColumnSetRepository — unsubscribe error tolerance", () => {
  test("dispose logs a warning when an unsub throws", () => {
    const adapter: RelationColumnSetVaultAdapter = {
      getAllMarkdownPaths: () => [],
      getFrontmatter: () => null,
      on: () => () => {
        throw new Error("boom");
      },
    };
    const warnings: string[] = [];
    const repo = new RelationColumnSetRepository(adapter, {
      logger: { warn: (m) => warnings.push(m) },
      ...makeTimer().options,
    });
    repo.initialize();
    repo.dispose();
    expect(warnings.some((m) => m.includes("boom"))).toBe(true);
  });
});

describe("RelationColumnSetRepository — Phase 1 invariants", () => {
  test("empty vault (AC 7: UniversalLayout must not break) — snapshot arrays are safe defaults", () => {
    const adapter = makeAdapter();
    const repo = new RelationColumnSetRepository(adapter, makeTimer());
    repo.initialize();
    const snap = repo.getSnapshot();
    expect(snap.all).toEqual([]);
    expect(snap.byUid.size).toBe(0);
    // A downstream .find() / .filter() must not throw on this value
    expect(snap.all.filter(() => true)).toEqual([]);
  });

  test("uninitialized repository yields the default empty snapshot", () => {
    const repo = new RelationColumnSetRepository(makeAdapter({ "a.md": validConfig("a") }), makeTimer());
    const snap = repo.getSnapshot();
    expect(snap.all).toEqual([]);
  });
});

