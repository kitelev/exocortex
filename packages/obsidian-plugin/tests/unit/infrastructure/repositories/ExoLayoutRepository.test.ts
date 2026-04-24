import {
  ExoLayoutRepository,
  type ExoLayoutEventHandler,
  type ExoLayoutSnapshot,
  type ExoLayoutVaultAdapter,
} from "../../../../src/infrastructure/repositories/ExoLayoutRepository";

type FrontmatterMap = Record<string, Record<string, unknown>>;

interface FakeAdapter extends ExoLayoutVaultAdapter {
  setFrontmatter(map: FrontmatterMap): void;
  fire(event: "changed" | "deleted" | "renamed", path: string): void;
  removeFile(path: string): void;
  listenerCount(event: "changed" | "deleted" | "renamed"): number;
}

function makeAdapter(initial: FrontmatterMap = {}): FakeAdapter {
  let store: FrontmatterMap = { ...initial };
  const listeners: Record<
    "changed" | "deleted" | "renamed",
    Set<ExoLayoutEventHandler>
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

const LAYOUT_CLASS_WIKILINK = "[[08d00289-a5c8-4df1-8885-40a00a014004|exo__Layout]]";
const LAYOUT_CLASS_BARE = "[[exo__Layout]]";
const PROPERTIES_BLOCK_CLASS = "[[fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe|exo__PropertiesBlock]]";
const BACKLINKS_BLOCK_CLASS = "[[2e868956-d81e-43fd-9817-1addde9cb311|exo__BacklinksTableBlock]]";

function validLayout(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: `Layout ${uid}`,
    exo__Instance_class: [LAYOUT_CLASS_WIKILINK],
    exo__Layout_targetClass: "[[ems__WeeklyObjective]]",
    exo__Layout_blocks: ["[[props-block]]", "[[backlinks-block]]"],
    exo__Layout_priority: 0,
    exo__Layout_coexistsWithDefault: false,
    ...overrides,
  };
}

function validPropertiesBlock(
  uid: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: "Props Block",
    exo__Instance_class: [PROPERTIES_BLOCK_CLASS],
    exo__LayoutBlock_title: "Properties",
    ...overrides,
  };
}

function validBacklinksBlock(
  uid: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    exo__Asset_uid: uid,
    exo__Asset_label: "Backlinks Block",
    exo__Instance_class: [BACKLINKS_BLOCK_CLASS],
    exo__LayoutBlock_title: "Backlinks",
    exo__BacklinksTableBlock_rowClass: "[[ems__WeeklyObjective]]",
    exo__BacklinksTableBlock_referencingProperty: "[[ems__WeeklyObjective__week]]",
    exo__BacklinksTableBlock_columns: ["[[exo__Asset_label]]"],
    ...overrides,
  };
}

describe("ExoLayoutRepository — initial scan", () => {
  test("empty vault → empty snapshot", () => {
    const adapter = makeAdapter();
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.layouts).toHaveLength(0);
    expect(snap.blocks).toHaveLength(0);
    expect(snap.blocksByUid.size).toBe(0);
    expect(snap.blocksByLabel.size).toBe(0);
  });

  test("indexes valid layouts and blocks separately", () => {
    const adapter = makeAdapter({
      "layout-a.md": validLayout("uid-layout-a"),
      "props.md": validPropertiesBlock("uid-props"),
      "backlinks.md": validBacklinksBlock("uid-backlinks"),
      "other.md": {
        exo__Asset_uid: "uid-other",
        exo__Instance_class: ["[[ems__Task]]"],
      },
      "invalid-layout.md": {
        exo__Asset_uid: "uid-invalid",
        exo__Instance_class: [LAYOUT_CLASS_WIKILINK],
        // missing exo__Layout_targetClass AND exo__Layout_blocks
      },
    });

    const repo = new ExoLayoutRepository(adapter, makeTimer());
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.layouts.map((l) => l.uid)).toEqual(["uid-layout-a"]);
    expect(snap.blocks.map((b) => b.uid).sort()).toEqual([
      "uid-backlinks",
      "uid-props",
    ]);
    expect(snap.blocksByUid.get("uid-props")?.kind).toBe("properties");
    expect(snap.blocksByUid.get("uid-backlinks")?.kind).toBe("backlinks-table");
  });

  test("blocksByLabel indexes by exo__Asset_label AND ex__Asset_uid", () => {
    const adapter = makeAdapter({
      "props.md": validPropertiesBlock("uid-props", {
        exo__Asset_label: "PropsBlock",
      }),
    });
    const repo = new ExoLayoutRepository(adapter, makeTimer());
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.blocksByUid.get("uid-props")).toBeDefined();
    expect(snap.blocksByLabel.get("PropsBlock")).toBe(
      snap.blocksByUid.get("uid-props"),
    );
  });

  test("bare wikilink class form also matches (UUID-free label)", () => {
    const adapter = makeAdapter({
      "layout.md": validLayout("uid-bare", {
        exo__Instance_class: [LAYOUT_CLASS_BARE],
      }),
    });
    const repo = new ExoLayoutRepository(adapter, makeTimer());
    repo.initialize();
    expect(repo.getSnapshot().layouts.map((l) => l.uid)).toEqual(["uid-bare"]);
  });

  test("double initialize is a no-op (listener count = 3)", () => {
    const adapter = makeAdapter({ "layout.md": validLayout("a") });
    const repo = new ExoLayoutRepository(adapter, makeTimer());
    repo.initialize();
    repo.initialize();

    expect(adapter.listenerCount("changed")).toBe(1);
    expect(adapter.listenerCount("deleted")).toBe(1);
    expect(adapter.listenerCount("renamed")).toBe(1);
  });
});

