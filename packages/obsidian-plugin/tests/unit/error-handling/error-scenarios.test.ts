/**
 * Error Handling Tests - Issue #788
 *
 * This file contains comprehensive negative tests for error handling scenarios
 * across various components of the Exocortex plugin.
 *
 * Test categories:
 * 1. CreateInstanceCommand - modal failures, file conversion errors
 * 2. SPARQLCodeBlockProcessor - invalid queries, triple store failures
 * 3. ObsidianVaultAdapter - missing metadata cache, file operation failures
 * 4. SPARQLApi - query service errors, refresh failures
 * 5. File system errors - permissions, concurrent modification
 * 6. Timeout scenarios
 * 7. Invalid input handling
 * 8. Resource exhaustion simulation
 */

import { flushPromises } from "../helpers/testHelpers";
import { CreateInstanceCommand } from "../../../src/application/commands/CreateInstanceCommand";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";
import { SPARQLApi } from "../../../src/application/api/SPARQLApi";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import { SPARQLCodeBlockProcessor } from "../../../src/application/processors/SPARQLCodeBlockProcessor";
import { App, TFile, TFolder, Notice, WorkspaceLeaf, Vault, MetadataCache, FileManager } from "obsidian";
import {
  TaskCreationService,
  CommandVisibilityContext,
  LoggingService,
  IFile,
} from "exocortex";
import { LabelInputModal } from "../../../src/presentation/modals/LabelInputModal";
import { ExocortexPluginInterface } from "../../../src/types";
import type ExocortexPlugin from "../../../src/ExocortexPlugin";

// Mocks
jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../../src/presentation/modals/LabelInputModal");
jest.mock("../../../src/presentation/modals/DynamicAssetCreationModal");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCreateInstance: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
  WikiLinkHelpers: {
    normalize: jest.fn((str: string) => str),
  },
}));
jest.mock("../../../src/application/services/SPARQLQueryService");

/**
 * 1. CreateInstanceCommand Error Scenarios
 */
describe("CreateInstanceCommand Error Handling", () => {
  let command: CreateInstanceCommand;
  let mockApp: jest.Mocked<App>;
  let mockTaskCreationService: jest.Mocked<TaskCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockPlugin: jest.Mocked<ExocortexPluginInterface>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let mockLeaf: jest.Mocked<WorkspaceLeaf>;

  beforeEach(() => {
    jest.clearAllMocks();

    const { canCreateInstance } = require("exocortex");
    canCreateInstance.mockReturnValue(true);

    mockLeaf = {
      openFile: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceLeaf>;

    mockApp = {
      workspace: {
        getLeaf: jest.fn().mockReturnValue(mockLeaf),
        setActiveLeaf: jest.fn(),
        getActiveFile: jest.fn().mockReturnValue(null),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter: { key: "value" },
        }),
      },
    } as unknown as jest.Mocked<App>;

    mockTaskCreationService = {
      createTask: jest.fn(),
    } as unknown as jest.Mocked<TaskCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn(),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    mockPlugin = {
      settings: {
        useDynamicPropertyFields: false,
      },
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

    mockFile = {
      path: "test-file.md",
      basename: "test-file",
    } as jest.Mocked<TFile>;

    mockContext = {
      instanceClass: "Task",
      status: "Active",
      archived: false,
      isDraft: false,
    };

    command = new CreateInstanceCommand(mockApp, mockTaskCreationService, mockVaultAdapter, mockPlugin);
  });

  describe("Scenario 1: toTFile returns null (file conversion failure)", () => {
    it("should throw error when toTFile returns null after task creation", async () => {
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      // toTFile returns null - simulating file conversion failure
      mockVaultAdapter.toTFile.mockReturnValue(null as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test Instance", taskSize: "medium" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith(
        "Create instance error",
        expect.any(Error)
      );
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create instance:")
      );
    });

    it("should include file path in error message when toTFile fails", async () => {
      const createdFile = { basename: "new-instance", path: "path/to/new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);
      mockVaultAdapter.toTFile.mockReturnValue(null as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("path/to/new-instance.md")
      );
    });
  });

  describe("Scenario 2: TaskCreationService throws various errors", () => {
    it("should handle permission denied error from task creation", async () => {
      const permissionError = new Error("Permission denied: Cannot write to directory");
      mockTaskCreationService.createTask.mockRejectedValue(permissionError);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Create instance error", permissionError);
      expect(Notice).toHaveBeenCalledWith("Failed to create instance: Permission denied: Cannot write to directory");
    });

    it("should handle file already exists error", async () => {
      const existsError = new Error("File already exists: task-name.md");
      mockTaskCreationService.createTask.mockRejectedValue(existsError);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith("Failed to create instance: File already exists: task-name.md");
    });

    it("should handle non-Error thrown values", async () => {
      mockTaskCreationService.createTask.mockRejectedValue("String error message");

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith("Failed to create instance: String error message");
    });
  });

  describe("Scenario 3: Workspace operation failures", () => {
    it("should handle leaf.openFile throwing error", async () => {
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      const mockTFile = { path: "new-instance.md", basename: "new-instance" } as TFile;

      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);
      mockVaultAdapter.toTFile.mockReturnValue(mockTFile);
      mockLeaf.openFile.mockRejectedValue(new Error("Failed to open file"));

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith(
        "Create instance error",
        expect.any(Error)
      );
    });
  });
});

