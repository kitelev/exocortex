/**
 * Tests for FocusIndicator - Visual feedback for keyboard focus state
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  FocusIndicator,
  DEFAULT_FOCUS_INDICATOR_CONFIG,
  DEFAULT_FOCUS_INDICATOR_STYLE,
  type FocusIndicatorConfig,
  type FocusIndicatorStyle,
  type FocusIndicatorRenderData,
  type FocusEvent,
} from "../../../../../src/presentation/renderers/graph/FocusIndicator";
import type { GraphNode } from "../../../../../src/presentation/renderers/graph/types";

// Mock requestAnimationFrame
const mockRequestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
  return 1;
});

const mockCancelAnimationFrame = jest.fn();

// Mock DOM for ARIA live region
const mockLiveRegion = {
  setAttribute: jest.fn(),
  style: { cssText: "" },
  textContent: "",
  parentNode: {
    removeChild: jest.fn(),
  },
};

beforeAll(() => {
  global.requestAnimationFrame = mockRequestAnimationFrame as unknown as typeof requestAnimationFrame;
  global.cancelAnimationFrame = mockCancelAnimationFrame;

  // Mock document.createElement for live region
  jest.spyOn(document, "createElement").mockReturnValue(mockLiveRegion as unknown as HTMLDivElement);
  jest.spyOn(document.body, "appendChild").mockImplementation(() => mockLiveRegion as unknown as HTMLElement);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// Create mock graph node
function createMockNode(id: string, x = 0, y = 0): GraphNode {
  return {
    id,
    label: `Node ${id}`,
    path: `/${id}.md`,
    x,
    y,
    size: 8,
  };
}

describe("FocusIndicator", () => {
  let focus: FocusIndicator;

  beforeEach(() => {
    jest.clearAllMocks();
    focus = new FocusIndicator({ enableAnnouncements: false });
  });

  afterEach(() => {
    focus.destroy();
  });

  describe("initialization", () => {
    it("should initialize with default config", () => {
      const config = focus.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.keyboardOnly).toBe(true);
      expect(config.enableAnnouncements).toBe(false); // We disabled it
    });

    it("should initialize with default style", () => {
      const style = focus.getStyle();
      expect(style.color).toBe("#4a90d9");
      expect(style.thickness).toBe(3);
      expect(style.offset).toBe(4);
      expect(style.enablePulse).toBe(true);
      expect(style.pulseDuration).toBe(1000);
      expect(style.enableGlow).toBe(true);
      expect(style.highContrast).toBe(false);
    });

    it("should accept custom config", () => {
      focus.destroy();
      focus = new FocusIndicator({
        enabled: false,
        keyboardOnly: false,
        enableAnnouncements: false,
      });

      const config = focus.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.keyboardOnly).toBe(false);
    });

    it("should accept custom style", () => {
      focus.destroy();
      focus = new FocusIndicator({
        enableAnnouncements: false,
        style: {
          color: "#ff0000",
          thickness: 5,
        },
      });

      const style = focus.getStyle();
      expect(style.color).toBe("#ff0000");
      expect(style.thickness).toBe(5);
    });

    it("should start with no focused node", () => {
      expect(focus.getFocusedNodeId()).toBeNull();
      expect(focus.getFocusedNode()).toBeNull();
    });
  });

  describe("DEFAULT_FOCUS_INDICATOR_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_FOCUS_INDICATOR_CONFIG.enabled).toBe(true);
      expect(DEFAULT_FOCUS_INDICATOR_CONFIG.keyboardOnly).toBe(true);
      expect(DEFAULT_FOCUS_INDICATOR_CONFIG.enableAnnouncements).toBe(true);
      expect(DEFAULT_FOCUS_INDICATOR_CONFIG.announcementTemplate).toBe("Focused on {label}");
    });
  });

  describe("DEFAULT_FOCUS_INDICATOR_STYLE", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.color).toBe("#4a90d9");
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.thickness).toBe(3);
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.offset).toBe(4);
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.enablePulse).toBe(true);
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.pulseDuration).toBe(1000);
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.enableGlow).toBe(true);
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.glowRadius).toBe(8);
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.highContrast).toBe(false);
      expect(DEFAULT_FOCUS_INDICATOR_STYLE.opacity).toBe(1);
    });
  });

  describe("focus management", () => {
    it("should set focused node", () => {
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      expect(focus.getFocusedNodeId()).toBe("node-1");
      expect(focus.getFocusedNode()).toEqual(node);
    });

    it("should clear focused node with null", () => {
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);
      focus.setFocusedNode(null);

      expect(focus.getFocusedNodeId()).toBeNull();
      expect(focus.getFocusedNode()).toBeNull();
    });

    it("should check if node is focused", () => {
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      expect(focus.isNodeFocused("node-1")).toBe(true);
      expect(focus.isNodeFocused("node-2")).toBe(false);
    });

    it("should not re-emit when setting same node", () => {
      const listener = jest.fn();
      focus.on("focus:gained", listener);

      const node = createMockNode("node-1");
      focus.setFocusedNode(node);
      focus.setFocusedNode(node);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("keyboard navigation mode", () => {
    it("should track keyboard navigation mode", () => {
      focus.setKeyboardNavigation(true);
      // Internal state, tested through shouldShowIndicator
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);
      expect(focus.shouldShowIndicator()).toBe(true);
    });

    it("should not show indicator when not using keyboard (keyboardOnly mode)", () => {
      focus.setKeyboardNavigation(false);
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      expect(focus.shouldShowIndicator()).toBe(false);
    });

    it("should show indicator when keyboardOnly is false", () => {
      focus.setConfig({ keyboardOnly: false });
      focus.setKeyboardNavigation(false);
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      expect(focus.shouldShowIndicator()).toBe(true);
    });
  });

  describe("render data", () => {
    beforeEach(() => {
      focus.setKeyboardNavigation(true);
    });

    it("should return null when no focus", () => {
      const renderData = focus.getRenderData(8);
      expect(renderData).toBeNull();
    });

    it("should return null when disabled", () => {
      focus.disable();
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      const renderData = focus.getRenderData(8);
      expect(renderData).toBeNull();
    });

    it("should return render data when focused", () => {
      const node = createMockNode("node-1", 100, 200);
      focus.setFocusedNode(node);

      const renderData = focus.getRenderData(10);
      expect(renderData).not.toBeNull();
      expect(renderData?.nodeId).toBe("node-1");
      expect(renderData?.x).toBe(100);
      expect(renderData?.y).toBe(200);
      expect(renderData?.nodeRadius).toBe(10);
      expect(renderData?.ringRadius).toBeGreaterThan(10);
    });

    it("should use node size as default radius", () => {
      const node = createMockNode("node-1", 0, 0);
      node.size = 12;
      focus.setFocusedNode(node);

      const renderData = focus.getRenderData();
      expect(renderData?.nodeRadius).toBe(12);
    });

    it("should calculate ring radius with offset", () => {
      // Disable pulse to avoid animation affecting scale
      focus.setStyle({ offset: 5, enablePulse: false });
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      const renderData = focus.getRenderData(10);
      expect(renderData?.ringRadius).toBe(15); // 10 + 5
    });

    it("should include glow data when enabled", () => {
      focus.setStyle({ enableGlow: true, glowRadius: 10 });
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      const renderData = focus.getRenderData(8);
      expect(renderData?.showGlow).toBe(true);
      expect(renderData?.glowRadius).toBe(10);
    });

    it("should not include glow in high contrast mode", () => {
      focus.setStyle({ enableGlow: true, highContrast: true });
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      const renderData = focus.getRenderData(8);
      expect(renderData?.showGlow).toBe(false);
    });

    it("should have thicker ring in high contrast mode", () => {
      focus.setStyle({ highContrast: true, thickness: 3 });
      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      const renderData = focus.getRenderData(8);
      expect(renderData?.thickness).toBe(4.5); // 3 * 1.5
    });
  });

  describe("node position updates", () => {
    it("should update node position", () => {
      const node = createMockNode("node-1", 0, 0);
      focus.setFocusedNode(node);
      focus.setKeyboardNavigation(true);

      focus.updateNodePosition(100, 200);

      const renderData = focus.getRenderData(8);
      expect(renderData?.x).toBe(100);
      expect(renderData?.y).toBe(200);
    });

    it("should update node data", () => {
      const node = createMockNode("node-1", 0, 0);
      focus.setFocusedNode(node);

      const updatedNode = { ...node, label: "Updated Label", x: 50, y: 60 };
      focus.updateNode(updatedNode);
      focus.setKeyboardNavigation(true);

      const renderData = focus.getRenderData(8);
      expect(renderData?.x).toBe(50);
      expect(renderData?.y).toBe(60);
    });

    it("should not update if different node id", () => {
      const node = createMockNode("node-1", 0, 0);
      focus.setFocusedNode(node);

      const otherNode = createMockNode("node-2", 100, 100);
      focus.updateNode(otherNode);
      focus.setKeyboardNavigation(true);

      const renderData = focus.getRenderData(8);
      expect(renderData?.x).toBe(0);
      expect(renderData?.y).toBe(0);
    });
  });

  describe("events", () => {
    it("should emit focus:gained event", () => {
      const listener = jest.fn();
      focus.on("focus:gained", listener);

      const node = createMockNode("node-1");
      focus.setFocusedNode(node);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as FocusEvent;
      expect(event.type).toBe("focus:gained");
      expect(event.nodeId).toBe("node-1");
      expect(event.previousNodeId).toBeNull();
    });

    it("should emit focus:lost event", () => {
      const listener = jest.fn();
      focus.on("focus:lost", listener);

      const node = createMockNode("node-1");
      focus.setFocusedNode(node);
      focus.setFocusedNode(null);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as FocusEvent;
      expect(event.type).toBe("focus:lost");
      expect(event.nodeId).toBeNull();
      expect(event.previousNodeId).toBe("node-1");
    });

    it("should track previous node id", () => {
      const listener = jest.fn();
      focus.on("focus:gained", listener);

      focus.setFocusedNode(createMockNode("node-1"));
      focus.setFocusedNode(createMockNode("node-2"));

      expect(listener).toHaveBeenCalledTimes(2);
      const event = listener.mock.calls[1][0] as FocusEvent;
      expect(event.previousNodeId).toBe("node-1");
    });

    it("should remove event listener", () => {
      const listener = jest.fn();
      focus.on("focus:gained", listener);
      focus.off("focus:gained", listener);

      focus.setFocusedNode(createMockNode("node-1"));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("high contrast mode", () => {
    it("should enable high contrast mode", () => {
      focus.enableHighContrast();

      const style = focus.getStyle();
      expect(style.highContrast).toBe(true);
      expect(style.enablePulse).toBe(false);
      expect(style.enableGlow).toBe(false);
    });

    it("should disable high contrast mode", () => {
      focus.enableHighContrast();
      focus.disableHighContrast();

      const style = focus.getStyle();
      expect(style.highContrast).toBe(false);
      expect(style.enablePulse).toBe(true);
      expect(style.enableGlow).toBe(true);
    });
  });

  describe("enable/disable", () => {
    it("should check if enabled", () => {
      expect(focus.isEnabled()).toBe(true);
    });

    it("should disable focus indicator", () => {
      focus.disable();
      expect(focus.isEnabled()).toBe(false);
    });

    it("should enable focus indicator", () => {
      focus.disable();
      focus.enable();
      expect(focus.isEnabled()).toBe(true);
    });
  });

  describe("configuration", () => {
    it("should update config", () => {
      focus.setConfig({ keyboardOnly: false, enableAnnouncements: false });

      const config = focus.getConfig();
      expect(config.keyboardOnly).toBe(false);
    });

    it("should update style", () => {
      focus.setStyle({ color: "#00ff00", thickness: 5 });

      const style = focus.getStyle();
      expect(style.color).toBe("#00ff00");
      expect(style.thickness).toBe(5);
    });
  });

  describe("ARIA announcements", () => {
    it("should create live region when announcements enabled", () => {
      focus.destroy();
      const createElementSpy = jest.spyOn(document, "createElement");
      focus = new FocusIndicator({ enableAnnouncements: true });

      expect(createElementSpy).toHaveBeenCalledWith("div");
    });

    it("should emit focus:announced event", () => {
      focus.destroy();
      focus = new FocusIndicator({ enableAnnouncements: true });

      const listener = jest.fn();
      focus.on("focus:announced", listener);

      focus.setFocusedNode(createMockNode("node-1"));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as FocusEvent;
      expect(event.type).toBe("focus:announced");
      expect(event.announcement).toBe("Focused on Node node-1");
    });
  });

  describe("destroy", () => {
    it("should cleanup on destroy", () => {
      focus.setFocusedNode(createMockNode("node-1"));

      focus.destroy();

      expect(focus.getFocusedNodeId()).toBeNull();
    });

    it("should remove live region on destroy", () => {
      focus.destroy();

      // Create a fresh mock with proper parentNode reference
      const localMockLiveRegion = {
        setAttribute: jest.fn(),
        style: { cssText: "" },
        textContent: "",
        className: "",
        parentNode: null as { removeChild: jest.Mock } | null,
      };

      // After appendChild, the parentNode should be set
      jest.spyOn(document, "createElement").mockReturnValue(localMockLiveRegion as unknown as HTMLDivElement);
      jest.spyOn(document.body, "appendChild").mockImplementation((node) => {
        // Simulate that after appendChild, the node has document.body as parentNode
        (node as typeof localMockLiveRegion).parentNode = {
          removeChild: jest.fn().mockReturnValue(node),
        };
        return node as HTMLElement;
      });

      focus = new FocusIndicator({ enableAnnouncements: true });
      focus.destroy();

      expect(localMockLiveRegion.parentNode?.removeChild).toHaveBeenCalled();
    });
  });
});
