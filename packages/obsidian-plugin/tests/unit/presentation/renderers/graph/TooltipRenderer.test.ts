/**
 * Tests for TooltipRenderer - Rich tooltip rendering for graph nodes and edges
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  TooltipRenderer,
  DEFAULT_TOOLTIP_RENDERER_CONFIG,
  type TooltipRendererConfig,
} from "../../../../../src/presentation/renderers/graph/TooltipRenderer";
import type { TooltipData, Point, NodeType } from "../../../../../src/presentation/renderers/graph/HoverManager";

// Create mock tooltip data
function createMockTooltipData(overrides: Partial<TooltipData> = {}): TooltipData {
  return {
    id: "test-node",
    title: "Test Node Title",
    type: "task",
    properties: [
      { name: "Status", value: "Active" },
      { name: "Priority", value: "High" },
    ],
    incomingCount: 2,
    outgoingCount: 3,
    ...overrides,
  };
}

describe("TooltipRenderer", () => {
  let renderer: TooltipRenderer;
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a container element
    container = document.createElement("div");
    container.style.width = "1000px";
    container.style.height = "800px";
    document.body.appendChild(container);

    // Mock window dimensions
    Object.defineProperty(window, "innerWidth", { value: 1000, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, writable: true });

    renderer = new TooltipRenderer();
    renderer.mount(container);
  });

  afterEach(() => {
    renderer.destroy();
    document.body.removeChild(container);
  });

  describe("initialization", () => {
    it("should create tooltip element on mount", () => {
      const tooltip = container.querySelector(".exo-graph-tooltip");
      expect(tooltip).toBeTruthy();
    });

    it("should use default config", () => {
      const config = renderer.getConfig();
      expect(config.maxWidth).toBe(300);
      expect(config.maxHeight).toBe(400);
      expect(config.padding).toBe(12);
      expect(config.borderRadius).toBe(8);
      expect(config.cursorOffset).toBe(16);
      expect(config.animationDuration).toBe(150);
    });

    it("should accept custom config", () => {
      renderer.destroy();
      renderer = new TooltipRenderer({
        maxWidth: 400,
        cursorOffset: 20,
      });
      renderer.mount(container);

      const config = renderer.getConfig();
      expect(config.maxWidth).toBe(400);
      expect(config.cursorOffset).toBe(20);
    });

    it("should set tooltip as hidden initially", () => {
      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.classList.contains("exo-graph-tooltip--hidden")).toBe(true);
      expect(tooltip.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("DEFAULT_TOOLTIP_RENDERER_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.maxWidth).toBe(300);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.maxHeight).toBe(400);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.padding).toBe(12);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.borderRadius).toBe(8);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.cursorOffset).toBe(16);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.animationDuration).toBe(150);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.showRelationshipCounts).toBe(true);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.maxProperties).toBe(6);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.maxPreviewLength).toBe(200);
      expect(DEFAULT_TOOLTIP_RENDERER_CONFIG.zIndex).toBe(1000);
    });
  });

  describe("show", () => {
    it("should show tooltip with data", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.classList.contains("exo-graph-tooltip--visible")).toBe(true);
      expect(tooltip.classList.contains("exo-graph-tooltip--hidden")).toBe(false);
      expect(renderer.isVisible()).toBe(true);
    });

    it("should render title", () => {
      const data = createMockTooltipData({ title: "My Custom Title" });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("My Custom Title");
    });

    it("should render type badge", () => {
      const data = createMockTooltipData({ type: "project" });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("Project");
    });

    it("should render properties", () => {
      const data = createMockTooltipData({
        properties: [
          { name: "Status", value: "Active" },
          { name: "Priority", value: "High" },
        ],
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("Status");
      expect(tooltip.textContent).toContain("Active");
      expect(tooltip.textContent).toContain("Priority");
      expect(tooltip.textContent).toContain("High");
    });

    it("should limit number of properties shown", () => {
      const data = createMockTooltipData({
        properties: Array.from({ length: 10 }, (_, i) => ({
          name: `Prop ${i}`,
          value: `Value ${i}`,
        })),
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("Prop 0");
      expect(tooltip.textContent).toContain("Prop 5");
      expect(tooltip.textContent).not.toContain("Prop 6");
      expect(tooltip.textContent).toContain("+4 more properties");
    });

    it("should render relationship counts", () => {
      const data = createMockTooltipData({
        incomingCount: 5,
        outgoingCount: 3,
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("5 incoming");
      expect(tooltip.textContent).toContain("3 outgoing");
    });

    it("should not render relationship counts when zero", () => {
      const data = createMockTooltipData({
        incomingCount: 0,
        outgoingCount: 0,
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).not.toContain("incoming");
      expect(tooltip.textContent).not.toContain("outgoing");
    });

    it("should render preview text", () => {
      const data = createMockTooltipData({
        preview: "This is a preview of the content.",
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("This is a preview of the content.");
    });

    it("should truncate long preview text", () => {
      const longPreview = "A".repeat(300);
      const data = createMockTooltipData({
        preview: longPreview,
        properties: [], // Empty properties to simplify
        incomingCount: 0,
        outgoingCount: 0,
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      // The preview should be truncated and have "..." appended
      expect(tooltip.textContent).toContain("...");
      // The preview portion should be truncated to maxPreviewLength (200) + "..."
      const previewSection = tooltip.querySelector(".exo-tooltip-preview");
      if (previewSection) {
        expect(previewSection.textContent?.length).toBeLessThanOrEqual(210); // 200 + "..."
      }
    });

    it("should render path hint", () => {
      const data = createMockTooltipData({
        path: "/vault-2025/03 Knowledge/project/my-note.md",
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("03 Knowledge/project/my-note");
    });

    it("should update aria-hidden attribute", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.getAttribute("aria-hidden")).toBe("false");
    });
  });

  describe("hide", () => {
    it("should hide tooltip", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });
      renderer.hide();

      // After animation completes
      jest.runAllTimers?.() || setTimeout(() => {}, 200);

      expect(renderer.isVisible()).toBe(false);
    });

    it("should update aria-hidden on hide", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });
      renderer.hide();

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.getAttribute("aria-hidden")).toBe("true");
    });

    it("should not throw when hiding already hidden tooltip", () => {
      expect(() => renderer.hide()).not.toThrow();
    });
  });

  describe("updatePosition", () => {
    it("should update tooltip position", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });
      renderer.updatePosition({ x: 200, y: 200 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.style.left).toBeTruthy();
      expect(tooltip.style.top).toBeTruthy();
    });

    it("should flip tooltip horizontally when near right edge", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 900, y: 100 }); // Near right edge

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);

      // Should be flipped to the left of cursor
      expect(left).toBeLessThan(900);
    });

    it("should flip tooltip vertically when near bottom edge", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 700 }); // Near bottom edge

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      const top = parseInt(tooltip.style.top, 10);

      // Should be flipped above cursor
      expect(top).toBeLessThan(700);
    });
  });

  describe("isVisible", () => {
    it("should return false initially", () => {
      expect(renderer.isVisible()).toBe(false);
    });

    it("should return true when shown", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });
      expect(renderer.isVisible()).toBe(true);
    });

    it("should return false after hide", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });
      renderer.hide();
      expect(renderer.isVisible()).toBe(false);
    });
  });

  describe("getCurrentData", () => {
    it("should return null when not showing", () => {
      expect(renderer.getCurrentData()).toBeNull();
    });

    it("should return current data when showing", () => {
      const data = createMockTooltipData({ id: "test-123" });
      renderer.show(data, { x: 100, y: 100 });

      const currentData = renderer.getCurrentData();
      expect(currentData?.id).toBe("test-123");
    });

    it("should return null after hide", () => {
      const data = createMockTooltipData();
      renderer.show(data, { x: 100, y: 100 });
      renderer.hide();

      expect(renderer.getCurrentData()).toBeNull();
    });
  });

  describe("setConfig", () => {
    it("should update config", () => {
      renderer.setConfig({ maxWidth: 500 });
      expect(renderer.getConfig().maxWidth).toBe(500);
    });

    it("should preserve other config values", () => {
      renderer.setConfig({ maxWidth: 500 });
      renderer.setConfig({ cursorOffset: 25 });

      const config = renderer.getConfig();
      expect(config.maxWidth).toBe(500);
      expect(config.cursorOffset).toBe(25);
    });
  });

  describe("destroy", () => {
    it("should remove tooltip element", () => {
      renderer.destroy();

      const tooltip = container.querySelector(".exo-graph-tooltip");
      expect(tooltip).toBeNull();
    });

    it("should handle double destroy gracefully", () => {
      renderer.destroy();
      expect(() => renderer.destroy()).not.toThrow();
    });
  });

  describe("type styling", () => {
    const typeTests: Array<{ type: NodeType; expectedLabel: string }> = [
      { type: "task", expectedLabel: "Task" },
      { type: "project", expectedLabel: "Project" },
      { type: "area", expectedLabel: "Area" },
      { type: "person", expectedLabel: "Person" },
      { type: "concept", expectedLabel: "Concept" },
      { type: "asset", expectedLabel: "Asset" },
      { type: "unknown", expectedLabel: "Unknown" },
    ];

    typeTests.forEach(({ type, expectedLabel }) => {
      it(`should render correct label for ${type} type`, () => {
        const data = createMockTooltipData({ type });
        renderer.show(data, { x: 100, y: 100 });

        const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
        expect(tooltip.textContent).toContain(expectedLabel);
      });
    });
  });

  describe("XSS prevention", () => {
    it("should escape HTML in title", () => {
      const data = createMockTooltipData({ title: '<script>alert("XSS")</script>' });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      // Should not contain unescaped script tag
      expect(tooltip.innerHTML).not.toContain("<script>");
      // The text content should show the escaped version
      expect(tooltip.textContent).toContain("<script>");
    });

    it("should escape HTML in property values", () => {
      const data = createMockTooltipData({
        properties: [{ name: "Test", value: '<img src="x" onerror="alert(1)">' }],
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      // Should not contain unescaped img tag - look for the actual tag not the escaped version
      expect(tooltip.innerHTML).not.toContain('<img src="x"');
      // The escaped version should be present in text content
      expect(tooltip.textContent).toContain('<img src="x" onerror="alert(1)">');
    });

    it("should escape HTML in preview", () => {
      const data = createMockTooltipData({
        preview: '<a href="javascript:alert(1)">Click me</a>',
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      // Should not contain unescaped anchor tag
      expect(tooltip.innerHTML).not.toContain('<a href="javascript:');
      // The text should show the escaped version
      expect(tooltip.textContent).toContain('<a href="javascript:');
    });
  });

  describe("relationship counts display", () => {
    it("should hide relationship counts when disabled", () => {
      renderer.setConfig({ showRelationshipCounts: false });

      const data = createMockTooltipData({
        incomingCount: 5,
        outgoingCount: 3,
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).not.toContain("incoming");
      expect(tooltip.textContent).not.toContain("outgoing");
    });

    it("should only show non-zero counts", () => {
      const data = createMockTooltipData({
        incomingCount: 5,
        outgoingCount: 0,
      });
      renderer.show(data, { x: 100, y: 100 });

      const tooltip = container.querySelector(".exo-graph-tooltip") as HTMLElement;
      expect(tooltip.textContent).toContain("5 incoming");
      expect(tooltip.textContent).not.toContain("outgoing");
    });
  });
});
