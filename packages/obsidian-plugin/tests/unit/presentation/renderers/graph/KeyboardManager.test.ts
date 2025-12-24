/**
 * Tests for KeyboardManager - Keyboard navigation and shortcuts
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  KeyboardManager,
  DEFAULT_KEYBOARD_MANAGER_CONFIG,
  DEFAULT_KEY_BINDINGS,
  type KeyboardManagerConfig,
  type KeyBinding,
  type KeyBindingContext,
  type KeyboardEvent_Custom,
} from "../../../../../src/presentation/renderers/graph/KeyboardManager";
import type { GraphNode } from "../../../../../src/presentation/renderers/graph/types";

// Create mock keyboard event
function createKeyboardEvent(key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  } as unknown as KeyboardEvent;
}

// Create mock graph nodes
function createMockNodes(count: number): GraphNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    label: `Node ${i}`,
    path: `/path/to/node-${i}.md`,
    x: i * 50,
    y: i * 30,
  }));
}

// Create mock HTML element
function createMockElement(): HTMLElement {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    hasAttribute: jest.fn().mockReturnValue(false),
    setAttribute: jest.fn(),
    getAttribute: jest.fn(),
    addEventListener: jest.fn((event, handler) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler as (...args: unknown[]) => void);
    }),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn((event) => {
      const type = event.type;
      if (handlers[type]) {
        handlers[type].forEach((h) => h(event));
      }
    }),
  } as unknown as HTMLElement;
}

describe("KeyboardManager", () => {
  let keyboard: KeyboardManager;

  beforeEach(() => {
    keyboard = new KeyboardManager();
  });

  afterEach(() => {
    keyboard.destroy();
  });

  describe("initialization", () => {
    it("should initialize with default config", () => {
      const config = keyboard.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.preventDefault).toBe(true);
      expect(config.stopPropagation).toBe(true);
      expect(config.enableTabNavigation).toBe(true);
      expect(config.enableArrowNavigation).toBe(true);
    });

    it("should accept custom config", () => {
      keyboard.destroy();
      keyboard = new KeyboardManager({
        preventDefault: false,
        enableTabNavigation: false,
      });

      const config = keyboard.getConfig();
      expect(config.preventDefault).toBe(false);
      expect(config.enableTabNavigation).toBe(false);
    });

    it("should register default bindings", () => {
      const bindings = keyboard.getAllBindings();
      expect(bindings.length).toBeGreaterThan(0);

      // Check some essential bindings exist
      const tabBinding = bindings.find((b) => b.key === "Tab" && !b.modifiers?.shift);
      expect(tabBinding).toBeDefined();
      expect(tabBinding?.action).toBe("focusNext");

      const enterBinding = bindings.find((b) => b.key === "Enter");
      expect(enterBinding).toBeDefined();
      expect(enterBinding?.action).toBe("openNode");
    });

    it("should start with no focused node", () => {
      expect(keyboard.getFocusedNodeId()).toBeNull();
    });
  });

  describe("DEFAULT_KEYBOARD_MANAGER_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.enabled).toBe(true);
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.preventDefault).toBe(true);
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.stopPropagation).toBe(true);
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.enableTabNavigation).toBe(true);
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.enableArrowNavigation).toBe(true);
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.enableEnterOpen).toBe(true);
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.enableDelete).toBe(true);
      expect(DEFAULT_KEYBOARD_MANAGER_CONFIG.enableEscapeClear).toBe(true);
    });
  });

  describe("DEFAULT_KEY_BINDINGS", () => {
    it("should contain navigation bindings", () => {
      const navBindings = DEFAULT_KEY_BINDINGS.filter((b) =>
        ["focusNext", "focusPrev", "navigateUp", "navigateDown", "navigateLeft", "navigateRight"].includes(b.action)
      );
      expect(navBindings.length).toBeGreaterThan(0);
    });

    it("should contain action bindings", () => {
      const actionBindings = DEFAULT_KEY_BINDINGS.filter((b) =>
        ["openNode", "deleteSelected", "selectAll"].includes(b.action)
      );
      expect(actionBindings.length).toBeGreaterThan(0);
    });
  });

  describe("binding registration", () => {
    it("should register a new binding", () => {
      keyboard.registerBinding({
        key: "x",
        action: "customAction",
        description: "Custom action",
      });

      const bindings = keyboard.getBindingsForAction("customAction");
      expect(bindings.length).toBe(1);
      expect(bindings[0].key).toBe("x");
    });

    it("should register binding with modifiers", () => {
      keyboard.registerBinding({
        key: "s",
        modifiers: { ctrl: true },
        action: "save",
        description: "Save",
      });

      const bindings = keyboard.getBindingsForAction("save");
      expect(bindings.length).toBe(1);
      expect(bindings[0].modifiers?.ctrl).toBe(true);
    });

    it("should unregister a binding", () => {
      keyboard.registerBinding({
        key: "x",
        action: "customAction",
        description: "Custom action",
      });

      keyboard.unregisterBinding("x", undefined, "customAction");

      const bindings = keyboard.getBindingsForAction("customAction");
      expect(bindings.length).toBe(0);
    });

    it("should unregister all bindings for a key", () => {
      keyboard.registerBinding({
        key: "x",
        action: "action1",
        description: "Action 1",
      });
      keyboard.registerBinding({
        key: "x",
        action: "action2",
        description: "Action 2",
      });

      keyboard.unregisterBinding("x");

      const bindings1 = keyboard.getBindingsForAction("action1");
      const bindings2 = keyboard.getBindingsForAction("action2");
      expect(bindings1.length).toBe(0);
      expect(bindings2.length).toBe(0);
    });
  });

  describe("action handlers", () => {
    it("should register and call action handler", () => {
      const handler = jest.fn();
      keyboard.registerAction("testAction", handler);

      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      keyboard.handleKeyDown(createKeyboardEvent("t"));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should pass keyboard event to handler", () => {
      const handler = jest.fn();
      keyboard.registerAction("testAction", handler);

      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      const event = createKeyboardEvent("t");
      keyboard.handleKeyDown(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should unregister action handler", () => {
      const handler = jest.fn();
      keyboard.registerAction("testAction", handler);
      keyboard.unregisterAction("testAction");

      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      keyboard.handleKeyDown(createKeyboardEvent("t"));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should prevent default and stop propagation when configured", () => {
      keyboard.registerAction("testAction", jest.fn());
      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      const event = createKeyboardEvent("t");
      keyboard.handleKeyDown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it("should not prevent default when disabled", () => {
      keyboard.setConfig({ preventDefault: false, stopPropagation: false });
      keyboard.registerAction("testAction", jest.fn());
      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      const event = createKeyboardEvent("t");
      keyboard.handleKeyDown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    });
  });

  describe("focus navigation", () => {
    beforeEach(() => {
      const nodes = createMockNodes(5);
      keyboard.setNodes(nodes);
      keyboard.setGraphFocused(true);
    });

    it("should focus first node when no node is focused", () => {
      keyboard.focusNext();
      expect(keyboard.getFocusedNodeId()).toBe("node-0");
    });

    it("should focus next node in order", () => {
      keyboard.setFocusedNode("node-0");
      keyboard.focusNext();
      expect(keyboard.getFocusedNodeId()).toBe("node-1");
    });

    it("should wrap to first node from last", () => {
      keyboard.setFocusedNode("node-4");
      keyboard.focusNext();
      expect(keyboard.getFocusedNodeId()).toBe("node-0");
    });

    it("should focus previous node in order", () => {
      keyboard.setFocusedNode("node-2");
      keyboard.focusPrev();
      expect(keyboard.getFocusedNodeId()).toBe("node-1");
    });

    it("should wrap to last node from first", () => {
      keyboard.setFocusedNode("node-0");
      keyboard.focusPrev();
      expect(keyboard.getFocusedNodeId()).toBe("node-4");
    });

    it("should focus node by index", () => {
      keyboard.focusNodeByIndex(3);
      expect(keyboard.getFocusedNodeId()).toBe("node-2");
    });

    it("should not focus invalid index", () => {
      keyboard.focusNodeByIndex(100);
      expect(keyboard.getFocusedNodeId()).toBeNull();
    });

    it("should clear focus", () => {
      keyboard.setFocusedNode("node-1");
      keyboard.clearFocus();
      expect(keyboard.getFocusedNodeId()).toBeNull();
    });
  });

  describe("context handling", () => {
    it("should handle graphFocused context", () => {
      keyboard.registerAction("graphOnly", jest.fn());
      keyboard.registerBinding({
        key: "g",
        action: "graphOnly",
        description: "Graph only",
        when: "graphFocused",
      });

      // Not focused - should not trigger
      const handler1 = jest.fn();
      keyboard.registerAction("graphOnly", handler1);
      keyboard.handleKeyDown(createKeyboardEvent("g"));
      expect(handler1).not.toHaveBeenCalled();

      // Focused - should trigger
      keyboard.setGraphFocused(true);
      keyboard.handleKeyDown(createKeyboardEvent("g"));
      expect(handler1).toHaveBeenCalled();
    });

    it("should handle nodeSelected context", () => {
      const handler = jest.fn();
      keyboard.registerAction("nodeOnly", handler);
      keyboard.registerBinding({
        key: "n",
        action: "nodeOnly",
        description: "Node only",
        when: "nodeSelected",
      });

      keyboard.setGraphFocused(true);

      // No node selected - should not trigger
      keyboard.handleKeyDown(createKeyboardEvent("n"));
      expect(handler).not.toHaveBeenCalled();

      // Node selected - should trigger
      keyboard.setNodes(createMockNodes(3));
      keyboard.setFocusedNode("node-1");
      keyboard.handleKeyDown(createKeyboardEvent("n"));
      expect(handler).toHaveBeenCalled();
    });

    it("should set and check custom context", () => {
      keyboard.setContext("searchOpen", true);

      const handler = jest.fn();
      keyboard.registerAction("searchOnly", handler);
      keyboard.registerBinding({
        key: "s",
        action: "searchOnly",
        description: "Search only",
        when: "searchOpen",
      });

      keyboard.handleKeyDown(createKeyboardEvent("s"));
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("modifier key handling", () => {
    beforeEach(() => {
      keyboard.setGraphFocused(true);
    });

    it("should match Ctrl modifier", () => {
      const handler = jest.fn();
      keyboard.registerAction("ctrlAction", handler);
      // Use a key that doesn't conflict with defaults
      keyboard.registerBinding({
        key: "b",
        modifiers: { ctrl: true },
        action: "ctrlAction",
        description: "Ctrl+B",
      });

      // Without Ctrl - should not trigger
      keyboard.handleKeyDown(createKeyboardEvent("b"));
      expect(handler).not.toHaveBeenCalled();

      // With Ctrl - should trigger
      keyboard.handleKeyDown(createKeyboardEvent("b", { ctrlKey: true }));
      expect(handler).toHaveBeenCalled();
    });

    it("should match Shift modifier", () => {
      const handler = jest.fn();
      keyboard.registerAction("shiftAction", handler);
      // Use a key that doesn't conflict with default Shift+Tab
      keyboard.registerBinding({
        key: "q",
        modifiers: { shift: true },
        action: "shiftAction",
        description: "Shift+Q",
      });

      keyboard.handleKeyDown(createKeyboardEvent("q", { shiftKey: true }));
      expect(handler).toHaveBeenCalled();
    });

    it("should match multiple modifiers", () => {
      const handler = jest.fn();
      keyboard.registerAction("multiMod", handler);
      keyboard.registerBinding({
        key: "z",
        modifiers: { ctrl: true, shift: true },
        action: "multiMod",
        description: "Ctrl+Shift+Z",
      });

      // Only Ctrl - should not trigger
      keyboard.handleKeyDown(createKeyboardEvent("z", { ctrlKey: true }));
      expect(handler).not.toHaveBeenCalled();

      // Both Ctrl and Shift - should trigger
      keyboard.handleKeyDown(createKeyboardEvent("z", { ctrlKey: true, shiftKey: true }));
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("events", () => {
    it("should emit keyboard:action event", () => {
      const listener = jest.fn();
      keyboard.on("keyboard:action", listener);

      keyboard.registerAction("testAction", jest.fn());
      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      keyboard.handleKeyDown(createKeyboardEvent("t"));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as KeyboardEvent_Custom;
      expect(event.type).toBe("keyboard:action");
      expect(event.action).toBe("testAction");
    });

    it("should emit keyboard:focus:change event", () => {
      const listener = jest.fn();
      keyboard.on("keyboard:focus:change", listener);

      keyboard.setNodes(createMockNodes(3));
      keyboard.setFocusedNode("node-1");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as KeyboardEvent_Custom;
      expect(event.type).toBe("keyboard:focus:change");
      expect(event.focusedNodeId).toBe("node-1");
      expect(event.previousFocusedNodeId).toBeNull();
    });

    it("should emit keyboard:navigation event", () => {
      const listener = jest.fn();
      keyboard.on("keyboard:navigation", listener);

      keyboard.setNodes(createMockNodes(3));
      keyboard.focusNext();

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as KeyboardEvent_Custom;
      expect(event.type).toBe("keyboard:navigation");
      expect(event.direction).toBe("next");
    });

    it("should remove event listener", () => {
      const listener = jest.fn();
      keyboard.on("keyboard:action", listener);
      keyboard.off("keyboard:action", listener);

      keyboard.registerAction("testAction", jest.fn());
      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      keyboard.handleKeyDown(createKeyboardEvent("t"));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("element attachment", () => {
    it("should attach to element", () => {
      const element = createMockElement();
      keyboard.attach(element);

      expect(element.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
      expect(element.setAttribute).toHaveBeenCalledWith("tabindex", "0");
    });

    it("should detach from element", () => {
      const element = createMockElement();
      keyboard.attach(element);
      keyboard.detach();

      expect(element.removeEventListener).toHaveBeenCalled();
    });
  });

  describe("shortcut string", () => {
    it("should return shortcut string for action", () => {
      const shortcut = keyboard.getShortcutString("focusNext");
      expect(shortcut).toBe("Tab");
    });

    it("should include modifiers in shortcut string", () => {
      const shortcut = keyboard.getShortcutString("focusPrev");
      expect(shortcut).toBe("Shift+Tab");
    });

    it("should return null for unknown action", () => {
      const shortcut = keyboard.getShortcutString("unknownAction");
      expect(shortcut).toBeNull();
    });
  });

  describe("enable/disable", () => {
    it("should check if enabled", () => {
      expect(keyboard.isEnabled()).toBe(true);
    });

    it("should disable keyboard handling", () => {
      keyboard.disable();
      expect(keyboard.isEnabled()).toBe(false);

      const handler = jest.fn();
      keyboard.registerAction("testAction", handler);
      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      keyboard.handleKeyDown(createKeyboardEvent("t"));

      expect(handler).not.toHaveBeenCalled();
    });

    it("should enable keyboard handling", () => {
      keyboard.disable();
      keyboard.enable();

      const handler = jest.fn();
      keyboard.registerAction("testAction", handler);
      keyboard.registerBinding({
        key: "t",
        action: "testAction",
        description: "Test",
      });

      keyboard.setGraphFocused(true);
      keyboard.handleKeyDown(createKeyboardEvent("t"));

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("should cleanup on destroy", () => {
      keyboard.setNodes(createMockNodes(3));
      keyboard.setFocusedNode("node-1");

      keyboard.destroy();

      expect(keyboard.getFocusedNodeId()).toBeNull();
      expect(keyboard.getAllBindings().length).toBe(0);
    });
  });
});
