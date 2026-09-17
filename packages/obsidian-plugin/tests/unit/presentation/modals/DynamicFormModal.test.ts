import { DynamicFormModal, UserInput } from "../../../../src/presentation/modals/DynamicFormModal";
import type {
  AssetRefCandidate,
  InputSchemaField,
} from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import {
  CommandExecutionFlow,
  GroundingType,
  InMemoryTripleStore,
  IRI,
  Literal,
  Namespace,
  Triple,
  createTripleStoreRequiredPropertyResolver,
  vaultPathToIRI,
} from "@kitelev/exocortex-core";

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

/**
 * Ticket dc04eded (parent bbac67ce) — production-shape: the create-instance
 * form's reference picker for a REQUIRED object property whose
 * `exo__Property_range` is a SYMBOLIC ontology term (`…/ontology/ems#Effort`,
 * the form the converter emits for every class with a `prefix__LocalName`
 * label — ALL 22 required object ranges on vault-exodev, 2026-09-17).
 *
 * Chain under test, every link REAL: an `InMemoryTripleStore` seeded as the
 * converter emits it → `createTripleStoreRequiredPropertyResolver` →
 * `CommandExecutionFlow.applyRequiredPropertyFields` (the flagship
 * create_instance grounding without `targetClass`, host = the class file) →
 * the augmented schema → `DynamicFormModal` with its PRODUCTION candidate
 * resolver (`findAssetRefCandidates` over a fake `app.metadataCache`) →
 * `buildCandidates()` — the exact map the React form receives. Before the fix
 * the field arrived without `targetClassUid`, `buildCandidates` skipped it and
 * the picker degraded to a plain text input (req c4adae42 consumer control).
 *
 * Revert-verify (mutant driver on core `RequiredPropertyResolver.ts`):
 *  - M1 drop the symbolic branch (`uidFrom` alone) → S4 RED (no candidates)
 */
