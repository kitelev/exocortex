/**
 * TouchGestureManager Tests
 *
 * Tests for mobile touch gesture handling in 3D graph visualization.
 * Uses direct method invocation since jsdom doesn't fully support TouchEvent.
 *
 * @module tests/presentation/renderers/graph/3d
 */

import {
  TouchGestureManager,
  createTouchGestureManager,
  DEFAULT_TOUCH_GESTURE_CONFIG,
  type TouchGestureConfig,
} from "../../../../../../src/presentation/renderers/graph/3d/TouchGestureManager";

// Mock element with getBoundingClientRect
function createMockElement(): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = jest.fn().mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return element;
}

describe("TouchGestureManager", () => {
  let element: HTMLElement;
  let manager: TouchGestureManager;

  beforeEach(() => {
    element = createMockElement();
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
    }
    jest.useRealTimers();
  });

  describe("initialization", () => {
    it("should create with default config", () => {
      manager = new TouchGestureManager(element);
      const config = manager.getConfig();

      expect(config.tapThreshold).toBe(DEFAULT_TOUCH_GESTURE_CONFIG.tapThreshold);
      expect(config.tapTimeout).toBe(DEFAULT_TOUCH_GESTURE_CONFIG.tapTimeout);
      expect(config.longPressTimeout).toBe(DEFAULT_TOUCH_GESTURE_CONFIG.longPressTimeout);
      expect(config.enableHapticFeedback).toBe(DEFAULT_TOUCH_GESTURE_CONFIG.enableHapticFeedback);
      expect(config.enableDoubleTap).toBe(DEFAULT_TOUCH_GESTURE_CONFIG.enableDoubleTap);
      expect(config.doubleTapTimeout).toBe(DEFAULT_TOUCH_GESTURE_CONFIG.doubleTapTimeout);
    });

    it("should accept custom config", () => {
      const customConfig: Partial<TouchGestureConfig> = {
        tapThreshold: 20,
        longPressTimeout: 1000,
        enableHapticFeedback: false,
      };

      manager = new TouchGestureManager(element, customConfig);
      const config = manager.getConfig();

      expect(config.tapThreshold).toBe(20);
      expect(config.longPressTimeout).toBe(1000);
      expect(config.enableHapticFeedback).toBe(false);
      expect(config.tapTimeout).toBe(DEFAULT_TOUCH_GESTURE_CONFIG.tapTimeout); // unchanged
    });

    it("should use factory function", () => {
      manager = createTouchGestureManager(element, { tapThreshold: 15 });
      expect(manager.getConfig().tapThreshold).toBe(15);
    });

    it("should have default tap threshold of 10 pixels", () => {
      expect(DEFAULT_TOUCH_GESTURE_CONFIG.tapThreshold).toBe(10);
    });

    it("should have default tap timeout of 300ms", () => {
      expect(DEFAULT_TOUCH_GESTURE_CONFIG.tapTimeout).toBe(300);
    });

    it("should have default long press timeout of 500ms", () => {
      expect(DEFAULT_TOUCH_GESTURE_CONFIG.longPressTimeout).toBe(500);
    });

    it("should have default double tap timeout of 300ms", () => {
      expect(DEFAULT_TOUCH_GESTURE_CONFIG.doubleTapTimeout).toBe(300);
    });

    it("should enable haptic feedback by default", () => {
      expect(DEFAULT_TOUCH_GESTURE_CONFIG.enableHapticFeedback).toBe(true);
    });

    it("should enable double tap by default", () => {
      expect(DEFAULT_TOUCH_GESTURE_CONFIG.enableDoubleTap).toBe(true);
    });
  });

  describe("configuration updates", () => {
    it("should update config at runtime", () => {
      manager = new TouchGestureManager(element);
      expect(manager.getConfig().tapThreshold).toBe(10);

      manager.setConfig({ tapThreshold: 25 });
      expect(manager.getConfig().tapThreshold).toBe(25);
    });

    it("should preserve other config values when updating one value", () => {
      manager = new TouchGestureManager(element, {
        tapThreshold: 15,
        longPressTimeout: 600,
      });

      manager.setConfig({ tapThreshold: 20 });

      expect(manager.getConfig().tapThreshold).toBe(20);
      expect(manager.getConfig().longPressTimeout).toBe(600);
    });
  });

  describe("touch device detection", () => {
    it("should detect touch capability", () => {
      // Note: In jsdom, this will be based on navigator.maxTouchPoints
      const result = TouchGestureManager.isTouchDevice();
      expect(typeof result).toBe("boolean");
    });

    it("should return consistent result", () => {
      // Multiple calls should return the same result
      const result1 = TouchGestureManager.isTouchDevice();
      const result2 = TouchGestureManager.isTouchDevice();
      expect(result1).toBe(result2);
    });
  });

  describe("event listener management", () => {
    it("should allow adding event listeners", () => {
      manager = new TouchGestureManager(element);
      const handler = jest.fn();

      // Should not throw
      expect(() => manager.on("tap", handler)).not.toThrow();
    });

    it("should allow removing event listeners", () => {
      manager = new TouchGestureManager(element);
      const handler = jest.fn();

      manager.on("tap", handler);
      // Should not throw
      expect(() => manager.off("tap", handler)).not.toThrow();
    });

    it("should support all event types", () => {
      manager = new TouchGestureManager(element);
      const handler = jest.fn();

      // Should not throw for any event type
      expect(() => manager.on("tap", handler)).not.toThrow();
      expect(() => manager.on("doubleTap", handler)).not.toThrow();
      expect(() => manager.on("longPress", handler)).not.toThrow();
      expect(() => manager.on("touchStart", handler)).not.toThrow();
      expect(() => manager.on("touchMove", handler)).not.toThrow();
      expect(() => manager.on("touchEnd", handler)).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should clean up on destroy", () => {
      manager = new TouchGestureManager(element);

      // Should not throw
      expect(() => manager.destroy()).not.toThrow();
    });

    it("should allow multiple destroy calls", () => {
      manager = new TouchGestureManager(element);

      manager.destroy();
      // Second call should not throw
      expect(() => manager.destroy()).not.toThrow();
    });
  });

  describe("configuration defaults validation", () => {
    it("should have valid default config values", () => {
      const config = DEFAULT_TOUCH_GESTURE_CONFIG;

      // Tap threshold should be reasonable (5-20 pixels typical)
      expect(config.tapThreshold).toBeGreaterThanOrEqual(5);
      expect(config.tapThreshold).toBeLessThanOrEqual(20);

      // Tap timeout should be reasonable (100-500ms typical)
      expect(config.tapTimeout).toBeGreaterThanOrEqual(100);
      expect(config.tapTimeout).toBeLessThanOrEqual(500);

      // Long press should be longer than tap timeout
      expect(config.longPressTimeout).toBeGreaterThan(config.tapTimeout);

      // Double tap should be similar to tap timeout
      expect(config.doubleTapTimeout).toBeGreaterThanOrEqual(200);
      expect(config.doubleTapTimeout).toBeLessThanOrEqual(500);
    });

    it("should have WCAG-friendly defaults", () => {
      const config = DEFAULT_TOUCH_GESTURE_CONFIG;

      // Tap threshold of 10px is reasonable for touch
      expect(config.tapThreshold).toBe(10);

      // Long press of 500ms follows platform conventions
      expect(config.longPressTimeout).toBe(500);
    });
  });

  describe("factory function", () => {
    it("should create manager with factory function", () => {
      const factoryManager = createTouchGestureManager(element);
      expect(factoryManager).toBeInstanceOf(TouchGestureManager);
      factoryManager.destroy();
    });

    it("should pass config to factory function", () => {
      const customConfig: Partial<TouchGestureConfig> = {
        tapThreshold: 30,
        enableDoubleTap: false,
      };

      const factoryManager = createTouchGestureManager(element, customConfig);
      expect(factoryManager.getConfig().tapThreshold).toBe(30);
      expect(factoryManager.getConfig().enableDoubleTap).toBe(false);
      factoryManager.destroy();
    });
  });
});
