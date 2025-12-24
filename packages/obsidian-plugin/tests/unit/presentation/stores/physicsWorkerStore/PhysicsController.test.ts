/**
 * Unit tests for PhysicsController
 */

import {
  PhysicsController,
  isSharedArrayBufferSupported,
  DEFAULT_PHYSICS_CONFIG,
} from "../../../../../src/presentation/stores/physicsWorkerStore/PhysicsController";
import type {
  PhysicsNode,
  PhysicsEdgeInput,
} from "../../../../../src/presentation/stores/physicsWorkerStore/types";

// Store original globals
const originalSharedArrayBuffer = global.SharedArrayBuffer;
const originalCrossOriginIsolated = (global as Record<string, unknown>).crossOriginIsolated;

// Mock Worker
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private messageHandlers: ((event: MessageEvent) => void)[] = [];
  private errorHandlers: ((event: ErrorEvent) => void)[] = [];

  postMessage(message: unknown): void {
    if (typeof message === "object" && message !== null && "type" in message) {
      const msg = message as { type: string };
      if (msg.type === "init") {
        setTimeout(() => {
          const event = { data: { type: "ready" } } as MessageEvent;
          this.onmessage?.(event);
          this.messageHandlers.forEach(h => h(event));
        }, 10);
      }
    }
  }

  terminate(): void {
    // No-op
  }

  addEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
    if (type === "message") {
      this.messageHandlers.push(handler as (event: MessageEvent) => void);
    } else if (type === "error") {
      this.errorHandlers.push(handler as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
    if (type === "message") {
      const idx = this.messageHandlers.indexOf(handler as (event: MessageEvent) => void);
      if (idx !== -1) this.messageHandlers.splice(idx, 1);
    } else if (type === "error") {
      const idx = this.errorHandlers.indexOf(handler as (event: ErrorEvent) => void);
      if (idx !== -1) this.errorHandlers.splice(idx, 1);
    }
  }

  simulateMessage(data: unknown): void {
    const event = { data } as MessageEvent;
    this.onmessage?.(event);
    this.messageHandlers.forEach(h => h(event));
  }

  simulateError(message: string): void {
    const event = { message } as ErrorEvent;
    this.onerror?.(event);
    this.errorHandlers.forEach(h => h(event));
  }
}

// Track created workers
let createdWorkers: MockWorker[] = [];

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
  (global as Record<string, unknown>).Worker = class extends MockWorker {
    constructor() {
      super();
      createdWorkers.push(this);
    }
  };

  // Mock URL methods
  URL.createObjectURL = jest.fn(() => "blob:mock-url");
  URL.revokeObjectURL = jest.fn();
});

afterAll(() => {
  if (originalSharedArrayBuffer) {
    global.SharedArrayBuffer = originalSharedArrayBuffer;
  }
  if (originalCrossOriginIsolated !== undefined) {
    (global as Record<string, unknown>).crossOriginIsolated = originalCrossOriginIsolated;
  }
});

beforeEach(() => {
  createdWorkers = [];
});

describe("isSharedArrayBufferSupported", () => {
  it("should return true when SharedArrayBuffer is available and crossOriginIsolated is true", () => {
    expect(isSharedArrayBufferSupported()).toBe(true);
  });

  it("should return false when crossOriginIsolated is false", () => {
    const original = (global as Record<string, unknown>).crossOriginIsolated;
    Object.defineProperty(global, "crossOriginIsolated", {
      value: false,
      writable: true,
      configurable: true,
    });

    expect(isSharedArrayBufferSupported()).toBe(false);

    Object.defineProperty(global, "crossOriginIsolated", {
      value: original,
      writable: true,
      configurable: true,
    });
  });
});

