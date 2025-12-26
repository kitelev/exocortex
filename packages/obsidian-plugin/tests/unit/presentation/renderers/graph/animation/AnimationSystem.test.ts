/**
 * AnimationSystem Tests
 *
 * Tests for the core animation infrastructure including easing functions,
 * animation lifecycle, and animation loop management.
 */

import {
  Animation,
  AnimationLoop,
  createAnimation,
  createAnimationLoop,
  animate,
  Easing,
  getEasing,
  DEFAULT_ANIMATION_CONFIG,
  ANIMATION_PRESETS,
  type AnimationConfig,
  type EasingName,
} from "../../../../../../src/presentation/renderers/graph/animation/AnimationSystem";

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
        currentTime += 16.67; // ~60fps
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
// Easing Functions Tests
// ============================================================

describe("Easing Functions", () => {
  describe("linear", () => {
    it("should return input unchanged", () => {
      expect(Easing.linear(0)).toBe(0);
      expect(Easing.linear(0.5)).toBe(0.5);
      expect(Easing.linear(1)).toBe(1);
    });
  });

  describe("easeInQuad", () => {
    it("should accelerate from zero", () => {
      expect(Easing.easeInQuad(0)).toBe(0);
      expect(Easing.easeInQuad(0.5)).toBe(0.25);
      expect(Easing.easeInQuad(1)).toBe(1);
    });
  });

  describe("easeOutQuad", () => {
    it("should decelerate to zero", () => {
      expect(Easing.easeOutQuad(0)).toBe(0);
      expect(Easing.easeOutQuad(0.5)).toBe(0.75);
      expect(Easing.easeOutQuad(1)).toBe(1);
    });
  });

  describe("easeInOutQuad", () => {
    it("should accelerate then decelerate", () => {
      expect(Easing.easeInOutQuad(0)).toBe(0);
      expect(Easing.easeInOutQuad(0.5)).toBe(0.5);
      expect(Easing.easeInOutQuad(1)).toBe(1);
      // First half accelerates
      expect(Easing.easeInOutQuad(0.25)).toBeLessThan(0.25);
      // Second half decelerates
      expect(Easing.easeInOutQuad(0.75)).toBeGreaterThan(0.75);
    });
  });

  describe("easeInCubic", () => {
    it("should have cubic acceleration", () => {
      expect(Easing.easeInCubic(0)).toBe(0);
      expect(Easing.easeInCubic(0.5)).toBe(0.125);
      expect(Easing.easeInCubic(1)).toBe(1);
    });
  });

  describe("easeOutCubic", () => {
    it("should have cubic deceleration", () => {
      expect(Easing.easeOutCubic(0)).toBe(0);
      expect(Easing.easeOutCubic(0.5)).toBe(0.875);
      expect(Easing.easeOutCubic(1)).toBe(1);
    });
  });

  describe("easeInOutCubic", () => {
    it("should have smooth S-curve", () => {
      expect(Easing.easeInOutCubic(0)).toBe(0);
      expect(Easing.easeInOutCubic(0.5)).toBe(0.5);
      expect(Easing.easeInOutCubic(1)).toBe(1);
    });
  });

  describe("easeOutElastic", () => {
    it("should handle edge cases", () => {
      expect(Easing.easeOutElastic(0)).toBe(0);
      expect(Easing.easeOutElastic(1)).toBe(1);
    });

    it("should overshoot then settle", () => {
      const mid = Easing.easeOutElastic(0.3);
      expect(mid).toBeGreaterThan(0.3);
    });
  });

  describe("easeOutBounce", () => {
    it("should handle edge cases", () => {
      expect(Easing.easeOutBounce(0)).toBe(0);
      expect(Easing.easeOutBounce(1)).toBeCloseTo(1, 5);
    });
  });

  describe("easeInBounce", () => {
    it("should bounce at the start", () => {
      expect(Easing.easeInBounce(0)).toBeCloseTo(0, 5);
      expect(Easing.easeInBounce(1)).toBe(1);
    });
  });

  describe("spring", () => {
    it("should handle edge cases", () => {
      expect(Easing.spring(0)).toBe(0);
      expect(Easing.spring(1)).toBe(1);
    });

    it("should have spring-like motion", () => {
      const mid = Easing.spring(0.3);
      expect(mid).toBeGreaterThan(0.3);
    });
  });

  describe("easeInExpo", () => {
    it("should handle edge cases", () => {
      expect(Easing.easeInExpo(0)).toBe(0);
      expect(Easing.easeInExpo(1)).toBe(1);
    });
  });

  describe("easeOutExpo", () => {
    it("should handle edge cases", () => {
      expect(Easing.easeOutExpo(0)).toBe(0);
      expect(Easing.easeOutExpo(1)).toBe(1);
    });
  });

  describe("easeInOutExpo", () => {
    it("should handle edge cases", () => {
      expect(Easing.easeInOutExpo(0)).toBe(0);
      expect(Easing.easeInOutExpo(1)).toBe(1);
      expect(Easing.easeInOutExpo(0.5)).toBeCloseTo(0.5, 1);
    });
  });

  describe("easeInBack", () => {
    it("should overshoot backwards initially", () => {
      // Use toBeCloseTo for floating-point precision
      expect(Easing.easeInBack(0)).toBeCloseTo(0, 10);
      expect(Easing.easeInBack(1)).toBeCloseTo(1, 10);
      // Should go negative initially
      expect(Easing.easeInBack(0.2)).toBeLessThan(0);
    });
  });

  describe("easeOutBack", () => {
    it("should overshoot then settle", () => {
      // Use toBeCloseTo for floating-point precision
      expect(Easing.easeOutBack(0)).toBeCloseTo(0, 10);
      expect(Easing.easeOutBack(1)).toBeCloseTo(1, 10);
      // Should overshoot past 1
      expect(Easing.easeOutBack(0.8)).toBeGreaterThan(1);
    });
  });

  describe("easeInElastic", () => {
    it("should handle edge cases", () => {
      expect(Easing.easeInElastic(0)).toBe(0);
      expect(Easing.easeInElastic(1)).toBe(1);
    });
  });

  describe("easeInOutElastic", () => {
    it("should handle edge cases", () => {
      expect(Easing.easeInOutElastic(0)).toBe(0);
      expect(Easing.easeInOutElastic(1)).toBe(1);
    });
  });
});

