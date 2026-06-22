import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import { ApplicationErrorHandler } from "@kitelev/exocortex-core";
import type { App, TFile } from "obsidian";

// Mock VaultRDFIndexer - define the mock methods object in the factory
jest.mock("../../../src/infrastructure/VaultRDFIndexer", () => {
  return {
    VaultRDFIndexer: jest.fn(),
  };
});

// Mock exocortex - ApplicationErrorHandler
jest.mock("@kitelev/exocortex-core", () => {
  return {
    ...jest.requireActual("@kitelev/exocortex-core"),
    ApplicationErrorHandler: jest.fn(),
  };
});

describe("SPARQLQueryService", () => {
  let service: SPARQLQueryService;
  let mockApp: App;
  let mockIndexer: {
    initialize: jest.Mock;
    refresh: jest.Mock;
    updateFile: jest.Mock;
    dispose: jest.Mock;
    getTripleStore: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock indexer methods
    mockIndexer = {
      initialize: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
      updateFile: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn(),
      getTripleStore: jest.fn().mockReturnValue({}),
    };

    // Set up VaultRDFIndexer mock implementation
    (VaultRDFIndexer as jest.MockedClass<typeof VaultRDFIndexer>).mockImplementation(() => mockIndexer as any);

    // Set up ApplicationErrorHandler mock implementation
    (ApplicationErrorHandler as jest.MockedClass<typeof ApplicationErrorHandler>).mockImplementation(() => ({
      executeWithRetry: jest.fn().mockImplementation(async (operation: () => Promise<unknown>) => {
        return await operation();
      }),
      handle: jest.fn(),
    } as any));

    mockApp = {
      vault: {
        on: jest.fn(),
        off: jest.fn(),
        offref: jest.fn(),
        getAllFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        on: jest.fn(),
        off: jest.fn(),
      },
    } as unknown as App;

    service = new SPARQLQueryService(mockApp);
  });

  describe("initialization", () => {
    it("should create SPARQLQueryService instance", () => {
      expect(service).toBeDefined();
    });

    it("should be an instance of SPARQLQueryService", () => {
      expect(service).toBeInstanceOf(SPARQLQueryService);
    });

    it("should construct a single VaultRDFIndexer for the vault", () => {
      // Behavior, not structure: the service owns exactly one indexer that it
      // delegates to (see "service methods" below). We intentionally do NOT pin
      // the DI argument order/positions — that is an internal wiring choice, not
      // part of the service's public contract, and pinning it makes the test
      // break on any harmless constructor refactor.
      expect(VaultRDFIndexer).toHaveBeenCalledTimes(1);
    });
  });

  describe("service methods", () => {
    it("should call initialize on indexer", async () => {
      await service.initialize();
      expect(mockIndexer.initialize).toHaveBeenCalled();
    });

    it("should only initialize once when called multiple times", async () => {
      mockIndexer.getTripleStore = jest.fn().mockReturnValue({});

      await service.initialize();
      await service.initialize(); // Second call should return early

      expect(mockIndexer.initialize).toHaveBeenCalledTimes(1);
    });

    it("should call refresh on indexer", async () => {
      await service.refresh();
      expect(mockIndexer.refresh).toHaveBeenCalled();
    });

    it("should call updateFile on indexer", async () => {
      const mockFile = { path: "test.md" } as TFile;
      await service.updateFile(mockFile);
      expect(mockIndexer.updateFile).toHaveBeenCalledWith(mockFile);
    });

    it("should call dispose on indexer", async () => {
      await service.dispose();
      expect(mockIndexer.dispose).toHaveBeenCalled();
    });

    it("should reset state on dispose", async () => {
      mockIndexer.getTripleStore = jest.fn().mockReturnValue({});

      await service.initialize();
      await service.dispose();

      // After dispose, initialize should work again
      await service.initialize();
      expect(mockIndexer.initialize).toHaveBeenCalledTimes(2);
    });
  });

  // Follow-up (held for Andrey): query() is the service's primary method but is
  // not exercised here because its central collaborator (VaultRDFIndexer) is
  // fully mocked — a unit test would only assert pass-through wiring. Lifting
  // query() to an integration test (real InMemoryTripleStore, as the engine
  // layer does) was deferred from this cleanup as a test-pyramid change.
});
