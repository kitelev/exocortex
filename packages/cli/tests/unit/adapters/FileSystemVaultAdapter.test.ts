import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";

// Mock exocortex module
jest.unstable_mockModule("exocortex", () => ({
  IVaultAdapter: class {},
  IFile: class {},
  IFolder: class {},
  IFrontmatter: class {},
}));

const { FileSystemVaultAdapter } = await import(
  "../../../src/adapters/FileSystemVaultAdapter.js"
);

describe("FileSystemVaultAdapter", () => {
  const rootPath = "/test/vault";
  let adapter: any;

  let readdirSyncSpy: any;
  let existsSyncSpy: any;

  beforeEach(() => {
    adapter = new FileSystemVaultAdapter(rootPath);
    readdirSyncSpy = jest.spyOn(fs, "readdirSync");
    existsSyncSpy = jest.spyOn(fs, "existsSync");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create adapter with root path", () => {
      const adapter = new FileSystemVaultAdapter("/my/vault");
      expect(adapter).toBeDefined();
    });

    it("should create adapter with folder filter", () => {
      const adapter = new FileSystemVaultAdapter("/my/vault", "subfolder");
      expect(adapter).toBeDefined();
    });
  });

  describe("getAllFiles() with folder filter", () => {
    it("should filter files by folder when folderFilter is set", () => {
      const adapterWithFilter = new FileSystemVaultAdapter(
        rootPath,
        "03 Knowledge"
      );

      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockImplementation((dir: any) => {
        if (dir === "/test/vault/03 Knowledge") {
          return [
            { name: "file1.md", isDirectory: () => false, isFile: () => true },
            { name: "file2.md", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const files = adapterWithFilter.getAllFiles();

      expect(files).toHaveLength(2);
      expect(files[0].path).toBe("03 Knowledge/file1.md");
      expect(files[1].path).toBe("03 Knowledge/file2.md");
    });

    it("should throw error when folder does not exist", () => {
      const adapterWithFilter = new FileSystemVaultAdapter(
        rootPath,
        "nonexistent"
      );

      existsSyncSpy.mockReturnValue(false);

      expect(() => adapterWithFilter.getAllFiles()).toThrow(
        "Folder not found: nonexistent"
      );
    });

    it("should scan entire vault when no folder filter is set", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockImplementation((dir: any) => {
        if (dir === rootPath) {
          return [
            { name: "root.md", isDirectory: () => false, isFile: () => true },
            { name: "folder", isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        if (dir === path.join(rootPath, "folder")) {
          return [
            { name: "nested.md", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const files = adapter.getAllFiles();

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.path)).toContain("root.md");
      expect(files.map((f) => f.path)).toContain("folder/nested.md");
    });

    it("should only include .md files", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockImplementation(() => {
        return [
          { name: "note.md", isDirectory: () => false, isFile: () => true },
          { name: "image.png", isDirectory: () => false, isFile: () => true },
          { name: "data.json", isDirectory: () => false, isFile: () => true },
        ] as any;
      });

      const files = adapter.getAllFiles();

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe("note.md");
    });

    it("should handle nested folder filter path", () => {
      const adapterWithNestedFilter = new FileSystemVaultAdapter(
        rootPath,
        "03 Knowledge/kitelev"
      );

      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockImplementation((dir: any) => {
        if (dir === "/test/vault/03 Knowledge/kitelev") {
          return [
            { name: "personal.md", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const files = adapterWithNestedFilter.getAllFiles();

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe("03 Knowledge/kitelev/personal.md");
    });
  });

  describe("getFirstLinkpathDest() vault-wide search", () => {
    /**
     * Issue #1380: Statement files in Exo 0.0.3 format use wikilinks like [[UUID|alias]]
     * where the UUID file may be in a different directory than the source file.
     *
     * Example: A statement file in exo/ references [[uuid|rdfs:subPropertyOf]]
     * where the anchor file is in rdfs/ directory.
     *
     * The adapter should search the entire vault for matching basenames when
     * relative resolution fails.
     */

    it("should resolve wikilink in same directory (strategy 1)", () => {
      // Setup: source file and target file in same directory
      existsSyncSpy.mockImplementation((filepath: string) => {
        // Relative resolution should find the file
        return filepath === "/test/vault/exo/target-uuid.md";
      });

      const result = adapter.getFirstLinkpathDest(
        "target-uuid",
        "exo/source-file.md"
      );

      expect(result).not.toBeNull();
      expect(result?.path).toBe("exo/target-uuid.md");
    });

    it("should resolve wikilink from vault root (strategy 2)", () => {
      existsSyncSpy.mockImplementation((filepath: string) => {
        // Relative fails, but root-relative works
        return filepath === "/test/vault/target.md";
      });

      const result = adapter.getFirstLinkpathDest(
        "target",
        "subfolder/source.md"
      );

      expect(result).not.toBeNull();
      expect(result?.path).toBe("target.md");
    });

    it("should search entire vault for cross-directory wikilinks (strategy 3)", () => {
      // This is the key fix for Issue #1380
      // Source is in exo/, target is in rdfs/
      existsSyncSpy.mockImplementation((filepath: string) => {
        // Both relative and root-relative resolution fail
        if (filepath === "/test/vault/exo/cross-dir-uuid.md") return false;
        if (filepath === "/test/vault/cross-dir-uuid.md") return false;
        // Vault-wide search finds it
        return false;
      });

      // Mock walkDirectory to find the file in rdfs/
      readdirSyncSpy.mockImplementation((dir: any) => {
        if (dir === rootPath) {
          return [
            { name: "exo", isDirectory: () => true, isFile: () => false },
            { name: "rdfs", isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        if (dir === "/test/vault/exo") {
          return [
            { name: "source-file.md", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        if (dir === "/test/vault/rdfs") {
          return [
            { name: "cross-dir-uuid.md", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const result = adapter.getFirstLinkpathDest(
        "cross-dir-uuid",
        "exo/source-file.md"
      );

      expect(result).not.toBeNull();
      expect(result?.path).toBe("rdfs/cross-dir-uuid.md");
    });

    it("should return null when file not found anywhere in vault", () => {
      existsSyncSpy.mockReturnValue(false);
      readdirSyncSpy.mockImplementation(() => []);

      const result = adapter.getFirstLinkpathDest(
        "nonexistent-uuid",
        "source.md"
      );

      expect(result).toBeNull();
    });

    it("should handle wikilinks with .md extension", () => {
      existsSyncSpy.mockImplementation((filepath: string) => {
        return filepath === "/test/vault/subfolder/target.md";
      });

      const result = adapter.getFirstLinkpathDest(
        "target.md",
        "subfolder/source.md"
      );

      expect(result).not.toBeNull();
      expect(result?.path).toBe("subfolder/target.md");
    });

    it("should prefer relative resolution over vault-wide search", () => {
      // If file exists relative to source, should use that even if another file
      // with same basename exists elsewhere
      existsSyncSpy.mockImplementation((filepath: string) => {
        // Relative resolution finds file in same directory
        return filepath === "/test/vault/folder1/shared-name.md";
      });

      // Even if another file with same name exists in folder2
      readdirSyncSpy.mockImplementation((dir: any) => {
        if (dir === rootPath) {
          return [
            { name: "folder1", isDirectory: () => true, isFile: () => false },
            { name: "folder2", isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        if (dir === "/test/vault/folder1") {
          return [
            { name: "shared-name.md", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        if (dir === "/test/vault/folder2") {
          return [
            { name: "shared-name.md", isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return [];
      });

      const result = adapter.getFirstLinkpathDest(
        "shared-name",
        "folder1/source.md"
      );

      // Should use relative resolution (folder1), not vault-wide search
      expect(result?.path).toBe("folder1/shared-name.md");
    });
  });
});
