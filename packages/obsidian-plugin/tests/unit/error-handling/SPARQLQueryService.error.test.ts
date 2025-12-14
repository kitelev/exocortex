/**
 * SPARQLQueryService Error Handling Tests
 *
 * Tests error scenarios for:
 * - Initialization failures
 * - Query parsing errors
 * - Query execution errors
 * - Indexer refresh failures
 * - File update errors
 * - Service error wrapping
 *
 * Issue: #788 - Add negative tests for error handling
 */

import { App, TFile } from "obsidian";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import {
  ServiceError,
  ValidationError,
  type ILogger,
  type INotificationService,
} from "exocortex";

// Mock dependencies
jest.mock("../../../src/infrastructure/VaultRDFIndexer", () => ({
  VaultRDFIndexer: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    refresh: jest.fn(),
    updateFile: jest.fn(),
    dispose: jest.fn(),
    getTripleStore: jest.fn(),
  })),
}));

jest.mock("../../../src/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("SPARQLQueryService Error Handling", () => {
  let mockApp: jest.Mocked<App>;
  let mockLogger: jest.Mocked<ILogger>;
  let mockNotifier: jest.Mocked<INotificationService>;
  let mockIndexer: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      vault: {},
      metadataCache: {},
    } as unknown as jest.Mocked<App>;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockNotifier = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      success: jest.fn(),
      confirm: jest.fn().mockResolvedValue(false),
    };

    // Get mock indexer instance
    const { VaultRDFIndexer } = require("../../../src/infrastructure/VaultRDFIndexer");
    mockIndexer = {
      initialize: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
      updateFile: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn(),
      getTripleStore: jest.fn().mockReturnValue({}),
    };
    VaultRDFIndexer.mockImplementation(() => mockIndexer);
  });

  describe("Initialization Errors", () => {
    it("should throw ServiceError when indexer initialization fails", async () => {
      mockIndexer.initialize.mockRejectedValue(new Error("Vault access denied"));

      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      await expect(service.initialize()).rejects.toThrow(ServiceError);
      await expect(service.initialize()).rejects.toThrow("failed to initialize sparql query service");
    });

    it("should include original error message in ServiceError context", async () => {
      const originalError = new Error("Network timeout during vault scan");
      mockIndexer.initialize.mockRejectedValue(originalError);

      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      try {
        await service.initialize();
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).context).toEqual(
          expect.objectContaining({
            service: "SPARQLQueryService",
            operation: "initialize",
            originalError: "Network timeout during vault scan",
          })
        );
      }
    });

    it("should handle non-Error throwable during initialization", async () => {
      mockIndexer.initialize.mockRejectedValue("String error");

      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      await expect(service.initialize()).rejects.toThrow(ServiceError);
    });

    it("should not reinitialize if already initialized", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      await service.initialize();
      await service.initialize();

      expect(mockIndexer.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe("Query Execution Errors", () => {
    it("should throw ServiceError when executor not initialized", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      // Initialize but make getTripleStore return something that causes executor to be null
      mockIndexer.initialize.mockImplementation(() => {
        mockIndexer.getTripleStore.mockReturnValue(null);
      });

      // Force the service into an inconsistent state
      (service as any).isInitialized = true;
      (service as any).executor = null;

      await expect(service.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(ServiceError);
      await expect(service.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow("query executor not initialized");
    });

    it("should throw ValidationError for parse errors (containing 'parse' in message)", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      // Initialize successfully
      await service.initialize();

      // Mock parser to throw error containing 'parse' - triggers ValidationError
      const mockParser = {
        parse: jest.fn().mockImplementation(() => {
          throw new Error("Failed to parse: Unexpected token at line 1");
        }),
      };
      (service as any).parser = mockParser;

      await expect(service.query("INVALID SPARQL")).rejects.toThrow(ValidationError);
    });

    it("should throw ValidationError for syntax errors (containing 'syntax' in message)", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      await service.initialize();

      // Mock parser to throw error containing 'syntax' - triggers ValidationError
      const mockParser = {
        parse: jest.fn().mockImplementation(() => {
          throw new Error("syntax error: missing WHERE clause");
        }),
      };
      (service as any).parser = mockParser;

      await expect(service.query("SELECT *")).rejects.toThrow(ValidationError);
    });

    it("should include query in ValidationError context", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      const badQuery = "SELECT $invalid";
      // Error message must contain 'parse' or 'syntax' to be classified as ValidationError
      const mockParser = {
        parse: jest.fn().mockImplementation(() => {
          throw new Error("parse error: invalid variable");
        }),
      };
      (service as any).parser = mockParser;

      try {
        await service.query(badQuery);
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).context).toEqual(
          expect.objectContaining({
            query: badQuery,
          })
        );
      }
    });

    it("should throw ServiceError for non-parse execution errors", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      const mockParser = { parse: jest.fn().mockReturnValue({ type: "query" }) };
      const mockTranslator = {
        translate: jest.fn().mockImplementation(() => {
          throw new Error("Translation failed: unsupported construct");
        }),
      };
      (service as any).parser = mockParser;
      (service as any).translator = mockTranslator;

      await expect(service.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(ServiceError);
    });

    it("should re-throw ServiceError without wrapping", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      const existingServiceError = new ServiceError("Already a service error", {});
      const mockParser = {
        parse: jest.fn().mockImplementation(() => {
          throw existingServiceError;
        }),
      };
      (service as any).parser = mockParser;

      await expect(service.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toBe(existingServiceError);
    });

    it("should auto-initialize when querying before initialization", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      // Mock a working parser/translator/optimizer/executor
      const mockTripleStore = {
        match: jest.fn().mockReturnValue([]),
      };
      mockIndexer.getTripleStore.mockReturnValue(mockTripleStore);

      const mockParser = { parse: jest.fn().mockReturnValue({ type: "query" }) };
      const mockTranslator = { translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }) };
      const mockOptimizer = { optimize: jest.fn().mockImplementation((x) => x) };

      (service as any).parser = mockParser;
      (service as any).translator = mockTranslator;
      (service as any).optimizer = mockOptimizer;

      // This should trigger auto-initialization
      try {
        await service.query("SELECT * WHERE { ?s ?p ?o }");
      } catch {
        // Query might fail, but initialization should have been called
      }

      expect(mockIndexer.initialize).toHaveBeenCalled();
    });
  });

  describe("Refresh Errors", () => {
    it("should handle indexer refresh failure", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      mockIndexer.refresh.mockRejectedValue(new Error("Refresh failed: vault locked"));

      // The refresh method uses executeWithRetry, which may retry and eventually fail
      await expect(service.refresh()).rejects.toThrow();
    });

    it("should handle network error during refresh", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      const networkError = new Error("ETIMEDOUT");
      mockIndexer.refresh.mockRejectedValue(networkError);

      await expect(service.refresh()).rejects.toThrow();
    });
  });

  describe("UpdateFile Errors", () => {
    it("should handle file update failure", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      const mockFile = { path: "test.md" } as TFile;
      mockIndexer.updateFile.mockRejectedValue(new Error("File update failed"));

      await expect(service.updateFile(mockFile)).rejects.toThrow();
    });

    it("should handle file not found during update", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      const mockFile = { path: "nonexistent.md" } as TFile;
      mockIndexer.updateFile.mockRejectedValue(new Error("File not found: nonexistent.md"));

      await expect(service.updateFile(mockFile)).rejects.toThrow();
    });

    it("should handle corrupted file during update", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      const mockFile = { path: "corrupted.md" } as TFile;
      mockIndexer.updateFile.mockRejectedValue(new Error("Invalid frontmatter: malformed YAML"));

      await expect(service.updateFile(mockFile)).rejects.toThrow();
    });
  });

  describe("Dispose Behavior", () => {
    it("should propagate dispose errors from indexer", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      mockIndexer.dispose.mockImplementation(() => {
        throw new Error("Dispose error");
      });

      // Current implementation propagates indexer.dispose errors
      await expect(service.dispose()).rejects.toThrow("Dispose error");
    });

    it("should reset state after successful dispose", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      // Reset dispose mock to succeed
      mockIndexer.dispose.mockImplementation(() => {});

      await service.dispose();

      // Service should be in uninitialized state
      expect((service as any).isInitialized).toBe(false);
      expect((service as any).executor).toBeNull();
    });

    it("should allow reinitialization after dispose", async () => {
      // Reset dispose mock to succeed and clear init calls
      mockIndexer.dispose.mockImplementation(() => {});
      mockIndexer.initialize.mockClear();

      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();
      await service.dispose();

      // Should be able to initialize again
      await service.initialize();

      expect(mockIndexer.initialize).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error Handler Integration", () => {
    it("should wrap init errors in ServiceError", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      mockIndexer.initialize.mockRejectedValue(new Error("Init failed"));

      await expect(service.initialize()).rejects.toBeInstanceOf(ServiceError);
    });

    it("should classify parse errors as ValidationError", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      // Error message must contain 'parse' to be classified as ValidationError
      const mockParser = {
        parse: jest.fn().mockImplementation(() => {
          throw new Error("Failed to parse query");
        }),
      };
      (service as any).parser = mockParser;

      await expect(service.query("INVALID")).rejects.toBeInstanceOf(ValidationError);
    });

    it("should classify other errors as ServiceError", async () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);
      await service.initialize();

      // Error message without 'parse' or 'syntax' - becomes ServiceError
      const mockParser = {
        parse: jest.fn().mockImplementation(() => {
          throw new Error("Unknown execution error");
        }),
      };
      (service as any).parser = mockParser;

      await expect(service.query("INVALID")).rejects.toBeInstanceOf(ServiceError);
    });
  });

  describe("Constructor with Dependencies", () => {
    it("should use custom logger when provided", () => {
      const customLogger: ILogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const service = new SPARQLQueryService(mockApp, customLogger, mockNotifier);

      expect((service as any).logger).toBe(customLogger);
    });

    it("should be creatable with all parameters", () => {
      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      expect(service).toBeDefined();
      expect((service as any).errorHandler).toBeDefined();
    });
  });

  describe("Initialization Behavior", () => {
    it("should not reinitialize when already initialized", async () => {
      // Clear mocks for accurate call count
      mockIndexer.initialize.mockClear();
      mockIndexer.dispose.mockImplementation(() => {});

      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      // First initialization
      await service.initialize();

      // Second initialization attempt (should be skipped)
      await service.initialize();

      // Should only have called indexer.initialize once
      expect(mockIndexer.initialize).toHaveBeenCalledTimes(1);
    });

    it("should auto-initialize when querying uninitialized service", async () => {
      // Clear mocks to get fresh call count
      mockIndexer.initialize.mockClear();
      mockIndexer.dispose.mockImplementation(() => {});

      const service = new SPARQLQueryService(mockApp, mockLogger, mockNotifier);

      // Query without explicit initialization
      // This will trigger auto-initialization, then fail due to mock not being fully set up
      try {
        await service.query("SELECT * WHERE { ?s ?p ?o }");
      } catch {
        // Expected - query will fail but init should have been called
      }

      // Initialization should have been triggered
      expect(mockIndexer.initialize).toHaveBeenCalled();
    });
  });
});
