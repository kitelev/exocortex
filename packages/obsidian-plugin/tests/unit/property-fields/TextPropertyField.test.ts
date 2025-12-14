import { PropertyFieldType } from "exocortex";
import { TextPropertyField } from "../../../src/presentation/components/property-fields/TextPropertyField";

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

    addText(cb: (text: any) => void) {
      const input = extendElement(document.createElement("input")) as HTMLInputElement;
      const text = {
        inputEl: input,
        setPlaceholder: (p: string) => {
          input.placeholder = p;
          return text;
        },
        setValue: (v: string) => {
          input.value = v;
          return text;
        },
        onChange: (handler: (v: string) => void) => {
          input.addEventListener("input", (e) =>
            handler((e.target as HTMLInputElement).value),
          );
          return text;
        },
      };
      this.controlEl.appendChild(input);
      cb(text);
      return this;
    }
  },
}));

describe("TextPropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render a text input", () => {
      new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "Test Value",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.type).toBe("text");
    });

    it("should set initial value", () => {
      new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "Test Value",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("Test Value");
    });

    it("should set maxLength when provided", () => {
      new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
          maxLength: 100,
        },
        value: "",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.maxLength).toBe(100);
    });

    it("should set pattern when provided", () => {
      new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
          pattern: "^[A-Z].*",
        },
        value: "",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.pattern).toBe("^[A-Z].*");
    });

    it("should disable input when disabled prop is true", () => {
      new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "",
        onChange: jest.fn(),
        disabled: true,
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.disabled).toBe(true);
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
          required: true,
        },
        value: "",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Label is required");
    });

    it("should pass validation when value is provided", () => {
      const field = new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
          required: true,
        },
        value: "Test",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should validate maxLength", () => {
      const field = new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
          maxLength: 5,
        },
        value: "Too Long Value",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Label must be at most 5 characters");
    });

    it("should validate pattern", () => {
      const field = new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
          pattern: "^[A-Z].*",
        },
        value: "lowercase",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Label format is invalid");
    });
  });

  describe("focus", () => {
    it("should focus the input element", () => {
      const field = new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "",
        onChange: jest.fn(),
      });

      const input = field.getInputEl();
      expect(input).not.toBeNull();

      const focusSpy = jest.spyOn(input!, "focus");
      field.focus();
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("setValue", () => {
    it("should update the input value", () => {
      const field = new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "Initial",
        onChange: jest.fn(),
      });

      field.setValue("Updated");
      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("Updated");
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new TextPropertyField(containerEl, {
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "",
        onChange: jest.fn(),
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