describe("DEFAULT_PHYSICS_CONFIG", () => {
  it("should have all required force configurations", () => {
    expect(DEFAULT_PHYSICS_CONFIG).toHaveProperty("simulation");
    expect(DEFAULT_PHYSICS_CONFIG).toHaveProperty("center");
    expect(DEFAULT_PHYSICS_CONFIG).toHaveProperty("link");
    expect(DEFAULT_PHYSICS_CONFIG).toHaveProperty("charge");
    expect(DEFAULT_PHYSICS_CONFIG).toHaveProperty("collision");
    expect(DEFAULT_PHYSICS_CONFIG).toHaveProperty("radial");
  });

  it("should have correct simulation defaults", () => {
    expect(DEFAULT_PHYSICS_CONFIG.simulation.alphaMin).toBe(0.001);
    expect(DEFAULT_PHYSICS_CONFIG.simulation.alphaDecay).toBe(0.0228);
    expect(DEFAULT_PHYSICS_CONFIG.simulation.alphaTarget).toBe(0);
    expect(DEFAULT_PHYSICS_CONFIG.simulation.velocityDecay).toBe(0.4);
  });

  it("should have center force enabled by default", () => {
    expect(DEFAULT_PHYSICS_CONFIG.center.enabled).toBe(true);
    expect(DEFAULT_PHYSICS_CONFIG.center.strength).toBe(0.1);
    expect(DEFAULT_PHYSICS_CONFIG.center.x).toBe(0);
    expect(DEFAULT_PHYSICS_CONFIG.center.y).toBe(0);
  });

  it("should have charge force with Barnes-Hut theta", () => {
    expect(DEFAULT_PHYSICS_CONFIG.charge.enabled).toBe(true);
    expect(DEFAULT_PHYSICS_CONFIG.charge.theta).toBe(0.9);
    expect(DEFAULT_PHYSICS_CONFIG.charge.distanceMin).toBe(1);
    expect(DEFAULT_PHYSICS_CONFIG.charge.distanceMax).toBe(Infinity);
  });

  it("should have radial force disabled by default", () => {
    expect(DEFAULT_PHYSICS_CONFIG.radial.enabled).toBe(false);
  });
});

