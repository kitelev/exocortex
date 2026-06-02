import type { App, TFile } from "obsidian";
import type { INotificationService } from "exocortex";

import {
  AssetSpaceManager,
  ASSET_SPACE_CLASS_UID,
  parseGitHubURL,
} from "../../src/infrastructure/adapters/AssetSpaceManager";

// ─── Fake GitHubRestClient ──────────────────────────────────────────────
// Per advisor — inject via constructor, NOT jest.mock module-level. This
// keeps full control over call-arg verification.

interface FakeGitHubClient {
  ensureRateLimit: jest.Mock<Promise<void>, [number]>;
  createCommit: jest.Mock<Promise<string>, [string, string, string, Map<string, string>, string]>;
}

function makeFakeClient(overrides: Partial<FakeGitHubClient> = {}): FakeGitHubClient {
  return {
    ensureRateLimit: jest.fn().mockResolvedValue(undefined),
    createCommit: jest.fn().mockResolvedValue("a".repeat(40)),
    ...overrides,
  };
}

// ─── Fake INotificationService ──────────────────────────────────────────

interface FakeNotifier extends INotificationService {
  infoCalls: string[];
  successCalls: string[];
  errorCalls: string[];
  warnCalls: string[];
}

function makeFakeNotifier(): FakeNotifier {
  const infoCalls: string[] = [];
  const successCalls: string[] = [];
  const errorCalls: string[] = [];
  const warnCalls: string[] = [];
  return {
    infoCalls,
    successCalls,
    errorCalls,
    warnCalls,
    info: (m: string) => {
      infoCalls.push(m);
    },
    success: (m: string) => {
      successCalls.push(m);
    },
    error: (m: string) => {
      errorCalls.push(m);
    },
    warn: (m: string) => {
      warnCalls.push(m);
    },
    confirm: async () => true,
  };
}

// ─── Fake App / vault / metadataCache / fileManager ─────────────────────
// Per test-fixture-realism — mirror real Obsidian semantics:
//   - getFileCache returns null when the file isn't seeded
//   - vault.adapter.read rejects unknown paths
//   - processFrontMatter mutates the seeded frontmatter and we observe

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
  content?: string;
}

interface FakeApp {
  app: App;
  files: Map<string, SeedFile>;
  processedFrontmatter: Map<string, Record<string, unknown>>;
}

function makeFakeApp(seeds: SeedFile[]): FakeApp {
  const files = new Map<string, SeedFile>();
  const processedFrontmatter = new Map<string, Record<string, unknown>>();
  for (const s of seeds) files.set(s.path, s);

  const tfileFor = (path: string): TFile => {
    return { path } as unknown as TFile;
  };

  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(files.keys()).map(tfileFor),
      adapter: {
        read: async (path: string) => {
          const f = files.get(path);
          if (!f) throw new Error(`fake vault.adapter.read: not found: ${path}`);
          if (typeof f.content !== "string") {
            throw new Error(`fake vault.adapter.read: no content seeded for ${path}`);
          }
          return f.content;
        },
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const seed = files.get(file.path);
        if (!seed) return null;
        return { frontmatter: seed.frontmatter };
      },
    },
    fileManager: {
      processFrontMatter: async (
        file: TFile,
        fn: (fm: Record<string, unknown>) => void,
      ) => {
        const seed = files.get(file.path);
        if (!seed) {
          throw new Error(`fake processFrontMatter: not found: ${file.path}`);
        }
        // Mirror Obsidian: pass a mutable handle. Apply mutations directly
        // to the seed so subsequent reads observe them.
        fn(seed.frontmatter);
        processedFrontmatter.set(file.path, { ...seed.frontmatter });
      },
    },
  } as unknown as App;

  return {
    app,
    files,
    processedFrontmatter,
  };
}

// ─── Test helpers ────────────────────────────────────────────────────────

interface Harness {
  fake: FakeApp;
  client: FakeGitHubClient;
  notifier: FakeNotifier;
  mgr: AssetSpaceManager;
}

function makeHarness(
  seeds: SeedFile[],
  opts: {
    clientOverrides?: Partial<FakeGitHubClient>;
    branch?: string;
  } = {},
): Harness {
  const fake = makeFakeApp(seeds);
  const client = makeFakeClient(opts.clientOverrides);
  const notifier = makeFakeNotifier();
  const mgr = new AssetSpaceManager({
    app: fake.app,
    client: client as never,
    notifications: notifier,
    branch: opts.branch,
  });
  return { fake, client, notifier, mgr };
}