/**
 * 2. SPARQLCodeBlockProcessor Error Scenarios
 */
describe("SPARQLCodeBlockProcessor Error Handling", () => {
  let processor: SPARQLCodeBlockProcessor;
  let mockPlugin: ExocortexPlugin;

  beforeEach(() => {
    mockPlugin = {
      app: {
        vault: {},
        metadataCache: {},
      } as App,
    } as ExocortexPlugin;

    processor = new SPARQLCodeBlockProcessor(mockPlugin);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Scenario 4: Triple store not initialized error", () => {
    it("should throw error when executeQuery called without triple store", async () => {
      // Access private method for testing
      const executeQuery = (processor as any).executeQuery.bind(processor);

      // tripleStore is null by default
      await expect(executeQuery("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(
        "Triple store not initialized"
      );
    });

    it("should throw error in executeAlgebra when triple store is null", async () => {
      const executeAlgebra = (processor as any).executeAlgebra.bind(processor);
      const mockAlgebra = { type: "bgp", triples: [] };

      await expect(executeAlgebra(mockAlgebra)).rejects.toThrow(
        "Triple store not initialized"
      );
    });

    it("should throw error in executeConstructQuery when triple store is null", async () => {
      const executeConstructQuery = (processor as any).executeConstructQuery.bind(processor);
      const mockAlgebra = { type: "construct", template: [], where: { type: "bgp", triples: [] } };

      await expect(executeConstructQuery(mockAlgebra)).rejects.toThrow(
        "Triple store not initialized"
      );
    });
  });

  describe("Scenario 5: Cannot execute unknown operation type", () => {
    it("should throw error for unsupported algebra operation types", async () => {
      // Set up a mock triple store
      (processor as any).tripleStore = {};

      const executeAlgebra = (processor as any).executeAlgebra.bind(processor);
      // Create an operation type that doesn't have 'input' property and isn't 'bgp'
      const unsupportedOperation = { type: "unknown_operation" };

      await expect(executeAlgebra(unsupportedOperation)).rejects.toThrow(
        "Cannot execute operation type: unknown_operation"
      );
    });
  });

  describe("Scenario 6: Refresh query error handling", () => {
    it("should call renderError when refresh fails", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      const testError = new Error("Refresh failed");

      // Mock methods
      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(testError);
      (processor as any).renderError = jest.fn();

      await (processor as any).refreshQuery(el, container, source);

      expect((processor as any).renderError).toHaveBeenCalledWith(testError, container, source);
    });

    it("should handle non-Error objects in refresh error", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      // Mock throwing a non-Error value
      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue("String error");
      (processor as any).renderError = jest.fn();

      await (processor as any).refreshQuery(el, container, source);

      // Should convert string to Error
      expect((processor as any).renderError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "String error" }),
        container,
        source
      );
    });
  });
});

/**
 * 3. ObsidianVaultAdapter Error Scenarios
 */
