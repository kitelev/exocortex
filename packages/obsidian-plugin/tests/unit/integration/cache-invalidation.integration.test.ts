/**
 * RFC be70f741 Phase 4 — end-to-end cache invalidation integration.
 *
 * Scope: wire a live `RelationColumnSetRepository` to a live
 * `RelationColumnSetResolver` through the same provider the production
 * `ExocortexPlugin.onload` installs (`() => repo.getSnapshot().all`), and
 * prove the five Phase 4 scenarios propagate from metadataCache event →
 * debounce → rebuild → resolver result:
 *
 *   1. Add a new `ui__RelationColumnSet` config → resolver returns columns.
 *   2. Modify an existing config → resolver reflects the new columns.
 *   3. Delete a config → resolver returns `null` (renderer falls back to
 *      the legacy hardcoded map).
 *   4. Rename a config's vault path (uid unchanged) → asset remains
 *      resolvable — end-to-end exercise of the Phase 4 adapter-fix
 *      (`vault.on('rename')` ↔ `vault.offref`).
 *   5. Batch-write three configs within the debounce window → exactly one
 *      rebuild runs (150 ms trailing coalescing).
 */

import { RelationColumnSetResolver } from "exocortex";
import {
  RelationColumnSetRepository,
  type RelationColumnSetEventHandler,
  type RelationColumnSetVaultAdapter,
} from "../../../src/infrastructure/repositories/RelationColumnSetRepository";

// ── Test doubles ─────────────────────────────────────────────────────────────

type FrontmatterMap = Record<string, Record<string, unknown>>;

interface FakeAdapter extends RelationColumnSetVaultAdapter {
  setFrontmatter(path: string, fm: Record<string, unknown>): void;
  removeFrontmatter(path: string): void;
  renameFrontmatter(oldPath: string, newPath: string): void;
  fire(event: "changed" | "deleted" | "renamed", path: string): void;
}

