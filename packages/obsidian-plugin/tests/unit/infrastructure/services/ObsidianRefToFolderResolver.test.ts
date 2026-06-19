import { createObsidianRefToFolderResolver } from "@plugin/infrastructure/services/ObsidianRefToFolderResolver";

// T1 "Create Instance" (project bbe40f8c) — uid → co-located ontology folder.

interface FakeFile {
  basename: string;
  parent: { path: string } | null;
}

function makeApp(
  files: Array<{ file: FakeFile; fm?: Record<string, unknown> }>,
): any {
  const list = files.map((f) => f.file);
  const fmByBasename = new Map(files.map((f) => [f.file.basename, f.fm]));
  return {
    vault: { getMarkdownFiles: () => list },
    metadataCache: {
      getFileCache: (file: FakeFile) => ({
        frontmatter: fmByBasename.get(file.basename),
      }),
    },
  };
}

describe("createObsidianRefToFolderResolver (T1 co-location)", () => {
  it("resolves a UID-canon filename to its parent folder (fast path)", () => {
    const app = makeApp([
      {
        file: {
          basename: "086f71fa-dd30-4284-90cf-e609f2a6c461",
          parent: { path: "assetspaces/kitelev/exoas-ems/ems" },
        },
      },
    ]);
    const resolve = createObsidianRefToFolderResolver(app);
    expect(resolve("086f71fa-dd30-4284-90cf-e609f2a6c461")).toBe(
      "assetspaces/kitelev/exoas-ems/ems",
    );
  });

  it("resolves by exo__Asset_uid frontmatter when filename is not UID-canon", () => {
    const app = makeApp([
      {
        file: { basename: "ems__Ontology", parent: { path: "legacy/ontologies" } },
        fm: { exo__Asset_uid: "the-uid-123" },
      },
    ]);
    const resolve = createObsidianRefToFolderResolver(app);
    expect(resolve("the-uid-123")).toBe("legacy/ontologies");
  });

  it("returns empty string for a file at the vault root", () => {
    const app = makeApp([
      { file: { basename: "root-onto", parent: null } },
    ]);
    const resolve = createObsidianRefToFolderResolver(app);
    expect(resolve("root-onto")).toBe("");
  });

  it("returns null when the ref matches no file", () => {
    const app = makeApp([
      { file: { basename: "other", parent: { path: "x" } } },
    ]);
    const resolve = createObsidianRefToFolderResolver(app);
    expect(resolve("missing-uid")).toBeNull();
  });

  it("returns null for empty ref or unavailable API", () => {
    const app = makeApp([]);
    expect(createObsidianRefToFolderResolver(app)("")).toBeNull();
    expect(createObsidianRefToFolderResolver({} as any)("x")).toBeNull();
  });
});
