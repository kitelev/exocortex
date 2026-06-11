/**
 * SyncCommands unit tests (ExoSync Phase B, RFC 4e4dc453) — D11 guards
 * (running flag, apply-in-flight), R8 PAT prompts, result aggregation.
 */

jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  requestUrl: jest.fn(),
}));

import { SyncCommands } from "../../../src/infrastructure/adapters/SyncCommands";
import type {
  BuiltSyncEngine,
  SyncSpecCollection,
} from "../../../src/infrastructure/adapters/SyncDepsFactory";
import type { ParityCheck } from "../../../src/infrastructure/adapters/ExoSyncParityFactory";
import type { RepoSyncResult, SyncEngine, SyncRepoSpec } from "exocortex";

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

const result = (
  repoKey: string,
  status: RepoSyncResult["status"],
  extra: Partial<RepoSyncResult> = {},
): RepoSyncResult => ({
  repoKey,
  status,
  pulledCount: 0,
  pushedCount: 0,
  mergedCount: 0,
  quarantinedCount: 0,
  warnings: [],
  deferredDeletes: [],
  ...extra,
});

interface HarnessOptions {
  specs?: SyncRepoSpec[];
  pat?: string | null;
  results?: RepoSyncResult[];
  isSwitchInProgress?: boolean;
  /** Resolves to release a hanging syncAll (double-invoke test). */
  syncAllGate?: Promise<void>;
  /** E1 parity harness seam. */
  parity?: ParityCheck;
}

function makeHarness(opts: HarnessOptions = {}) {
  const notices: string[] = [];
  const logs: string[] = [];
  const syncAll = jest.fn(
    async (
      specs: SyncRepoSpec[],
      _direction?: "sync" | "pull" | "push",
    ): Promise<RepoSyncResult[]> => {
      if (opts.syncAllGate !== undefined) await opts.syncAllGate;
      return (
        opts.results ?? specs.map((s) => result(s.repoKey, "synced"))
      );
    },
  );
  const collection: SyncSpecCollection = {
    specs: opts.specs ?? [spec("o/r")],
    asUidByRepoKey: new Map(),
    warnings: [],
  };
  const built: BuiltSyncEngine = {
    engine: { syncAll } as unknown as SyncEngine,
    pat: opts.pat === undefined ? "ghp_x" : opts.pat,
  };
  const commands = new SyncCommands({
    collectSpecs: async () => collection,
    buildEngine: async () => built,
    isSwitchInProgress: () => opts.isSwitchInProgress ?? false,
    notify: (m) => notices.push(m),
    log: (m) => logs.push(m),
    ...(opts.parity !== undefined ? { parity: opts.parity } : {}),
  });
  return { commands, notices, logs, syncAll };
}

describe("SyncCommands", () => {
  it("refuses a second invocation while one is running (D11 handler flag)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { commands, notices, syncAll } = makeHarness({ syncAllGate: gate });

    const first = commands.invokeSync();
    expect(commands.isBusy()).toBe(true);
    await commands.invokeSync();

    expect(notices.some((n) => n.includes("already in progress"))).toBe(true);
    release();
    await first;
    expect(commands.isBusy()).toBe(false);
    expect(syncAll).toHaveBeenCalledTimes(1);
  });

  it("refuses to start while a profile apply is in flight (D11)", async () => {
    const { commands, notices, syncAll } = makeHarness({
      isSwitchInProgress: true,
    });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes("profile apply"))).toBe(true);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it("prompts for a PAT instead of syncing unauthenticated (R8)", async () => {
    const { commands, notices, syncAll } = makeHarness({ pat: null });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes("PAT"))).toBe(true);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it("reports nothing-to-sync when no materialized AssetSpaces exist", async () => {
    const { commands, notices, syncAll } = makeHarness({ specs: [] });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes("Nothing to sync"))).toBe(true);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it("aggregates counts across repos in the success notice", async () => {
    const { commands, notices } = makeHarness({
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 2, pulledCount: 1 }),
        result("o/b#main", "synced", {
          mergedCount: 1,
          quarantinedCount: 1,
        }),
      ],
    });

    await commands.invokeSync();

    const done = notices.find((n) => n.startsWith("Sync done"));
    expect(done).toContain("2/2");
    expect(done).toContain("pushed 2");
    expect(done).toContain("pulled 1");
    expect(done).toContain("merged 1");
    expect(done).toContain("quarantined 1");
  });

  it("surfaces auth-required as an explicit PAT prompt, never success (R8)", async () => {
    const { commands, notices } = makeHarness({
      results: [result("o/r#main", "auth-required")],
    });

    await commands.invokeSync();

    expect(
      notices.some((n) => n.includes("expired, revoked or under-scoped")),
    ).toBe(true);
    expect(notices.some((n) => n.startsWith("Sync done"))).toBe(false);
  });

  it("reports per-repo failures in the finished-with-issues notice", async () => {
    const { commands, notices, logs } = makeHarness({
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced"),
        result("o/b#main", "error", { detail: "boom" }),
      ],
    });

    await commands.invokeSync();

    const issues = notices.find((n) => n.includes("issues"));
    expect(issues).toContain("o/b#main: error");
    expect(logs.some((l) => l.includes("boom"))).toBe(true);
  });

  it("surfaces a thrown sync as a Notice and releases the running flag", async () => {
    const notices: string[] = [];
    const commands = new SyncCommands({
      collectSpecs: async () => {
        throw new Error("collect blew up");
      },
      buildEngine: async () => {
        throw new Error("unreachable");
      },
      isSwitchInProgress: () => false,
      notify: (m) => notices.push(m),
      log: () => undefined,
    });

    await expect(commands.invokeSync()).resolves.toBeUndefined();
    expect(notices.some((n) => n.includes("collect blew up"))).toBe(true);
    expect(commands.isBusy()).toBe(false);
  });
});

