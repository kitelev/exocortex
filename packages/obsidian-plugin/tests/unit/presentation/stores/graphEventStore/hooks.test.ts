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
  useNodeDoubleClick,
  useNodeHover,
  useNodeSelect,
  useNodeDrag,
  useEdgeClick,
  useEdgeHover,
  useSelectionChange,
  useViewportEvents,
  useLayoutEvents,
  useDataLoadingEvents,
  useGraphError,
  useRecentEvents,
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

  describe("useNodeDoubleClick", () => {
    it("should call handler with node double-click details", () => {
      const handler = jest.fn();
      renderHook(() => useNodeDoubleClick(handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:dblclick",
          nodeId: "test-node",
          position: { x: 50, y: 100 },
          modifiers: { shift: false, ctrl: true, alt: false, meta: false },
        });
      });

      expect(handler).toHaveBeenCalledWith(
        "test-node",
        { x: 50, y: 100 },
        { shift: false, ctrl: true, alt: false, meta: false }
      );
    });
  });

  describe("useNodeSelect", () => {
    it("should call handler with node selection state", () => {
      const handler = jest.fn();
      renderHook(() => useNodeSelect(handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:select",
          nodeId: "test-node",
          selected: true,
        });
      });

      expect(handler).toHaveBeenCalledWith("test-node", true);
    });
  });

  describe("useNodeDrag", () => {
    it("should call drag handlers", () => {
      const onDragStart = jest.fn();
      const onDrag = jest.fn();
      const onDragEnd = jest.fn();
      renderHook(() => useNodeDrag({ onDragStart, onDrag, onDragEnd }));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:dragstart",
          nodeId: "test-node",
          position: { x: 0, y: 0 },
        });
        useGraphEventStore.getState().emit({
          type: "node:drag",
          nodeId: "test-node",
          position: { x: 10, y: 20 },
        });
        useGraphEventStore.getState().emit({
          type: "node:dragend",
          nodeId: "test-node",
          position: { x: 30, y: 40 },
          startPosition: { x: 0, y: 0 },
        });
      });

      expect(onDragStart).toHaveBeenCalledWith("test-node", { x: 0, y: 0 });
      expect(onDrag).toHaveBeenCalledWith("test-node", { x: 10, y: 20 });
      expect(onDragEnd).toHaveBeenCalledWith("test-node", { x: 30, y: 40 }, { x: 0, y: 0 });
    });
  });

  describe("useEdgeClick", () => {
    it("should call handler with edge click details", () => {
      const handler = jest.fn();
      renderHook(() => useEdgeClick(handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "edge:click",
          edgeId: "test-edge",
          position: { x: 100, y: 200 },
          modifiers: { shift: true, ctrl: false, alt: false, meta: false },
        });
      });

      expect(handler).toHaveBeenCalledWith(
        "test-edge",
        { x: 100, y: 200 },
        { shift: true, ctrl: false, alt: false, meta: false }
      );
    });
  });

  describe("useEdgeHover", () => {
    it("should call handler with edge id", () => {
      const handler = jest.fn();
      renderHook(() => useEdgeHover(handler));

      act(() => {
        useGraphEventStore.getState().emit({ type: "edge:hover", edgeId: "test-edge" });
      });

      expect(handler).toHaveBeenCalledWith("test-edge");
    });

    it("should call handler with null when unhovered", () => {
      const handler = jest.fn();
      renderHook(() => useEdgeHover(handler));

      act(() => {
        useGraphEventStore.getState().emit({ type: "edge:hover", edgeId: null });
      });

      expect(handler).toHaveBeenCalledWith(null);
    });
  });

  describe("useViewportEvents", () => {
    it("should call viewport handlers", () => {
      const onPan = jest.fn();
      const onZoom = jest.fn();
      const onResize = jest.fn();
      const onFit = jest.fn();
      renderHook(() => useViewportEvents({ onPan, onZoom, onResize, onFit }));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "viewport:pan",
          offset: { x: 10, y: 20 },
        });
        useGraphEventStore.getState().emit({
          type: "viewport:zoom",
          zoom: 1.5,
          center: { x: 100, y: 100 },
        });
        useGraphEventStore.getState().emit({
          type: "viewport:resize",
          width: 800,
          height: 600,
        });
        useGraphEventStore.getState().emit({
          type: "viewport:fit",
        });
      });

      expect(onPan).toHaveBeenCalledWith({ x: 10, y: 20 });
      expect(onZoom).toHaveBeenCalledWith(1.5, { x: 100, y: 100 });
      expect(onResize).toHaveBeenCalledWith(800, 600);
      expect(onFit).toHaveBeenCalled();
    });
  });

  describe("useLayoutEvents", () => {
    it("should call layout handlers", () => {
      const onStart = jest.fn();
      const onTick = jest.fn();
      const onEnd = jest.fn();
      const onChange = jest.fn();
      renderHook(() => useLayoutEvents({ onStart, onTick, onEnd, onChange }));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "layout:start",
          algorithm: "force",
        });
        useGraphEventStore.getState().emit({
          type: "layout:tick",
          alpha: 0.5,
          progress: 50,
        });
        useGraphEventStore.getState().emit({
          type: "layout:end",
          algorithm: "force",
          duration: 1000,
        });
        useGraphEventStore.getState().emit({
          type: "layout:change",
          algorithm: "grid",
          previousAlgorithm: "force",
        });
      });

      expect(onStart).toHaveBeenCalledWith("force");
      expect(onTick).toHaveBeenCalledWith(0.5, 50);
      expect(onEnd).toHaveBeenCalledWith("force", 1000);
      expect(onChange).toHaveBeenCalledWith("grid", "force");
    });
  });

  describe("useDataLoadingEvents", () => {
    it("should call data loading handlers", () => {
      const onLoadStart = jest.fn();
      const onLoadEnd = jest.fn();
      const onLoadError = jest.fn();
      renderHook(() => useDataLoadingEvents({ onLoadStart, onLoadEnd, onLoadError }));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "data:loadstart",
          dataSource: "vault",
        });
        useGraphEventStore.getState().emit({
          type: "data:loadend",
          nodeCount: 100,
          edgeCount: 50,
          duration: 500,
        });
        useGraphEventStore.getState().emit({
          type: "data:loaderror",
          error: "Connection failed",
        });
      });

      expect(onLoadStart).toHaveBeenCalledWith("vault");
      expect(onLoadEnd).toHaveBeenCalledWith(100, 50, 500);
      expect(onLoadError).toHaveBeenCalledWith("Connection failed");
    });
  });

  describe("useGraphError", () => {
    it("should call handler with error details", () => {
      const handler = jest.fn();
      renderHook(() => useGraphError(handler));

      act(() => {
        useGraphEventStore.getState().emit({
          type: "error",
          error: "Something went wrong",
          context: "data-loading",
          recoverable: true,
        });
      });

      expect(handler).toHaveBeenCalledWith("Something went wrong", "data-loading", true);
    });
  });

  describe("useRecentEvents", () => {
    it("should return recent events of specific type", () => {
      // Enable history
      act(() => {
        useGraphEventStore.getState().setHistoryEnabled(true);
      });

      // Emit several events
      act(() => {
        useGraphEventStore.getState().emit({
          type: "node:add",
          node: { id: "node1", label: "N1", path: "/n1.md", isArchived: false, title: "N1" },
        });
        useGraphEventStore.getState().emit({
          type: "node:add",
          node: { id: "node2", label: "N2", path: "/n2.md", isArchived: false, title: "N2" },
        });
        useGraphEventStore.getState().emit({ type: "viewport:zoom", zoom: 1.5 });
      });

      const { result } = renderHook(() => useRecentEvents("node:add", 10));
      expect(result.current).toHaveLength(2);
    });
  });
});
