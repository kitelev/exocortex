import { PropertyFieldType } from "exocortex";
import { DatePropertyField } from "../../../src/presentation/components/property-fields/DatePropertyField";

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

describe("DatePropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render a date input", () => {
      new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "2024-12-31",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.type).toBe("date");
    });

    it("should set initial value in YYYY-MM-DD format", () => {
      new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "2024-12-31",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("2024-12-31");
    });

    it("should parse ISO datetime format and extract date", () => {
      new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "2024-12-31T14:30:00.000Z",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("2024-12-31");
    });

    it("should handle empty value", () => {
      new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("");
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
          required: true,
        },
        value: "",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Due Date is required");
    });

    it("should pass validation when value is provided", () => {
      const field = new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
          required: true,
        },
        value: "2024-12-31",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should validate date format", () => {
      const field = new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "not-a-date",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Due Date must be a valid date (YYYY-MM-DD)");
    });
  });

  describe("setValue", () => {
    it("should update the input value", () => {
      const field = new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "2024-01-01",
        onChange: jest.fn(),
      });

      field.setValue("2024-12-31");
      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("2024-12-31");
    });
  });

  describe("static methods", () => {
    it("should return today's date", () => {
      const today = DatePropertyField.today();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new DatePropertyField(containerEl, {
        property: {
          uri: "exo:dueDate",
          name: "exo__Asset_dueDate",
          label: "Due Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "2024-12-31",
        onChange: jest.fn(),
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
