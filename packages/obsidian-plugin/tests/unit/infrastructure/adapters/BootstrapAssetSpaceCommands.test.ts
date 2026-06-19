import {
  BootstrapAssetSpaceCommands,
  type BootstrapAssetSpaceCommandsDeps,
  type BootstrapResultInfo,
  type IAssetSpacePuller,
  type IGitSubmoduleOps,
  type IFileOnlyAssetSpaceStore,
  type IRestBootstrapMount,
} from "../../../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";

const EXO_URL = "https://github.com/kitelev/exoas-exo";
const EXOCMD_URL = "https://github.com/kitelev/exoas-exocmd";
const PMBOK_URL = "https://github.com/kitelev/exoas-pmbok-ontology";

interface Harness {
  cmds: BootstrapAssetSpaceCommands;
  puller: jest.Mocked<IAssetSpacePuller>;
  gitOps: jest.Mocked<IGitSubmoduleOps>;
  localStore: jest.Mocked<IFileOnlyAssetSpaceStore>;
  notices: string[];
  vaultFiles: Set<string>;
  vaultFolders: Map<string, { files: string[]; folders: string[] }>;
  /**
   * Mirrors `data.local.json._activeStagingDirs`: `pullAssetSpace` pushes a
   * staging path (like `StagingDirTracker.allocate`) and `releaseStaging`
   * removes it (like `StagingDirTracker.release`). Issue #3391 asserts this is
   * empty after a successful materialise WITHOUT a reload.
   */
  activeStagingDirs: string[];
  /** Durable result panel emissions (RFC 0002 §3.3 / P5). */
  results: BootstrapResultInfo[];
  deps: BootstrapAssetSpaceCommandsDeps;
}

function makeHarness(opts: {
  gitmodulesEntries?: Array<{ submodulePath: string; url: string }>;
  materializedFolders?: Record<string, string[]>; // folder → files
  isGitVault?: boolean;
  bootstrapUrls?: { exoUrl: string } | null;
  addUrl?: { url: string } | null;
  confirm?: boolean;
} = {}): Harness {
  const notices: string[] = [];
  const gitmodulesEntries = opts.gitmodulesEntries ?? [];
  const materialized = opts.materializedFolders ?? {};

  // Mirror the real StagingDirTracker contract: allocate registers a staging
  // path, release removes it. The fake puller wires `pullAssetSpace` →
  // allocate and `releaseStaging` → release so we can assert no leak (#3391).
  const activeStagingDirs: string[] = [];
  const puller = {
    pullAssetSpace: jest.fn(
      async (asUid: string, _url: string, _ref?: string) => {
        const stagingPath = `/tmp/staging-${asUid}`;
        activeStagingDirs.push(stagingPath);
        return { asUid, stagingPath, sha: "abc1234" };
      },
    ),
    releaseStaging: jest.fn(async (stagingPath: string) => {
      const i = activeStagingDirs.indexOf(stagingPath);
      if (i !== -1) activeStagingDirs.splice(i, 1);
    }),
  } as jest.Mocked<IAssetSpacePuller>;

  const gitOps = {
    renameIntoVault: jest.fn(async () => undefined),
    readGitmodulesEntries: jest.fn(async () => [...gitmodulesEntries]),
    appendGitmodulesEntry: jest.fn(async () => ({ added: true })),
  } as jest.Mocked<IGitSubmoduleOps>;

  const localStore = {
    upsertFileOnlyAssetSpace: jest.fn(async () => undefined),
  } as jest.Mocked<IFileOnlyAssetSpaceStore>;

  // Vault probing fakes derived from `materialized`.
  const folderHasContent = Object.keys(materialized).length > 0;
  const vaultExists = jest.fn(async (p: string) => {
    if (p === "assetspaces") return folderHasContent;
    if (p === ".git") return opts.isGitVault ?? true;
    return false;
  });
  const listFolder = jest.fn(async (dir: string) => {
    if (dir === "assetspaces") {
      return {
        files: [],
        folders: Object.keys(materialized).map((f) => `assetspaces/${f}`),
      };
    }
    const ns = dir.replace(/^assetspaces\//, "");
    const files = (materialized[ns] ?? []).map((f) => `${dir}/${f}`);
    return { files, folders: [] };
  });

  const deriveFolderName = (url: string): string => {
    const m = url.match(/github\.com\/[^/]+\/([^/]+)$/);
    const repo = m ? m[1] : "unknown";
    return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
  };

  const results: BootstrapResultInfo[] = [];

  const deps: BootstrapAssetSpaceCommandsDeps = {
    getPuller: async () => puller,
    gitOps,
    localStore,
    vaultExists,
    listFolder,
    isGitVault: () => vaultExists(".git"),
    validateUrl: (url) => {
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(url)) {
        throw new Error(`invalid url: ${url}`);
      }
    },
    deriveFolderName,
    promptBootstrapUrls: jest.fn(async () =>
      opts.bootstrapUrls === undefined
        ? { exoUrl: EXO_URL }
        : opts.bootstrapUrls,
    ),
    promptAddAssetSpaceUrl: jest.fn(async () =>
      opts.addUrl === undefined ? { url: PMBOK_URL } : opts.addUrl,
    ),
    confirm: jest.fn(async () => opts.confirm ?? true),
    notify: (m: string) => notices.push(m),
    showResult: (r: BootstrapResultInfo) => results.push(r),
  };

  const vaultFolders = new Map<
    string,
    { files: string[]; folders: string[] }
  >();
  return {
    cmds: new BootstrapAssetSpaceCommands(deps),
    puller,
    gitOps,
    localStore,
    notices,
    vaultFiles: new Set<string>(),
    vaultFolders,
    activeStagingDirs,
    results,
    deps,
  };
}

