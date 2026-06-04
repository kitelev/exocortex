import {
  BootstrapAssetSpaceCommands,
  type BootstrapAssetSpaceCommandsDeps,
  type IAssetSpacePuller,
  type IGitSubmoduleOps,
  type IFileOnlyAssetSpaceStore,
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
  deps: BootstrapAssetSpaceCommandsDeps;
}

function makeHarness(opts: {
  gitmodulesEntries?: Array<{ submodulePath: string; url: string }>;
  materializedFolders?: Record<string, string[]>; // folder → files
  isGitVault?: boolean;
  bootstrapUrls?: { exoUrl: string; exocmdUrl: string } | null;
  addUrl?: { url: string } | null;
  confirm?: boolean;
} = {}): Harness {
  const notices: string[] = [];
  const gitmodulesEntries = opts.gitmodulesEntries ?? [];
  const materialized = opts.materializedFolders ?? {};

  const puller = {
    pullAssetSpace: jest.fn(
      async (asUid: string, _url: string, _ref?: string) => ({
        asUid,
        stagingPath: `/tmp/staging-${asUid}`,
        sha: "abc1234",
      }),
    ),
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

  const deps: BootstrapAssetSpaceCommandsDeps = {
    puller,
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
        ? { exoUrl: EXO_URL, exocmdUrl: EXOCMD_URL }
        : opts.bootstrapUrls,
    ),
    promptAddAssetSpaceUrl: jest.fn(async () =>
      opts.addUrl === undefined ? { url: PMBOK_URL } : opts.addUrl,
    ),
    confirm: jest.fn(async () => opts.confirm ?? true),
    notify: (m: string) => notices.push(m),
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
  it("pulls exo + exocmd into fixed folders and appends .gitmodules", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeBootstrap();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(2);
    expect(h.puller.pullAssetSpace).toHaveBeenNthCalledWith(
      1,
      "bootstrap-exo",
      EXO_URL,
      "main",
    );
    expect(h.puller.pullAssetSpace).toHaveBeenNthCalledWith(
      2,
      "bootstrap-exocmd",
      EXOCMD_URL,
      "main",
    );
    expect(h.gitOps.renameIntoVault).toHaveBeenNthCalledWith(
      1,
      "/tmp/staging-bootstrap-exo",
      "assetspaces/exo",
    );
    expect(h.gitOps.renameIntoVault).toHaveBeenNthCalledWith(
      2,
      "/tmp/staging-bootstrap-exocmd",
      "assetspaces/exocmd",
    );
    expect(h.gitOps.appendGitmodulesEntry).toHaveBeenCalledWith(
      "assetspaces/exo",
      EXO_URL,
    );
    expect(h.gitOps.appendGitmodulesEntry).toHaveBeenCalledWith(
      "assetspaces/exocmd",
      EXOCMD_URL,
    );
    expect(h.localStore.upsertFileOnlyAssetSpace).not.toHaveBeenCalled();
    expect(h.notices.some((n) => /Bootstrap complete/.test(n))).toBe(true);
  });
});

describe("BootstrapAssetSpaceCommands.invokeBootstrap — empty vault (file-only / non-git, AC10)", () => {
  it("materializes without .gitmodules and tracks device-locally", async () => {
    const h = makeHarness({ isGitVault: false });
    await h.cmds.invokeBootstrap();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(2);
    expect(h.gitOps.renameIntoVault).toHaveBeenCalledTimes(2);
    expect(h.gitOps.appendGitmodulesEntry).not.toHaveBeenCalled();
    expect(h.localStore.upsertFileOnlyAssetSpace).toHaveBeenCalledTimes(2);
    expect(h.localStore.upsertFileOnlyAssetSpace).toHaveBeenCalledWith(
      expect.objectContaining({ folderName: "assetspaces/exo", url: EXO_URL }),
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
      bootstrapUrls: { exoUrl: "http://evil.example/x", exocmdUrl: EXOCMD_URL },
    });
    await h.cmds.invokeBootstrap();
    expect(h.puller.pullAssetSpace).not.toHaveBeenCalled();
    expect(h.notices.some((n) => /invalid URL/i.test(n))).toBe(true);
  });

  it("pull failure surfaces a notice and stops", async () => {
    const h = makeHarness({ isGitVault: true });
    h.puller.pullAssetSpace.mockRejectedValueOnce(new Error("network down"));
    await h.cmds.invokeBootstrap();
    expect(h.notices.some((n) => /Bootstrap failed.*network down/.test(n))).toBe(
      true,
    );
    // exocmd pull never attempted after exo failed
    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(1);
  });

  it("partial failure (exo ok, exocmd fails) → actionable recovery notice", async () => {
    const h = makeHarness({ isGitVault: true });
    h.puller.pullAssetSpace
      .mockResolvedValueOnce({
        asUid: "bootstrap-exo",
        stagingPath: "/tmp/staging-bootstrap-exo",
        sha: "abc1234",
      })
      .mockRejectedValueOnce(new Error("exocmd boom"));
    await h.cmds.invokeBootstrap();
    expect(h.puller.pullAssetSpace).toHaveBeenCalledTimes(2);
    // exo materialised, exocmd did not
    expect(h.gitOps.renameIntoVault).toHaveBeenCalledTimes(1);
    expect(
      h.notices.some(
        (n) => /partially completed/i.test(n) && /Add assetspace by URL/i.test(n),
      ),
    ).toBe(true);
  });
});

describe("BootstrapAssetSpaceCommands.invokeAddAssetSpace", () => {
  it("pulls into URL-derived folder and appends .gitmodules (git vault)", async () => {
    const h = makeHarness({ isGitVault: true });
    await h.cmds.invokeAddAssetSpace();

    expect(h.puller.pullAssetSpace).toHaveBeenCalledWith(
      "bootstrap-pmbok-ontology",
      PMBOK_URL,
      "main",
    );
    expect(h.gitOps.renameIntoVault).toHaveBeenCalledWith(
      "/tmp/staging-bootstrap-pmbok-ontology",
      "assetspaces/pmbok-ontology",
    );
    expect(h.gitOps.appendGitmodulesEntry).toHaveBeenCalledWith(
      "assetspaces/pmbok-ontology",
      PMBOK_URL,
    );
    expect(h.notices.some((n) => /AssetSpace added/.test(n))).toBe(true);
  });

  it("file-only vault → tracks device-locally, no .gitmodules", async () => {
    const h = makeHarness({ isGitVault: false });
    await h.cmds.invokeAddAssetSpace();
    expect(h.gitOps.appendGitmodulesEntry).not.toHaveBeenCalled();
    expect(h.localStore.upsertFileOnlyAssetSpace).toHaveBeenCalledWith(
      expect.objectContaining({ folderName: "assetspaces/pmbok-ontology" }),
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
});
