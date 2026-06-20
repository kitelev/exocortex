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
import type {
  RepoSyncResult,
  SyncEngine,
  SyncPhaseTimings,
  SyncProgressEvent,
  SyncRepoSpec,
} from "exocortex";
import { emptyTimings } from "exocortex";

/** Phase 0 — a production-shape timing fixture for the summary-surface tests. */
const timingsOf = (hashMs: number, readMs: number): SyncPhaseTimings => {
  const t = emptyTimings();
  t.durations.hash = hashMs;
  t.durations.localRead = readMs;
  t.durations.restCommit = 200;
  t.counts.filesHashed = 3;
  t.counts.filesRead = 3;
  t.counts.restCalls = 2;
  return t;
};

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
  /** D11 — the conflict resolver modal is open (HIGH-2 guard). */
  isResolverBusy?: boolean;
  /** Resolves to release a hanging syncAll (double-invoke test). */
  syncAllGate?: Promise<void>;
  /** E1 parity harness seam. */
  parity?: ParityCheck;
  /** Optional info-level callback seam (success console signal, #3489). */
  logInfo?: (m: string) => void;
  /** #3495 — whether the engine was built with a durable quarantine sink. */
  quarantineConfigured?: boolean;
  /** #3499 — opt-in verbose per-step Notice toggle (default off). */
  stepNoticesEnabled?: boolean;
  /**
   * #3498 — in-flight progress events the fake engine fires through the
   * `onProgress` callback (3rd syncAll arg) during a run, to assert routing.
   */
  progressEvents?: SyncProgressEvent[];
}