describe("BootstrapAssetSpaceCommands.detectVaultState", () => {
  it("empty — no .gitmodules entries, no materialized folders", async () => {
    const h = makeHarness({ gitmodulesEntries: [], materializedFolders: {} });
    expect(await h.cmds.detectVaultState()).toBe("empty");
  });

  it("bootstrapped — assetspaces folder has .md content", async () => {
    const h = makeHarness({
      gitmodulesEntries: [],
      materializedFolders: { exo: ["73bd00e4.md"] },
    });
    expect(await h.cmds.detectVaultState()).toBe("bootstrapped");
  });

  it("clone-needs-fetch (EC2) — .gitmodules entries but folders empty", async () => {
    const h = makeHarness({
      gitmodulesEntries: [
        { submodulePath: "assetspaces/exo", url: EXO_URL },
        { submodulePath: "assetspaces/exocmd", url: EXOCMD_URL },
      ],
      materializedFolders: {},
    });
    expect(await h.cmds.detectVaultState()).toBe("clone-needs-fetch");
  });

  it("bootstrapped — folder content takes precedence over gitmodules", async () => {
    const h = makeHarness({
      gitmodulesEntries: [{ submodulePath: "assetspaces/exo", url: EXO_URL }],
      materializedFolders: { exo: ["a.md"] },
    });
    expect(await h.cmds.detectVaultState()).toBe("bootstrapped");
  });
});

describe("BootstrapAssetSpaceCommands.invokeBootstrap — empty vault (git)", () => {
  // Exo-only clean bootstrap (decision 2026-06-20): the modal no longer collects
  // an exocmd URL, and invokeBootstrap materialises ONLY exo. exocmd is added
  // later via «Add AssetSpace by URL» or transitively via a profile.
  //
  // Revert-verify: restoring the exocmd materialise branch (a second
  // `materialize(urls.exocmdUrl, …)` call) makes the `toHaveBeenCalledTimes(1)`
  // assertions FAIL (a second pull/rename/append fires).
  it("pulls exo only into the Maven folder and appends a single .gitmodules entry", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeBootstrap();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(1);
    expect(h.puller.pullAssetSpace).toHaveBeenNthCalledWith(
      1,
      "bootstrap-exoas-exo",
      EXO_URL,
      "main",
    );
    // RFC 5aa2a73a B4: floor mounts at the Maven path `assetspaces/<owner>/<repo>`.
    expect(h.gitOps.renameIntoVault).toHaveBeenCalledTimes(1);
    expect(h.gitOps.renameIntoVault).toHaveBeenNthCalledWith(
      1,
      "/tmp/staging-bootstrap-exoas-exo",
      "assetspaces/kitelev/exoas-exo",
    );
    expect(h.gitOps.appendGitmodulesEntry).toHaveBeenCalledTimes(1);
    expect(h.gitOps.appendGitmodulesEntry).toHaveBeenCalledWith(
      "assetspaces/kitelev/exoas-exo",
      EXO_URL,
    );
    // exocmd is NOT pulled during bootstrap.
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalledWith(
      "bootstrap-exoas-exocmd",
      EXOCMD_URL,
      "main",
    );
    expect(h.localStore.upsertFileOnlyAssetSpace).not.toHaveBeenCalled();
    expect(h.notices.some((n) => /Bootstrap complete/.test(n))).toBe(true);
  });
});

