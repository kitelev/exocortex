import { PropertyFieldType } from "exocortex";
import { SizeSelectPropertyField, TASK_SIZE_OPTIONS } from "../../../src/presentation/components/property-fields/SizeSelectPropertyField";

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

describe("SizeSelectPropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("TASK_SIZE_OPTIONS", () => {
    it("should have all size options defined", () => {
      expect(TASK_SIZE_OPTIONS).toHaveLength(6);
      expect(TASK_SIZE_OPTIONS.map(o => o.label)).toEqual(["XXS", "XS", "S", "M", "L", "XL"]);
    });
  });

  describe("constructor", () => {
    it("should render a select dropdown", () => {
      new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
        },
        value: "[[ems__TaskSize_M]]",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select).not.toBeNull();
    });

    it("should set initial value", () => {
      new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
        },
        value: "[[ems__TaskSize_M]]",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select!.value).toBe("[[ems__TaskSize_M]]");
    });

    it("should normalize value without brackets", () => {
      new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
        },
        value: "ems__TaskSize_L",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select!.value).toBe("[[ems__TaskSize_L]]");
    });

    it("should normalize value from label", () => {
      new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
        },
        value: "m",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select!.value).toBe("[[ems__TaskSize_M]]");
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
          required: true,
        },
        value: "",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Task Size is required");
    });

    it("should pass validation when value is provided", () => {
      const field = new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
          required: true,
        },
        value: "[[ems__TaskSize_M]]",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });
  });

  describe("setValue", () => {
    it("should update the select value", () => {
      const field = new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
        },
        value: "[[ems__TaskSize_M]]",
        onChange: jest.fn(),
      });

      field.setValue("[[ems__TaskSize_XL]]");
      const select = containerEl.querySelector("select") as HTMLSelectElement | null;
      expect(select!.value).toBe("[[ems__TaskSize_XL]]");
    });
  });

  describe("getLabel static method", () => {
    it("should return label for wikilink value", () => {
      expect(SizeSelectPropertyField.getLabel("[[ems__TaskSize_M]]")).toBe("M");
    });

    it("should return label for value without brackets", () => {
      expect(SizeSelectPropertyField.getLabel("ems__TaskSize_L")).toBe("L");
    });

    it("should return dash for empty value", () => {
      expect(SizeSelectPropertyField.getLabel("")).toBe("-");
    });

    it("should return original value if not found", () => {
      expect(SizeSelectPropertyField.getLabel("unknown")).toBe("unknown");
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new SizeSelectPropertyField(containerEl, {
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Task Size",
          fieldType: PropertyFieldType.SizeSelect,
        },
        value: "[[ems__TaskSize_M]]",
        onChange: jest.fn(),
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