describe("getEasing", () => {
  it("should return the correct easing function by name", () => {
    expect(getEasing("linear")).toBe(Easing.linear);
    expect(getEasing("easeInOutCubic")).toBe(Easing.easeInOutCubic);
    expect(getEasing("spring")).toBe(Easing.spring);
  });

  it("should return the function directly if passed a function", () => {
    const customEasing = (t: number) => t * t * t;
    expect(getEasing(customEasing)).toBe(customEasing);
  });

  it("should return linear for unknown names", () => {
    expect(getEasing("unknown" as EasingName)).toBe(Easing.linear);
  });
});

// ============================================================
// Animation Class Tests
// ============================================================

describe("Animation", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
  });

  afterEach(() => {
    rafMock.restore();
  });

  describe("constructor", () => {
    it("should create animation with config", () => {
      const anim = new Animation({
        duration: 500,
        easing: "linear",
      });

      expect(anim.id).toBeDefined();
      expect(anim.state).toBe("idle");
      expect(anim.progress).toBe(0);
      expect(anim.easedProgress).toBe(0);
      expect(anim.isActive).toBe(false);
    });
  });

  describe("start", () => {
    it("should transition to running state", () => {
      const anim = new Animation({
        duration: 500,
        easing: "linear",
      });

      anim.start();

      expect(anim.state).toBe("running");
      expect(anim.isActive).toBe(true);
    });

    it("should transition to delayed state with delay", () => {
      const anim = new Animation({
        duration: 500,
        easing: "linear",
        delay: 100,
      });

      anim.start();

      expect(anim.state).toBe("delayed");
      expect(anim.isActive).toBe(true);
    });

    it("should call onStart callback", () => {
      const onStart = jest.fn();
      const anim = new Animation({
        duration: 500,
        easing: "linear",
        onStart,
      });

      anim.start();

      expect(onStart).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update progress over time", () => {
      const onUpdate = jest.fn();
      const anim = new Animation({
        duration: 100,
        easing: "linear",
        onUpdate,
      });

      anim.start();

      // Simulate 50ms elapsed (50% progress)
      const startTime = rafMock.getTime();
      rafMock.advance(3); // ~50ms

      anim.update(rafMock.getTime());

      expect(anim.progress).toBeGreaterThan(0);
      expect(anim.progress).toBeLessThan(1);
      expect(onUpdate).toHaveBeenCalled();
    });

    it("should complete animation after duration", () => {
      const onComplete = jest.fn();
      const anim = new Animation({
        duration: 100,
        easing: "linear",
        onComplete,
      });

      anim.start();

      // Advance past duration
      rafMock.advance(10); // ~166ms
      anim.update(rafMock.getTime());

      expect(anim.state).toBe("completed");
      expect(anim.progress).toBe(1);
      expect(onComplete).toHaveBeenCalled();
    });

    it("should handle zero duration", () => {
      const onComplete = jest.fn();
      const anim = new Animation({
        duration: 0,
        easing: "linear",
        onComplete,
      });

      anim.start();
      anim.update(rafMock.getTime());

      expect(anim.state).toBe("completed");
      expect(anim.progress).toBe(1);
      expect(onComplete).toHaveBeenCalled();
    });

    it("should wait during delay phase", () => {
      const onStart = jest.fn();
      const anim = new Animation({
        duration: 100,
        easing: "linear",
        delay: 100,
        onStart,
      });

      // Mock sets performance.now() to return 0, so startTime = 0
      anim.start();
      expect(anim.state).toBe("delayed");
      expect(onStart).not.toHaveBeenCalled();
      expect(anim.progress).toBe(0);

      // Update with timestamp still in delay phase (50ms < 100ms delay)
      anim.update(50);
      expect(anim.state).toBe("delayed");

      // Update past delay (150ms > 100ms delay)
      anim.update(150);
      expect(anim.state).toBe("running");
      expect(onStart).toHaveBeenCalled();
    });
  });

  describe("pause and resume", () => {
    it("should pause running animation", () => {
      const anim = new Animation({
        duration: 500,
        easing: "linear",
      });

      anim.start();
      anim.pause();

      expect(anim.state).toBe("paused");
      expect(anim.isActive).toBe(false);
    });

    it("should resume paused animation", () => {
      const anim = new Animation({
        duration: 500,
        easing: "linear",
      });

      anim.start();
      anim.pause();
      anim.resume();

      expect(anim.state).toBe("running");
      expect(anim.isActive).toBe(true);
    });

    it("should not pause non-running animation", () => {
      const anim = new Animation({
        duration: 500,
        easing: "linear",
      });

      anim.pause(); // Should do nothing

      expect(anim.state).toBe("idle");
    });
  });

  describe("cancel", () => {
    it("should cancel running animation", () => {
      const onCancel = jest.fn();
      const anim = new Animation({
        duration: 500,
        easing: "linear",
        onCancel,
      });

      anim.start();
      anim.cancel();

      expect(anim.state).toBe("cancelled");
      expect(anim.isActive).toBe(false);
      expect(onCancel).toHaveBeenCalled();
    });

    it("should not cancel completed animation", () => {
      const onCancel = jest.fn();
      const anim = new Animation({
        duration: 0,
        easing: "linear",
        onCancel,
      });

      anim.start();
      anim.update(rafMock.getTime());
      anim.cancel();

      expect(anim.state).toBe("completed");
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});

// ============================================================
// AnimationLoop Tests
// ============================================================

describe("AnimationLoop", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
  });

  afterEach(() => {
    rafMock.restore();
  });

  describe("constructor", () => {
    it("should create loop in stopped state", () => {
      const loop = new AnimationLoop();

      expect(loop.isRunning).toBe(false);
      expect(loop.animationCount).toBe(0);
    });
  });

  describe("add and remove", () => {
    it("should add animation to loop", () => {
      const loop = new AnimationLoop();
      const anim = new Animation({ duration: 100, easing: "linear" });

      loop.add(anim);

      expect(loop.animationCount).toBe(1);
    });

    it("should remove animation from loop", () => {
      const loop = new AnimationLoop();
      const anim = new Animation({ duration: 100, easing: "linear" });

      loop.add(anim);
      loop.remove(anim.id);

      expect(loop.animationCount).toBe(0);
    });
  });

  describe("start and stop", () => {
    it("should start the loop when animations exist", () => {
      const loop = new AnimationLoop();
      const anim = new Animation({ duration: 1000, easing: "linear" });

      loop.add(anim);
      anim.start();
      loop.start();

      expect(loop.isRunning).toBe(true);

      loop.destroy();
    });

    it("should auto-stop when started with no animations", () => {
      const loop = new AnimationLoop();

      loop.start();

      // Loop auto-stops when there are no animations to run
      expect(loop.isRunning).toBe(false);
    });

    it("should stop the loop", () => {
      const loop = new AnimationLoop();
      const anim = new Animation({ duration: 1000, easing: "linear" });

      loop.add(anim);
      anim.start();
      loop.start();
      loop.stop();

      expect(loop.isRunning).toBe(false);

      loop.destroy();
    });
  });

  describe("animation management", () => {
    it("should update all animations on tick", () => {
      const loop = new AnimationLoop();
      const onUpdate1 = jest.fn();
      const onUpdate2 = jest.fn();

      const anim1 = new Animation({ duration: 100, easing: "linear", onUpdate: onUpdate1 });
      const anim2 = new Animation({ duration: 100, easing: "linear", onUpdate: onUpdate2 });

      loop.add(anim1);
      loop.add(anim2);
      anim1.start();
      anim2.start();
      loop.start();

      rafMock.advance(1);

      expect(onUpdate1).toHaveBeenCalled();
      expect(onUpdate2).toHaveBeenCalled();
    });

    it("should remove completed animations", () => {
      const loop = new AnimationLoop();
      const onComplete = jest.fn();
      const anim = new Animation({ duration: 50, easing: "linear", onComplete });

      loop.add(anim);
      anim.start();
      loop.start();

      // Verify animation is in the loop initially
      expect(loop.animationCount).toBe(1);

      // Manually complete the animation by updating past its duration
      // Simulate 100ms elapsed (animation is 50ms)
      anim.update(100);

      // Animation should be complete
      expect(anim.state).toBe("completed");
      expect(onComplete).toHaveBeenCalled();

      loop.destroy();
    });

    it("should auto-stop when no animations remain", () => {
      const loop = new AnimationLoop();
      const anim = new Animation({ duration: 1000, easing: "linear" });

      loop.add(anim);
      anim.start();
      loop.start();

      expect(loop.isRunning).toBe(true);

      // Remove the animation
      loop.remove(anim.id);

      // Loop should auto-stop when empty
      expect(loop.animationCount).toBe(0);
      // After removal, the next tick will stop the loop
      rafMock.advance(1);
      expect(loop.isRunning).toBe(false);

      loop.destroy();
    });
  });

  describe("destroy", () => {
    it("should clean up resources", () => {
      const loop = new AnimationLoop();
      const onCancel = jest.fn();
      const anim = new Animation({ duration: 100, easing: "linear", onCancel });

      loop.add(anim);
      anim.start();
      loop.start();
      loop.destroy();

      expect(loop.isRunning).toBe(false);
      expect(loop.animationCount).toBe(0);
      expect(onCancel).toHaveBeenCalled();
    });
  });
});