describe("BootstrapAssetSpaceCommands.invokeBootstrap — empty vault (file-only / non-git, AC10)", () => {
  it("materializes exo only without .gitmodules and tracks device-locally", async () => {
    const h = makeHarness({ isGitVault: false });
    await h.cmds.invokeBootstrap();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(1);
    expect(h.gitOps.renameIntoVault).toHaveBeenCalledTimes(1);
    expect(h.gitOps.appendGitmodulesEntry).not.toHaveBeenCalled();
    expect(h.localStore.upsertFileOnlyAssetSpace).toHaveBeenCalledTimes(1);
    expect(h.localStore.upsertFileOnlyAssetSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        folderName: "assetspaces/kitelev/exoas-exo",
        url: EXO_URL,
      }),
    );
    expect(h.notices.some((n) => /file-only mode/.test(n))).toBe(true);
  });
});

describe("BootstrapAssetSpaceCommands.invokeBootstrap — already bootstrapped", () => {
  it("is a no-op with an informative notice", async () => {
    const h = makeHarness({ materializedFolders: { exo: ["a.md"] } });
    await h.cmds.invokeBootstrap();
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalled();
    expect(h.gitOps.renameIntoVault).not.toHaveBeenCalled();
    expect(h.notices.some((n) => /already has AssetSpaces/.test(n))).toBe(true);
  });
});

describe("BootstrapAssetSpaceCommands.invokeBootstrap — EC2 clone-needs-fetch", () => {
  it("confirm=yes → re-materializes each tracked AssetSpace from .gitmodules URL", async () => {
    const h = makeHarness({
      gitmodulesEntries: [
        { submodulePath: "assetspaces/exo", url: EXO_URL },
        { submodulePath: "assetspaces/exocmd", url: EXOCMD_URL },
      ],
      materializedFolders: {},
      confirm: true,
    });
    await h.cmds.invokeBootstrap();

    expect(h.deps.promptBootstrapUrls).not.toHaveBeenCalled();
    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(2);
    expect(h.puller.pullAssetSpace).toHaveBeenCalledWith(
      "bootstrap-exo",
      EXO_URL,
      "main",
    );
    expect(h.gitOps.renameIntoVault).toHaveBeenCalledWith(
      "/tmp/staging-bootstrap-exocmd",
      "assetspaces/exocmd",
    );
    expect(h.notices.some((n) => /Fetched 2\/2/.test(n))).toBe(true);
  });

  it("confirm=no → does nothing", async () => {
    const h = makeHarness({
      gitmodulesEntries: [{ submodulePath: "assetspaces/exo", url: EXO_URL }],
      materializedFolders: {},
      confirm: false,
    });
    await h.cmds.invokeBootstrap();
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalled();
  });
});

describe("BootstrapAssetSpaceCommands.invokeBootstrap — guards", () => {
  it("user cancels the URL prompt → no pull", async () => {
    const h = makeHarness({ bootstrapUrls: null });
    await h.cmds.invokeBootstrap();
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalled();
  });

  it("invalid URL → notify, no pull", async () => {
    const h = makeHarness({
      bootstrapUrls: { exoUrl: "http://evil.example/x" },
    });
    await h.cmds.invokeBootstrap();
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalled();
    expect(h.notices.some((n) => /invalid URL/i.test(n))).toBe(true);
  });

  it("exo pull failure surfaces a notice and stops", async () => {
    const h = makeHarness({ isGitVault: true });
    h.puller.pullAssetSpace.mockRejectedValueOnce(new Error("network down"));
    await h.cmds.invokeBootstrap();
    expect(h.notices.some((n) => /Bootstrap failed.*network down/.test(n))).toBe(
      true,
    );
    // Exo-only: the single exo pull was attempted and failed — nothing else.
    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(1);
  });
});

