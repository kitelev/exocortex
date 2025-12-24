/**
 * Unit tests for Physics Worker Hooks
 */

import { renderHook, act } from "@testing-library/react";
import {
  usePhysicsWorkerSupported,
  usePhysicsStatus,
  usePhysicsRunning,
  usePhysicsAlpha,
  usePhysicsError,
  usePhysicsMetrics,
  usePhysicsActions,
  usePhysicsNodeActions,
  usePhysicsWorkerState,
  useGetNodePositions,
  useGetNodeVelocities,
  usePhysicsConfigUpdate,
  usePhysicsController,
  usePhysicsNodeDrag,
  usePhysicsSimulation,
  usePhysicsTick,
} from "../../../../../src/presentation/stores/physicsWorkerStore/hooks";
import {
  usePhysicsWorkerStore,
  resetController,
} from "../../../../../src/presentation/stores/physicsWorkerStore/store";

// Mock SharedArrayBuffer for environments that don't support it
const originalSharedArrayBuffer = global.SharedArrayBuffer;

// Mock Worker
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown): void {
    if (typeof message === "object" && message !== null && "type" in message) {
      const msg = message as { type: string };
      if (msg.type === "init") {
        setTimeout(() => {
          this.onmessage?.({ data: { type: "ready" } } as MessageEvent);
        }, 10);
      }
    }
  }

  terminate(): void {
    // No-op
  }

  addEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
    if (type === "message") {
      this.onmessage = handler as (event: MessageEvent) => void;
    }
  }

  removeEventListener(_type: string, _handler: EventListenerOrEventListenerObject): void {
    // No-op
  }
}

beforeAll(() => {
  // Mock SharedArrayBuffer if not available
  if (typeof SharedArrayBuffer === "undefined") {
    (global as Record<string, unknown>).SharedArrayBuffer = ArrayBuffer;
  }

  // Mock crossOriginIsolated
  Object.defineProperty(global, "crossOriginIsolated", {
    value: true,
    writable: true,
    configurable: true,
  });

  // Mock Worker
  (global as Record<string, unknown>).Worker = MockWorker;

  // Mock URL methods
  URL.createObjectURL = jest.fn(() => "blob:mock-url");
  URL.revokeObjectURL = jest.fn();
});

afterAll(() => {
  if (originalSharedArrayBuffer) {
    global.SharedArrayBuffer = originalSharedArrayBuffer;
  }
});

/**
 * Reset store state before each test
 */
function resetStoreForTest(): void {
  resetController();
  usePhysicsWorkerStore.setState({
    status: "idle",
    alpha: 0,
    isSupported: true,
    nodeCount: 0,
    edgeCount: 0,
    metrics: {
      lastTickTime: 0,
      avgTickTime: 0,
      totalTicks: 0,
      totalTime: 0,
    },
    error: null,
  });
}

