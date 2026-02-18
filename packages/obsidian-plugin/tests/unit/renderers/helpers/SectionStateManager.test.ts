import { SectionStateManager } from "../../../../src/presentation/renderers/helpers/SectionStateManager";
import { EventListenerManager } from "../../../../src/adapters/events/EventListenerManager";

describe("SectionStateManager", () => {
  let manager: SectionStateManager;
  let mockEventManager: jest.Mocked<EventListenerManager>;

  beforeEach(() => {
    manager = new SectionStateManager();
    mockEventManager = {
      register: jest.fn(),
      cleanup: jest.fn(),
    } as unknown as jest.Mocked<EventListenerManager>;
  });

  describe("constructor", () => {
    it("should initialize with default sections as not collapsed", () => {
      const defaultSections = [
        "properties", "buttons", "daily-tasks",
        "area-tree", "relations"
      ];

      for (const section of defaultSections) {
        expect(manager.isCollapsed(section)).toBe(false);
      }
    });

    it("should allow custom default sections", () => {
      const customManager = new SectionStateManager(["custom1", "custom2"]);
      expect(customManager.isCollapsed("custom1")).toBe(false);
      expect(customManager.isCollapsed("custom2")).toBe(false);
    });

    it("should handle empty default sections", () => {
      const emptyManager = new SectionStateManager([]);
      expect(emptyManager.isCollapsed("unknown")).toBe(false);
    });
  });

  describe("isCollapsed", () => {
    it("should return false for default state of known sections", () => {
      expect(manager.isCollapsed("properties")).toBe(false);
    });

    it("should return false for unknown sections", () => {
      expect(manager.isCollapsed("nonexistent-section")).toBe(false);
    });

    it("should return true after section is collapsed", () => {
      const container = createMockContainer();
      manager.toggle("properties", container);
      expect(manager.isCollapsed("properties")).toBe(true);
    });
  });

  describe("toggle", () => {
    it("should toggle section from expanded to collapsed", () => {
      const container = createMockContainer();

      expect(manager.isCollapsed("properties")).toBe(false);
      manager.toggle("properties", container);
      expect(manager.isCollapsed("properties")).toBe(true);
    });

    it("should toggle section from collapsed to expanded", () => {
      const container = createMockContainer();

      // First toggle to collapse
      manager.toggle("properties", container);
      expect(manager.isCollapsed("properties")).toBe(true);

      // Second toggle to expand
      manager.toggle("properties", container);
      expect(manager.isCollapsed("properties")).toBe(false);
    });

    it("should update content element data-collapsed attribute", () => {
      const container = createMockContainer();
      const contentElement = container.querySelector(".exocortex-section-content") as HTMLElement;

      manager.toggle("properties", container);
      expect(contentElement.getAttribute("data-collapsed")).toBe("true");

      manager.toggle("properties", container);
      expect(contentElement.getAttribute("data-collapsed")).toBe("false");
    });

    it("should update toggle button text content", () => {
      const container = createMockContainer();
      const toggleButton = container.querySelector(".exocortex-section-toggle") as HTMLElement;

      // Initial state should show expanded indicator
      toggleButton.textContent = "▼";

      manager.toggle("properties", container);
      expect(toggleButton.textContent).toBe("▶");

      manager.toggle("properties", container);
      expect(toggleButton.textContent).toBe("▼");
    });

    it("should update aria-expanded attribute", () => {
      const container = createMockContainer();
      const toggleButton = container.querySelector(".exocortex-section-toggle") as HTMLElement;

      manager.toggle("properties", container);
      expect(toggleButton.getAttribute("aria-expanded")).toBe("false");

      manager.toggle("properties", container);
      expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
    });

    it("should update aria-label attribute", () => {
      const container = createMockContainer();
      const toggleButton = container.querySelector(".exocortex-section-toggle") as HTMLElement;

      manager.toggle("properties", container);
      expect(toggleButton.getAttribute("aria-label")).toBe("Expand section");

      manager.toggle("properties", container);
      expect(toggleButton.getAttribute("aria-label")).toBe("Collapse section");
    });

    it("should handle missing content element gracefully", () => {
      const container = document.createElement("div");
      const toggleButton = document.createElement("button");
      toggleButton.className = "exocortex-section-toggle";
      container.appendChild(toggleButton);

      // Should not throw even if content element is missing
      expect(() => manager.toggle("properties", container)).not.toThrow();
    });

    it("should handle missing toggle button gracefully", () => {
      const container = document.createElement("div");
      const contentElement = document.createElement("div");
      contentElement.className = "exocortex-section-content";
      container.appendChild(contentElement);

      // Should not throw even if toggle button is missing
      expect(() => manager.toggle("properties", container)).not.toThrow();
    });

    it("should handle completely empty container", () => {
      const container = document.createElement("div");

      // Should not throw even with empty container
      expect(() => manager.toggle("properties", container)).not.toThrow();
      // State should still be toggled
      expect(manager.isCollapsed("properties")).toBe(true);
    });
  });

  describe("renderHeader", () => {
    it("should create section header with toggle button", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "properties", "Properties", mockEventManager);

      const header = container.querySelector(".exocortex-section-header");
      expect(header).toBeTruthy();
    });

    it("should create toggle button with expanded indicator when not collapsed", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "properties", "Properties", mockEventManager);

      const toggleButton = container.querySelector(".exocortex-section-toggle");
      expect(toggleButton).toBeTruthy();
      expect(toggleButton?.textContent).toBe("▼");
    });

    it("should create toggle button with collapsed indicator when collapsed", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      // Pre-collapse the section
      const toggleContainer = createMockContainer();
      manager.toggle("properties", toggleContainer);

      manager.renderHeader(container, "properties", "Properties", mockEventManager);

      const toggleButton = container.querySelector(".exocortex-section-toggle");
      expect(toggleButton?.textContent).toBe("▶");
    });

    it("should set correct aria-expanded attribute based on state", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "buttons", "Buttons", mockEventManager);

      const toggleButton = container.querySelector(".exocortex-section-toggle");
      expect(toggleButton?.getAttribute("aria-expanded")).toBe("true");
    });

    it("should set aria-label with section title", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "daily-tasks", "Daily Tasks", mockEventManager);

      const toggleButton = container.querySelector(".exocortex-section-toggle");
      expect(toggleButton?.getAttribute("aria-label")).toBe("Collapse Daily Tasks");
    });

    it("should set type=button attribute", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "relations", "Relations", mockEventManager);

      const toggleButton = container.querySelector(".exocortex-section-toggle");
      expect(toggleButton?.getAttribute("type")).toBe("button");
    });

    it("should create h3 element with title", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "area-tree", "Area Tree", mockEventManager);

      const h3 = container.querySelector("h3");
      expect(h3).toBeTruthy();
      expect(h3?.textContent).toBe("Area Tree");
    });

    it("should register click event listener", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "properties", "Properties", mockEventManager);

      expect(mockEventManager.register).toHaveBeenCalledWith(
        expect.any(HTMLButtonElement),
        "click",
        expect.any(Function)
      );
    });

    it("should register keydown event listener", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      manager.renderHeader(container, "properties", "Properties", mockEventManager);

      expect(mockEventManager.register).toHaveBeenCalledWith(
        expect.any(HTMLButtonElement),
        "keydown",
        expect.any(Function)
      );
    });

    it("should toggle on click", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      // Capture the click handler
      let clickHandler: (e: Event) => void = () => {};
      mockEventManager.register.mockImplementation((_el, event, handler) => {
        if (event === "click") {
          clickHandler = handler as (e: Event) => void;
        }
      });

      manager.renderHeader(container, "properties", "Properties", mockEventManager);

      expect(manager.isCollapsed("properties")).toBe(false);

      const mockEvent = {
        stopPropagation: jest.fn(),
      } as unknown as Event;

      clickHandler(mockEvent);

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(manager.isCollapsed("properties")).toBe(true);
    });

    it("should toggle on Enter key", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      // Capture the keydown handler
      let keydownHandler: (e: Event) => void = () => {};
      mockEventManager.register.mockImplementation((_el, event, handler) => {
        if (event === "keydown") {
          keydownHandler = handler as (e: Event) => void;
        }
      });

      manager.renderHeader(container, "buttons", "Buttons", mockEventManager);

      expect(manager.isCollapsed("buttons")).toBe(false);

      const mockEvent = {
        key: "Enter",
        preventDefault: jest.fn(),
      } as unknown as KeyboardEvent;

      keydownHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(manager.isCollapsed("buttons")).toBe(true);
    });

    it("should toggle on Space key", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      // Capture the keydown handler
      let keydownHandler: (e: Event) => void = () => {};
      mockEventManager.register.mockImplementation((_el, event, handler) => {
        if (event === "keydown") {
          keydownHandler = handler as (e: Event) => void;
        }
      });

      manager.renderHeader(container, "area-tree", "Area Tree", mockEventManager);

      expect(manager.isCollapsed("area-tree")).toBe(false);

      const mockEvent = {
        key: " ",
        preventDefault: jest.fn(),
      } as unknown as KeyboardEvent;

      keydownHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(manager.isCollapsed("area-tree")).toBe(true);
    });

    it("should not toggle on other keys", () => {
      const container = document.createElement("div");
      container.createDiv = createDivMock;

      // Capture the keydown handler
      let keydownHandler: (e: Event) => void = () => {};
      mockEventManager.register.mockImplementation((_el, event, handler) => {
        if (event === "keydown") {
          keydownHandler = handler as (e: Event) => void;
        }
      });

      manager.renderHeader(container, "relations", "Relations", mockEventManager);

      expect(manager.isCollapsed("relations")).toBe(false);

      const mockEvent = {
        key: "Tab",
        preventDefault: jest.fn(),
      } as unknown as KeyboardEvent;

      keydownHandler(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(manager.isCollapsed("relations")).toBe(false);
    });
  });
});

// Helper functions
function createMockContainer(): HTMLElement {
  const container = document.createElement("div");

  const contentElement = document.createElement("div");
  contentElement.className = "exocortex-section-content";
  container.appendChild(contentElement);

  const toggleButton = document.createElement("button");
  toggleButton.className = "exocortex-section-toggle";
  toggleButton.textContent = "▼";
  container.appendChild(toggleButton);

  return container;
}

function createDivMock(options: { cls?: string }): HTMLElement {
  const div = document.createElement("div");
  if (options.cls) {
    div.className = options.cls;
  }

  // Add createEl method for nested elements
  div.createEl = ((tag: string, opts?: { text?: string; cls?: string; attr?: Record<string, string> }) => {
    const el = document.createElement(tag);
    if (opts?.text) el.textContent = opts.text;
    if (opts?.cls) el.className = opts.cls;
    if (opts?.attr) {
      Object.entries(opts.attr).forEach(([key, value]) => {
        el.setAttribute(key, value);
      });
    }
    div.appendChild(el);
    return el;
  }) as any;

  // Add createDiv method for nested divs
  div.createDiv = createDivMock;

  // Append to the parent container
  (this as any)?.appendChild?.(div);

  return div;
}
