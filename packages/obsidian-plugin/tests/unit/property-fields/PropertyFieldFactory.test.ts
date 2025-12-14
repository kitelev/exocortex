import { PropertyFieldType } from "exocortex";
import { PropertyFieldFactory } from "../../../src/presentation/components/property-fields/PropertyFieldFactory";

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
  (el as any).createEl = (tag: string, options?: { cls?: string; text?: string; type?: string; placeholder?: string; value?: string }) => {
    const elem = document.createElement(tag);
    if (options?.cls) elem.className = options.cls;
    if (options?.text) elem.textContent = options.text;
    if (options?.type && elem instanceof HTMLInputElement) elem.type = options.type;
    if (options?.placeholder && elem instanceof HTMLInputElement) elem.placeholder = options.placeholder;
    if (options?.value && elem instanceof HTMLInputElement) elem.value = options.value;
    extendElement(elem as HTMLElement);
    el.appendChild(elem);
    return elem;
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
        onChange: (cb: (v: string) => void) => {
          input.addEventListener("input", (e) =>
            cb((e.target as HTMLInputElement).value),
          );
          return text;
        },
      };
      this.controlEl.appendChild(input);
      cb(text);
      return this;
    }

    addToggle(cb: (toggle: any) => void) {
      const checkbox = extendElement(document.createElement("input")) as HTMLInputElement;
      checkbox.type = "checkbox";
      const toggle = {
        toggleEl: checkbox,
        getValue: () => checkbox.checked,
        setValue: (v: boolean) => {
          checkbox.checked = v;
          return toggle;
        },
        setDisabled: (v: boolean) => {
          checkbox.disabled = v;
          return toggle;
        },
        onChange: (cb: (v: boolean) => void) => {
          checkbox.addEventListener("change", () => cb(checkbox.checked));
          return toggle;
        },
      };
      this.controlEl.appendChild(checkbox);
      cb(toggle);
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
        onChange: (cb: (v: string) => void) => {
          select.addEventListener("change", () => cb(select.value));
          return dropdown;
        },
      };
      this.controlEl.appendChild(select);
      cb(dropdown);
      return this;
    }
  },
  App: class {},
  TFile: class {},
}));

