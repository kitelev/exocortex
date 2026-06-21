import { App, TFile, TFolder } from "obsidian";
import { FolderRepairService, type EvalContext } from "@kitelev/exocortex-core";
import { createIsInWrongFolderHostFunction } from "../../../../src/infrastructure/precondition/createIsInWrongFolderHostFunction";

describe("createIsInWrongFolderHostFunction", () => {
  const buildFile = (path: string): TFile => {
    const file = new TFile(path);
    return file;
  };

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
      buildApp({ file: null }),
      buildService("anywhere"),
    );
    const result = fn(baseCtx({ filePath: undefined }));
    expect(result).toBe(false);
  });

  it("returns false when file not found in vault", () => {
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file: null }),
      buildService("anywhere"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when target is a folder", () => {
    const folder = new TFolder("x");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file: folder }),
      buildService("anywhere"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when expected folder cannot be resolved", () => {
    const file = buildFile("current/folder/asset.md");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file, metadata: {} }),
      buildService(null),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when asset already in expected folder", () => {
    const file = buildFile("current/folder/asset.md");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file, metadata: { exo__Asset_isDefinedBy: "[[Class]]" } }),
      buildService("current/folder"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns false when expected differs only by trailing slash", () => {
    const file = buildFile("current/folder/asset.md");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file, metadata: { exo__Asset_isDefinedBy: "[[Class]]" } }),
      buildService("current/folder/"),
    );
    expect(fn(baseCtx())).toBe(false);
  });

  it("returns true when asset is in wrong folder", () => {
    const file = buildFile("current/folder/asset.md");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file, metadata: { exo__Asset_isDefinedBy: "[[Class]]" } }),
      buildService("expected/folder"),
    );
    expect(fn(baseCtx())).toBe(true);
  });

  it("falls back to file.parent.path when currentFolder missing from ctx", () => {
    const file = buildFile("fallback/asset.md");
    const service = buildService("fallback");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file, metadata: { exo__Asset_isDefinedBy: "[[Class]]" } }),
      service,
    );
    expect(fn(baseCtx({ currentFolder: undefined }))).toBe(false);
  });

  it("returns false for '09 Templates/' files even when otherwise misplaced — revert→fail proof", () => {
    // Templater template carries isDefinedBy by inheritance; resolver says
    // misplaced (expected≠current) but it must never get the Repair Folder
    // button. WITHOUT the 09 Templates skip → true; WITH it → false (RFC 0b7a2fad CR-1).
    const file = buildFile("09 Templates/ts/tmpl.md");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file, metadata: { exo__Asset_isDefinedBy: "[[Class]]" } }),
      buildService("expected/folder"),
    );
    expect(
      fn(
        baseCtx({
          filePath: "09 Templates/ts/tmpl.md",
          currentFolder: "09 Templates/ts",
        }),
      ),
    ).toBe(false);
  });

  it("passes file + metadata to FolderRepairService.getExpectedFolderSync", () => {
    const file = buildFile("current/folder/asset.md");
    const metadata = {
      exo__Asset_isDefinedBy: "[[Class]]",
      otherProp: "x",
    };
    const service = buildService("expected/folder");
    const fn = createIsInWrongFolderHostFunction(
      buildApp({ file, metadata }),
      service,
    );
    fn(baseCtx());
    expect(service.getExpectedFolderSync).toHaveBeenCalledWith(file, metadata);
  });
});
