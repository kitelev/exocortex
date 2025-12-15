import type { MarkdownPostProcessorContext, App, Vault, MetadataCache, EventRef, TFile } from "obsidian";
import { SPARQLCodeBlockProcessor } from "../../../../src/application/processors/SPARQLCodeBlockProcessor";
import type ExocortexPlugin from "../../../../src/ExocortexPlugin";

describe("SPARQLCodeBlockProcessor", () => {
  let processor: SPARQLCodeBlockProcessor;
  let mockPlugin: ExocortexPlugin;
  let mockContext: MarkdownPostProcessorContext;
  let mockEl: HTMLElement;

  beforeEach(() => {
    mockPlugin = {
      app: {
        vault: {} as Vault,
        metadataCache: {} as MetadataCache,
      } as App,
    } as ExocortexPlugin;

    mockContext = {
      addChild: jest.fn(),
    } as any;

    mockEl = document.createElement("div");

    processor = new SPARQLCodeBlockProcessor(mockPlugin);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be instantiable", () => {
    expect(processor).toBeDefined();
    expect(processor).toBeInstanceOf(SPARQLCodeBlockProcessor);
  });

  it("should have a process method", () => {
    expect(typeof processor.process).toBe("function");
  });

  describe("Live Query Refresh Methods", () => {
    it("should have scheduleRefresh method", () => {
      expect(typeof (processor as any).scheduleRefresh).toBe("function");
    });

    it("should have refreshQuery method", () => {
      expect(typeof (processor as any).refreshQuery).toBe("function");
    });

    it("should have invalidateTripleStore method", () => {
      expect(typeof (processor as any).invalidateTripleStore).toBe("function");
    });

    it("should have areResultsEqual method", () => {
      expect(typeof (processor as any).areResultsEqual).toBe("function");
    });

    it("should have showRefreshIndicator method", () => {
      expect(typeof (processor as any).showRefreshIndicator).toBe("function");
    });

    it("should have hideRefreshIndicator method", () => {
      expect(typeof (processor as any).hideRefreshIndicator).toBe("function");
    });
  });

  describe("Result Comparison", () => {
    it("should compare results correctly for equality", () => {
      // Mock SolutionMapping objects
      const createMockSolutionMapping = (bindings: Map<string, any>) => ({
        getBindings: () => bindings,
      });

      const result1 = [
        createMockSolutionMapping(new Map([
          ["var1", { toString: () => "value1" }],
          ["var2", { toString: () => "value2" }],
        ])),
      ];

      const result2 = [
        createMockSolutionMapping(new Map([
          ["var1", { toString: () => "value1" }],
          ["var2", { toString: () => "value2" }],
        ])),
      ];

      const result3 = [
        createMockSolutionMapping(new Map([
          ["var1", { toString: () => "value1" }],
          ["var2", { toString: () => "different" }],
        ])),
      ];

      const areEqual = (processor as any).areResultsEqual;

      expect(areEqual.call(processor, result1, result2)).toBe(true);
      expect(areEqual.call(processor, result1, result3)).toBe(false);
      expect(areEqual.call(processor, [], [])).toBe(true);
      expect(areEqual.call(processor, result1, [])).toBe(false);
    });
  });

  describe("Refresh Indicator", () => {
    it("should show refresh indicator", () => {
      const container = document.createElement("div");
      container.className = "sparql-results-container";

      (processor as any).showRefreshIndicator(container);

      const indicator = container.querySelector(".sparql-refresh-indicator");
      expect(indicator).toBeTruthy();
      expect(indicator?.textContent).toContain("Refreshing...");
    });

    it("should hide refresh indicator", () => {
      const container = document.createElement("div");
      container.className = "sparql-results-container";

      const indicator = document.createElement("div");
      indicator.className = "sparql-refresh-indicator";
      container.appendChild(indicator);

      (processor as any).hideRefreshIndicator(container);

      expect(container.querySelector(".sparql-refresh-indicator")).toBeFalsy();
    });

    it("should not duplicate refresh indicators", () => {
      const container = document.createElement("div");
      container.className = "sparql-results-container";

      (processor as any).showRefreshIndicator(container);
      (processor as any).showRefreshIndicator(container);

      const indicators = container.querySelectorAll(".sparql-refresh-indicator");
      expect(indicators.length).toBe(1);
    });
  });

  describe("Triple Store Invalidation", () => {
    it("should invalidate triple store", () => {
      (processor as any).tripleStore = {};

      (processor as any).invalidateTripleStore();

      expect((processor as any).tripleStore).toBeNull();
    });
  });

  describe("Refresh Query Method", () => {
    it("should handle refresh when no active query exists", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");

      await (processor as any).refreshQuery(el, container, "SELECT * WHERE { ?s ?p ?o }");

      // Should exit early when no active query
      expect(container.innerHTML).toBe("");
    });

    it("should handle refresh with active query but same results", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      // Mock methods
      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).showRefreshIndicator = jest.fn();
      (processor as any).hideRefreshIndicator = jest.fn();
      (processor as any).executeQuery = jest.fn().mockResolvedValue([]);
      (processor as any).areResultsEqual = jest.fn().mockReturnValue(true);

      await (processor as any).refreshQuery(el, container, source);

      expect((processor as any).invalidateTripleStore).toHaveBeenCalled();
      expect((processor as any).ensureTripleStoreLoaded).toHaveBeenCalled();
      expect((processor as any).showRefreshIndicator).toHaveBeenCalledWith(container);
      expect((processor as any).hideRefreshIndicator).toHaveBeenCalledWith(container);
      expect((processor as any).executeQuery).toHaveBeenCalledWith(source);
    });

    it("should handle refresh with different results", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      const newResults = [
        {
          getBindings: () => new Map([["var1", { toString: () => "value1" }]]),
        },
      ];

      // Mock methods
      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).showRefreshIndicator = jest.fn();
      (processor as any).executeQuery = jest.fn().mockResolvedValue(newResults);
      (processor as any).areResultsEqual = jest.fn().mockReturnValue(false);
      (processor as any).renderResults = jest.fn();

      await (processor as any).refreshQuery(el, container, source);

      expect((processor as any).renderResults).toHaveBeenCalledWith(newResults, container, source);
      expect((processor as any).activeQueries.get(el).lastResults).toBe(newResults);
    });

    it("should handle refresh errors", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      const error = new Error("Test error");

      // Mock methods
      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockRejectedValue(error);
      (processor as any).renderError = jest.fn();

      await (processor as any).refreshQuery(el, container, source);

      expect((processor as any).renderError).toHaveBeenCalledWith(error, container, source);
      expect(container.innerHTML).toBe("");
    });
  });

  describe("Schedule Refresh Method", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should schedule refresh with debounce", () => {
      const el = document.createElement("div");
      const container = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      (processor as any).refreshQuery = jest.fn();

      (processor as any).scheduleRefresh(el, container, source);

      // Should not call immediately
      expect((processor as any).refreshQuery).not.toHaveBeenCalled();

      // Fast forward time
      jest.advanceTimersByTime(500);

      // Should call after debounce delay
      expect((processor as any).refreshQuery).toHaveBeenCalledWith(el, container, source);
    });

    it("should cancel previous timeout when called multiple times", () => {
      const el = document.createElement("div");
      const container = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
      });

      (processor as any).refreshQuery = jest.fn();

      // Call multiple times rapidly
      (processor as any).scheduleRefresh(el, container, source);
      jest.advanceTimersByTime(200);
      (processor as any).scheduleRefresh(el, container, source);
      jest.advanceTimersByTime(200);
      (processor as any).scheduleRefresh(el, container, source);

      // Should not have called yet
      expect((processor as any).refreshQuery).not.toHaveBeenCalled();

      // Advance past debounce
      jest.advanceTimersByTime(500);

      // Should call only once
      expect((processor as any).refreshQuery).toHaveBeenCalledTimes(1);
    });

    it("should not schedule if no active query", () => {
      const el = document.createElement("div");
      const container = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      (processor as any).refreshQuery = jest.fn();

      (processor as any).scheduleRefresh(el, container, source);

      jest.advanceTimersByTime(1000);

      // Should not call
      expect((processor as any).refreshQuery).not.toHaveBeenCalled();
    });
  });

  describe("TTL and Stale Query Cleanup", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      processor.cleanup();
    });

    it("should expose query max age constant", () => {
      expect(processor.getQueryMaxAge()).toBe(5 * 60 * 1000); // 5 minutes
    });

    it("should expose cleanup interval constant", () => {
      expect(processor.getCleanupInterval()).toBe(60 * 1000); // 1 minute
    });

    it("should include startTime when setting up active queries", () => {
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up active query with startTime
      const beforeTime = Date.now();
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
        startTime: Date.now(),
      });
      const afterTime = Date.now();

      const query = (processor as any).activeQueries.get(el);
      expect(query.startTime).toBeGreaterThanOrEqual(beforeTime);
      expect(query.startTime).toBeLessThanOrEqual(afterTime);
    });

    it("should clean up stale queries older than max age", () => {
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up an old query (6 minutes ago)
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
        startTime: sixMinutesAgo,
      });

      expect((processor as any).activeQueries.size).toBe(1);

      // Trigger cleanup
      processor.triggerCleanup();

      expect((processor as any).activeQueries.size).toBe(0);
    });

    it("should NOT clean up queries younger than max age", () => {
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up a recent query (1 minute ago)
      const oneMinuteAgo = Date.now() - (1 * 60 * 1000);
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
        startTime: oneMinuteAgo,
      });

      expect((processor as any).activeQueries.size).toBe(1);

      // Trigger cleanup
      processor.triggerCleanup();

      // Should still exist
      expect((processor as any).activeQueries.size).toBe(1);
    });

    it("should clear refresh timeout when cleaning up stale query", () => {
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

      // Set up an old query with a refresh timeout
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      const timeout = setTimeout(() => {}, 1000);
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
        startTime: sixMinutesAgo,
        refreshTimeout: timeout,
      });

      // Trigger cleanup
      processor.triggerCleanup();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);
      clearTimeoutSpy.mockRestore();
    });

    it("should unregister event ref when cleaning up stale query", () => {
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";
      const mockEventRef = { id: "test-event-ref" } as EventRef;
      const offrefMock = jest.fn();

      // Set up mock plugin with offref
      (processor as any).plugin = {
        app: {
          metadataCache: {
            offref: offrefMock,
          },
        },
      };

      // Set up an old query with an event ref
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
        startTime: sixMinutesAgo,
        eventRef: mockEventRef,
      });

      // Trigger cleanup
      processor.triggerCleanup();

      expect(offrefMock).toHaveBeenCalledWith(mockEventRef);
    });

    it("should clean up multiple stale queries at once", () => {
      const el1 = document.createElement("div");
      const el2 = document.createElement("div");
      const el3 = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      const oneMinuteAgo = Date.now() - (1 * 60 * 1000);

      // Two stale queries, one fresh
      (processor as any).activeQueries.set(el1, {
        source,
        lastResults: [],
        startTime: sixMinutesAgo,
      });
      (processor as any).activeQueries.set(el2, {
        source,
        lastResults: [],
        startTime: sixMinutesAgo,
      });
      (processor as any).activeQueries.set(el3, {
        source,
        lastResults: [],
        startTime: oneMinuteAgo,
      });

      expect((processor as any).activeQueries.size).toBe(3);

      // Trigger cleanup
      processor.triggerCleanup();

      // Only fresh query should remain
      expect((processor as any).activeQueries.size).toBe(1);
      expect((processor as any).activeQueries.has(el3)).toBe(true);
    });

    it("should reset startTime on successful refresh", async () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      const source = "SELECT * WHERE { ?s ?p ?o }";

      // Set up query with old startTime
      const fourMinutesAgo = Date.now() - (4 * 60 * 1000);
      (processor as any).activeQueries.set(el, {
        source,
        lastResults: [],
        startTime: fourMinutesAgo,
      });

      // Mock methods for refresh
      (processor as any).invalidateTripleStore = jest.fn();
      (processor as any).ensureTripleStoreLoaded = jest.fn().mockResolvedValue(undefined);
      (processor as any).showRefreshIndicator = jest.fn();
      (processor as any).hideRefreshIndicator = jest.fn();
      (processor as any).executeQuery = jest.fn().mockResolvedValue([]);
      (processor as any).areResultsEqual = jest.fn().mockReturnValue(true);

      const beforeRefresh = Date.now();
      await (processor as any).refreshQuery(el, container, source);
      const afterRefresh = Date.now();

      const query = (processor as any).activeQueries.get(el);
      expect(query.startTime).toBeGreaterThanOrEqual(beforeRefresh);
      expect(query.startTime).toBeLessThanOrEqual(afterRefresh);
    });

    it("should stop cleanup interval on cleanup()", () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      // The constructor starts the interval
      const newProcessor = new SPARQLCodeBlockProcessor(mockPlugin);
      const intervalId = (newProcessor as any).cleanupIntervalId;

      expect(intervalId).not.toBeNull();

      // Call cleanup
      newProcessor.cleanup();

      expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
      expect((newProcessor as any).cleanupIntervalId).toBeNull();

      clearIntervalSpy.mockRestore();
    });

    it("should run periodic cleanup at specified interval", () => {
      const newProcessor = new SPARQLCodeBlockProcessor(mockPlugin);
      const cleanupSpy = jest.spyOn(newProcessor as any, "cleanupStaleQueries");

      // Fast forward by cleanup interval
      jest.advanceTimersByTime(60 * 1000);

      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      // Fast forward another interval
      jest.advanceTimersByTime(60 * 1000);

      expect(cleanupSpy).toHaveBeenCalledTimes(2);

      newProcessor.cleanup();
      cleanupSpy.mockRestore();
    });
  });
});