import { createObsidianTargetResolver } from "../../../../src/infrastructure/services/ObsidianTargetResolver";

const fileObj = (path: string) => ({
  path,
  basename: path.replace(/\.md$/, "").split("/").pop()!,
  name: path.split("/").pop()!,
  parent: { path: path.split("/").slice(0, -1).join("/") },
});

function buildApp(files: { path: string; uid?: string; jsonId?: string }[]) {
  const tfiles = files.map((f) => fileObj(f.path));
  const cacheByPath = new Map(
    files.map((f) => [
      f.path,
      {
        frontmatter: {
          ...(f.uid !== undefined ? { exo__Asset_uid: f.uid } : {}),
          ...(f.jsonId !== undefined ? { "@id": f.jsonId } : {}),
        },
      },
    ]),
  );
  return {
    vault: {
      getMarkdownFiles: jest.fn(() => tfiles),
      getAbstractFileByPath: jest.fn((p: string) =>
        tfiles.find((f) => f.path === p) ?? null,
      ),
    },
    metadataCache: {
      getFileCache: jest.fn((f: { path: string }) =>
        cacheByPath.get(f.path),
      ),
    },
  } as never;
}

const vaultAdapter = {
  getAbstractFileByPath: (path: string) =>
    path === "missing.md" ? null : fileObj(path),
} as never;

describe("ObsidianTargetResolver", () => {
  it("resolves obsidian://vault/<path> URI by decoding", () => {
    const app = buildApp([{ path: "Tasks/foo bar.md" }]);
    const resolver = createObsidianTargetResolver(app, vaultAdapter);
    const file = resolver.resolveFile(
      "obsidian://vault/Tasks/foo%20bar.md",
    );
    expect(file.basename).toBe("foo bar");
  });

  it("resolves UID via metadataCache scan", () => {
    const app = buildApp([
      { path: "other.md" },
      { path: "Tasks/uuid-1.md", uid: "uuid-1" },
    ]);
    const resolver = createObsidianTargetResolver(app, vaultAdapter);
    const file = resolver.resolveFile("uuid-1");
    expect(file.path).toBe("Tasks/uuid-1.md");
  });

  it("resolves @id via metadataCache scan", () => {
    const app = buildApp([
      { path: "Concepts/c.md", jsonId: "https://example.com/c" },
    ]);
    const resolver = createObsidianTargetResolver(app, vaultAdapter);
    const file = resolver.resolveFile("https://example.com/c");
    expect(file.path).toBe("Concepts/c.md");
  });

  it("throws when no file matches", () => {
    const app = buildApp([{ path: "x.md", uid: "x" }]);
    const resolver = createObsidianTargetResolver(app, vaultAdapter);
    expect(() => resolver.resolveFile("missing-uid")).toThrow(
      /No file found for IRI: missing-uid/,
    );
  });

  it("throws when vaultAdapter cannot materialize the IFile", () => {
    const app = buildApp([{ path: "missing.md", uid: "ghost" }]);
    const resolver = createObsidianTargetResolver(app, vaultAdapter);
    expect(() => resolver.resolveFile("ghost")).toThrow(
      /Cannot resolve IFile for path/,
    );
  });
});