describe("DynamicFormModal — required symbolic-range field gets picker candidates (ticket dc04eded)", () => {
  const HOST = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task (host class file)
  const EFFORT = "086f71fa-0000-4000-8000-000000000002"; // ems__Effort → exo__Asset
  const PROJECT = "7db5eeff-0000-4000-8000-000000000004"; // ems__Project → ems__Effort
  const CONCEPT = "cccccccc-0000-4000-8000-000000000005"; // concept__Concept
  const PROP_DEF = "00000000-0000-4000-8000-00000000dc04"; // ems__Effort_parent def

  type FakeFile = {
    basename: string;
    path: string;
    fm: Record<string, unknown>;
  };
  const file = (basename: string, fm: Record<string, unknown>): FakeFile => ({
    basename,
    path: `${basename}.md`,
    fm,
  });
  const classDef = (uid: string, label: string, supers: string[]): FakeFile =>
    file(uid, {
      exo__Asset_uid: uid,
      exo__Asset_label: label,
      exo__Instance_class: [
        "[[8619c4fc-0000-4000-8000-000000000000|exo__Class]]",
      ],
      ...(supers.length > 0 ? { exo__Class_superClass: supers } : {}),
    });
  const instance = (uid: string, label: string, cls: string): FakeFile =>
    file(uid, {
      exo__Asset_uid: uid,
      exo__Asset_label: label,
      exo__Instance_class: [cls],
    });

  const appWith = (files: FakeFile[]): unknown => ({
    vault: { getMarkdownFiles: () => files },
    metadataCache: { getFileCache: (f: FakeFile) => ({ frontmatter: f.fm }) },
  });

  /** The vault as `findAssetRefCandidates` scans it: hierarchy + instances. */
  const vaultFiles = (): FakeFile[] => [
    classDef(EFFORT, "ems__Effort", []),
    classDef(HOST, "ems__Task", [`[[${EFFORT}|ems__Effort]]`]),
    classDef(PROJECT, "ems__Project", [`[[${EFFORT}]]`]),
    classDef(CONCEPT, "concept__Concept", []),
    instance("t-1111", "Task one", `[[${HOST}]]`), // UID-form class ref
    instance("p-2222", "Project two", "[[ems__Project]]"), // label-form class ref
    instance("c-3333", "Concept three", `[[${CONCEPT}]]`),
  ];

  /** The store as the converter emits it: one required prop, SYMBOLIC range. */
  const seedStore = async (rangeIri: string): Promise<InMemoryTripleStore> => {
    const store = new InMemoryTripleStore();
    const def = new IRI(vaultPathToIRI(`assetspaces/x/${PROP_DEF}.md`));
    const EXO = Namespace.EXO;
    await store.addAll([
      new Triple(
        def,
        EXO.term("Asset_label"),
        new Literal("ems__Effort_parent"),
      ),
      new Triple(def, EXO.term("Property_minCount"), new Literal("1")),
      new Triple(
        def,
        EXO.term("Property_domain"),
        new IRI(vaultPathToIRI(`assetspaces/x/${HOST}.md`)),
      ),
      new Triple(def, EXO.term("Property_range"), new IRI(rangeIri)),
    ]);
    return store;
  };

  /** REAL CommandExecutionFlow → augmented schema for the flagship grounding. */
  const augmentedSchema = async (store: InMemoryTripleStore) => {
    const flow = new CommandExecutionFlow(
      {} as never, // groundingExecutor — not reached by applyRequiredPropertyFields
      {} as never, // notificationService
      {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as never,
      {} as never, // prompts
      store,
      undefined,
      createTripleStoreRequiredPropertyResolver(store),
    );
    const grounding = {
      id: "g-create-self",
      label: "Create instance",
      type: GroundingType.CREATE_INSTANCE,
      targetClass: undefined,
    } as never;
    return (await flow.applyRequiredPropertyFields(
      [{ name: "label", type: "text" }],
      grounding,
      {
        targetIRI: vaultPathToIRI(`assetspaces/x/${HOST}.md`),
        filePath: `assetspaces/x/${HOST}.md`,
      },
    )) as InputSchemaField[];
  };

  it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 S4 a required property with a SYMBOLIC range (ems#Effort) reaches the modal with targetClassUid = ems__Effort and buildCandidates lists the Effort subclass instances (Task + Project, not Concept)", async () => {
    const store = await seedStore(Namespace.EMS.term("Effort").value);
    const schema = await augmentedSchema(store);

    const field = schema.find((f) => f.name === "ems__Effort_parent");
    expect(field).toMatchObject({
      type: "assetRef",
      required: true,
      targetClassUid: "ems__Effort",
    });

    const modal = new DynamicFormModal(appWith(vaultFiles()) as never, schema);
    const candidates = (
      modal as unknown as {
        buildCandidates(): Record<string, AssetRefCandidate[]>;
      }
    ).buildCandidates();
    expect(candidates["ems__Effort_parent"]?.map((c) => c.uid).sort()).toEqual([
      "p-2222",
      "t-1111",
    ]);
  });

  it("S4b control — a PATH-form range (obsidian://…/<uid>.md) still yields the class UID and the same candidates", async () => {
    const store = await seedStore(vaultPathToIRI(`assetspaces/x/${EFFORT}.md`));
    const schema = await augmentedSchema(store);
    expect(schema.find((f) => f.name === "ems__Effort_parent")).toMatchObject({
      targetClassUid: EFFORT,
    });
    const modal = new DynamicFormModal(appWith(vaultFiles()) as never, schema);
    const candidates = (
      modal as unknown as {
        buildCandidates(): Record<string, AssetRefCandidate[]>;
      }
    ).buildCandidates();
    expect(candidates["ems__Effort_parent"]?.map((c) => c.uid).sort()).toEqual([
      "p-2222",
      "t-1111",
    ]);
  });
});
