import type { App, TFile } from "obsidian";
import type { INotificationService } from "@kitelev/exocortex-core";

import {
  AssetSpaceManager,
  ASSET_SPACE_CLASS_UID,
  isAssetSpaceFrontmatter,
} from "../../../../src/infrastructure/adapters/AssetSpaceManager";

// ─── Fixture shapes mirror the main AssetSpaceManager.test.ts harness, ───
// but stay self-contained so this suite can be exercised in isolation while
// performing the revert→fail / restore→pass verification cycle.

interface FakeGitHubClient {
  ensureRateLimit: jest.Mock<Promise<void>, [number]>;
  createCommit: jest.Mock<
    Promise<string>,
    [string, string, string, Map<string, string>, string]
  >;
}

function makeFakeClient(
  overrides: Partial<FakeGitHubClient> = {},
): FakeGitHubClient {
  return {
    ensureRateLimit: jest.fn().mockResolvedValue(undefined),
    createCommit: jest.fn().mockResolvedValue("a".repeat(40)),
    ...overrides,
  };
}

function makeFakeNotifier(): INotificationService {
  return {
    info: () => undefined,
    success: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    confirm: async () => true,
  };
}

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
  content?: string;
}

interface FakeApp {
  app: App;
  files: Map<string, SeedFile>;
}

function makeFakeApp(
  seeds: SeedFile[],
  opts: { processFrontMatterThrows?: Error } = {},
): FakeApp {
  const files = new Map<string, SeedFile>();
  for (const s of seeds) files.set(s.path, s);

  const tfileFor = (path: string): TFile => ({ path } as unknown as TFile);

  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(files.keys()).map(tfileFor),
      adapter: {
        read: async (path: string) => {
          const f = files.get(path);
          if (!f || typeof f.content !== "string") {
            throw new Error(`fake read: not found: ${path}`);
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
        if (opts.processFrontMatterThrows) {
          throw opts.processFrontMatterThrows;
        }
        const seed = files.get(file.path);
        if (!seed) throw new Error(`fake pfm: not found: ${file.path}`);
        fn(seed.frontmatter);
      },
    },
  } as unknown as App;

  return { app, files };
}

const EMS_UID = "f0f674da-a31b-47e1-b0e8-f984b018bf75";

function assetSpaceSeed(): SeedFile {
  return {
    path: "assetspaces/ems/f0f674da.md",
    frontmatter: {
      "exo__Asset_uid": EMS_UID,
      "exo__Asset_label": "kitelev/exoas-ems",
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
      "exo__AssetSpace_git": "https://github.com/kitelev/exoas-ems",
      "exo__AssetSpace_namespace": "ems",
    },
  };
}

// ─── HIGH — push race regression ────────────────────────────────────────

describe("AssetSpaceManager — push race regression (Issue #3312 HIGH)", () => {
  it("retains dirty entries when updateLastPulledSha throws after createCommit (allows retry)", async () => {
    // Arrange: AssetSpace seeded; processFrontMatter (used by
    // updateLastPulledSha) throws to simulate vault-side write failure
    // after a successful remote commit. With the buggy order, the dirty
    // set would have been cleared BEFORE the throw — losing the user's
    // unpersisted retry signal. With the fixed order (persist sha first),
    // dirty entries stay until both writes succeed.
    const fake = makeFakeApp(
      [
        assetSpaceSeed(),
        {
          path: "assetspaces/kitelev/exoas-ems/dirty.md",
          frontmatter: { "exo__Asset_uid": "x" },
          content: "x",
        },
      ],
      {
        processFrontMatterThrows: new Error(
          "simulated processFrontMatter failure",
        ),
      },
    );
    const client = makeFakeClient({
      createCommit: jest.fn().mockResolvedValue("b".repeat(40)),
    });
    const mgr = new AssetSpaceManager({
      app: fake.app,
      client: client as never,
      notifications: makeFakeNotifier(),
    });

    mgr.markDirty("assetspaces/kitelev/exoas-ems/dirty.md");

    // Act
    await expect(mgr.pushAssetSpace(EMS_UID)).rejects.toThrow(
      /simulated processFrontMatter failure/,
    );

    // Assert — dirty entry preserved so the next pushAssetSpace retry will
    // reattempt the publish + sha persist; without this guarantee, the
    // user's vault state silently desyncs from the remote.
    expect(mgr.getDirtySnapshot().has("assetspaces/kitelev/exoas-ems/dirty.md")).toBe(true);

    // createCommit still ran exactly once — the regression is purely the
    // cleanup-order discipline, not double-publish.
    expect(client.createCommit).toHaveBeenCalledTimes(1);
  });
});

// ─── MEDIUM #1 — strict wikilink regex regression ───────────────────────