describe("Physics Worker Hooks", () => {
  beforeEach(() => {
    resetStoreForTest();
  });

  describe("usePhysicsWorkerSupported", () => {
    it("should return boolean", () => {
      const { result } = renderHook(() => usePhysicsWorkerSupported());
      expect(typeof result.current).toBe("boolean");
    });

    it("should indicate support status", () => {
      // With mocks, should be true
      const { result } = renderHook(() => usePhysicsWorkerSupported());
      expect(result.current).toBe(true);
    });
  });

  describe("usePhysicsStatus", () => {
    it("should return status string", () => {
      const { result } = renderHook(() => usePhysicsStatus());
      expect(["idle", "initializing", "running", "stopped", "error"]).toContain(result.current);
    });

    it("should return idle by default", () => {
      const { result } = renderHook(() => usePhysicsStatus());
      expect(result.current).toBe("idle");
    });
  });

  describe("usePhysicsRunning", () => {
    it("should return false when idle", () => {
      const { result } = renderHook(() => usePhysicsRunning());
      expect(result.current).toBe(false);
    });

    it("should return true when running", () => {
      act(() => {
        usePhysicsWorkerStore.setState({ status: "running" });
      });

      const { result } = renderHook(() => usePhysicsRunning());
      expect(result.current).toBe(true);
    });
  });

  describe("usePhysicsAlpha", () => {
    it("should return current alpha value", () => {
      const { result } = renderHook(() => usePhysicsAlpha());
      expect(typeof result.current).toBe("number");
      expect(result.current).toBe(0);
    });

    it("should update when alpha changes", () => {
      const { result, rerender } = renderHook(() => usePhysicsAlpha());

      act(() => {
        usePhysicsWorkerStore.setState({ alpha: 0.5 });
      });

      rerender();
      expect(result.current).toBe(0.5);
    });
  });

  describe("usePhysicsError", () => {
    it("should return null when no error", () => {
      const { result } = renderHook(() => usePhysicsError());
      expect(result.current).toBeNull();
    });

    it("should return error message when error occurs", () => {
      act(() => {
        usePhysicsWorkerStore.setState({ error: "Test error", status: "error" });
      });

      const { result } = renderHook(() => usePhysicsError());
      expect(result.current).toBe("Test error");
    });
  });

  describe("usePhysicsMetrics", () => {
    it("should return metrics object", () => {
      const { result } = renderHook(() => usePhysicsMetrics());

      expect(result.current).toHaveProperty("lastTickTime");
      expect(result.current).toHaveProperty("avgTickTime");
      expect(result.current).toHaveProperty("totalTicks");
      expect(result.current).toHaveProperty("totalTime");
      expect(result.current).toHaveProperty("nodeCount");
      expect(result.current).toHaveProperty("edgeCount");
    });

    it("should have initial zero values", () => {
      const { result } = renderHook(() => usePhysicsMetrics());

      expect(result.current.lastTickTime).toBe(0);
      expect(result.current.avgTickTime).toBe(0);
      expect(result.current.totalTicks).toBe(0);
      expect(result.current.nodeCount).toBe(0);
      expect(result.current.edgeCount).toBe(0);
    });
  });

  describe("usePhysicsActions", () => {
    it("should return action functions", () => {
      const { result } = renderHook(() => usePhysicsActions());

      expect(typeof result.current.initialize).toBe("function");
      expect(typeof result.current.start).toBe("function");
      expect(typeof result.current.stop).toBe("function");
      expect(typeof result.current.reheat).toBe("function");
      expect(typeof result.current.cleanup).toBe("function");
      expect(typeof result.current.reset).toBe("function");
    });
  });

  describe("usePhysicsNodeActions", () => {
    it("should return node action functions", () => {
      const { result } = renderHook(() => usePhysicsNodeActions());

      expect(typeof result.current.fixNode).toBe("function");
      expect(typeof result.current.unfixNode).toBe("function");
      expect(typeof result.current.updateNodePosition).toBe("function");
    });
  });

  describe("usePhysicsWorkerState", () => {
    it("should return complete state object", () => {
      const { result } = renderHook(() => usePhysicsWorkerState());

      expect(result.current).toHaveProperty("status");
      expect(result.current).toHaveProperty("alpha");
      expect(result.current).toHaveProperty("isSupported");
      expect(result.current).toHaveProperty("nodeCount");
      expect(result.current).toHaveProperty("edgeCount");
      expect(result.current).toHaveProperty("metrics");
      expect(result.current).toHaveProperty("error");
    });
  });

  describe("useGetNodePositions", () => {
    it("should return function that returns Map", () => {
      const { result } = renderHook(() => useGetNodePositions());
      expect(typeof result.current).toBe("function");

      const positions = result.current();
      expect(positions).toBeInstanceOf(Map);
    });
  });

  describe("useGetNodeVelocities", () => {
    it("should return function that returns Map", () => {
      const { result } = renderHook(() => useGetNodeVelocities());
      expect(typeof result.current).toBe("function");

      const velocities = result.current();
      expect(velocities).toBeInstanceOf(Map);
    });
  });

  describe("usePhysicsConfigUpdate", () => {
    it("should return update config function", () => {
      const { result } = renderHook(() => usePhysicsConfigUpdate());
      expect(typeof result.current).toBe("function");
    });
  });

  describe("usePhysicsController", () => {
    it("should return controller or null", () => {
      const { result } = renderHook(() => usePhysicsController());
      // Controller may be null before initialization
      expect(result.current === null || typeof result.current === "object").toBe(true);
    });
  });

  describe("usePhysicsNodeDrag", () => {
    it("should return drag handlers", () => {
      const { result } = renderHook(() => usePhysicsNodeDrag("test-node"));

      expect(typeof result.current.onDragStart).toBe("function");
      expect(typeof result.current.onDrag).toBe("function");
      expect(typeof result.current.onDragEnd).toBe("function");
    });

    it("should handle drag lifecycle", () => {
      const { result } = renderHook(() => usePhysicsNodeDrag("test-node"));

      // These should not throw
      act(() => {
        result.current.onDragStart(100, 100);
      });

      act(() => {
        result.current.onDrag(150, 150);
      });

      act(() => {
        result.current.onDragEnd();
      });
    });

    it("should ignore drag when not dragging", () => {
      const { result } = renderHook(() => usePhysicsNodeDrag("test-node"));

      // onDrag without onDragStart should be ignored
      act(() => {
        result.current.onDrag(100, 100);
      });

      // onDragEnd without onDragStart should be ignored
      act(() => {
        result.current.onDragEnd();
      });
    });
  });

  describe("usePhysicsSimulation", () => {
    const testNodes = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 100, y: 100 },
    ];
    const testEdges = [{ source: "n1", target: "n2" }];

    it("should return simulation state", () => {
      const { result } = renderHook(() =>
        usePhysicsSimulation(testNodes, testEdges, undefined, false)
      );

      expect(result.current).toHaveProperty("status");
      expect(result.current).toHaveProperty("isSupported");
      expect(result.current).toHaveProperty("isRunning");
    });

    it("should handle empty nodes", () => {
      const { result } = renderHook(() =>
        usePhysicsSimulation([], [], undefined, false)
      );

      expect(result.current.status).toBe("idle");
    });

    it("should handle unsupported environment", () => {
      // Temporarily set isSupported to false
      act(() => {
        usePhysicsWorkerStore.setState({ isSupported: false });
      });

      const { result } = renderHook(() =>
        usePhysicsSimulation(testNodes, testEdges, undefined, false)
      );

      expect(result.current.isSupported).toBe(false);
    });
  });

  describe("usePhysicsTick", () => {
    it("should accept callback", () => {
      const callback = jest.fn();
      // Should not throw
      renderHook(() => usePhysicsTick(callback));
    });

    it("should accept custom throttle", () => {
      const callback = jest.fn();
      // Should not throw
      renderHook(() => usePhysicsTick(callback, 32));
    });

    it("should not call callback when not running", () => {
      const callback = jest.fn();
      renderHook(() => usePhysicsTick(callback));

      // Status is idle, callback should not be called
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