describe("ObsidianVaultAdapter Error Handling", () => {
  let adapter: ObsidianVaultAdapter;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let mockApp: jest.Mocked<App>;
  let mockFileManager: jest.Mocked<FileManager>;
  let mockTFile: TFile;

  beforeEach(() => {
    mockTFile = Object.create(TFile.prototype);
    Object.assign(mockTFile, {
      path: "test/file.md",
      basename: "file",
      name: "file.md",
      parent: null,
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

  describe("Scenario 7: Vault read operation failures", () => {
    it("should propagate error when vault.read fails", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.read.mockRejectedValue(new Error("Disk read error"));

      await expect(adapter.read(file)).rejects.toThrow("Disk read error");
    });

    it("should propagate error when vault.read returns corrupted data", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.read.mockRejectedValue(new Error("File corrupted: invalid UTF-8 sequence"));

      await expect(adapter.read(file)).rejects.toThrow("File corrupted: invalid UTF-8 sequence");
    });
  });

  describe("Scenario 8: Vault create operation failures", () => {
    it("should propagate error when vault.create fails due to disk full", async () => {
      mockVault.create.mockRejectedValue(new Error("ENOSPC: no space left on device"));

      await expect(adapter.create("new/file.md", "content")).rejects.toThrow(
        "ENOSPC: no space left on device"
      );
    });

    it("should propagate error when vault.create fails due to invalid path", async () => {
      mockVault.create.mockRejectedValue(new Error("Invalid path: contains forbidden characters"));

      await expect(adapter.create("new/<invalid>.md", "content")).rejects.toThrow(
        "Invalid path: contains forbidden characters"
      );
    });

    it("should propagate error when parent directory does not exist", async () => {
      mockVault.create.mockRejectedValue(new Error("ENOENT: no such file or directory"));

      await expect(adapter.create("nonexistent/folder/file.md", "content")).rejects.toThrow(
        "ENOENT: no such file or directory"
      );
    });
  });

  describe("Scenario 9: Vault modify operation failures", () => {
    it("should propagate error when vault.modify fails due to file locked", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.modify.mockRejectedValue(new Error("EBUSY: resource busy or locked"));

      await expect(adapter.modify(file, "new content")).rejects.toThrow(
        "EBUSY: resource busy or locked"
      );
    });

    it("should propagate error when vault.modify fails due to permission denied", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.modify.mockRejectedValue(new Error("EACCES: permission denied"));

      await expect(adapter.modify(file, "new content")).rejects.toThrow(
        "EACCES: permission denied"
      );
    });
  });

  describe("Scenario 10: Delete operation failures", () => {
    it("should propagate error when trashFile fails", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.trashFile.mockRejectedValue(new Error("Failed to move to trash"));

      await expect(adapter.delete(file)).rejects.toThrow("Failed to move to trash");
    });

    it("should propagate error when file is in use", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.trashFile.mockRejectedValue(new Error("EBUSY: file is in use"));

      await expect(adapter.delete(file)).rejects.toThrow("EBUSY: file is in use");
    });
  });

  describe("Scenario 11: Rename operation failures", () => {
    it("should propagate error when target already exists", async () => {
      const file: IFile = {
        path: "old/path.md",
        basename: "path",
        name: "path.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.renameFile.mockRejectedValue(new Error("Target file already exists"));

      await expect(adapter.rename(file, "new/path.md")).rejects.toThrow(
        "Target file already exists"
      );
    });

    it("should propagate error when path is too long", async () => {
      const file: IFile = {
        path: "old/path.md",
        basename: "path",
        name: "path.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockFileManager.renameFile.mockRejectedValue(new Error("ENAMETOOLONG: path too long"));

      await expect(adapter.rename(file, "a".repeat(500) + ".md")).rejects.toThrow(
        "ENAMETOOLONG: path too long"
      );
    });
  });

  describe("Scenario 12: CreateFolder operation failures", () => {
    it("should propagate error when folder already exists", async () => {
      mockVault.createFolder.mockRejectedValue(new Error("Folder already exists"));

      await expect(adapter.createFolder("existing/folder")).rejects.toThrow(
        "Folder already exists"
      );
    });

    it("should propagate error when creating folder with invalid name", async () => {
      mockVault.createFolder.mockRejectedValue(new Error("Invalid folder name"));

      await expect(adapter.createFolder("folder/with/<invalid>/chars")).rejects.toThrow(
        "Invalid folder name"
      );
    });
  });

  describe("Scenario 13: Process operation failures", () => {
    it("should propagate error when process callback throws", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.process.mockImplementation(async (file, fn) => {
        return fn("content");
      });

      await expect(
        adapter.process(file, () => {
          throw new Error("Processing error");
        })
      ).rejects.toThrow("Processing error");
    });
  });

  describe("Scenario 14: UpdateFrontmatter operation failures", () => {
    it("should propagate error when processFrontMatter fails", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: {} } as any);
      mockFileManager.processFrontMatter.mockRejectedValue(new Error("Failed to parse frontmatter"));

      await expect(
        adapter.updateFrontmatter(file, (fm) => ({ ...fm, newKey: "value" }))
      ).rejects.toThrow("Failed to parse frontmatter");
    });

    it("should propagate error when updater function throws", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: {} } as any);

      await expect(
        adapter.updateFrontmatter(file, () => {
          throw new Error("Updater error");
        })
      ).rejects.toThrow("Updater error");
    });
  });

  describe("Scenario 15: getDefaultNewFileParent edge cases", () => {
    it("should return null when fileManager.getNewFileParent returns null", () => {
      mockFileManager.getNewFileParent.mockReturnValue(null as any);

      const result = adapter.getDefaultNewFileParent();

      expect(result).toBeNull();
    });
  });
});

