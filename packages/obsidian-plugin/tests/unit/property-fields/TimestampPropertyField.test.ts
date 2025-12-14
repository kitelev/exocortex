import { PropertyFieldType } from "exocortex";
import { TimestampPropertyField } from "../../../src/presentation/components/property-fields/TimestampPropertyField";

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
  },
}));

describe("TimestampPropertyField", () => {
  let containerEl: HTMLDivElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render a display element", () => {
      new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "2024-12-09T14:30:00.000Z",
      });

      const display = containerEl.querySelector(".property-field-timestamp-display");
      expect(display).not.toBeNull();
    });

    it("should format timestamp as human-readable", () => {
      new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "2024-12-09T14:30:00.000Z",
      });

      const display = containerEl.querySelector(".property-field-timestamp-display");
      // Check that it contains some date parts (exact format depends on locale)
      expect(display!.textContent).toContain("2024");
    });

    it("should show 'Not set' for empty value", () => {
      new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "",
      });

      const display = containerEl.querySelector(".property-field-timestamp-display");
      expect(display!.textContent).toBe("Not set");
    });

    it("should show raw value for invalid date", () => {
      new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "not-a-date",
      });

      const display = containerEl.querySelector(".property-field-timestamp-display");
      expect(display!.textContent).toBe("not-a-date");
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
          required: true,
        },
        value: "",
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Created At is required");
    });

    it("should pass validation when value is provided", () => {
      const field = new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
          required: true,
        },
        value: "2024-12-09T14:30:00.000Z",
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should fail validation for invalid timestamp", () => {
      const field = new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "not-a-date",
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Created At is not a valid timestamp");
    });
  });

  describe("setValue", () => {
    it("should update the display", () => {
      const field = new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "2024-01-01T00:00:00.000Z",
      });

      field.setValue("2024-06-15T12:00:00.000Z");
      const display = containerEl.querySelector(".property-field-timestamp-display");
      // Check the display was updated (contains month indicator for June)
      expect(display!.textContent).toContain("Jun");
    });
  });

  describe("format static method", () => {
    it("should format timestamp with default options", () => {
      const formatted = TimestampPropertyField.format("2024-12-09T14:30:00.000Z");
      expect(formatted).toContain("2024");
    });

    it("should return 'Not set' for empty value", () => {
      const formatted = TimestampPropertyField.format("");
      expect(formatted).toBe("Not set");
    });

    it("should return raw value for invalid date", () => {
      const formatted = TimestampPropertyField.format("invalid");
      expect(formatted).toBe("invalid");
    });
  });

  describe("formatRelative static method", () => {
    it("should format recent timestamp as 'Just now'", () => {
      const now = new Date().toISOString();
      const formatted = TimestampPropertyField.formatRelative(now);
      expect(formatted).toBe("Just now");
    });

    it("should format minutes ago", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const formatted = TimestampPropertyField.formatRelative(fiveMinutesAgo);
      expect(formatted).toContain("minute");
    });

    it("should format hours ago", () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const formatted = TimestampPropertyField.formatRelative(threeHoursAgo);
      expect(formatted).toContain("hour");
    });

    it("should format days ago", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const formatted = TimestampPropertyField.formatRelative(twoDaysAgo);
      expect(formatted).toContain("day");
    });

    it("should return 'Not set' for empty value", () => {
      const formatted = TimestampPropertyField.formatRelative("");
      expect(formatted).toBe("Not set");
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new TimestampPropertyField(containerEl, {
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "2024-12-09T14:30:00.000Z",
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