describe("BootstrapAssetSpaceCommands — durable result panel (RFC 0002 §3.3 / P5)", () => {
  // The durable panel fires ON TOP of the toast — `notify` still carries the
  // message (asserted elsewhere); these assert the ADDITIONAL `showResult`
  // emission. Revert-verify: deleting each `this.emitResult(...)` call in
  // `BootstrapAssetSpaceCommands` makes the matching assertion below FAIL.
  it("cold bootstrap success → emits a `bootstrapped` result with folder + sha", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeBootstrap();
    expect(h.results).toEqual([
      {
        kind: "bootstrapped",
        folderName: "assetspaces/kitelev/exoas-exo",
        sha: "abc1234",
      },
    ]);
  });

  it("already-bootstrapped guard → emits an `already-bootstrapped` result", async () => {
    const h = makeHarness({ materializedFolders: { exo: ["a.md"] } });
    await h.cmds.invokeBootstrap();
    expect(h.results).toEqual([{ kind: "already-bootstrapped" }]);
  });

  it("EC2 fetch (>0 restored) → emits a `fetched` result with the count", async () => {
    const h = makeHarness({
      gitmodulesEntries: [
        { submodulePath: "assetspaces/exo", url: EXO_URL },
        { submodulePath: "assetspaces/exocmd", url: EXOCMD_URL },
      ],
      materializedFolders: {},
      confirm: true,
    });
    await h.cmds.invokeBootstrap();
    expect(h.results).toEqual([{ kind: "fetched", fetched: 2, total: 2 }]);
  });

  it("hard failure / cancel / invalid URL → NO durable result (toast only)", async () => {
    // Bootstrap pull failure.
    const fail = makeHarness({ isGitVault: true });
    fail.puller.pullAssetSpace.mockRejectedValueOnce(new Error("network down"));
    await fail.cmds.invokeBootstrap();
    expect(fail.results).toEqual([]);

    // User cancelled the URL prompt.
    const cancel = makeHarness({ bootstrapUrls: null });
    await cancel.cmds.invokeBootstrap();
    expect(cancel.results).toEqual([]);

    // Invalid URL.
    const invalid = makeHarness({
      bootstrapUrls: { exoUrl: "http://evil.example/x" },
    });
    await invalid.cmds.invokeBootstrap();
    expect(invalid.results).toEqual([]);
  });

  it("showResult absent → command still completes (best-effort, optional dep)", async () => {
    const h = makeHarness({ isGitVault: true });
    // Drop the optional dep entirely — mirrors a wiring that doesn't surface a panel.
    delete (h.deps as { showResult?: unknown }).showResult;
    const cmds = new BootstrapAssetSpaceCommands(h.deps);
    await expect(cmds.invokeBootstrap()).resolves.toBeUndefined();
    expect(h.notices.some((n) => /Bootstrap complete/.test(n))).toBe(true);
  });
});

