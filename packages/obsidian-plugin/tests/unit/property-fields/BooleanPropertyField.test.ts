import { PropertyFieldType } from "exocortex";
import { BooleanPropertyField } from "../../../src/presentation/components/property-fields/BooleanPropertyField";

// Helper to extend HTMLElement with Obsidian's methods
function extendElement(el: HTMLElement): HTMLElement {
  (el as any).createDiv = (options?: { cls?: string; text?: string }) => {
    const div = document.createElement("div");
    if (options?.cls) div.className = options.cls;
    if (options?.text) div.textContent = options.text;
    extendElement(div);
    el.appendChild(div);
    return div;
  };
  (el as any).createSpan = (options?: { cls?: string; text?: string }) => {
    const span = document.createElement("span");
    if (options?.cls) span.className = options.cls;
    if (options?.text) span.textContent = options.text;
    extendElement(span);
    el.appendChild(span);
    return span;
  };
  (el as any).addClass = (cls: string) => el.classList.add(cls);
  (el as any).removeClass = (cls: string) => el.classList.remove(cls);
  (el as any).empty = () => { el.innerHTML = ""; };
  return el;
}

// Mock toggle value storage
let mockToggleValue = false;

// Mock Obsidian's Setting class
jest.mock("obsidian", () => ({
  Setting: class {
    settingEl = extendElement(document.createElement("div"));
    nameEl = extendElement(document.createElement("div"));
    descEl = extendElement(document.createElement("div"));
    controlEl = extendElement(document.createElement("div"));

    constructor(containerEl: HTMLElement) {
      containerEl.appendChild(this.settingEl);
      this.settingEl.appendChild(this.nameEl);
      this.settingEl.appendChild(this.descEl);
      this.settingEl.appendChild(this.controlEl);
    }

    setName(name: string) {
      this.nameEl.textContent = name;
      return this;
    }

    setDesc(desc: string) {
      this.descEl.textContent = desc;
      return this;
    }

    addToggle(cb: (toggle: any) => void) {
      const toggleEl = extendElement(document.createElement("div"));
      toggleEl.className = "checkbox-container";
      const toggle = {
        toggleEl,
        setValue: (v: boolean) => {
          mockToggleValue = v;
          return toggle;
        },
        getValue: () => mockToggleValue,
        onChange: (handler: (v: boolean) => void) => {
          toggleEl.addEventListener("click", () => {
            mockToggleValue = !mockToggleValue;
            handler(mockToggleValue);
          });
          return toggle;
        },
        setDisabled: (disabled: boolean) => {
          if (disabled) {
            toggleEl.classList.add("is-disabled");
          }
          return toggle;
        },
      };
      this.controlEl.appendChild(toggleEl);
      cb(toggle);
      return this;
    }
  },
}));

describe("BooleanPropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
    mockToggleValue = false;
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render a toggle", () => {
      new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: false,
        onChange: jest.fn(),
      });

      const toggle = containerEl.querySelector(".checkbox-container");
      expect(toggle).not.toBeNull();
    });

    it("should set initial value to true", () => {
      new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: true,
        onChange: jest.fn(),
      });

      expect(mockToggleValue).toBe(true);
    });

    it("should set initial value to false", () => {
      new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: false,
        onChange: jest.fn(),
      });

      expect(mockToggleValue).toBe(false);
    });
  });

  describe("parseBoolean", () => {
    it("should parse string 'true' as true", () => {
      new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: "true" as any,
        onChange: jest.fn(),
      });

      expect(mockToggleValue).toBe(true);
    });

    it("should parse string 'false' as false", () => {
      new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: "false" as any,
        onChange: jest.fn(),
      });

      expect(mockToggleValue).toBe(false);
    });

    it("should parse number 1 as true", () => {
      new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: 1 as any,
        onChange: jest.fn(),
      });

      expect(mockToggleValue).toBe(true);
    });

    it("should parse number 0 as false", () => {
      new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: 0 as any,
        onChange: jest.fn(),
      });

      expect(mockToggleValue).toBe(false);
    });
  });

  describe("validation", () => {
    it("should pass validation for boolean value", () => {
      const field = new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: true,
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should fail validation when required and undefined", () => {
      const field = new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
          required: true,
        },
        value: undefined as any,
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Archived is required");
    });
  });

  describe("setValue", () => {
    it("should update the toggle value", () => {
      const field = new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: false,
        onChange: jest.fn(),
      });

      field.setValue(true);
      expect(mockToggleValue).toBe(true);
    });
  });

  describe("getValue", () => {
    it("should return the current value", () => {
      const field = new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: true,
        onChange: jest.fn(),
      });

      expect(field.getValue()).toBe(true);
    });
  });

  describe("toggle", () => {
    it("should toggle the value and call onChange", () => {
      const onChange = jest.fn();
      const field = new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: false,
        onChange,
      });

      field.toggle();
      expect(mockToggleValue).toBe(true);
      expect(onChange).toHaveBeenCalledWith(true);
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new BooleanPropertyField(containerEl, {
        property: {
          uri: "exo:isArchived",
          name: "exo__Asset_isArchived",
          label: "Archived",
          fieldType: PropertyFieldType.Boolean,
        },
        value: false,
        onChange: jest.fn(),
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
