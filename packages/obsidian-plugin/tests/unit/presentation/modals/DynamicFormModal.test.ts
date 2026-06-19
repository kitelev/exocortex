import { DynamicFormModal, UserInput } from "../../../../src/presentation/modals/DynamicFormModal";
import type { InputSchemaField } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";

jest.mock("obsidian", () => ({
  Modal: class MockModal {
    app: unknown;
    contentEl = {
      empty: jest.fn(),
      addClass: jest.fn(),
      createEl: jest.fn().mockReturnValue(document.createElement("div")),
    };

    constructor(app: unknown) {
      this.app = app;
    }

    open = jest.fn();
    close = jest.fn();
  },
  App: jest.fn(),
}));

jest.mock("../../../../src/presentation/utils/ReactRenderer");
jest.mock("../../../../src/presentation/components/dynamic-form/DynamicForm");
jest.mock("../../../../src/presentation/components/ErrorBoundary");

describe("DynamicFormModal", () => {
  const mockApp = {} as any;
  const schema: InputSchemaField[] = [
    { name: "title", type: "text", label: "Title", required: true },
    { name: "priority", type: "enum", options: ["low", "high"] },
  ];

  let mockRender: jest.Mock;
  let mockCleanup: jest.Mock;

  beforeEach(() => {
    mockRender = jest.fn();
    mockCleanup = jest.fn();
    (ReactRenderer as jest.Mock).mockImplementation(() => ({
      render: mockRender,
      cleanup: mockCleanup,
    }));
  });

  it("should construct with app and schema", () => {
    const modal = new DynamicFormModal(mockApp, schema);
    expect(modal).toBeDefined();
  });

  it("should set up contentEl on open", () => {
    const modal = new DynamicFormModal(mockApp, schema);
    modal.onOpen();
    expect(modal.contentEl.empty).toHaveBeenCalled();
    expect(modal.contentEl.addClass).toHaveBeenCalledWith("dynamic-form-modal");
  });

  it("should create title element on open", () => {
    const modal = new DynamicFormModal(mockApp, schema);
    modal.onOpen();
    expect(modal.contentEl.createEl).toHaveBeenCalledWith("h3", {
      cls: "dynamic-form-modal-title",
    });
  });

  it("should create form container on open", () => {
    const modal = new DynamicFormModal(mockApp, schema);
    modal.onOpen();
    expect(modal.contentEl.createEl).toHaveBeenCalledWith("div", {
      cls: "dynamic-form-container",
    });
  });

  it("should render React component via ReactRenderer on open", () => {
    const modal = new DynamicFormModal(mockApp, schema);
    modal.onOpen();
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("should clean up on close", () => {
    const modal = new DynamicFormModal(mockApp, schema);
    modal.onOpen();
    modal.onClose();
    expect(mockCleanup).toHaveBeenCalled();
    expect(modal.contentEl.empty).toHaveBeenCalled();
  });

  it("should resolve null on close if waitForResult is pending", async () => {
    const modal = new DynamicFormModal(mockApp, schema);

    const resultPromise = modal.waitForResult();
    expect(modal.open).toHaveBeenCalled();

    modal.onClose();
    const result = await resultPromise;
    expect(result).toBeNull();
  });

  // T1 "Create Instance" (project bbe40f8c) — candidate wiring for assetRef
  // fuzzy-picker fields.
  describe("assetRef candidates wiring", () => {
    const pickerSchema: InputSchemaField[] = [
      { name: "label", type: "text", label: "Label", required: true },
      {
        name: "exo__Asset_isDefinedBy",
        type: "assetRef",
        label: "Ontology",
        required: true,
        targetClassUid: "829b9b3b-6fc3-4276-be6a-27d3398c012e",
      },
    ];

    function candidatesPassedToForm(): Record<string, unknown> | undefined {
      // mockRender(container, reactElement) — reactElement is the ErrorBoundary
      // wrapping DynamicForm; dig into the DynamicForm props.
      const reactEl = mockRender.mock.calls[0][1];
      return reactEl.props.children.props.candidates;
    }

    it("resolves candidates by targetClassUid and passes them to DynamicForm", () => {
      const resolver = jest.fn((classUid: string) =>
        classUid === "829b9b3b-6fc3-4276-be6a-27d3398c012e"
          ? [{ uid: "uid-ems", label: "ems" }]
          : [],
      );
      const modal = new DynamicFormModal(
        mockApp,
        pickerSchema,
        undefined,
        resolver,
      );
      modal.onOpen();

      expect(resolver).toHaveBeenCalledWith(
        "829b9b3b-6fc3-4276-be6a-27d3398c012e",
      );
      expect(candidatesPassedToForm()).toEqual({
        exo__Asset_isDefinedBy: [{ uid: "uid-ems", label: "ems" }],
      });
    });

    it("does NOT resolve candidates for assetRef fields without targetClassUid", () => {
      const resolver = jest.fn(() => []);
      const modal = new DynamicFormModal(
        mockApp,
        [{ name: "parent", type: "assetRef", label: "Parent" }],
        undefined,
        resolver,
      );
      modal.onOpen();
      expect(resolver).not.toHaveBeenCalled();
      expect(candidatesPassedToForm()).toEqual({});
    });
  });

  it("should resolve with values when onSubmit is called", async () => {
    const modal = new DynamicFormModal(mockApp, schema);

    const resultPromise = modal.waitForResult();

    modal.onOpen();
    const renderCall = mockRender.mock.calls[0];
    const reactElement = renderCall[1];

    const errorBoundaryProps = reactElement.props;
    const formElement = errorBoundaryProps.children;
    const formProps = formElement.props;

    const values: UserInput = { title: "Test", priority: "high" };
    formProps.onSubmit(values);

    const result = await resultPromise;
    expect(result).toEqual(values);
  });

  it("should resolve null when onCancel is called", async () => {
    const modal = new DynamicFormModal(mockApp, schema);

    const resultPromise = modal.waitForResult();

    modal.onOpen();
    const renderCall = mockRender.mock.calls[0];
    const reactElement = renderCall[1];

    const errorBoundaryProps = reactElement.props;
    const formElement = errorBoundaryProps.children;
    const formProps = formElement.props;

    formProps.onCancel();

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it("should accept all five field types in schema", () => {
    const fullSchema: InputSchemaField[] = [
      { name: "text1", type: "text" },
      { name: "date1", type: "date" },
      { name: "enum1", type: "enum", options: ["a", "b"] },
      { name: "multi1", type: "multiline" },
      { name: "ref1", type: "assetRef" },
    ];
    const modal = new DynamicFormModal(mockApp, fullSchema);
    expect(modal).toBeDefined();
    modal.onOpen();
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("should pass schema to DynamicForm component", () => {
    const modal = new DynamicFormModal(mockApp, schema);
    modal.onOpen();

    const renderCall = mockRender.mock.calls[0];
    const reactElement = renderCall[1];
    const formElement = reactElement.props.children;
    expect(formElement.props.schema).toBe(schema);
  });

  it("should not resolve twice on close after submit", async () => {
    const modal = new DynamicFormModal(mockApp, schema);
    const resultPromise = modal.waitForResult();

    modal.onOpen();
    const renderCall = mockRender.mock.calls[0];
    const formProps = renderCall[1].props.children.props;

    formProps.onSubmit({ title: "done", priority: "low" });

    modal.onClose();

    const result = await resultPromise;
    expect(result).toEqual({ title: "done", priority: "low" });
  });
});
