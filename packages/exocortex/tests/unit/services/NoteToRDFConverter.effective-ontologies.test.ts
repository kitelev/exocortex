import "reflect-metadata";
import {
  NoteToRDFConverter,
  shouldSkipFileForEffectiveSet,
} from "../../../src/services/NoteToRDFConverter";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";

/**
 * Issue #3321 / RFC 0a0791c1 — NoteToRDFConverter must honour an optional
 * effective-ontology filter that mirrors the active FocusProfile's allow-set.
 * Files under `assetspaces/<folder>/` whose owning AssetSpace UID is NOT in
 * the set are skipped silently; files outside `assetspaces/` are always
 * emitted.
 *
 * These tests intentionally drive `convertVault` (not just the pure helper)
 * so we exercise the filter through the public API surface the plugin wires
 * via `VaultRDFIndexer`.
 */

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

// AssetSpace UIDs lifted from real vault data (profile-base
// `_alwaysOnOverlay` in `assetspaces/shared-identities/ae00f219-...md`).
const EXO_AS_UID = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";
const EXOCMD_AS_UID = "60967c6a-4e8a-4ee3-8922-db98b981e4f4";
const SHARED_AS_UID = "d1195402-73a5-45ed-965f-3a435a553e6a";
const EMS_AS_UID = "11111111-2222-3333-4444-555555555555"; // synthetic — not in test set

const validFrontmatter: IFrontmatter = {
  exo__Asset_uid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  exo__Asset_label: "Real Task",
  exo__Instance_class: ["[[ems__Task]]"],
};

