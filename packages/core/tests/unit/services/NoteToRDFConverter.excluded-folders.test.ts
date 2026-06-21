import "reflect-metadata";
import {
  NoteToRDFConverter,
  normaliseExcludedFolders,
  isPathExcluded,
} from "../../../src/services/NoteToRDFConverter";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";

function createMockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function file(path: string): IFile {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return {
    path,
    basename: name.replace(/\.md$/, ""),
    name,
    parent: null,
  };
}

describe("NoteToRDFConverter — excludedFolders", () => {
  let converter: NoteToRDFConverter;
  let logger: jest.Mocked<ILogger>;
  let mockVault: jest.Mocked<IVaultAdapter>;

  // A frontmatter shape that would normally trigger an invariant violation:
  // exo__Instance_class is present but empty. The converter's
  // `validateExocortexAsset` flags this as `EMPTY_PROPERTY` and emits a
  // "Skipping file with invariant violation" info-log entry plus an
  // aggregated end-of-walk summary warn (Issue #3468).
  const invariantViolatingFrontmatter: IFrontmatter = {
    exo__Asset_uid: "11111111-2222-3333-4444-555555555555",
    exo__Asset_label: "Template",
    exo__Instance_class: "",
  };

  // A well-formed frontmatter that passes validation.
  const validFrontmatter: IFrontmatter = {
    exo__Asset_uid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    exo__Asset_label: "Real Task",
    exo__Instance_class: ["[[ems__Task]]"],
  };

  beforeEach(() => {
    logger = createMockLogger();
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
    converter = new NoteToRDFConverter(mockVault, logger);
  });

  describe("normaliseExcludedFolders", () => {
    it("returns empty array for undefined", () => {
      expect(normaliseExcludedFolders(undefined)).toEqual([]);
    });

    it("returns empty array for non-array input", () => {
      // Cast through `unknown` because the JSON-persisted settings file can
      // legitimately contain non-array shapes after manual edits — the
      // production helper must defend against this.
      expect(
        normaliseExcludedFolders("not-an-array" as unknown as string[]),
      ).toEqual([]);
    });

    it("drops empty and whitespace-only entries", () => {
      expect(
        normaliseExcludedFolders(["09 Templates/", "", "   ", "10 Drafts/"]),
      ).toEqual(["09 Templates/", "10 Drafts/"]);
    });

    it("trims surrounding whitespace from entries", () => {
      expect(normaliseExcludedFolders(["  09 Templates/  "])).toEqual([
        "09 Templates/",
      ]);
    });

    it("converts backslashes to forward slashes", () => {
      expect(normaliseExcludedFolders(["09 Templates\\sub\\"])).toEqual([
        "09 Templates/sub/",
      ]);
    });

    it("coerces non-string entries via String()", () => {
      // Defensive: a corrupted settings JSON could carry a number where a
      // string is expected. The helper must not crash, and the resulting
      // prefix should be the numeric stringification — with the auto-
      // appended trailing slash applied to the coerced form too.
      expect(
        normaliseExcludedFolders([123 as unknown as string, "ok/"]),
      ).toEqual(["123/", "ok/"]);
    });

    it("auto-appends a trailing slash when missing (closes sibling-folder footgun)", () => {
      // A user typing "09 Templates" (no slash) overwhelmingly means
      // "the 09 Templates folder", not "any path starting with that
      // string". Without normalisation a bare-string prefix would also
      // match sibling folders like "09 Templates Archive/".
      expect(
        normaliseExcludedFolders(["09 Templates", "10 Drafts/"]),
      ).toEqual(["09 Templates/", "10 Drafts/"]);
    });

    it("auto-append prevents sibling-folder over-match end-to-end", () => {
      // Demonstrates the user-visible benefit of auto-append: a user entry
      // without trailing slash MUST NOT silently exclude a sibling that
      // shares a name prefix.
      const prefixes = normaliseExcludedFolders(["09 Templates"]);
      expect(isPathExcluded("09 Templates Archive/foo.md", prefixes)).toBe(
        false,
      );
      expect(isPathExcluded("09 Templates/foo.md", prefixes)).toBe(true);
    });
  });

  describe("isPathExcluded", () => {
    it("returns false when prefix list is empty", () => {
      expect(isPathExcluded("09 Templates/foo.md", [])).toBe(false);
    });

    it("returns true when path starts with a prefix", () => {
      expect(
        isPathExcluded("09 Templates/foo.md", ["09 Templates/"]),
      ).toBe(true);
    });

    it("returns false when path only shares a name prefix without trailing slash boundary", () => {
      // With a trailing-slash prefix this sibling MUST NOT match.
      expect(
        isPathExcluded("09 Templates Archive/foo.md", ["09 Templates/"]),
      ).toBe(false);
    });

    it("is case-sensitive (mirrors Obsidian vault paths on case-sensitive FS)", () => {
      expect(
        isPathExcluded("09 templates/foo.md", ["09 Templates/"]),
      ).toBe(false);
    });

    it("normalises backslashes in file paths before matching", () => {
      // The plugin's `file.path` is forward-slash on every platform we
      // support, but defending against a stray backslash is cheap.
      expect(
        isPathExcluded("09 Templates\\foo.md", ["09 Templates/"]),
      ).toBe(true);
    });

    it("returns true if ANY prefix matches", () => {
      expect(
        isPathExcluded("10 Drafts/x.md", ["09 Templates/", "10 Drafts/"]),
      ).toBe(true);
    });
  });

  describe("convertVaultWithValidation — folder exclusion", () => {
    it("skips files in excluded folders WITHOUT emitting an invariant-violation warn-log", async () => {
      const templatesFile = file("09 Templates/broken.md");
      const realFile = file("03 Knowledge/valid.md");

      mockVault.getAllFiles.mockReturnValue([templatesFile, realFile]);
      mockVault.getFrontmatter.mockImplementation((f) => {
        if (f.path === templatesFile.path) return invariantViolatingFrontmatter;
        if (f.path === realFile.path) return validFrontmatter;
        return null;
      });

      const result = await converter.convertVaultWithValidation({
        excludedFolders: ["09 Templates/"],
      });

      // 1. summary.total counts ONLY the non-excluded files: excluded files
      //    are invisible to the validation pipeline (per the user-facing
      //    contract — they should not appear in any "skipped X files"
      //    diagnostic either).
      expect(result.summary.total).toBe(1);
      expect(result.summary.indexed).toBe(1);
      expect(result.summary.skipped).toBe(0);

      // 2. skippedFiles must not mention the templates file.
      expect(
        result.skippedFiles.find((s) => s.path === templatesFile.path),
      ).toBeUndefined();

      // 3. Most importantly: no "Skipping file with invariant violation"
      //    info-log entry (Issue #3468 moved the per-file detail to info),
      //    and no aggregated summary warn — that warn drives the
      //    user-visible Notice the feature is supposed to silence.
      const infoCalls = logger.info.mock.calls;
      const invariantInfo = infoCalls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("Skipping file with invariant violation") &&
          call[0].includes(templatesFile.path),
      );
      expect(invariantInfo).toBeUndefined();
      const summaryWarn = logger.warn.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("invariant violation"),
      );
      expect(summaryWarn).toBeUndefined();
    });

    it("keeps validating files OUTSIDE excluded folders (no false-positive suppression)", async () => {
      const templatesFile = file("09 Templates/broken.md");
      // This non-excluded file ALSO has the invariant violation. We need
      // the warn-log + skippedFiles record to still fire for it, otherwise
      // the feature would silently swallow ALL validation errors.
      const brokenRealFile = file("03 Knowledge/broken.md");

      mockVault.getAllFiles.mockReturnValue([templatesFile, brokenRealFile]);
      mockVault.getFrontmatter.mockImplementation((f) => {
        if (f.path === templatesFile.path) return invariantViolatingFrontmatter;
        if (f.path === brokenRealFile.path)
          return invariantViolatingFrontmatter;
        return null;
      });

      const result = await converter.convertVaultWithValidation({
        excludedFolders: ["09 Templates/"],
      });

      expect(result.summary.total).toBe(1);
      expect(result.summary.skipped).toBe(1);
      expect(result.skippedFiles[0].path).toBe(brokenRealFile.path);

      // Issue #3468: per-file detail is on the info channel; the warn
      // channel carries the aggregated end-of-walk summary (with count).
      const infoCalls = logger.info.mock.calls;
      const invariantInfo = infoCalls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("Skipping file with invariant violation") &&
          call[0].includes(brokenRealFile.path),
      );
      expect(invariantInfo).toBeDefined();
      const summaryWarn = logger.warn.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("Skipped 1 file with invariant violations"),
      );
      expect(summaryWarn).toBeDefined();
    });

    it("treats an empty excludedFolders list as a no-op (legacy behaviour preserved)", async () => {
      const templatesFile = file("09 Templates/broken.md");
      mockVault.getAllFiles.mockReturnValue([templatesFile]);
      mockVault.getFrontmatter.mockReturnValue(invariantViolatingFrontmatter);

      const result = await converter.convertVaultWithValidation({});

      expect(result.summary.total).toBe(1);
      expect(result.summary.skipped).toBe(1);
      expect(result.skippedFiles[0].path).toBe(templatesFile.path);
    });

    it("supports multiple excluded prefixes", async () => {
      const a = file("09 Templates/x.md");
      const b = file("10 Drafts/y.md");
      const c = file("03 Knowledge/z.md");
      mockVault.getAllFiles.mockReturnValue([a, b, c]);
      mockVault.getFrontmatter.mockImplementation((f) => {
        if (f.path === c.path) return validFrontmatter;
        return invariantViolatingFrontmatter;
      });

      const result = await converter.convertVaultWithValidation({
        excludedFolders: ["09 Templates/", "10 Drafts/"],
      });

      expect(result.summary.total).toBe(1);
      expect(result.summary.indexed).toBe(1);
      expect(result.summary.skipped).toBe(0);
    });

    it("ignores empty/whitespace prefixes to prevent excluding the entire vault", async () => {
      const realFile = file("03 Knowledge/valid.md");
      mockVault.getAllFiles.mockReturnValue([realFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      // An empty string would prefix-match every path. The normalisation
      // helper drops it; the result here proves the converter still sees
      // the real file and indexes it.
      const result = await converter.convertVaultWithValidation({
        excludedFolders: ["", "   "],
      });

      expect(result.summary.total).toBe(1);
      expect(result.summary.indexed).toBe(1);
    });
  });

  describe("convertVault — folder exclusion plumbing", () => {
    it("forwards excludedFolders to convertVaultWithValidation", async () => {
      const templatesFile = file("09 Templates/broken.md");
      const realFile = file("03 Knowledge/valid.md");
      mockVault.getAllFiles.mockReturnValue([templatesFile, realFile]);
      mockVault.getFrontmatter.mockImplementation((f) => {
        if (f.path === templatesFile.path) return invariantViolatingFrontmatter;
        return validFrontmatter;
      });

      const triples = await converter.convertVault({
        excludedFolders: ["09 Templates/"],
      });

      // Only the valid file contributed triples; the templates file was
      // pre-filtered and never reached convertNote.
      const subjects = new Set(triples.map((t) => t.subject.toString()));
      const templatesSubject = `obsidian://vault/${encodeURI(templatesFile.path)}`;
      expect(subjects.has(templatesSubject)).toBe(false);
    });
  });
});