// ─── AssetSpace fixture frontmatter ──────────────────────────────────────

function assetSpaceFrontmatter(opts: {
  uid: string;
  git: string;
  namespace: string;
  lastPulledSha?: string;
}): Record<string, unknown> {
  return {
    "exo__Asset_uid": opts.uid,
    "exo__Asset_label": `kitelev/exoas-${opts.namespace}`,
    "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    "exo__AssetSpace_git": opts.git,
    "exo__AssetSpace_namespace": opts.namespace,
    ...(opts.lastPulledSha
      ? { "exo__AssetSpace_lastPulledSha": opts.lastPulledSha }
      : {}),
  };
}

const EMS_UID = "f0f674da-a31b-47e1-b0e8-f984b018bf75";

function seedSingleAssetSpace(
  opts: { withSha?: string } = {},
): SeedFile[] {
  return [
    {
      path: "assetspaces/ems/f0f674da.md",
      frontmatter: assetSpaceFrontmatter({
        uid: EMS_UID,
        git: "https://github.com/kitelev/exoas-ems",
        namespace: "ems",
        lastPulledSha: opts.withSha,
      }),
    },
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("AssetSpaceManager", () => {
  // --- constructor ------------------------------------------------------
  describe("constructor", () => {
    it("requires app", () => {
      expect(
        () =>
          new AssetSpaceManager({
            app: undefined as unknown as App,
            client: makeFakeClient() as never,
            notifications: makeFakeNotifier(),
          }),
      ).toThrow(/app is required/);
    });

    it("requires client", () => {
      const fake = makeFakeApp([]);
      expect(
        () =>
          new AssetSpaceManager({
            app: fake.app,
            client: undefined as never,
            notifications: makeFakeNotifier(),
          }),
      ).toThrow(/client is required/);
    });

    it("requires notifications", () => {
      const fake = makeFakeApp([]);
      expect(
        () =>
          new AssetSpaceManager({
            app: fake.app,
            client: makeFakeClient() as never,
            notifications: undefined as unknown as INotificationService,
          }),
      ).toThrow(/notifications is required/);
    });

    it("defaults branch to 'main'", async () => {
      const h = makeHarness([
        ...seedSingleAssetSpace(),
        {
          path: "assetspaces/ems/changed.md",
          frontmatter: {},
          content: "x",
        },
      ]);
      h.mgr.markDirty("assetspaces/ems/changed.md");
      await h.mgr.pushAssetSpace(EMS_UID);
      expect(h.client.createCommit).toHaveBeenCalledWith(
        "kitelev",
        "exoas-ems",
        "main",
        expect.any(Map),
        expect.any(String),
      );
    });

    it("accepts custom branch", async () => {
      const h = makeHarness(
        [
          ...seedSingleAssetSpace(),
          {
            path: "assetspaces/ems/changed.md",
            frontmatter: {},
            content: "x",
          },
        ],
        { branch: "develop" },
      );
      h.mgr.markDirty("assetspaces/ems/changed.md");
      await h.mgr.pushAssetSpace(EMS_UID);
      expect(h.client.createCommit).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "develop",
        expect.any(Map),
        expect.any(String),
      );
    });
  });

  // --- markDirty --------------------------------------------------------
  describe("markDirty", () => {
    it("adds path to dirty set", () => {
      const h = makeHarness([]);
      h.mgr.markDirty("foo/bar.md");
      expect(h.mgr.getDirtySnapshot().has("foo/bar.md")).toBe(true);
    });

    it("is idempotent — duplicate add stays single entry", () => {
      const h = makeHarness([]);
      h.mgr.markDirty("foo.md");
      h.mgr.markDirty("foo.md");
      expect(h.mgr.getDirtySnapshot().size).toBe(1);
    });

    it("ignores empty / non-string paths", () => {
      const h = makeHarness([]);
      h.mgr.markDirty("");
      h.mgr.markDirty(undefined as unknown as string);
      h.mgr.markDirty(null as unknown as string);
      expect(h.mgr.getDirtySnapshot().size).toBe(0);
    });
  });

  // --- lookupAssetSpaceForPath -----------------------------------------
  describe("lookupAssetSpaceForPath", () => {
    it("returns AssetSpace UID for owned folder", () => {
      const h = makeHarness(seedSingleAssetSpace());
      expect(h.mgr.lookupAssetSpaceForPath("assetspaces/ems")).toBe(EMS_UID);
    });

    it("handles trailing slash", () => {
      const h = makeHarness(seedSingleAssetSpace());
      expect(h.mgr.lookupAssetSpaceForPath("assetspaces/ems/")).toBe(EMS_UID);
    });

    it("returns null for unknown folder", () => {
      const h = makeHarness(seedSingleAssetSpace());
      expect(h.mgr.lookupAssetSpaceForPath("assetspaces/nonexistent")).toBeNull();
    });

    it("returns null for empty input", () => {
      const h = makeHarness(seedSingleAssetSpace());
      expect(h.mgr.lookupAssetSpaceForPath("")).toBeNull();
      expect(h.mgr.lookupAssetSpaceForPath(undefined as unknown as string)).toBeNull();
    });

    it("ignores non-AssetSpace assets at sibling paths", () => {
      const h = makeHarness([
        {
          path: "assetspaces/ems/f0f674da-a31b-47e1-b0e8-f984b018bf75.md",
          frontmatter: assetSpaceFrontmatter({
            uid: EMS_UID,
            git: "https://github.com/kitelev/exoas-ems",
            namespace: "ems",
          }),
        },
        {
          path: "assetspaces/ems/some-other-asset.md",
          // not an AssetSpace — different class
          frontmatter: {
            "exo__Asset_uid": "other-uid",
            "exo__Instance_class": ["[[some-other-class]]"],
          },
        },
      ]);
      expect(h.mgr.lookupAssetSpaceForPath("assetspaces/ems")).toBe(EMS_UID);
    });
  });

  // --- lookupAssetSpaceInfo --------------------------------------------
  describe("lookupAssetSpaceInfo", () => {
    it("extracts full info from frontmatter", () => {
      const h = makeHarness(seedSingleAssetSpace({ withSha: "deadbeef" }));
      const info = h.mgr.lookupAssetSpaceInfo(EMS_UID);
      expect(info).toEqual({
        uid: EMS_UID,
        git: "https://github.com/kitelev/exoas-ems",
        namespace: "ems",
        folderName: "assetspaces/ems",
        lastPulledSha: "deadbeef",
      });
    });

    it("returns null when AssetSpace UID not found", () => {
      const h = makeHarness(seedSingleAssetSpace());
      expect(h.mgr.lookupAssetSpaceInfo("nonexistent")).toBeNull();
    });

    it("returns null when frontmatter missing git URL", () => {
      const h = makeHarness([
        {
          path: "assetspaces/ems/f0f674da.md",
          frontmatter: {
            "exo__Asset_uid": EMS_UID,
            "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
            // no exo__AssetSpace_git
            "exo__AssetSpace_namespace": "ems",
          },
        },
      ]);
      expect(h.mgr.lookupAssetSpaceInfo(EMS_UID)).toBeNull();
    });

    it("returns null when frontmatter missing namespace", () => {
      const h = makeHarness([
        {
          path: "assetspaces/ems/f0f674da.md",
          frontmatter: {
            "exo__Asset_uid": EMS_UID,
            "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
            "exo__AssetSpace_git": "https://github.com/kitelev/exoas-ems",
            // no exo__AssetSpace_namespace
          },
        },
      ]);
      expect(h.mgr.lookupAssetSpaceInfo(EMS_UID)).toBeNull();
    });

    it("returns null for empty input", () => {
      const h = makeHarness(seedSingleAssetSpace());
      expect(h.mgr.lookupAssetSpaceInfo("")).toBeNull();
    });
  });

  // --- pushAssetSpace --------------------------------------------------
  describe("pushAssetSpace", () => {
    it("happy path — collects dirty, strips folder prefix, calls createCommit, updates lastPulledSha", async () => {
      const h = makeHarness(
        [
          {
            path: "assetspaces/ems/f0f674da.md",
            frontmatter: assetSpaceFrontmatter({
              uid: EMS_UID,
              git: "https://github.com/kitelev/exoas-ems",
              namespace: "ems",
            }),
          },
          {
            path: "assetspaces/ems/instance-1.md",
            frontmatter: { "exo__Asset_uid": "inst-1" },
            content: "# Instance 1\n",
          },
          {
            path: "assetspaces/ems/nested/instance-2.md",
            frontmatter: { "exo__Asset_uid": "inst-2" },
            content: "# Instance 2\n",
          },
        ],
        {
          clientOverrides: {
            createCommit: jest
              .fn()
              .mockResolvedValue("abc1234567890" + "0".repeat(27)),
          },
        },
      );
      h.mgr.markDirty("assetspaces/ems/instance-1.md");
      h.mgr.markDirty("assetspaces/ems/nested/instance-2.md");
      // Plus a dirty file outside the AS — must NOT be pushed.
      h.mgr.markDirty("other/area/unrelated.md");

      const sha = await h.mgr.pushAssetSpace(EMS_UID);
      expect(sha).toBe("abc1234567890" + "0".repeat(27));
      expect(h.client.ensureRateLimit).toHaveBeenCalledWith(4);
      expect(h.client.createCommit).toHaveBeenCalledTimes(1);
      const [owner, repo, branch, files, message] = h.client.createCommit.mock.calls[0];
      expect(owner).toBe("kitelev");
      expect(repo).toBe("exoas-ems");
      expect(branch).toBe("main");
      expect(files).toBeInstanceOf(Map);
      // Repo-relative paths — folder prefix stripped
      expect(Array.from((files as Map<string, string>).keys()).sort()).toEqual([
        "instance-1.md",
        "nested/instance-2.md",
      ]);
      expect((files as Map<string, string>).get("instance-1.md")).toBe("# Instance 1\n");
      expect(message).toMatch(/push 2 dirty file/);

      // Pushed paths cleared from dirty set; unrelated path remains
      expect(h.mgr.getDirtySnapshot().has("assetspaces/ems/instance-1.md")).toBe(false);
      expect(h.mgr.getDirtySnapshot().has("assetspaces/ems/nested/instance-2.md")).toBe(false);
      expect(h.mgr.getDirtySnapshot().has("other/area/unrelated.md")).toBe(true);

      // lastPulledSha written via processFrontMatter
      const updated = h.fake.processedFrontmatter.get("assetspaces/ems/f0f674da.md");
      expect(updated).toBeDefined();
      expect(updated!["exo__AssetSpace_lastPulledSha"]).toBe(
        "abc1234567890" + "0".repeat(27),
      );
      expect(typeof updated!["exo__Asset_updatedAt"]).toBe("string");

      // Success notification surfaced
      expect(h.notifier.successCalls.some((m) => /ems/.test(m) && /abc1234/.test(m))).toBe(true);
    });

    it("returns null when no dirty files match the AssetSpace folder", async () => {
      const h = makeHarness(seedSingleAssetSpace());
      h.mgr.markDirty("other/area/foo.md"); // outside ems
      const sha = await h.mgr.pushAssetSpace(EMS_UID);
      expect(sha).toBeNull();
      expect(h.client.createCommit).not.toHaveBeenCalled();
      expect(h.notifier.infoCalls.some((m) => /no dirty files/i.test(m))).toBe(true);
    });

    it("throws when asUid is empty", async () => {
      const h = makeHarness(seedSingleAssetSpace());
      await expect(h.mgr.pushAssetSpace("")).rejects.toThrow(/asUid is required/);
    });

    it("throws when AssetSpace UID not found in vault", async () => {
      const h = makeHarness([]);
      h.mgr.markDirty("assetspaces/ems/foo.md");
      await expect(h.mgr.pushAssetSpace("nonexistent-uid")).rejects.toThrow(
        /not found in vault/,
      );
    });

    it("throws when AssetSpace git URL fails allowlist", async () => {
      const h = makeHarness([
        {
          path: "assetspaces/evil/f0f674da.md",
          frontmatter: assetSpaceFrontmatter({
            uid: EMS_UID,
            git: "https://evil.com/kitelev/exoas-ems", // not github.com
            namespace: "evil",
          }),
        },
      ]);
      h.mgr.markDirty("assetspaces/evil/foo.md");
      await expect(h.mgr.pushAssetSpace(EMS_UID)).rejects.toThrow(/Invalid GitHub repo URL/);
    });

    it("propagates rate-limit gate failure (does NOT call createCommit)", async () => {
      const h = makeHarness(seedSingleAssetSpace(), {
        clientOverrides: {
          ensureRateLimit: jest
            .fn()
            .mockRejectedValue(new Error("Rate limit guard: 3 remaining < 14 needed")),
        },
      });
      h.mgr.markDirty("assetspaces/ems/foo.md");
      await expect(h.mgr.pushAssetSpace(EMS_UID)).rejects.toThrow(/Rate limit guard/);
      expect(h.client.createCommit).not.toHaveBeenCalled();
    });

    it("dedups concurrent pushes for the same AssetSpace UID", async () => {
      let resolveCommit: (v: string) => void = () => undefined;
      const commitPromise = new Promise<string>((res) => {
        resolveCommit = res;
      });
      const h = makeHarness(
        [
          ...seedSingleAssetSpace(),
          {
            path: "assetspaces/ems/dirty.md",
            frontmatter: { "exo__Asset_uid": "x" },
            content: "x",
          },
        ],
        {
          clientOverrides: {
            createCommit: jest.fn().mockReturnValue(commitPromise),
          },
        },
      );
      h.mgr.markDirty("assetspaces/ems/dirty.md");
      const p1 = h.mgr.pushAssetSpace(EMS_UID);
      const p2 = h.mgr.pushAssetSpace(EMS_UID);
      // Both should be the SAME promise (in-flight dedup)
      expect(p1).toBe(p2);
      resolveCommit("a".repeat(40));
      await Promise.all([p1, p2]);
      // createCommit must have been invoked exactly once
      expect(h.client.createCommit).toHaveBeenCalledTimes(1);
    });

    it("allows new push after in-flight resolves", async () => {
      const h = makeHarness([
        ...seedSingleAssetSpace(),
        {
          path: "assetspaces/ems/dirty.md",
          frontmatter: { "exo__Asset_uid": "x" },
          content: "x",
        },
      ]);
      h.mgr.markDirty("assetspaces/ems/dirty.md");
      await h.mgr.pushAssetSpace(EMS_UID);

      // Second push — must NOT be deduped (in-flight cleared post-resolve)
      h.mgr.markDirty("assetspaces/ems/dirty.md");
      await h.mgr.pushAssetSpace(EMS_UID);
      expect(h.client.createCommit).toHaveBeenCalledTimes(2);
    });
  });

  // --- Phase 2/3 stubs (Phase 5 P1 turned pullAssetSpace into real impl;
  //     destroyAssetSpace + restoreFromCache stay deferred to Phase 2/3) -----
  describe("Phase 2/3 stubs", () => {
    it("pullAssetSpace throws desktop-only without staging tracker", async () => {
      // No stagingTracker configured → fail-loud before any side effects.
      const h = makeHarness([]);
      await expect(
        h.mgr.pullAssetSpace(
          "x",
          "https://github.com/owner/repo",
        ),
      ).rejects.toThrow(/stagingTracker not configured/);
    });

    it("destroyAssetSpace throws 'deferred to Phase 2/3'", async () => {
      const h = makeHarness([]);
      await expect(h.mgr.destroyAssetSpace("x")).rejects.toThrow(
        /deferred to Phase 2\/3/,
      );
    });

    it("restoreFromCache throws 'deferred to Phase 2 SwitchCacheLayer'", async () => {
      const h = makeHarness([]);
      await expect(h.mgr.restoreFromCache("x")).rejects.toThrow(
        /deferred to Phase 2 SwitchCacheLayer/,
      );
    });
  });
});

// ─── parseGitHubURL (exported helper) ────────────────────────────────────

describe("parseGitHubURL", () => {
  it("parses standard github URL", () => {
    expect(parseGitHubURL("https://github.com/kitelev/exoas-ems")).toEqual({
      owner: "kitelev",
      repo: "exoas-ems",
    });
  });

  it("strips trailing .git", () => {
    expect(parseGitHubURL("https://github.com/kitelev/exoas-ems.git")).toEqual({
      owner: "kitelev",
      repo: "exoas-ems",
    });
  });

  it("supports owner/repo with dashes and underscores", () => {
    expect(parseGitHubURL("https://github.com/some-org/some_repo.foo")).toEqual({
      owner: "some-org",
      repo: "some_repo.foo",
    });
  });

  it("throws on malformed URL", () => {
    expect(() => parseGitHubURL("not-a-url")).toThrow(/invalid URL shape/);
    expect(() => parseGitHubURL("https://gitlab.com/foo/bar")).toThrow(/invalid URL shape/);
  });
});
