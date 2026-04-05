import { App } from "obsidian";
import {
  showSubclassCreationModal,
  showFleetingNoteModal,
  showTrashReasonModal,
  showSupervisionModal,
  showNarrowerConceptModal,
  showLabelInputModal,
  showClassSelectionModal,
} from "../../src/presentation/modals/modalSchemas";
import { DynamicFormModal } from "../../src/presentation/modals/DynamicFormModal";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
}));

jest.mock("../../src/presentation/modals/DynamicFormModal");

const MockedDynamicFormModal = DynamicFormModal as jest.MockedClass<typeof DynamicFormModal>;

describe("modalSchemas", () => {
  let mockApp: jest.Mocked<App>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApp = {} as jest.Mocked<App>;
  });

  function mockModalResult(result: Record<string, string> | null): void {
    MockedDynamicFormModal.mockImplementation(() => ({
      waitForResult: jest.fn().mockResolvedValue(result),
      open: jest.fn(),
      close: jest.fn(),
      onOpen: jest.fn(),
      onClose: jest.fn(),
      contentEl: document.createElement("div"),
      app: mockApp,
    } as unknown as DynamicFormModal));
  }

  function getSchemaFromLastCall() {
    return MockedDynamicFormModal.mock.calls[0][1];
  }

  function getOptionsFromLastCall() {
    return MockedDynamicFormModal.mock.calls[0][2];
  }

  describe("showSubclassCreationModal", () => {
    it("should return label when submitted", async () => {
      mockModalResult({ label: "MySubclass" });
      const result = await showSubclassCreationModal(mockApp);
      expect(result).toEqual({ label: "MySubclass" });
    });

    it("should return null label when cancelled", async () => {
      mockModalResult(null);
      const result = await showSubclassCreationModal(mockApp);
      expect(result).toEqual({ label: null });
    });

    it("should create schema with required text field", async () => {
      mockModalResult({ label: "test" });
      await showSubclassCreationModal(mockApp);
      const schema = getSchemaFromLastCall();
      expect(schema).toEqual([
        { name: "label", type: "text", label: "Subclass label", required: true },
      ]);
    });

    it("should pass correct title and submit label", async () => {
      mockModalResult({ label: "test" });
      await showSubclassCreationModal(mockApp);
      const options = getOptionsFromLastCall();
      expect(options?.title).toBe("Create subclass");
      expect(options?.submitLabel).toBe("Create");
    });

    it("should trim whitespace from label", async () => {
      mockModalResult({ label: "  trimmed  " });
      const result = await showSubclassCreationModal(mockApp);
      expect(result.label).toBe("trimmed");
    });

    it("should return null for empty string label", async () => {
      mockModalResult({ label: "" });
      const result = await showSubclassCreationModal(mockApp);
      expect(result.label).toBeNull();
    });
  });

  describe("showFleetingNoteModal", () => {
    it("should return label when submitted", async () => {
      mockModalResult({ label: "MyNote" });
      const result = await showFleetingNoteModal(mockApp);
      expect(result).toEqual({ label: "MyNote" });
    });

    it("should return null label when cancelled", async () => {
      mockModalResult(null);
      const result = await showFleetingNoteModal(mockApp);
      expect(result).toEqual({ label: null });
    });

    it("should create schema with required text field", async () => {
      mockModalResult({ label: "test" });
      await showFleetingNoteModal(mockApp);
      const schema = getSchemaFromLastCall();
      expect(schema).toHaveLength(1);
      expect(schema[0]).toMatchObject({ name: "label", type: "text", required: true });
    });
  });

  describe("showTrashReasonModal", () => {
    it("should return confirmed true with reason when submitted", async () => {
      mockModalResult({ reason: "Not needed" });
      const result = await showTrashReasonModal(mockApp);
      expect(result).toEqual({ confirmed: true, reason: "Not needed" });
    });

    it("should return confirmed false when cancelled", async () => {
      mockModalResult(null);
      const result = await showTrashReasonModal(mockApp);
      expect(result).toEqual({ confirmed: false, reason: null });
    });

    it("should return null reason for empty string", async () => {
      mockModalResult({ reason: "" });
      const result = await showTrashReasonModal(mockApp);
      expect(result).toEqual({ confirmed: true, reason: null });
    });

    it("should create schema with optional multiline field", async () => {
      mockModalResult({ reason: "" });
      await showTrashReasonModal(mockApp);
      const schema = getSchemaFromLastCall();
      expect(schema).toHaveLength(1);
      expect(schema[0]).toMatchObject({
        name: "reason",
        type: "multiline",
        required: false,
        rows: 3,
      });
    });

    it("should pass correct title and submit label", async () => {
      mockModalResult({ reason: "" });
      await showTrashReasonModal(mockApp);
      const options = getOptionsFromLastCall();
      expect(options?.title).toBe("Trash effort");
      expect(options?.submitLabel).toBe("Confirm");
    });
  });

  describe("showSupervisionModal", () => {
    it("should return form data when submitted", async () => {
      mockModalResult({
        situation: "A",
        emotions: "B",
        thoughts: "C",
        behavior: "D",
        shortTermConsequences: "E",
        longTermConsequences: "F",
        desiredBehavior: "G",
      });
      const result = await showSupervisionModal(mockApp);
      expect(result).toEqual({
        situation: "A",
        emotions: "B",
        thoughts: "C",
        behavior: "D",
        shortTermConsequences: "E",
        longTermConsequences: "F",
        desiredBehavior: "G",
      });
    });

    it("should return null when cancelled", async () => {
      mockModalResult(null);
      const result = await showSupervisionModal(mockApp);
      expect(result).toBeNull();
    });

    it("should create schema with 7 text fields", async () => {
      mockModalResult(null);
      await showSupervisionModal(mockApp);
      const schema = getSchemaFromLastCall();
      expect(schema).toHaveLength(7);
      expect(schema.every((f: any) => f.type === "text")).toBe(true);
    });

    it("should handle empty fields as empty strings", async () => {
      mockModalResult({
        situation: "",
        emotions: "",
        thoughts: "",
        behavior: "",
        shortTermConsequences: "",
        longTermConsequences: "",
        desiredBehavior: "",
      });
      const result = await showSupervisionModal(mockApp);
      expect(result).toEqual({
        situation: "",
        emotions: "",
        thoughts: "",
        behavior: "",
        shortTermConsequences: "",
        longTermConsequences: "",
        desiredBehavior: "",
      });
    });
  });

  describe("showNarrowerConceptModal", () => {
    it("should return fileName, definition, and aliases when submitted", async () => {
      mockModalResult({
        fileName: "my-concept",
        definition: "A concept",
        aliases: "alias1, alias2",
      });
      const result = await showNarrowerConceptModal(mockApp);
      expect(result).toEqual({
        fileName: "my-concept",
        definition: "A concept",
        aliases: ["alias1", "alias2"],
      });
    });

    it("should return null when cancelled", async () => {
      mockModalResult(null);
      const result = await showNarrowerConceptModal(mockApp);
      expect(result).toEqual({ fileName: null, definition: null, aliases: [] });
    });

    it("should parse comma-separated aliases", async () => {
      mockModalResult({
        fileName: "test",
        definition: "def",
        aliases: " a , b , c ",
      });
      const result = await showNarrowerConceptModal(mockApp);
      expect(result.aliases).toEqual(["a", "b", "c"]);
    });

    it("should return empty aliases for empty string", async () => {
      mockModalResult({ fileName: "test", definition: "def", aliases: "" });
      const result = await showNarrowerConceptModal(mockApp);
      expect(result.aliases).toEqual([]);
    });

    it("should create schema with text, multiline, and text fields", async () => {
      mockModalResult(null);
      await showNarrowerConceptModal(mockApp);
      const schema = getSchemaFromLastCall();
      expect(schema).toHaveLength(3);
      expect(schema[0]).toMatchObject({ name: "fileName", type: "text", required: true });
      expect(schema[1]).toMatchObject({ name: "definition", type: "multiline", required: true });
      expect(schema[2]).toMatchObject({ name: "aliases", type: "text" });
    });
  });

  describe("showLabelInputModal", () => {
    it("should return label, taskSize, and openInNewTab when submitted", async () => {
      mockModalResult({
        label: "My Asset",
        taskSize: '"[[ems__TaskSize_M]]"',
        openInNewTab: "true",
      });
      const result = await showLabelInputModal(mockApp);
      expect(result).toEqual({
        label: "My Asset",
        taskSize: '"[[ems__TaskSize_M]]"',
        openInNewTab: true,
      });
    });

    it("should return cancel result when cancelled", async () => {
      mockModalResult(null);
      const result = await showLabelInputModal(mockApp);
      expect(result).toEqual({ label: null, taskSize: null, openInNewTab: false });
    });

    it("should include task size enum when showTaskSize is true", async () => {
      mockModalResult(null);
      await showLabelInputModal(mockApp, "", true);
      const schema = getSchemaFromLastCall();
      const taskSizeField = schema.find((f: any) => f.name === "taskSize");
      expect(taskSizeField).toBeDefined();
      expect(taskSizeField?.type).toBe("enum");
      expect(taskSizeField?.options).toHaveLength(5);
    });

    it("should exclude task size when showTaskSize is false", async () => {
      mockModalResult(null);
      await showLabelInputModal(mockApp, "", false);
      const schema = getSchemaFromLastCall();
      const taskSizeField = schema.find((f: any) => f.name === "taskSize");
      expect(taskSizeField).toBeUndefined();
    });

    it("should pass default value to label field", async () => {
      mockModalResult(null);
      await showLabelInputModal(mockApp, "default text", true);
      const schema = getSchemaFromLastCall();
      const labelField = schema.find((f: any) => f.name === "label");
      expect(labelField?.defaultValue).toBe("default text");
    });

    it("should include openInNewTab enum field", async () => {
      mockModalResult(null);
      await showLabelInputModal(mockApp);
      const schema = getSchemaFromLastCall();
      const openField = schema.find((f: any) => f.name === "openInNewTab");
      expect(openField).toBeDefined();
      expect(openField?.type).toBe("enum");
    });

    it("should return false for openInNewTab when value is not 'true'", async () => {
      mockModalResult({ label: "test", taskSize: "", openInNewTab: "false" });
      const result = await showLabelInputModal(mockApp);
      expect(result.openInNewTab).toBe(false);
    });
  });

  describe("showClassSelectionModal", () => {
    const mockClasses = [
      { className: "ems__Task", label: "Task" },
      { className: "ems__Project", label: "Project" },
    ];

    it("should return selected class when submitted", async () => {
      mockModalResult({ selectedClass: "ems__Task" });
      const result = await showClassSelectionModal(mockApp, mockClasses);
      expect(result.selectedClass).toEqual({ className: "ems__Task", label: "Task" });
    });

    it("should return null when cancelled", async () => {
      mockModalResult(null);
      const result = await showClassSelectionModal(mockApp, mockClasses);
      expect(result.selectedClass).toBeNull();
    });

    it("should return null for empty selection", async () => {
      mockModalResult({ selectedClass: "" });
      const result = await showClassSelectionModal(mockApp, mockClasses);
      expect(result.selectedClass).toBeNull();
    });

    it("should return null for unknown class name", async () => {
      mockModalResult({ selectedClass: "unknown__Class" });
      const result = await showClassSelectionModal(mockApp, mockClasses);
      expect(result.selectedClass).toBeNull();
    });

    it("should create schema with enum field containing class options", async () => {
      mockModalResult(null);
      await showClassSelectionModal(mockApp, mockClasses);
      const schema = getSchemaFromLastCall();
      expect(schema).toHaveLength(1);
      expect(schema[0]).toMatchObject({
        name: "selectedClass",
        type: "enum",
        required: true,
      });
      expect(schema[0].options).toEqual([
        { value: "ems__Task", label: "Task" },
        { value: "ems__Project", label: "Project" },
      ]);
    });

    it("should preserve extra properties on class objects", async () => {
      const classesWithExtras = [
        { className: "ems__Task", label: "Task", deprecated: false, canCreateInstance: true },
      ];
      mockModalResult({ selectedClass: "ems__Task" });
      const result = await showClassSelectionModal(mockApp, classesWithExtras);
      expect(result.selectedClass).toEqual({
        className: "ems__Task",
        label: "Task",
        deprecated: false,
        canCreateInstance: true,
      });
    });
  });
});
