/**
 * Tests for the Graph Event Store
 */

import {
  useGraphEventStore,
  getDefaultState,
  clearAllHandlers,
  getHandlerCount,
} from "../../../../../src/presentation/stores/graphEventStore/store";
import type { GraphEvent, GraphEventType } from "../../../../../src/presentation/stores/graphEventStore/types";

describe("GraphEventStore", () => {
  beforeEach(() => {
    // Reset store state and handlers before each test
    useGraphEventStore.getState().reset();
    clearAllHandlers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("getDefaultState", () => {
    it("should return default state with empty arrays", () => {
      const state = getDefaultState();
      expect(state.eventHistory).toEqual([]);
      expect(state.pendingBatch).toEqual([]);
      expect(state.maxHistorySize).toBe(100);
      expect(state.historyEnabled).toBe(false);
      expect(state.debugMode).toBe(false);
      expect(state.isBatching).toBe(false);
    });
  });

  describe("emit", () => {
    it("should emit an event to registered handlers", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", handler);
      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "node:add",
          node: expect.objectContaining({ id: "test-node" }),
        })
      );
    });

    it("should add id, timestamp, and source to emitted events", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", handler);
      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      const emittedEvent = handler.mock.calls[0][0];
      expect(emittedEvent.id).toBeDefined();
      expect(typeof emittedEvent.id).toBe("string");
      expect(emittedEvent.timestamp).toBeDefined();
      expect(typeof emittedEvent.timestamp).toBe("number");
      expect(emittedEvent.source).toBe("store");
    });

    it("should use provided source when specified", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", handler);
      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
        source: "user",
      });

      const emittedEvent = handler.mock.calls[0][0];
      expect(emittedEvent.source).toBe("user");
    });

    it("should call multiple handlers for the same event type", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:click", handler1);
      store.on("node:click", handler2);
      store.emit({
        type: "node:click",
        nodeId: "test-node",
        position: { x: 100, y: 200 },
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should not call handlers for different event types", () => {
      const nodeAddHandler = jest.fn();
      const nodeRemoveHandler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", nodeAddHandler);
      store.on("node:remove", nodeRemoveHandler);
      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      expect(nodeAddHandler).toHaveBeenCalledTimes(1);
      expect(nodeRemoveHandler).toHaveBeenCalledTimes(0);
    });
  });

  describe("on / off", () => {
    it("should subscribe to events", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      const subscription = store.on("node:hover", handler);
      expect(subscription.isActive()).toBe(true);
      expect(getHandlerCount("node:hover")).toBe(1);
    });

    it("should unsubscribe from events", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      const subscription = store.on("node:hover", handler);
      subscription.unsubscribe();

      expect(subscription.isActive()).toBe(false);
      expect(getHandlerCount("node:hover")).toBe(0);
    });

    it("should not call handler after unsubscribe", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      const subscription = store.on("node:hover", handler);
      subscription.unsubscribe();

      store.emit({ type: "node:hover", nodeId: "test-node" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should remove handler via off method", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:hover", handler);
      store.off("node:hover", handler);

      store.emit({ type: "node:hover", nodeId: "test-node" });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("onAny", () => {
    it("should receive all events", () => {
      const wildcardHandler = jest.fn();
      const store = useGraphEventStore.getState();

      store.onAny(wildcardHandler);

      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });
      store.emit({ type: "node:remove", nodeId: "test-node" });
      store.emit({ type: "viewport:zoom", zoom: 1.5 });

      expect(wildcardHandler).toHaveBeenCalledTimes(3);
    });

    it("should unsubscribe from wildcard handler", () => {
      const wildcardHandler = jest.fn();
      const store = useGraphEventStore.getState();

      const subscription = store.onAny(wildcardHandler);
      subscription.unsubscribe();

      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      expect(wildcardHandler).not.toHaveBeenCalled();
    });
  });

  describe("subscription options", () => {
    it("should filter by source", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", handler, { sources: ["user"] });

      // This should NOT call the handler (source is "store")
      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });
      expect(handler).not.toHaveBeenCalled();

      // This SHOULD call the handler (source is "user")
      store.emit({
        type: "node:add",
        node: { id: "test-node-2", label: "Test 2", path: "/test2.md", isArchived: false, title: "Test 2" },
        source: "user",
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should apply custom filter predicate", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:click", handler, {
        filter: (event) => {
          if (event.type === "node:click") {
            return event.modifiers.shift === true;
          }
          return false;
        },
      });

      // Without shift - should NOT call
      store.emit({
        type: "node:click",
        nodeId: "test-node",
        position: { x: 100, y: 200 },
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      });
      expect(handler).not.toHaveBeenCalled();

      // With shift - should call
      store.emit({
        type: "node:click",
        nodeId: "test-node",
        position: { x: 100, y: 200 },
        modifiers: { shift: true, ctrl: false, alt: false, meta: false },
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should respect priority ordering", () => {
      const callOrder: number[] = [];
      const store = useGraphEventStore.getState();

      store.on("node:add", () => callOrder.push(1), { priority: 10 });
      store.on("node:add", () => callOrder.push(2), { priority: 5 });
      store.on("node:add", () => callOrder.push(3), { priority: 20 });

      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      // Higher priority should be called first
      expect(callOrder).toEqual([3, 1, 2]);
    });

    it("should throttle handler calls", async () => {
      jest.useFakeTimers();
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:hover", handler, { throttle: 100 });

      // First call should go through
      store.emit({ type: "node:hover", nodeId: "node-1" });
      expect(handler).toHaveBeenCalledTimes(1);

      // Immediate second call should be throttled
      store.emit({ type: "node:hover", nodeId: "node-2" });
      expect(handler).toHaveBeenCalledTimes(1);

      // After throttle period, should work again
      jest.advanceTimersByTime(150);
      store.emit({ type: "node:hover", nodeId: "node-3" });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should debounce handler calls", async () => {
      jest.useFakeTimers();
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("viewport:pan", handler, { debounce: 100 });

      // Multiple rapid calls
      store.emit({ type: "viewport:pan", offset: { x: 10, y: 10 } });
      store.emit({ type: "viewport:pan", offset: { x: 20, y: 20 } });
      store.emit({ type: "viewport:pan", offset: { x: 30, y: 30 } });

      expect(handler).not.toHaveBeenCalled();

      // After debounce period
      jest.advanceTimersByTime(150);

      expect(handler).toHaveBeenCalledTimes(1);
      // Should be called with the last event
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: { x: 30, y: 30 },
        })
      );
    });
  });

  describe("batching", () => {
    it("should collect events when batching", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", handler);
      store.startBatch();

      store.emit({
        type: "node:add",
        node: { id: "node-1", label: "Node 1", path: "/node1.md", isArchived: false, title: "Node 1" },
      });
      store.emit({
        type: "node:add",
        node: { id: "node-2", label: "Node 2", path: "/node2.md", isArchived: false, title: "Node 2" },
      });

      // Handler should not be called during batching
      expect(handler).not.toHaveBeenCalled();

      store.endBatch();

      // Now handlers should be called
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should emit data:batch event on endBatch", () => {
      const batchHandler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("data:batch", batchHandler);
      store.startBatch();

      store.emit({
        type: "node:add",
        node: { id: "node-1", label: "Node 1", path: "/node1.md", isArchived: false, title: "Node 1" },
      });
      store.emit({ type: "node:remove", nodeId: "node-2" });

      store.endBatch();

      expect(batchHandler).toHaveBeenCalledTimes(1);
      expect(batchHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "data:batch",
          operations: expect.arrayContaining([
            expect.objectContaining({ type: "add", entity: "node" }),
            expect.objectContaining({ type: "remove", entity: "node" }),
          ]),
        })
      );
    });
  });

  describe("history", () => {
    it("should not record history by default", () => {
      const store = useGraphEventStore.getState();

      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      expect(store.eventHistory).toHaveLength(0);
    });

    it("should record history when enabled", () => {
      useGraphEventStore.getState().setHistoryEnabled(true);
      useGraphEventStore.getState().emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      const state = useGraphEventStore.getState();
      expect(state.eventHistory).toHaveLength(1);
      expect(state.eventHistory[0].type).toBe("node:add");
    });

    it("should limit history size", () => {
      useGraphEventStore.getState().setHistoryEnabled(true);

      // Emit more events than max history size
      for (let i = 0; i < 150; i++) {
        useGraphEventStore.getState().emit({ type: "node:hover", nodeId: `node-${i}` });
      }

      expect(useGraphEventStore.getState().eventHistory.length).toBeLessThanOrEqual(100);
    });

    it("should get recent events of specific type", () => {
      useGraphEventStore.getState().setHistoryEnabled(true);
      useGraphEventStore.getState().emit({
        type: "node:add",
        node: { id: "node-1", label: "Node 1", path: "/node1.md", isArchived: false, title: "Node 1" },
      });
      useGraphEventStore.getState().emit({ type: "node:hover", nodeId: "node-1" });
      useGraphEventStore.getState().emit({
        type: "node:add",
        node: { id: "node-2", label: "Node 2", path: "/node2.md", isArchived: false, title: "Node 2" },
      });

      const recentAdds = useGraphEventStore.getState().getRecentEvents("node:add", 10);
      expect(recentAdds).toHaveLength(2);
      expect(recentAdds.every((e) => e.type === "node:add")).toBe(true);
    });

    it("should clear history", () => {
      useGraphEventStore.getState().setHistoryEnabled(true);
      useGraphEventStore.getState().emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      expect(useGraphEventStore.getState().eventHistory).toHaveLength(1);

      useGraphEventStore.getState().clearHistory();
      expect(useGraphEventStore.getState().eventHistory).toHaveLength(0);
    });
  });

  describe("debug mode", () => {
    it("should toggle debug mode", () => {
      expect(useGraphEventStore.getState().debugMode).toBe(false);
      useGraphEventStore.getState().setDebugMode(true);
      expect(useGraphEventStore.getState().debugMode).toBe(true);
      useGraphEventStore.getState().setDebugMode(false);
      expect(useGraphEventStore.getState().debugMode).toBe(false);
    });

    it("should log events in debug mode", () => {
      const consoleSpy = jest.spyOn(console, "debug").mockImplementation(() => {});

      useGraphEventStore.getState().setDebugMode(true);
      useGraphEventStore.getState().emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[GraphEvent]",
        "node:add",
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("emitAsync", () => {
    it("should emit events asynchronously", async () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", handler);
      await store.emitAsync({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should wait for async handlers", async () => {
      const results: number[] = [];
      const store = useGraphEventStore.getState();

      store.on("node:add", async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(1);
      });
      store.on("node:add", async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(2);
      });

      await store.emitAsync({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      // Handlers should have completed in order (priority-based, then first-registered)
      expect(results).toEqual([1, 2]);
    });
  });

  describe("reset", () => {
    it("should reset state and clear handlers", () => {
      const handler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("node:add", handler);
      store.setDebugMode(true);
      store.setHistoryEnabled(true);

      store.reset();

      expect(store.debugMode).toBe(false);
      expect(store.historyEnabled).toBe(false);
      expect(getHandlerCount("node:add")).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should catch errors in handlers and continue", () => {
      const errorHandler = jest.fn(() => {
        throw new Error("Handler error");
      });
      const normalHandler = jest.fn();
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const store = useGraphEventStore.getState();

      store.on("node:add", errorHandler);
      store.on("node:add", normalHandler);

      store.emit({
        type: "node:add",
        node: { id: "test-node", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
      });

      // Error handler threw but normal handler should still be called
      expect(normalHandler).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("event types coverage", () => {
    it("should handle all node event types", () => {
      const handlers: Record<string, ReturnType<typeof jest.fn>> = {};
      const store = useGraphEventStore.getState();
      const nodeEventTypes: GraphEventType[] = [
        "node:add",
        "node:update",
        "node:remove",
        "node:position",
        "node:select",
        "node:hover",
        "node:click",
        "node:dblclick",
        "node:contextmenu",
        "node:dragstart",
        "node:drag",
        "node:dragend",
      ];

      for (const type of nodeEventTypes) {
        handlers[type] = jest.fn();
        store.on(type, handlers[type]);
      }

      const testNode = { id: "test", label: "Test", path: "/test.md", isArchived: false, title: "Test" };
      const testPosition = { x: 0, y: 0 };
      const testModifiers = { shift: false, ctrl: false, alt: false, meta: false };

      store.emit({ type: "node:add", node: testNode });
      store.emit({ type: "node:update", nodeId: "test", changes: { label: "Updated" } });
      store.emit({ type: "node:remove", nodeId: "test" });
      store.emit({ type: "node:position", nodeId: "test", position: testPosition });
      store.emit({ type: "node:select", nodeId: "test", selected: true });
      store.emit({ type: "node:hover", nodeId: "test" });
      store.emit({ type: "node:click", nodeId: "test", position: testPosition, modifiers: testModifiers });
      store.emit({ type: "node:dblclick", nodeId: "test", position: testPosition, modifiers: testModifiers });
      store.emit({ type: "node:contextmenu", nodeId: "test", position: testPosition });
      store.emit({ type: "node:dragstart", nodeId: "test", position: testPosition });
      store.emit({ type: "node:drag", nodeId: "test", position: testPosition });
      store.emit({ type: "node:dragend", nodeId: "test", position: testPosition });

      for (const type of nodeEventTypes) {
        expect(handlers[type]).toHaveBeenCalledTimes(1);
      }
    });

    it("should handle all edge event types", () => {
      const handlers: Record<string, ReturnType<typeof jest.fn>> = {};
      const store = useGraphEventStore.getState();
      const edgeEventTypes: GraphEventType[] = [
        "edge:add",
        "edge:update",
        "edge:remove",
        "edge:select",
        "edge:hover",
        "edge:click",
      ];

      for (const type of edgeEventTypes) {
        handlers[type] = jest.fn();
        store.on(type, handlers[type]);
      }

      const testEdge = { source: "a", target: "b", type: "forward-link" as const };
      const testPosition = { x: 0, y: 0 };
      const testModifiers = { shift: false, ctrl: false, alt: false, meta: false };

      store.emit({ type: "edge:add", edge: testEdge });
      store.emit({ type: "edge:update", edgeId: "edge-1", changes: { label: "Updated" } });
      store.emit({ type: "edge:remove", edgeId: "edge-1" });
      store.emit({ type: "edge:select", edgeId: "edge-1", selected: true });
      store.emit({ type: "edge:hover", edgeId: "edge-1" });
      store.emit({ type: "edge:click", edgeId: "edge-1", position: testPosition, modifiers: testModifiers });

      for (const type of edgeEventTypes) {
        expect(handlers[type]).toHaveBeenCalledTimes(1);
      }
    });

    it("should handle all viewport event types", () => {
      const handlers: Record<string, ReturnType<typeof jest.fn>> = {};
      const store = useGraphEventStore.getState();
      const viewportEventTypes: GraphEventType[] = [
        "viewport:pan",
        "viewport:zoom",
        "viewport:resize",
        "viewport:fit",
      ];

      for (const type of viewportEventTypes) {
        handlers[type] = jest.fn();
        store.on(type, handlers[type]);
      }

      store.emit({ type: "viewport:pan", offset: { x: 10, y: 20 } });
      store.emit({ type: "viewport:zoom", zoom: 1.5 });
      store.emit({ type: "viewport:resize", width: 800, height: 600 });
      store.emit({ type: "viewport:fit" });

      for (const type of viewportEventTypes) {
        expect(handlers[type]).toHaveBeenCalledTimes(1);
      }
    });

    it("should handle all layout event types", () => {
      const handlers: Record<string, ReturnType<typeof jest.fn>> = {};
      const store = useGraphEventStore.getState();
      const layoutEventTypes: GraphEventType[] = [
        "layout:start",
        "layout:tick",
        "layout:end",
        "layout:change",
      ];

      for (const type of layoutEventTypes) {
        handlers[type] = jest.fn();
        store.on(type, handlers[type]);
      }

      store.emit({ type: "layout:start", algorithm: "force" });
      store.emit({ type: "layout:tick", alpha: 0.5, progress: 50 });
      store.emit({ type: "layout:end", algorithm: "force" });
      store.emit({ type: "layout:change", algorithm: "hierarchical" });

      for (const type of layoutEventTypes) {
        expect(handlers[type]).toHaveBeenCalledTimes(1);
      }
    });

    it("should handle all selection event types", () => {
      const handlers: Record<string, ReturnType<typeof jest.fn>> = {};
      const store = useGraphEventStore.getState();
      const selectionEventTypes: GraphEventType[] = [
        "selection:change",
        "selection:clear",
        "selection:boxstart",
        "selection:boxupdate",
        "selection:boxend",
      ];

      for (const type of selectionEventTypes) {
        handlers[type] = jest.fn();
        store.on(type, handlers[type]);
      }

      store.emit({ type: "selection:change", nodeIds: ["node-1"], edgeIds: [] });
      store.emit({ type: "selection:clear" });
      store.emit({ type: "selection:boxstart", startPosition: { x: 0, y: 0 } });
      store.emit({
        type: "selection:boxupdate",
        startPosition: { x: 0, y: 0 },
        currentPosition: { x: 100, y: 100 },
        enclosedNodeIds: ["node-1"],
      });
      store.emit({ type: "selection:boxend", selectedNodeIds: ["node-1"], additive: false });

      for (const type of selectionEventTypes) {
        expect(handlers[type]).toHaveBeenCalledTimes(1);
      }
    });

    it("should handle all data event types", () => {
      const handlers: Record<string, ReturnType<typeof jest.fn>> = {};
      const store = useGraphEventStore.getState();
      const dataEventTypes: GraphEventType[] = [
        "data:loadstart",
        "data:loadend",
        "data:loaderror",
        "data:sync",
        "data:batch",
      ];

      for (const type of dataEventTypes) {
        handlers[type] = jest.fn();
        store.on(type, handlers[type]);
      }

      store.emit({ type: "data:loadstart" });
      store.emit({ type: "data:loadend", nodeCount: 10, edgeCount: 5 });
      store.emit({ type: "data:loaderror", error: "Test error" });
      store.emit({
        type: "data:sync",
        addedNodes: [],
        removedNodeIds: [],
        updatedNodes: [],
        addedEdges: [],
        removedEdgeIds: [],
        updatedEdges: [],
      });
      store.emit({ type: "data:batch", operations: [] });

      for (const type of dataEventTypes) {
        expect(handlers[type]).toHaveBeenCalledTimes(1);
      }
    });

    it("should handle filter and error event types", () => {
      const filterHandler = jest.fn();
      const filterResetHandler = jest.fn();
      const errorHandler = jest.fn();
      const store = useGraphEventStore.getState();

      store.on("filter:change", filterHandler);
      store.on("filter:reset", filterResetHandler);
      store.on("error", errorHandler);

      store.emit({ type: "filter:change", filterType: "search", value: "test" });
      store.emit({ type: "filter:reset" });
      store.emit({ type: "error", error: "Test error", recoverable: true });

      expect(filterHandler).toHaveBeenCalledTimes(1);
      expect(filterResetHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
    });
  });
});