/**
 * 4. SPARQLApi Error Scenarios
 */
describe("SPARQLApi Error Handling", () => {
  let api: SPARQLApi;
  let mockPlugin: ExocortexPlugin;
  let mockQueryService: jest.Mocked<SPARQLQueryService>;

  beforeEach(() => {
    mockPlugin = {
      app: {} as App,
    } as ExocortexPlugin;

    mockQueryService = {
      query: jest.fn(),
      refresh: jest.fn(),
      dispose: jest.fn(),
      getTripleStore: jest.fn().mockReturnValue({}),
    } as any;

    (SPARQLQueryService as jest.Mock).mockImplementation(() => mockQueryService);

    api = new SPARQLApi(mockPlugin);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Scenario 16: Query syntax errors", () => {
    it("should propagate parse error for invalid SPARQL syntax", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Parse error at line 1: expected SELECT"));

      await expect(api.query("INVALID QUERY")).rejects.toThrow(
        "Parse error at line 1: expected SELECT"
      );
    });

    it("should propagate error for malformed PREFIX", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Invalid PREFIX declaration"));

      await expect(api.query("PREFX wrong SELECT * WHERE {}")).rejects.toThrow(
        "Invalid PREFIX declaration"
      );
    });
  });

  describe("Scenario 17: Query execution errors", () => {
    it("should propagate error when triple store is unavailable", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Triple store not available"));

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(
        "Triple store not available"
      );
    });

    it("should propagate error for timeout during query execution", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Query execution timeout"));

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(
        "Query execution timeout"
      );
    });
  });

  describe("Scenario 18: Refresh operation errors", () => {
    it("should propagate error when refresh fails", async () => {
      mockQueryService.refresh.mockRejectedValue(new Error("Failed to refresh triple store"));

      await expect(api.refresh()).rejects.toThrow("Failed to refresh triple store");
    });

    it("should propagate error when vault is inaccessible during refresh", async () => {
      mockQueryService.refresh.mockRejectedValue(new Error("Vault inaccessible"));

      await expect(api.refresh()).rejects.toThrow("Vault inaccessible");
    });
  });

  describe("Scenario 19: Dispose operation errors", () => {
    it("should propagate error when dispose fails", async () => {
      mockQueryService.dispose.mockRejectedValue(new Error("Cleanup failed"));

      await expect(api.dispose()).rejects.toThrow("Cleanup failed");
    });
  });
});

/**
 * 5. Concurrent Modification Error Scenarios
 */
