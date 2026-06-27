/**
 * @req:e157d3e5-03b7-4e40-822a-3c946b72f32a
 *
 * ExoSync post-sync targeted disk-read reindex (RFC 8f93ff95) — production-shape
 * integration test driving the REAL `SyncCommands` → REAL `VaultRDFIndexer`
 * (via `SPARQLQueryService`) → the SHARED triple store that backs auto-render
 * Layouts (`this.sparql.getTripleStore()` in production). NOT a standalone
 * `SPARQLQueryService.refresh()` test (F4): the reindex is driven through the
 * real command-layer gate + try/catch, exactly as the plugin wires it.
 *
 * Bug: ExoSync writes pulled assets via the low-level `vault.adapter.write`,
 * which fires NO Obsidian vault/metadataCache event, so nothing reindexes the
 * store and a pulled asset is invisible in Layouts until restart. The fix wires
 * a post-sync `reindex` dep into `SyncCommands` that re-reads the mutated paths
 * straight from disk into the shared store.
 *
 * Revert-verify (integration): neuter the `reindex.run(...)` call in
 * `SyncCommands.runSync` (or break `VaultRDFIndexer.updateFileFromDisk`'s
 * `addAll`) and the "visible after sync" case goes RED (the synced asset stays
 * absent — the user-reported bug); restore → GREEN. The `reindex: undefined`
 * test below is the same revert in injected-dep form (proves the dep is
 * load-bearing). The delete / gate / disk-read-over-stale-metadataCache cases
 * cover the rest of the AC.
 */

jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  requestUrl: jest.fn(),
}));

import { TFile } from "obsidian";
import type { App } from "obsidian";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import {
  SyncCommands,
  type PostSyncReindex,
} from "../../../src/infrastructure/adapters/SyncCommands";
import type {
  BuiltSyncEngine,
  SyncSpecCollection,
} from "../../../src/infrastructure/adapters/SyncDepsFactory";
import type {
  RepoSyncResult,
  SyncEngine,
  SyncRepoSpec,
} from "@kitelev/exocortex-core";

const EXO = "https://exocortex.my/ontology/exo#";
const REPO_KEY = "o/r#main";
const LAYOUT_QUERY = `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`;

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
}