describe("BootstrapAssetSpaceCommands.invokeAddAssetSpace", () => {
  // #3538: add-assetspace mounts at the canonical Maven path
  // `assetspaces/<owner>/<repo>` — parity with `invokeBootstrap` +
  // `apply-profile` (`derivePath`), NOT the old flat `assetspaces/<name>`
  // (`deriveFolderName`). `PMBOK_URL` (kitelev/exoas-pmbok-ontology) derives to
  // `assetspaces/kitelev/exoas-pmbok-ontology`; the staging label is keyed off
  // the path basename `exoas-pmbok-ontology`.
  it("pulls into the canonical Maven path and appends .gitmodules (git vault)", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeAddAssetSpace();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledWith(
      "bootstrap-exoas-pmbok-ontology",
      PMBOK_URL,
      "main",
    );
    expect(h.gitOps.renameIntoVault).toHaveBeenCalledWith(
      "/tmp/staging-bootstrap-exoas-pmbok-ontology",
      "assetspaces/kitelev/exoas-pmbok-ontology",
    );
    expect(h.gitOps.appendGitmodulesEntry).toHaveBeenCalledWith(
      "assetspaces/kitelev/exoas-pmbok-ontology",
      PMBOK_URL,
    );
    expect(h.notices.some((n) => /AssetSpace added/.test(n))).toBe(true);
  });

  // #3538 parity, explicit: a generic `<owner>/<repo>` (no `exoas-` prefix)
  // lands at `assetspaces/<owner>/<repo>` — proving the path is the canonical
  // derivePath output (full repo name, two segments), NOT the prefix-stripped
  // flat `deriveFolderName`. Revert-verify: restoring the old
  // `${ASSETSPACES_DIR}/${folderName}` materialise arg makes this FAIL (it would
  // mount at flat `assetspaces/widgets`).
  it("#3538 — generic owner/repo mounts at canonical assetspaces/<owner>/<repo> (parity with bootstrap)", async () => {
    const h = makeHarness({
      isGitVault: true,
      addUrl: { url: "https://github.com/acme/widgets" },
    });
    await h.cmds.invokeAddAssetSpace();

    expect(h.gitOps.renameIntoVault).toHaveBeenCalledWith(
      "/tmp/staging-bootstrap-widgets",
      "assetspaces/acme/widgets",
    );
    expect(h.gitOps.appendGitmodulesEntry).toHaveBeenCalledWith(
      "assetspaces/acme/widgets",
      "https://github.com/acme/widgets",
    );
  });

  it("file-only vault → tracks device-locally at the canonical path, no .gitmodules", async () => {
    const h = makeHarness({ isGitVault: false });
    await h.cmds.invokeAddAssetSpace();
    expect(h.gitOps.appendGitmodulesEntry).not.toHaveBeenCalled();
    expect(h.localStore.upsertFileOnlyAssetSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        folderName: "assetspaces/kitelev/exoas-pmbok-ontology",
      }),
    );
  });

  it("cancel → no pull", async () => {
    const h = makeHarness({ addUrl: null });
    await h.cmds.invokeAddAssetSpace();
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalled();
  });

  it("invalid URL → notify, no pull", async () => {
    const h = makeHarness({ addUrl: { url: "https://gitlab.com/a/b" } });
    await h.cmds.invokeAddAssetSpace();
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalled();
    expect(h.notices.some((n) => /invalid URL/i.test(n))).toBe(true);
  });

  // RFC 0002 §3.1 step 2 — the onboarding panel calls
  // invokeAddAssetSpace(prefillUrl) so the modal opens with the recommended
  // `exoas-starter-registry` URL pre-filled. The prefill must reach the prompt.
  it("forwards prefillUrl to the prompt (onboarding §3.1 step 2)", async () => {
    const REGISTRY = "https://github.com/kitelev/exoas-starter-registry";
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeAddAssetSpace(REGISTRY);
    expect(h.deps.promptAddAssetSpaceUrl).toHaveBeenCalledWith(REGISTRY);
  });

  it("no prefill → prompt called with undefined (unchanged palette path)", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeAddAssetSpace();
    expect(h.deps.promptAddAssetSpaceUrl).toHaveBeenCalledWith(undefined);
  });
});

