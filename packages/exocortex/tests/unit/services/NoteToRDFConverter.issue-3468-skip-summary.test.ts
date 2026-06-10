import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";

// Issue #3468: bulk indexing must not produce one Notice-routed warn per
// skipped file. Per-file detail goes to info (console channel); the warn
// channel gets at most ONE aggregated summary per skip category, and none
// at all when nothing was skipped. The default warn→Notice routing is
// untouched — this suite pins the converter-side aggregation contract.

function createMockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function mkFile(path: string): IFile {
  const name = path.split("/").pop()!;
  return {
    path,
    basename: name.replace(/\.md$/, ""),
    name,
    parent: null,
  };
}

// Empty exo__Instance_class → EMPTY_PROPERTY invariant violation.
const invariantViolatingFrontmatter = {
  exo__Asset_uid: "11111111-2222-3333-4444-555555555555",
  exo__Asset_label: "Broken",
  exo__Instance_class: "",
};

describe("NoteToRDFConverter — aggregated skip summary (Issue #3468)", () => {
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;
  });

  it("emits exactly one summary warn for N invalid-IRI files, with per-file details on info", async () => {
    const files = [mkFile("a.md"), mkFile("b.md"), mkFile("c.md")];
    mockVault.getAllFiles.mockReturnValue(files);
    mockVault.getFrontmatter.mockImplementation(() => {
      throw new Error("Simulated IRI error");
    });

    const logger = createMockLogger();
    const converter = new NoteToRDFConverter(mockVault, logger);

    const result = await converter.convertVaultWithValidation();

    expect(result.summary.skipped).toBe(3);
    // Per-file details: one info per file, each carrying the path
    expect(logger.info).toHaveBeenCalledTimes(3);
    for (const f of files) {
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(f.path),
        expect.anything(),
      );
    }
    // Exactly ONE warn for the whole walk, count in the message string
    // (Notice/file channels only receive the top-level message).
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipped 3 files with invalid IRI"),
      expect.anything(),
    );
  });

  it("emits no warn at all when nothing is skipped", async () => {
    mockVault.getAllFiles.mockReturnValue([mkFile("ok.md")]);
    mockVault.getFrontmatter.mockReturnValue({ exo__Asset_label: "OK" });

    const logger = createMockLogger();
    const converter = new NoteToRDFConverter(mockVault, logger);

    const result = await converter.convertVaultWithValidation();

    expect(result.summary.skipped).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("emits one summary warn per category (invariant violation + invalid IRI)", async () => {
    const invariantFile = mkFile("invariant.md");
    const iriFile1 = mkFile("iri1.md");
    const iriFile2 = mkFile("iri2.md");
    mockVault.getAllFiles.mockReturnValue([invariantFile, iriFile1, iriFile2]);
    mockVault.getFrontmatter.mockImplementation((f) => {
      if (f.path === invariantFile.path) return invariantViolatingFrontmatter;
      throw new Error("Simulated IRI error");
    });

    const logger = createMockLogger();
    const converter = new NoteToRDFConverter(mockVault, logger);

    const result = await converter.convertVaultWithValidation();

    expect(result.summary.skipped).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipped 1 file with invariant violations"),
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipped 2 files with invalid IRI"),
      expect.anything(),
    );
  });

  it("uses singular wording for a single skipped file", async () => {
    mockVault.getAllFiles.mockReturnValue([mkFile("only.md")]);
    mockVault.getFrontmatter.mockImplementation(() => {
      throw new Error("Simulated IRI error");
    });

    const logger = createMockLogger();
    const converter = new NoteToRDFConverter(mockVault, logger);

    await converter.convertVaultWithValidation();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0][0] as string;
    expect(message).toContain("Skipped 1 file with invalid IRI");
    expect(message).not.toContain("1 files");
  });

  it("strict mode still throws on the first bad file (no summary warn emitted)", async () => {
    mockVault.getAllFiles.mockReturnValue([mkFile("bad.md")]);
    mockVault.getFrontmatter.mockImplementation(() => {
      throw new Error("Simulated IRI error");
    });

    const logger = createMockLogger();
    const converter = new NoteToRDFConverter(mockVault, logger);

    await expect(
      converter.convertVaultWithValidation({ strict: true }),
    ).rejects.toThrow("Invalid IRI");
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
