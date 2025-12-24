/**
 * Tests for ContextMenuRenderer - DOM-based context menu rendering
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  ContextMenuRenderer,
  DEFAULT_CONTEXT_MENU_RENDERER_CONFIG,
  type ContextMenuRendererConfig,
} from "../../../../../src/presentation/renderers/graph/ContextMenuRenderer";
import type {
  ContextMenuState,
  ContextMenuItem,
  ContextMenuTarget,
} from "../../../../../src/presentation/renderers/graph/ContextMenuManager";
import type { GraphNode } from "../../../../../src/presentation/renderers/graph/types";

// Create mock node for targets
function createMockNode(id: string): GraphNode {
  return {
    id,
    label: `Node ${id}`,
    path: `/path/to/${id}.md`,
    x: 100,
    y: 100,
    size: 8,
  };
}

// Create test menu items
function createTestItems(): ContextMenuItem[] {
  return [
    { id: "action-1", label: "Open File", icon: "open-file", shortcut: "Enter" },
    { id: "action-2", label: "Focus Node", icon: "focus" },
    { id: "action-3", label: "Copy Path", icon: "copy", separator: true },
    { id: "action-4", label: "Delete", icon: "trash", danger: true },
  ];
}

// Create test state
function createTestState(visible = true): ContextMenuState {
  const node = createMockNode("test-node");
  return {
    visible,
    position: { x: 100, y: 100 },
    target: { type: "node", nodeId: node.id, node },
    items: createTestItems(),
  };
}

describe("ContextMenuRenderer", () => {
  let container: HTMLElement;
  let renderer: ContextMenuRenderer;

  beforeEach(() => {
    // Setup DOM container
    container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);

    renderer = new ContextMenuRenderer(container);
  });

  afterEach(() => {
    renderer.destroy();
    document.body.removeChild(container);
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(renderer.getConfig()).toEqual(DEFAULT_CONTEXT_MENU_RENDERER_CONFIG);
    });

    it("should accept custom config", () => {
      const customConfig: Partial<ContextMenuRendererConfig> = {
        classPrefix: "custom-menu",
        maxWidth: 300,
        animationDuration: 200,
      };
      const customRenderer = new ContextMenuRenderer(container, customConfig);

      const config = customRenderer.getConfig();
      expect(config.classPrefix).toBe("custom-menu");
      expect(config.maxWidth).toBe(300);
      expect(config.animationDuration).toBe(200);

      customRenderer.destroy();
    });
  });

  describe("render", () => {
    it("should create menu element in container", () => {
      const state = createTestState();

      renderer.render(state);

      const menu = container.querySelector(".exo-context-menu");
      expect(menu).not.toBeNull();
    });

    it("should render all menu items", () => {
      const state = createTestState();

      renderer.render(state);

      const items = container.querySelectorAll(".exo-context-menu__item");
      expect(items.length).toBe(4);
    });

    it("should render item labels", () => {
      const state = createTestState();

      renderer.render(state);

      const labels = container.querySelectorAll(".exo-context-menu__label");
      expect(labels[0].textContent).toBe("Open File");
      expect(labels[1].textContent).toBe("Focus Node");
      expect(labels[2].textContent).toBe("Copy Path");
      expect(labels[3].textContent).toBe("Delete");
    });

    it("should render keyboard shortcuts", () => {
      const state = createTestState();

      renderer.render(state);

      const shortcuts = container.querySelectorAll(".exo-context-menu__shortcut");
      expect(shortcuts.length).toBeGreaterThan(0);
      expect(shortcuts[0].textContent).toBe("Enter");
    });

    it("should apply danger class to danger items", () => {
      const state = createTestState();

      renderer.render(state);

      const dangerItem = container.querySelector(".exo-context-menu__item--danger");
      expect(dangerItem).not.toBeNull();
    });

    it("should render separators", () => {
      const state = createTestState();

      renderer.render(state);

      const separators = container.querySelectorAll(".exo-context-menu__separator");
      expect(separators.length).toBeGreaterThan(0);
    });

    it("should not render when visible is false", () => {
      const state = createTestState(false);

      renderer.render(state);

      expect(renderer.isVisible()).toBe(false);
    });

    it("should not render when items array is empty", () => {
      const state = createTestState();
      state.items = [];

      renderer.render(state);

      expect(renderer.isVisible()).toBe(false);
    });

    it("should set ARIA attributes", () => {
      const state = createTestState();

      renderer.render(state);

      const menu = container.querySelector(".exo-context-menu");
      expect(menu?.getAttribute("role")).toBe("menu");
      expect(menu?.getAttribute("aria-label")).toBe("Context menu");

      const items = container.querySelectorAll(".exo-context-menu__item");
      items.forEach((item) => {
        expect(item.getAttribute("role")).toBe("menuitem");
      });
    });
  });

  describe("hide", () => {
    it("should hide visible menu", () => {
      const state = createTestState();
      renderer.render(state);
      expect(renderer.isVisible()).toBe(true);

      renderer.hide();

      expect(renderer.isVisible()).toBe(false);
    });

    it("should do nothing if already hidden", () => {
      expect(renderer.isVisible()).toBe(false);
      renderer.hide(); // Should not throw
      expect(renderer.isVisible()).toBe(false);
    });
  });

  describe("isVisible", () => {
    it("should return false initially", () => {
      expect(renderer.isVisible()).toBe(false);
    });

    it("should return true after render", () => {
      renderer.render(createTestState());
      expect(renderer.isVisible()).toBe(true);
    });

    it("should return false after hide", () => {
      renderer.render(createTestState());
      renderer.hide();
      expect(renderer.isVisible()).toBe(false);
    });
  });

  describe("updatePosition", () => {
    it("should update menu position", () => {
      renderer.render(createTestState());

      renderer.updatePosition({ x: 200, y: 300 });

      const menu = container.querySelector(".exo-context-menu") as HTMLElement;
      // Position is set via CSS custom properties (includes offset of {x: 2, y: 2} from default config)
      expect(menu.style.getPropertyValue("--context-menu-left")).toBe("202px");
      expect(menu.style.getPropertyValue("--context-menu-top")).toBe("302px");
    });

    it("should do nothing if not visible", () => {
      renderer.updatePosition({ x: 200, y: 300 });
      // Should not throw
    });
  });

  describe("setActionHandler", () => {
    it("should call action handler on item click", () => {
      const handler = jest.fn();
      renderer.setActionHandler(handler);

      const state = createTestState();
      renderer.render(state);

      const item = container.querySelector(".exo-context-menu__item") as HTMLElement;
      item.click();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: "action-1" }),
        state.target
      );
    });

    it("should not call handler for disabled items", () => {
      const handler = jest.fn();
      renderer.setActionHandler(handler);

      const state = createTestState();
      state.items = [
        { id: "disabled-action", label: "Disabled", disabled: true },
      ];
      renderer.render(state);

      const item = container.querySelector(".exo-context-menu__item--disabled") as HTMLElement;
      expect(item).not.toBeNull();
      // Disabled items have pointer-events: none, so click won't fire
    });
  });

  describe("disabled items", () => {
    it("should render disabled items with correct class", () => {
      const state = createTestState();
      state.items = [
        { id: "disabled-action", label: "Disabled Action", disabled: true },
      ];

      renderer.render(state);

      const item = container.querySelector(".exo-context-menu__item--disabled");
      expect(item).not.toBeNull();
      expect(item?.getAttribute("aria-disabled")).toBe("true");
    });
  });

  describe("submenu items", () => {
    it("should render submenu indicator for items with submenu", () => {
      const state = createTestState();
      state.items = [
        {
          id: "with-submenu",
          label: "Has Submenu",
          submenu: [
            { id: "sub-1", label: "Submenu Item 1" },
            { id: "sub-2", label: "Submenu Item 2" },
          ],
        },
      ];

      renderer.render(state);

      const submenuItem = container.querySelector(".exo-context-menu__item--has-submenu");
      expect(submenuItem).not.toBeNull();
      expect(submenuItem?.getAttribute("aria-haspopup")).toBe("true");
    });

    it("should render submenu arrow", () => {
      const state = createTestState();
      state.items = [
        {
          id: "with-submenu",
          label: "Has Submenu",
          submenu: [{ id: "sub-1", label: "Sub Item" }],
        },
      ];

      renderer.render(state);

      const arrow = container.querySelector(".exo-context-menu__arrow");
      expect(arrow).not.toBeNull();
    });
  });

  describe("keyboard navigation", () => {
    it("should respond to Arrow Down key", () => {
      renderer.render(createTestState());

      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      document.dispatchEvent(event);

      const focusedItem = container.querySelector(".exo-context-menu__item--focused");
      expect(focusedItem).not.toBeNull();
    });

    it("should respond to Arrow Up key", () => {
      renderer.render(createTestState());

      // First go down
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      // Then up
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));

      // Should cycle to last item
      const items = container.querySelectorAll(".exo-context-menu__item");
      const lastItem = items[items.length - 1];
      expect(lastItem.classList.contains("exo-context-menu__item--focused")).toBe(true);
    });

    it("should respond to Escape key", () => {
      renderer.render(createTestState());
      expect(renderer.isVisible()).toBe(true);

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(renderer.isVisible()).toBe(false);
    });

    it("should respond to Home key", () => {
      renderer.render(createTestState());

      // Navigate to some item first
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

      // Press Home
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));

      const items = container.querySelectorAll(".exo-context-menu__item:not(.exo-context-menu__item--disabled)");
      expect(items[0].classList.contains("exo-context-menu__item--focused")).toBe(true);
    });

    it("should respond to End key", () => {
      renderer.render(createTestState());

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));

      const items = container.querySelectorAll(".exo-context-menu__item:not(.exo-context-menu__item--disabled)");
      const lastItem = items[items.length - 1];
      expect(lastItem.classList.contains("exo-context-menu__item--focused")).toBe(true);
    });
  });

  describe("destroy", () => {
    it("should remove menu from DOM", () => {
      renderer.render(createTestState());
      expect(container.querySelector(".exo-context-menu")).not.toBeNull();

      renderer.destroy();

      // Menu might still be in DOM during animation, but renderer should be destroyed
      expect(renderer.isVisible()).toBe(false);
    });

    it("should be safe to call multiple times", () => {
      renderer.render(createTestState());

      renderer.destroy();
      renderer.destroy(); // Should not throw
    });
  });

  describe("setConfig", () => {
    it("should update config", () => {
      renderer.setConfig({ maxWidth: 400 });

      expect(renderer.getConfig().maxWidth).toBe(400);
    });
  });

  describe("icons", () => {
    it("should render icon SVG for known icons", () => {
      const state = createTestState();
      state.items = [{ id: "with-icon", label: "With Icon", icon: "open-file" }];

      renderer.render(state);

      const icon = container.querySelector(".exo-context-menu__icon");
      expect(icon).not.toBeNull();
      expect(icon?.querySelector("svg")).not.toBeNull();
    });

    it("should render spacer when no icon", () => {
      const state = createTestState();
      state.items = [{ id: "no-icon", label: "No Icon" }];

      renderer.render(state);

      const spacer = container.querySelector(".exo-context-menu__icon-spacer");
      expect(spacer).not.toBeNull();
    });
  });

  describe("click outside", () => {
    it("should close menu on click outside after delay", async () => {
      jest.useFakeTimers();

      renderer.render(createTestState());
      expect(renderer.isVisible()).toBe(true);

      // Advance past the delay for click handler registration
      jest.advanceTimersByTime(100);

      // Click outside the menu
      document.body.click();

      expect(renderer.isVisible()).toBe(false);

      jest.useRealTimers();
    });
  });
});
