import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, TFile, EventRef } from "obsidian";
import { InMemoryTripleStore, NoteToRDFConverter, ApplicationErrorHandler, IRI } from "exocortex";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

jest.mock("exocortex");
jest.mock("../../../src/adapters/ObsidianVaultAdapter");

describe("VaultRDFIndexer", () => {
  let indexer: VaultRDFIndexer;
  let mockApp: App;
  let mockEventRefs: EventRef[];
  let mockTripleStore: jest.Mocked<InMemoryTripleStore>;
  let mockConverter: jest.Mocked<NoteToRDFConverter>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up ApplicationErrorHandler mock to execute operations directly
    (ApplicationErrorHandler as jest.MockedClass<typeof ApplicationErrorHandler>).mockImplementation(() => ({
      executeWithRetry: jest.fn().mockImplementation(async (operation: () => Promise<unknown>) => {
        return await operation();
      }),
      handle: jest.fn(),
    } as any));

    mockEventRefs = [];
    mockApp = {
      vault: {
        on: jest.fn((event, handler) => {
          const ref = { event, handler } as unknown as EventRef;
          mockEventRefs.push(ref);
          return ref;
        }),
        off: jest.fn(),
        offref: jest.fn(),
        getAllFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        on: jest.fn(),
        off: jest.fn(),
      },
    } as unknown as App;

    mockTripleStore = {
      addAll: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      match: jest.fn().mockResolvedValue([]),
      removeAll: jest.fn().mockResolvedValue(0),
    } as any;

    mockConverter = {
      convertVault: jest.fn().mockResolvedValue([]),
      convertNote: jest.fn().mockResolvedValue([]),
    } as any;

    mockVaultAdapter = {} as any;

    (InMemoryTripleStore as jest.MockedClass<typeof InMemoryTripleStore>).mockImplementation(() => mockTripleStore);
    (NoteToRDFConverter as jest.MockedClass<typeof NoteToRDFConverter>).mockImplementation(() => mockConverter);
    (ObsidianVaultAdapter as jest.MockedClass<typeof ObsidianVaultAdapter>).mockImplementation(() => mockVaultAdapter);

    indexer = new VaultRDFIndexer(mockApp);
  });

  describe("initialization", () => {
    it("should create VaultRDFIndexer instance", () => {
      expect(indexer).toBeDefined();
    });

    it("should be an instance of VaultRDFIndexer", () => {
      expect(indexer).toBeInstanceOf(VaultRDFIndexer);
    });

    it("should register event listeners on initialize", async () => {
      await indexer.initialize();

      expect(mockApp.vault.on).toHaveBeenCalledWith("modify", expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith("delete", expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith("create", expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith("rename", expect.any(Function));
    });

    it("should convert vault on initialize", async () => {
      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalled();
    });

    it("should not reinitialize if already initialized", async () => {
      await indexer.initialize();
      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalledTimes(1);
    });
  });

  describe("public API", () => {
    it("should have initialize method", () => {
      expect(typeof indexer.initialize).toBe("function");
    });

    it("should have updateFile method", () => {
      expect(typeof indexer.updateFile).toBe("function");
    });

    it("should have removeFile method", () => {
      expect(typeof indexer.removeFile).toBe("function");
    });

    it("should have renameFile method", () => {
      expect(typeof indexer.renameFile).toBe("function");
    });

    it("should have refresh method", () => {
      expect(typeof indexer.refresh).toBe("function");
    });

    it("should have getTripleStore method", () => {
      expect(typeof indexer.getTripleStore).toBe("function");
    });

    it("should have dispose method", () => {
      expect(typeof indexer.dispose).toBe("function");
    });
  });

  describe("file operations", () => {
    beforeEach(async () => {
      await indexer.initialize();
    });

    it("should update file for markdown files", async () => {
      const mockFile = { path: "test.md", extension: "md" } as TFile;

      await indexer.updateFile(mockFile);

      expect(mockConverter.convertNote).toHaveBeenCalledWith(mockFile);
    });

    it("should skip non-markdown files", async () => {
      const mockFile = { path: "test.pdf", extension: "pdf" } as TFile;

      await indexer.updateFile(mockFile);

      expect(mockConverter.convertNote).not.toHaveBeenCalled();
    });

    it("should remove file triples", async () => {
      const mockFile = { path: "test.md" } as TFile;

      await indexer.removeFile(mockFile);

      expect(mockTripleStore.match).toHaveBeenCalled();
    });

    it("should handle file rename", async () => {
      const mockFile = { path: "new.md", extension: "md" } as TFile;
      const oldPath = "old.md";

      await indexer.renameFile(mockFile, oldPath);

      expect(mockTripleStore.match).toHaveBeenCalled();
      expect(mockConverter.convertNote).toHaveBeenCalled();
    });
  });

  describe("cache management", () => {
    beforeEach(async () => {
      await indexer.initialize();
    });

    it("should refresh triple store", async () => {
      await indexer.refresh();

      expect(mockTripleStore.clear).toHaveBeenCalled();
      expect(mockConverter.convertVault).toHaveBeenCalled();
    });

    it("should return triple store instance", () => {
      const result = indexer.getTripleStore();

      expect(result).toBeDefined();
    });
  });

  describe("cleanup", () => {
    beforeEach(async () => {
      await indexer.initialize();
    });

    it("should unregister event listeners on dispose", () => {
      const eventRefCount = mockEventRefs.length;

      indexer.dispose();

      expect(mockApp.vault.offref).toHaveBeenCalledTimes(eventRefCount);
    });
  });

  describe("Issue #2488: IRI encoding consistency", () => {
    let iriConstructorCalls: string[];

    beforeEach(async () => {
      iriConstructorCalls = [];
      (IRI as unknown as jest.Mock).mockImplementation((value: string) => {
        iriConstructorCalls.push(value);
        return { value };
      });
      await indexer.initialize();
    });

    it("should use encodeURI for subdirectory file paths in removeFileTriples (modify scenario)", async () => {
      const subdirPath = "My Folder/My Note.md";
      const mockFile = { path: subdirPath, extension: "md" } as TFile;

      mockTripleStore.match.mockResolvedValue([]);
      mockConverter.convertNote.mockResolvedValue([]);

      await indexer.updateFile(mockFile);

      const removeIRI = iriConstructorCalls.find(v => v.includes("My%20Folder"));
      expect(removeIRI).toBeDefined();
      expect(removeIRI).toBe(`obsidian://vault/My%20Folder/My%20Note.md`);
      expect(removeIRI).not.toContain("My%20Folder%2FMy%20Note.md");
    });

    it("should use encodeURI for subdirectory file paths in removeFileTriples (delete scenario)", async () => {
      const subdirPath = "03 Knowledge/kitelev/some-note.md";
      const mockFile = { path: subdirPath } as TFile;

      mockTripleStore.match.mockResolvedValue([{ subject: {}, predicate: {}, object: {} }]);
      mockTripleStore.removeAll.mockResolvedValue(1);

      await indexer.removeFile(mockFile);

      const removeIRI = iriConstructorCalls.find(v => v.includes("03%20Knowledge"));
      expect(removeIRI).toBeDefined();
      expect(removeIRI).toBe(`obsidian://vault/03%20Knowledge/kitelev/some-note.md`);
      expect(removeIRI).not.toContain("%2F");
    });
  });
});