describe("BootstrapAssetSpaceCommands — lazy per-invocation puller (Issue #3382)", () => {
  /**
   * The provider mirrors production wiring: it reads `currentPat` at the
   * moment it is invoked and bakes that value into the puller it returns. A
   * fixed-`puller` (pre-fix) design would have frozen the empty onload PAT;
   * the fix calls `getPuller()` at command-execution time, so the PAT the user
   * set AFTER construction is the one the pull observes.
   *
   * Revert-verify: pointing `materialize` at a puller captured in the deps
   * (the old `puller` field, resolved once at construction with `currentPat`
   * still "") makes both assertions below FAIL — the recorded PAT stays "".
   */
  function makeLazyHarness() {
    const pullCalls: Array<{ patAtBuild: string; url: string }> = [];
    let currentPat = ""; // empty at "onload"
    const getPuller = jest.fn(async (): Promise<IAssetSpacePuller> => {
      const patAtBuild = currentPat;
      return {
        pullAssetSpace: jest.fn(
          async (asUid: string, url: string, _ref?: string) => {
            pullCalls.push({ patAtBuild, url });
            return { asUid, stagingPath: `/tmp/staging-${asUid}`, sha: "abc1234" };
          },
        ),
        releaseStaging: jest.fn(async () => undefined),
      };
    });

    const deps: BootstrapAssetSpaceCommandsDeps = {
      getPuller,
      gitOps: {
        renameIntoVault: jest.fn(async () => undefined),
        readGitmodulesEntries: jest.fn(async () => []),
        appendGitmodulesEntry: jest.fn(async () => ({ added: true })),
      },
      localStore: { upsertFileOnlyAssetSpace: jest.fn(async () => undefined) },
      vaultExists: jest.fn(async (p: string) => p === ".git"),
      listFolder: jest.fn(async () => ({ files: [], folders: [] })),
      isGitVault: async () => true,
      validateUrl: () => undefined,
      deriveFolderName: () => "pmbok-ontology",
      promptBootstrapUrls: jest.fn(async () => null),
      promptAddAssetSpaceUrl: jest.fn(async () => ({
        url: "https://github.com/kitelev/exoas-pmbok-ontology",
      })),
      confirm: jest.fn(async () => true),
      notify: jest.fn(),
    };

    return {
      cmds: new BootstrapAssetSpaceCommands(deps),
      getPuller,
      pullCalls,
      setPat: (pat: string) => {
        currentPat = pat;
      },
    };
  }

  it("resolves the puller at invocation, using a PAT set AFTER construction", async () => {
    const h = makeLazyHarness();
    // Plugin onload already happened (cmds constructed) with NO PAT.
    // User configures the PAT afterwards, without reloading:
    h.setPat("github_pat_AFTERONLOAD");

    await h.cmds.invokeAddAssetSpace();

    // Provider was invoked at command time (not frozen at construction)…
    expect(h.getPuller).toHaveBeenCalledTimes(1);
    // …and the pull observed the CURRENT PAT, not the empty onload value.
    expect(h.pullCalls).toHaveLength(1);
    expect(h.pullCalls[0].patAtBuild).toBe("github_pat_AFTERONLOAD");
  });

  it("does NOT resolve the puller until a command runs (no eager onload build)", () => {
    const h = makeLazyHarness();
    // Merely constructing the commands must not read the PAT / build a client.
    expect(h.getPuller).not.toHaveBeenCalled();
  });
});