describe("AssetSpaceManager — strict wikilink class membership (Issue #3312 MEDIUM #1)", () => {
  it("matches `[[<uuid>]]` form", () => {
    const fake = makeFakeApp([assetSpaceSeed()]);
    const mgr = new AssetSpaceManager({
      app: fake.app,
      client: makeFakeClient() as never,
      notifications: makeFakeNotifier(),
    });
    expect(mgr.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-ems")).toBe(EMS_UID);
  });

  it("matches `[[<uuid>|<label>]]` aliased form", () => {
    const seed = assetSpaceSeed();
    seed.frontmatter["exo__Instance_class"] = [
      `[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`,
    ];
    const fake = makeFakeApp([seed]);
    const mgr = new AssetSpaceManager({
      app: fake.app,
      client: makeFakeClient() as never,
      notifications: makeFakeNotifier(),
    });
    expect(mgr.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-ems")).toBe(EMS_UID);
  });

  it("matches case-insensitively in the UUID hex", () => {
    const seed = assetSpaceSeed();
    seed.frontmatter["exo__Instance_class"] = [
      `[[${ASSET_SPACE_CLASS_UID.toUpperCase()}]]`,
    ];
    const fake = makeFakeApp([seed]);
    const mgr = new AssetSpaceManager({
      app: fake.app,
      client: makeFakeClient() as never,
      notifications: makeFakeNotifier(),
    });
    expect(mgr.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-ems")).toBe(EMS_UID);
  });

  it("does NOT match bare-substring AssetSpace UID inside other content", () => {
    // The legacy `String.includes` check would treat any value containing
    // the AssetSpace UID substring as an AssetSpace, e.g. a free-form note
    // body or label that mentions the UID. Strict wikilink matching
    // rejects this false positive.
    const seed = assetSpaceSeed();
    seed.frontmatter["exo__Instance_class"] = [
      `some prose mentioning ${ASSET_SPACE_CLASS_UID} bare-substring`,
    ];
    const fake = makeFakeApp([seed]);
    const mgr = new AssetSpaceManager({
      app: fake.app,
      client: makeFakeClient() as never,
      notifications: makeFakeNotifier(),
    });
    expect(mgr.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-ems")).toBeNull();
  });

  it("matches one wikilink inside a multi-class value", () => {
    const seed = assetSpaceSeed();
    seed.frontmatter["exo__Instance_class"] = [
      `[[00000000-0000-0000-0000-000000000000]] [[${ASSET_SPACE_CLASS_UID}]]`,
    ];
    const fake = makeFakeApp([seed]);
    const mgr = new AssetSpaceManager({
      app: fake.app,
      client: makeFakeClient() as never,
      notifications: makeFakeNotifier(),
    });
    expect(mgr.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-ems")).toBe(EMS_UID);
  });
});

// ─── MEDIUM #2 — Z UTC suffix regression ─────────────────────────────────

describe("AssetSpaceManager — nowIsoSeconds Z suffix (Issue #3312 MEDIUM #2)", () => {
  it("writes lastPulledSha + updatedAt with explicit Z UTC suffix", async () => {
    const fake = makeFakeApp([
      assetSpaceSeed(),
      {
        path: "assetspaces/kitelev/exoas-ems/dirty.md",
        frontmatter: { "exo__Asset_uid": "x" },
        content: "x",
      },
    ]);
    const client = makeFakeClient({
      createCommit: jest.fn().mockResolvedValue("c".repeat(40)),
    });
    const mgr = new AssetSpaceManager({
      app: fake.app,
      client: client as never,
      notifications: makeFakeNotifier(),
    });
    mgr.markDirty("assetspaces/kitelev/exoas-ems/dirty.md");
    await mgr.pushAssetSpace(EMS_UID);

    const updated = fake.files.get("assetspaces/ems/f0f674da.md")!.frontmatter;
    const ts = updated["exo__Asset_updatedAt"];
    expect(typeof ts).toBe("string");
    // Shape: `YYYY-MM-DDTHH:mm:ssZ` — explicit UTC indicator.
    expect(ts as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

// ─── MEDIUM #1 cross-file propagation — exported predicate contract ─────
// The predicate is re-used by `ExocortexPlugin.lookupAssetSpaceUidByFolder`
// and `ProfileOnloadWiring.scanAssetSpaces`; locking its behaviour at
// the export boundary protects all three call sites with a single suite.
// Mirrors PR #3296 follow-up commit 14a6abe0 discipline.

describe("isAssetSpaceFrontmatter (Issue #3312 MEDIUM #1 — exported helper)", () => {
  it("matches `[[<uuid>]]` string form", () => {
    expect(
      isAssetSpaceFrontmatter({
        "exo__Instance_class": `[[${ASSET_SPACE_CLASS_UID}]]`,
      }),
    ).toBe(true);
  });

  it("matches array form with aliased wikilink", () => {
    expect(
      isAssetSpaceFrontmatter({
        "exo__Instance_class": [
          `[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`,
        ],
      }),
    ).toBe(true);
  });

  it("matches case-insensitive UUID hex", () => {
    expect(
      isAssetSpaceFrontmatter({
        "exo__Instance_class": [
          `[[${ASSET_SPACE_CLASS_UID.toUpperCase()}]]`,
        ],
      }),
    ).toBe(true);
  });

  it("rejects bare-substring AssetSpace UID without wikilink brackets", () => {
    expect(
      isAssetSpaceFrontmatter({
        "exo__Instance_class": [
          `some prose mentioning ${ASSET_SPACE_CLASS_UID} bare-substring`,
        ],
      }),
    ).toBe(false);
  });

  it("rejects malformed wikilink (missing brackets)", () => {
    expect(
      isAssetSpaceFrontmatter({
        "exo__Instance_class": [ASSET_SPACE_CLASS_UID],
      }),
    ).toBe(false);
  });

  it("returns false on missing or non-string class value", () => {
    expect(isAssetSpaceFrontmatter({})).toBe(false);
    expect(
      isAssetSpaceFrontmatter({ "exo__Instance_class": null }),
    ).toBe(false);
    expect(
      isAssetSpaceFrontmatter({ "exo__Instance_class": 42 }),
    ).toBe(false);
  });

  it("is idempotent across repeated calls (regex lastIndex reset)", () => {
    const fm = {
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    };
    expect(isAssetSpaceFrontmatter(fm)).toBe(true);
    expect(isAssetSpaceFrontmatter(fm)).toBe(true);
    expect(isAssetSpaceFrontmatter(fm)).toBe(true);
  });
});
