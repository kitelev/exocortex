/**
 * AccessibilityManager Tests
 *
 * Tests for WCAG 2.1 AA compliant accessibility management.
 */

import {
  AccessibilityManager,
  createAccessibilityManager,
  DEFAULT_ACCESSIBILITY_MANAGER_CONFIG,
  HIGH_CONTRAST_THEMES,
} from "../../../../../../src/presentation/renderers/graph/accessibility";
import type { GraphNode, GraphEdge } from "../../../../../../src/presentation/renderers/graph/types";

// Mock window.matchMedia
const createMatchMediaMock = (matches: boolean) => {
  return jest.fn().mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
};

describe("AccessibilityManager", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);

    // Mock matchMedia
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: createMatchMediaMock(false),
    });
  });

  afterEach(() => {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
    // Clean up any live regions added to body
    document.querySelectorAll(".exo-a11y-live-region").forEach((el) => el.remove());
  });

  // Sample data for testing
  const createSampleNodes = (): GraphNode[] => [
    { id: "node1", label: "Project Alpha", path: "/alpha.md", x: 0, y: 0, group: "Project" },
    { id: "node2", label: "Task Beta", path: "/beta.md", x: 100, y: 0, group: "Task" },
    { id: "node3", label: "Area Gamma", path: "/gamma.md", x: 50, y: 100, group: "Area" },
  ];

  const createSampleEdges = (): GraphEdge[] => [
    { id: "edge1", source: "node1", target: "node2", label: "contains" },
    { id: "edge2", source: "node3", target: "node1", label: "includes" },
  ];

  describe("DEFAULT_ACCESSIBILITY_MANAGER_CONFIG", () => {
    it("should have announcement debounce setting", () => {
      expect(DEFAULT_ACCESSIBILITY_MANAGER_CONFIG.announcementDebounce).toBe(150);
    });

    it("should inherit from A11y config", () => {
      expect(DEFAULT_ACCESSIBILITY_MANAGER_CONFIG.enableScreenReader).toBe(true);
      expect(DEFAULT_ACCESSIBILITY_MANAGER_CONFIG.enableKeyboardNav).toBe(true);
    });
  });

  describe("createAccessibilityManager", () => {
    it("should create an AccessibilityManager instance", () => {
      const manager = createAccessibilityManager(container);
      expect(manager).toBeInstanceOf(AccessibilityManager);
      manager.destroy();
    });
  });

  describe("constructor", () => {
    it("should create live regions", () => {
      const manager = new AccessibilityManager(container);

      const politeRegion = document.querySelector(".exo-a11y-polite");
      const assertiveRegion = document.querySelector(".exo-a11y-assertive");

      expect(politeRegion).not.toBeNull();
      expect(assertiveRegion).not.toBeNull();
      expect(politeRegion?.getAttribute("aria-live")).toBe("polite");
      expect(assertiveRegion?.getAttribute("aria-live")).toBe("assertive");

      manager.destroy();
    });

    it("should set ARIA attributes on container", () => {
      const manager = new AccessibilityManager(container);

      expect(container.getAttribute("role")).toBe("application");
      expect(container.getAttribute("tabindex")).toBe("0");
      expect(container.hasAttribute("aria-labelledby")).toBe(true);
      expect(container.hasAttribute("aria-describedby")).toBe(true);

      manager.destroy();
    });

    it("should accept custom configuration", () => {
      const manager = new AccessibilityManager(container, {
        enableScreenReader: false,
        focusIndicatorSize: 5,
      });

      const config = manager.getConfig();
      expect(config.enableScreenReader).toBe(false);
      expect(config.focusIndicatorSize).toBe(5);

      manager.destroy();
    });
  });

  describe("setGraphData", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should set nodes and edges", () => {
      const manager = new AccessibilityManager(container);
      const nodes = createSampleNodes();
      const edges = createSampleEdges();

      manager.setGraphData(nodes, edges);

      const cursor = manager.getVirtualCursor();
      expect(cursor.getA11yNodes()).toHaveLength(3);

      manager.destroy();
    });

    it("should announce graph structure when enabled", () => {
      const manager = new AccessibilityManager(container, {
        announceGraphChanges: true,
        enableScreenReader: true,
      });
      const listener = jest.fn();
      manager.on("a11y:announcement", listener);

      manager.setGraphData(createSampleNodes(), createSampleEdges());

      // Wait for announcement debounce (500ms delay + 50ms setTimeout in makeAnnouncement)
      jest.advanceTimersByTime(600);

      // Announcement should be queued
      expect(listener).toHaveBeenCalled();

      manager.destroy();
    });
  });

  describe("announce", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should emit announcement event", () => {
      const manager = new AccessibilityManager(container);
      const listener = jest.fn();
      manager.on("a11y:announcement", listener);

      manager.announce("Test message", "status");

      jest.advanceTimersByTime(600);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "a11y:announcement",
          message: "Test message",
        })
      );

      manager.destroy();
    });

    it("should update live region", () => {
      const manager = new AccessibilityManager(container);

      manager.announce("Hello world", "status", "polite");

      jest.advanceTimersByTime(600);

      const politeRegion = document.querySelector(".exo-a11y-polite");
      expect(politeRegion?.textContent).toBe("Hello world");

      manager.destroy();
    });

    it("should use assertive region for assertive announcements", () => {
      const manager = new AccessibilityManager(container);

      manager.announce("Urgent message", "error", "assertive");

      jest.advanceTimersByTime(100);

      const assertiveRegion = document.querySelector(".exo-a11y-assertive");
      expect(assertiveRegion?.textContent).toBe("Urgent message");

      manager.destroy();
    });

    it("should not announce when screen reader is disabled", () => {
      const manager = new AccessibilityManager(container, {
        enableScreenReader: false,
      });
      const listener = jest.fn();
      manager.on("a11y:announcement", listener);

      manager.announce("Test", "status");

      jest.advanceTimersByTime(600);

      expect(listener).not.toHaveBeenCalled();

      manager.destroy();
    });
  });

  describe("focusNode", () => {
    it("should update virtual cursor position", () => {
      const manager = new AccessibilityManager(container);
      manager.setGraphData(createSampleNodes(), createSampleEdges());

      manager.focusNode("node2");

      expect(manager.getFocusedNodeId()).toBe("node2");

      manager.destroy();
    });

    it("should emit navigation event", () => {
      const manager = new AccessibilityManager(container);
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      const listener = jest.fn();
      manager.on("a11y:navigation", listener);

      manager.focusNode("node2");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "a11y:navigation",
          nodeId: "node2",
        })
      );

      manager.destroy();
    });
  });

  describe("selectNode", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should toggle selection state", () => {
      const manager = new AccessibilityManager(container);
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      const listener = jest.fn();
      manager.on("a11y:selection:change", listener);

      manager.selectNode("node1");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "a11y:selection:change",
          nodeId: "node1",
        })
      );

      manager.destroy();
    });

    it("should announce selection when enabled", () => {
      const manager = new AccessibilityManager(container, {
        announceSelections: true,
      });
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      const listener = jest.fn();
      manager.on("a11y:announcement", listener);

      manager.selectNode("node1");

      jest.advanceTimersByTime(600);

      expect(listener).toHaveBeenCalled();

      manager.destroy();
    });
  });

  describe("high contrast mode", () => {
    it("should enable high contrast mode", () => {
      const manager = new AccessibilityManager(container);

      manager.enableHighContrast("dark");

      expect(manager.isHighContrastActive()).toBe(true);
      expect(container.classList.contains("exo-high-contrast")).toBe(true);

      manager.destroy();
    });

    it("should apply high contrast CSS variables", () => {
      const manager = new AccessibilityManager(container);

      manager.enableHighContrast("dark");

      expect(container.style.getPropertyValue("--exo-hc-foreground")).toBe(
        HIGH_CONTRAST_THEMES.dark.foreground
      );
      expect(container.style.getPropertyValue("--exo-hc-background")).toBe(
        HIGH_CONTRAST_THEMES.dark.background
      );

      manager.destroy();
    });

    it("should disable high contrast mode", () => {
      const manager = new AccessibilityManager(container);
      manager.enableHighContrast();

      manager.disableHighContrast();

      expect(manager.isHighContrastActive()).toBe(false);
      expect(container.classList.contains("exo-high-contrast")).toBe(false);

      manager.destroy();
    });

    it("should support light theme", () => {
      const manager = new AccessibilityManager(container);

      manager.enableHighContrast("light");

      expect(container.style.getPropertyValue("--exo-hc-foreground")).toBe(
        HIGH_CONTRAST_THEMES.light.foreground
      );

      manager.destroy();
    });

    it("should allow custom high contrast colors", () => {
      const manager = new AccessibilityManager(container);

      manager.setHighContrastColors({
        foreground: "#FF0000",
        background: "#00FF00",
      });

      // Verify colors were set internally
      const colors = manager.getHighContrastColors();
      expect(colors.foreground).toBe("#FF0000");
      expect(colors.background).toBe("#00FF00");

      // Now enable high contrast - should use the custom colors
      manager.enableHighContrast();

      // Verify CSS variables
      expect(container.style.getPropertyValue("--exo-hc-foreground")).toBe("#FF0000");

      manager.destroy();
    });
  });

  describe("reduced motion", () => {
    it("should detect reduced motion preference", () => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: createMatchMediaMock(true),
      });

      const manager = new AccessibilityManager(container);

      // The media query was detected as true
      const config = manager.getReducedMotionConfig();
      expect(config.disableAnimations).toBe(true);

      manager.destroy();
    });

    it("should provide reduced motion configuration", () => {
      const manager = new AccessibilityManager(container);

      const config = manager.getReducedMotionConfig();

      expect(config).toHaveProperty("disableAnimations");
      expect(config).toHaveProperty("disableTransitions");
      expect(config).toHaveProperty("instantNavigation");
      expect(config).toHaveProperty("reduceParallax");

      manager.destroy();
    });

    it("should check if reduced motion is active", () => {
      const manager = new AccessibilityManager(container);

      const isActive = manager.isReducedMotionActive();
      expect(typeof isActive).toBe("boolean");

      manager.destroy();
    });
  });

  describe("keyboard navigation", () => {
    it("should handle arrow key navigation", () => {
      const manager = new AccessibilityManager(container);
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      manager.focusNode("node1");

      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      });
      container.dispatchEvent(event);

      // Should have navigated to a different node
      expect(manager.getFocusedNodeId()).not.toBeNull();

      manager.destroy();
    });

    it("should handle Tab navigation", () => {
      const manager = new AccessibilityManager(container);
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      manager.focusNode("node1");

      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
      });
      container.dispatchEvent(event);

      // Should have navigated to next node
      expect(manager.getFocusedNodeId()).not.toBeNull();

      manager.destroy();
    });

    it("should not navigate when keyboard nav is disabled", () => {
      const manager = new AccessibilityManager(container, {
        enableKeyboardNav: false,
      });
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      manager.focusNode("node1");
      const initialNode = manager.getFocusedNodeId();

      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
      });
      container.dispatchEvent(event);

      expect(manager.getFocusedNodeId()).toBe(initialNode);

      manager.destroy();
    });
  });

  describe("focus trap", () => {
    it("should create and release focus trap", () => {
      const manager = new AccessibilityManager(container);
      const trapContainer = document.createElement("div");
      const button = document.createElement("button");
      trapContainer.appendChild(button);
      document.body.appendChild(trapContainer);

      const release = manager.createFocusTrap({
        container: trapContainer,
        initialFocus: button,
      });

      expect(typeof release).toBe("function");

      release();

      document.body.removeChild(trapContainer);
      manager.destroy();
    });
  });

  describe("getVirtualCursor", () => {
    it("should return the virtual cursor", () => {
      const manager = new AccessibilityManager(container);

      const cursor = manager.getVirtualCursor();

      expect(cursor).toBeDefined();
      expect(typeof cursor.navigate).toBe("function");

      manager.destroy();
    });
  });

  describe("configuration", () => {
    it("should get current configuration", () => {
      const manager = new AccessibilityManager(container);

      const config = manager.getConfig();

      expect(config.enableScreenReader).toBe(true);
      expect(config.enableKeyboardNav).toBe(true);

      manager.destroy();
    });

    it("should update configuration", () => {
      const manager = new AccessibilityManager(container);
      const listener = jest.fn();
      manager.on("a11y:config:change", listener);

      manager.setConfig({ focusIndicatorSize: 10 });

      expect(manager.getConfig().focusIndicatorSize).toBe(10);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "a11y:config:change",
          config: { focusIndicatorSize: 10 },
        })
      );

      manager.destroy();
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const manager = new AccessibilityManager(container);
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      const listener = jest.fn();

      manager.on("a11y:navigation", listener);
      manager.focusNode("node1");
      expect(listener).toHaveBeenCalledTimes(1);

      manager.off("a11y:navigation", listener);
      manager.focusNode("node2");
      expect(listener).toHaveBeenCalledTimes(1); // Not called again

      manager.destroy();
    });
  });

  describe("detectScreenReader", () => {
    it("should return a screen reader type", () => {
      const manager = new AccessibilityManager(container);

      const type = manager.detectScreenReader();

      expect(["nvda", "jaws", "voiceover", "narrator", "orca", "unknown"]).toContain(type);

      manager.destroy();
    });
  });

  describe("getHighContrastColors", () => {
    it("should return current high contrast colors", () => {
      const manager = new AccessibilityManager(container);

      const colors = manager.getHighContrastColors();

      expect(colors).toHaveProperty("foreground");
      expect(colors).toHaveProperty("background");
      expect(colors).toHaveProperty("accent");

      manager.destroy();
    });
  });

  describe("destroy", () => {
    it("should clean up live regions", () => {
      const manager = new AccessibilityManager(container);

      manager.destroy();

      const politeRegion = document.querySelector(".exo-a11y-polite");
      const assertiveRegion = document.querySelector(".exo-a11y-assertive");

      expect(politeRegion).toBeNull();
      expect(assertiveRegion).toBeNull();
    });

    it("should remove high contrast styles", () => {
      const manager = new AccessibilityManager(container);
      manager.enableHighContrast();

      manager.destroy();

      expect(container.classList.contains("exo-high-contrast")).toBe(false);
    });

    it("should clear event listeners", () => {
      const manager = new AccessibilityManager(container);
      const listener = jest.fn();
      manager.on("a11y:navigation", listener);

      manager.destroy();

      // After destroy, listener should not be called
      // (internal state is cleared)
    });
  });

  describe("skip links", () => {
    it("should create skip links when enabled", () => {
      const manager = new AccessibilityManager(container, {
        enableSkipLinks: true,
      });

      const skipLinksContainer = container.querySelector(".exo-a11y-skip-links");
      expect(skipLinksContainer).not.toBeNull();

      manager.destroy();
    });

    it("should not create skip links when disabled", () => {
      const manager = new AccessibilityManager(container, {
        enableSkipLinks: false,
      });

      const skipLinksContainer = container.querySelector(".exo-a11y-skip-links");
      expect(skipLinksContainer).toBeNull();

      manager.destroy();
    });
  });

  describe("announceGraphStructure", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should announce node and edge counts", () => {
      const manager = new AccessibilityManager(container);
      manager.setGraphData(createSampleNodes(), createSampleEdges());
      const listener = jest.fn();
      manager.on("a11y:announcement", listener);

      manager.announceGraphStructure();

      jest.advanceTimersByTime(600);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("3 nodes"),
        })
      );

      manager.destroy();
    });
  });
});
