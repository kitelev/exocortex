import type { App, TFile } from "obsidian";

import { lookupAssetSpaceUidByFolder } from "../../../../src/infrastructure/adapters/AssetSpaceLookupHelper";
import { ASSET_SPACE_CLASS_UID } from "../../../../src/infrastructure/adapters/AssetSpaceManager";

// ─── Fake App / vault / metadataCache (real-shape per test-fixture-realism) ───

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
}

function makeFakeApp(seeds: SeedFile[]): App {
  const files = new Map<string, SeedFile>();
  for (const s of seeds) files.set(s.path, s);
  const tfile = (path: string): TFile => ({ path }) as unknown as TFile;

  return {
    vault: {
      getMarkdownFiles: () => Array.from(files.keys()).map(tfile),
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

function asFrontmatter(uid: string): Record<string, unknown> {
  return {
    "exo__Asset_uid": uid,
    "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
  };
}

describe("lookupAssetSpaceUidByFolder", () => {
  it("returns the AssetSpace UID when folder matches an AS asset's parent", () => {
    const app = makeFakeApp([
      { path: "assetspaces/ems/uid-ems.md", frontmatter: asFrontmatter("uid-ems") },
      { path: "assetspaces/exo/uid-exo.md", frontmatter: asFrontmatter("uid-exo") },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/ems")).toBe("uid-ems");
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/exo")).toBe("uid-exo");
  });

  it("normalises trailing slash", () => {
    const app = makeFakeApp([
      { path: "assetspaces/ems/uid-ems.md", frontmatter: asFrontmatter("uid-ems") },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/ems/")).toBe("uid-ems");
  });

  it("returns null for empty folder name", () => {
    const app = makeFakeApp([
      { path: "assetspaces/ems/uid-ems.md", frontmatter: asFrontmatter("uid-ems") },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "")).toBeNull();
  });

  it("returns null when no AssetSpace asset owns the folder", () => {
    const app = makeFakeApp([
      { path: "assetspaces/ems/uid-ems.md", frontmatter: asFrontmatter("uid-ems") },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/missing")).toBeNull();
  });

  it("skips non-AssetSpace files in the same folder (loose class noise)", () => {
    const app = makeFakeApp([
      {
        path: "assetspaces/ems/other.md",
        frontmatter: {
          "exo__Asset_uid": "uid-other",
          // UUID-shaped noise but NOT the AS class
          "exo__Instance_class": ["[[deadbeef-dead-beef-dead-beefdeadbeef]]"],
        },
      },
      { path: "assetspaces/ems/real.md", frontmatter: asFrontmatter("uid-real") },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/ems")).toBe("uid-real");
  });

  it("returns null when AS asset has empty UID", () => {
    const app = makeFakeApp([
      {
        path: "assetspaces/ems/empty.md",
        frontmatter: {
          "exo__Asset_uid": "",
          "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
        },
      },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/ems")).toBeNull();
  });

  it("returns null when frontmatter is missing entirely", () => {
    const app = makeFakeApp([{ path: "assetspaces/ems/uid.md", frontmatter: {} }]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/ems")).toBeNull();
  });

  it("strict wikilink regex — substring AS UID noise does not falsely register", () => {
    // Issue #3312 MEDIUM #1 regression guard
    const app = makeFakeApp([
      {
        path: "assetspaces/ems/decoy.md",
        frontmatter: {
          "exo__Asset_uid": "uid-decoy",
          // Class string contains AS UID as substring но NOT inside a wikilink.
          "exo__Instance_class": `not-a-link-${ASSET_SPACE_CLASS_UID}`,
        },
      },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/ems")).toBeNull();
  });
});
