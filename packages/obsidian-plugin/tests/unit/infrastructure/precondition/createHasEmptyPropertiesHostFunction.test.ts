import { App, TFile, TFolder } from "obsidian";
import { type EvalContext } from "@kitelev/exocortex-core";
import { createHasEmptyPropertiesHostFunction } from "../../../../src/infrastructure/precondition/createHasEmptyPropertiesHostFunction";

describe("createHasEmptyPropertiesHostFunction", () => {
  const buildApp = (opts: {
    file?: TFile | TFolder | null;
    metadata?: Record<string, unknown> | null;
  }): App =>
    ({
      vault: {
        getAbstractFileByPath: jest
          .fn()
          .mockReturnValue(opts.file === undefined ? null : opts.file),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue(
          opts.metadata === null
            ? null
            : { frontmatter: opts.metadata ?? {} },
        ),
      },
    }) as unknown as App;

  const baseCtx = (overrides: Partial<EvalContext> = {}): EvalContext => ({
    targetIRI: "obsidian://vault/x/asset.md",
    fileBasename: "asset",
    currentFolder: "x",
    filePath: "x/asset.md",
    ...overrides,
  });

  it("returns false when filePath missing from context", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildApp({ file: new TFile("x/asset.md"), metadata: { a: "" } }),
    );
    expect(fn(baseCtx({ filePath: undefined }))).toBe(false);
  });

  it("returns false when file not found in vault", () => {
    const fn = createHasEmptyPropertiesHostFunction(buildApp({ file: null }));
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when the abstract file is a folder (not a TFile)", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildApp({ file: new TFolder("x") }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when frontmatter cache is absent", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildApp({ file: new TFile("x/asset.md"), metadata: null }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when the asset has no frontmatter at all (empty object)", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildApp({ file: new TFile("x/asset.md"), metadata: {} }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when every frontmatter value is non-empty", () => {
    const fn = createHasEmptyPropertiesHostFunction(
      buildApp({
        file: new TFile("x/asset.md"),
        metadata: {
          exo__Asset_label: "Some label",
          exo__Asset_uid: "1234",
          tags: ["a", "b"],
        },
      }),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it.each([
    ["null value (`key:`)", { exo__Asset_label: "ok", empty: null }],
    ["empty string", { exo__Asset_label: "ok", empty: "" }],
    ["whitespace-only string", { exo__Asset_label: "ok", empty: "   " }],
    ["empty array", { exo__Asset_label: "ok", empty: [] }],
    ["empty object", { exo__Asset_label: "ok", empty: {} }],
  ])(
    "returns true when the asset has an empty property — %s",
    (_label, metadata) => {
      const fn = createHasEmptyPropertiesHostFunction(
        buildApp({ file: new TFile("x/asset.md"), metadata }),
      );
      expect(fn(baseCtx())).toBe(true);
    },
  );
});