describe("NoteToRDFConverter — effectiveOntologies (Issue #3321)", () => {
  let converter: NoteToRDFConverter;
  let logger: jest.Mocked<ILogger>;
  let mockVault: jest.Mocked<IVaultAdapter>;

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

  describe("shouldSkipFileForEffectiveSet (pure helper)", () => {
    const folderMap = new Map<string, string>([
      ["assetspaces/exo", EXO_AS_UID],
      ["assetspaces/exocmd", EXOCMD_AS_UID],
      ["assetspaces/ems", EMS_AS_UID],
      ["assetspaces/shared-identities", SHARED_AS_UID],
    ]);

    it("returns false for files outside `assetspaces/` regardless of the set", () => {
      const empty = new Set<string>();
      expect(
        shouldSkipFileForEffectiveSet(
          "03 Knowledge/inbox/note.md",
          empty,
          folderMap,
        ),
      ).toBe(false);
      expect(
        shouldSkipFileForEffectiveSet(
          "01 Inbox/quick.md",
          new Set([EXO_AS_UID]),
          folderMap,
        ),
      ).toBe(false);
    });

    it("returns false for files directly under `assetspaces/` with no nested folder", () => {
      // No AssetSpace folder → no owner → emit (defensive).
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/loose-file.md",
          new Set([EXO_AS_UID]),
          folderMap,
        ),
      ).toBe(false);
    });

    it("returns false when the AssetSpace UID IS in the effective set", () => {
      const eff = new Set([EXO_AS_UID, EXOCMD_AS_UID, SHARED_AS_UID]);
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/exo/Class.md",
          eff,
          folderMap,
        ),
      ).toBe(false);
    });

    it("returns true when the AssetSpace UID is NOT in the effective set", () => {
      const eff = new Set([EXO_AS_UID, EXOCMD_AS_UID, SHARED_AS_UID]);
      // ems is mapped but not in the active set → skip.
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/ems/Task.md",
          eff,
          folderMap,
        ),
      ).toBe(true);
    });

    it("returns false when the folder is NOT in the map (unknown AssetSpace — defensive emit)", () => {
      const eff = new Set([EXO_AS_UID]);
      // `assetspaces/strange-folder` is not mapped → treat as unknown, emit.
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/strange-folder/x.md",
          eff,
          folderMap,
        ),
      ).toBe(false);
    });

    it("normalises backslashes before matching", () => {
      const eff = new Set([EXO_AS_UID]);
      // Defensive: stray backslash in a synthetic path → still routes to ems.
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces\\ems\\Task.md",
          eff,
          folderMap,
        ),
      ).toBe(true);
    });

    it("is case-sensitive on AssetSpace UIDs (Set comparison is exact)", () => {
      const eff = new Set([EXO_AS_UID.toUpperCase()]);
      // Map stores the lowercase form; uppercase in set → no match → skip.
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/exo/Class.md",
          eff,
          folderMap,
        ),
      ).toBe(true);
    });
  });

  // RFC 01a83de8 Phase 1b T3 — after the fleet migration, AssetSpace content
  // lives at the DERIVED two-segment layout `assetspaces/<owner>/<repo>/…` and
  // folderMap keys (from `derivePath(_source)`) are two-segment. The filter must
  // match these via longest path-prefix, NOT a fixed single-segment slice (which
  // silently no-op'd the soft-filter post-migration — advisor catch on PR #3406).
  describe("shouldSkipFileForEffectiveSet — derived two-segment layout (Phase 1b)", () => {
    // Production-shape folderMap: keys are derivePath(_source) results.
    const derivedMap = new Map<string, string>([
      ["assetspaces/kitelev/exoas-exo", EXO_AS_UID],
      ["assetspaces/kitelev/exoas-exocmd", EXOCMD_AS_UID],
      ["assetspaces/kitelev/exoas-ems", EMS_AS_UID],
      ["assetspaces/kitelev/exoas-shared-identities", SHARED_AS_UID],
    ]);

    it("INCLUDES a two-segment content file whose AS is in the effective set", () => {
      const eff = new Set([EXO_AS_UID, EXOCMD_AS_UID, SHARED_AS_UID]);
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/kitelev/exoas-exo/Class.md",
          eff,
          derivedMap,
        ),
      ).toBe(false);
    });

    it("SKIPS a two-segment content file whose AS is NOT in the effective set", () => {
      // Revert-strong: with the old single-segment slice this file's folder
      // would resolve to `assetspaces/kitelev` (absent from derivedMap) →
      // undefined → emit (false). The longest-prefix match resolves it to
      // `assetspaces/kitelev/exoas-ems` → ems not active → skip (true).
      const eff = new Set([EXO_AS_UID, EXOCMD_AS_UID, SHARED_AS_UID]);
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/kitelev/exoas-ems/Task.md",
          eff,
          derivedMap,
        ),
      ).toBe(true);
    });

    it("does NOT false-match a sibling whose key is a string-prefix (the `/` boundary)", () => {
      // `exoas-exocmd` shares the `exoas-exo` string prefix. A file under
      // exocmd must resolve to EXOCMD (and skip, since only exo is active) —
      // NOT be misattributed to the exo sibling. Guards the `${folder}/`
      // boundary in startsWith (a regression dropping the `/` would pass the
      // other tests but fail this one).
      const eff = new Set([EXO_AS_UID]); // exocmd NOT active
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/kitelev/exoas-exocmd/Cmd.md",
          eff,
          derivedMap,
        ),
      ).toBe(true);
    });

    it("matches nested files under the derived folder (deep path)", () => {
      const eff = new Set([EXO_AS_UID]);
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/kitelev/exoas-ems/sub/dir/Deep.md",
          eff,
          derivedMap,
        ),
      ).toBe(true);
    });

    it("emits a two-segment file under an unknown owner/repo (defensive)", () => {
      const eff = new Set([EXO_AS_UID]);
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/kitelev/exoas-unmapped/x.md",
          eff,
          derivedMap,
        ),
      ).toBe(false);
    });

    it("longest-prefix wins when one key is a prefix of another", () => {
      // Defensive: a nested AssetSpace folder must win over its parent.
      const nestedMap = new Map<string, string>([
        ["assetspaces/kitelev", "parent-uid"],
        ["assetspaces/kitelev/exoas-ems", EMS_AS_UID],
      ]);
      const eff = new Set(["parent-uid"]); // ems NOT active
      // File belongs to the deeper ems AS (not the parent) → ems inactive → skip.
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/kitelev/exoas-ems/Task.md",
          eff,
          nestedMap,
        ),
      ).toBe(true);
    });

    it("still supports the legacy single-segment layout (backward-compat)", () => {
      const legacyMap = new Map<string, string>([
        ["assetspaces/ems", EMS_AS_UID],
      ]);
      const eff = new Set([EXO_AS_UID]); // ems NOT active
      expect(
        shouldSkipFileForEffectiveSet(
          "assetspaces/ems/Task.md",
          eff,
          legacyMap,
        ),
      ).toBe(true);
    });
  });

  describe("convertVault — filter engagement contract", () => {
    it("indexes the full vault when `effectiveOntologies` is undefined (backward-compat)", async () => {
      const exoFile = file("assetspaces/exo/Class.md");
      const emsFile = file("assetspaces/ems/Task.md");
      const knowFile = file("03 Knowledge/note.md");
      mockVault.getAllFiles.mockReturnValue([exoFile, emsFile, knowFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      // Use `convertVaultWithValidation` to get a deterministic
      // summary.total — the convertVault wrapper discards it. Counting
      // raw `getFrontmatter` calls is fragile because `convertNote`
      // re-reads frontmatter internally (validate + convert).
      const result = await converter.convertVaultWithValidation({});

      expect(result.summary.total).toBe(3);
      expect(result.summary.indexed).toBe(3);
      expect(result.summary.skipped).toBe(0);
    });

    it("indexes the full vault when called with no options (legacy call shape)", async () => {
      const exoFile = file("assetspaces/exo/Class.md");
      const emsFile = file("assetspaces/ems/Task.md");
      mockVault.getAllFiles.mockReturnValue([exoFile, emsFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      // Call without ANY options — pre-#3321 call shape.
      const triples = await converter.convertVault();

      // Both files contributed triples; backward-compat preserved.
      expect(triples.length).toBeGreaterThan(0);
      expect(mockVault.getAllFiles).toHaveBeenCalledTimes(1);
    });

    it("skips files inside an AssetSpace folder absent from the effective set", async () => {
      const exoFile = file("assetspaces/exo/Class.md");
      const emsFile = file("assetspaces/ems/Task.md");
      const knowFile = file("03 Knowledge/note.md");
      mockVault.getAllFiles.mockReturnValue([exoFile, emsFile, knowFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      const folderMap = new Map<string, string>([
        ["assetspaces/exo", EXO_AS_UID],
        ["assetspaces/ems", EMS_AS_UID],
      ]);
      const effective = new Set<string>([EXO_AS_UID]);

      const result = await converter.convertVaultWithValidation({
        effectiveOntologies: effective,
        assetSpaceFolderToUid: folderMap,
      });

      // exo (in set) + knowFile (non-assetspaces) survive; ems is
      // pre-filtered (silently — not in skippedFiles).
      expect(result.summary.total).toBe(2);
      expect(result.summary.indexed).toBe(2);
      expect(result.summary.skipped).toBe(0);
      expect(result.skippedFiles).toEqual([]);

      // Verify the ems file path never reached convertNote — using a
      // set of unique paths the mock saw (deduped because convertNote
      // reads frontmatter twice per file).
      const visitedPaths = new Set(
        mockVault.getFrontmatter.mock.calls.map(
          (c) => (c[0] as IFile).path,
        ),
      );
      expect(visitedPaths.has(exoFile.path)).toBe(true);
      expect(visitedPaths.has(knowFile.path)).toBe(true);
      expect(visitedPaths.has(emsFile.path)).toBe(false);
    });

    it("always emits files outside `assetspaces/` regardless of the filter", async () => {
      const knowFile = file("03 Knowledge/note.md");
      const inboxFile = file("01 Inbox/quick.md");
      mockVault.getAllFiles.mockReturnValue([knowFile, inboxFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      // Filter active but only `assetspaces/exo` is in the map; the two
      // non-assetspaces files bypass the filter entirely.
      const folderMap = new Map<string, string>([
        ["assetspaces/exo", EXO_AS_UID],
      ]);
      const result = await converter.convertVaultWithValidation({
        effectiveOntologies: new Set<string>([EXO_AS_UID]),
        assetSpaceFolderToUid: folderMap,
      });

      expect(result.summary.total).toBe(2);
      expect(result.summary.indexed).toBe(2);
    });

    it("falls back to no-filter (warn-logged) when the effective set is empty (R15 self-brick guard)", async () => {
      const exoFile = file("assetspaces/exo/Class.md");
      const emsFile = file("assetspaces/ems/Task.md");
      const knowFile = file("03 Knowledge/note.md");
      mockVault.getAllFiles.mockReturnValue([exoFile, emsFile, knowFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      const folderMap = new Map<string, string>([
        ["assetspaces/exo", EXO_AS_UID],
        ["assetspaces/ems", EMS_AS_UID],
      ]);
      const empty = new Set<string>();

      const result = await converter.convertVaultWithValidation({
        effectiveOntologies: empty,
        assetSpaceFolderToUid: folderMap,
      });

      // Filter NOT engaged → every file is indexed (full vault).
      expect(result.summary.total).toBe(3);
      // Warn-log entry surfaced explaining the fall-back.
      const warned = logger.warn.mock.calls.some((c) =>
        typeof c[0] === "string"
          ? c[0].includes("effectiveOntologies is empty")
          : false,
      );
      expect(warned).toBe(true);
    });

    it("falls back to no-filter (warn-logged) when the folder map is missing (caller bug)", async () => {
      const exoFile = file("assetspaces/exo/Class.md");
      const emsFile = file("assetspaces/ems/Task.md");
      mockVault.getAllFiles.mockReturnValue([exoFile, emsFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      // effectiveOntologies non-empty but no folder map → cannot resolve
      // ownership → fall back rather than skip everything.
      const result = await converter.convertVaultWithValidation({
        effectiveOntologies: new Set<string>([EXO_AS_UID]),
      });

      expect(result.summary.total).toBe(2);
      const warned = logger.warn.mock.calls.some((c) =>
        typeof c[0] === "string"
          ? c[0].includes("without assetSpaceFolderToUid")
          : false,
      );
      expect(warned).toBe(true);
    });

    it("composes with `excludedFolders` (exclusion first, then effective-set filter)", async () => {
      const templatesFile = file("09 Templates/broken.md");
      const exoFile = file("assetspaces/exo/Class.md");
      const emsFile = file("assetspaces/ems/Task.md");
      mockVault.getAllFiles.mockReturnValue([templatesFile, exoFile, emsFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      const folderMap = new Map<string, string>([
        ["assetspaces/exo", EXO_AS_UID],
        ["assetspaces/ems", EMS_AS_UID],
      ]);
      const result = await converter.convertVaultWithValidation({
        excludedFolders: ["09 Templates/"],
        effectiveOntologies: new Set<string>([EXO_AS_UID]),
        assetSpaceFolderToUid: folderMap,
      });

      // templates excluded by prefix; ems filtered by effective-set;
      // only exo file reaches convertNote.
      expect(result.summary.total).toBe(1);
      const visitedPaths = new Set(
        mockVault.getFrontmatter.mock.calls.map(
          (c) => (c[0] as IFile).path,
        ),
      );
      expect(visitedPaths.has(exoFile.path)).toBe(true);
      expect(visitedPaths.has(templatesFile.path)).toBe(false);
      expect(visitedPaths.has(emsFile.path)).toBe(false);
    });
  });

  describe("convertVaultWithValidation — summary accounting under filter", () => {
    it("excludes filtered-out files from summary.total (silent skip, like excludedFolders)", async () => {
      const exoFile = file("assetspaces/exo/Class.md");
      const emsFile = file("assetspaces/ems/Task.md");
      mockVault.getAllFiles.mockReturnValue([exoFile, emsFile]);
      mockVault.getFrontmatter.mockReturnValue(validFrontmatter);

      const folderMap = new Map<string, string>([
        ["assetspaces/exo", EXO_AS_UID],
        ["assetspaces/ems", EMS_AS_UID],
      ]);
      const result = await converter.convertVaultWithValidation({
        effectiveOntologies: new Set<string>([EXO_AS_UID]),
        assetSpaceFolderToUid: folderMap,
      });

      // exo IS in set + knowFile would be (none here) → total = 1.
      // ems is silently skipped (semantically out-of-scope, not "broken").
      expect(result.summary.total).toBe(1);
      expect(result.summary.indexed).toBe(1);
      expect(result.summary.skipped).toBe(0);
      // Filtered files MUST NOT appear in skippedFiles diagnostic —
      // they are not "failed validation", they are "out of scope".
      expect(result.skippedFiles).toEqual([]);
    });
  });
});
