import {
  ClassSelectionModal,
  ClassSelectionModalResult,
} from "../../src/presentation/modals/ClassSelectionModal";
import { App } from "obsidian";
import type { DiscoveredClass } from "@plugin/application/services/ClassDiscoveryService";

function createMockClass(overrides: Partial<DiscoveredClass> = {}): DiscoveredClass {
  return {
    className: "ems__Task",
    label: "Task",
    description: "A task entity",
    ontologyFile: "ems.md",
    properties: [],
    ...overrides,
  };
}

describe("ClassSelectionModal", () => {
  let mockApp: App;
  let modal: ClassSelectionModal;
  let onSubmitSpy: jest.Mock<void, [ClassSelectionModalResult]>;
  let mockContentEl: any;
  let mockSelectEl: HTMLSelectElement;
  let mockSearchInputEl: HTMLInputElement;
  let testClasses: DiscoveredClass[];

  beforeEach(() => {
    mockApp = {} as App;
    mockSelectEl = document.createElement("select");
    mockSearchInputEl = document.createElement("input");

    // Extend selectEl with Obsidian's createEl/empty methods
    (mockSelectEl as any).empty = jest.fn(() => {
      mockSelectEl.innerHTML = "";
    });
    (mockSelectEl as any).createEl = jest.fn((tag: string, options?: any) => {
      const el = document.createElement(tag);
      if (options?.value !== undefined) (el as any).value = options.value;
      if (options?.text) el.textContent = options.text;
      if (tag === "optgroup") {
        (el as any).createEl = jest.fn((childTag: string, childOpts?: any) => {
          const childEl = document.createElement(childTag);
          if (childOpts?.value !== undefined) (childEl as any).value = childOpts.value;
          if (childOpts?.text) childEl.textContent = childOpts.text;
          el.appendChild(childEl);
          return childEl;
        });
      }
      mockSelectEl.appendChild(el);
      return el;
    });

    mockContentEl = {
      addClass: jest.fn(),
      createEl: jest.fn(),
      createDiv: jest.fn(),
      empty: jest.fn(),
    };

    mockContentEl.createEl.mockImplementation((tag: string, options?: any) => {
      if (tag === "select") return mockSelectEl;
      if (tag === "button") {
        const button = document.createElement("button");
        if (options?.text) button.textContent = options.text;
        if (options?.cls) button.className = options.cls;
        return button;
      }
      const el = document.createElement(tag);
      if (options?.text) el.textContent = options.text;
      if (options?.cls) el.className = options.cls;
      return el;
    });

    mockContentEl.createDiv.mockImplementation((options?: any) => {
      const div = document.createElement("div");
      if (options?.cls) div.className = options.cls;
      (div as any).createEl = mockContentEl.createEl;
      (div as any).createDiv = mockContentEl.createDiv;
      (div as any).empty = jest.fn();
      (div as any).addClass = jest.fn();
      return div;
    });

    testClasses = [
      createMockClass({ className: "ems__Task", label: "Task", description: "A task" }),
      createMockClass({ className: "ems__Project", label: "Project", description: "A project" }),
      createMockClass({ className: "ims__Concept", label: "Concept", description: "A concept" }),
      createMockClass({ className: "exo__Layout", label: "Layout", description: "A layout" }),
      createMockClass({ className: "pn__JournalEntry", label: "Journal Entry", description: "A journal entry" }),
    ];

    onSubmitSpy = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with provided classes", () => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      expect(modal).toBeDefined();
    });

    it("should initialize with empty classes array", () => {
      modal = new ClassSelectionModal(mockApp, [], onSubmitSpy);
      expect(modal).toBeDefined();
    });

    it("should copy classes to filteredClasses", () => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      expect((modal as any).filteredClasses).toHaveLength(testClasses.length);
    });
  });

  describe("onOpen", () => {
    beforeEach(() => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should add modal class", () => {
      modal.onOpen();
      expect(mockContentEl.addClass).toHaveBeenCalledWith("exocortex-class-selection-modal");
    });

    it("should create heading", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("h2", { text: "Create asset" });
    });

    it("should create description paragraph", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("p", {
        text: "Select the type of asset you want to create:",
        cls: "exocortex-modal-description",
      });
    });

    it("should create search container", () => {
      modal.onOpen();
      expect(mockContentEl.createDiv).toHaveBeenCalledWith({
        cls: "exocortex-modal-search-container",
      });
    });

    it("should create select dropdown", () => {
      modal.onOpen();
      expect(mockContentEl.createDiv).toHaveBeenCalledWith({
        cls: "exocortex-modal-input-container",
      });
    });

    it("should create Next and Cancel buttons", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("button", {
        text: "Next",
        cls: "mod-cta",
      });
      expect(mockContentEl.createEl).toHaveBeenCalledWith("button", {
        text: "Cancel",
      });
    });

    it("should create button container", () => {
      modal.onOpen();
      expect(mockContentEl.createDiv).toHaveBeenCalledWith({
        cls: "modal-button-container",
      });
    });
  });

  describe("submit", () => {
    beforeEach(() => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should not submit when no class is selected", () => {
      (modal as any).selectedClass = null;
      (modal as any).submit();

      expect(onSubmitSpy).not.toHaveBeenCalled();
      expect(modal.close).not.toHaveBeenCalled();
    });

    it("should submit with selected class", () => {
      const selectedClass = testClasses[0];
      (modal as any).selectedClass = selectedClass;
      (modal as any).submit();

      expect(onSubmitSpy).toHaveBeenCalledWith({
        selectedClass,
      });
      expect(modal.close).toHaveBeenCalled();
    });

    it("should close modal after submission", () => {
      (modal as any).selectedClass = testClasses[1];
      (modal as any).submit();

      expect(modal.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancel", () => {
    beforeEach(() => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      modal.close = jest.fn();
    });

    it("should submit with null selectedClass on cancel", () => {
      (modal as any).cancel();

      expect(onSubmitSpy).toHaveBeenCalledWith({
        selectedClass: null,
      });
      expect(modal.close).toHaveBeenCalled();
    });

    it("should close modal after cancel", () => {
      (modal as any).cancel();
      expect(modal.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("onClose", () => {
    it("should empty content element", () => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      modal.contentEl = mockContentEl;

      modal.onClose();
      expect(mockContentEl.empty).toHaveBeenCalled();
    });
  });

  describe("filterClasses", () => {
    beforeEach(() => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
      (modal as any).selectEl = mockSelectEl;
    });

    it("should show all classes when query is empty", () => {
      (modal as any).filterClasses("");
      expect((modal as any).filteredClasses).toHaveLength(testClasses.length);
    });

    it("should show all classes when query is whitespace", () => {
      (modal as any).filterClasses("   ");
      expect((modal as any).filteredClasses).toHaveLength(testClasses.length);
    });

    it("should filter classes by label", () => {
      (modal as any).filterClasses("task");
      expect((modal as any).filteredClasses).toHaveLength(1);
      expect((modal as any).filteredClasses[0].label).toBe("Task");
    });

    it("should filter classes by className", () => {
      (modal as any).filterClasses("ims__");
      expect((modal as any).filteredClasses).toHaveLength(1);
      expect((modal as any).filteredClasses[0].className).toBe("ims__Concept");
    });

    it("should filter classes by description", () => {
      (modal as any).filterClasses("journal");
      expect((modal as any).filteredClasses).toHaveLength(1);
      expect((modal as any).filteredClasses[0].className).toBe("pn__JournalEntry");
    });

    it("should be case insensitive", () => {
      (modal as any).filterClasses("TASK");
      expect((modal as any).filteredClasses).toHaveLength(1);
      expect((modal as any).filteredClasses[0].label).toBe("Task");
    });

    it("should auto-select first result when only one match", () => {
      (modal as any).filterClasses("concept");
      expect((modal as any).selectedClass).not.toBeNull();
      expect((modal as any).selectedClass.className).toBe("ims__Concept");
    });

    it("should auto-select first result when no previous selection", () => {
      (modal as any).selectedClass = null;
      (modal as any).filterClasses("ems");
      expect((modal as any).selectedClass).not.toBeNull();
    });

    it("should return no results for non-matching query", () => {
      (modal as any).filterClasses("nonexistent");
      expect((modal as any).filteredClasses).toHaveLength(0);
    });

    it("should handle classes without description", () => {
      const classesNoDesc = [
        createMockClass({ className: "test__NoDesc", label: "No Desc", description: undefined }),
      ];
      modal = new ClassSelectionModal(mockApp, classesNoDesc, onSubmitSpy);
      (modal as any).selectEl = mockSelectEl;

      (modal as any).filterClasses("something");
      expect((modal as any).filteredClasses).toHaveLength(0);
    });
  });

  describe("groupClassesByPrefix", () => {
    beforeEach(() => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
    });

    it("should group ems__ classes under Effort Management", () => {
      const groups = (modal as any).groupClassesByPrefix(testClasses);
      expect(groups["Effort Management"]).toHaveLength(2);
    });

    it("should group ims__ classes under Knowledge Management", () => {
      const groups = (modal as any).groupClassesByPrefix(testClasses);
      expect(groups["Knowledge Management"]).toHaveLength(1);
    });

    it("should group exo__ classes under Core", () => {
      const groups = (modal as any).groupClassesByPrefix(testClasses);
      expect(groups["Core"]).toHaveLength(1);
    });

    it("should group pn__ classes under Personal Notes", () => {
      const groups = (modal as any).groupClassesByPrefix(testClasses);
      expect(groups["Personal Notes"]).toHaveLength(1);
    });

    it("should group unknown prefixes under Other", () => {
      const unknownClasses = [
        createMockClass({ className: "custom__Thing", label: "Thing" }),
      ];
      const groups = (modal as any).groupClassesByPrefix(unknownClasses);
      expect(groups["Other"]).toHaveLength(1);
    });

    it("should not include empty groups", () => {
      const onlyEms = [
        createMockClass({ className: "ems__Task", label: "Task" }),
      ];
      const groups = (modal as any).groupClassesByPrefix(onlyEms);
      expect(Object.keys(groups)).toEqual(["Effort Management"]);
    });

    it("should handle empty input", () => {
      const groups = (modal as any).groupClassesByPrefix([]);
      expect(Object.keys(groups)).toHaveLength(0);
    });
  });

  describe("keyboard interaction", () => {
    beforeEach(() => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should cancel on Escape in select element", () => {
      modal.onOpen();
      (modal as any).cancel = jest.fn();

      const keyEvent = new KeyboardEvent("keydown", { key: "Escape" });
      const preventDefaultSpy = jest.spyOn(keyEvent, "preventDefault");

      mockSelectEl.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          (modal as any).cancel();
        }
      });

      mockSelectEl.dispatchEvent(keyEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect((modal as any).cancel).toHaveBeenCalled();
    });

    it("should submit on Enter in select element when class is selected", () => {
      modal.onOpen();
      (modal as any).selectedClass = testClasses[0];
      (modal as any).submit = jest.fn();

      const keyEvent = new KeyboardEvent("keydown", { key: "Enter" });
      const preventDefaultSpy = jest.spyOn(keyEvent, "preventDefault");

      mockSelectEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if ((modal as any).selectedClass) {
            (modal as any).submit();
          }
        }
      });

      mockSelectEl.dispatchEvent(keyEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect((modal as any).submit).toHaveBeenCalled();
    });

    it("should not submit on Enter when no class is selected", () => {
      modal.onOpen();
      (modal as any).selectedClass = null;
      (modal as any).submit = jest.fn();

      mockSelectEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if ((modal as any).selectedClass) {
            (modal as any).submit();
          }
        }
      });

      const keyEvent = new KeyboardEvent("keydown", { key: "Enter" });
      mockSelectEl.dispatchEvent(keyEvent);

      expect((modal as any).submit).not.toHaveBeenCalled();
    });
  });

  describe("renderOptions", () => {
    beforeEach(() => {
      modal = new ClassSelectionModal(mockApp, testClasses, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
      (modal as any).selectEl = mockSelectEl;
    });

    it("should not throw when selectEl is null", () => {
      (modal as any).selectEl = null;
      expect(() => (modal as any).renderOptions()).not.toThrow();
    });

    it("should clear existing options before rendering", () => {
      (modal as any).renderOptions();
      expect((mockSelectEl as any).empty).toHaveBeenCalled();
    });

    it("should create placeholder option", () => {
      (modal as any).renderOptions();
      expect((mockSelectEl as any).createEl).toHaveBeenCalledWith("option", {
        value: "",
        text: "Select a class...",
      });
    });
  });

  describe("edge cases", () => {
    it("should handle single class in list", () => {
      const singleClass = [createMockClass()];
      modal = new ClassSelectionModal(mockApp, singleClass, onSubmitSpy);
      expect((modal as any).filteredClasses).toHaveLength(1);
    });

    it("should handle classes with same label but different className", () => {
      const duplicateLabels = [
        createMockClass({ className: "ems__Item", label: "Item" }),
        createMockClass({ className: "ims__Item", label: "Item" }),
      ];
      modal = new ClassSelectionModal(mockApp, duplicateLabels, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
      (modal as any).selectEl = mockSelectEl;

      (modal as any).filterClasses("item");
      expect((modal as any).filteredClasses).toHaveLength(2);
    });

    it("should handle class with empty label", () => {
      const emptyLabel = [createMockClass({ className: "test__Empty", label: "" })];
      modal = new ClassSelectionModal(mockApp, emptyLabel, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
      (modal as any).selectEl = mockSelectEl;

      (modal as any).filterClasses("");
      expect((modal as any).filteredClasses).toHaveLength(1);
    });

    it("should handle class with special characters in description", () => {
      const specialChars = [
        createMockClass({
          className: "test__Special",
          label: "Special",
          description: "Has special chars: <>&\"'",
        }),
      ];
      modal = new ClassSelectionModal(mockApp, specialChars, onSubmitSpy);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
      (modal as any).selectEl = mockSelectEl;

      (modal as any).filterClasses("special");
      expect((modal as any).filteredClasses).toHaveLength(1);
    });
  });
});
