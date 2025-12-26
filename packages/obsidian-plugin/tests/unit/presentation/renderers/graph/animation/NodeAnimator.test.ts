/**
 * NodeAnimator Tests
 *
 * Tests for individual node animation management.
 */

import {
  NodeAnimator,
  createNodeAnimator,
  DEFAULT_NODE_VISUAL_STATE,
  DEFAULT_ANIMATION_DURATIONS,
  DEFAULT_ANIMATION_EASINGS,
  DEFAULT_NODE_ANIMATOR_CONFIG,
  NODE_VISUAL_PRESETS,
  type NodeVisualState,
  type NodeAnimatorEvent,
} from "../../../../../../src/presentation/renderers/graph/animation/NodeAnimator";

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

// ============================================================
// NodeAnimator Tests
// ============================================================

describe("NodeAnimator", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
  });

  afterEach(() => {
    rafMock.restore();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const animator = new NodeAnimator();

      expect(animator.getNodeIds()).toHaveLength(0);

      animator.destroy();
    });

    it("should create with custom config", () => {
      const animator = new NodeAnimator({
        queueAnimations: true,
        durations: { hover: 200 },
      });

      expect(animator.getNodeIds()).toHaveLength(0);

      animator.destroy();
    });
  });

  describe("node management", () => {
    it("should add nodes", () => {
      const animator = new NodeAnimator();

      animator.addNode("node1");
      animator.addNode("node2");

      expect(animator.hasNode("node1")).toBe(true);
      expect(animator.hasNode("node2")).toBe(true);
      expect(animator.getNodeIds()).toEqual(["node1", "node2"]);

      animator.destroy();
    });

    it("should not add duplicate nodes", () => {
      const animator = new NodeAnimator();

      animator.addNode("node1");
      animator.addNode("node1");

      expect(animator.getNodeIds()).toHaveLength(1);

      animator.destroy();
    });

    it("should add node with initial state", () => {
      const animator = new NodeAnimator();

      animator.addNode("node1", { scale: 2, opacity: 0.5 });

      const state = animator.getState("node1");
      expect(state?.scale).toBe(2);
      expect(state?.opacity).toBe(0.5);

      animator.destroy();
    });

    it("should remove nodes", () => {
      const animator = new NodeAnimator();

      animator.addNode("node1");
      animator.addNode("node2");
      animator.removeNode("node1");

      expect(animator.hasNode("node1")).toBe(false);
      expect(animator.hasNode("node2")).toBe(true);

      animator.destroy();
    });

    it("should cancel animations when removing node", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      animator.animate("node1", { type: "hover", duration: 1000 });
      rafMock.advance(2);

      animator.removeNode("node1");

      expect(animator.hasNode("node1")).toBe(false);

      animator.destroy();
    });
  });

  describe("state access", () => {
    it("should get state for node", () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const state = animator.getState("node1");

      expect(state).toBeDefined();
      expect(state?.scale).toBe(1);
      expect(state?.opacity).toBe(1);

      animator.destroy();
    });

    it("should return undefined for unknown node", () => {
      const animator = new NodeAnimator();

      expect(animator.getState("unknown")).toBeUndefined();

      animator.destroy();
    });

    it("should get all states", () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");
      animator.addNode("node2");

      const states = animator.getAllStates();

      expect(states.size).toBe(2);
      expect(states.has("node1")).toBe(true);
      expect(states.has("node2")).toBe(true);

      animator.destroy();
    });

    it("should set state directly", () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      animator.setState("node1", { scale: 1.5, glow: 0.5 });

      const state = animator.getState("node1");
      expect(state?.scale).toBe(1.5);
      expect(state?.glow).toBe(0.5);

      animator.destroy();
    });

    it("should reset node to base state", () => {
      const animator = new NodeAnimator();
      animator.addNode("node1", { scale: 1 });

      animator.setState("node1", { scale: 2, glow: 1 });
      animator.reset("node1");

      const state = animator.getState("node1");
      expect(state?.scale).toBe(1);
      expect(state?.glow).toBe(0);

      animator.destroy();
    });

    it("should reset all nodes", () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");
      animator.addNode("node2");

      animator.setState("node1", { scale: 2 });
      animator.setState("node2", { scale: 3 });
      animator.resetAll();

      expect(animator.getState("node1")?.scale).toBe(1);
      expect(animator.getState("node2")?.scale).toBe(1);

      animator.destroy();
    });
  });

  describe("animate", () => {
    it("should animate node", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const animId = animator.animate("node1", {
        type: "custom",
        duration: 100,
        target: { scale: 2 },
      });

      expect(animId).not.toBeNull();

      rafMock.advance(10);

      animator.destroy();
    });

    it("should return null for unknown node", () => {
      const animator = new NodeAnimator();

      const animId = animator.animate("unknown", { type: "hover" });

      expect(animId).toBeNull();

      animator.destroy();
    });

    it("should call onComplete callback", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const onComplete = jest.fn();
      animator.animate("node1", {
        type: "hover",
        duration: 50,
        onComplete,
      });

      rafMock.advance(10);

      expect(onComplete).toHaveBeenCalled();

      animator.destroy();
    });

    it("should interpolate state during animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      let midScale = 0;

      animator.animate("node1", {
        type: "custom",
        duration: 100,
        target: { scale: 2 },
      });

      // Advance partially
      rafMock.advance(3);

      midScale = animator.getState("node1")?.scale ?? 0;

      expect(midScale).toBeGreaterThan(1);
      expect(midScale).toBeLessThan(2);

      animator.destroy();
    });
  });

  describe("quick animations", () => {
    it("should perform hover animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      animator.hover("node1");
      rafMock.advance(15);

      const state = animator.getState("node1");
      expect(state?.scale).toBeCloseTo(NODE_VISUAL_PRESETS.hover.scale, 1);

      animator.destroy();
    });

    it("should perform unhover animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1", { scale: 1.15 });

      animator.unhover("node1");
      rafMock.advance(15);

      const state = animator.getState("node1");
      expect(state?.scale).toBeCloseTo(1, 1);

      animator.destroy();
    });

    it("should perform select animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      animator.select("node1");
      rafMock.advance(20);

      const state = animator.getState("node1");
      expect(state?.ringScale).toBeGreaterThan(0);

      animator.destroy();
    });

    it("should perform deselect animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1", { ringScale: 1.3, ringOpacity: 1 });

      animator.deselect("node1");
      rafMock.advance(20);

      const state = animator.getState("node1");
      expect(state?.ringScale).toBeLessThan(1.3);

      animator.destroy();
    });

    it("should perform pulse animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      animator.pulse("node1", 1);
      rafMock.advance(40);

      animator.destroy();
    });

    it("should perform shake animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      animator.shake("node1");

      // Check mid-animation offset
      rafMock.advance(5);
      const state = animator.getState("node1");
      // Shake creates oscillating offset
      expect(typeof state?.offsetX).toBe("number");

      rafMock.advance(30);

      animator.destroy();
    });

    it("should perform bounce animation", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      animator.bounce("node1");
      rafMock.advance(35);

      animator.destroy();
    });
  });

  describe("cancelAnimations", () => {
    it("should cancel all animations for node", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const onCancel = jest.fn();
      animator.on("animationCancel", onCancel);

      animator.animate("node1", { type: "hover", duration: 1000 });
      rafMock.advance(2);

      animator.cancelAnimations("node1");

      expect(onCancel).toHaveBeenCalled();

      animator.destroy();
    });
  });

  describe("event listeners", () => {
    it("should emit animationStart event", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const events: NodeAnimatorEvent[] = [];
      animator.on("animationStart", (e) => events.push(e));

      animator.animate("node1", { type: "hover", duration: 100 });
      rafMock.advance(1);

      const startEvents = events.filter((e) => e.type === "animationStart");
      expect(startEvents.length).toBe(1);
      expect(startEvents[0].nodeId).toBe("node1");
      expect(startEvents[0].animationType).toBe("hover");

      animator.destroy();
    });

    it("should emit stateChange events", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const events: NodeAnimatorEvent[] = [];
      animator.on("stateChange", (e) => events.push(e));

      animator.animate("node1", { type: "hover", duration: 50 });
      rafMock.advance(5);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("stateChange");
      expect(events[0].state).toBeDefined();

      animator.destroy();
    });

    it("should emit animationComplete event", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const events: NodeAnimatorEvent[] = [];
      animator.on("animationComplete", (e) => events.push(e));

      animator.animate("node1", { type: "hover", duration: 50 });
      rafMock.advance(10);

      const completeEvents = events.filter((e) => e.type === "animationComplete");
      expect(completeEvents.length).toBe(1);

      animator.destroy();
    });

    it("should allow removing listeners", async () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");

      const events: NodeAnimatorEvent[] = [];
      const listener = (e: NodeAnimatorEvent) => events.push(e);

      animator.on("stateChange", listener);
      animator.off("stateChange", listener);

      animator.animate("node1", { type: "hover", duration: 50 });
      rafMock.advance(5);

      expect(events.length).toBe(0);

      animator.destroy();
    });
  });

  describe("animation queue", () => {
    it("should queue animations when configured", async () => {
      const animator = new NodeAnimator({ queueAnimations: true });
      animator.addNode("node1");

      // First animation
      animator.animate("node1", { type: "hover", duration: 100 });
      rafMock.advance(1);

      // Second animation (should queue)
      const queuedId = animator.animate("node1", { type: "select", duration: 100 });

      // When queuing, returns null immediately
      expect(queuedId).toBeNull();

      animator.destroy();
    });

    it("should interrupt by default (no queue)", async () => {
      const animator = new NodeAnimator(); // queueAnimations: false by default
      animator.addNode("node1");

      animator.animate("node1", { type: "hover", duration: 1000 });
      rafMock.advance(1);

      const secondId = animator.animate("node1", { type: "select", duration: 100 });

      // Should return an ID (interrupting first animation)
      expect(secondId).not.toBeNull();

      animator.destroy();
    });
  });

  describe("destroy", () => {
    it("should clean up resources", () => {
      const animator = new NodeAnimator();
      animator.addNode("node1");
      animator.addNode("node2");

      animator.animate("node1", { type: "hover", duration: 1000 });
      rafMock.advance(2);

      animator.destroy();

      expect(animator.getNodeIds()).toHaveLength(0);
    });
  });
});

