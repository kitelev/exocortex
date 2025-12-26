/**
 * LayoutTransitionManager Tests
 *
 * Tests for smooth transitions between graph layout states.
 */

import {
  LayoutTransitionManager,
  createLayoutTransitionManager,
  transitionPositions,
  DEFAULT_TRANSITION_CONFIG,
  DEFAULT_TRANSITION_MANAGER_CONFIG,
  TRANSITION_PRESETS,
  type TransitionEvent,
  type TransitionNodeState,
} from "../../../../../../src/presentation/renderers/graph/animation/LayoutTransitionManager";
import type { Point2D } from "../../../../../../src/presentation/renderers/graph/animation/Interpolation";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Mock requestAnimationFrame and performance.now for testing
 */
function mockRAF(): {
  advance: (frames: number) => void;
  restore: () => void;
  getTime: () => number;
  setTime: (time: number) => void;
} {
  const originalRAF = global.requestAnimationFrame;
  const originalCAF = global.cancelAnimationFrame;

  let frameId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let currentTime = 0;

  // Use jest.spyOn for performance.now
  const perfNowSpy = jest.spyOn(performance, "now").mockImplementation(() => currentTime);

  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = ++frameId;
    callbacks.set(id, callback);
    return id;
  };

  global.cancelAnimationFrame = (id: number): void => {
    callbacks.delete(id);
  };

  return {
    advance: (frames: number) => {
      for (let i = 0; i < frames; i++) {
        currentTime += 16.67;
        const callbacksToRun = Array.from(callbacks.entries());
        callbacks.clear();
        for (const [, callback] of callbacksToRun) {
          callback(currentTime);
        }
      }
    },
    restore: () => {
      global.requestAnimationFrame = originalRAF;
      global.cancelAnimationFrame = originalCAF;
      perfNowSpy.mockRestore();
    },
    getTime: () => currentTime,
    setTime: (time: number) => {
      currentTime = time;
    },
  };
}

/**
 * Create test position maps
 */
function createTestPositions(count: number): Map<string, Point2D> {
  const positions = new Map<string, Point2D>();
  for (let i = 0; i < count; i++) {
    positions.set(`node-${i}`, { x: i * 100, y: i * 50 });
  }
  return positions;
}

// ============================================================
// LayoutTransitionManager Tests
// ============================================================