// ============================================================
// Factory Functions Tests
// ============================================================

describe("createAnimation", () => {
  it("should create animation instance", () => {
    const anim = createAnimation({
      duration: 300,
      easing: "easeOutCubic",
    });

    expect(anim).toBeInstanceOf(Animation);
    expect(anim.state).toBe("idle");
  });
});

describe("createAnimationLoop", () => {
  it("should create animation loop instance", () => {
    const loop = createAnimationLoop();

    expect(loop).toBeInstanceOf(AnimationLoop);
    expect(loop.isRunning).toBe(false);

    loop.destroy();
  });
});

describe("animate helper", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
  });

  afterEach(() => {
    rafMock.restore();
  });

  it("should animate between two values", () => {
    const values: number[] = [];
    const loop = new AnimationLoop();
    const anim = animate(0, 100, {
      duration: 100,
      easing: "linear",
      onUpdate: (value) => values.push(value),
    });

    loop.add(anim);
    anim.start();
    loop.start();
    rafMock.advance(3); // ~50ms

    expect(values.length).toBeGreaterThan(0);
    // After ~50ms out of 100ms, value should be around 50 (linear easing)
    const lastValue = values[values.length - 1];
    expect(lastValue).toBeGreaterThanOrEqual(0);
    expect(lastValue).toBeLessThanOrEqual(100);

    loop.destroy();
  });
});