describe("PhysicsController", () => {
  let controller: PhysicsController;

  const testNodes: PhysicsNode[] = [
    { id: "node1", x: 0, y: 0 },
    { id: "node2", x: 100, y: 100 },
    { id: "node3", x: 200, y: 0 },
  ];

  const testEdges: PhysicsEdgeInput[] = [
    { source: "node1", target: "node2" },
    { source: "node2", target: "node3" },
  ];

  beforeEach(() => {
    controller = new PhysicsController();
  });

  afterEach(() => {
    controller.cleanup();
  });

  describe("Constructor", () => {
    it("should create with default config", () => {
      expect(controller.getIsSupported()).toBe(true);
      expect(controller.getStatus()).toBe("idle");
    });

    it("should accept custom physics config", () => {
      const customController = new PhysicsController({
        physics: {
          ...DEFAULT_PHYSICS_CONFIG,
          simulation: {
            ...DEFAULT_PHYSICS_CONFIG.simulation,
            alphaDecay: 0.05,
          },
        },
      });
      expect(customController.getStatus()).toBe("idle");
      customController.cleanup();
    });

    it("should accept callback functions", () => {
      const onTick = jest.fn();
      const onEnd = jest.fn();
      const onError = jest.fn();
      const onStatusChange = jest.fn();

      const customController = new PhysicsController({
        onTick,
        onEnd,
        onError,
        onStatusChange,
      });

      expect(customController.getStatus()).toBe("idle");
      customController.cleanup();
    });
  });

  describe("Getter Methods", () => {
    it("should return supported status", () => {
      expect(typeof controller.getIsSupported()).toBe("boolean");
    });

    it("should return idle status initially", () => {
      expect(controller.getStatus()).toBe("idle");
    });

    it("should return 0 alpha when not initialized", () => {
      expect(controller.getAlpha()).toBe(0);
    });

    it("should return false for isRunning when not initialized", () => {
      expect(controller.isRunning()).toBe(false);
    });

    it("should return 0 node count when not initialized", () => {
      expect(controller.getNodeCount()).toBe(0);
    });

    it("should return 0 edge count when not initialized", () => {
      expect(controller.getEdgeCount()).toBe(0);
    });
  });

  describe("Initialize", () => {
    it("should initialize with nodes and edges", async () => {
      const onStatusChange = jest.fn();
      controller = new PhysicsController({ onStatusChange });

      await controller.initialize(testNodes, testEdges);

      expect(controller.getNodeCount()).toBe(3);
      expect(controller.getEdgeCount()).toBe(2);
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should update status during initialization", async () => {
      const statusChanges: string[] = [];
      controller = new PhysicsController({
        onStatusChange: (status) => statusChanges.push(status),
      });

      await controller.initialize(testNodes, testEdges);

      expect(statusChanges).toContain("initializing");
      expect(statusChanges).toContain("stopped");
    });

    it("should initialize with center coordinates", async () => {
      await controller.initialize(testNodes, testEdges, 400, 300);

      expect(controller.getNodeCount()).toBe(3);
    });

    it("should handle nodes with optional properties", async () => {
      const nodesWithOptional: PhysicsNode[] = [
        { id: "n1", x: 0, y: 0, vx: 1, vy: 2, fx: 100, fy: 100, radius: 10, mass: 2 },
        { id: "n2", x: 50, y: 50 },
      ];

      await controller.initialize(nodesWithOptional, []);

      expect(controller.getNodeCount()).toBe(2);
    });

    it("should handle edges with optional distance and strength", async () => {
      const edgesWithOptional: PhysicsEdgeInput[] = [
        { source: "node1", target: "node2", distance: 150, strength: 0.5 },
        { source: "node2", target: "node3" },
      ];

      await controller.initialize(testNodes, edgesWithOptional);

      expect(controller.getEdgeCount()).toBe(2);
    });

    it("should filter out edges with invalid node references", async () => {
      const invalidEdges: PhysicsEdgeInput[] = [
        { source: "node1", target: "node2" },
        { source: "nonexistent", target: "node2" },
        { source: "node1", target: "also-nonexistent" },
      ];

      await controller.initialize(testNodes, invalidEdges);

      expect(controller.getEdgeCount()).toBe(1);
    });
  });

  describe("Start/Stop", () => {
    beforeEach(async () => {
      await controller.initialize(testNodes, testEdges);
    });

    it("should start simulation", () => {
      controller.start();
      expect(controller.getStatus()).toBe("running");
    });

    it("should start with custom alpha", () => {
      controller.start(0.5);
      expect(controller.getStatus()).toBe("running");
    });

    it("should not start if already running", () => {
      controller.start();
      expect(controller.getStatus()).toBe("running");
      controller.start(); // Second call
      expect(controller.getStatus()).toBe("running");
    });

    it("should stop simulation", () => {
      controller.start();
      controller.stop();
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should not stop if not running", () => {
      expect(controller.getStatus()).toBe("stopped");
      controller.stop();
      expect(controller.getStatus()).toBe("stopped");
    });
  });

  describe("Reheat", () => {
    beforeEach(async () => {
      await controller.initialize(testNodes, testEdges);
    });

    it("should reheat with default alpha", () => {
      controller.reheat();
      expect(controller.getStatus()).toBe("running");
    });

    it("should reheat with custom alpha", () => {
      controller.reheat(0.8);
      expect(controller.getStatus()).toBe("running");
    });

    it("should reheat while already running", () => {
      controller.start();
      controller.reheat(0.5);
      expect(controller.getStatus()).toBe("running");
    });
  });

  describe("Configuration Updates", () => {
    beforeEach(async () => {
      await controller.initialize(testNodes, testEdges);
    });

    it("should update physics config", () => {
      controller.updateConfig({
        simulation: { ...DEFAULT_PHYSICS_CONFIG.simulation, alphaDecay: 0.05 },
      });
      // Config update doesn't change status
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should update edges", () => {
      const newEdges: PhysicsEdgeInput[] = [
        { source: "node1", target: "node3" },
      ];
      controller.updateEdges(newEdges);
      expect(controller.getEdgeCount()).toBe(1);
    });
  });

  describe("Node Operations", () => {
    beforeEach(async () => {
      await controller.initialize(testNodes, testEdges);
    });

    it("should fix a node at position", () => {
      controller.fixNode("node1", 50, 75);
      // Fix operation doesn't change status
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should ignore fixing nonexistent node", () => {
      controller.fixNode("nonexistent", 50, 75);
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should unfix a node", () => {
      controller.fixNode("node1", 50, 75);
      controller.unfixNode("node1");
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should ignore unfixing nonexistent node", () => {
      controller.unfixNode("nonexistent");
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should update node position", () => {
      controller.updateNodePosition("node1", 200, 200);

      const position = controller.getNodePosition("node1");
      expect(position).toEqual({ x: 200, y: 200 });
    });

    it("should ignore updating nonexistent node position", () => {
      controller.updateNodePosition("nonexistent", 200, 200);
      expect(controller.getNodePosition("nonexistent")).toBeNull();
    });

    it("should get node position", () => {
      const position = controller.getNodePosition("node1");
      expect(position).toEqual({ x: 0, y: 0 });
    });

    it("should return null for nonexistent node position", () => {
      expect(controller.getNodePosition("nonexistent")).toBeNull();
    });

    it("should get all node positions", () => {
      const positions = controller.getNodePositions();
      expect(positions.size).toBe(3);
      expect(positions.get("node1")).toEqual({ x: 0, y: 0 });
      expect(positions.get("node2")).toEqual({ x: 100, y: 100 });
    });

    it("should get all node velocities", () => {
      const velocities = controller.getNodeVelocities();
      expect(velocities.size).toBe(3);
      expect(velocities.get("node1")).toEqual({ vx: 0, vy: 0 });
    });
  });

  describe("Position/Velocity Before Initialization", () => {
    it("should return empty map for positions before init", () => {
      const positions = controller.getNodePositions();
      expect(positions.size).toBe(0);
    });

    it("should return empty map for velocities before init", () => {
      const velocities = controller.getNodeVelocities();
      expect(velocities.size).toBe(0);
    });

    it("should return null for specific node position before init", () => {
      expect(controller.getNodePosition("any")).toBeNull();
    });
  });

  describe("Cleanup", () => {
    it("should reset all state on cleanup", async () => {
      await controller.initialize(testNodes, testEdges);
      controller.start();

      controller.cleanup();

      expect(controller.getStatus()).toBe("idle");
      expect(controller.getNodeCount()).toBe(0);
      expect(controller.getEdgeCount()).toBe(0);
    });

    it("should be safe to call cleanup multiple times", () => {
      controller.cleanup();
      controller.cleanup();
      expect(controller.getStatus()).toBe("idle");
    });

    it("should cleanup even without initialization", () => {
      controller.cleanup();
      expect(controller.getStatus()).toBe("idle");
    });
  });

  describe("Worker Messages", () => {
    it("should handle tick messages", async () => {
      const onTick = jest.fn();
      controller = new PhysicsController({ onTick });
      await controller.initialize(testNodes, testEdges);

      // Get the worker and simulate a tick
      const worker = createdWorkers[createdWorkers.length - 1];
      worker.simulateMessage({ type: "tick", alpha: 0.5, computeTime: 10 });

      expect(onTick).toHaveBeenCalledWith(0.5, 10);
    });

    it("should handle end messages", async () => {
      const onEnd = jest.fn();
      controller = new PhysicsController({ onEnd });
      await controller.initialize(testNodes, testEdges);
      controller.start();

      const worker = createdWorkers[createdWorkers.length - 1];
      worker.simulateMessage({ type: "end", totalTicks: 100, totalTime: 5000 });

      expect(onEnd).toHaveBeenCalledWith(100, 5000);
      expect(controller.getStatus()).toBe("stopped");
    });

    it("should handle error messages from worker", async () => {
      const onError = jest.fn();
      controller = new PhysicsController({ onError });
      await controller.initialize(testNodes, testEdges);

      const worker = createdWorkers[createdWorkers.length - 1];
      worker.simulateMessage({ type: "error", message: "Test error" });

      expect(onError).toHaveBeenCalled();
      expect(controller.getStatus()).toBe("error");
    });

    it("should handle worker error events", async () => {
      const onError = jest.fn();
      controller = new PhysicsController({ onError });
      await controller.initialize(testNodes, testEdges);

      const worker = createdWorkers[createdWorkers.length - 1];
      worker.simulateError("Worker error event");

      expect(onError).toHaveBeenCalled();
      expect(controller.getStatus()).toBe("error");
    });
  });
});