function makeHarness(opts: HarnessOptions = {}) {
  const notices: string[] = [];
  const logs: string[] = [];
  const infoLogs: string[] = [];
  const verboseLogs: string[] = [];
  const syncAll = jest.fn(
    async (
      specs: SyncRepoSpec[],
      _direction?: "sync" | "pull" | "push",
      onProgress?: (event: SyncProgressEvent) => void,
    ): Promise<RepoSyncResult[]> => {
      if (opts.syncAllGate !== undefined) await opts.syncAllGate;
      // #3498 — replay synthetic in-flight progress so the routing
      // (info channel + verbose file sink) is observable in the test.
      for (const e of opts.progressEvents ?? []) onProgress?.(e);
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
    quarantineConfigured: opts.quarantineConfigured ?? true,
  };
  const commands = new SyncCommands({
    collectSpecs: async () => collection,
    buildEngine: async () => built,
    isSwitchInProgress: () => opts.isSwitchInProgress ?? false,
    isResolverBusy: () => opts.isResolverBusy ?? false,
    notify: (m) => notices.push(m),
    log: (m) => logs.push(m),
    logInfo: opts.logInfo ?? ((m) => infoLogs.push(m)),
    logVerbose: (m) => verboseLogs.push(m),
    ...(opts.stepNoticesEnabled !== undefined
      ? { stepNoticesEnabled: (): boolean => opts.stepNoticesEnabled === true }
      : {}),
    ...(opts.parity !== undefined ? { parity: opts.parity } : {}),
  });
  return { commands, notices, logs, infoLogs, verboseLogs, syncAll };
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

  it("refuses to start while the conflict resolver is open (D11 / HIGH-2)", async () => {
    const { commands, notices, syncAll } = makeHarness({
      isResolverBusy: true,
    });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes("conflict resolver is open"))).toBe(
      true,
    );
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

    // The busy notice names the run actually holding the flag.
    expect(
      notices.filter((n) => n.startsWith("Pull already in progress")),
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

describe("SyncCommands — #3489 explicit success signal (info console + Notice)", () => {
  it("success path: logInfo called exactly once with formatted summary, notify called exactly once for done", async () => {
    const { commands, notices, infoLogs } = makeHarness({
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 1, pulledCount: 2 }),
        result("o/b#main", "synced", { mergedCount: 1, quarantinedCount: 1 }),
      ],
    });

    await commands.invokeSync();

    // Exactly ONE console info line for success summary
    const infoSuccess = infoLogs.filter((l) => l.includes("[ExoSync] Sync OK:"));
    expect(infoSuccess).toHaveLength(1);
    const line = infoSuccess[0];
    expect(line).toContain("2/2");
    expect(line).toContain("pushed 1");
    expect(line).toContain("pulled 2");
    expect(line).toContain("merged 1");
    expect(line).toContain("quarantined 1");

    // Exactly ONE success Notice (the existing notify — no regression)
    const doneNotices = notices.filter((n) => n.startsWith("Sync done"));
    expect(doneNotices).toHaveLength(1);
  });

  it("success path: Pull and Push labels propagate into the info summary line", async () => {
    const pull = makeHarness({ results: [result("o/r#main", "synced", { pulledCount: 3 })] });
    await pull.commands.invokePull();
    expect(pull.infoLogs.some((l) => l.includes("[ExoSync] Pull OK:"))).toBe(true);
    expect(pull.infoLogs.filter((l) => l.includes("[ExoSync] Pull OK:"))).toHaveLength(1);

    const push = makeHarness({ results: [result("o/r#main", "synced", { pushedCount: 2 })] });
    await push.commands.invokePush();
    expect(push.infoLogs.some((l) => l.includes("[ExoSync] Push OK:"))).toBe(true);
  });

  it("issues path: success SUMMARY line NOT emitted on error path (#3496 step lines still fire)", async () => {
    const { commands, notices, infoLogs } = makeHarness({
      results: [
        result("o/a#main", "synced"),
        result("o/b#main", "error", { detail: "boom" }),
      ],
    });

    await commands.invokeSync();

    // The #3489 success SUMMARY ("Sync OK") must NOT fire on the issues path…
    expect(infoLogs.filter((l) => l.includes("[ExoSync] Sync OK:"))).toHaveLength(0);
    // …but #3496 step lines (start + per-repo) DO — diagnostics matter on failure.
    expect(infoLogs.some((l) => l.includes("[ExoSync] Sync started"))).toBe(true);
    // Existing issues Notice still fires
    expect(notices.some((n) => n.includes("issues"))).toBe(true);
  });

  it("auth-required path: success SUMMARY NOT emitted — early return before success branch (#3496 step lines still fire)", async () => {
    const { commands, infoLogs } = makeHarness({
      results: [result("o/r#main", "auth-required")],
    });

    await commands.invokeSync();

    // No #3489 success summary on the auth-required early-return path…
    expect(infoLogs.filter((l) => l.includes("[ExoSync] Sync OK:"))).toHaveLength(0);
    // …but the #3496 start line fired before syncAll.
    expect(infoLogs.some((l) => l.includes("[ExoSync] Sync started"))).toBe(true);
  });

  it("success path: no duplicate Notice (logInfo is info-only, no warn-channel Notice)", async () => {
    const { commands, notices } = makeHarness();

    await commands.invokeSync();

    // There must NOT be two 'done' notices (no double-notice from warn-channel)
    const doneNotices = notices.filter((n) => n.startsWith("Sync done"));
    expect(doneNotices).toHaveLength(1);
  });

  it("works without logInfo wired (backward compat — optional dep)", async () => {
    const notices: string[] = [];
    const commands = new SyncCommands({
      collectSpecs: async () => ({
        specs: [spec("o/r")],
        asUidByRepoKey: new Map(),
        warnings: [],
      }),
      buildEngine: async () => ({
        engine: { syncAll: async (specs: SyncRepoSpec[]) => specs.map((s) => result(s.repoKey, "synced")) } as unknown as import("exocortex").SyncEngine,
        pat: "ghp_x",
        quarantineConfigured: true,
      }),
      isSwitchInProgress: () => false,
      notify: (m) => notices.push(m),
    });

    await expect(commands.invokeSync()).resolves.toBeUndefined();
    expect(notices.some((n) => n.startsWith("Sync done"))).toBe(true);
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

describe("SyncCommands — #3495 quarantine-sink degraded-mode warn", () => {
  const warnText = "quarantine sink not configured";

  it("warns once (notify + logInfo) when the sink is unconfigured AND a conflict was quarantined", async () => {
    const { commands, notices, infoLogs } = makeHarness({
      quarantineConfigured: false,
      results: [result("o/r#main", "synced", { quarantinedCount: 1 })],
    });

    await commands.invokeSync();

    const warnNotices = notices.filter((n) => n.includes(warnText));
    expect(warnNotices).toHaveLength(1);
    expect(warnNotices[0]).toContain("1 conflict(s)");
    expect(warnNotices[0]).toContain("Settings → Exocortex");
    // Console echo on the info channel (no file spam, #3186) — exactly once.
    expect(infoLogs.filter((l) => l.includes(warnText))).toHaveLength(1);
  });

  it("aggregates the conflict count across repos in the warn", async () => {
    const { commands, notices } = makeHarness({
      quarantineConfigured: false,
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { quarantinedCount: 2 }),
        result("o/b#main", "synced", { quarantinedCount: 1 }),
      ],
    });

    await commands.invokeSync();

    expect(
      notices.some((n) => n.includes(warnText) && n.includes("3 conflict(s)")),
    ).toBe(true);
  });

  it("stays silent when the sink IS configured even with a conflict", async () => {
    const { commands, notices, infoLogs } = makeHarness({
      quarantineConfigured: true,
      results: [result("o/r#main", "synced", { quarantinedCount: 2 })],
    });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes(warnText))).toBe(false);
    expect(infoLogs.some((l) => l.includes(warnText))).toBe(false);
  });

  it("stays silent on a clean run (no conflict) when the sink is unconfigured", async () => {
    const { commands, notices } = makeHarness({
      quarantineConfigured: false,
      results: [result("o/r#main", "synced", { pushedCount: 1 })],
    });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes(warnText))).toBe(false);
  });

  it("does NOT warn for deferred-only split runs (deferred is intentional, not a quarantined conflict)", async () => {
    const { commands, notices } = makeHarness({
      quarantineConfigured: false,
      results: [
        result("o/r#main", "synced", { deferredPaths: ["a.md", "b.md"] }),
      ],
    });

    await commands.invokePull();

    expect(notices.some((n) => n.includes(warnText))).toBe(false);
  });

  it("fires the warn at most once per session across multiple conflicted runs (one-shot)", async () => {
    const { commands, notices } = makeHarness({
      quarantineConfigured: false,
      results: [result("o/r#main", "synced", { quarantinedCount: 1 })],
    });

    await commands.invokeSync();
    await commands.invokeSync();

    expect(notices.filter((n) => n.includes(warnText))).toHaveLength(1);
  });

  it("does NOT warn on an auth-required run even if another repo quarantined (PAT prompt only)", async () => {
    const { commands, notices } = makeHarness({
      quarantineConfigured: false,
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { quarantinedCount: 1 }),
        result("o/b#main", "auth-required"),
      ],
    });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes(warnText))).toBe(false);
    expect(
      notices.some((n) => n.includes("expired, revoked or under-scoped")),
    ).toBe(true);
  });

  it("works without logInfo wired — warn still surfaces as a Notice (backward compat)", async () => {
    const notices: string[] = [];
    const commands = new SyncCommands({
      collectSpecs: async () => ({
        specs: [spec("o/r")],
        asUidByRepoKey: new Map(),
        warnings: [],
      }),
      buildEngine: async () => ({
        engine: {
          syncAll: async (specs: SyncRepoSpec[]) =>
            specs.map((s) => result(s.repoKey, "synced", { quarantinedCount: 1 })),
        } as unknown as SyncEngine,
        pat: "ghp_x",
        quarantineConfigured: false,
      }),
      isSwitchInProgress: () => false,
      notify: (m) => notices.push(m),
    });

    await expect(commands.invokeSync()).resolves.toBeUndefined();
    expect(notices.some((n) => n.includes(warnText))).toBe(true);
  });
});

