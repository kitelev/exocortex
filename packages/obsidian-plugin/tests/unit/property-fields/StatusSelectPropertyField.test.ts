import { PropertyFieldType } from "exocortex";
import {
  StatusSelectPropertyField,
  EFFORT_STATUS_OPTIONS,
} from "../../../src/presentation/components/property-fields/StatusSelectPropertyField";

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
        setDisabled: (v: boolean) => {
          select.disabled = v;
          return dropdown;
        },
        onChange: (handler: (v: string) => void) => {
          select.addEventListener("change", () => handler(select.value));
          return dropdown;
        },
      };
      this.controlEl.appendChild(select);
      cb(dropdown);
      return this;
    }
  },
}));

describe("StatusSelectPropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("EFFORT_STATUS_OPTIONS", () => {
    it("should contain all expected status options", () => {
      const expectedLabels = [
        "Draft",
        "Backlog",
        "Analysis",
        "To Do",
        "Doing",
        "Done",
        "Trashed",
      ];

      const actualLabels = EFFORT_STATUS_OPTIONS.map((opt) => opt.label);
      expect(actualLabels).toEqual(expectedLabels);
    });

    it("should have wikilink format for values", () => {
      for (const option of EFFORT_STATUS_OPTIONS) {
        expect(option.value).toMatch(/^\[\[ems__EffortStatus\w+\]\]$/);
      }
    });
  });

  describe("constructor", () => {
    it("should render a select dropdown", () => {
      new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
        },
        value: "",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector(
        "select",
      ) as HTMLSelectElement | null;
      expect(select).not.toBeNull();
    });

    it("should include 'Not specified' option when not required", () => {
      new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
          required: false,
        },
        value: "",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector(
        "select",
      ) as HTMLSelectElement | null;
      const options = select!.querySelectorAll("option");

      // "Not specified" + 7 status options = 8 total
      expect(options.length).toBe(8);
      expect(options[0].textContent).toBe("Not specified");
    });

    it("should set initial value correctly", () => {
      new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
        },
        value: "[[ems__EffortStatusDoing]]",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector(
        "select",
      ) as HTMLSelectElement | null;
      expect(select!.value).toBe("[[ems__EffortStatusDoing]]");
    });
  });

  describe("value normalization", () => {
    it("should normalize value with extra quotes", () => {
      new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
        },
        value: '"[[ems__EffortStatusDoing]]"',
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector(
        "select",
      ) as HTMLSelectElement | null;
      // Should normalize to the matching option value
      expect(select!.value).toBe("[[ems__EffortStatusDoing]]");
    });

    it("should normalize value without brackets", () => {
      new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
        },
        value: "ems__EffortStatusDoing",
        onChange: jest.fn(),
      });

      const select = containerEl.querySelector(
        "select",
      ) as HTMLSelectElement | null;
      expect(select!.value).toBe("[[ems__EffortStatusDoing]]");
    });
  });

  describe("getLabel static method", () => {
    it("should return correct label for status value", () => {
      expect(StatusSelectPropertyField.getLabel("[[ems__EffortStatusDoing]]")).toBe(
        "Doing",
      );
      expect(StatusSelectPropertyField.getLabel("[[ems__EffortStatusDone]]")).toBe(
        "Done",
      );
      expect(StatusSelectPropertyField.getLabel("[[ems__EffortStatusDraft]]")).toBe(
        "Draft",
      );
    });

    it("should handle value without brackets", () => {
      expect(StatusSelectPropertyField.getLabel("ems__EffortStatusDoing")).toBe(
        "Doing",
      );
    });

    it("should return '-' for empty value", () => {
      expect(StatusSelectPropertyField.getLabel("")).toBe("-");
    });

    it("should return original value for unknown status", () => {
      expect(StatusSelectPropertyField.getLabel("unknown_status")).toBe(
        "unknown_status",
      );
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
          required: true,
        },
        value: "",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Status is required");
    });

    it("should pass validation with valid status", () => {
      const field = new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
          required: true,
        },
        value: "[[ems__EffortStatusDoing]]",
        onChange: jest.fn(),
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new StatusSelectPropertyField(containerEl, {
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
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