describe("LayoutTransitionManager", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
  });

  afterEach(() => {
    rafMock.restore();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const manager = new LayoutTransitionManager();

      expect(manager.state).toBe("idle");
      expect(manager.progress).toBe(0);
      expect(manager.isActive).toBe(false);

      manager.destroy();
    });

    it("should create with custom config", () => {
      const manager = new LayoutTransitionManager({
        defaultTransition: {
          duration: 1000,
          stagger: false,
        },
      });

      expect(manager.state).toBe("idle");
      manager.destroy();
    });
  });

  describe("transition", () => {
    it("should transition between two position sets", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(3);
      const end = new Map<string, Point2D>();
      for (const [id, pos] of start) {
        end.set(id, { x: pos.x + 100, y: pos.y + 100 });
      }

      const progressValues: number[] = [];
      const promise = manager.transition(start, end, {
        duration: 100,
        stagger: false,
        onProgress: (p) => progressValues.push(p),
      });

      // Advance animation
      rafMock.advance(10);

      await promise;

      expect(manager.state).toBe("completed");
      expect(manager.progress).toBe(1);
      expect(progressValues.length).toBeGreaterThan(0);

      manager.destroy();
    });

    it("should call callbacks", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end = new Map(start);

      const onStart = jest.fn();
      const onProgress = jest.fn();
      const onComplete = jest.fn();

      const promise = manager.transition(start, end, {
        duration: 50,
        onStart,
        onProgress,
        onComplete,
      });

      rafMock.advance(10);
      await promise;

      expect(onStart).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();

      manager.destroy();
    });

    it("should interpolate positions during transition", async () => {
      const manager = new LayoutTransitionManager();
      const start = new Map<string, Point2D>([["node1", { x: 0, y: 0 }]]);
      const end = new Map<string, Point2D>([["node1", { x: 100, y: 100 }]]);

      let midPositions: Map<string, TransitionNodeState> | null = null;

      const promise = manager.transition(start, end, {
        duration: 100,
        stagger: false,
        onProgress: (p) => {
          if (p > 0.4 && p < 0.6) {
            midPositions = manager.getCurrentPositions();
          }
        },
      });

      rafMock.advance(10);
      await promise;

      expect(midPositions).not.toBeNull();
      if (midPositions) {
        const pos = midPositions.get("node1");
        expect(pos).toBeDefined();
        expect(pos!.x).toBeGreaterThan(0);
        expect(pos!.x).toBeLessThan(100);
      }

      manager.destroy();
    });

    it("should cancel previous transition", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end1 = new Map(start);
      const end2 = new Map(start);

      const onCancel = jest.fn();
      const promise1 = manager.transition(start, end1, {
        duration: 1000,
        onCancel,
      });

      // Start another transition before first completes
      const promise2 = manager.transition(start, end2, {
        duration: 50,
      });

      rafMock.advance(10);
      await Promise.all([promise1, promise2]);

      // First transition should have been cancelled
      expect(onCancel).toHaveBeenCalled();

      manager.destroy();
    });
  });

  describe("pause and resume", () => {
    it("should pause running transition", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end = new Map(start);

      const promise = manager.transition(start, end, { duration: 1000 });

      rafMock.advance(2);
      manager.pause();

      expect(manager.state).toBe("paused");
      expect(manager.isActive).toBe(false);

      manager.cancel();
      await promise;
      manager.destroy();
    });

    it("should resume paused transition", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end = new Map(start);

      const promise = manager.transition(start, end, { duration: 100 });

      rafMock.advance(2);
      manager.pause();
      manager.resume();

      expect(manager.state).toBe("running");

      rafMock.advance(20);
      await promise;
      manager.destroy();
    });
  });

  describe("cancel", () => {
    it("should cancel transition", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end = new Map(start);

      const onCancel = jest.fn();
      const promise = manager.transition(start, end, {
        duration: 1000,
        onCancel,
      });

      rafMock.advance(2);
      manager.cancel();

      await promise;

      expect(manager.state).toBe("idle");
      expect(onCancel).toHaveBeenCalled();

      manager.destroy();
    });
  });

  describe("node enter/exit handling", () => {
    it("should handle entering nodes", async () => {
      const manager = new LayoutTransitionManager();
      const start = new Map<string, Point2D>([["node1", { x: 0, y: 0 }]]);
      const end = new Map<string, Point2D>([
        ["node1", { x: 0, y: 0 }],
        ["node2", { x: 100, y: 100 }],
      ]);

      let hasNewNode = false;
      let newNodeOpacity = -1;

      const promise = manager.transition(start, end, {
        duration: 100,
        stagger: false,
        onProgress: () => {
          const positions = manager.getCurrentPositions();
          if (positions.has("node2")) {
            hasNewNode = true;
            newNodeOpacity = positions.get("node2")!.opacity;
          }
        },
      });

      rafMock.advance(3);
      await promise;

      expect(hasNewNode).toBe(true);

      manager.destroy();
    });

    it("should handle exiting nodes", async () => {
      const manager = new LayoutTransitionManager();
      const start = new Map<string, Point2D>([
        ["node1", { x: 0, y: 0 }],
        ["node2", { x: 100, y: 100 }],
      ]);
      const end = new Map<string, Point2D>([["node1", { x: 0, y: 0 }]]);

      let exitingNodeOpacity = -1;

      const promise = manager.transition(start, end, {
        duration: 100,
        stagger: false,
        onProgress: (p) => {
          if (p > 0.4 && p < 0.6) {
            const positions = manager.getCurrentPositions();
            if (positions.has("node2")) {
              exitingNodeOpacity = positions.get("node2")!.opacity;
            }
          }
        },
      });

      rafMock.advance(10);
      await promise;

      // Exiting node should have reduced opacity during transition
      expect(exitingNodeOpacity).toBeLessThan(1);

      manager.destroy();
    });
  });

  describe("event listeners", () => {
    it("should emit events", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end = new Map(start);

      const events: TransitionEvent[] = [];
      manager.on("start", (e) => events.push(e));
      manager.on("progress", (e) => events.push(e));
      manager.on("complete", (e) => events.push(e));

      const promise = manager.transition(start, end, { duration: 50 });
      rafMock.advance(10);
      await promise;

      const startEvents = events.filter((e) => e.type === "start");
      const progressEvents = events.filter((e) => e.type === "progress");
      const completeEvents = events.filter((e) => e.type === "complete");

      expect(startEvents.length).toBe(1);
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(completeEvents.length).toBe(1);

      manager.destroy();
    });

    it("should allow removing listeners", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end = new Map(start);

      const events: TransitionEvent[] = [];
      const listener = (e: TransitionEvent) => events.push(e);

      manager.on("progress", listener);
      manager.off("progress", listener);

      const promise = manager.transition(start, end, { duration: 50 });
      rafMock.advance(10);
      await promise;

      expect(events.length).toBe(0);

      manager.destroy();
    });
  });

  describe("getCurrentPositions", () => {
    it("should return current interpolated positions", async () => {
      const manager = new LayoutTransitionManager();
      const start = new Map<string, Point2D>([["node1", { x: 0, y: 0 }]]);
      const end = new Map<string, Point2D>([["node1", { x: 100, y: 100 }]]);

      const promise = manager.transition(start, end, { duration: 100 });

      rafMock.advance(3);
      const positions = manager.getCurrentPositions();

      expect(positions.has("node1")).toBe(true);
      const pos = positions.get("node1");
      expect(pos).toBeDefined();

      manager.cancel();
      await promise;
      manager.destroy();
    });
  });

  describe("getNodePosition", () => {
    it("should return position for specific node", async () => {
      const manager = new LayoutTransitionManager();
      const start = new Map<string, Point2D>([
        ["node1", { x: 0, y: 0 }],
        ["node2", { x: 100, y: 100 }],
      ]);
      const end = new Map(start);

      const promise = manager.transition(start, end, { duration: 50 });

      rafMock.advance(1);
      const pos = manager.getNodePosition("node1");
      expect(pos).toBeDefined();
      expect(pos?.id).toBe("node1");

      rafMock.advance(10);
      await promise;
      manager.destroy();
    });

    it("should return undefined for unknown node", () => {
      const manager = new LayoutTransitionManager();
      expect(manager.getNodePosition("unknown")).toBeUndefined();
      manager.destroy();
    });
  });

  describe("destroy", () => {
    it("should clean up resources", async () => {
      const manager = new LayoutTransitionManager();
      const start = createTestPositions(2);
      const end = new Map(start);

      const promise = manager.transition(start, end, { duration: 1000 });

      manager.destroy();

      expect(manager.state).toBe("idle");
      expect(manager.getCurrentPositions().size).toBe(0);

      await promise;
    });
  });
});