describe("SyncCommands — #3496 step-by-step logging (info channel)", () => {
  it("emits a start line + per-repo outcome lines + the summary on the info channel", async () => {
    const { commands, infoLogs } = makeHarness({
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 2, pulledCount: 1 }),
        result("o/b#main", "synced", { mergedCount: 1, quarantinedCount: 1 }),
      ],
    });

    await commands.invokeSync();

    // Start line — repo count + direction.
    expect(
      infoLogs.some(
        (l) =>
          l.includes("[ExoSync] Sync started") &&
          l.includes("2 repo(s)") &&
          l.includes("direction=sync"),
      ),
    ).toBe(true);

    // Per-repo outcome lines — counts present.
    const a = infoLogs.find((l) => l.includes("o/a#main:"));
    expect(a).toContain("pushed 2");
    expect(a).toContain("pulled 1");
    const b = infoLogs.find((l) => l.includes("o/b#main:"));
    expect(b).toContain("merged 1");
    expect(b).toContain("quarantined 1");

    // #3489 summary preserved.
    expect(infoLogs.some((l) => l.includes("[ExoSync] Sync OK:"))).toBe(true);
  });

  it("per-repo step lines never become Notice toasts — only the summary toast", async () => {
    const { commands, notices } = makeHarness({
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 1 }),
        result("o/b#main", "synced", { pulledCount: 1 }),
      ],
    });

    await commands.invokeSync();

    expect(notices.filter((n) => n.startsWith("Sync done"))).toHaveLength(1);
    expect(
      notices.some((n) => n.includes("o/a#main:") || n.includes("o/b#main:")),
    ).toBe(false);
    // The start line is console-only too — never a toast.
    expect(notices.some((n) => n.includes("Sync started — "))).toBe(false);
  });

  it("emits start + per-repo lines even on the issues path (diagnostics matter most on failure)", async () => {
    const { commands, infoLogs } = makeHarness({
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 1 }),
        result("o/b#main", "error", { detail: "boom" }),
      ],
    });

    await commands.invokeSync();

    expect(infoLogs.some((l) => l.includes("[ExoSync] Sync started"))).toBe(true);
    expect(infoLogs.some((l) => l.includes("o/a#main:"))).toBe(true);
    expect(
      infoLogs.some((l) => l.includes("o/b#main:") && l.includes("error")),
    ).toBe(true);
  });

  it("uses the correct direction label for Pull and Push start lines", async () => {
    const pull = makeHarness({
      results: [result("o/r#main", "synced", { pulledCount: 3 })],
    });
    await pull.commands.invokePull();
    expect(
      pull.infoLogs.some(
        (l) => l.includes("[ExoSync] Pull started") && l.includes("direction=pull"),
      ),
    ).toBe(true);

    const push = makeHarness({
      results: [result("o/r#main", "synced", { pushedCount: 2 })],
    });
    await push.commands.invokePush();
    expect(
      push.infoLogs.some(
        (l) => l.includes("[ExoSync] Push started") && l.includes("direction=push"),
      ),
    ).toBe(true);
  });

  it("per-repo line surfaces deletions and deferred counts when present", async () => {
    const { commands, infoLogs } = makeHarness({
      results: [
        result("o/r#main", "synced", {
          pushedCount: 1,
          pushedDeletes: ["x.md"],
          deferredPaths: ["y.md"],
        }),
      ],
    });

    await commands.invokePull();

    const line = infoLogs.find((l) => l.includes("o/r#main:"));
    expect(line).toContain("deleted 1");
    expect(line).toContain("deferred 1");
  });
});

