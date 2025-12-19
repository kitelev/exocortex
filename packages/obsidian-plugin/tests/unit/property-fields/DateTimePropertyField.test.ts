import { PropertyFieldType } from "exocortex";
import { DateTimePropertyField } from "../../../src/presentation/components/property-fields/DateTimePropertyField";

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

describe("DateTimePropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render datetime-local input", () => {
      new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector(
        "input",
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.type).toBe("datetime-local");
    });

    it("should set the label correctly", () => {
      new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "",
        onChange: jest.fn(),
      });

      // The Setting mock structure: settingEl > [nameEl, descEl, controlEl]
      // We need to check the first child's first child for the name text
      const settingEl = containerEl.firstChild;
      const nameEl = settingEl?.firstChild;
      // textContent may include child nodes, so use childNodes[0] for text node
      expect(nameEl?.childNodes[0]?.textContent).toBe("Start Time");
    });
  });

  describe("value parsing", () => {
    it("should parse ISO 8601 datetime string", () => {
      new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "2024-12-31T14:30:00.000Z",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector(
        "input",
      ) as HTMLInputElement | null;
      // The value should be converted to datetime-local format (YYYY-MM-DDTHH:mm)
      expect(input!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it("should handle empty value", () => {
      new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "",
        onChange: jest.fn(),
      });

      const input = containerEl.querySelector(
        "input",
      ) as HTMLInputElement | null;
      expect(input!.value).toBe("");
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
          required: true,
        },
        value: "",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Start Time is required");
    });

    it("should pass validation for valid datetime", () => {
      const field = new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "2024-12-31T14:30:00.000Z",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should fail validation for invalid datetime", () => {
      const field = new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "not-a-date",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
    });
  });

  describe("static methods", () => {
    it("should generate current datetime with now() in local timestamp format", () => {
      const now = DateTimePropertyField.now();
      // Local timestamp format: YYYY-MM-DDTHH:mm:ss (no Z suffix)
      expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it("should format Date object with formatDate() as local timestamp", () => {
      // Create a date and format it - result should match local time components
      const date = new Date(2024, 11, 31, 14, 30, 0); // Dec 31, 2024, 14:30:00 local
      const formatted = DateTimePropertyField.formatDate(date);
      expect(formatted).toBe("2024-12-31T14:30:00");
    });
  });

  describe("focus", () => {
    it("should focus the input element", () => {
      const field = new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "",
        onChange: jest.fn(),
      });

      const input = field.getInputEl();
      expect(input).not.toBeNull();

      // Mock focus
      const focusSpy = jest.spyOn(input!, "focus");
      field.focus();
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new DateTimePropertyField(containerEl, {
        property: {
          uri: "ems:startTime",
          name: "ems__Effort_startTimestamp",
          label: "Start Time",
          fieldType: PropertyFieldType.DateTime,
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
