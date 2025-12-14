/**
 * SPARQLApi Error Handling Tests
 *
 * Tests error scenarios for:
 * - Query service errors
 * - Refresh errors
 * - Dispose errors
 * - Triple store access errors
 *
 * Issue: #788 - Add negative tests for error handling
 */

import { SPARQLApi } from "../../../src/application/api/SPARQLApi";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import type ExocortexPlugin from "../../../src/ExocortexPlugin";
import type { App } from "obsidian";
import { ServiceError, ValidationError } from "exocortex";

jest.mock("../../../src/application/services/SPARQLQueryService");

describe("SPARQLApi Error Handling", () => {
  let api: SPARQLApi;
  let mockPlugin: ExocortexPlugin;
  let mockApp: App;
  let mockQueryService: jest.Mocked<SPARQLQueryService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {} as App;
    mockPlugin = {
      app: mockApp,
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

  describe("Query Error Handling", () => {
    it("should propagate ServiceError from query service", async () => {
      const serviceError = new ServiceError("Query execution failed", {
        service: "SPARQLQueryService",
        operation: "query",
      });
      mockQueryService.query.mockRejectedValue(serviceError);

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(ServiceError);
      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow("Query execution failed");
    });

    it("should propagate ValidationError from query service", async () => {
      const validationError = new ValidationError("Invalid SPARQL syntax", {
        query: "INVALID",
      });
      mockQueryService.query.mockRejectedValue(validationError);

      await expect(api.query("INVALID")).rejects.toThrow(ValidationError);
      await expect(api.query("INVALID")).rejects.toThrow("Invalid SPARQL syntax");
    });

    it("should propagate generic Error from query service", async () => {
      const genericError = new Error("Unknown error occurred");
      mockQueryService.query.mockRejectedValue(genericError);

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow("Unknown error occurred");
    });

    it("should handle timeout errors", async () => {
      const timeoutError = new Error("Query timeout after 30000ms");
      mockQueryService.query.mockRejectedValue(timeoutError);

      await expect(api.query("SELECT * WHERE { ?s ?p ?o . ?o ?p2 ?o2 }")).rejects.toThrow(
        "Query timeout"
      );
    });

    it("should handle memory errors", async () => {
      const memoryError = new Error("JavaScript heap out of memory");
      mockQueryService.query.mockRejectedValue(memoryError);

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(
        "JavaScript heap out of memory"
      );
    });

    it("should return correct count even when query returns empty results", async () => {
      mockQueryService.query.mockResolvedValue([]);

      const result = await api.query("SELECT * WHERE { ?s ?p ?o }");

      expect(result.bindings).toEqual([]);
      expect(result.count).toBe(0);
    });

    it("should handle null returned from query service", async () => {
      mockQueryService.query.mockResolvedValue(null as any);

      // This should handle null gracefully or throw
      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow();
    });

    it("should handle undefined returned from query service", async () => {
      mockQueryService.query.mockResolvedValue(undefined as any);

      await expect(api.query("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow();
    });
  });

  describe("Refresh Error Handling", () => {
    it("should propagate refresh errors", async () => {
      const refreshError = new Error("Failed to refresh: vault unavailable");
      mockQueryService.refresh.mockRejectedValue(refreshError);

      await expect(api.refresh()).rejects.toThrow("Failed to refresh: vault unavailable");
    });

    it("should handle network timeout during refresh", async () => {
      const timeoutError = new Error("ETIMEDOUT");
      mockQueryService.refresh.mockRejectedValue(timeoutError);

      await expect(api.refresh()).rejects.toThrow("ETIMEDOUT");
    });

    it("should handle permission errors during refresh", async () => {
      const permissionError = new Error("EACCES: permission denied");
      mockQueryService.refresh.mockRejectedValue(permissionError);

      await expect(api.refresh()).rejects.toThrow("EACCES: permission denied");
    });
  });

  describe("Dispose Error Handling", () => {
    it("should propagate dispose errors", async () => {
      const disposeError = new Error("Failed to dispose resources");
      mockQueryService.dispose.mockRejectedValue(disposeError);

      await expect(api.dispose()).rejects.toThrow("Failed to dispose resources");
    });

    it("should handle async dispose errors", async () => {
      mockQueryService.dispose.mockRejectedValue(new Error("Async dispose failed"));

      await expect(api.dispose()).rejects.toThrow("Async dispose failed");
    });
  });

  describe("Triple Store Error Handling", () => {
    it("should handle getTripleStore returning null", () => {
      mockQueryService.getTripleStore.mockReturnValue(null as any);

      const tripleStore = api.getTripleStore();

      expect(tripleStore).toBeNull();
    });

    it("should handle getTripleStore throwing error", () => {
      mockQueryService.getTripleStore.mockImplementation(() => {
        throw new Error("Triple store not initialized");
      });

      expect(() => api.getTripleStore()).toThrow("Triple store not initialized");
    });
  });

  describe("Error Type Preservation", () => {
    it("should preserve ServiceError type and context", async () => {
      const context = {
        service: "SPARQLQueryService",
        operation: "query",
        query: "SELECT * WHERE { ?s ?p ?o }",
      };
      const serviceError = new ServiceError("Query failed", context);
      mockQueryService.query.mockRejectedValue(serviceError);

      try {
        await api.query("SELECT * WHERE { ?s ?p ?o }");
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).context).toEqual(context);
      }
    });

    it("should preserve ValidationError type and context", async () => {
      const context = {
        query: "INVALID QUERY",
        originalError: "Unexpected token",
      };
      const validationError = new ValidationError("Invalid query", context);
      mockQueryService.query.mockRejectedValue(validationError);

      try {
        await api.query("INVALID QUERY");
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).context).toEqual(context);
      }
    });

    it("should preserve error stack trace", async () => {
      const originalError = new Error("Original error with stack");
      mockQueryService.query.mockRejectedValue(originalError);

      try {
        await api.query("SELECT * WHERE { ?s ?p ?o }");
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBe(originalError);
        expect((error as Error).stack).toBeDefined();
        expect((error as Error).stack).toContain("Original error with stack");
      }
    });
  });

  describe("Concurrent Operation Errors", () => {
    it("should handle concurrent query errors independently", async () => {
      const error1 = new Error("Query 1 failed");
      const error2 = new Error("Query 2 failed");

      mockQueryService.query
        .mockRejectedValueOnce(error1)
        .mockRejectedValueOnce(error2);

      const promise1 = api.query("SELECT * WHERE { ?s ?p ?o } LIMIT 1");
      const promise2 = api.query("SELECT * WHERE { ?s ?p ?o } LIMIT 2");

      await expect(promise1).rejects.toThrow("Query 1 failed");
      await expect(promise2).rejects.toThrow("Query 2 failed");
    });

    it("should handle mixed success and failure in concurrent queries", async () => {
      mockQueryService.query
        .mockResolvedValueOnce([{ var: "value1" }] as any)
        .mockRejectedValueOnce(new Error("Query 2 failed"));

      const promise1 = api.query("SELECT * WHERE { ?s ?p ?o } LIMIT 1");
      const promise2 = api.query("SELECT * WHERE { ?s ?p ?o } LIMIT 2");

      const result1 = await promise1;
      expect(result1.count).toBe(1);

      await expect(promise2).rejects.toThrow("Query 2 failed");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty query string", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Empty query"));

      await expect(api.query("")).rejects.toThrow("Empty query");
    });

    it("should handle query with only whitespace", async () => {
      mockQueryService.query.mockRejectedValue(new Error("Invalid query: whitespace only"));

      await expect(api.query("   \n\t   ")).rejects.toThrow("Invalid query");
    });

    it("should handle very long query strings", async () => {
      const longQuery = "SELECT " + "?var".repeat(10000) + " WHERE { ?s ?p ?o }";
      mockQueryService.query.mockRejectedValue(new Error("Query too long"));

      await expect(api.query(longQuery)).rejects.toThrow("Query too long");
    });

    it("should handle query with special characters", async () => {
      const queryWithSpecialChars = 'SELECT * WHERE { ?s rdfs:label "test\0value" }';
      mockQueryService.query.mockRejectedValue(new Error("Invalid character in query"));

      await expect(api.query(queryWithSpecialChars)).rejects.toThrow("Invalid character");
    });

    it("should handle query with unicode characters", async () => {
      const unicodeQuery = 'SELECT * WHERE { ?s rdfs:label "日本語" }';
      mockQueryService.query.mockResolvedValue([{ s: "result" }] as any);

      const result = await api.query(unicodeQuery);
      expect(result.count).toBe(1);
    });
  });
});