describe("SyncCommands — Pull/Push split (#3473)", () => {
  it("invokePull runs the engine in pull direction and reports with the Pull label", async () => {
    const { commands, notices, syncAll } = makeHarness({
      results: [result("o/r#main", "synced", { pulledCount: 3 })],
    });

    await commands.invokePull();

    expect(syncAll).toHaveBeenCalledTimes(1);
    expect(syncAll.mock.calls[0][1]).toBe("pull");
    expect(notices.some((n) => n.startsWith("Pull started"))).toBe(true);
    const done = notices.find((n) => n.startsWith("Pull done"));
    expect(done).toContain("pulled 3");
    expect(done).toContain("pushed 0");
  });

  it("invokePush runs the engine in push direction and reports with the Push label", async () => {
    const { commands, notices, syncAll } = makeHarness({
      results: [result("o/r#main", "synced", { pushedCount: 2 })],
    });

    await commands.invokePush();

    expect(syncAll).toHaveBeenCalledTimes(1);
    expect(syncAll.mock.calls[0][1]).toBe("push");
    expect(notices.some((n) => n.startsWith("Push started"))).toBe(true);
    const done = notices.find((n) => n.startsWith("Push done"));
    expect(done).toContain("pushed 2");
  });

  it("invokeSync keeps the full cycle as the default direction", async () => {
    const { commands, syncAll } = makeHarness();

    await commands.invokeSync();

    expect(syncAll.mock.calls[0][1]).toBe("sync");
  });

  it("all three commands share the D11 mutual exclusion (one running flag)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { commands, notices, syncAll } = makeHarness({ syncAllGate: gate });

    const running = commands.invokePull();
    expect(commands.isBusy()).toBe(true);
    await commands.invokeSync();
    await commands.invokePush();

    expect(
      notices.filter((n) => n.includes("already in progress")),
    ).toHaveLength(2);
    release();
    await running;
    expect(commands.isBusy()).toBe(false);
    expect(syncAll).toHaveBeenCalledTimes(1);
  });

  it("prompts for a PAT instead of running unauthenticated split commands (R8)", async () => {
    const pull = makeHarness({ pat: null });
    await pull.commands.invokePull();
    expect(pull.notices.some((n) => n.includes("PAT"))).toBe(true);
    expect(pull.syncAll).not.toHaveBeenCalled();

    const push = makeHarness({ pat: null });
    await push.commands.invokePush();
    expect(push.notices.some((n) => n.includes("PAT"))).toBe(true);
    expect(push.syncAll).not.toHaveBeenCalled();
  });

  it("split runs skip the parity round — intentional divergence is not parity noise", async () => {
    const calls: string[] = [];
    const parity: ParityCheck = {
      captureSnapshot: async () => {
        calls.push("snapshot");
        return { dirtyByRepo: new Map(), warnings: [] };
      },
      runAfterSync: async () => {
        calls.push("after-sync");
        return "parity";
      },
      runStandalone: async () => {
        calls.push("standalone");
        return "parity";
      },
    };

    const pull = makeHarness({ parity });
    await pull.commands.invokePull();
    const push = makeHarness({ parity });
    await push.commands.invokePush();

    expect(calls).toEqual([]); // neither snapshot nor after-sync round
    expect(pull.notices.some((n) => n.startsWith("Pull done"))).toBe(true);
    expect(push.notices.some((n) => n.startsWith("Push done"))).toBe(true);
  });

  it("surfaces conflicts deferred to a full Sync in the done notice", async () => {
    const { commands, notices } = makeHarness({
      results: [
        result("o/r#main", "synced", { deferredPaths: ["a.md", "b.md"] }),
      ],
    });

    await commands.invokePull();

    const done = notices.find((n) => n.startsWith("Pull done"));
    expect(done).toContain("deferred 2");
  });
});