// ============================================================
// Factory Functions Tests
// ============================================================

describe("createLayoutTransitionManager", () => {
  it("should create manager instance", () => {
    const manager = createLayoutTransitionManager();
    expect(manager).toBeInstanceOf(LayoutTransitionManager);
    manager.destroy();
  });

  it("should accept custom config", () => {
    const manager = createLayoutTransitionManager({
      autoStart: false,
    });
    expect(manager).toBeInstanceOf(LayoutTransitionManager);
    manager.destroy();
  });
});

describe("transitionPositions", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
  });

  afterEach(() => {
    rafMock.restore();
  });

  it("should perform one-shot transition", async () => {
    const start = new Map<string, Point2D>([["node1", { x: 0, y: 0 }]]);
    const end = new Map<string, Point2D>([["node1", { x: 100, y: 100 }]]);

    const progressValues: number[] = [];
    const resultPromise = transitionPositions(start, end, {
      duration: 50,
      stagger: false,
      onProgress: (p) => progressValues.push(p),
    });

    rafMock.advance(10);
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Map);
    expect(result.has("node1")).toBe(true);
    expect(progressValues.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Constants Tests
// ============================================================

describe("DEFAULT_TRANSITION_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_TRANSITION_CONFIG.duration).toBe(500);
    expect(DEFAULT_TRANSITION_CONFIG.easing).toBe("easeInOutCubic");
    expect(DEFAULT_TRANSITION_CONFIG.delay).toBe(0);
    expect(DEFAULT_TRANSITION_CONFIG.stagger).toBe(true);
    expect(DEFAULT_TRANSITION_CONFIG.staggerAmount).toBe(0.02);
  });
});

describe("DEFAULT_TRANSITION_MANAGER_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_TRANSITION_MANAGER_CONFIG.autoStart).toBe(true);
    expect(DEFAULT_TRANSITION_MANAGER_CONFIG.defaultTransition).toBeDefined();
  });
});

describe("TRANSITION_PRESETS", () => {
  it("should have snap preset", () => {
    expect(TRANSITION_PRESETS.snap.duration).toBe(150);
    expect(TRANSITION_PRESETS.snap.stagger).toBe(false);
  });

  it("should have smooth preset", () => {
    expect(TRANSITION_PRESETS.smooth.duration).toBe(500);
    expect(TRANSITION_PRESETS.smooth.stagger).toBe(true);
  });

  it("should have elegant preset", () => {
    expect(TRANSITION_PRESETS.elegant.duration).toBe(800);
  });

  it("should have elastic preset", () => {
    expect(TRANSITION_PRESETS.elastic.easing).toBe("easeOutElastic");
  });

  it("should have spring preset", () => {
    expect(TRANSITION_PRESETS.spring.easing).toBe("spring");
  });
});
