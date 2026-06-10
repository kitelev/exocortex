import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, TFile, EventRef } from "obsidian";
import { InMemoryTripleStore, NoteToRDFConverter, ApplicationErrorHandler, IRI, RDFSInferenceEngine, NonInheritablePropertyRegistry, PrototypeChainMaterializer, INFERRED_GRAPH, Namespace } from "exocortex";
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
        getFileCache: jest.fn().mockReturnValue(null),
      },
    } as unknown as App;

    mockTripleStore = {
      addAll: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      clearGraph: jest.fn().mockResolvedValue(undefined),
      match: jest.fn().mockResolvedValue([]),
      removeAll: jest.fn().mockResolvedValue(0),
    } as any;

    mockConverter = {
      convertVault: jest.fn().mockResolvedValue([]),
      convertVaultWithValidation: jest.fn().mockResolvedValue({
        triples: [],
        skippedFiles: [],
        summary: { total: 0, indexed: 0, skipped: 0 },
        fileSpaces: { prefixes: [], declarationPaths: [], warnings: [] },
      }),
      convertNote: jest.fn().mockResolvedValue([]),
    } as any;

    mockVaultAdapter = {} as any;

    (InMemoryTripleStore as jest.MockedClass<typeof InMemoryTripleStore>).mockImplementation(() => mockTripleStore);
    (NoteToRDFConverter as jest.MockedClass<typeof NoteToRDFConverter>).mockImplementation(() => mockConverter);
    (ObsidianVaultAdapter as jest.MockedClass<typeof ObsidianVaultAdapter>).mockImplementation(() => mockVaultAdapter);

    const mockPrototypePredicate = { value: "https://exocortex.my/ontology/exo#Asset_prototype" };
    (Namespace as any).EXO = { term: jest.fn().mockReturnValue(mockPrototypePredicate) };

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

      expect(mockConverter.convertVaultWithValidation).toHaveBeenCalled();
    });

    it("should not reinitialize if already initialized", async () => {
      await indexer.initialize();
      await indexer.initialize();

      expect(mockConverter.convertVaultWithValidation).toHaveBeenCalledTimes(1);
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
      expect(mockConverter.convertVaultWithValidation).toHaveBeenCalled();
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

  describe("Issue #2503: PrototypeChainMaterializer integration", () => {
    let mockRdfsMaterialize: jest.Mock;
    let mockRegistryInitialize: jest.Mock;
    let mockPrototypeMaterialize: jest.Mock;

    beforeEach(() => {
      mockRdfsMaterialize = jest.fn().mockResolvedValue(0);
      (RDFSInferenceEngine as jest.MockedClass<typeof RDFSInferenceEngine>).mockImplementation(() => ({
        materialize: mockRdfsMaterialize,
      } as any));

      mockRegistryInitialize = jest.fn().mockResolvedValue(undefined);
      (NonInheritablePropertyRegistry as jest.MockedClass<typeof NonInheritablePropertyRegistry>).mockImplementation(() => ({
        initialize: mockRegistryInitialize,
      } as any));

      mockPrototypeMaterialize = jest.fn().mockResolvedValue(0);
      (PrototypeChainMaterializer as jest.MockedClass<typeof PrototypeChainMaterializer>).mockImplementation(() => ({
        materialize: mockPrototypeMaterialize,
      } as any));
    });

    it("should run PrototypeChainMaterializer after RDFSInferenceEngine on initialize", async () => {
      const callOrder: string[] = [];
      mockRdfsMaterialize.mockImplementation(async () => { callOrder.push("rdfs"); return 0; });
      mockRegistryInitialize.mockImplementation(async () => { callOrder.push("registry"); });
      mockPrototypeMaterialize.mockImplementation(async () => { callOrder.push("prototype"); return 0; });

      await indexer.initialize();

      expect(callOrder).toEqual(["rdfs", "registry", "prototype"]);
      expect(mockRegistryInitialize).toHaveBeenCalledWith(mockTripleStore);
      expect(mockPrototypeMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });

    it("should clear inferred graph before re-materialization on updateFile when file is prototype", async () => {
      await indexer.initialize();
      mockTripleStore.clearGraph.mockClear();
      mockRdfsMaterialize.mockClear();
      mockPrototypeMaterialize.mockClear();

      const mockFile = { path: "test.md", extension: "md" } as TFile;
      mockConverter.convertNote.mockResolvedValue([]);
      mockTripleStore.match.mockResolvedValueOnce([{ subject: {}, predicate: {}, object: {} }]);

      await indexer.updateFile(mockFile);

      expect(mockTripleStore.clearGraph).toHaveBeenCalledWith(INFERRED_GRAPH);
      expect(mockRdfsMaterialize).toHaveBeenCalledWith(mockTripleStore);
      expect(mockPrototypeMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });

    it("should clear inferred graph before re-materialization on refresh", async () => {
      await indexer.initialize();
      mockTripleStore.clearGraph.mockClear();
      mockRdfsMaterialize.mockClear();
      mockPrototypeMaterialize.mockClear();

      await indexer.refresh();

      expect(mockTripleStore.clearGraph).toHaveBeenCalledWith(INFERRED_GRAPH);
      expect(mockRdfsMaterialize).toHaveBeenCalledWith(mockTripleStore);
      expect(mockPrototypeMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });

    it("should clear inferred graph before RDFS inference runs", async () => {
      const callOrder: string[] = [];
      mockTripleStore.clearGraph.mockImplementation(async () => { callOrder.push("clearGraph"); });
      mockRdfsMaterialize.mockImplementation(async () => { callOrder.push("rdfs"); return 0; });
      mockRegistryInitialize.mockImplementation(async () => { callOrder.push("registry"); });
      mockPrototypeMaterialize.mockImplementation(async () => { callOrder.push("prototype"); return 0; });

      await indexer.initialize();

      expect(callOrder[0]).toBe("clearGraph");
      expect(callOrder[1]).toBe("rdfs");
      expect(callOrder[2]).toBe("registry");
      expect(callOrder[3]).toBe("prototype");
    });
  });

  describe("Issue #2504: prototype change cascades to instances", () => {
    let mockRdfsMaterialize: jest.Mock;
    let mockRegistryInitialize: jest.Mock;
    let mockPrototypeMaterialize: jest.Mock;

    beforeEach(() => {
      mockRdfsMaterialize = jest.fn().mockResolvedValue(0);
      (RDFSInferenceEngine as jest.MockedClass<typeof RDFSInferenceEngine>).mockImplementation(() => ({
        materialize: mockRdfsMaterialize,
      } as any));

      mockRegistryInitialize = jest.fn().mockResolvedValue(undefined);
      (NonInheritablePropertyRegistry as jest.MockedClass<typeof NonInheritablePropertyRegistry>).mockImplementation(() => ({
        initialize: mockRegistryInitialize,
      } as any));

      mockPrototypeMaterialize = jest.fn().mockResolvedValue(0);
      (PrototypeChainMaterializer as jest.MockedClass<typeof PrototypeChainMaterializer>).mockImplementation(() => ({
        materialize: mockPrototypeMaterialize,
      } as any));
    });

    it("should trigger full re-materialization when updating a prototype file", async () => {
      await indexer.initialize();
      mockTripleStore.clearGraph.mockClear();
      mockRdfsMaterialize.mockClear();
      mockRegistryInitialize.mockClear();
      mockPrototypeMaterialize.mockClear();

      const mockFile = { path: "prototype.md", extension: "md" } as TFile;
      mockConverter.convertNote.mockResolvedValue([]);
      mockTripleStore.match.mockResolvedValueOnce([{ subject: {}, predicate: {}, object: {} }]);

      await indexer.updateFile(mockFile);

      expect(mockTripleStore.clearGraph).toHaveBeenCalledWith(INFERRED_GRAPH);
      expect(mockRdfsMaterialize).toHaveBeenCalledWith(mockTripleStore);
      expect(mockPrototypeMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });

    it("should NOT trigger re-materialization when updating a non-prototype file", async () => {
      await indexer.initialize();
      mockTripleStore.clearGraph.mockClear();
      mockRdfsMaterialize.mockClear();
      mockRegistryInitialize.mockClear();
      mockPrototypeMaterialize.mockClear();

      const mockFile = { path: "regular.md", extension: "md" } as TFile;
      mockConverter.convertNote.mockResolvedValue([]);
      mockTripleStore.match.mockResolvedValue([]);

      await indexer.updateFile(mockFile);

      expect(mockTripleStore.clearGraph).not.toHaveBeenCalled();
      expect(mockRdfsMaterialize).not.toHaveBeenCalled();
      expect(mockPrototypeMaterialize).not.toHaveBeenCalled();
    });

    it("should check for instances using Asset_prototype predicate", async () => {
      await indexer.initialize();

      const mockFile = { path: "test.md", extension: "md" } as TFile;
      mockConverter.convertNote.mockResolvedValue([]);
      mockTripleStore.match.mockResolvedValue([]);

      await indexer.updateFile(mockFile);

      expect((Namespace as any).EXO.term).toHaveBeenCalledWith("Asset_prototype");
      expect(mockTripleStore.match).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ value: "https://exocortex.my/ontology/exo#Asset_prototype" }),
        expect.anything()
      );
    });

    it("should still run inference on refresh regardless of prototype status", async () => {
      await indexer.initialize();
      mockTripleStore.clearGraph.mockClear();
      mockRdfsMaterialize.mockClear();
      mockPrototypeMaterialize.mockClear();

      await indexer.refresh();

      expect(mockTripleStore.clearGraph).toHaveBeenCalledWith(INFERRED_GRAPH);
      expect(mockRdfsMaterialize).toHaveBeenCalledWith(mockTripleStore);
      expect(mockPrototypeMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });
  });

  describe("Issue #2490: RDFS inference materialization", () => {
    let mockMaterialize: jest.Mock;

    beforeEach(() => {
      mockMaterialize = jest.fn().mockResolvedValue(0);
      (RDFSInferenceEngine as jest.MockedClass<typeof RDFSInferenceEngine>).mockImplementation(() => ({
        materialize: mockMaterialize,
      } as any));
    });

    it("should run RDFS inference after initialize addAll", async () => {
      await indexer.initialize();

      expect(mockMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });

    it("should run RDFS inference after updateFile re-converts a prototype note", async () => {
      await indexer.initialize();
      mockMaterialize.mockClear();

      const mockFile = { path: "test.md", extension: "md" } as TFile;
      mockConverter.convertNote.mockResolvedValue([]);
      mockTripleStore.match.mockResolvedValueOnce([{ subject: {}, predicate: {}, object: {} }]);

      await indexer.updateFile(mockFile);

      expect(mockMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });

    it("should run RDFS inference after refresh addAll", async () => {
      await indexer.initialize();
      mockMaterialize.mockClear();

      await indexer.refresh();

      expect(mockMaterialize).toHaveBeenCalledWith(mockTripleStore);
    });
  });
});
