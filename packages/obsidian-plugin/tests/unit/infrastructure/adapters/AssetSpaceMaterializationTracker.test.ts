import type { App, TFile } from "obsidian";

import { AssetSpaceMaterializationTracker } from "../../../../src/infrastructure/adapters/AssetSpaceMaterializationTracker";
import { ASSET_SPACE_CLASS_UID } from "../../../../src/infrastructure/adapters/AssetSpaceManager";

// ─── Fake App / vault / metadataCache (real-shape per test-fixture-realism) ───

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
}

function makeFakeApp(seeds: SeedFile[], existingFolders: Set<string>): App {
  const files = new Map<string, SeedFile>();
  for (const s of seeds) files.set(s.path, s);
  const tfile = (path: string): TFile => ({ path }) as unknown as TFile;

  return {
    vault: {
      getMarkdownFiles: () => Array.from(files.keys()).map(tfile),
      adapter: {
        exists: async (path: string): Promise<boolean> =>
          existingFolders.has(path.replace(/\/$/, "")),
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const seed = files.get(file.path);
        if (!seed) return null;
        return { frontmatter: seed.frontmatter };
      },
    },
  } as unknown as App;
}

function asFrontmatter(uid: string, namespace: string): Record<string, unknown> {
  return {
    "exo__Asset_uid": uid,
    "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    "exo__AssetSpace_namespace": namespace,
  };
}