describe("SyncCommands — #3499 opt-in per-step Notice toggle", () => {
  it("toggle ON → notify fires for the start step line AND every per-repo step line", async () => {
    const { commands, notices, infoLogs } = makeHarness({
      stepNoticesEnabled: true,
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 2, pulledCount: 1 }),
        result("o/b#main", "synced", { mergedCount: 1, quarantinedCount: 1 }),
      ],
    });

    await commands.invokeSync();

    // Start step line surfaced as a toast (the "— " em-dash form is the
    // diagnostic step line, distinct from the friendly "started (N repo(s))…").
    expect(
      notices.some(
        (n) => n.includes("Sync started — ") && n.includes("direction=sync"),
      ),
    ).toBe(true);
    // Every per-repo outcome line surfaced as a toast.
    expect(notices.some((n) => n.includes("o/a#main:") && n.includes("pushed 2"))).toBe(
      true,
    );
    expect(notices.some((n) => n.includes("o/b#main:") && n.includes("merged 1"))).toBe(
      true,
    );
    // Console lines (#3496) still emitted in verbose mode (toast is in ADDITION).
    expect(infoLogs.some((l) => l.includes("[ExoSync] Sync started"))).toBe(true);
    expect(infoLogs.some((l) => l.includes("o/a#main:"))).toBe(true);
  });

  it("toggle OFF (default) → NO per-step toasts; behaviour unchanged (start+summary toasts only)", async () => {
    const { commands, notices, infoLogs } = makeHarness({
      // stepNoticesEnabled omitted → default off
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 1 }),
        result("o/b#main", "synced", { pulledCount: 1 }),
      ],
    });

    await commands.invokeSync();

    // No per-repo step toast.
    expect(
      notices.some((n) => n.includes("o/a#main:") || n.includes("o/b#main:")),
    ).toBe(false);
    // No diagnostic start step toast.
    expect(notices.some((n) => n.includes("Sync started — "))).toBe(false);
    // The friendly start toast + the single summary toast still fire (today's behaviour).
    expect(notices.some((n) => n.startsWith("Sync started ("))).toBe(true);
    expect(notices.filter((n) => n.startsWith("Sync done"))).toHaveLength(1);
    // Console step lines (#3496) unchanged — present regardless of toggle.
    expect(infoLogs.some((l) => l.includes("[ExoSync] Sync started"))).toBe(true);
    expect(infoLogs.some((l) => l.includes("o/a#main:"))).toBe(true);
  });

  it("toggle ON → exactly ONE summary toast (no double summary from step-notify)", async () => {
    const { commands, notices } = makeHarness({
      stepNoticesEnabled: true,
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 1, pulledCount: 2 }),
        result("o/b#main", "synced", { mergedCount: 1 }),
      ],
    });

    await commands.invokeSync();

    // The "Sync done" summary toast must appear exactly once even with verbose on.
    expect(notices.filter((n) => n.startsWith("Sync done"))).toHaveLength(1);
    // The #3489 summary info line ("Sync OK") must NOT be mirrored as a second toast.
    expect(notices.some((n) => n.includes("[ExoSync] Sync OK:"))).toBe(false);
  });

  it("toggle ON works for Pull and Push directions too", async () => {
    const pull = makeHarness({
      stepNoticesEnabled: true,
      results: [result("o/r#main", "synced", { pulledCount: 3 })],
    });
    await pull.commands.invokePull();
    expect(
      pull.notices.some(
        (n) => n.includes("Pull started — ") && n.includes("direction=pull"),
      ),
    ).toBe(true);
    expect(pull.notices.some((n) => n.includes("o/r#main:"))).toBe(true);

    const push = makeHarness({
      stepNoticesEnabled: true,
      results: [result("o/r#main", "synced", { pushedCount: 2 })],
    });
    await push.commands.invokePush();
    expect(
      push.notices.some(
        (n) => n.includes("Push started — ") && n.includes("direction=push"),
      ),
    ).toBe(true);
    expect(push.notices.some((n) => n.includes("o/r#main:"))).toBe(true);
  });

  it("toggle ON → step toasts still fire on the issues path (per-repo diagnostics matter most on failure)", async () => {
    const { commands, notices } = makeHarness({
      stepNoticesEnabled: true,
      specs: [spec("o/a"), spec("o/b")],
      results: [
        result("o/a#main", "synced", { pushedCount: 1 }),
        result("o/b#main", "error", { detail: "boom" }),
      ],
    });

    await commands.invokeSync();

    expect(notices.some((n) => n.includes("Sync started — "))).toBe(true);
    expect(notices.some((n) => n.includes("o/a#main:"))).toBe(true);
    expect(
      notices.some((n) => n.includes("o/b#main:") && n.includes("error")),
    ).toBe(true);
  });

  it("reads the toggle LIVE — flipping it between runs takes effect without reconstructing SyncCommands", async () => {
    // The dep is a callback (like isSwitchInProgress), so a mid-session
    // Settings toggle reaches the very next sync without a plugin reload.
    let enabled = false;
    const notices: string[] = [];
    const commands = new SyncCommands({
      collectSpecs: async () => ({
        specs: [spec("o/r")],
        asUidByRepoKey: new Map(),
        warnings: [],
      }),
      buildEngine: async () => ({
        engine: {
          syncAll: async (specs: SyncRepoSpec[]) =>
            specs.map((s) => result(s.repoKey, "synced", { pushedCount: 1 })),
        } as unknown as SyncEngine,
        pat: "ghp_x",
        quarantineConfigured: true,
      }),
      isSwitchInProgress: () => false,
      notify: (m) => notices.push(m),
      stepNoticesEnabled: () => enabled,
    });

    // First run while OFF → no per-repo step toast.
    await commands.invokeSync();
    expect(notices.some((n) => n.includes("o/r#main:"))).toBe(false);

    // User flips the setting ON; second run reflects it with no reconstruction.
    notices.length = 0;
    enabled = true;
    await commands.invokeSync();
    expect(notices.some((n) => n.includes("o/r#main:"))).toBe(true);
    expect(notices.some((n) => n.includes("Sync started — "))).toBe(true);
  });
});

