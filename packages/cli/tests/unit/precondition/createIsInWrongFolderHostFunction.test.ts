import { describe, it, expect, jest } from "@jest/globals";
import {
  FolderRepairService,
  type EvalContext,
  type IFile,
  type IFolder,
  type IFrontmatter,
  type IVaultAdapter,
} from "exocortex";
import { createIsInWrongFolderHostFunction } from "../../../src/precondition/createIsInWrongFolderHostFunction.js";

describe("createIsInWrongFolderHostFunction (CLI parity)", () => {
  const buildFile = (
    path: string,
    basename: string,
    parentPath: string,
  ): IFile =>
    ({
      path,
      basename,
      name: `${basename}.md`,
      parent: {
        path: parentPath,
        name: parentPath.split("/").pop() ?? "",
      } as IFolder,
    }) as IFile;

  const buildAdapter = (opts: {
    node?: IFile | IFolder | null;
    frontmatter?: IFrontmatter | null;
  }): IVaultAdapter =>
    ({
      getAbstractFileByPath: jest
        .fn()
        .mockReturnValue(opts.node === undefined ? null : opts.node),
      getFrontmatter: jest
        .fn()
        .mockReturnValue(
          opts.frontmatter === undefined ? null : opts.frontmatter,
        ),
    }) as unknown as IVaultAdapter;

  const buildService = (
    expected: string | null,
  ): jest.Mocked<FolderRepairService> =>
    ({
      getExpectedFolder: jest.fn(),
      getExpectedFolderSync: jest.fn().mockReturnValue(expected),
      repairFolder: jest.fn(),
    }) as unknown as jest.Mocked<FolderRepairService>;

  const baseCtx = (overrides: Partial<EvalContext> = {}): EvalContext => ({
    targetIRI: "obsidian://vault/current/folder/asset.md",
    fileBasename: "asset",
    currentFolder: "current/folder",
    filePath: "current/folder/asset.md",
    ...overrides,
  });

  it("returns false when filePath missing from context", () => {
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({ node: null }),
      buildService("anywhere"),
    );
    expect(fn(baseCtx({ filePath: undefined }))).toBe(false);
  });

  it("returns false when file not found in vault", () => {
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({ node: null }),
      buildService("anywhere"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when target is a folder (no basename)", () => {
    const folder: IFolder = { path: "current/folder", name: "folder" };
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({ node: folder }),
      buildService("anywhere"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when expected folder cannot be resolved", () => {
    const file = buildFile(
      "current/folder/asset.md",
      "asset",
      "current/folder",
    );
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({ node: file, frontmatter: {} }),
      buildService(null),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when asset already in expected folder", () => {
    const file = buildFile(
      "current/folder/asset.md",
      "asset",
      "current/folder",
    );
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({
        node: file,
        frontmatter: { exo__Asset_isDefinedBy: "[[Class]]" },
      }),
      buildService("current/folder"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when expected differs only by trailing slash", () => {
    const file = buildFile(
      "current/folder/asset.md",
      "asset",
      "current/folder",
    );
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({
        node: file,
        frontmatter: { exo__Asset_isDefinedBy: "[[Class]]" },
      }),
      buildService("current/folder/"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns true when asset is in wrong folder", () => {
    const file = buildFile(
      "current/folder/asset.md",
      "asset",
      "current/folder",
    );
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({
        node: file,
        frontmatter: { exo__Asset_isDefinedBy: "[[Class]]" },
      }),
      buildService("expected/folder"),
    );
    expect(fn(baseCtx())).toBe(true);
  });

  it("falls back to file.parent.path when currentFolder missing from ctx", () => {
    const file = buildFile("fallback/asset.md", "asset", "fallback");
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({
        node: file,
        frontmatter: { exo__Asset_isDefinedBy: "[[Class]]" },
      }),
      buildService("fallback"),
    );
    expect(fn(baseCtx({ currentFolder: undefined }))).toBe(false);
  });

  it("returns true when fallback parent path differs from expected", () => {
    const file = buildFile("wrong/asset.md", "asset", "wrong");
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({
        node: file,
        frontmatter: { exo__Asset_isDefinedBy: "[[Class]]" },
      }),
      buildService("expected/folder"),
    );
    expect(fn(baseCtx({ currentFolder: undefined }))).toBe(true);
  });

  it("passes file + metadata to FolderRepairService.getExpectedFolderSync", () => {
    const file = buildFile(
      "current/folder/asset.md",
      "asset",
      "current/folder",
    );
    const metadata = {
      exo__Asset_isDefinedBy: "[[Class]]",
      otherProp: "x",
    };
    const service = buildService("expected/folder");
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({ node: file, frontmatter: metadata }),
      service,
    );
    fn(baseCtx());
    expect(service.getExpectedFolderSync).toHaveBeenCalledWith(file, metadata);
  });

  it("treats null frontmatter as empty metadata object", () => {
    const file = buildFile(
      "current/folder/asset.md",
      "asset",
      "current/folder",
    );
    const service = buildService(null);
    const fn = createIsInWrongFolderHostFunction(
      buildAdapter({ node: file, frontmatter: null }),
      service,
    );
    fn(baseCtx());
    expect(service.getExpectedFolderSync).toHaveBeenCalledWith(file, {});
  });
});