describe("AssetSpaceMaterializationTracker", () => {
  it("marks AS materialized when its folder exists on disk", async () => {
    const app = makeFakeApp(
      [
        {
          path: "assetspaces/ems/uid-ems.md",
          frontmatter: asFrontmatter("uid-ems", "ems"),
        },
        {
          path: "assetspaces/exo/uid-exo.md",
          frontmatter: asFrontmatter("uid-exo", "exo"),
        },
      ],
      new Set(["assetspaces/ems", "assetspaces/exo"]),
    );
    const tracker = new AssetSpaceMaterializationTracker(app);
    await tracker.refresh();

    expect(tracker.isMaterialized("uid-ems")).toBe(true);
    expect(tracker.isMaterialized("uid-exo")).toBe(true);
    expect(Array.from(tracker.getMaterializedSet()).sort()).toEqual([
      "uid-ems",
      "uid-exo",
    ]);
  });

  it("marks AS not-materialized when folder is missing on disk", async () => {
    // AS ABox present but folder absent — simulates "available but not
    // materialized" semantics (Vision Lock #12). Production data is in
    // shared-identities or another always-materialized TS-floor.
    const app = makeFakeApp(
      [
        {
          path: "assetspaces/shared-identities/uid-kpc.md",
          frontmatter: asFrontmatter("uid-kpc", "kpc"),
        },
      ],
      new Set(["assetspaces/shared-identities"]), // kpc folder NOT in set
    );
    const tracker = new AssetSpaceMaterializationTracker(app);
    await tracker.refresh();

    expect(tracker.isMaterialized("uid-kpc")).toBe(false);
    expect(Array.from(tracker.getMaterializedSet())).toEqual([]);
  });

  it("ignores non-AssetSpace assets", async () => {
    const app = makeFakeApp(
      [
        {
          path: "assetspaces/ems/random.md",
          frontmatter: {
            "exo__Asset_uid": "random",
            // Some other class — NOT AssetSpace
            "exo__Instance_class": ["[[deadbeef-dead-beef-dead-beefdeadbeef]]"],
            "exo__AssetSpace_namespace": "ems",
          },
        },
      ],
      new Set(["assetspaces/ems"]),
    );
    const tracker = new AssetSpaceMaterializationTracker(app);
    await tracker.refresh();

    expect(Array.from(tracker.getMaterializedSet())).toEqual([]);
  });

  it("dedupes AS UID across multiple ABox files (vault clone scenario)", async () => {
    // shared-identities AS gets cloned into both vault-2025 and vault-exodev;
    // tracker may see the same ABox twice. Should not double-count.
    const app = makeFakeApp(
      [
        {
          path: "assetspaces/shared-identities/uid-shared.md",
          frontmatter: asFrontmatter("uid-shared", "shared-identities"),
        },
        {
          path: "assetspaces/shared-identities/uid-shared-dup.md",
          frontmatter: asFrontmatter("uid-shared", "shared-identities"),
        },
      ],
      new Set(["assetspaces/shared-identities"]),
    );
    const tracker = new AssetSpaceMaterializationTracker(app);
    await tracker.refresh();

    expect(Array.from(tracker.getMaterializedSet())).toEqual(["uid-shared"]);
  });

  it("skips AS with empty UID or missing namespace", async () => {
    const app = makeFakeApp(
      [
        {
          path: "assetspaces/ems/empty-uid.md",
          frontmatter: {
            "exo__Asset_uid": "",
            "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
            "exo__AssetSpace_namespace": "ems",
          },
        },
        {
          path: "assetspaces/exo/no-ns.md",
          frontmatter: {
            "exo__Asset_uid": "uid-exo",
            "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
            // No namespace
          },
        },
      ],
      new Set(["assetspaces/ems", "assetspaces/exo"]),
    );
    const tracker = new AssetSpaceMaterializationTracker(app);
    await tracker.refresh();

    expect(Array.from(tracker.getMaterializedSet())).toEqual([]);
  });

  it("treats adapter.exists errors as not-materialized (fail-closed)", async () => {
    const app: App = {
      vault: {
        getMarkdownFiles: () =>
          [{ path: "assetspaces/ems/uid-ems.md" } as unknown as TFile],
        adapter: {
          exists: async (): Promise<boolean> => {
            throw new Error("EACCES");
          },
        },
      },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: asFrontmatter("uid-ems", "ems"),
        }),
      },
    } as unknown as App;

    const tracker = new AssetSpaceMaterializationTracker(app);
    await tracker.refresh();
    expect(tracker.isMaterialized("uid-ems")).toBe(false);
  });

  it("getStatuses() exposes per-AS records with asFilePath + materialized flag", async () => {
    const app = makeFakeApp(
      [
        {
          path: "assetspaces/shared-identities/uid-ems.md",
          frontmatter: asFrontmatter("uid-ems", "ems"),
        },
        {
          path: "assetspaces/shared-identities/uid-kpc.md",
          frontmatter: asFrontmatter("uid-kpc", "kpc"),
        },
      ],
      new Set(["assetspaces/ems"]), // ems materialized, kpc not
    );
    const tracker = new AssetSpaceMaterializationTracker(app);
    await tracker.refresh();

    const statuses = tracker.getStatuses();
    expect(statuses.length).toBe(2);
    const byUid = new Map(statuses.map((s) => [s.asUid, s]));
    expect(byUid.get("uid-ems")).toEqual({
      asUid: "uid-ems",
      asFilePath: "assetspaces/shared-identities/uid-ems.md",
      namespace: "ems",
      materialized: true,
    });
    expect(byUid.get("uid-kpc")).toEqual({
      asUid: "uid-kpc",
      asFilePath: "assetspaces/shared-identities/uid-kpc.md",
      namespace: "kpc",
      materialized: false,
    });
  });

  it("refresh() updates the set when filesystem state changes", async () => {
    const existingFolders = new Set(["assetspaces/ems", "assetspaces/exo"]);
    const app = makeFakeApp(
      [
        {
          path: "assetspaces/ems/uid-ems.md",
          frontmatter: asFrontmatter("uid-ems", "ems"),
        },
        {
          path: "assetspaces/exo/uid-exo.md",
          frontmatter: asFrontmatter("uid-exo", "exo"),
        },
      ],
      existingFolders,
    );
    const tracker = new AssetSpaceMaterializationTracker(app);

    await tracker.refresh();
    expect(tracker.isMaterialized("uid-ems")).toBe(true);
    expect(tracker.isMaterialized("uid-exo")).toBe(true);

    // Simulate apply: exo folder destroyed.
    existingFolders.delete("assetspaces/exo");
    await tracker.refresh();
    expect(tracker.isMaterialized("uid-ems")).toBe(true);
    expect(tracker.isMaterialized("uid-exo")).toBe(false);
  });
});
