import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";

// Create mock for glob
const mockGlob = jest.fn();

// Mock modules before importing NodeFsAdapter
jest.unstable_mockModule("glob", () => ({
  glob: mockGlob,
}));

jest.unstable_mockModule("exocortex", () => ({
  FileNotFoundError: class FileNotFoundError extends Error {
    constructor(msg: string) {
      super(`File not found: ${msg}`);
      this.name = "FileNotFoundError";
    }
  },
  FileAlreadyExistsError: class FileAlreadyExistsError extends Error {
    constructor(msg: string) {
      super(`File already exists: ${msg}`);
      this.name = "FileAlreadyExistsError";
    }
  },
  IFileSystemAdapter: class {},
}));

const { NodeFsAdapter } = await import("../../../src/adapters/NodeFsAdapter.js");

describe("NodeFsAdapter", () => {
  let adapter: InstanceType<typeof NodeFsAdapter>;
  const rootPath = "/test/vault";

  let pathExistsSpy: jest.SpiedFunction<typeof fs.pathExists>;
  let readFileSpy: jest.SpiedFunction<typeof fs.readFile>;
  let writeFileSpy: jest.SpiedFunction<typeof fs.writeFile>;
  let ensureDirSpy: jest.SpiedFunction<typeof fs.ensureDir>;
  let removeSpy: jest.SpiedFunction<typeof fs.remove>;
  let moveSpy: jest.SpiedFunction<typeof fs.move>;
  let statSpy: jest.SpiedFunction<typeof fs.stat>;

  beforeEach(() => {
    adapter = new NodeFsAdapter(rootPath);

    pathExistsSpy = jest.spyOn(fs, "pathExists");
    readFileSpy = jest.spyOn(fs, "readFile");
    writeFileSpy = jest.spyOn(fs, "writeFile");
    ensureDirSpy = jest.spyOn(fs, "ensureDir");
    removeSpy = jest.spyOn(fs, "remove");
    moveSpy = jest.spyOn(fs, "move");
    statSpy = jest.spyOn(fs, "stat");

    mockGlob.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("readFile()", () => {
    it("should read file content successfully", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("# Test Content" as any);

      const result = await adapter.readFile("test.md");

      expect(result).toBe("# Test Content");
      expect(pathExistsSpy).toHaveBeenCalledWith("/test/vault/test.md");
      expect(readFileSpy).toHaveBeenCalledWith("/test/vault/test.md", "utf-8");
    });

    it("should throw FileNotFoundError if file does not exist", async () => {
      pathExistsSpy.mockResolvedValue(false as any);

      await expect(adapter.readFile("missing.md")).rejects.toThrow("File not found");
    });

    it("should handle absolute paths", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("content" as any);

      await adapter.readFile("/absolute/path/file.md");

      expect(pathExistsSpy).toHaveBeenCalledWith("/absolute/path/file.md");
    });

    it("should handle nested paths", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("nested content" as any);

      await adapter.readFile("folder/subfolder/file.md");

      expect(pathExistsSpy).toHaveBeenCalledWith("/test/vault/folder/subfolder/file.md");
    });
  });

  describe("fileExists()", () => {
    it("should return true if file exists", async () => {
      pathExistsSpy.mockResolvedValue(true as any);

      const result = await adapter.fileExists("test.md");

      expect(result).toBe(true);
      expect(pathExistsSpy).toHaveBeenCalledWith("/test/vault/test.md");
    });

    it("should return false if file does not exist", async () => {
      pathExistsSpy.mockResolvedValue(false as any);

      const result = await adapter.fileExists("missing.md");

      expect(result).toBe(false);
    });
  });

  describe("getFileMetadata()", () => {
    it("should extract frontmatter from file", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("---\ntitle: Test\nauthor: John\n---\n# Content" as any);

      const result = await adapter.getFileMetadata("test.md");

      expect(result).toEqual({ title: "Test", author: "John" });
    });

    it("should return empty object if no frontmatter", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("# Just content" as any);

      const result = await adapter.getFileMetadata("test.md");

      expect(result).toEqual({});
    });

    it("should return empty object for invalid YAML", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("---\n  invalid: yaml:\n  broken\n---\n# Content" as any);

      const result = await adapter.getFileMetadata("test.md");

      expect(result).toEqual({});
    });

    it("should handle complex frontmatter", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue(`---
exo__Asset_uid: task-123
exo__Asset_label: My Task
aliases:
  - Task 1
  - My Task
---
# Content` as any);

      const result = await adapter.getFileMetadata("test.md");

      expect(result.exo__Asset_uid).toBe("task-123");
      expect(result.exo__Asset_label).toBe("My Task");
      expect(result.aliases).toEqual(["Task 1", "My Task"]);
    });
  });

  describe("createFile()", () => {
    it("should create file successfully", async () => {
      pathExistsSpy.mockResolvedValue(false as any);
      ensureDirSpy.mockResolvedValue(undefined as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      const result = await adapter.createFile("new-file.md", "# New content");

      expect(result).toBe("new-file.md");
      expect(ensureDirSpy).toHaveBeenCalledWith("/test/vault");
      expect(writeFileSpy).toHaveBeenCalledWith("/test/vault/new-file.md", "# New content", "utf-8");
    });

    it("should throw FileAlreadyExistsError if file exists", async () => {
      pathExistsSpy.mockResolvedValue(true as any);

      await expect(adapter.createFile("existing.md", "content")).rejects.toThrow("File already exists");
    });

    it("should create parent directories", async () => {
      pathExistsSpy.mockResolvedValue(false as any);
      ensureDirSpy.mockResolvedValue(undefined as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await adapter.createFile("deep/nested/path/file.md", "content");

      expect(ensureDirSpy).toHaveBeenCalledWith("/test/vault/deep/nested/path");
    });
  });

  describe("updateFile()", () => {
    it("should update file content", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await adapter.updateFile("test.md", "# Updated content");

      expect(writeFileSpy).toHaveBeenCalledWith("/test/vault/test.md", "# Updated content", "utf-8");
    });

    it("should throw FileNotFoundError if file does not exist", async () => {
      pathExistsSpy.mockResolvedValue(false as any);

      await expect(adapter.updateFile("missing.md", "content")).rejects.toThrow("File not found");
    });
  });

  describe("writeFile()", () => {
    it("should write file content", async () => {
      ensureDirSpy.mockResolvedValue(undefined as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await adapter.writeFile("test.md", "# Content");

      expect(ensureDirSpy).toHaveBeenCalledWith("/test/vault");
      expect(writeFileSpy).toHaveBeenCalledWith("/test/vault/test.md", "# Content", "utf-8");
    });

    it("should create parent directories", async () => {
      ensureDirSpy.mockResolvedValue(undefined as any);
      writeFileSpy.mockResolvedValue(undefined as any);

      await adapter.writeFile("folder/file.md", "content");

      expect(ensureDirSpy).toHaveBeenCalledWith("/test/vault/folder");
    });
  });

  describe("deleteFile()", () => {
    it("should delete file successfully", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      removeSpy.mockResolvedValue(undefined as any);

      await adapter.deleteFile("test.md");

      expect(removeSpy).toHaveBeenCalledWith("/test/vault/test.md");
    });

    it("should throw FileNotFoundError if file does not exist", async () => {
      pathExistsSpy.mockResolvedValue(false as any);

      await expect(adapter.deleteFile("missing.md")).rejects.toThrow("File not found");
    });
  });

  describe("renameFile()", () => {
    it("should rename file successfully", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      ensureDirSpy.mockResolvedValue(undefined as any);
      moveSpy.mockResolvedValue(undefined as any);

      await adapter.renameFile("old.md", "new.md");

      expect(moveSpy).toHaveBeenCalledWith("/test/vault/old.md", "/test/vault/new.md");
    });

    it("should throw FileNotFoundError if source does not exist", async () => {
      pathExistsSpy.mockResolvedValue(false as any);

      await expect(adapter.renameFile("missing.md", "new.md")).rejects.toThrow("File not found");
    });

    it("should create target directory if needed", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      ensureDirSpy.mockResolvedValue(undefined as any);
      moveSpy.mockResolvedValue(undefined as any);

      await adapter.renameFile("old.md", "new-folder/new.md");

      expect(ensureDirSpy).toHaveBeenCalledWith("/test/vault/new-folder");
    });
  });

  describe("createDirectory()", () => {
    it("should create directory", async () => {
      ensureDirSpy.mockResolvedValue(undefined as any);

      await adapter.createDirectory("new-folder");

      expect(ensureDirSpy).toHaveBeenCalledWith("/test/vault/new-folder");
    });

    it("should create nested directories", async () => {
      ensureDirSpy.mockResolvedValue(undefined as any);

      await adapter.createDirectory("deep/nested/folder");

      expect(ensureDirSpy).toHaveBeenCalledWith("/test/vault/deep/nested/folder");
    });
  });

  describe("directoryExists()", () => {
    it("should return true for existing directory", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      statSpy.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await adapter.directoryExists("folder");

      expect(result).toBe(true);
    });

    it("should return false for non-existent path", async () => {
      pathExistsSpy.mockResolvedValue(false as any);

      const result = await adapter.directoryExists("missing");

      expect(result).toBe(false);
    });

    it("should return false for file (not directory)", async () => {
      pathExistsSpy.mockResolvedValue(true as any);
      statSpy.mockResolvedValue({ isDirectory: () => false } as any);

      const result = await adapter.directoryExists("file.md");

      expect(result).toBe(false);
    });
  });

  describe("getMarkdownFiles()", () => {
    it("should return all markdown files", async () => {
      mockGlob.mockResolvedValue([
        "/test/vault/file1.md",
        "/test/vault/folder/file2.md",
      ]);

      const result = await adapter.getMarkdownFiles();

      expect(result).toEqual(["file1.md", "folder/file2.md"]);
    });

    it("should accept custom root path", async () => {
      mockGlob.mockResolvedValue(["/test/vault/custom/file.md"]);

      const result = await adapter.getMarkdownFiles("custom");

      expect(mockGlob).toHaveBeenCalledWith(
        expect.stringContaining("/test/vault/custom/**/*.md"),
        expect.any(Object)
      );
    });

    it("should return empty array if no files", async () => {
      mockGlob.mockResolvedValue([]);

      const result = await adapter.getMarkdownFiles();

      expect(result).toEqual([]);
    });
  });

  describe("findFilesByMetadata()", () => {
    it("should find files matching query", async () => {
      mockGlob.mockResolvedValue([
        "/test/vault/file1.md",
        "/test/vault/file2.md",
      ]);
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy
        .mockResolvedValueOnce("---\nexo__Asset_uid: uid-123\n---\n# Content" as any)
        .mockResolvedValueOnce("---\nexo__Asset_uid: uid-456\n---\n# Content" as any);

      const result = await adapter.findFilesByMetadata({ exo__Asset_uid: "uid-123" });

      expect(result).toEqual(["file1.md"]);
    });

    it("should return empty array if no matches", async () => {
      mockGlob.mockResolvedValue(["/test/vault/file.md"]);
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("---\nexo__Asset_uid: different\n---" as any);

      const result = await adapter.findFilesByMetadata({ exo__Asset_uid: "uid-123" });

      expect(result).toEqual([]);
    });

    it("should continue on file read errors", async () => {
      mockGlob.mockResolvedValue([
        "/test/vault/file1.md",
        "/test/vault/file2.md",
      ]);
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy
        .mockRejectedValueOnce(new Error("Read error"))
        .mockResolvedValueOnce("---\nexo__Asset_uid: uid-123\n---" as any);

      const result = await adapter.findFilesByMetadata({ exo__Asset_uid: "uid-123" });

      expect(result).toEqual(["file2.md"]);
    });

    it("should match array values", async () => {
      mockGlob.mockResolvedValue(["/test/vault/file.md"]);
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("---\ntags:\n  - task\n  - important\n---" as any);

      const result = await adapter.findFilesByMetadata({ tags: "task" });

      expect(result).toEqual(["file.md"]);
    });

    it("should normalize wiki-link values", async () => {
      mockGlob.mockResolvedValue(["/test/vault/file.md"]);
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue('---\nstatus: "[[Done]]"\n---' as any);

      const result = await adapter.findFilesByMetadata({ status: "Done" });

      expect(result).toEqual(["file.md"]);
    });
  });

  describe("findFileByUID()", () => {
    it("should find file by UID", async () => {
      mockGlob.mockResolvedValue(["/test/vault/file.md"]);
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("---\nexo__Asset_uid: uid-123\n---" as any);

      const result = await adapter.findFileByUID("uid-123");

      expect(result).toBe("file.md");
    });

    it("should return null if UID not found", async () => {
      mockGlob.mockResolvedValue(["/test/vault/file.md"]);
      pathExistsSpy.mockResolvedValue(true as any);
      readFileSpy.mockResolvedValue("---\nexo__Asset_uid: other-uid\n---" as any);

      const result = await adapter.findFileByUID("uid-123");

      expect(result).toBeNull();
    });

    it("should return null if no files exist", async () => {
      mockGlob.mockResolvedValue([]);

      const result = await adapter.findFileByUID("uid-123");

      expect(result).toBeNull();
    });
  });
});