// ============================================================
// Factory Functions Tests
// ============================================================

describe("createNodeAnimator", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
  });

  afterEach(() => {
    rafMock.restore();
  });

  it("should create animator instance", () => {
    const animator = createNodeAnimator();

    expect(animator).toBeInstanceOf(NodeAnimator);

    animator.destroy();
  });

  it("should accept custom config", () => {
    const animator = createNodeAnimator({
      queueAnimations: true,
    });

    expect(animator).toBeInstanceOf(NodeAnimator);

    animator.destroy();
  });
});

// ============================================================
// Constants Tests
// ============================================================

describe("DEFAULT_NODE_VISUAL_STATE", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_NODE_VISUAL_STATE.scale).toBe(1);
    expect(DEFAULT_NODE_VISUAL_STATE.opacity).toBe(1);
    expect(DEFAULT_NODE_VISUAL_STATE.glow).toBe(0);
    expect(DEFAULT_NODE_VISUAL_STATE.ringScale).toBe(0);
    expect(DEFAULT_NODE_VISUAL_STATE.ringOpacity).toBe(0);
    expect(DEFAULT_NODE_VISUAL_STATE.colorTint).toBeNull();
    expect(DEFAULT_NODE_VISUAL_STATE.offsetX).toBe(0);
    expect(DEFAULT_NODE_VISUAL_STATE.offsetY).toBe(0);
    expect(DEFAULT_NODE_VISUAL_STATE.rotation).toBe(0);
  });
});

