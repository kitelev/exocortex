import { PropertyFieldType } from "exocortex";
import { ReferencePropertyField } from "../../../src/presentation/components/property-fields/ReferencePropertyField";

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
  (el as any).createEl = (tag: string, options?: { type?: string; cls?: string; placeholder?: string }) => {
    const element = document.createElement(tag);
    if (options?.type && element instanceof HTMLInputElement) {
      element.type = options.type;
    }
    if (options?.cls) element.className = options.cls;
    if (options?.placeholder && element instanceof HTMLInputElement) {
      element.placeholder = options.placeholder;
    }
    extendElement(element);
    el.appendChild(element);
    return element;
  };
  (el as any).addClass = (cls: string) => el.classList.add(cls);
  (el as any).removeClass = (cls: string) => el.classList.remove(cls);
  (el as any).empty = () => { el.innerHTML = ""; };
  return el;
}

// Mock TFile
const createMockFile = (basename: string, mtime = Date.now()) => ({
  basename,
  path: `${basename}.md`,
  stat: { mtime },
});

// Mock App with vault
const createMockApp = (files: any[] = []) => ({
  vault: {
    getMarkdownFiles: () => files,
  },
  metadataCache: {
    getFileCache: (file: any) => ({
      frontmatter: {},
    }),
  },
});

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
  TFile: class {},
}));

describe("ReferencePropertyField", () => {
  let containerEl: HTMLDivElement;
  let mockApp: any;

  beforeEach(() => {
    containerEl = document.createElement("div");
    mockApp = createMockApp([
      createMockFile("Project A"),
      createMockFile("Project B"),
      createMockFile("Task 1"),
    ]);
  });

  afterEach(() => {
    containerEl.remove();
  });

  describe("constructor", () => {
    it("should render an input field", () => {
      new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
        },
        value: "[[Project A]]",
        onChange: jest.fn(),
        app: mockApp,
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
    });

    it("should display value without brackets", () => {
      new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
        },
        value: "[[Project A]]",
        onChange: jest.fn(),
        app: mockApp,
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("Project A");
    });

    it("should handle empty value", () => {
      new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
        },
        value: "",
        onChange: jest.fn(),
        app: mockApp,
      });

      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("");
    });

    it("should create suggestions container", () => {
      new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
        },
        value: "",
        onChange: jest.fn(),
        app: mockApp,
      });

      const suggestions = containerEl.querySelector(".property-field-suggestions");
      expect(suggestions).not.toBeNull();
    });
  });

  describe("validation", () => {
    it("should validate required field", () => {
      const field = new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
          required: true,
        },
        value: "",
        onChange: jest.fn(),
        app: mockApp,
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Parent is required");
    });

    it("should pass validation when value is provided", () => {
      const field = new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
          required: true,
        },
        value: "[[Project A]]",
        onChange: jest.fn(),
        app: mockApp,
      });

      const result = field.validate();
      expect(result.valid).toBe(true);
    });

    it("should fail validation for empty brackets", () => {
      const field = new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
        },
        value: "[[]]",
        onChange: jest.fn(),
        app: mockApp,
      });

      const result = field.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Parent is invalid");
    });
  });

  describe("setValue", () => {
    it("should update the input value", () => {
      const field = new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
        },
        value: "[[Old Project]]",
        onChange: jest.fn(),
        app: mockApp,
      });

      field.setValue("[[New Project]]");
      const input = containerEl.querySelector("input") as HTMLInputElement | null;
      expect(input!.value).toBe("New Project");
    });
  });

  describe("destroy", () => {
    it("should remove the setting element", () => {
      const field = new ReferencePropertyField(containerEl, {
        property: {
          uri: "ems:parent",
          name: "ems__Effort_parent",
          label: "Parent",
          fieldType: PropertyFieldType.Reference,
        },
        value: "[[Project A]]",
        onChange: jest.fn(),
        app: mockApp,
      });

      expect(containerEl.children.length).toBeGreaterThan(0);
      field.destroy();
      expect(containerEl.children.length).toBe(0);
    });
  });
});