describe("ExoLayoutRepository — event debouncing", () => {
  test("coalesces multiple events within 150ms window (1 rebuild)", () => {
    const adapter = makeAdapter({ "layout.md": validLayout("a") });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
    repo.initialize();

    adapter.fire("changed", "layout.md");
    adapter.fire("changed", "layout.md");
    adapter.fire("changed", "layout.md");
    expect(timer.pending()).toBe(1);

    timer.advance(100);
    expect(timer.pending()).toBe(1);

    timer.advance(50);
    expect(timer.pending()).toBe(0);
    expect(repo.getSnapshot().layouts.map((l) => l.uid)).toEqual(["a"]);
  });

  test("different event types trigger one debounced rebuild", () => {
    const adapter = makeAdapter({ "layout.md": validLayout("a") });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
    repo.initialize();

    adapter.fire("changed", "layout.md");
    adapter.fire("deleted", "other.md");
    adapter.fire("renamed", "layout.md");
    expect(timer.pending()).toBe(1);
  });

  test("rebuildNow() cancels pending debounce and rebuilds synchronously", () => {
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
    repo.initialize();

    adapter.setFrontmatter({
      "a.md": validLayout("a"),
      "b.md": validLayout("b"),
    });
    adapter.fire("changed", "b.md");
    expect(timer.pending()).toBe(1);

    repo.rebuildNow();
    expect(timer.pending()).toBe(0);
    expect(repo.getSnapshot().layouts.map((l) => l.uid).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  test("deletion removes layout after debounce", () => {
    const adapter = makeAdapter({
      "a.md": validLayout("a"),
      "b.md": validLayout("b"),
    });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
    repo.initialize();

    expect(repo.getSnapshot().layouts).toHaveLength(2);
    adapter.removeFile("a.md");
    adapter.fire("deleted", "a.md");
    timer.advance(150);

    expect(repo.getSnapshot().layouts.map((l) => l.uid)).toEqual(["b"]);
  });

  test("custom debounceMs is honoured", () => {
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, {
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

describe("ExoLayoutRepository — double-buffering atomic swap", () => {
  test("caller retains old snapshot across rebuilds (immutability)", () => {
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
    repo.initialize();

    const before: ExoLayoutSnapshot = repo.getSnapshot();
    expect(before.layouts.map((l) => l.uid)).toEqual(["a"]);

    adapter.setFrontmatter({
      "a.md": validLayout("a"),
      "b.md": validLayout("b"),
    });
    adapter.fire("changed", "b.md");
    timer.advance(150);

    const after = repo.getSnapshot();
    expect(after.layouts.map((l) => l.uid).sort()).toEqual(["a", "b"]);
    expect(before).not.toBe(after);
    expect(before.layouts.map((l) => l.uid)).toEqual(["a"]);
  });

  test("snapshot is frozen", () => {
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const repo = new ExoLayoutRepository(adapter, makeTimer());
    repo.initialize();
    const snap = repo.getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.layouts)).toBe(true);
    expect(Object.isFrozen(snap.blocks)).toBe(true);
  });
});

describe("ExoLayoutRepository — duplicate detection", () => {
  test("logs warning and keeps first-seen layout for duplicate UIDs", () => {
    const warnings: string[] = [];
    const adapter = makeAdapter({
      "a.md": validLayout("dup-uid", { exo__Layout_targetClass: "[[ems__Task]]" }),
      "b.md": validLayout("dup-uid", { exo__Layout_targetClass: "[[ems__Project]]" }),
    });
    const repo = new ExoLayoutRepository(adapter, {
      logger: { warn: (m) => warnings.push(m) },
      ...makeTimer().options,
    });
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.layouts).toHaveLength(1);
    expect(warnings.some((m) => m.includes("dup-uid"))).toBe(true);
  });

  test("logs warning and keeps first-seen block for duplicate UIDs", () => {
    const warnings: string[] = [];
    const adapter = makeAdapter({
      "p1.md": validPropertiesBlock("dup-block"),
      "p2.md": validPropertiesBlock("dup-block", { exo__Asset_label: "Other" }),
    });
    const repo = new ExoLayoutRepository(adapter, {
      logger: { warn: (m) => warnings.push(m) },
      ...makeTimer().options,
    });
    repo.initialize();

    const snap = repo.getSnapshot();
    expect(snap.blocks).toHaveLength(1);
    expect(warnings.some((m) => m.includes("dup-block"))).toBe(true);
  });
});

describe("ExoLayoutRepository — dispose", () => {
  test("cancels pending debounce and removes all listeners", () => {
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
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
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const timer = makeTimer();
    const repo = new ExoLayoutRepository(adapter, timer.options);
    repo.initialize();
    repo.dispose();

    expect(() => timer.advance(1000)).not.toThrow();
  });

  test("double dispose is a no-op", () => {
    const adapter = makeAdapter();
    const repo = new ExoLayoutRepository(adapter, makeTimer());
    repo.initialize();
    repo.dispose();
    expect(() => repo.dispose()).not.toThrow();
  });
});

describe("ExoLayoutRepository — default-timer fallback", () => {
  test("no timer injected → uses real setTimeout/clearTimeout", async () => {
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const repo = new ExoLayoutRepository(adapter, { debounceMs: 5 });
    repo.initialize();
    adapter.fire("changed", "a.md");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(repo.getSnapshot().layouts.map((l) => l.uid)).toEqual(["a"]);
    repo.dispose();
  });

  test("dispose cancels a real-timer pending rebuild", async () => {
    const adapter = makeAdapter({ "a.md": validLayout("a") });
    const warnings: string[] = [];
    const repo = new ExoLayoutRepository(adapter, {
      debounceMs: 30,
      logger: { warn: (m) => warnings.push(m) },
    });
    repo.initialize();
    adapter.fire("changed", "a.md");
    repo.dispose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(warnings).toHaveLength(0);
  });
});

describe("ExoLayoutRepository — unsubscribe error tolerance", () => {
  test("dispose logs warning when unsub throws", () => {
    const adapter: ExoLayoutVaultAdapter = {
      getAllMarkdownPaths: () => [],
      getFrontmatter: () => null,
      on: () => () => {
        throw new Error("boom");
      },
    };
    const warnings: string[] = [];
    const repo = new ExoLayoutRepository(adapter, {
      logger: { warn: (m) => warnings.push(m) },
      ...makeTimer().options,
    });
    repo.initialize();
    repo.dispose();
    expect(warnings.some((m) => m.includes("boom"))).toBe(true);
  });
});

describe("ExoLayoutRepository — Phase 1 invariants", () => {
  test("uninitialized repository yields default empty snapshot", () => {
    const repo = new ExoLayoutRepository(
      makeAdapter({ "a.md": validLayout("a") }),
      makeTimer(),
    );
    const snap = repo.getSnapshot();
    expect(snap.layouts).toEqual([]);
    expect(snap.blocks).toEqual([]);
  });

  test("snapshot arrays are safe defaults for downstream .filter()", () => {
    const adapter = makeAdapter();
    const repo = new ExoLayoutRepository(adapter, makeTimer());
    repo.initialize();
    const snap = repo.getSnapshot();
    expect(snap.layouts.filter(() => true)).toEqual([]);
    expect(snap.blocks.filter(() => true)).toEqual([]);
  });
});