describe("DEFAULT_ANIMATION_DURATIONS", () => {
  it("should have durations for all animation types", () => {
    expect(DEFAULT_ANIMATION_DURATIONS.hover).toBe(150);
    expect(DEFAULT_ANIMATION_DURATIONS.select).toBe(200);
    expect(DEFAULT_ANIMATION_DURATIONS.pulse).toBe(600);
    expect(DEFAULT_ANIMATION_DURATIONS.shake).toBe(400);
    expect(DEFAULT_ANIMATION_DURATIONS.bounce).toBe(500);
  });
});

describe("DEFAULT_ANIMATION_EASINGS", () => {
  it("should have easings for all animation types", () => {
    expect(DEFAULT_ANIMATION_EASINGS.hover).toBe("easeOutCubic");
    expect(DEFAULT_ANIMATION_EASINGS.select).toBe("easeOutBack");
    expect(DEFAULT_ANIMATION_EASINGS.bounce).toBe("easeOutBounce");
  });
});

describe("DEFAULT_NODE_ANIMATOR_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_NODE_ANIMATOR_CONFIG.queueAnimations).toBe(false);
    expect(DEFAULT_NODE_ANIMATOR_CONFIG.durations).toBeDefined();
    expect(DEFAULT_NODE_ANIMATOR_CONFIG.easings).toBeDefined();
  });
});

describe("NODE_VISUAL_PRESETS", () => {
  it("should have hover preset", () => {
    expect(NODE_VISUAL_PRESETS.hover.scale).toBe(1.15);
    expect(NODE_VISUAL_PRESETS.hover.glow).toBe(0.3);
  });

  it("should have selected preset", () => {
    expect(NODE_VISUAL_PRESETS.selected.scale).toBe(1.1);
    expect(NODE_VISUAL_PRESETS.selected.ringScale).toBe(1.3);
    expect(NODE_VISUAL_PRESETS.selected.ringOpacity).toBe(1);
  });

  it("should have focused preset", () => {
    expect(NODE_VISUAL_PRESETS.focused.scale).toBe(1.05);
    expect(NODE_VISUAL_PRESETS.focused.glow).toBe(0.5);
  });

  it("should have highlighted preset", () => {
    expect(NODE_VISUAL_PRESETS.highlighted.glow).toBe(0.8);
    expect(NODE_VISUAL_PRESETS.highlighted.colorTint).toBe("#ffff00");
  });

  it("should have dimmed preset", () => {
    expect(NODE_VISUAL_PRESETS.dimmed.opacity).toBe(0.4);
    expect(NODE_VISUAL_PRESETS.dimmed.scale).toBe(0.95);
  });

  it("should have dragging preset", () => {
    expect(NODE_VISUAL_PRESETS.dragging.scale).toBe(1.2);
    expect(NODE_VISUAL_PRESETS.dragging.opacity).toBe(0.9);
  });
});
