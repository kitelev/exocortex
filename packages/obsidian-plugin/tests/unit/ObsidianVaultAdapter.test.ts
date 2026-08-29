import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { Vault, TFile, TFolder, MetadataCache, App, FileManager } from "obsidian";
import { IFile } from "@kitelev/exocortex-core";

describe("ObsidianVaultAdapter", () => {
  let adapter: ObsidianVaultAdapter;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let mockApp: jest.Mocked<App>;
  let mockFileManager: jest.Mocked<FileManager>;
  let mockTFile: TFile;
  let mockTFolder: TFolder;

  beforeEach(() => {
    // Create proper instances of TFile and TFolder
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
    } as unknown as jest.Mocked<MetadataCache>;

    mockApp = {
      fileManager: mockFileManager,
    } as unknown as jest.Mocked<App>;

    adapter = new ObsidianVaultAdapter(mockVault, mockMetadataCache, mockApp);
  });

  describe("read", () => {
    it("should read file content", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.read.mockResolvedValue("File content");

      const content = await adapter.read(file);

      expect(content).toBe("File content");
      expect(mockVault.read).toHaveBeenCalledWith(mockTFile);
    });

    it("should use cached file when available", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      // First read to cache the file
      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.read.mockResolvedValue("Content 1");
      await adapter.read(file);

      // Second read should use cached file
      mockVault.read.mockResolvedValue("Content 2");
      const content = await adapter.read(file);

      expect(content).toBe("Content 2");
      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledTimes(1);
    });
  });

  describe("create", () => {
    it("should create a new file", async () => {
      const createdFile = Object.create(TFile.prototype);
      Object.assign(createdFile, {
        path: "new/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      });

      mockVault.create.mockResolvedValue(createdFile);

      const result = await adapter.create("new/file.md", "New content");

      expect(result).toEqual({
        path: "new/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      });
      expect(mockVault.create).toHaveBeenCalledWith("new/file.md", "New content");
    });

    it("should create file with parent folder", async () => {
      const createdFile = Object.create(TFile.prototype);
      Object.assign(createdFile, {
        path: "folder/file.md",
        basename: "file",
        name: "file.md",
        parent: mockTFolder,
      });

      mockVault.create.mockResolvedValue(createdFile);

      const result = await adapter.create("folder/file.md", "Content");

      expect(result.parent).toEqual({
        path: "test",
        name: "test",
      });
    });
  });

  describe("modify", () => {
    it("should modify existing file", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);

      await adapter.modify(file, "Modified content");

      expect(mockVault.modify).toHaveBeenCalledWith(mockTFile, "Modified content");
    });

    it("should throw error if file not found", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.modify(file, "Content")).rejects.toThrow(
        "File not found: nonexistent.md"
      );
    });
  });

  describe("delete", () => {
    it("should delete file using trash", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);

      await adapter.delete(file);

      expect(mockFileManager.trashFile).toHaveBeenCalledWith(mockTFile);
    });

    it("should throw error if file not found", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.delete(file)).rejects.toThrow(
        "File not found: nonexistent.md"
      );
    });
  });

  describe("exists", () => {
    it("should return true if file exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);

      const exists = await adapter.exists("test/file.md");

      expect(exists).toBe(true);
      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("test/file.md");
    });

    it("should return false if file does not exist", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const exists = await adapter.exists("nonexistent.md");

      expect(exists).toBe(false);
    });
  });

  describe("getAbstractFileByPath", () => {
    it("should return IFile for TFile", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);

      const result = adapter.getAbstractFileByPath("test/file.md");

      expect(result).toEqual({
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      });
    });

    it("should return IFolder for TFolder", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(mockTFolder);

      const result = adapter.getAbstractFileByPath("test");

      expect(result).toEqual({
        path: "test",
        name: "test",
      });
    });

    it("should return null if file not found", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const result = adapter.getAbstractFileByPath("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getAllFiles", () => {
    it("should return all markdown files", () => {
      const file1 = Object.create(TFile.prototype);
      Object.assign(file1, {
        path: "file1.md",
        basename: "file1",
        name: "file1.md",
        parent: null,
      });

      const file2 = Object.create(TFile.prototype);
      Object.assign(file2, {
        path: "folder/file2.md",
        basename: "file2",
        name: "file2.md",
        parent: mockTFolder,
      });

      mockVault.getMarkdownFiles.mockReturnValue([file1, file2]);

      const files = adapter.getAllFiles();

      expect(files).toHaveLength(2);
      expect(files[0]).toEqual({
        path: "file1.md",
        basename: "file1",
        name: "file1.md",
        parent: null,
      });
      expect(files[1]).toEqual({
        path: "folder/file2.md",
        basename: "file2",
        name: "file2.md",
        parent: {
          path: "test",
          name: "test",
        },
      });
    });

    it("should return empty array if no files", () => {
      mockVault.getMarkdownFiles.mockReturnValue([]);

      const files = adapter.getAllFiles();

      expect(files).toEqual([]);
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter from cache", () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      const frontmatter = {
        title: "Test",
        status: "draft",
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter,
      } as any);

      const result = adapter.getFrontmatter(file);

      expect(result).toEqual(frontmatter);
      expect(mockMetadataCache.getFileCache).toHaveBeenCalledWith(mockTFile);
    });

    it("should return null if no frontmatter", () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({} as any);

      const result = adapter.getFrontmatter(file);

      expect(result).toBeNull();
    });

    it("should return null if no cache", () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue(null);

      const result = adapter.getFrontmatter(file);

      expect(result).toBeNull();
    });

    describe("Issue #2103: Fallback YAML parsing when cache unavailable", () => {
      it("should parse frontmatter directly from file content when cache returns null", async () => {
        const file: IFile = {
          path: "test/prototype.md",
          basename: "prototype",
          name: "prototype.md",
          parent: null,
        };

        const fileContent = `---
exo__Instance_class: "[[ems__TaskPrototype]]"
exo__Asset_label: "Test Task Template"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---

# Task Template Content
`;

        mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
        mockMetadataCache.getFileCache.mockReturnValue(null);
        mockVault.read.mockResolvedValue(fileContent);

        const result = await adapter.getFrontmatterWithFallback(file);

        expect(result).toEqual({
          "exo__Instance_class": "[[ems__TaskPrototype]]",
          "exo__Asset_label": "Test Task Template",
          "ems__Effort_status": "[[ems__EffortStatusBacklog]]",
        });
      });

      it("should use cache when available", async () => {
        const file: IFile = {
          path: "test/file.md",
          basename: "file",
          name: "file.md",
          parent: null,
        };

        const cachedFrontmatter = {
          "exo__Instance_class": "[[ems__Task]]",
          "exo__Asset_label": "From Cache",
        };

        mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: cachedFrontmatter,
        } as any);

        const result = await adapter.getFrontmatterWithFallback(file);

        expect(result).toEqual(cachedFrontmatter);
        expect(mockVault.read).not.toHaveBeenCalled();
      });

      it("should return null if file has no frontmatter", async () => {
        const file: IFile = {
          path: "test/no-frontmatter.md",
          basename: "no-frontmatter",
          name: "no-frontmatter.md",
          parent: null,
        };

        const fileContent = `# Just Content
No frontmatter here.
`;

        mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
        mockMetadataCache.getFileCache.mockReturnValue(null);
        mockVault.read.mockResolvedValue(fileContent);

        const result = await adapter.getFrontmatterWithFallback(file);

        expect(result).toBeNull();
      });

      it("should handle YAML that parseYaml cannot process gracefully", async () => {
        const file: IFile = {
          path: "test/unparseable.md",
          basename: "unparseable",
          name: "unparseable.md",
          parent: null,
        };

        // Frontmatter that will trigger a parse error (tabs in wrong places)
        const fileContent = `---
\t\tinvalid
---

# Content
`;

        mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
        mockMetadataCache.getFileCache.mockReturnValue(null);
        mockVault.read.mockResolvedValue(fileContent);

        // The mock parseYaml will return an empty object for unparseable content
        // In production, Obsidian's parseYaml might throw or return null
        const result = await adapter.getFrontmatterWithFallback(file);

        // Result should be an object (even if empty) or null, but NOT throw
        expect(result === null || typeof result === "object").toBe(true);
      });

      it("should handle empty frontmatter", async () => {
        const file: IFile = {
          path: "test/empty-fm.md",
          basename: "empty-fm",
          name: "empty-fm.md",
          parent: null,
        };

        const fileContent = `---
---

# Content
`;

        mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
        mockMetadataCache.getFileCache.mockReturnValue(null);
        mockVault.read.mockResolvedValue(fileContent);

        const result = await adapter.getFrontmatterWithFallback(file);

        expect(result).toBeNull();
      });

      it("should handle complex frontmatter with arrays and nested objects", async () => {
        const file: IFile = {
          path: "test/complex.md",
          basename: "complex",
          name: "complex.md",
          parent: null,
        };

        const fileContent = `---
exo__Instance_class:
  - "[[ems__TaskPrototype]]"
  - "[[exo__Asset]]"
aliases:
  - "Task Template"
  - "Template 1"
nested:
  key: value
---

# Content
`;

        mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
        mockMetadataCache.getFileCache.mockReturnValue(null);
        mockVault.read.mockResolvedValue(fileContent);

        const result = await adapter.getFrontmatterWithFallback(file);

        expect(result).toEqual({
          "exo__Instance_class": ["[[ems__TaskPrototype]]", "[[exo__Asset]]"],
          "aliases": ["Task Template", "Template 1"],
          "nested": { key: "value" },
        });
      });

      it("should return null when file read fails", async () => {
        const file: IFile = {
          path: "test/error.md",
          basename: "error",
          name: "error.md",
          parent: null,
        };

        mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
        mockMetadataCache.getFileCache.mockReturnValue(null);
        mockVault.read.mockRejectedValue(new Error("File read error"));

        const result = await adapter.getFrontmatterWithFallback(file);

        expect(result).toBeNull();
      });
    });
  });

  describe("updateFrontmatter", () => {
    it("should update frontmatter with new values", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      const currentFrontmatter = {
        title: "Old Title",
        status: "draft",
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: currentFrontmatter,
      } as any);

      mockFileManager.processFrontMatter.mockImplementation(
        async (file, processor) => {
          const fm = { ...currentFrontmatter };
          processor(fm);
        }
      );

      await adapter.updateFrontmatter(file, (current) => ({
        ...current,
        status: "published",
        newProp: "value",
      }));

      expect(mockFileManager.processFrontMatter).toHaveBeenCalledWith(
        mockTFile,
        expect.any(Function)
      );

      // Verify processor function
      const processor = mockFileManager.processFrontMatter.mock.calls[0][1];
      const testFm = { title: "Test" };
      processor(testFm);
      expect(testFm).toEqual({
        title: "Old Title",
        status: "published",
        newProp: "value",
      });
    });

    it("should handle empty frontmatter", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue(null);

      mockFileManager.processFrontMatter.mockImplementation(
        async (file, processor) => {
          const fm = {};
          processor(fm);
        }
      );

      await adapter.updateFrontmatter(file, () => ({
        title: "New Title",
        status: "draft",
      }));

      expect(mockFileManager.processFrontMatter).toHaveBeenCalled();

      // Verify processor function
      const processor = mockFileManager.processFrontMatter.mock.calls[0][1];
      const testFm = {};
      processor(testFm);
      expect(testFm).toEqual({
        title: "New Title",
        status: "draft",
      });
    });
  });

  describe("rename", () => {
    it("should rename file", async () => {
      const file: IFile = {
        path: "old/path.md",
        basename: "path",
        name: "path.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);

      await adapter.rename(file, "new/path.md");

      expect(mockFileManager.renameFile).toHaveBeenCalledWith(
        mockTFile,
        "new/path.md"
      );
    });

    it("should throw error if file not found", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(adapter.rename(file, "new.md")).rejects.toThrow(
        "File not found: nonexistent.md"
      );
    });
  });

  describe("createFolder", () => {
    it("should create folder", async () => {
      await adapter.createFolder("new/folder");

      expect(mockVault.createFolder).toHaveBeenCalledWith("new/folder");
    });
  });

  describe("getFirstLinkpathDest", () => {
    it("should return linked file", () => {
      const linkedFile = Object.create(TFile.prototype);
      Object.assign(linkedFile, {
        path: "linked.md",
        basename: "linked",
        name: "linked.md",
        parent: null,
      });

      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(linkedFile);

      const result = adapter.getFirstLinkpathDest("[[Linked]]", "source.md");

      expect(result).toEqual({
        path: "linked.md",
        basename: "linked",
        name: "linked.md",
        parent: null,
      });
      expect(mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "[[Linked]]",
        "source.md"
      );
    });

    it("should return null if no linked file", () => {
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

      const result = adapter.getFirstLinkpathDest("[[Nonexistent]]", "source.md");

      expect(result).toBeNull();
    });
  });

  // @req:7d00a60b-5ca3-457e-a160-5bf955e8c195
  // Tier 2 — a cold metadataCache must not yield ZERO command buttons.
  // The break it guards: cache cold -> getFirstLinkpathDest null -> the class
  // wikilink stays a Literal -> walkClassAndPrototypeRelations drops it -> no
  // rdf:type -> findPaletteEnabledCommands matches nothing.
  describe("getFirstLinkpathDest — cold metadataCache (Tier 2, req 7d00a60b)", () => {
    const CLASS_UUID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

    /** A UID-CANON class file: its basename IS the uuid. */
    function classFile(uuid: string, suffix = "") {
      const f = Object.create(TFile.prototype);
      Object.assign(f, {
        path: `assetspaces/kitelev/exoas-public/ems/${uuid}${suffix}.md`,
        basename: `${uuid}${suffix}`,
        name: `${uuid}${suffix}.md`,
        parent: null,
      });
      return f;
    }

    it("resolves a uid-bare linkpath from the file registry when the cache is cold", () => {
      const target = classFile(CLASS_UUID);
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null); // cold
      mockVault.getMarkdownFiles.mockReturnValue([target]);
      mockVault.getAbstractFileByPath.mockReturnValue(target);

      const result = adapter.getFirstLinkpathDest(CLASS_UUID, "note.md");

      expect(result).not.toBeNull();
      expect(result!.path).toBe(target.path);
      expect(result!.basename).toBe(CLASS_UUID);
    });

    it("does NOT touch the registry when the cache resolves (already-working path untouched)", () => {
      const cached = classFile(CLASS_UUID);
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(cached);

      const result = adapter.getFirstLinkpathDest(CLASS_UUID, "note.md");

      expect(result!.path).toBe(cached.path);
      // The whole point: a warm cache costs exactly what it cost before.
      expect(mockVault.getMarkdownFiles).not.toHaveBeenCalled();
    });

    it("ignores a non-uuid linkpath without building the registry", () => {
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

      const result = adapter.getFirstLinkpathDest("ems__Task", "note.md");

      expect(result).toBeNull();
      // Measured 2026-08-29: label-bare/uid+alias already resolve upstream in
      // valueToClassURI, so they must not pay for an index they never read.
      expect(mockVault.getMarkdownFiles).not.toHaveBeenCalled();
    });

    it("strips the alias half before matching (uuid|label)", () => {
      const target = classFile(CLASS_UUID);
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
      mockVault.getMarkdownFiles.mockReturnValue([target]);
      mockVault.getAbstractFileByPath.mockReturnValue(target);

      const result = adapter.getFirstLinkpathDest(
        `${CLASS_UUID}|ems__Task`,
        "note.md"
      );

      expect(result).not.toBeNull();
      expect(result!.path).toBe(target.path);
    });

    it("matches a UID-CANON basename that carries a suffix", () => {
      const target = classFile(CLASS_UUID, "-ems__Task");
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
      mockVault.getMarkdownFiles.mockReturnValue([target]);
      mockVault.getAbstractFileByPath.mockReturnValue(target);

      const result = adapter.getFirstLinkpathDest(CLASS_UUID, "note.md");

      expect(result!.path).toBe(target.path);
    });

    it("rebuilds the index when the file count changes", () => {
      const first = classFile(CLASS_UUID);
      const secondUuid = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
      const second = classFile(secondUuid);

      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
      mockVault.getMarkdownFiles.mockReturnValue([first]);
      mockVault.getAbstractFileByPath.mockImplementation((p: string) =>
        p === first.path ? first : p === second.path ? second : null
      );

      expect(adapter.getFirstLinkpathDest(secondUuid, "note.md")).toBeNull();

      // A new class file lands (ExoSync pull, profile apply) — the count moves.
      mockVault.getMarkdownFiles.mockReturnValue([first, second]);

      const result = adapter.getFirstLinkpathDest(secondUuid, "note.md");
      expect(result).not.toBeNull();
      expect(result!.path).toBe(second.path);
    });

    it("fails safe when the indexed path no longer resolves", () => {
      const target = classFile(CLASS_UUID);
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
      mockVault.getMarkdownFiles.mockReturnValue([target]);
      // The file was deleted after the index was built.
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      expect(adapter.getFirstLinkpathDest(CLASS_UUID, "note.md")).toBeNull();
    });
  });

  describe("process", () => {
    it("should process file content", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.process.mockImplementation(async (file, fn) => {
        return fn("Original content");
      });

      const result = await adapter.process(file, (content) =>
        content.toUpperCase()
      );

      expect(result).toBe("ORIGINAL CONTENT");
      expect(mockVault.process).toHaveBeenCalledWith(
        mockTFile,
        expect.any(Function)
      );
    });

    it("should throw error if file not found", async () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(
        adapter.process(file, (content) => content)
      ).rejects.toThrow("File not found: nonexistent.md");
    });
  });

  describe("toTFile", () => {
    it("should convert IFile to TFile", () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);

      const result = adapter.toTFile(file);

      expect(result).toBe(mockTFile);
    });

    it("should throw error if file not found", () => {
      const file: IFile = {
        path: "nonexistent.md",
        basename: "nonexistent",
        name: "nonexistent.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);

      expect(() => adapter.toTFile(file)).toThrow(
        "File not found: nonexistent.md"
      );
    });

    it("should throw error if path points to folder", () => {
      const file: IFile = {
        path: "folder",
        basename: "folder",
        name: "folder",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFolder);

      expect(() => adapter.toTFile(file)).toThrow(
        "File not found: folder"
      );
    });
  });

  describe("caching", () => {
    it("should cache files across different methods", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      // First method call caches the file
      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.read.mockResolvedValue("Content");
      await adapter.read(file);

      // Reset mock to verify caching
      mockVault.getAbstractFileByPath.mockClear();

      // Second method call should use cached file
      await adapter.modify(file, "New content");

      // Should not call getAbstractFileByPath again
      expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
      expect(mockVault.modify).toHaveBeenCalledWith(mockTFile, "New content");
    });

    it("should handle multiple files in cache", async () => {
      const file1: IFile = {
        path: "file1.md",
        basename: "file1",
        name: "file1.md",
        parent: null,
      };

      const file2: IFile = {
        path: "file2.md",
        basename: "file2",
        name: "file2.md",
        parent: null,
      };

      const tFile1 = Object.create(TFile.prototype);
      Object.assign(tFile1, { ...mockTFile, path: "file1.md" });
      const tFile2 = Object.create(TFile.prototype);
      Object.assign(tFile2, { ...mockTFile, path: "file2.md" });

      // Cache both files
      mockVault.getAbstractFileByPath.mockReturnValueOnce(tFile1);
      mockVault.read.mockResolvedValue("Content 1");
      await adapter.read(file1);

      mockVault.getAbstractFileByPath.mockReturnValueOnce(tFile2);
      mockVault.read.mockResolvedValue("Content 2");
      await adapter.read(file2);

      // Reset mock
      mockVault.getAbstractFileByPath.mockClear();

      // Both should use cached versions
      await adapter.delete(file1);
      await adapter.delete(file2);

      expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
      expect(mockFileManager.trashFile).toHaveBeenCalledWith(tFile1);
      expect(mockFileManager.trashFile).toHaveBeenCalledWith(tFile2);
    });
  });

  describe("edge cases", () => {
    it("should handle file with special characters in path", async () => {
      const file: IFile = {
        path: "test/file (with) [special] {chars}.md",
        basename: "file (with) [special] {chars}",
        name: "file (with) [special] {chars}.md",
        parent: null,
      };

      const specialFile = Object.create(TFile.prototype);
      Object.assign(specialFile, {
        ...mockTFile,
        path: "test/file (with) [special] {chars}.md",
        basename: "file (with) [special] {chars}",
        name: "file (with) [special] {chars}.md",
      });

      mockVault.getAbstractFileByPath.mockReturnValue(specialFile);
      mockVault.read.mockResolvedValue("Content");

      const content = await adapter.read(file);

      expect(content).toBe("Content");
      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith(
        "test/file (with) [special] {chars}.md"
      );
    });

    it("should handle deeply nested folders", () => {
      const deepFolder = Object.create(TFolder.prototype);
      Object.assign(deepFolder, {
        path: "a/b/c/d",
        name: "d",
      });

      const file = Object.create(TFile.prototype);
      Object.assign(file, {
        path: "a/b/c/d/file.md",
        basename: "file",
        name: "file.md",
        parent: deepFolder,
      });

      mockVault.getAbstractFileByPath.mockReturnValue(file);

      const result = adapter.getAbstractFileByPath("a/b/c/d/file.md");

      expect(result).toEqual({
        path: "a/b/c/d/file.md",
        basename: "file",
        name: "file.md",
        parent: {
          path: "a/b/c/d",
          name: "d",
        },
      });
    });

    it("should handle empty path", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      const exists = await adapter.exists("");
      expect(exists).toBe(false);
      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("");
    });

    it("should handle frontmatter with special values", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      const specialFrontmatter = {
        "special-key": "value",
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          key: "value",
        },
        null: null,
        undefined: undefined,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: specialFrontmatter,
      } as any);

      const result = adapter.getFrontmatter(file);

      expect(result).toEqual(specialFrontmatter);
    });
  });

  describe("updateLinks", () => {
    beforeEach(() => {
      mockApp.metadataCache = {
        ...mockMetadataCache,
        resolvedLinks: {},
      } as any;
    });

    it("should collapse simple wikilinks to [[uid]]", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, {
        path: "source.md",
        basename: "source",
        name: "source.md",
        parent: null,
      });

      mockApp.metadataCache.resolvedLinks = {
        "source.md": {
          "old/asset1.md": 1,
        },
      };

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockResolvedValue("Content with [[asset1]] link");

      await adapter.updateLinks("old/asset1.md", "new/uid-123.md", "asset1");

      expect(mockVault.modify).toHaveBeenCalledWith(
        sourceFile,
        "Content with [[uid-123]] link"
      );
    });

    it("should collapse heading links to [[uid]]", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, {
        path: "source.md",
        basename: "source",
        name: "source.md",
        parent: null,
      });

      mockApp.metadataCache.resolvedLinks = {
        "source.md": {
          "asset1.md": 1,
        },
      };

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockResolvedValue("Link to [[asset1#section]]");

      await adapter.updateLinks("asset1.md", "uid-123.md", "asset1");

      expect(mockVault.modify).toHaveBeenCalledWith(
        sourceFile,
        "Link to [[uid-123]]"
      );
    });

    it("should collapse block links to [[uid]]", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, {
        path: "source.md",
        basename: "source",
        name: "source.md",
        parent: null,
      });

      mockApp.metadataCache.resolvedLinks = {
        "source.md": {
          "asset1.md": 1,
        },
      };

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockResolvedValue("Link to [[asset1^block-id]]");

      await adapter.updateLinks("asset1.md", "uid-123.md", "asset1");

      expect(mockVault.modify).toHaveBeenCalledWith(
        sourceFile,
        "Link to [[uid-123]]"
      );
    });

    it("should drop custom aliases (collapse to [[uid]])", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, {
        path: "source.md",
        basename: "source",
        name: "source.md",
        parent: null,
      });

      mockApp.metadataCache.resolvedLinks = {
        "source.md": {
          "asset1.md": 1,
        },
      };

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockResolvedValue(
        "Links: [[asset1|Custom Alias]] and [[asset1#section|Another Alias]]"
      );

      await adapter.updateLinks("asset1.md", "uid-123.md", "asset1");

      expect(mockVault.modify).toHaveBeenCalledWith(
        sourceFile,
        "Links: [[uid-123]] and [[uid-123]]"
      );
    });

    it("should update multiple files with links", async () => {
      const source1 = Object.create(TFile.prototype);
      Object.assign(source1, {
        path: "source1.md",
        basename: "source1",
        name: "source1.md",
        parent: null,
      });

      const source2 = Object.create(TFile.prototype);
      Object.assign(source2, {
        path: "source2.md",
        basename: "source2",
        name: "source2.md",
        parent: null,
      });

      mockApp.metadataCache.resolvedLinks = {
        "source1.md": {
          "asset1.md": 1,
        },
        "source2.md": {
          "asset1.md": 2,
        },
      };

      mockVault.getAbstractFileByPath
        .mockReturnValueOnce(source1)
        .mockReturnValueOnce(source2);
      mockVault.read
        .mockResolvedValueOnce("Link in file 1: [[asset1]]")
        .mockResolvedValueOnce("Link in file 2: [[asset1]]");

      await adapter.updateLinks("asset1.md", "uid-123.md", "asset1");

      expect(mockVault.modify).toHaveBeenCalledTimes(2);
      expect(mockVault.modify).toHaveBeenCalledWith(
        source1,
        "Link in file 1: [[uid-123]]"
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        source2,
        "Link in file 2: [[uid-123]]"
      );
    });

    it("should handle no files with links", async () => {
      mockApp.metadataCache.resolvedLinks = {};

      await adapter.updateLinks("asset1.md", "uid-123.md", "asset1");

      expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
      expect(mockVault.read).not.toHaveBeenCalled();
      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should skip non-TFile entries", async () => {
      mockApp.metadataCache.resolvedLinks = {
        "folder": {
          "asset1.md": 1,
        },
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFolder);

      await adapter.updateLinks("asset1.md", "uid-123.md", "asset1");

      expect(mockVault.read).not.toHaveBeenCalled();
      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should handle special characters in basename", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, {
        path: "source.md",
        basename: "source",
        name: "source.md",
        parent: null,
      });

      mockApp.metadataCache.resolvedLinks = {
        "source.md": {
          "asset (with) [special].md": 1,
        },
      };

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockResolvedValue(
        "Link to [[asset (with) [special]]]"
      );

      await adapter.updateLinks(
        "asset (with) [special].md",
        "uid-123.md",
        "asset (with) [special]"
      );

      expect(mockVault.modify).toHaveBeenCalledWith(
        sourceFile,
        "Link to [[uid-123]]"
      );
    });

    it("should update multiple links in same file", async () => {
      const sourceFile = Object.create(TFile.prototype);
      Object.assign(sourceFile, {
        path: "source.md",
        basename: "source",
        name: "source.md",
        parent: null,
      });

      mockApp.metadataCache.resolvedLinks = {
        "source.md": {
          "asset1.md": 3,
        },
      };

      mockVault.getAbstractFileByPath.mockReturnValue(sourceFile);
      mockVault.read.mockResolvedValue(
        "Links: [[asset1]], [[asset1#heading]], [[asset1|Custom]]"
      );

      await adapter.updateLinks("asset1.md", "uid-123.md", "asset1");

      expect(mockVault.modify).toHaveBeenCalledWith(
        sourceFile,
        "Links: [[uid-123]], [[uid-123]], [[uid-123]]"
      );
    });
  });
});