describe("PropertyFieldFactory", () => {
  let containerEl: HTMLDivElement;
  let factory: PropertyFieldFactory;

  beforeEach(() => {
    containerEl = document.createElement("div");
    factory = new PropertyFieldFactory();
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("create", () => {
    it("should create TextPropertyField for Text field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "Test",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("TextPropertyField");
    });

    it("should create DatePropertyField for Date field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:date",
          name: "exo__Asset_date",
          label: "Date",
          fieldType: PropertyFieldType.Date,
        },
        value: "2024-12-31",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("DatePropertyField");
    });

    it("should create DateTimePropertyField for DateTime field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:datetime",
          name: "exo__Asset_datetime",
          label: "DateTime",
          fieldType: PropertyFieldType.DateTime,
        },
        value: "2024-12-31T14:30:00.000Z",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("DateTimePropertyField");
    });

    it("should create NumberPropertyField for Number field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 42,
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("NumberPropertyField");
    });

    it("should create BooleanPropertyField for Boolean field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:active",
          name: "exo__Asset_active",
          label: "Active",
          fieldType: PropertyFieldType.Boolean,
        },
        value: true,
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("BooleanPropertyField");
    });

    it("should create EnumPropertyField for Enum field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:priority",
          name: "exo__Asset_priority",
          label: "Priority",
          fieldType: PropertyFieldType.Enum,
          options: [
            { value: "high", label: "High" },
            { value: "low", label: "Low" },
          ],
        },
        value: "high",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("EnumPropertyField");
    });

    it("should create StatusSelectPropertyField for StatusSelect field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "ems:status",
          name: "ems__Effort_status",
          label: "Status",
          fieldType: PropertyFieldType.StatusSelect,
        },
        value: "[[ems__EffortStatusDoing]]",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("StatusSelectPropertyField");
    });

    it("should create SizeSelectPropertyField for SizeSelect field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "ems:taskSize",
          name: "ems__Effort_taskSize",
          label: "Size",
          fieldType: PropertyFieldType.SizeSelect,
        },
        value: "[[ems__TaskSize_M]]",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("SizeSelectPropertyField");
    });

    it("should create WikilinkPropertyField for Wikilink field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Wikilink,
        },
        value: "[[Project]]",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("WikilinkPropertyField");
    });

    it("should create TimestampPropertyField for Timestamp field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:createdAt",
          name: "exo__Asset_createdAt",
          label: "Created At",
          fieldType: PropertyFieldType.Timestamp,
        },
        value: "2024-12-09T14:30:00.000Z",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("TimestampPropertyField");
    });

    it("should create TextPropertyField for Unknown field type", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:unknown",
          name: "exo__Asset_unknown",
          label: "Unknown",
          fieldType: PropertyFieldType.Unknown,
        },
        value: "test",
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
      expect(field.constructor.name).toBe("TextPropertyField");
    });

    it("should handle null/undefined values", () => {
      const field = factory.create({
        containerEl,
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: null,
        onChange: jest.fn(),
      });

      expect(field).toBeDefined();
    });
  });

  describe("isSupported", () => {
    it("should return true for supported field types", () => {
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Text)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Number)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Boolean)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Date)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.DateTime)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Reference)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Enum)).toBe(
        true,
      );
      expect(
        PropertyFieldFactory.isSupported(PropertyFieldType.StatusSelect),
      ).toBe(true);
      expect(
        PropertyFieldFactory.isSupported(PropertyFieldType.SizeSelect),
      ).toBe(true);
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Wikilink)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Timestamp)).toBe(
        true,
      );
      expect(PropertyFieldFactory.isSupported(PropertyFieldType.Unknown)).toBe(
        true,
      );
    });
  });

  describe("getFieldTypeName", () => {
    it("should return correct names for field types", () => {
      expect(PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Text)).toBe(
        "Text",
      );
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Number),
      ).toBe("Number");
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Boolean),
      ).toBe("Boolean");
      expect(PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Date)).toBe(
        "Date",
      );
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.DateTime),
      ).toBe("Date & Time");
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Reference),
      ).toBe("Reference");
      expect(PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Enum)).toBe(
        "Selection",
      );
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.StatusSelect),
      ).toBe("Status");
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.SizeSelect),
      ).toBe("Size");
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Wikilink),
      ).toBe("Link");
      expect(
        PropertyFieldFactory.getFieldTypeName(PropertyFieldType.Timestamp),
      ).toBe("Timestamp");
    });
  });

  describe("createAll", () => {
    it("should create multiple fields from property definitions", () => {
      const properties = [
        {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
      ];

      const values = {
        exo__Asset_label: "Test",
        exo__Asset_count: 42,
      };

      const fields = factory.createAll(
        containerEl,
        properties,
        values,
        jest.fn(),
      );

      expect(fields).toHaveLength(2);
      expect(fields[0].constructor.name).toBe("TextPropertyField");
      expect(fields[1].constructor.name).toBe("NumberPropertyField");
    });
  });

  describe("destroyAll", () => {
    it("should destroy all field instances", () => {
      const field1 = factory.create({
        containerEl,
        property: {
          uri: "exo:label",
          name: "exo__Asset_label",
          label: "Label",
          fieldType: PropertyFieldType.Text,
        },
        value: "Test",
        onChange: jest.fn(),
      });

      const field2 = factory.create({
        containerEl,
        property: {
          uri: "exo:count",
          name: "exo__Asset_count",
          label: "Count",
          fieldType: PropertyFieldType.Number,
        },
        value: 42,
        onChange: jest.fn(),
      });

      // Should have children before destroy
      expect(containerEl.children.length).toBeGreaterThan(0);

      factory.destroyAll([field1, field2]);

      // Children should be removed after destroy
      expect(containerEl.children.length).toBe(0);
    });
  });
});
