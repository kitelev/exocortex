/**
 * QuarantineResolverCommands unit tests (finding a0a3d1d6) — D11 guards
 * (sync/apply in flight + own re-entry), R8 PAT prompt, empty-state, the
 * busy-flag lifecycle (held for the whole modal session, released on close),
 * and resolveOne success/failure routing. Pure logic — no Obsidian renderer.
 */

jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  requestUrl: jest.fn(),
}));

import {
  QuarantineResolverCommands,
  type BuiltQuarantineResolverLike,
  type ResolverModalContext,
} from "../../../src/infrastructure/adapters/QuarantineResolverCommands";
import type { SyncSpecCollection } from "../../../src/infrastructure/adapters/SyncDepsFactory";
import type {
  ConflictDetail,
  QuarantineResolver,
  ResolvableConflict,
  ResolveChoice,
  ResolveResult,
  SyncRepoSpec,
} from "exocortex";

const spec = (key: string): SyncRepoSpec => {
  const [owner, repo] = key.split("/");
  return {
    owner,
    repo,
    branch: "main",
    repoKey: `${key}#main`,
    localPath: `assetspaces/${key}`,
  };
};

const conflict = (
  repoKey: string,
  path = "alpha.md",
): ResolvableConflict => ({
  repoKey,
  path,
  hasLocal: true,
  hasRemote: true,
});

/** Minimal fake QuarantineResolver (structural). */
function fakeResolver(opts: {
  conflicts: ResolvableConflict[];
  dupUids?: number;
  resolve?: (
    spec: SyncRepoSpec,
    path: string,
    choice: ResolveChoice,
  ) => Promise<ResolveResult>;
}): QuarantineResolver {
  return {
    listOpenConflicts: async () => opts.conflicts,
    detectDuplicateUids: async () => opts.dupUids ?? 0,
    loadConflict: async (s: SyncRepoSpec, path: string): Promise<ConflictDetail> => ({
      repoKey: s.repoKey,
      path,
      hasLocal: true,
      hasRemote: true,
      local: "L",
      remote: "R",
    }),
    resolve:
      opts.resolve ??
      (async (s, path, choice): Promise<ResolveResult> => ({
        repoKey: s.repoKey,
        path,
        resolvedTo: choice.take === "merged" ? "merged" : choice.take,
        pushedSha: "abc1234deadbeef",
      })),
  } as unknown as QuarantineResolver;
}

interface HarnessOpts {
  specs?: SyncRepoSpec[];
  pat?: string | null;
  conflicts?: ResolvableConflict[];
  dupUids?: number;
  isSyncBusy?: boolean;
  isSwitchInProgress?: boolean;
  resolve?: (
    s: SyncRepoSpec,
    path: string,
    choice: ResolveChoice,
  ) => Promise<ResolveResult>;
}

function makeHarness(opts: HarnessOpts = {}) {
  const notices: string[] = [];
  const logs: string[] = [];
  let openedCtx: ResolverModalContext | null = null;
  const resolver = fakeResolver({
    conflicts: opts.conflicts ?? [conflict("a/b#main")],
    ...(opts.dupUids !== undefined ? { dupUids: opts.dupUids } : {}),
    ...(opts.resolve !== undefined ? { resolve: opts.resolve } : {}),
  });
  const built: BuiltQuarantineResolverLike = {
    resolver,
    pat: opts.pat === undefined ? "ghp_x" : opts.pat,
  };
  const collection: SyncSpecCollection = {
    specs: opts.specs ?? [spec("a/b")],
    asUidByRepoKey: new Map(),
    warnings: [],
  };
  const commands = new QuarantineResolverCommands({
    collectSpecs: async () => collection,
    buildResolver: async () => built,
    isSwitchInProgress: () => opts.isSwitchInProgress ?? false,
    isSyncBusy: () => opts.isSyncBusy ?? false,
    notify: (m) => notices.push(m),
    log: (m) => logs.push(m),
    openResolver: (ctx) => {
      openedCtx = ctx;
    },
  });
  return { commands, notices, logs, resolver, getCtx: () => openedCtx };
}

