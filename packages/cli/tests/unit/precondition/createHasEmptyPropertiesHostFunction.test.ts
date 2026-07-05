import { describe, it, expect, jest } from "@jest/globals";
import {
  type EvalContext,
  type IFile,
  type IFolder,
  type IFrontmatter,
  type IVaultAdapter,
} from "@kitelev/exocortex-core";
import { createHasEmptyPropertiesHostFunction } from "../../../src/precondition/createHasEmptyPropertiesHostFunction.js";

describe("createHasEmptyPropertiesHostFunction (CLI parity)", () => {
  const buildFile = (path: string): IFile =>
    ({
      path,
      basename: path.split("/").pop()?.replace(/\.md$/, "") ?? "",
      name: path.split("/").pop() ?? "",
      parent: { path: "x", name: "x" } as IFolder,
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

  const baseCtx = (overrides: Partial<EvalContext> = {}): EvalContext => ({
    targetIRI: "obsidian://vault/x/asset.md",
    fileBasename: "asset",
    currentFolder: "x",
    filePath: "x/asset.md",
    ...overrides,
  });

  it("returns false when filePath missing from context", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildAdapter({
        node: buildFile("x/asset.md"),
        frontmatter: { a: "" } as unknown as IFrontmatter,
      }),
    );
    expect(fn(baseCtx({ filePath: undefined }))).toBe(false);
  });

  it("returns false when file not found in vault", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildAdapter({ node: null }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when the node is a folder (no basename)", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildAdapter({ node: { path: "x", name: "x" } as IFolder }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when frontmatter is null", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildAdapter({ node: buildFile("x/asset.md"), frontmatter: null }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when every frontmatter value is non-empty", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildAdapter({
        node: buildFile("x/asset.md"),
        frontmatter: {
          exo__Asset_label: "Some label",
          tags: ["a"],
        } as unknown as IFrontmatter,
      }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it.each([
    ["null value", { exo__Asset_label: "ok", empty: null }],
    ["empty string", { exo__Asset_label: "ok", empty: "" }],
    ["empty array", { exo__Asset_label: "ok", empty: [] }],
    ["empty object", { exo__Asset_label: "ok", empty: {} }],
  ])(
    "returns true when the asset has an empty property — %s",
    (_label, frontmatter) => {
      const fn = createHasEmptyPropertiesHostFunction(
        buildAdapter({
          node: buildFile("x/asset.md"),
          frontmatter: frontmatter as unknown as IFrontmatter,
        }),
      );
      expect(fn(baseCtx())).toBe(true);
    },
  );
});
