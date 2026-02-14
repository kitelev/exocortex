import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";

// Mock exocortex module before import
jest.unstable_mockModule("exocortex", () => ({
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
  });
});
