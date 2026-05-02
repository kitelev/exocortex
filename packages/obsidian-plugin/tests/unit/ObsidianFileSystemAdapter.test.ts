import { Vault, TFile, TFolder } from "obsidian";
import {
  IFileSystemAdapter,
  IFileSystemDirectoryManager,
  IFileSystemMetadataProvider,
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

  describe("IFileSystemMetadataProvider", () => {
    it("should implement IFileSystemMetadataProvider interface", () => {
      const provider: IFileSystemMetadataProvider = adapter;
      expect(provider.getFileMetadata).toBeDefined();
      expect(provider.findFilesByMetadata).toBeDefined();
      expect(provider.findFileByUID).toBeDefined();
    });

    describe("getFileMetadata", () => {
      it("should parse YAML frontmatter from file content", async () => {
        const content =
          "---\nexo__Asset_uid: abc-123\nexo__Asset_label: Test\n---\nbody";
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockResolvedValue(content);

        const meta = await adapter.getFileMetadata("note.md");

        expect(meta).toEqual({
          exo__Asset_uid: "abc-123",
          exo__Asset_label: "Test",
        });
      });

      it("should return empty object when file has no frontmatter", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockResolvedValue("plain text without yaml");

        const meta = await adapter.getFileMetadata("note.md");

        expect(meta).toEqual({});
      });

      it("should return empty object when frontmatter is malformed YAML", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockResolvedValue("---\n  : : :\n---\n");

        const meta = await adapter.getFileMetadata("note.md");

        expect(meta).toEqual({});
      });

      it("should propagate FileNotFoundError when file is missing", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);

        await expect(adapter.getFileMetadata("missing.md")).rejects.toThrow(
          FileNotFoundError,
        );
      });
    });

    describe("findFilesByMetadata", () => {
      function makeMd(path: string): TFile {
        const file = Object.create(TFile.prototype);
        Object.assign(file, { path, extension: "md" });
        return file;
      }

      it("should match scalar property values", async () => {
        const f1 = makeMd("a.md");
        const f2 = makeMd("b.md");
        mockVault.getMarkdownFiles.mockReturnValue([f1, f2]);

        const contents: Record<string, string> = {
          "a.md": "---\nstatus: active\n---\n",
          "b.md": "---\nstatus: archived\n---\n",
        };
        mockDataAdapter.exists.mockImplementation(async (p: string) =>
          Object.prototype.hasOwnProperty.call(contents, p),
        );
        mockDataAdapter.read.mockImplementation(
          async (p: string) => contents[p] ?? "",
        );

        const matches = await adapter.findFilesByMetadata({ status: "active" });

        expect(matches).toEqual(["a.md"]);
      });

      it("should match against array property values", async () => {
        const f1 = makeMd("multi.md");
        mockVault.getMarkdownFiles.mockReturnValue([f1]);
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockResolvedValue(
          "---\ntags:\n  - alpha\n  - beta\n---\n",
        );

        const matches = await adapter.findFilesByMetadata({ tags: "beta" });

        expect(matches).toEqual(["multi.md"]);
      });

      it("should normalize wikilink-wrapped values for comparison", async () => {
        const f1 = makeMd("wikilink.md");
        mockVault.getMarkdownFiles.mockReturnValue([f1]);
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockResolvedValue(
          '---\nstatus: "[[ems__EffortStatusDoing]]"\n---\n',
        );

        const matches = await adapter.findFilesByMetadata({
          status: "ems__EffortStatusDoing",
        });

        expect(matches).toEqual(["wikilink.md"]);
      });

      it("should skip files whose metadata cannot be read", async () => {
        const ok = makeMd("ok.md");
        const broken = makeMd("broken.md");
        mockVault.getMarkdownFiles.mockReturnValue([ok, broken]);

        mockDataAdapter.exists.mockImplementation(async (p: string) =>
          p === "ok.md",
        );
        mockDataAdapter.read.mockImplementation(async (p: string) => {
          if (p === "ok.md") return "---\nkind: x\n---\n";
          throw new Error("disk failure");
        });

        const matches = await adapter.findFilesByMetadata({ kind: "x" });

        expect(matches).toEqual(["ok.md"]);
      });

      it("should return empty array when nothing matches", async () => {
        const f1 = makeMd("a.md");
        mockVault.getMarkdownFiles.mockReturnValue([f1]);
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockResolvedValue("---\nstatus: active\n---\n");

        const matches = await adapter.findFilesByMetadata({
          status: "missing",
        });

        expect(matches).toEqual([]);
      });
    });

    describe("findFileByUID", () => {
      it("should return file path when UID matches", async () => {
        const f1 = Object.create(TFile.prototype);
        Object.assign(f1, { path: "asset.md", extension: "md" });
        mockVault.getMarkdownFiles.mockReturnValue([f1]);
        mockDataAdapter.exists.mockResolvedValue(true);
        mockDataAdapter.read.mockResolvedValue(
          "---\nexo__Asset_uid: 49fe40ea-673a-4155-abb0-52d05a0a96c3\n---\n",
        );

        const path = await adapter.findFileByUID(
          "49fe40ea-673a-4155-abb0-52d05a0a96c3",
        );

        expect(path).toBe("asset.md");
      });

      it("should return null when no file has the UID", async () => {
        mockVault.getMarkdownFiles.mockReturnValue([]);

        const path = await adapter.findFileByUID("does-not-exist");

        expect(path).toBeNull();
      });
    });
  });

  describe("IFileSystemDirectoryManager", () => {
    it("should implement IFileSystemDirectoryManager interface", () => {
      const dirs: IFileSystemDirectoryManager = adapter;
      expect(dirs.createDirectory).toBeDefined();
      expect(dirs.directoryExists).toBeDefined();
    });

    describe("createDirectory", () => {
      it("should delegate to vault.adapter.mkdir", async () => {
        mockDataAdapter.mkdir.mockResolvedValue(undefined);

        await adapter.createDirectory("nested/path");

        expect(mockDataAdapter.mkdir).toHaveBeenCalledWith("nested/path");
      });

      it("should propagate underlying mkdir errors", async () => {
        mockDataAdapter.mkdir.mockRejectedValue(new Error("EACCES"));

        await expect(adapter.createDirectory("ro/path")).rejects.toThrow(
          "EACCES",
        );
      });
    });

    describe("directoryExists", () => {
      it("should return true when path resolves to a TFolder", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        const folder = Object.create(TFolder.prototype);
        Object.assign(folder, { path: "folder" });
        (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(folder);

        const exists = await adapter.directoryExists("folder");

        expect(exists).toBe(true);
        expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("folder");
      });

      it("should return false when path resolves to a TFile (not a folder)", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        const file = Object.create(TFile.prototype);
        Object.assign(file, { path: "note.md", extension: "md" });
        (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(file);

        const exists = await adapter.directoryExists("note.md");

        expect(exists).toBe(false);
      });

      it("should return false when path does not exist", async () => {
        mockDataAdapter.exists.mockResolvedValue(false);

        const exists = await adapter.directoryExists("ghost");

        expect(exists).toBe(false);
        expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
      });

      it("should return false when getAbstractFileByPath returns null", async () => {
        mockDataAdapter.exists.mockResolvedValue(true);
        (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

        const exists = await adapter.directoryExists("orphan");

        expect(exists).toBe(false);
      });
    });
  });

  describe("composite IFileSystemAdapter", () => {
    it("should be assignable to all role-based interfaces simultaneously", () => {
      const composite: IFileSystemAdapter = adapter;
      const reader: IFileSystemReader = adapter;
      const writer: IFileSystemWriter = adapter;
      const meta: IFileSystemMetadataProvider = adapter;
      const dirs: IFileSystemDirectoryManager = adapter;
      expect(composite).toBe(reader);
      expect(composite).toBe(writer);
      expect(composite).toBe(meta);
      expect(composite).toBe(dirs);
    });
  });
});