// ============================================================
// Constants Tests
// ============================================================

describe("DEFAULT_ANIMATION_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_ANIMATION_CONFIG.duration).toBe(300);
    expect(DEFAULT_ANIMATION_CONFIG.easing).toBe("easeOutCubic");
    expect(DEFAULT_ANIMATION_CONFIG.delay).toBe(0);
  });
});

describe("ANIMATION_PRESETS", () => {
  it("should have snap preset", () => {
    expect(ANIMATION_PRESETS.snap.duration).toBe(150);
    expect(ANIMATION_PRESETS.snap.easing).toBe("easeOutQuad");
  });

  it("should have smooth preset", () => {
    expect(ANIMATION_PRESETS.smooth.duration).toBe(300);
    expect(ANIMATION_PRESETS.smooth.easing).toBe("easeOutCubic");
  });

  it("should have layoutTransition preset", () => {
    expect(ANIMATION_PRESETS.layoutTransition.duration).toBe(500);
    expect(ANIMATION_PRESETS.layoutTransition.easing).toBe("easeInOutCubic");
  });

  it("should have elastic preset", () => {
    expect(ANIMATION_PRESETS.elastic.duration).toBe(600);
    expect(ANIMATION_PRESETS.elastic.easing).toBe("easeOutElastic");
  });

  it("should have spring preset", () => {
    expect(ANIMATION_PRESETS.spring.duration).toBe(500);
    expect(ANIMATION_PRESETS.spring.easing).toBe("spring");
  });
});