describe("QuarantineResolverCommands.invokeResolve — guards & states", () => {
  it("refuses when a sync is in flight (D11)", async () => {
    const h = makeHarness({ isSyncBusy: true });
    await h.commands.invokeResolve();
    expect(h.notices.join()).toMatch(/sync is in progress/i);
    expect(h.getCtx()).toBeNull();
    expect(h.commands.isBusy()).toBe(false);
  });

  it("refuses when a profile apply is in flight (D11)", async () => {
    const h = makeHarness({ isSwitchInProgress: true });
    await h.commands.invokeResolve();
    expect(h.notices.join()).toMatch(/profile apply is in progress/i);
    expect(h.getCtx()).toBeNull();
  });

  it("surfaces the R8 PAT prompt when no token is configured", async () => {
    const h = makeHarness({ pat: null });
    await h.commands.invokeResolve();
    expect(h.notices.join()).toMatch(/needs a GitHub PAT/);
    expect(h.getCtx()).toBeNull();
    expect(h.commands.isBusy()).toBe(false);
  });

  it("reports the empty state when there are no materialized specs", async () => {
    const h = makeHarness({ specs: [] });
    await h.commands.invokeResolve();
    expect(h.notices.join()).toMatch(/Nothing to resolve/);
    expect(h.getCtx()).toBeNull();
  });

  it("reports ✅ when there are no open conflicts (and no dup-uids)", async () => {
    const h = makeHarness({ conflicts: [], dupUids: 0 });
    await h.commands.invokeResolve();
    expect(h.notices.join()).toMatch(/No open sync conflicts/);
    expect(h.getCtx()).toBeNull();
    expect(h.commands.isBusy()).toBe(false);
  });

  it("points at dedup-uids (NOT a misleading ✅) when conflicts are empty but dup-uids exist (#a0a3d1d6)", async () => {
    const h = makeHarness({ conflicts: [], dupUids: 4 });
    await h.commands.invokeResolve();
    const joined = h.notices.join();
    expect(joined).toMatch(/4 duplicate uid\(s\)/);
    expect(joined).toMatch(/exosync dedup-uids/);
    expect(joined).not.toMatch(/nothing to resolve ✅/);
    expect(h.getCtx()).toBeNull();
    expect(h.commands.isBusy()).toBe(false);
  });

  it("opens the resolver with the conflicts and HOLDS the busy flag until close", async () => {
    const h = makeHarness({ conflicts: [conflict("a/b#main")] });
    await h.commands.invokeResolve();
    const ctx = h.getCtx();
    expect(ctx).not.toBeNull();
    expect(ctx!.conflicts).toHaveLength(1);
    expect(ctx!.specByRepoKey.get("a/b#main")).toBeDefined();
    // Busy stays TRUE while the modal is open (a resolution WRITES).
    expect(h.commands.isBusy()).toBe(true);
    // Releasing via onClose drops it.
    ctx!.onClose();
    expect(h.commands.isBusy()).toBe(false);
  });

  it("refuses a second open while one is already in flight", async () => {
    const h = makeHarness();
    await h.commands.invokeResolve();
    expect(h.commands.isBusy()).toBe(true);
    h.notices.length = 0;
    await h.commands.invokeResolve();
    expect(h.notices.join()).toMatch(/already open/i);
  });
});

describe("QuarantineResolverCommands.resolveOne", () => {
  it("notifies success and reports the push", async () => {
    const h = makeHarness();
    await h.commands.invokeResolve();
    const ctx = h.getCtx()!;
    const res = await ctx.resolveOne(conflict("a/b#main"), { take: "local" });
    expect(res).not.toBeNull();
    expect(h.notices.join()).toMatch(/Resolved alpha\.md \(local\) — pushed @abc1234/);
  });

  it("surfaces a redacted failure and returns null (conflict kept for retry)", async () => {
    const secret = "ghp_" + "s".repeat(36); // valid classic-PAT shape (redacted)
    const h = makeHarness({
      resolve: async () => {
        throw new Error(`boom with token ${secret}`);
      },
    });
    await h.commands.invokeResolve();
    const ctx = h.getCtx()!;
    const res = await ctx.resolveOne(conflict("a/b#main"), { take: "remote" });
    expect(res).toBeNull();
    const text = h.notices.join();
    expect(text).toMatch(/Resolve alpha\.md failed/);
    expect(text).not.toContain(secret);
  });
});
