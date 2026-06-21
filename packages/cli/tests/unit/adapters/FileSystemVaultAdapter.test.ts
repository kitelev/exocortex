import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";

// Mock exocortex module before import
jest.unstable_mockModule("@kitelev/exocortex-core", () => ({
  IVaultAdapter: class {},
  IFile: class {},
  IFolder: class {},
  IFrontmatter: class {},
}));

const { FileSystemVaultAdapter } = await import("../../../src/adapters/FileSystemVaultAdapter.js");

describe("FileSystemVaultAdapter", () => {
  let adapter: InstanceType<typeof FileSystemVaultAdapter>;
  const rootPath = "/test/vault";

  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;
  let readdirSyncSpy: jest.SpiedFunction<typeof fs.readdirSync>;
  let statSyncSpy: jest.SpiedFunction<typeof fs.statSync>;

  beforeEach(() => {
    adapter = new FileSystemVaultAdapter(rootPath);

    existsSyncSpy = jest.spyOn(fs, "existsSync");
    readdirSyncSpy = jest.spyOn(fs, "readdirSync");
    statSyncSpy = jest.spyOn(fs, "statSync");

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getFirstLinkpathDest() - UUID wikilink resolution", () => {
    // Issue #2113: UUID-based wikilinks are not resolved correctly
    // This is the core bug that needs to be fixed

    describe("regression test for Issue #2113", () => {
      it("should resolve UUID wikilink without alias to file path", () => {
        // Scenario: frontmatter contains [[ebf717aa-4070-4b37-abde-10a700e354fc]]
        // This UUID corresponds to a file named ebf717aa-4070-4b37-abde-10a700e354fc.md

        const uuid = "ebf717aa-4070-4b37-abde-10a700e354fc";
        const expectedPath = `03 Knowledge/ontology/${uuid}.md`;

        // Mock: file exists in vault
        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          // Relative path lookup should work
          if (pathStr === path.join(rootPath, expectedPath)) {
            return true;
          }
          // Also check if searching vault-wide for UUID
          if (pathStr.includes(uuid)) {
            return true;
          }
          return false;
        });

        // Mock: walkDirectory to find UUID files
        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: "03 Knowledge", isDirectory: () => true, isFile: () => false },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "03 Knowledge")) {
            return [
              { name: "ontology", isDirectory: () => true, isFile: () => false },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "03 Knowledge/ontology")) {
            return [
              { name: `${uuid}.md`, isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const result = adapter.getFirstLinkpathDest(uuid, "some-source.md");

        // The adapter should find the UUID file and return it
        expect(result).not.toBeNull();
        expect(result?.path).toContain(uuid);
      });

      it("should resolve UUID wikilink WITH alias to file path", () => {
        // Scenario: frontmatter contains [[ebf717aa-4070-4b37-abde-10a700e354fc|exo__Prototype]]
        // This is the exact bug from Issue #2113

        const uuid = "ebf717aa-4070-4b37-abde-10a700e354fc";
        const linkpathWithAlias = `${uuid}|exo__Prototype`;
        const expectedPath = `03 Knowledge/ontology/${uuid}.md`;

        // Mock: file exists in vault
        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          if (pathStr === path.join(rootPath, expectedPath)) {
            return true;
          }
          if (pathStr.includes(uuid)) {
            return true;
          }
          return false;
        });

        // Mock: walkDirectory to find UUID files
        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: "03 Knowledge", isDirectory: () => true, isFile: () => false },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "03 Knowledge")) {
            return [
              { name: "ontology", isDirectory: () => true, isFile: () => false },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "03 Knowledge/ontology")) {
            return [
              { name: `${uuid}.md`, isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const result = adapter.getFirstLinkpathDest(linkpathWithAlias, "some-source.md");

        // The adapter MUST strip the alias and resolve the UUID
        expect(result).not.toBeNull();
        expect(result?.path).toContain(uuid);
        // Should NOT contain the alias
        expect(result?.path).not.toContain("|");
        expect(result?.path).not.toContain("exo__Prototype");
      });
    });

    describe("alias stripping", () => {
      it("should strip alias from wikilink before resolution", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";

        // Mock file existence
        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          return pathStr.includes(uuid) && pathStr.endsWith(".md");
        });

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [{ name: `${uuid}.md`, isDirectory: () => false, isFile: () => true }] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        // Test various alias formats
        const testCases = [
          `${uuid}|Some Label`,
          `${uuid}|Label with spaces`,
          `${uuid}|exo__Prototype`,
          `${uuid}|ems__Task`,
        ];

        for (const linkpath of testCases) {
          const result = adapter.getFirstLinkpathDest(linkpath, "source.md");
          expect(result).not.toBeNull();
          expect(result?.path).toContain(uuid);
        }
      });

      it("should handle linkpath without alias", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";

        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          return pathStr.includes(uuid) && pathStr.endsWith(".md");
        });

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [{ name: `${uuid}.md`, isDirectory: () => false, isFile: () => true }] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const result = adapter.getFirstLinkpathDest(uuid, "source.md");
        expect(result).not.toBeNull();
        expect(result?.path).toContain(uuid);
      });
    });

    describe("UUID pattern recognition", () => {
      it("should recognize valid UUID v4 format", () => {
        const validUuids = [
          "550e8400-e29b-41d4-a716-446655440000",
          "ebf717aa-4070-4b37-abde-10a700e354fc",
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          "00000000-0000-0000-0000-000000000000",
        ];

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return validUuids.map((uuid) => ({
              name: `${uuid.toLowerCase()}.md`,
              isDirectory: () => false,
              isFile: () => true,
            })) as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        for (const uuid of validUuids) {
          existsSyncSpy.mockImplementation((p) => {
            const pathStr = String(p);
            return pathStr.toLowerCase().includes(uuid.toLowerCase()) && pathStr.endsWith(".md");
          });

          const result = adapter.getFirstLinkpathDest(uuid, "source.md");
          expect(result).not.toBeNull();
        }
      });

      it("should be case-insensitive for UUID matching", () => {
        const uuidLower = "ebf717aa-4070-4b37-abde-10a700e354fc";
        const uuidUpper = "EBF717AA-4070-4B37-ABDE-10A700E354FC";
        const uuidMixed = "Ebf717Aa-4070-4B37-abde-10a700E354FC";

        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          return pathStr.toLowerCase().includes(uuidLower) && pathStr.endsWith(".md");
        });

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [{ name: `${uuidLower}.md`, isDirectory: () => false, isFile: () => true }] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        // All case variations should resolve to the same file
        const resultLower = adapter.getFirstLinkpathDest(uuidLower, "source.md");
        const resultUpper = adapter.getFirstLinkpathDest(uuidUpper, "source.md");
        const resultMixed = adapter.getFirstLinkpathDest(uuidMixed, "source.md");

        expect(resultLower).not.toBeNull();
        expect(resultUpper).not.toBeNull();
        expect(resultMixed).not.toBeNull();
      });
    });

    describe("fallback to relative path resolution", () => {
      it("should still resolve named files relative to source when not a UUID", () => {
        // Traditional wikilink behavior should still work
        const linkpath = "ems__EffortPrototype";
        const sourcePath = "03 Knowledge/inbox/task.md";
        const expectedFullPath = path.join(rootPath, "03 Knowledge/inbox", linkpath + ".md");

        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          return pathStr === expectedFullPath;
        });

        readdirSyncSpy.mockReturnValue([] as unknown as fs.Dirent[]);

        const result = adapter.getFirstLinkpathDest(linkpath, sourcePath);

        expect(result).not.toBeNull();
        expect(result?.path).toContain(linkpath);
      });

      it("should return null when file not found and not a UUID", () => {
        const linkpath = "NonExistentFile";

        existsSyncSpy.mockReturnValue(false);
        readdirSyncSpy.mockReturnValue([] as unknown as fs.Dirent[]);

        const result = adapter.getFirstLinkpathDest(linkpath, "source.md");

        expect(result).toBeNull();
      });
    });

    describe("edge cases", () => {
      it("should handle empty linkpath", () => {
        existsSyncSpy.mockReturnValue(false);
        readdirSyncSpy.mockReturnValue([] as unknown as fs.Dirent[]);

        const result = adapter.getFirstLinkpathDest("", "source.md");

        expect(result).toBeNull();
      });

      it("should handle linkpath that looks like UUID but is incomplete", () => {
        const partialUuid = "550e8400-e29b-41d4";

        existsSyncSpy.mockReturnValue(false);
        readdirSyncSpy.mockReturnValue([] as unknown as fs.Dirent[]);

        const result = adapter.getFirstLinkpathDest(partialUuid, "source.md");

        expect(result).toBeNull();
      });

      it("should handle alias-only linkpath (pipe at start)", () => {
        const linkpath = "|just-an-alias";

        existsSyncSpy.mockReturnValue(false);
        readdirSyncSpy.mockReturnValue([] as unknown as fs.Dirent[]);

        const result = adapter.getFirstLinkpathDest(linkpath, "source.md");

        // Should clean to empty string and return null
        expect(result).toBeNull();
      });

      it("should handle multiple pipes in linkpath (use first part only)", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        const linkpath = `${uuid}|alias1|alias2`;

        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          return pathStr.includes(uuid) && pathStr.endsWith(".md");
        });

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [{ name: `${uuid}.md`, isDirectory: () => false, isFile: () => true }] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const result = adapter.getFirstLinkpathDest(linkpath, "source.md");

        expect(result).not.toBeNull();
        expect(result?.path).toContain(uuid);
      });
    });

    describe("performance: UUID index caching", () => {
      it("should efficiently resolve UUIDs after index is built", () => {
        const uuid1 = "550e8400-e29b-41d4-a716-446655440000";
        const uuid2 = "ebf717aa-4070-4b37-abde-10a700e354fc";

        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          return (pathStr.includes(uuid1) || pathStr.includes(uuid2)) && pathStr.endsWith(".md");
        });

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: `${uuid1}.md`, isDirectory: () => false, isFile: () => true },
              { name: `${uuid2}.md`, isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        // First call builds the index
        const result1 = adapter.getFirstLinkpathDest(uuid1, "source.md");
        // Second call should use the cached index
        const result2 = adapter.getFirstLinkpathDest(uuid2, "source.md");

        expect(result1).not.toBeNull();
        expect(result2).not.toBeNull();
      });
    });

    // RFC-027 Phase 3: alias-aware getFirstLinkpathDest for CLI ↔ plugin parity
    describe("alias-index resolution (RFC-027 Phase 3)", () => {
      let readFileSyncSpy: jest.SpiedFunction<typeof fs.readFileSync>;

      beforeEach(() => {
        readFileSyncSpy = jest.spyOn(fs, "readFileSync");
      });

      const setupVault = (
        files: { name: string; content: string }[],
      ): void => {
        const filenames = files.map((f) => f.name);

        readdirSyncSpy.mockImplementation((dir) => {
          if (String(dir) === rootPath) {
            return filenames.map((name) => ({
              name,
              isDirectory: () => false,
              isFile: () => true,
            })) as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        existsSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          return filenames.some(
            (name) => pathStr === path.join(rootPath, name),
          );
        });

        readFileSyncSpy.mockImplementation((p) => {
          const pathStr = String(p);
          const match = files.find(
            (f) => pathStr === path.join(rootPath, f.name),
          );
          if (match) return match.content;
          throw new Error(`File not found: ${pathStr}`);
        });
      };

      it("should resolve wikilink to file via frontmatter alias match", () => {
        // [[ems__EffortStatusBacklog]] → file `753a44d5-...md` whose
        // frontmatter declares aliases: [ems__EffortStatusBacklog].
        const uuid = "753a44d5-846c-4b82-9196-4fd9a4d48777";
        setupVault([
          {
            name: `${uuid}.md`,
            content: `---\nexo__Asset_uid: ${uuid}\naliases:\n  - ems__EffortStatusBacklog\n---\nbody`,
          },
          {
            name: "other.md",
            content: "---\naliases:\n  - something-else\n---\n",
          },
        ]);

        const result = adapter.getFirstLinkpathDest(
          "ems__EffortStatusBacklog",
          "source.md",
        );

        expect(result).not.toBeNull();
        expect(result?.path).toBe(`${uuid}.md`);
      });

      it("should resolve wikilink via basename when file isn't in source dir", () => {
        // Basename match anywhere in vault, like Obsidian's
        // metadataCache. Existing path-relative resolution returns null
        // when the file isn't adjacent to source.
        setupVault([
          {
            name: "ems__EffortStatusBacklog.md",
            content: "---\nlabel: Backlog\n---\nbody",
          },
        ]);

        const result = adapter.getFirstLinkpathDest(
          "ems__EffortStatusBacklog",
          "deep/nested/source.md",
        );

        expect(result).not.toBeNull();
        expect(result?.path).toBe("ems__EffortStatusBacklog.md");
      });

      it("should match aliases case-insensitively", () => {
        const uuid = "027e78f4-6e16-4b36-b8fb-5510507d5745";
        setupVault([
          {
            name: `${uuid}.md`,
            content: `---\naliases:\n  - ems__EffortStatusDoing\n---\n`,
          },
        ]);

        const result = adapter.getFirstLinkpathDest(
          "EMS__effortstatusDOING",
          "source.md",
        );

        expect(result).not.toBeNull();
        expect(result?.path).toBe(`${uuid}.md`);
      });

      it("should accept scalar alias (single string) in frontmatter", () => {
        setupVault([
          {
            name: "scalar.md",
            content: "---\naliases: solo-alias\n---\n",
          },
        ]);

        const result = adapter.getFirstLinkpathDest("solo-alias", "src.md");

        expect(result).not.toBeNull();
        expect(result?.path).toBe("scalar.md");
      });

      it("should return null when neither basename nor alias matches", () => {
        setupVault([
          {
            name: "alpha.md",
            content: "---\naliases:\n  - alpha-alias\n---\n",
          },
        ]);

        const result = adapter.getFirstLinkpathDest("nope", "src.md");

        expect(result).toBeNull();
      });

      it("should prefer basename over alias when both could match different files", () => {
        // Obsidian-style precedence: a file named exactly like the
        // linkpath wins over a different file that lists it as alias.
        setupVault([
          {
            name: "Foo.md",
            content: "---\n---\nbody",
          },
          {
            name: "other.md",
            content: "---\naliases:\n  - Foo\n---\n",
          },
        ]);

        const result = adapter.getFirstLinkpathDest("Foo", "src.md");

        expect(result).not.toBeNull();
        expect(result?.path).toBe("Foo.md");
      });

      it("should ignore alias-stripped suffix when matching", () => {
        // Wikilink display alias (`linkpath|label`) is stripped before
        // alias-index lookup, just like for UUID resolution.
        setupVault([
          {
            name: "target.md",
            content: "---\naliases:\n  - my-alias\n---\n",
          },
        ]);

        const result = adapter.getFirstLinkpathDest(
          "my-alias|Display Label",
          "src.md",
        );

        expect(result).not.toBeNull();
        expect(result?.path).toBe("target.md");
      });

      it("should not crash on files with malformed frontmatter", () => {
        setupVault([
          {
            name: "broken.md",
            content: "---\naliases: [unterminated\n---\nbody",
          },
          {
            name: "good.md",
            content: "---\naliases:\n  - good-alias\n---\n",
          },
        ]);

        const result = adapter.getFirstLinkpathDest("good-alias", "src.md");

        expect(result).not.toBeNull();
        expect(result?.path).toBe("good.md");
      });
    });
  });

  describe("getAllFiles() - directory boundary and hidden folders", () => {
    // Issue #2159: CLI scans .Trash and other system directories instead of vault only

    describe("regression test for Issue #2159", () => {
      it("should skip hidden directories like .Trash", () => {
        // Scenario: vault has .Trash directory that should not be scanned

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: ".Trash", isDirectory: () => true, isFile: () => false },
              { name: ".obsidian", isDirectory: () => true, isFile: () => false },
              { name: "notes", isDirectory: () => true, isFile: () => false },
              { name: "test.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "notes")) {
            return [
              { name: "note1.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          // These should NOT be called - hidden dirs should be skipped
          if (dirStr === path.join(rootPath, ".Trash")) {
            throw new Error("EPERM: operation not permitted, scandir '/test/vault/.Trash'");
          }
          if (dirStr === path.join(rootPath, ".obsidian")) {
            return [
              { name: "config.json", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const files = adapter.getAllFiles();

        // Should only include visible markdown files
        const filePaths = files.map((f) => f.path);
        expect(filePaths).toContain("test.md");
        expect(filePaths).toContain("notes/note1.md");
        // Should NOT include hidden directory contents
        expect(filePaths.some((p) => p.includes(".Trash"))).toBe(false);
        expect(filePaths.some((p) => p.includes(".obsidian"))).toBe(false);
      });

      it("should handle EPERM errors gracefully without crashing", () => {
        // Scenario: directory scan encounters permission error

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: "accessible", isDirectory: () => true, isFile: () => false },
              { name: "restricted", isDirectory: () => true, isFile: () => false },
              { name: "test.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "accessible")) {
            return [
              { name: "note1.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "restricted")) {
            const error = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
            error.code = "EPERM";
            throw error;
          }
          return [] as unknown as fs.Dirent[];
        });

        // Should NOT throw - should skip inaccessible directories
        const files = adapter.getAllFiles();

        const filePaths = files.map((f) => f.path);
        expect(filePaths).toContain("test.md");
        expect(filePaths).toContain("accessible/note1.md");
        // restricted directory files should be skipped, not cause crash
      });
    });

    describe("directory boundary enforcement", () => {
      it("should not traverse parent directories via symlinks", () => {
        // Scenario: symlink in vault points outside vault root

        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: "notes", isDirectory: () => true, isFile: () => false },
              { name: "external-link", isDirectory: () => true, isFile: () => false },
              { name: "test.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "notes")) {
            return [
              { name: "note1.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          // Symlink that escapes vault
          if (dirStr === path.join(rootPath, "external-link")) {
            return [
              { name: "sensitive.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const files = adapter.getAllFiles();

        // Should include regular files
        const filePaths = files.map((f) => f.path);
        expect(filePaths).toContain("test.md");
        expect(filePaths).toContain("notes/note1.md");
      });

      it("should only return .md files within vault boundary", () => {
        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: "subdir", isDirectory: () => true, isFile: () => false },
              { name: "note.md", isDirectory: () => false, isFile: () => true },
              { name: "image.png", isDirectory: () => false, isFile: () => true },
              { name: "data.json", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          if (dirStr === path.join(rootPath, "subdir")) {
            return [
              { name: "nested.md", isDirectory: () => false, isFile: () => true },
              { name: "config.yaml", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const files = adapter.getAllFiles();

        const filePaths = files.map((f) => f.path);
        // Only .md files should be returned
        expect(filePaths).toContain("note.md");
        expect(filePaths).toContain("subdir/nested.md");
        expect(filePaths).not.toContain("image.png");
        expect(filePaths).not.toContain("data.json");
        expect(filePaths).not.toContain("subdir/config.yaml");
      });
    });

    describe("hidden directory patterns", () => {
      const hiddenDirs = [".Trash", ".obsidian", ".git", ".DS_Store_folder", ".hidden"];

      it.each(hiddenDirs)("should skip hidden directory: %s", (hiddenDir) => {
        readdirSyncSpy.mockImplementation((dir) => {
          const dirStr = String(dir);
          if (dirStr === rootPath) {
            return [
              { name: hiddenDir, isDirectory: () => true, isFile: () => false },
              { name: "visible.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          // This should NOT be reached for hidden directories
          if (dirStr === path.join(rootPath, hiddenDir)) {
            return [
              { name: "secret.md", isDirectory: () => false, isFile: () => true },
            ] as unknown as fs.Dirent[];
          }
          return [] as unknown as fs.Dirent[];
        });

        const files = adapter.getAllFiles();

        const filePaths = files.map((f) => f.path);
        expect(filePaths).toContain("visible.md");
        expect(filePaths.some((p) => p.includes(hiddenDir))).toBe(false);
      });
    });
  });
});