function makeAdapter(initial: FrontmatterMap = {}): FakeAdapter {
  const store: FrontmatterMap = { ...initial };
  const listeners: Record<
    "changed" | "deleted" | "renamed",
    Set<RelationColumnSetEventHandler>
  > = { changed: new Set(), deleted: new Set(), renamed: new Set() };

  return {
    getAllMarkdownPaths: () => Object.keys(store),
    getFrontmatter: (path) => store[path] ?? null,
    on(event, handler) {
      listeners[event].add(handler);
      return () => listeners[event].delete(handler);
    },
    setFrontmatter(path, fm) {
      store[path] = fm;
    },
    removeFrontmatter(path) {
      delete store[path];
    },
    renameFrontmatter(oldPath, newPath) {
      if (store[oldPath]) {
        store[newPath] = store[oldPath];
        delete store[oldPath];
      }
    },
    fire(event, path) {
      for (const handler of listeners[event]) handler({ path });
    },
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

// ── Fixture helpers ──────────────────────────────────────────────────────────

const CLASS_WIKILINK = "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]";

function weeklyObjectiveConfig(
  uid: string,
  columns: readonly string[] = ["[[exo__Asset_createdAt]]", "[[exo__Asset_label]]"],
  priority = 0,
): Record<string, unknown> {
  return {
    exo__Asset_uid: uid,
    exo__Instance_class: [CLASS_WIKILINK],
    ui__RelationColumnSet_targetClass: ["[[ems__WeeklyObjective]]"],
    ui__RelationColumnSet_referencingProperty: "[[ems__WeeklyObjective__week]]",
    ui__RelationColumnSet_columns: columns,
    ui__RelationColumnSet_priority: priority,
  };
}

interface Wired {
  adapter: FakeAdapter;
  timer: FakeTimer;
  repo: RelationColumnSetRepository;
  resolver: RelationColumnSetResolver;
  warnings: string[];
}

function wire(initial: FrontmatterMap = {}): Wired {
  const adapter = makeAdapter(initial);
  const timer = makeTimer();
  const warnings: string[] = [];
  const logger = { warn: (m: string) => warnings.push(m) };
  const repo = new RelationColumnSetRepository(adapter, {
    logger,
    ...timer.options,
  });
  repo.initialize();
  // Mirror production wiring: provider closes over `repo.getSnapshot().all`
  // so the resolver always sees the freshest published snapshot after each
  // atomic swap (double-buffering guarantees existing readers are unaffected).
  const resolver = new RelationColumnSetResolver(
    () => repo.getSnapshot().all,
    { logger },
  );
  return { adapter, timer, repo, resolver, warnings };
}

const ROW_CLASSES = ["[[ems__WeeklyObjective]]"];
const GROUP_PROP = "[[ems__WeeklyObjective__week]]";

// ── Scenarios ────────────────────────────────────────────────────────────────

describe("Phase 4 cache invalidation — add/modify/delete/rename/batch", () => {
  test("S1: add new ui__RelationColumnSet config → columns flow to resolver", () => {
    const { adapter, timer, resolver } = wire();

    // Baseline — empty vault, resolver reports no match (renderer falls back).
    expect(resolver.resolve(ROW_CLASSES, GROUP_PROP)).toBeNull();

    // User drops a config file into the vault.
    adapter.setFrontmatter("configs/weekly.md", weeklyObjectiveConfig("wo-1"));
    adapter.fire("changed", "configs/weekly.md");

    // Before the debounce elapses, the snapshot is still the baseline.
    expect(resolver.resolve(ROW_CLASSES, GROUP_PROP)).toBeNull();

    // After 150 ms the rebuild runs and publishes the new snapshot.
    timer.advance(150);

    const resolved = resolver.resolve(ROW_CLASSES, GROUP_PROP);
    expect(resolved).not.toBeNull();
    expect(resolved?.uid).toBe("wo-1");
    // Columns normalize to bare property names (post #2942) so React's
    // `metadata[column]` lookup on the row frontmatter succeeds.
    expect(resolved?.columns).toEqual([
      "exo__Asset_createdAt",
      "exo__Asset_label",
    ]);
  });

  test("S2: modify existing config → resolver reflects new columns", () => {
    const { adapter, timer, resolver } = wire({
      "configs/weekly.md": weeklyObjectiveConfig("wo-1"),
    });

    const before = resolver.resolve(ROW_CLASSES, GROUP_PROP);
    expect(before?.columns).toEqual([
      "exo__Asset_createdAt",
      "exo__Asset_label",
    ]);

    // User reorders columns — uid stays, columns change.
    adapter.setFrontmatter(
      "configs/weekly.md",
      weeklyObjectiveConfig("wo-1", [
        "[[exo__Asset_label]]",
        "[[ems__Effort_status]]",
      ]),
    );
    adapter.fire("changed", "configs/weekly.md");
    timer.advance(150);

    const after = resolver.resolve(ROW_CLASSES, GROUP_PROP);
    expect(after?.uid).toBe("wo-1");
    expect(after?.columns).toEqual([
      "exo__Asset_label",
      "ems__Effort_status",
    ]);
  });

  test("S3: delete config → resolver returns null (legacy fallback path)", () => {
    const { adapter, timer, resolver } = wire({
      "configs/weekly.md": weeklyObjectiveConfig("wo-1"),
    });

    expect(resolver.resolve(ROW_CLASSES, GROUP_PROP)?.uid).toBe("wo-1");

    adapter.removeFrontmatter("configs/weekly.md");
    adapter.fire("deleted", "configs/weekly.md");
    timer.advance(150);

    expect(resolver.resolve(ROW_CLASSES, GROUP_PROP)).toBeNull();
  });

  test("S4: rename — asset stays resolvable, sourcePath tracks the new path", () => {
    const { adapter, timer, repo, resolver } = wire({
      "configs/weekly.md": weeklyObjectiveConfig("wo-1"),
    });

    expect(repo.getSnapshot().byUid.get("wo-1")?.sourcePath).toBe(
      "configs/weekly.md",
    );

    adapter.renameFrontmatter("configs/weekly.md", "configs/renamed.md");
    adapter.fire("renamed", "configs/renamed.md");
    timer.advance(150);

    // Snapshot still has the uid (index is uid-keyed, not path-keyed) and the
    // new path is reflected in sourcePath.
    const after = repo.getSnapshot().byUid.get("wo-1");
    expect(after).toBeDefined();
    expect(after?.sourcePath).toBe("configs/renamed.md");

    // Resolver still routes rowClass+property to the same config.
    expect(resolver.resolve(ROW_CLASSES, GROUP_PROP)?.uid).toBe("wo-1");
  });

  test("S5: batch write 3 files within debounce window → exactly 1 rebuild", () => {
    const { adapter, timer, repo, resolver } = wire();

    const defaultCols = [
      "[[exo__Asset_createdAt]]",
      "[[exo__Asset_label]]",
    ];
    adapter.setFrontmatter("configs/a.md", weeklyObjectiveConfig("a", defaultCols, 0));
    adapter.fire("changed", "configs/a.md");
    adapter.setFrontmatter("configs/b.md", weeklyObjectiveConfig("b", defaultCols, 2));
    adapter.fire("changed", "configs/b.md");
    adapter.setFrontmatter("configs/c.md", weeklyObjectiveConfig("c", defaultCols, 1));
    adapter.fire("changed", "configs/c.md");

    // Three event bursts yield a single pending timer (each fresh event
    // cancels the previous trailing timer — classic debounce trailing edge).
    expect(timer.pending()).toBe(1);

    // Halfway through the window — still pending, snapshot unchanged.
    timer.advance(100);
    expect(timer.pending()).toBe(1);
    expect(resolver.resolve(ROW_CLASSES, GROUP_PROP)).toBeNull();

    // Past the trailing edge — rebuild fires once and publishes all three.
    timer.advance(60);
    expect(timer.pending()).toBe(0);

    // All three configs must be indexed in the same snapshot → proof that a
    // single rebuild absorbed the burst.
    const uids = [...repo.getSnapshot().byUid.keys()].sort();
    expect(uids).toEqual(["a", "b", "c"]);

    // Tier-1 collision on {a, b, c}; deterministic tiebreaker
    // `priority DESC → uid ASC` picks the highest-priority match — `b`.
    const picked = resolver.resolve(ROW_CLASSES, GROUP_PROP);
    expect(picked?.uid).toBe("b");
  });
});
