/**
 * Tests for the Graph Event Store Hooks
 */

import { renderHook, act } from "@testing-library/react";
import {
  useGraphEvent,
  useGraphEvents,
  useAllGraphEvents,
  useEmitGraphEvent,
  useGraphEventEmitters,
  useEventHistory,
  useEventDebugMode,
  useEventHistoryEnabled,
  useEventBatch,
  useNodeClick,
  useNodeHover,
  useSelectionChange,
} from "../../../../../src/presentation/stores/graphEventStore/hooks";
import {
  useGraphEventStore,
  clearAllHandlers,
} from "../../../../../src/presentation/stores/graphEventStore/store";

describe("GraphEventStore Hooks", () => {
  beforeEach(() => {
    // Reset store state and handlers before each test
    useGraphEventStore.getState().reset();
    clearAllHandlers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("useGraphEvent", () => {
    it("should subscribe to specific event type", () => {
      const handler = jest.fn();
      renderHook(() => useGraphEvent("node:click", handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:click",
          nodeId: "test-node",
          position: { x: 100, y: 200 },
          modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        });
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should unsubscribe on unmount", () => {
      const handler = jest.fn();
      const { unmount } = renderHook(() => useGraphEvent("node:click", handler));

      unmount();

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:click",
          nodeId: "test-node",
          position: { x: 100, y: 200 },
          modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        });
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("useGraphEvents", () => {
    it("should subscribe to multiple event types", () => {
      const handler = jest.fn();
      renderHook(() => useGraphEvents(["node:click", "node:dblclick"], handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:click",
          nodeId: "test-node",
          position: { x: 100, y: 200 },
          modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        });
        useGraphEventStore.getState().emit({
          type: "node:dblclick",
          nodeId: "test-node",
          position: { x: 100, y: 200 },
          modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        });
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("useAllGraphEvents", () => {
    it("should receive all events", () => {
      const handler = jest.fn();
      renderHook(() => useAllGraphEvents(handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:add",
          node: { id: "test", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
        });
        useGraphEventStore.getState().emit({ type: "viewport:zoom", zoom: 1.5 });
        useGraphEventStore.getState().emit({ type: "layout:start", algorithm: "force" });
      });

      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe("useEmitGraphEvent", () => {
    it("should return emit function", () => {
      const handler = jest.fn();
      const { result: emitResult } = renderHook(() => useEmitGraphEvent());

      renderHook(() => useGraphEvent("node:hover", handler));

      act(() => {
        emitResult.current({ type: "node:hover", nodeId: "test-node" });
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("useGraphEventEmitters", () => {
    it("should return memoized emitter functions", () => {
      const handler = jest.fn();
      const { result } = renderHook(() => useGraphEventEmitters());

      renderHook(() => useGraphEvent("node:add", handler));

      act(() => {
        result.current.emitNodeAdd(
          { id: "test", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
          "user"
        );
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "node:add",
          source: "user",
          node: expect.objectContaining({ id: "test" }),
        })
      );
    });

    it("should have all emitter functions", () => {
      const { result } = renderHook(() => useGraphEventEmitters());

      // Node emitters
      expect(typeof result.current.emitNodeAdd).toBe("function");
      expect(typeof result.current.emitNodeUpdate).toBe("function");
      expect(typeof result.current.emitNodeRemove).toBe("function");
      expect(typeof result.current.emitNodePosition).toBe("function");
      expect(typeof result.current.emitNodeSelect).toBe("function");
      expect(typeof result.current.emitNodeHover).toBe("function");
      expect(typeof result.current.emitNodeClick).toBe("function");
      expect(typeof result.current.emitNodeDoubleClick).toBe("function");
      expect(typeof result.current.emitNodeContextMenu).toBe("function");
      expect(typeof result.current.emitNodeDragStart).toBe("function");
      expect(typeof result.current.emitNodeDrag).toBe("function");
      expect(typeof result.current.emitNodeDragEnd).toBe("function");

      // Edge emitters
      expect(typeof result.current.emitEdgeAdd).toBe("function");
      expect(typeof result.current.emitEdgeUpdate).toBe("function");
      expect(typeof result.current.emitEdgeRemove).toBe("function");
      expect(typeof result.current.emitEdgeSelect).toBe("function");
      expect(typeof result.current.emitEdgeHover).toBe("function");
      expect(typeof result.current.emitEdgeClick).toBe("function");

      // Viewport emitters
      expect(typeof result.current.emitViewportPan).toBe("function");
      expect(typeof result.current.emitViewportZoom).toBe("function");
      expect(typeof result.current.emitViewportResize).toBe("function");
      expect(typeof result.current.emitViewportFit).toBe("function");

      // Layout emitters
      expect(typeof result.current.emitLayoutStart).toBe("function");
      expect(typeof result.current.emitLayoutTick).toBe("function");
      expect(typeof result.current.emitLayoutEnd).toBe("function");
      expect(typeof result.current.emitLayoutChange).toBe("function");

      // Selection emitters
      expect(typeof result.current.emitSelectionChange).toBe("function");
      expect(typeof result.current.emitSelectionClear).toBe("function");

      // Data emitters
      expect(typeof result.current.emitDataLoadStart).toBe("function");
      expect(typeof result.current.emitDataLoadEnd).toBe("function");
      expect(typeof result.current.emitDataLoadError).toBe("function");

      // Error emitter
      expect(typeof result.current.emitError).toBe("function");
    });
  });

  describe("useNodeClick", () => {
    it("should call handler with node click details", () => {
      const handler = jest.fn();
      renderHook(() => useNodeClick(handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:click",
          nodeId: "test-node",
          position: { x: 100, y: 200 },
          modifiers: { shift: true, ctrl: false, alt: false, meta: false },
        });
      });

      expect(handler).toHaveBeenCalledWith(
        "test-node",
        { x: 100, y: 200 },
        { shift: true, ctrl: false, alt: false, meta: false }
      );
    });
  });

  describe("useNodeHover", () => {
    it("should call handler with node id", () => {
      const handler = jest.fn();
      renderHook(() => useNodeHover(handler));

      act(() => {
        useGraphEventStore.getState().emit({ type: "node:hover", nodeId: "test-node" });
      });

      expect(handler).toHaveBeenCalledWith("test-node");
    });

    it("should call handler with null when unhovered", () => {
      const handler = jest.fn();
      renderHook(() => useNodeHover(handler));

      act(() => {
        useGraphEventStore.getState().emit({ type: "node:hover", nodeId: null });
      });

      expect(handler).toHaveBeenCalledWith(null);
    });
  });

  describe("useSelectionChange", () => {
    it("should call handler with selection arrays", () => {
      const handler = jest.fn();
      renderHook(() => useSelectionChange(handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "selection:change",
          nodeIds: ["node-1", "node-2"],
          edgeIds: ["edge-1"],
        });
      });

      expect(handler).toHaveBeenCalledWith(["node-1", "node-2"], ["edge-1"]);
    });
  });

  describe("useEventHistory", () => {
    it("should return event history", () => {
      // Enable history
      act(() => {
        useGraphEventStore.getState().setHistoryEnabled(true);
      });

      const { result } = renderHook(() => useEventHistory());

      // Initially empty
      expect(result.current).toEqual([]);

      // Emit an event
      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:add",
          node: { id: "test", label: "Test", path: "/test.md", isArchived: false, title: "Test" },
        });
      });

      // Re-render to get updated history
      const { result: updatedResult } = renderHook(() => useEventHistory());
      expect(updatedResult.current).toHaveLength(1);
    });
  });

  describe("useEventDebugMode", () => {
    it("should return debug mode state and setter", () => {
      const { result } = renderHook(() => useEventDebugMode());

      expect(result.current[0]).toBe(false);

      act(() => {
        result.current[1](true);
      });

      const { result: updatedResult } = renderHook(() => useEventDebugMode());
      expect(updatedResult.current[0]).toBe(true);
    });
  });

  describe("useEventHistoryEnabled", () => {
    it("should return history enabled state and setter", () => {
      const { result } = renderHook(() => useEventHistoryEnabled());

      expect(result.current[0]).toBe(false);

      act(() => {
        result.current[1](true);
      });

      const { result: updatedResult } = renderHook(() => useEventHistoryEnabled());
      expect(updatedResult.current[0]).toBe(true);
    });
  });

  describe("useEventBatch", () => {
    it("should provide batch functions", () => {
      const { result } = renderHook(() => useEventBatch());

      expect(typeof result.current.startBatch).toBe("function");
      expect(typeof result.current.endBatch).toBe("function");
      expect(typeof result.current.batch).toBe("function");
      expect(result.current.isBatching).toBe(false);
    });

    it("should batch events with batch helper", () => {
      const handler = jest.fn();
      renderHook(() => useGraphEvent("node:add", handler));

      const { result } = renderHook(() => useEventBatch());
      const { result: emitResult } = renderHook(() => useEmitGraphEvent());

      act(() => {
        result.current.batch(() => {
          emitResult.current({
            type: "node:add",
            node: { id: "node-1", label: "Node 1", path: "/node1.md", isArchived: false, title: "Node 1" },
          });
          emitResult.current({
            type: "node:add",
            node: { id: "node-2", label: "Node 2", path: "/node2.md", isArchived: false, title: "Node 2" },
          });
        });
      });

      // All events should have been emitted after batch ends
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
