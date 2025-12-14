/**
 * SPARQLCodeBlockProcessor Error Handling Tests
 *
 * Tests error scenarios for:
 * - Invalid SPARQL query syntax
 * - Triple store initialization failures
 * - Query execution errors
 * - Parser errors with line/column info
 * - Refresh errors
 * - Non-Error throwable handling
 *
 * Issue: #788 - Add negative tests for error handling
 */

import type { MarkdownPostProcessorContext, App, Vault, MetadataCache, EventRef } from "obsidian";
import { SPARQLCodeBlockProcessor } from "../../../src/application/processors/SPARQLCodeBlockProcessor";
import type ExocortexPlugin from "../../../src/ExocortexPlugin";
import { SPARQLParseError } from "exocortex";

// Mock Notice
const mockNotice = jest.fn();
jest.mock("obsidian", () => ({
  Notice: function (message: string, timeout?: number) {
    mockNotice(message, timeout);
  },
  MarkdownRenderChild: class MockMarkdownRenderChild {
    containerEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
      this.containerEl = containerEl;
    }
    onload(): void {}
    onunload(): void {}
  },
}));

describe("SPARQLCodeBlockProcessor Error Handling", () => {
  let processor: SPARQLCodeBlockProcessor;
  let mockPlugin: ExocortexPlugin;
  let mockContext: MarkdownPostProcessorContext;
  let mockEl: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotice.mockClear();

    mockPlugin = {
      app: {
        vault: {} as Vault,
        metadataCache: {
          on: jest.fn().mockReturnValue({} as EventRef),
          offref: jest.fn(),
        } as unknown as MetadataCache,
      } as App,
    } as ExocortexPlugin;

    mockContext = {
      addChild: jest.fn(),
    } as any;

    mockEl = document.createElement("div");

    processor = new SPARQLCodeBlockProcessor(mockPlugin);
  });

  describe("Invalid Query Syntax Errors", () => {
    it("should handle malformed SELECT query", async () => {
      // Mock ensureTripleStoreLoaded to succeed
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);

      // Mock executeQuery to throw parse error
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Expected 'WHERE' but found 'FROM'")
      );

      await processor.process("SELECT * FROM", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle empty query string", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Empty query string")
      );

      await processor.process("", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle query with invalid characters", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Unexpected character '$' at position 10")
      );

      await processor.process("SELECT $invalid WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle unclosed brackets in query", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Unexpected end of input: unclosed '{'")
      );

      await processor.process("SELECT * WHERE { ?s ?p ?o", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle SPARQLParseError with line and column info", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);

      const parseError = new SPARQLParseError("Syntax error", 5, 10);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(parseError);

      await processor.process("SELECT\n* WHERE { ?s ?p ?o", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );

      // Verify the error view was rendered with line/column info
      const container = mockEl.querySelector(".sparql-results-container");
      expect(container).toBeDefined();
    });

    it("should handle invalid PREFIX declarations", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Invalid PREFIX: missing colon")
      );

      await processor.process(
        "PREFIX exo <http://example.org/>\nSELECT * WHERE { ?s ?p ?o }",
        mockEl,
        mockContext
      );

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });
  });

  describe("Triple Store Initialization Errors", () => {
    it("should handle triple store initialization failure", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(
        new Error("Failed to initialize triple store")
      );

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle vault adapter creation failure", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(
        new Error("Vault not available")
      );

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle RDF conversion failure", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(
        new Error("Failed to convert vault to RDF: Invalid frontmatter format")
      );

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle out of memory during triple store loading", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(
        new Error("JavaScript heap out of memory")
      );

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });
  });

  describe("Query Execution Errors", () => {
    it("should handle triple store not initialized error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).tripleStore = null;

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle unsupported operation type error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Cannot execute operation type: unsupported")
      );

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("Cannot execute operation type:"),
        5000
      );
    });

    it("should handle CONSTRUCT query execution error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("CONSTRUCT template invalid")
      );

      await processor.process(
        "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
        mockEl,
        mockContext
      );

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle timeout during query execution", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Query execution timeout after 30000ms")
      );

      await processor.process(
        "SELECT * WHERE { ?s ?p ?o . ?o ?p2 ?o2 }",
        mockEl,
        mockContext
      );

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("Query execution timeout"),
        5000
      );
    });
  });

  describe("Non-Error Throwable Handling", () => {
    it("should handle string thrown as error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(
        "String error thrown"
      );

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("String error thrown"),
        5000
      );
    });

    it("should handle number thrown as error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(500);

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("500"),
        5000
      );
    });

    it("should handle object thrown as error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue({
        code: "ERR_CUSTOM",
        message: "Custom error object",
      });

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle null thrown as error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(null);

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });

    it("should handle undefined thrown as error", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(undefined);

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });
  });

  describe("Refresh Query Error Handling", () => {
    it("should handle refresh error gracefully", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      const error = new Error("Refresh failed: vault unavailable");
      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(error);
      (processor as any).renderError = jest.fn();

      await (processor as any).refreshQuery(el, container, source);

      expect((processor as any).renderError).toHaveBeenCalledWith(error, container, source);
    });

    it("should handle refresh error during query execution", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).showRefreshIndicator = jest.fn();
      (processor as any).executeQuery = jest.fn().mockRejectedValue(
        new Error("Query execution failed during refresh")
      );
      (processor as any).renderError = jest.fn();

      await (processor as any).refreshQuery(el, container, source);

      expect((processor as any).renderError).toHaveBeenCalledWith(
        expect.any(Error),
        container,
        source
      );
    });

    it("should handle non-Error during refresh", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

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

  describe("Concurrent Loading Error Handling", () => {
    it("should handle error while waiting for another load", async () => {
      // Simulate isLoading state
      (processor as any).isLoading = true;
      (processor as any).tripleStore = null;

      // Create a promise that will resolve after initial wait
      let resolveLoad: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      // Start the process
      const processPromise = processor.process(
        "SELECT * WHERE { ?s ?p ?o }",
        mockEl,
        mockContext
      );

      // Simulate load completing with error
      setTimeout(() => {
        (processor as any).isLoading = false;
        // Triple store is still null, so executeQuery will fail
        resolveLoad!();
      }, 150);

      await processPromise;

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("SPARQL query error:"),
        5000
      );
    });
  });

  describe("DOM and Rendering Error Handling", () => {
    it("should handle container modification during rendering", async () => {
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).executeQuery = jest.fn().mockResolvedValue([]);

      // Make renderResults throw an error
      (processor as any).renderResults = jest.fn().mockImplementation(() => {
        throw new Error("React rendering failed");
      });

      await processor.process("SELECT * WHERE { ?s ?p ?o }", mockEl, mockContext);

      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining("React rendering failed"),
        5000
      );
    });
  });

  describe("Cleanup Error Handling", () => {
    it("should handle cleanup when activeQueries is empty", () => {
      expect(() => processor.cleanup()).not.toThrow();
      expect(processor.getActiveQueryCount()).toBe(0);
    });

    it("should clear all queries during cleanup when no eventRef errors", () => {
      const el1 = document.createElement("div");
      const el2 = document.createElement("div");

      (processor as any).activeQueries.set(el1, {
        source: "query1",
        lastResults: [],
        refreshTimeout: setTimeout(() => {}, 1000),
        eventRef: {},
      });

      (processor as any).activeQueries.set(el2, {
        source: "query2",
        lastResults: [],
      });

      // Mock offref to work normally
      (mockPlugin.app.metadataCache.offref as jest.Mock).mockImplementation(() => {
        // No-op - successful offref
      });

      // Cleanup should clear all queries
      processor.cleanup();

      expect(processor.getActiveQueryCount()).toBe(0);
    });

    it("should clear timeouts during cleanup", () => {
      const el = document.createElement("div");
      const timeout = setTimeout(() => {}, 10000);

      (processor as any).activeQueries.set(el, {
        source: "query",
        lastResults: [],
        refreshTimeout: timeout,
      });

      processor.cleanup();

      expect(processor.getActiveQueryCount()).toBe(0);
    });
  });
});