describe("SyncCommands — E1 parity harness integration", () => {
  function makeParity(overrides: Partial<ParityCheck> = {}): {
    parity: ParityCheck;
    calls: string[];
  } {
    const calls: string[] = [];
    const parity: ParityCheck = {
      captureSnapshot: async () => {
        calls.push("snapshot");
        return { dirtyByRepo: new Map(), warnings: [] };
      },
      runAfterSync: async (specs, results, snapshot) => {
        calls.push(
          `after-sync:${specs.length}:${results.length}:${snapshot !== undefined ? "with-snapshot" : "no-snapshot"}`,
        );
        return "ExoSync parity: M1=0, M2=∅ (1 repo(s) checked)";
      },
      runStandalone: async (specs) => {
        calls.push(`standalone:${specs.length}`);
        return "ExoSync parity: M1=0, M2=∅ (1 repo(s) checked)";
      },
      ...overrides,
    };
    return { parity, calls };
  }

  it("captures the snapshot BEFORE syncAll and runs the round after, notifying the summary", async () => {
    const { parity, calls } = makeParity();
    const { commands, notices, syncAll } = makeHarness({ parity });

    await commands.invokeSync();

    expect(calls).toEqual(["snapshot", "after-sync:1:1:with-snapshot"]);
    // Ordering: the snapshot call happened before the engine ran.
    expect(syncAll).toHaveBeenCalledTimes(1);
    expect(
      notices.some((n) => n.includes("parity: M1=0, M2=∅")),
    ).toBe(true);
  });

  it("a parity failure never affects the sync outcome (best-effort)", async () => {
    const { parity } = makeParity({
      runAfterSync: async () => {
        throw new Error("parity blew up");
      },
    });
    const { commands, notices, logs } = makeHarness({ parity });

    await commands.invokeSync();

    expect(notices.some((n) => n.startsWith("Sync done"))).toBe(true);
    expect(notices.some((n) => n.includes("parity check failed"))).toBe(true);
    expect(logs.some((l) => l.includes("parity round failed"))).toBe(true);
    expect(commands.isBusy()).toBe(false);
  });

  it("invokeParityReport runs a standalone round under the running flag", async () => {
    const { parity, calls } = makeParity();
    const { commands, notices } = makeHarness({ parity });

    await commands.invokeParityReport();

    expect(calls).toEqual(["standalone:1"]);
    expect(notices.some((n) => n.includes("parity check started"))).toBe(true);
    expect(notices.some((n) => n.includes("M1=0"))).toBe(true);
    expect(commands.isBusy()).toBe(false);
  });

  it("invokeParityReport refuses while a sync is running / apply in flight / not wired", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { parity, calls } = makeParity();
    const busy = makeHarness({ parity, syncAllGate: gate });
    const running = busy.commands.invokeSync();
    await busy.commands.invokeParityReport();
    expect(calls.filter((c) => c.startsWith("standalone"))).toHaveLength(0);
    expect(
      busy.notices.some((n) => n.includes("already in progress")),
    ).toBe(true);
    release();
    await running;

    const applying = makeHarness({ parity, isSwitchInProgress: true });
    await applying.commands.invokeParityReport();
    expect(
      applying.notices.some((n) => n.includes("profile apply is in progress")),
    ).toBe(true);

    const unwired = makeHarness();
    await unwired.commands.invokeParityReport();
    expect(
      unwired.notices.some((n) => n.includes("not wired")),
    ).toBe(true);
  });
});