describe("BootstrapAssetSpaceCommands — staging-dir release (Issue #3391)", () => {
  /**
   * `pullAssetSpace` registers the staging dir (mirrors
   * `StagingDirTracker.allocate` → `_activeStagingDirs`); `materialize` must
   * call `releaseStaging` after the move so the entry does not linger until the
   * next plugin reload.
   *
   * Revert-verify: deleting the `await puller.releaseStaging(...)` line in
   * `BootstrapAssetSpaceCommands.materialize` makes every assertion below FAIL
   * (`activeStagingDirs` keeps the 1–2 entries the pulls registered);
   * restoring it makes them PASS.
   */
  it("bootstrap (git) — releases the exo staging dir, no leftover entry", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeBootstrap();

    // Exo-only: a single pull + a single release after the move into the vault.
    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(1);
    expect(h.puller.releaseStaging).toHaveBeenCalledTimes(1);
    expect(h.puller.releaseStaging).toHaveBeenCalledWith(
      "/tmp/staging-bootstrap-exoas-exo",
    );
    // The tracker registry is empty post-success — no reload needed.
    expect(h.activeStagingDirs).toEqual([]);
  });

  it("bootstrap (file-only / non-git) — releases the exo staging dir too", async () => {
    const h = makeHarness({ isGitVault: false });
    await h.cmds.invokeBootstrap();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(1);
    expect(h.puller.releaseStaging).toHaveBeenCalledTimes(1);
    expect(h.activeStagingDirs).toEqual([]);
  });

  it("addAssetSpace — releases the single staging dir, no leftover entry", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeAddAssetSpace();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(1);
    expect(h.puller.releaseStaging).toHaveBeenCalledTimes(1);
    // #3538: staging path keyed off the canonical Maven path basename.
    expect(h.puller.releaseStaging).toHaveBeenCalledWith(
      "/tmp/staging-bootstrap-exoas-pmbok-ontology",
    );
    expect(h.activeStagingDirs).toEqual([]);
  });

  it("EC2 fetchTrackedAssetSpaces — releases each re-materialised staging dir", async () => {
    const h = makeHarness({
      gitmodulesEntries: [
        { submodulePath: "assetspaces/exo", url: EXO_URL },
        { submodulePath: "assetspaces/exocmd", url: EXOCMD_URL },
      ],
      materializedFolders: {},
      confirm: true,
    });
    await h.cmds.invokeBootstrap();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(2);
    expect(h.puller.releaseStaging).toHaveBeenCalledTimes(2);
    expect(h.activeStagingDirs).toEqual([]);
    expect(h.notices.some((n) => /Fetched 2\/2/.test(n))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Mobile (#3535) — the cross-platform `restMount` strategy. Constructed with
// ONLY `restMount` (no getPuller / gitOps / localStore — those throw on mobile,
// where there is no Node fs). This whole describe block is the revert-verify
// anchor for the BootstrapAssetSpaceCommands mobile branch: remove the
// `restMount` branch in `materialize` / `listTrackedEntries` and every test
// here FAILS (the class falls through to the missing desktop deps and throws).
// ─────────────────────────────────────────────────────────────────────────

interface MobileHarness {
  cmds: BootstrapAssetSpaceCommands;
  restMount: jest.Mocked<IRestBootstrapMount>;
  notices: string[];
}

function makeMobileHarness(opts: {
  gitmodulesEntries?: Array<{ submodulePath: string; url: string }>;
  materializedFolders?: Record<string, string[]>;
  bootstrapUrls?: { exoUrl: string } | null;
  addUrl?: { url: string } | null;
  confirm?: boolean;
} = {}): MobileHarness {
  const notices: string[] = [];
  const gitmodulesEntries = opts.gitmodulesEntries ?? [];
  const materialized = opts.materializedFolders ?? {};

  // Mobile materialise strategy — one combined op returning the sha (mirrors
  // RestAssetSpaceMount.mount), plus the vault.adapter-backed .gitmodules read.
  const restMount = {
    mount: jest.fn(
      async (_gitUrl: string, _submodulePath: string, _ref: string) => ({
        sha: "deadbee",
      }),
    ),
    readGitmodulesEntries: jest.fn(async () => [...gitmodulesEntries]),
  } as jest.Mocked<IRestBootstrapMount>;

  const folderHasContent = Object.keys(materialized).length > 0;
  // Fresh mobile vault: NO `.git` (isGitVault → false) but restMount is wired.
  const vaultExists = jest.fn(async (p: string) => {
    if (p === "assetspaces") return folderHasContent;
    if (p === ".git") return false;
    return false;
  });
  const listFolder = jest.fn(async (dir: string) => {
    if (dir === "assetspaces") {
      return {
        files: [],
        folders: Object.keys(materialized).map((f) => `assetspaces/${f}`),
      };
    }
    const ns = dir.replace(/^assetspaces\//, "");
    const files = (materialized[ns] ?? []).map((f) => `${dir}/${f}`);
    return { files, folders: [] };
  });

  const deriveFolderName = (url: string): string => {
    const m = url.match(/github\.com\/[^/]+\/([^/]+)$/);
    const repo = m ? m[1] : "unknown";
    return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
  };

  const deps: BootstrapAssetSpaceCommandsDeps = {
    // Desktop trio deliberately OMITTED — only restMount is wired (mobile).
    restMount,
    vaultExists,
    listFolder,
    isGitVault: () => vaultExists(".git"),
    validateUrl: (url) => {
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(url)) {
        throw new Error(`invalid url: ${url}`);
      }
    },
    deriveFolderName,
    promptBootstrapUrls: jest.fn(async () =>
      opts.bootstrapUrls === undefined
        ? { exoUrl: EXO_URL }
        : opts.bootstrapUrls,
    ),
    promptAddAssetSpaceUrl: jest.fn(async () =>
      opts.addUrl === undefined ? { url: PMBOK_URL } : opts.addUrl,
    ),
    confirm: jest.fn(async () => opts.confirm ?? true),
    notify: (m: string) => notices.push(m),
  };

  return { cmds: new BootstrapAssetSpaceCommands(deps), restMount, notices };
}

describe("BootstrapAssetSpaceCommands — mobile restMount strategy (#3535)", () => {
  it("empty vault → bootstrap materialises exo only via restMount.mount (Maven path), writes .gitmodules, no Node-fs deps", async () => {
    const h = makeMobileHarness();
    await h.cmds.invokeBootstrap();

    // detectVaultState read .gitmodules via the mobile vault.adapter path.
    expect(h.restMount.readGitmodulesEntries).toHaveBeenCalled();
    // Exo-only clean bootstrap (2026-06-20): a single combined cross-platform op
    // for exo, at the Maven path. exocmd is added later (Add AssetSpace / profile).
    expect(h.restMount.mount).toHaveBeenCalledTimes(1);
    expect(h.restMount.mount).toHaveBeenNthCalledWith(
      1,
      EXO_URL,
      "assetspaces/kitelev/exoas-exo",
      "main",
    );
    expect(h.restMount.mount).not.toHaveBeenCalledWith(
      EXOCMD_URL,
      "assetspaces/kitelev/exoas-exocmd",
      "main",
    );
    expect(h.notices.some((n) => /Bootstrap complete/.test(n))).toBe(true);
    // The misleading desktop "file-only mode" notice MUST NOT fire on mobile,
    // even though there is no `.git` — restMount writes .gitmodules regardless.
    expect(h.notices.some((n) => /file-only mode/.test(n))).toBe(false);
  });

  it("addAssetSpace → mounts the single URL-derived AssetSpace at the canonical Maven path via restMount.mount (#3538)", async () => {
    const h = makeMobileHarness();
    await h.cmds.invokeAddAssetSpace();

    expect(h.restMount.mount).toHaveBeenCalledTimes(1);
    // #3538: mobile add-assetspace mounts at `assetspaces/<owner>/<repo>` (the
    // same canonical path apply-profile reads), NOT the old flat path.
    expect(h.restMount.mount).toHaveBeenNthCalledWith(
      1,
      PMBOK_URL,
      "assetspaces/kitelev/exoas-pmbok-ontology",
      "main",
    );
    expect(h.notices.some((n) => /AssetSpace added/.test(n))).toBe(true);
    expect(h.notices.some((n) => /file-only mode/.test(n))).toBe(false);
  });

  it("#3538 — mobile add-assetspace of a generic owner/repo mounts at canonical assetspaces/<owner>/<repo>", async () => {
    const h = makeMobileHarness({
      addUrl: { url: "https://github.com/acme/widgets" },
    });
    await h.cmds.invokeAddAssetSpace();

    expect(h.restMount.mount).toHaveBeenNthCalledWith(
      1,
      "https://github.com/acme/widgets",
      "assetspaces/acme/widgets",
      "main",
    );
  });

  it("already-bootstrapped vault → no mount (use Add AssetSpace)", async () => {
    const h = makeMobileHarness({
      materializedFolders: { "kitelev/exoas-exo": ["asset.md"] },
    });
    await h.cmds.invokeBootstrap();

    expect(h.restMount.mount).not.toHaveBeenCalled();
    expect(h.notices.some((n) => /already has AssetSpaces/.test(n))).toBe(true);
  });

  it("EC2 clone-needs-fetch → re-materialises each tracked entry via restMount.mount", async () => {
    const h = makeMobileHarness({
      gitmodulesEntries: [
        { submodulePath: "assetspaces/kitelev/exoas-exo", url: EXO_URL },
        { submodulePath: "assetspaces/kitelev/exoas-exocmd", url: EXOCMD_URL },
      ],
      materializedFolders: {},
      confirm: true,
    });
    await h.cmds.invokeBootstrap();

    expect(h.restMount.mount).toHaveBeenCalledTimes(2);
    expect(h.restMount.mount).toHaveBeenCalledWith(
      EXO_URL,
      "assetspaces/kitelev/exoas-exo",
      "main",
    );
    expect(h.restMount.mount).toHaveBeenCalledWith(
      EXOCMD_URL,
      "assetspaces/kitelev/exoas-exocmd",
      "main",
    );
    expect(h.notices.some((n) => /Fetched 2\/2/.test(n))).toBe(true);
  });

  it("detectVaultState classifies via restMount.readGitmodulesEntries (no gitOps)", async () => {
    const h = makeMobileHarness({
      gitmodulesEntries: [
        { submodulePath: "assetspaces/kitelev/exoas-exo", url: EXO_URL },
      ],
      materializedFolders: { "kitelev/exoas-exo": ["a.md"] },
    });
    const state = await h.cmds.detectVaultState();
    expect(state).toBe("bootstrapped");
    expect(h.restMount.readGitmodulesEntries).toHaveBeenCalled();
  });
});