/** Block-style YAML the mock `parseYaml` parses (quoted scalars + block arrays). */
function renderYaml(fm: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${String(item)}"`);
    } else {
      lines.push(`${k}: "${String(v)}"`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Production-shape vault/metadataCache fake. `adapter.read(path)` is the
 * disk-read seam the reindex uses (mirrors `vault.adapter.read`); a path absent
 * from disk throws (a deletion). `syncWrite`/`syncDelete` mutate disk WITHOUT
 * firing any `vault.on()` event — exactly ExoSync's `adapter.write`/`rename`
 * behaviour. `metadataStale` lands a file on disk but hides it from
 * metadataCache (proves the reindex reads disk, not the cache).
 */
function buildApp(seed: SeedFile[]) {
  const files: TFile[] = [];
  const fmByPath = new Map<string, Record<string, unknown>>();
  const diskByPath = new Map<string, string>();

  const add = (f: SeedFile, opts: { metadataStale?: boolean } = {}): void => {
    if (!files.some((t) => t.path === f.path)) files.push(new TFile(f.path));
    if (!opts.metadataStale) fmByPath.set(f.path, f.frontmatter);
    diskByPath.set(f.path, renderYaml(f.frontmatter));
  };
  const del = (path: string): void => {
    const i = files.findIndex((t) => t.path === path);
    if (i >= 0) files.splice(i, 1);
    fmByPath.delete(path);
    diskByPath.delete(path);
  };
  seed.forEach((f) => add(f));

  const vault = {
    getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
    getAbstractFileByPath: (p: string) =>
      files.find((f) => f.path === p) ?? null,
    read: async (f: TFile) => diskByPath.get(f.path) ?? "",
    // The disk-read seam used by VaultRDFIndexer.readFromDisk — DataAdapter.
    adapter: {
      read: async (p: string): Promise<string> => {
        const c = diskByPath.get(p);
        if (c === undefined) throw new Error(`ENOENT: ${p}`);
        return c;
      },
    },
    // Realism: registering a handler is a no-op; an adapter write/delete fires
    // NOTHING (mirrors Obsidian's behaviour for vault.adapter.*).
    on: () => ({}) as unknown,
    off: () => {},
    offref: () => {},
  };

  const metadataCache = {
    getFileCache: (f: TFile) => {
      const fm = fmByPath.get(f.path);
      return fm ? { frontmatter: fm } : null;
    },
    getFirstLinkpathDest: (linkpath: string) => {
      const base = linkpath.replace(/\.md$/, "");
      return files.find((f) => f.basename === base) ?? null;
    },
    resolvedLinks: {},
  };

  const app = { vault, metadataCache } as unknown as App;
  return {
    app,
    /** ExoSync pull of a new/changed asset: on disk, NO event. */
    syncWrite: (f: SeedFile, opts?: { metadataStale?: boolean }) => add(f, opts),
    /** ExoSync pull of a deletion: off disk, NO event. */
    syncDelete: (path: string) => del(path),
  };
}

function lex(term: unknown): string {
  if (term && typeof term === "object" && "value" in term) {
    return String((term as { value: unknown }).value);
  }
  return String(term);
}

const spec = (): SyncRepoSpec => ({
  owner: "o",
  repo: "r",
  branch: "main",
  repoKey: REPO_KEY,
  localPath: "assetspaces/o/r",
});

const result = (
  status: RepoSyncResult["status"],
  extra: Partial<RepoSyncResult> = {},
): RepoSyncResult => ({
  repoKey: REPO_KEY,
  status,
  pulledCount: 0,
  pushedCount: 0,
  mergedCount: 0,
  quarantinedCount: 0,
  warnings: [],
  deferredDeletes: [],
  ...extra,
});

/** Build the REAL SyncCommands over a fake engine returning canned results. */
function makeSyncCommands(opts: {
  results: RepoSyncResult[];
  reindex?: PostSyncReindex;
}): { cmds: SyncCommands; notices: string[] } {
  const notices: string[] = [];
  const syncAll = jest.fn(async (): Promise<RepoSyncResult[]> => opts.results);
  const built: BuiltSyncEngine = {
    engine: { syncAll } as unknown as SyncEngine,
    pat: "ghp_x",
    quarantineConfigured: true,
  };
  const collection: SyncSpecCollection = {
    specs: [spec()],
    asUidByRepoKey: new Map(),
    warnings: [],
    mountedNotDeclared: [],
  };
  const cmds = new SyncCommands({
    collectSpecs: async () => collection,
    buildEngine: async () => built,
    isSwitchInProgress: () => false,
    notify: (m) => notices.push(m),
    reindex: opts.reindex,
  });
  return { cmds, notices };
}

const EXISTING_TASK: SeedFile = {
  path: "assetspaces/o/r/existing-task.md",
  frontmatter: {
    exo__Asset_uid: "existing-uid",
    exo__Asset_label: "Existing Task",
    exo__Instance_class: ["[[ems__Task]]"],
  },
};

const SYNCED_TASK: SeedFile = {
  path: "assetspaces/o/r/synced-task.md",
  frontmatter: {
    exo__Asset_uid: "synced-uid",
    exo__Asset_label: "Synced Task",
    exo__Instance_class: ["[[ems__Task]]"],
  },
};

/** Reindex dep wired to the REAL indexer/store (the production store seam). */
const realReindex = (service: SPARQLQueryService): PostSyncReindex => ({
  run: (paths) => service.reindexPathsFromDisk(paths),
});

async function labelsInStore(service: SPARQLQueryService): Promise<string[]> {
  return (await service.query(LAYOUT_QUERY)).map((b) => lex(b.get("label"))).sort();
}

describe("ExoSync post-sync reindex (RFC 8f93ff95)", () => {
  let service: SPARQLQueryService | undefined;

  afterEach(async () => {
    await service?.dispose();
    service = undefined;
    jest.clearAllMocks();
  });

  it("makes a pulled asset visible in the shared store after a real SyncCommands sync (no restart)", async () => {
    const harness = buildApp([EXISTING_TASK]);
    service = new SPARQLQueryService(harness.app);
    await service.initialize();
    expect(await labelsInStore(service)).toEqual(["Existing Task"]);

    // ExoSync pulls a new asset → adapter.write → on disk, NO event fired.
    harness.syncWrite(SYNCED_TASK);

    const { cmds } = makeSyncCommands({
      results: [
        result("synced", { pulledCount: 1, pulledPaths: [SYNCED_TASK.path] }),
      ],
      reindex: realReindex(service),
    });
    await cmds.invokeSync();

    // The synced asset is now visible WITHOUT a restart — this is the fix.
    expect(await labelsInStore(service)).toEqual([
      "Existing Task",
      "Synced Task",
    ]);
  });

  it("WITHOUT the reindex dep the synced asset stays invisible (the bug — dep is load-bearing)", async () => {
    const harness = buildApp([EXISTING_TASK]);
    service = new SPARQLQueryService(harness.app);
    await service.initialize();

    harness.syncWrite(SYNCED_TASK);

    const { cmds } = makeSyncCommands({
      results: [
        result("synced", { pulledCount: 1, pulledPaths: [SYNCED_TASK.path] }),
      ],
      reindex: undefined, // no post-sync reindex wired → stale store
    });
    await cmds.invokeSync();

    expect(await labelsInStore(service)).toEqual(["Existing Task"]);
  });

  it("reads frontmatter from disk — a stale/empty metadataCache does not hide the synced asset", async () => {
    const harness = buildApp([EXISTING_TASK]);
    service = new SPARQLQueryService(harness.app);
    await service.initialize();

    // On disk (adapter.read OK) but ABSENT from metadataCache (getFileCache →
    // null). A metadataCache-based reindex (getFrontmatter) would see nothing;
    // the disk-read path still indexes it.
    harness.syncWrite(SYNCED_TASK, { metadataStale: true });

    const { cmds } = makeSyncCommands({
      results: [
        result("synced", { pulledCount: 1, pulledPaths: [SYNCED_TASK.path] }),
      ],
      reindex: realReindex(service),
    });
    await cmds.invokeSync();

    expect(await labelsInStore(service)).toContain("Synced Task");
  });

  it("delete-case: a pulled deletion removes the asset from the store without restart", async () => {
    const harness = buildApp([EXISTING_TASK, SYNCED_TASK]);
    service = new SPARQLQueryService(harness.app);
    await service.initialize();
    expect(await labelsInStore(service)).toEqual([
      "Existing Task",
      "Synced Task",
    ]);

    // ExoSync pulls a remote deletion → removed from disk, NO event fired.
    harness.syncDelete(SYNCED_TASK.path);

    const { cmds } = makeSyncCommands({
      results: [
        result("synced", { pulledCount: 1, pulledPaths: [SYNCED_TASK.path] }),
      ],
      reindex: realReindex(service),
    });
    await cmds.invokeSync();

    expect(await labelsInStore(service)).toEqual(["Existing Task"]);
  });

  it("gate: a no-op sync (nothing pulled/merged) triggers NO reindex", async () => {
    const harness = buildApp([EXISTING_TASK]);
    service = new SPARQLQueryService(harness.app);
    await service.initialize();

    const reindex: PostSyncReindex = { run: jest.fn(async () => {}) };
    const { cmds } = makeSyncCommands({
      results: [result("synced", { pulledCount: 0, mergedCount: 0 })],
      reindex,
    });
    await cmds.invokeSync();

    expect(reindex.run).not.toHaveBeenCalled();
  });

  it("gate: a push-only sync (pushedDeletes, nothing pulled/merged) triggers NO reindex", async () => {
    const harness = buildApp([EXISTING_TASK]);
    service = new SPARQLQueryService(harness.app);
    await service.initialize();

    const reindex: PostSyncReindex = { run: jest.fn(async () => {}) };
    const { cmds } = makeSyncCommands({
      results: [
        result("synced", {
          pushedCount: 1,
          pushedDeletes: ["assetspaces/o/r/gone.md"],
          pulledCount: 0,
          mergedCount: 0,
        }),
      ],
      reindex,
    });
    await cmds.invokeSync();

    // pushedDeletes are NOT a reindex trigger (push side is already
    // event-indexed locally) — the gate is pulledCount/mergedCount only.
    expect(reindex.run).not.toHaveBeenCalled();
  });

  it("best-effort: a reindex throw NEVER mutates the sync outcome and surfaces a reload Notice", async () => {
    const harness = buildApp([EXISTING_TASK]);
    service = new SPARQLQueryService(harness.app);
    await service.initialize();

    harness.syncWrite(SYNCED_TASK);

    const { cmds, notices } = makeSyncCommands({
      results: [
        result("synced", { pulledCount: 1, pulledPaths: [SYNCED_TASK.path] }),
      ],
      reindex: {
        run: async () => {
          throw new Error("boom");
        },
      },
    });

    // invokeSync must not reject — the reindex has its own try/catch.
    await expect(cmds.invokeSync()).resolves.toBeUndefined();

    // The store is untouched (no blank-Layout) and a reload Notice is shown.
    expect(await labelsInStore(service)).toEqual(["Existing Task"]);
    expect(notices.some((n) => /reload Obsidian/i.test(n))).toBe(true);
  });
});
