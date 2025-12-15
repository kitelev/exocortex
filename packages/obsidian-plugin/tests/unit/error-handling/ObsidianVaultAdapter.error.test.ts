/**
 * ObsidianVaultAdapter Error Handling Tests
 *
 * Tests error scenarios for:
 * - Missing metadata cache
 * - File operation failures
 * - Permission errors
 * - Path resolution errors
 * - Concurrent modification errors
 * - Invalid input handling
 *
 * Issue: #788 - Add negative tests for error handling
 */

import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";
import { Vault, TFile, TFolder, MetadataCache, App, FileManager } from "obsidian";
import { IFile } from "exocortex";

describe("ObsidianVaultAdapter Error Handling", () => {
  let adapter: ObsidianVaultAdapter;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let mockApp: jest.Mocked<App>;
  let mockFileManager: jest.Mocked<FileManager>;
  let mockTFile: TFile;
  let mockTFolder: TFolder;

  beforeEach(() => {
    mockTFile = Object.create(TFile.prototype);
    Object.assign(mockTFile, {
      path: "test/file.md",
      basename: "file",
      name: "file.md",
      parent: null,
    });

    mockTFolder = Object.create(TFolder.prototype);
    Object.assign(mockTFolder, {
      path: "test",
      name: "test",
    });

    mockFileManager = {
      trashFile: jest.fn(),
      renameFile: jest.fn(),
      processFrontMatter: jest.fn(),
      getNewFileParent: jest.fn(),
    } as unknown as jest.Mocked<FileManager>;

    mockVault = {
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      getMarkdownFiles: jest.fn(),
      createFolder: jest.fn(),
      process: jest.fn(),
    } as unknown as jest.Mocked<Vault>;

    mockMetadataCache = {
      getFileCache: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      resolvedLinks: {},
    } as unknown as jest.Mocked<MetadataCache>;

    mockApp = {
      fileManager: mockFileManager,
      metadataCache: mockMetadataCache,
    } as unknown as jest.Mocked<App>;

    adapter = new ObsidianVaultAdapter(mockVault, mockMetadataCache, mockApp);
  });

  describe("Read Operation Errors", () => {
    it("should throw error when reading non-existent file", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.read(file)).rejects.toThrow("File not found: nonexistent.md");
    });

    it("should throw error when reading a folder as file", async () => {
      const file: IFile = {
        path: "folder",
        basename: "folder",
        name: "folder",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFolder);

      await expect(adapter.read(file)).rejects.toThrow("File not found: folder");
    });

    it("should handle vault read error", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.read.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(adapter.read(file)).rejects.toThrow("EACCES: permission denied");
    });

    it("should handle ENOENT error from vault", async () => {
      const file: IFile = {
        path: "deleted.md",
        basename: "deleted",
        name: "deleted.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      const enoentError = new Error("ENOENT: no such file or directory");
      (enoentError as any).code = "ENOENT";
      mockVault.read.mockRejectedValue(enoentError);

      await expect(adapter.read(file)).rejects.toThrow("ENOENT: no such file or directory");
    });

    it("should handle disk read timeout", async () => {
      const file: IFile = {
        path: "slow.md",
        basename: "slow",
        name: "slow.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.read.mockRejectedValue(new Error("ETIMEDOUT: operation timed out"));

      await expect(adapter.read(file)).rejects.toThrow("ETIMEDOUT: operation timed out");
    });
  });

  describe("Create Operation Errors", () => {
    it("should handle file already exists error", async () => {
      mockVault.create.mockRejectedValue(new Error("File already exists"));

      await expect(adapter.create("existing.md", "content")).rejects.toThrow("File already exists");
    });

    it("should handle invalid path characters", async () => {
      mockVault.create.mockRejectedValue(new Error("Invalid path: contains invalid characters"));

      await expect(adapter.create("file<>:.md", "content")).rejects.toThrow("Invalid path");
    });

    it("should handle parent folder not found", async () => {
      mockVault.create.mockRejectedValue(new Error("Parent folder does not exist"));

      await expect(adapter.create("nonexistent/folder/file.md", "content")).rejects.toThrow(
        "Parent folder does not exist"
      );
    });

    it("should handle disk full error", async () => {
      mockVault.create.mockRejectedValue(new Error("ENOSPC: no space left on device"));

      await expect(adapter.create("new.md", "content")).rejects.toThrow("ENOSPC: no space left on device");
    });

    it("should handle permission denied on create", async () => {
      mockVault.create.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(adapter.create("readonly/file.md", "content")).rejects.toThrow("EACCES: permission denied");
    });

    it("should handle path too long error", async () => {
      const longPath = "a".repeat(500) + ".md";
      mockVault.create.mockRejectedValue(new Error("ENAMETOOLONG: file name too long"));

      await expect(adapter.create(longPath, "content")).rejects.toThrow("ENAMETOOLONG: file name too long");
    });
  });

  describe("Modify Operation Errors", () => {
    it("should throw error when modifying non-existent file", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.modify(file, "new content")).rejects.toThrow("File not found: nonexistent.md");
    });

    it("should handle concurrent modification error", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.modify.mockRejectedValue(new Error("File was modified by another process"));

      await expect(adapter.modify(file, "content")).rejects.toThrow("File was modified by another process");
    });

    it("should handle read-only file error", async () => {
      const file: IFile = {
        path: "readonly.md",
        basename: "readonly",
        name: "readonly.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.modify.mockRejectedValue(new Error("EPERM: operation not permitted"));

      await expect(adapter.modify(file, "content")).rejects.toThrow("EPERM: operation not permitted");
    });

    it("should handle I/O error during modification", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.modify.mockRejectedValue(new Error("EIO: i/o error"));

      await expect(adapter.modify(file, "content")).rejects.toThrow("EIO: i/o error");
    });
  });

  describe("Delete Operation Errors", () => {
    it("should throw error when deleting non-existent file", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.delete(file)).rejects.toThrow("File not found: nonexistent.md");
    });

    it("should handle trash operation failure", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.trashFile.mockRejectedValue(new Error("Trash operation failed"));

      await expect(adapter.delete(file)).rejects.toThrow("Trash operation failed");
    });

    it("should handle file in use error", async () => {
      const file: IFile = {
        path: "locked.md",
        basename: "locked",
        name: "locked.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.trashFile.mockRejectedValue(new Error("EBUSY: resource busy or locked"));

      await expect(adapter.delete(file)).rejects.toThrow("EBUSY: resource busy or locked");
    });
  });

  describe("Rename Operation Errors", () => {
    it("should throw error when renaming non-existent file", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.rename(file, "new.md")).rejects.toThrow("File not found: nonexistent.md");
    });

    it("should handle target path already exists", async () => {
      const file: IFile = {
        path: "original.md",
        basename: "original",
        name: "original.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.renameFile.mockRejectedValue(new Error("Target path already exists"));

      await expect(adapter.rename(file, "existing.md")).rejects.toThrow("Target path already exists");
    });

    it("should handle cross-device rename error", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.renameFile.mockRejectedValue(new Error("EXDEV: cross-device link not permitted"));

      await expect(adapter.rename(file, "/other/device/file.md")).rejects.toThrow("EXDEV: cross-device link");
    });

    it("should handle invalid new filename", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.renameFile.mockRejectedValue(new Error("Invalid filename"));

      await expect(adapter.rename(file, "file<>:.md")).rejects.toThrow("Invalid filename");
    });
  });

  describe("CreateFolder Operation Errors", () => {
    it("should handle folder already exists", async () => {
      mockVault.createFolder.mockRejectedValue(new Error("Folder already exists"));

      await expect(adapter.createFolder("existing")).rejects.toThrow("Folder already exists");
    });

    it("should handle nested folder creation failure", async () => {
      mockVault.createFolder.mockRejectedValue(new Error("Parent folder does not exist"));

      await expect(adapter.createFolder("a/b/c/d")).rejects.toThrow("Parent folder does not exist");
    });

    it("should handle invalid folder name", async () => {
      mockVault.createFolder.mockRejectedValue(new Error("Invalid folder name"));

      await expect(adapter.createFolder("folder/with:invalid<chars>")).rejects.toThrow("Invalid folder name");
    });
  });

  describe("UpdateFrontmatter Operation Errors", () => {
    it("should handle processFrontMatter failure", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: {} } as any);
      mockFileManager.processFrontMatter.mockRejectedValue(
        new Error("Failed to process frontmatter: invalid YAML")
      );

      await expect(
        adapter.updateFrontmatter(file, (fm) => ({ ...fm, key: "value" }))
      ).rejects.toThrow("Failed to process frontmatter");
    });

    it("should handle corrupted frontmatter", async () => {
      const file: IFile = {
        path: "corrupted.md",
        basename: "corrupted",
        name: "corrupted.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: undefined, // Corrupted
      } as any);

      // Should use empty object as fallback
      await adapter.updateFrontmatter(file, (fm) => ({ ...fm, key: "value" }));

      expect(mockFileManager.processFrontMatter).toHaveBeenCalled();
    });

    it("should handle updater function throwing error", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: {} } as any);
      mockFileManager.processFrontMatter.mockImplementation(async (f, processor) => {
        processor({});
      });

      await expect(
        adapter.updateFrontmatter(file, () => {
          throw new Error("Updater function failed");
        })
      ).rejects.toThrow("Updater function failed");
    });
  });

  describe("Process Operation Errors", () => {
    it("should throw error when processing non-existent file", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.process(file, (c) => c)).rejects.toThrow("File not found: nonexistent.md");
    });

    it("should handle processor function throwing error", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.process.mockImplementation(async (f, fn) => {
        return fn("content");
      });

      await expect(
        adapter.process(file, () => {
          throw new Error("Processing failed");
        })
      ).rejects.toThrow("Processing failed");
    });
  });

  describe("GetFirstLinkpathDest Errors", () => {
    it("should return null for broken link", () => {
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

      const result = adapter.getFirstLinkpathDest("[[BrokenLink]]", "source.md");

      expect(result).toBeNull();
    });

    it("should handle empty linkpath", () => {
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

      const result = adapter.getFirstLinkpathDest("", "source.md");

      expect(result).toBeNull();
    });

    it("should handle circular link reference", () => {
      // Self-referencing link
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(mockTFile);

      const result = adapter.getFirstLinkpathDest("[[test/file]]", "test/file.md");

      expect(result).toBeDefined();
      expect(result?.path).toBe("test/file.md");
    });
  });

  describe("ToTFile Conversion Errors", () => {
    it("should throw error for non-existent file", () => {
      const file: IFile = {
        path: "missing.md",
        basename: "missing",
        name: "missing.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      expect(() => adapter.toTFile(file)).toThrow("File not found: missing.md");
    });

    it("should throw error when path points to folder", () => {
      const file: IFile = {
        path: "folder",
        basename: "folder",
        name: "folder",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFolder);

      expect(() => adapter.toTFile(file)).toThrow("File not found: folder");
    });
  });

  describe("GetDefaultNewFileParent Errors", () => {
    it("should return null when fileManager returns null", () => {
      mockFileManager.getNewFileParent.mockReturnValue(null as any);

      const result = adapter.getDefaultNewFileParent();

      expect(result).toBeNull();
    });
  });

  describe("UpdateLinks Errors", () => {
    beforeEach(() => {
      mockApp.metadataCache = {
        ...mockMetadataCache,
        resolvedLinks: {
          "source.md": {
            "target.md": 1,
          },
        },
      } as any;
    });

    it("should handle read error during link update", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, { path: "source.md" });

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockRejectedValue(new Error("Cannot read file"));

      await expect(adapter.updateLinks("target.md", "new-target.md", "target")).rejects.toThrow("Cannot read file");
    });

    it("should handle modify error during link update", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, { path: "source.md" });

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockResolvedValue("Content with [[target]]");
      mockVault.modify.mockRejectedValue(new Error("Cannot modify file"));

      await expect(adapter.updateLinks("target.md", "new-target.md", "target")).rejects.toThrow("Cannot modify file");
    });

    it("should handle no files with links gracefully", async () => {
      mockApp.metadataCache.resolvedLinks = {};

      // Should complete without error
      await adapter.updateLinks("target.md", "new-target.md", "target");

      expect(mockVault.read).not.toHaveBeenCalled();
      expect(mockVault.modify).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases with Invalid Input", () => {
    it("should handle file with empty path", async () => {
      const file: IFile = {
        path: "",
        basename: "",
        name: "",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.read(file)).rejects.toThrow("File not found: ");
    });

    it("should handle file with whitespace-only path", async () => {
      const file: IFile = {
        path: "   ",
        basename: "   ",
        name: "   ",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.read(file)).rejects.toThrow("File not found:    ");
    });

    it("should handle file with null path property", async () => {
      const file: IFile = {
        path: null as any,
        basename: "test",
        name: "test.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.read(file)).rejects.toThrow();
    });
  });
});