describe("SyncCommands — #3498 in-flight progress + verbose file log", () => {
  it("threads an onProgress observer into engine.syncAll", async () => {
    const { commands, syncAll } = makeHarness();
    await commands.invokeSync();
    expect(syncAll).toHaveBeenCalledTimes(1);
    // 3rd arg is the in-flight progress callback.
    expect(typeof syncAll.mock.calls[0][2]).toBe("function");
  });

  it("renders in-flight phases to the info channel AND the verbose file sink", async () => {
    const { commands, infoLogs, verboseLogs } = makeHarness({
      progressEvents: [
        { repoKey: "o/r#main", phase: "detecting" },
        { repoKey: "o/r#main", phase: "pulling-remote" },
        { repoKey: "o/r#main", phase: "merging" },
      ],
    });

    await commands.invokeSync();

    const expectedLines = [
      "[ExoSync] o/r#main: detecting changes…",
      "[ExoSync] o/r#main: pulling remote tree…",
      "[ExoSync] o/r#main: merge layer firing…",
    ];
    for (const line of expectedLines) {
      expect(infoLogs).toContain(line); // info channel (console-only by default)
      expect(verboseLogs).toContain(line); // verbose file sink
    }
  });

  it("forwards the start + per-repo step lines to the verbose file sink", async () => {
    const { commands, verboseLogs } = makeHarness({
      results: [result("o/r#main", "synced", { pushedCount: 2 })],
    });

    await commands.invokeSync();

    expect(verboseLogs.some((l) => l.includes("[ExoSync] Sync started — "))).toBe(true);
    expect(verboseLogs.some((l) => l.includes("[ExoSync] o/r#main:"))).toBe(true);
  });

  it("in-flight progress lines are NOT surfaced as toasts even when step notices are on", async () => {
    const { commands, notices } = makeHarness({
      stepNoticesEnabled: true,
      progressEvents: [{ repoKey: "o/r#main", phase: "merging" }],
    });

    await commands.invokeSync();

    // #3499 toasts cover start + per-repo summary lines; the in-flight phase
    // firehose (3/repo) stays off the toast channel (#3498 info discipline).
    expect(notices.some((n) => n.includes("merge layer firing"))).toBe(false);
  });

  // ExoSync Phase 0 (measure-first) — per-phase timing surfaces.
  describe("Phase 0 timing breakdown surface", () => {
    it("appends the aggregate ⏱ breakdown to the summary toast (dominant phase visible)", async () => {
      const { commands, notices } = makeHarness({
        results: [
          result("o/r#main", "synced", { timings: timingsOf(150, 15) }),
        ],
      });

      await commands.invokeSync();

      const summary = notices.find((n) => n.includes("Sync done:"));
      expect(summary).toBeDefined();
      // The timing line rides the SAME summary toast as a 2nd line — preserves
      // the "no double summary" invariant (#3499).
      expect(summary).toContain("⏱ ExoSync");
      // hash (150ms) dominates the read (15ms) → it leads the breakdown.
      expect(summary).toContain("hash");
      expect(summary!.indexOf("hash")).toBeLessThan(
        summary!.indexOf("localRead"),
      );
    });

    it("emits a per-AS breakdown to the always-on activity-log channel (logInfo)", async () => {
      const { commands, infoLogs } = makeHarness({
        results: [
          result("o/r#main", "synced", { timings: timingsOf(150, 15) }),
          result("o/s#main", "synced", { timings: timingsOf(90, 9) }),
        ],
        specs: [spec("o/r"), spec("o/s")],
      });

      await commands.invokeSync();

      // Per-AS detail lands on logInfo (→ #3540 persistent activity log,
      // iPhone-readable in-app), one line per repo, never a toast firehose.
      const perRepo = infoLogs.filter((l) =>
        l.includes("[ExoSync timings]"),
      );
      expect(perRepo.length).toBe(2);
      expect(perRepo.some((l) => l.includes("o/r#main"))).toBe(true);
      expect(perRepo.some((l) => l.includes("o/s#main"))).toBe(true);
    });

    it("aggregates the per-AS breakdowns into one run total on the toast", async () => {
      const { commands, notices } = makeHarness({
        results: [
          result("o/r#main", "synced", { timings: timingsOf(100, 10) }),
          result("o/s#main", "synced", { timings: timingsOf(100, 10) }),
        ],
        specs: [spec("o/r"), spec("o/s")],
      });

      await commands.invokeSync();

      const summary = notices.find((n) => n.includes("Sync done:"));
      // 6 files hashed total across the 2 repos (3 each).
      expect(summary).toContain("6 hashed");
    });

    it("omits the timing line entirely when no AS reported any time", async () => {
      const { commands, notices } = makeHarness({
        results: [result("o/r#main", "synced")], // no timings (e.g. busy/skip)
      });

      await commands.invokeSync();

      const summary = notices.find((n) => n.includes("Sync done:"));
      expect(summary).toBeDefined();
      expect(summary).not.toContain("⏱");
    });
  });
});