describe("Concurrent Modification Error Handling", () => {
  let adapter: ObsidianVaultAdapter;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let mockApp: jest.Mocked<App>;
  let mockFileManager: jest.Mocked<FileManager>;
  let mockTFile: TFile;

  beforeEach(() => {
    mockTFile = Object.create(TFile.prototype);
    Object.assign(mockTFile, {
      path: "test/file.md",
      basename: "file",
      name: "file.md",
      parent: null,
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

  describe("Scenario 20: Concurrent file modification", () => {
    it("should handle concurrent modification detection", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.modify.mockRejectedValue(
        new Error("File was modified externally. Please refresh and try again.")
      );

      await expect(adapter.modify(file, "new content")).rejects.toThrow(
        "File was modified externally. Please refresh and try again."
      );
    });

    it("should handle stale file reference error", async () => {
      const file: IFile = {
        path: "test/file.md",
        basename: "file",
        name: "file.md",
        parent: null,
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockTFile);
      mockVault.modify.mockRejectedValue(new Error("Stale file reference: file was moved or deleted"));

      await expect(adapter.modify(file, "new content")).rejects.toThrow(
        "Stale file reference: file was moved or deleted"
      );
    });
  });
});

/**
 * 6. Invalid Input Handling Tests
 */
describe("Invalid Input Handling", () => {
  let adapter: ObsidianVaultAdapter;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let mockApp: jest.Mocked<App>;
  let mockFileManager: jest.Mocked<FileManager>;

  beforeEach(() => {
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

  describe("Scenario 21: Empty or whitespace-only paths", () => {
    it("should handle empty path for getAbstractFileByPath", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const result = adapter.getAbstractFileByPath("");

      expect(result).toBeNull();
    });

    it("should propagate error for empty path in create", async () => {
      mockVault.create.mockRejectedValue(new Error("Path cannot be empty"));

      await expect(adapter.create("", "content")).rejects.toThrow("Path cannot be empty");
    });

    it("should propagate error for whitespace-only path", async () => {
      mockVault.create.mockRejectedValue(new Error("Invalid path"));

      await expect(adapter.create("   ", "content")).rejects.toThrow("Invalid path");
    });
  });

  describe("Scenario 22: Unicode and special character handling", () => {
    it("should handle Unicode paths", async () => {
      mockVault.create.mockRejectedValue(new Error("Cannot create file with unsupported characters"));

      await expect(adapter.create("файл/测试.md", "content")).rejects.toThrow(
        "Cannot create file with unsupported characters"
      );
    });

    it("should handle paths with control characters", async () => {
      mockVault.create.mockRejectedValue(new Error("Path contains invalid control characters"));

      await expect(adapter.create("file\x00name.md", "content")).rejects.toThrow(
        "Path contains invalid control characters"
      );
    });
  });
});

/**
 * 7. Resource Exhaustion Scenarios
 */
describe("Resource Exhaustion Scenarios", () => {
  describe("Scenario 23: Memory exhaustion simulation", () => {
    let api: SPARQLApi;
    let mockPlugin: ExocortexPlugin;
    let mockQueryService: jest.Mocked<SPARQLQueryService>;

    beforeEach(() => {
      mockPlugin = {
        app: {} as App,
      } as ExocortexPlugin;

      mockQueryService = {
        query: jest.fn(),
        refresh: jest.fn(),
        dispose: jest.fn(),
        getTripleStore: jest.fn().mockReturnValue({}),
      } as any;

      (SPARQLQueryService as jest.Mock).mockImplementation(() => mockQueryService);

      api = new SPARQLApi(mockPlugin);
    });

    it("should propagate out of memory error", async () => {
      mockQueryService.query.mockRejectedValue(new Error("JavaScript heap out of memory"));

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(
        "JavaScript heap out of memory"
      );
    });

    it("should propagate stack overflow error", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Maximum call stack size exceeded"));

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(
        "Maximum call stack size exceeded"
      );
    });
  });
});

/**
 * 8. Timeout Scenarios
 */
describe("Timeout Scenarios", () => {
  describe("Scenario 24: Operation timeouts", () => {
    let api: SPARQLApi;
    let mockPlugin: ExocortexPlugin;
    let mockQueryService: jest.Mocked<SPARQLQueryService>;

    beforeEach(() => {
      mockPlugin = {
        app: {} as App,
      } as ExocortexPlugin;

      mockQueryService = {
        query: jest.fn(),
        refresh: jest.fn(),
        dispose: jest.fn(),
        getTripleStore: jest.fn().mockReturnValue({}),
      } as any;

      (SPARQLQueryService as jest.Mock).mockImplementation(() => mockQueryService);

      api = new SPARQLApi(mockPlugin);
    });

    it("should propagate query timeout error", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Query timed out after 30000ms"));

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(
        "Query timed out after 30000ms"
      );
    });

    it("should propagate refresh timeout error", async () => {
      mockQueryService.refresh.mockRejectedValue(new Error("Refresh operation timed out"));

      await expect(api.refresh()).rejects.toThrow("Refresh operation timed out");
    });
  });
});
