import { Vault, TFile } from "obsidian";
import {
  IFileSystemReader,
  IFileSystemWriter,
  FileNotFoundError,
  FileAlreadyExistsError,
} from "exocortex";

import { ObsidianFileSystemAdapter } from "../../src/adapters/ObsidianFileSystemAdapter";

describe("ObsidianFileSystemAdapter", () => {
  let adapter: ObsidianFileSystemAdapter;
  let mockVault: jest.Mocked<Vault>;
  let mockDataAdapter: {
    read: jest.Mock;
    write: jest.Mock;
    exists: jest.Mock;
    list: jest.Mock;
    remove: jest.Mock;
    rename: jest.Mock;
    mkdir: jest.Mock;
  };

  beforeEach(() => {
    mockDataAdapter = {
      read: jest.fn(),
      write: jest.fn(),
      exists: jest.fn(),
      list: jest.fn(),
      remove: jest.fn(),
      rename: jest.fn(),
      mkdir: jest.fn(),
    };

    mockVault = {
      adapter: mockDataAdapter,
      getMarkdownFiles: jest.fn().mockReturnValue([]),
      getAbstractFileByPath: jest.fn(),
    } as unknown as jest.Mocked<Vault>;

    adapter = new ObsidianFileSystemAdapter(mockVault);
  });

  describe("IFileSystemReader", () => {
    it("should implement IFileSystemReader interface", () => {
      const reader: IFileSystemReader = adapter;
      expect(reader.readFile).toBeDefined();
      expect(reader.fileExists).toBeDefined();
      expect(reader.getMarkdownFiles).toBeDefined();
    });

    describe("readFile", () => {
      it("should read file content via vault adapter", async () => {
        mockDataAdapter.read.mockResolvedValue("file content");
        mockDataAdapter.exists.mockResolvedValue(true);

        const content = await adapter.readFile("path/to/file.md");

        expect(content).toBe("file content");
        expect(mockDataAdapter.read).toHaveBeenCalledWith("path/to/file.md");
      });

      it("should throw FileNotFoundError when file does not exist", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);

        await expect(adapter.readFile("missing.md")).rejects.toThrow(
          FileNotFoundError,
        );
      });

      it("should propagate underlying adapter errors", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockRejectedValue(new Error("Disk error"));

        await expect(adapter.readFile("broken.md")).rejects.toThrow(
          "Disk error",
        );
      });
    });

    describe("fileExists", () => {
      it("should return true when file exists", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);

        const result = await adapter.fileExists("existing.md");

        expect(result).toBe(true);
        expect(mockDataAdapter.exists).toHaveBeenCalledWith("existing.md");
      });

      it("should return false when file does not exist", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);

        const result = await adapter.fileExists("missing.md");

        expect(result).toBe(false);
      });
    });

    describe("getMarkdownFiles", () => {
      it("should return all markdown file paths from vault", async () => {
        const mockFile1 = Object.create(TFile.prototype);
        Object.assign(mockFile1, { path: "notes/note1.md" });
        const mockFile2 = Object.create(TFile.prototype);
        Object.assign(mockFile2, { path: "tasks/task1.md" });

        mockVault.getMarkdownFiles.mockReturnValue([mockFile1, mockFile2]);

        const files = await adapter.getMarkdownFiles();

        expect(files).toEqual(["notes/note1.md", "tasks/task1.md"]);
      });

      it("should return empty array when no markdown files exist", async () => {
        mockVault.getMarkdownFiles.mockReturnValue([]);

        const files = await adapter.getMarkdownFiles();

        expect(files).toEqual([]);
      });

      it("should filter by rootPath when provided", async () => {
        const mockFile1 = Object.create(TFile.prototype);
        Object.assign(mockFile1, { path: "notes/note1.md" });
        const mockFile2 = Object.create(TFile.prototype);
        Object.assign(mockFile2, { path: "tasks/task1.md" });
        const mockFile3 = Object.create(TFile.prototype);
        Object.assign(mockFile3, { path: "notes/sub/note2.md" });

        mockVault.getMarkdownFiles.mockReturnValue([
          mockFile1,
          mockFile2,
          mockFile3,
        ]);

        const files = await adapter.getMarkdownFiles("notes");

        expect(files).toEqual(["notes/note1.md", "notes/sub/note2.md"]);
      });
    });
  });

  describe("IFileSystemWriter", () => {
    it("should implement IFileSystemWriter interface", () => {
      const writer: IFileSystemWriter = adapter;
      expect(writer.createFile).toBeDefined();
      expect(writer.updateFile).toBeDefined();
      expect(writer.writeFile).toBeDefined();
      expect(writer.deleteFile).toBeDefined();
      expect(writer.renameFile).toBeDefined();
    });

    describe("createFile", () => {
      it("should create file and return path", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);
        mockDataAdapter.write.mockResolvedValue(undefined);

        const path = await adapter.createFile(
          "new/file.md",
          "initial content",
        );

        expect(path).toBe("new/file.md");
        expect(mockDataAdapter.write).toHaveBeenCalledWith(
          "new/file.md",
          "initial content",
        );
      });

      it("should throw FileAlreadyExistsError when file exists", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);

        await expect(
          adapter.createFile("existing.md", "content"),
        ).rejects.toThrow(FileAlreadyExistsError);
      });
    });

    describe("updateFile", () => {
      it("should update existing file content", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.write.mockResolvedValue(undefined);

        await adapter.updateFile("file.md", "updated content");

        expect(mockDataAdapter.write).toHaveBeenCalledWith(
          "file.md",
          "updated content",
        );
      });

      it("should throw FileNotFoundError when file does not exist", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);

        await expect(
          adapter.updateFile("missing.md", "content"),
        ).rejects.toThrow(FileNotFoundError);
      });
    });

    describe("writeFile", () => {
      it("should write content regardless of file existence", async () => {
        mockDataAdapter.write.mockResolvedValue(undefined);

        await adapter.writeFile("any/file.md", "content");

        expect(mockDataAdapter.write).toHaveBeenCalledWith(
          "any/file.md",
          "content",
        );
      });
    });

    describe("deleteFile", () => {
      it("should delete existing file", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.remove.mockResolvedValue(undefined);

        await adapter.deleteFile("file.md");

        expect(mockDataAdapter.remove).toHaveBeenCalledWith("file.md");
      });

      it("should throw FileNotFoundError when file does not exist", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);

        await expect(adapter.deleteFile("missing.md")).rejects.toThrow(
          FileNotFoundError,
        );
      });
    });

    describe("renameFile", () => {
      it("should rename existing file", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.rename.mockResolvedValue(undefined);

        await adapter.renameFile("old.md", "new.md");

        expect(mockDataAdapter.rename).toHaveBeenCalledWith("old.md", "new.md");
      });

      it("should throw FileNotFoundError when source file does not exist", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);

        await expect(
          adapter.renameFile("missing.md", "new.md"),
        ).rejects.toThrow(FileNotFoundError);
      });
    });
  });

  describe("combined IFileSystemReader & IFileSystemWriter", () => {
    it("should be assignable to both interfaces simultaneously", () => {
      const reader: IFileSystemReader = adapter;
      const writer: IFileSystemWriter = adapter;
      expect(reader).toBe(writer);
    });
  });
});
