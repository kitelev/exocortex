/**
 * Unit tests for Physics Worker Store
 */

import { act, renderHook } from "@testing-library/react";
import {
  usePhysicsWorkerStore,
  getDefaultState,
  resetController,
  DEFAULT_PHYSICS_CONFIG,
} from "../../../../../src/presentation/stores/physicsWorkerStore";

// Mock SharedArrayBuffer for environments that don't support it
const originalSharedArrayBuffer = global.SharedArrayBuffer;

// Mock Worker
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown): void {
    // Simulate worker responding to init message
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

// Mock URL.createObjectURL and URL.revokeObjectURL
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

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
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
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

describe("Physics Worker Store", () => {
  beforeEach(() => {
    resetStoreForTest();
  });

  describe("Initial State", () => {
    it("should have correct default state", () => {
      const state = getDefaultState();

      expect(state.status).toBe("idle");
      expect(state.alpha).toBe(0);
      expect(state.nodeCount).toBe(0);
      expect(state.edgeCount).toBe(0);
      expect(state.error).toBeNull();
      expect(state.metrics.totalTicks).toBe(0);
    });

    it("should indicate SharedArrayBuffer support", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.isSupported));

      // In test environment with mocks, should be true
      expect(typeof result.current).toBe("boolean");
    });
  });

  describe("Store State", () => {
    it("should have status getter", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.status));
      expect(result.current).toBe("idle");
    });

    it("should have alpha getter", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.alpha));
      expect(result.current).toBe(0);
    });

    it("should have metrics getter", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.metrics));
      expect(result.current).toEqual({
        lastTickTime: 0,
        avgTickTime: 0,
        totalTicks: 0,
        totalTime: 0,
      });
    });
  });

  describe("Actions", () => {
    it("should have start action", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.start));
      expect(typeof result.current).toBe("function");
    });

    it("should have stop action", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.stop));
      expect(typeof result.current).toBe("function");
    });

    it("should have reheat action", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.reheat));
      expect(typeof result.current).toBe("function");
    });

    it("should have fixNode action", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.fixNode));
      expect(typeof result.current).toBe("function");
    });

    it("should have unfixNode action", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.unfixNode));
      expect(typeof result.current).toBe("function");
    });

    it("should have cleanup action", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.cleanup));
      expect(typeof result.current).toBe("function");
    });

    it("should have reset action", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.reset));
      expect(typeof result.current).toBe("function");
    });
  });

  describe("Position Methods", () => {
    it("should have getNodePositions method", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.getNodePositions));
      expect(typeof result.current).toBe("function");

      const positions = result.current();
      expect(positions).toBeInstanceOf(Map);
    });

    it("should have getNodeVelocities method", () => {
      const { result } = renderHook(() => usePhysicsWorkerStore((s) => s.getNodeVelocities));
      expect(typeof result.current).toBe("function");

      const velocities = result.current();
      expect(velocities).toBeInstanceOf(Map);
    });
  });

  describe("Cleanup", () => {
    it("should reset state on cleanup", () => {
      const { result } = renderHook(() => ({
        cleanup: usePhysicsWorkerStore((s) => s.cleanup),
        status: usePhysicsWorkerStore((s) => s.status),
        nodeCount: usePhysicsWorkerStore((s) => s.nodeCount),
      }));

      // Modify state first
      usePhysicsWorkerStore.setState({
        nodeCount: 100,
        edgeCount: 50,
      });

      act(() => {
        result.current.cleanup();
      });

      const { result: newResult } = renderHook(() => ({
        status: usePhysicsWorkerStore((s) => s.status),
        nodeCount: usePhysicsWorkerStore((s) => s.nodeCount),
      }));

      expect(newResult.current.status).toBe("idle");
      expect(newResult.current.nodeCount).toBe(0);
    });
  });
});

describe("DEFAULT_PHYSICS_CONFIG", () => {
  it("should have simulation configuration", () => {
    expect(DEFAULT_PHYSICS_CONFIG.simulation).toBeDefined();
    expect(DEFAULT_PHYSICS_CONFIG.simulation.alphaMin).toBe(0.001);
    expect(DEFAULT_PHYSICS_CONFIG.simulation.alphaDecay).toBe(0.0228);
    expect(DEFAULT_PHYSICS_CONFIG.simulation.alphaTarget).toBe(0);
    expect(DEFAULT_PHYSICS_CONFIG.simulation.velocityDecay).toBe(0.4);
  });

  it("should have center force configuration", () => {
    expect(DEFAULT_PHYSICS_CONFIG.center).toBeDefined();
    expect(DEFAULT_PHYSICS_CONFIG.center.enabled).toBe(true);
    expect(DEFAULT_PHYSICS_CONFIG.center.strength).toBe(0.1);
  });

  it("should have link force configuration", () => {
    expect(DEFAULT_PHYSICS_CONFIG.link).toBeDefined();
    expect(DEFAULT_PHYSICS_CONFIG.link.enabled).toBe(true);
    expect(DEFAULT_PHYSICS_CONFIG.link.iterations).toBe(1);
  });

  it("should have charge force configuration", () => {
    expect(DEFAULT_PHYSICS_CONFIG.charge).toBeDefined();
    expect(DEFAULT_PHYSICS_CONFIG.charge.enabled).toBe(true);
    expect(DEFAULT_PHYSICS_CONFIG.charge.strength).toBe(-300);
    expect(DEFAULT_PHYSICS_CONFIG.charge.theta).toBe(0.9);
  });

  it("should have collision force configuration", () => {
    expect(DEFAULT_PHYSICS_CONFIG.collision).toBeDefined();
    expect(DEFAULT_PHYSICS_CONFIG.collision.enabled).toBe(true);
    expect(DEFAULT_PHYSICS_CONFIG.collision.strength).toBe(0.7);
    expect(DEFAULT_PHYSICS_CONFIG.collision.iterations).toBe(1);
  });

  it("should have radial force configuration", () => {
    expect(DEFAULT_PHYSICS_CONFIG.radial).toBeDefined();
    expect(DEFAULT_PHYSICS_CONFIG.radial.enabled).toBe(false);
    expect(DEFAULT_PHYSICS_CONFIG.radial.strength).toBe(0.1);
    expect(DEFAULT_PHYSICS_CONFIG.radial.radius).toBe(200);
  });
});
