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
});
