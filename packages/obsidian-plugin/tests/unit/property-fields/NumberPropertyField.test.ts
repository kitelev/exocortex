import { PropertyFieldType } from "exocortex";
import { NumberPropertyField } from "../../../src/presentation/components/property-fields/NumberPropertyField";

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

describe("NumberPropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render a number input", () => {
      new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 42,
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.type).toBe("number");
    });

    it("should set initial value", () => {
      new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 42,
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("42");
    });

    it("should handle null value", () => {
      new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: null,
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("");
    });

    it("should set min constraint", () => {
      new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          minValue: 0,
        },
        value: 10,
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.min).toBe("0");
    });

    it("should set max constraint", () => {
      new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          maxValue: 100,
        },
        value: 10,
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.max).toBe("100");
    });

    it("should set step to any for decimal support", () => {
      new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 10,
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.step).toBe("any");
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          required: true,
        },
        value: null,
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Count is required");
    });

    it("should pass validation when value is provided", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          required: true,
        },
        value: 42,
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should validate min constraint", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          minValue: 10,
        },
        value: 5,
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Count must be at least 10");
    });

    it("should validate max constraint", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          maxValue: 100,
        },
        value: 150,
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Count must be at most 100");
    });
  });

  describe("setValue", () => {
    it("should update the input value", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 10,
        onChange: jest.fn(),
      });

      field.setValue(99);
      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("99");
    });

    it("should handle null value in setValue", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 10,
        onChange: jest.fn(),
      });

      field.setValue(null);
      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("");
    });
  });

  describe("focus", () => {
    it("should focus the input element", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 42,
        onChange: jest.fn(),
      });

      const input = field.getInputEl();
      expect(input).not.toBeNull();
      const focusSpy = jest.spyOn(input!, "focus");
      field.focus();
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("increment/decrement", () => {
    it("should increment the value", () => {
      const onChange = jest.fn();
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 10,
        onChange,
      });

      field.increment();
      expect(onChange).toHaveBeenCalledWith(11);
    });

    it("should decrement the value", () => {
      const onChange = jest.fn();
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 10,
        onChange,
      });

      field.decrement();
      expect(onChange).toHaveBeenCalledWith(9);
    });

    it("should respect max constraint on increment", () => {
      const onChange = jest.fn();
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          maxValue: 10,
        },
        value: 10,
        onChange,
      });

      field.increment();
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it("should respect min constraint on decrement", () => {
      const onChange = jest.fn();
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
          minValue: 0,
        },
        value: 0,
        onChange,
      });

      field.decrement();
      expect(onChange).toHaveBeenCalledWith(0);
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new NumberPropertyField(containerEl, {
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 42,
        onChange: jest.fn(),
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
