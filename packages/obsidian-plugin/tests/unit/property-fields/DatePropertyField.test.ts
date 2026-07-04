import { PropertyFieldType } from "@kitelev/exocortex-core";
import { DatePropertyField } from "../../../src/presentation/components/property-fields/DatePropertyField";
// Cross-package import of the shared CI-robust Date-subclass helper (precedent:
// DynamicForm.test.tsx after #3810). Locks the DatePropertyField parse-fallback
// branch (#3810 / #3811 LOW #2): a non-YYYY-MM-DD(T) datetime value routed
// through `new Date()` → `DateFormatter.toDateString` must yield the LOCAL day.
import { installFakeOffsetDate } from "../../../../core/tests/helpers/installFakeOffsetDate";

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

  describe("parse-fallback branch — LOCAL calendar day at the UTC boundary (#3810 / #3811 LOW #2)", () => {
    // A datetime `value` that is neither plain `YYYY-MM-DD` nor `YYYY-MM-DDT…`
    // reaches the `new Date(value)` fallback (DatePropertyField.parseToDateInputValue
    // :100-108), which #3810 routed through `DateFormatter.toDateString` (local)
    // instead of the former `toISOString().split("T")[0]` (UTC). At an instant
    // just after LOCAL midnight in a UTC+N timezone the two disagree by a day.
    // CI-robust via the shared `installFakeOffsetDate` Date-subclass — a UTC
    // runner sees local === UTC, so a plain test would pass both ways.
    it("routes a near-UTC-midnight datetime value to TODAY's LOCAL day, not the UTC previous day", () => {
      // 2026-07-02T19:27:00Z = 2026-07-03T00:27 local (Almaty, UTC+5): local day 03, UTC day 02.
      const restore = installFakeOffsetDate(5, "2026-07-02T19:27:00Z");
      try {
        // Guard: prove the simulated tz is active (else the assertion is vacuous
        // in a UTC-tz runner and silently passes both ways — fail loud).
        expect(new Date().getHours()).toBe(0); // 00:27 local
        expect(new Date().getUTCDate()).toBe(2); // still July 2 in UTC

        // A space-separated UTC datetime — not YYYY-MM-DD, not YYYY-MM-DDT… — so
        // it falls through to the `new Date()` + toDateString branch.
        new DatePropertyField(containerEl, {
          property: {
            uri: "exo:dueDate",
            name: "exo__Asset_dueDate",
            label: "Due Date",
            fieldType: PropertyFieldType.Date,
          },
          value: "2026-07-02 19:27:00Z",
          onChange: jest.fn(),
        });

        const input = containerEl.querySelector("input") as HTMLInputElement | null;
        // LOCAL day = 2026-07-03. The former UTC `.split("T")[0]` produced "2026-07-02".
        expect(input!.value).toBe("2026-07-03");
        expect(input!.value).not.toBe("2026-07-02");
      } finally {
        restore();
      }
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
