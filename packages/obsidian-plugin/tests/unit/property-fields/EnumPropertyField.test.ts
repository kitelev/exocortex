import { PropertyFieldType } from "exocortex";
import { EnumPropertyField } from "../../../src/presentation/components/property-fields/EnumPropertyField";

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

    addDropdown(cb: (dropdown: any) => void) {
      const select = extendElement(document.createElement("select")) as HTMLSelectElement;
      const dropdown = {
        selectEl: select,
        addOption: (value: string, label: string) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
          return dropdown;
        },
        setValue: (v: string) => {
          select.value = v;
          return dropdown;
        },
        onChange: (handler: (v: string) => void) => {
          select.addEventListener("change", (e) =>
            handler((e.target as HTMLSelectElement).value),
          );
          return dropdown;
        },
        setDisabled: (disabled: boolean) => {
          select.disabled = disabled;
          return dropdown;
        },
      };
      this.controlEl.appendChild(select);
      cb(dropdown);
      return this;
    }
  },
}));

describe("EnumPropertyField", () => {
  let containerEl: HTMLDivElement;

  const testOptions = [
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ];

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render a select dropdown", () => {
      new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
        },
        value: "medium",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select).not.toBeNull();
    });

    it("should render all options", () => {
      new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
        },
        value: "medium",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      // +1 for "Not specified" option when not required
      expect(select!.options.length).toBe(testOptions.length + 1);
    });

    it("should set initial value", () => {
      new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
        },
        value: "high",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select!.value).toBe("high");
    });

    it("should not add empty option when required", () => {
      new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
          required: true,
        },
        value: "medium",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select!.options.length).toBe(testOptions.length);
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
          required: true,
        },
        value: "",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Priority is required");
    });

    it("should pass validation when value is provided", () => {
      const field = new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
          required: true,
        },
        value: "high",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should validate value is in options", () => {
      const field = new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
        },
        value: "invalid",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Priority must be one of the available options");
    });
  });

  describe("setValue", () => {
    it("should update the select value", () => {
      const field = new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
        },
        value: "medium",
        onChange: jest.fn(),
      });

      field.setValue("low");
      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select!.value).toBe("low");
    });
  });

  describe("getOptions", () => {
    it("should return available options", () => {
      const field = new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
        },
        value: "medium",
        onChange: jest.fn(),
      });

      const options = field.getOptions();
      expect(options).toEqual(testOptions);
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new EnumPropertyField(containerEl, {
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: testOptions,
        },
        value: "medium",
        onChange: jest.fn(),
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
