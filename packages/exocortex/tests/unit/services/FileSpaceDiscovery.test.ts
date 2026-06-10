import {
  discoverFileSpaceExclusions,
  frontmatterDeclaresFileSpace,
  FILE_SPACE_CLASS_UID,
  type FileSpaceDiscoveryVault,
} from "../../../src/services/FileSpaceDiscovery";
import type { IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";

function file(path: string): IFile {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return { path, basename: name.replace(/\.md$/, ""), name, parent: null };
}

/**
 * Minimal production-shape vault fake: `getFirstLinkpathDest` resolves by
 * basename only (the real Obsidian metadataCache contract — aliases do NOT
 * resolve), `getFrontmatter` looks up a path-keyed map.
 */
function fakeVault(
  frontmatters: Record<string, IFrontmatter>,
): FileSpaceDiscoveryVault {
  const files = Object.keys(frontmatters).map(file);
  return {
    getAllFiles: () => files,
    getFrontmatter: (f: IFile) => frontmatters[f.path] ?? null,
    getFirstLinkpathDest: (linkpath: string) => {
      const target = files.find(
        (f) => f.basename === linkpath.replace(/\.md$/, ""),
      );
      return target ?? null;
    },
  };
}

const FILESPACE_DECLARATION: IFrontmatter = {
  exo__Asset_uid: "0f17e5ba-1111-4222-8333-444455556666",
  exo__Asset_label: "My Attachments",
  exo__Instance_class: [`[[${FILE_SPACE_CLASS_UID}|exo__FileSpace]]`],
  exo__AssetSpace_source: "https://github.com/owner/files-repo",
};

describe("discoverFileSpaceExclusions", () => {
  it("derives a mount prefix from a UUID-form FileSpace declaration", () => {
    const vault = fakeVault({
      "spaces/files.md": FILESPACE_DECLARATION,
    });
    const result = discoverFileSpaceExclusions(vault);
    expect(result.prefixes).toEqual(["assetspaces/owner/files-repo/"]);
    expect(result.declarationPaths).toEqual(["spaces/files.md"]);
    expect(result.warnings).toEqual([]);
  });

  it("reads the legacy _git key when _source is absent (dual-read)", () => {
    const vault = fakeVault({
      "spaces/files.md": {
        ...FILESPACE_DECLARATION,
        exo__AssetSpace_source: undefined,
        exo__AssetSpace_git: "https://github.com/owner/legacy-repo",
      },
    });
    expect(discoverFileSpaceExclusions(vault).prefixes).toEqual([
      "assetspaces/owner/legacy-repo/",
    ]);
  });

  it("resolves a label-form class link via the link resolver", () => {
    const vault = fakeVault({
      // Legacy label-named class file — the link resolver finds it by
      // basename and its asset uid identifies the class.
      "tbox/exo__FileSpace.md": {
        exo__Asset_uid: FILE_SPACE_CLASS_UID,
        exo__Asset_label: "exo__FileSpace",
      },
      "spaces/files.md": {
        ...FILESPACE_DECLARATION,
        exo__Instance_class: ["[[exo__FileSpace]]"],
      },
    });
    const result = discoverFileSpaceExclusions(vault);
    expect(result.prefixes).toEqual(["assetspaces/owner/files-repo/"]);
  });

  it("does NOT match when a label-form link cannot be resolved", () => {
    const vault = fakeVault({
      "spaces/files.md": {
        ...FILESPACE_DECLARATION,
        exo__Instance_class: ["[[exo__FileSpace]]"], // no such file in vault
      },
    });
    const result = discoverFileSpaceExclusions(vault);
    expect(result.prefixes).toEqual([]);
    expect(result.declarationPaths).toEqual([]);
  });

  it("ignores AssetSpace declarations (sibling subtype parses normally)", () => {
    const vault = fakeVault({
      "spaces/assets.md": {
        exo__Asset_uid: "11111111-2222-4333-8444-555566667777",
        exo__Asset_label: "Ontology Space",
        exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
        exo__AssetSpace_source: "https://github.com/owner/asset-repo",
      },
    });
    const result = discoverFileSpaceExclusions(vault);
    expect(result.prefixes).toEqual([]);
    expect(result.declarationPaths).toEqual([]);
  });

  it("warns and excludes nothing when the declaration has no source", () => {
    const vault = fakeVault({
      "spaces/files.md": {
        ...FILESPACE_DECLARATION,
        exo__AssetSpace_source: undefined,
      },
    });
    const result = discoverFileSpaceExclusions(vault);
    expect(result.prefixes).toEqual([]);
    expect(result.declarationPaths).toEqual(["spaces/files.md"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no exo__AssetSpace_source/);
  });

  it("warns when the mount path cannot be derived from the source", () => {
    const vault = fakeVault({
      "spaces/files.md": {
        ...FILESPACE_DECLARATION,
        exo__AssetSpace_source: "file:///local/clone",
      },
    });
    const result = discoverFileSpaceExclusions(vault);
    expect(result.prefixes).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/cannot derive mount path/);
  });

  it("warns when the declaration lies inside its own mount folder", () => {
    const vault = fakeVault({
      "assetspaces/owner/files-repo/declaration.md": FILESPACE_DECLARATION,
    });
    const result = discoverFileSpaceExclusions(vault);
    // The prefix still excludes the content (fail-safe for the blobs)…
    expect(result.prefixes).toEqual(["assetspaces/owner/files-repo/"]);
    // …but the self-inclusion is surfaced loudly.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/INSIDE its own mount/);
  });

  it("handles scalar (non-array) Instance_class shapes", () => {
    const vault = fakeVault({
      "spaces/files.md": {
        ...FILESPACE_DECLARATION,
        exo__Instance_class: `[[${FILE_SPACE_CLASS_UID}]]`,
      },
    });
    expect(discoverFileSpaceExclusions(vault).prefixes).toEqual([
      "assetspaces/owner/files-repo/",
    ]);
  });
});

describe("frontmatterDeclaresFileSpace", () => {
  it("matches a UUID-form wikilink (case-insensitive)", () => {
    expect(
      frontmatterDeclaresFileSpace({
        exo__Instance_class: [
          `[[${FILE_SPACE_CLASS_UID.toUpperCase()}|exo__FileSpace]]`,
        ],
      }),
    ).toBe(true);
  });

  it("does NOT match label-form links (cheap probe is UUID-only)", () => {
    expect(
      frontmatterDeclaresFileSpace({ exo__Instance_class: ["[[exo__FileSpace]]"] }),
    ).toBe(false);
  });

  it("does NOT match other classes or empty frontmatter", () => {
    expect(
      frontmatterDeclaresFileSpace({
        exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}]]`],
      }),
    ).toBe(false);
    expect(frontmatterDeclaresFileSpace(null)).toBe(false);
    expect(frontmatterDeclaresFileSpace(undefined)).toBe(false);
  });
});
