import type { App } from "obsidian";
import {
  GenericAssetCreationService,
  InMemoryTripleStore,
  DomainTriple,
  DomainIRI,
  DomainLiteral,
  Namespace,
  type IVaultAdapter,
  type INotificationService,
} from "exocortex";
import { CreateAssetCommand } from "../../../src/application/commands/CreateAssetCommand";
import { showClassSelectionModal } from "@plugin/presentation/modals/modalSchemas";
import { DynamicAssetCreationModal } from "@plugin/presentation/modals/DynamicAssetCreationModal";
import type { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import type {
  ClassDiscoveryService,
  DiscoveredClass,
} from "../../../src/application/services/ClassDiscoveryService";
import type { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

// Headless the two UI modals so the command callback can run in a unit test.
jest.mock("@plugin/presentation/modals/modalSchemas", () => ({
  showClassSelectionModal: jest.fn(),
}));
jest.mock("@plugin/presentation/modals/DynamicAssetCreationModal", () => ({
  DynamicAssetCreationModal: jest.fn(),
}));

const EXO = "https://exocortex.my/ontology/exo#";

/**
 * Behavioral / golden test for the H3 PR2 (#3384) plugin opt-in.
 *
 * Exercises the FULL plugin Create-asset chain with REAL components:
 *   CreateAssetCommand → GenericAssetCreationService (core) → emitted bytes
 *   + ShapeLoader.loadFromRDFGraph(real InMemoryTripleStore) → ShapeRegistry.
 *
 * Asserts the two real-vault behaviour changes PR2 introduces:
 *   1. `exo__Instance_class` is the UID strip-canon `[[<uuid>]]` form
 *      (proves classRefForm='uuid' + classUid are wired through), NOT the
 *      legacy `[[ems__Task]]` label form.
 *   2. wikilink properties are cardinality-aware (proves the lazily-loaded
 *      shapeRegistry is wired through): Single → scalar, Multiple → YAML array.
 *
 * Revert-verify (documented in the PR): reverting EITHER opt-in in
 * CreateAssetCommand makes this suite fail —
 *   - drop classRefForm/classUid  → assertion 1 fails (emits `[[ems__Task]]`),
 *   - drop shapeRegistry          → assertion 2 fails (relatesTo emits scalar).
 */
describe("CreateAssetCommand — H3 PR2 plugin opt-in (#3384)", () => {
  const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
  const STATUS_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
  const RELATES_UID = "7138261c-f964-4f10-a44e-cb153f14c217";

  let created: Array<{ path: string; content: string }>;
  let command: CreateAssetCommand;
  let buildCommand: (sparql?: SPARQLQueryService) => CreateAssetCommand;

  const triple = (
    s: string,
    p: string,
    o: string | { lit: string },
  ): DomainTriple =>
    new DomainTriple(
      new DomainIRI(s),
      new DomainIRI(p),
      typeof o === "string" ? new DomainIRI(o) : new DomainLiteral(o.lit),
    );

  /**
   * Build an in-memory store holding two SHACL-lite property definitions:
   * ems__Effort_status (Single) and ems__Effort_relatesTo (Multiple), mirroring
   * the triple shape NoteToRDFConverter emits for exo:Property* assets.
   */
  async function buildStore(): Promise<InMemoryTripleStore> {
    const RDF_TYPE = Namespace.RDF.term("type").value;
    const RDFS_DOMAIN = Namespace.RDFS.term("domain").value;
    const EXO_CARD = Namespace.EXO.term("Property_cardinality").value;
    const EXO_LABEL = Namespace.EXO.term("Asset_label").value;
    const OBJ_PROP = Namespace.EXO.term("ObjectProperty").value;
    const EFFORT = Namespace.EMS.term("Effort").value;

    const statusFile = "obsidian://vault/ems/status-prop.md";
    const relatesFile = "obsidian://vault/ems/relates-prop.md";

    const store = new InMemoryTripleStore();
    await store.addAll([
      // ems__Effort_status — Single cardinality
      triple(statusFile, RDF_TYPE, OBJ_PROP),
      triple(statusFile, RDFS_DOMAIN, EFFORT),
      triple(statusFile, EXO_CARD, `${EXO}PropertyCardinalitySingle`),
      triple(statusFile, EXO_LABEL, { lit: "ems__Effort_status" }),
      // ems__Effort_relatesTo — Multiple cardinality
      triple(relatesFile, RDF_TYPE, OBJ_PROP),
      triple(relatesFile, RDFS_DOMAIN, EFFORT),
      triple(relatesFile, EXO_CARD, `${EXO}PropertyCardinalityMultiple`),
      triple(relatesFile, EXO_LABEL, { lit: "ems__Effort_relatesTo" }),
    ]);
    return store;
  }

  async function run(opts: {
    selectedClass: DiscoveredClass;
    sparql?: SPARQLQueryService;
  }): Promise<void> {
    (showClassSelectionModal as jest.Mock).mockResolvedValue({
      selectedClass: opts.selectedClass,
    });
    (DynamicAssetCreationModal as unknown as jest.Mock).mockImplementation(
      (_app: unknown, _className: unknown, resolve: (r: unknown) => void) => ({
        open: () =>
          resolve({
            label: "Test Task",
            openInNewTab: false,
            propertyValues: {
              ems__Effort_status: `[[${STATUS_UID}]]`,
              ems__Effort_relatesTo: `[[${RELATES_UID}]]`,
            },
          }),
      }),
    );
    await command.callback();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    created = [];

    const vault = {
      getAbstractFileByPath: jest.fn().mockReturnValue(null),
      createFolder: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((path: string, content: string) => {
        created.push({ path, content });
        return Promise.resolve({
          path,
          basename: path.split("/").pop()?.replace(".md", "") ?? "",
          name: path.split("/").pop() ?? "",
          parent: { path: path.split("/").slice(0, -1).join("/") },
        });
      }),
    } as unknown as IVaultAdapter;

    const service = new GenericAssetCreationService(vault);

    const fakeLeaf = { openFile: jest.fn().mockResolvedValue(undefined) };
    const app = {
      workspace: {
        getLeaf: jest.fn().mockReturnValue(fakeLeaf),
        setActiveLeaf: jest.fn(),
      },
    } as unknown as App;

    const vaultAdapter = {
      toTFile: jest.fn().mockReturnValue({ path: "x" }),
    } as unknown as ObsidianVaultAdapter;

    const classDiscoveryService = {
      getCreatableClasses: jest.fn().mockResolvedValue([]),
    } as unknown as ClassDiscoveryService;

    const notifier = {
      success: jest.fn(),
      error: jest.fn(),
    } as unknown as INotificationService;

    // Build the command with a real core service + fakes for the Obsidian seams.
    // The sparqlQueryService is supplied per-test (so we can also assert the
    // graceful fallback when it is absent).
    buildCommand = (sparql?: SPARQLQueryService) =>
      new CreateAssetCommand(
        app,
        service,
        vaultAdapter,
        classDiscoveryService,
        notifier,
        undefined,
        sparql,
      );
  });

  const selectedTask = (classUid?: string): DiscoveredClass => ({
    className: "ems__Task",
    label: "Task",
    deprecated: false,
    canCreateInstance: true,
    classUid,
  });

  it("emits exo__Instance_class as [[<uuid>]] strip-canon + cardinality-aware properties", async () => {
    const store = await buildStore();
    const sparql = {
      isReady: () => true,
      getTripleStore: () => store,
    } as unknown as SPARQLQueryService;

    command = buildCommand(sparql);
    await run({ selectedClass: selectedTask(TASK_UID), sparql });

    expect(created).toHaveLength(1);
    const content = created[0].content;

    // (1) UID strip-canon class ref — the real-vault behaviour change.
    expect(content).toContain(`"[[${TASK_UID}]]"`);
    expect(content).not.toContain('"[[ems__Task]]"');

    // (2) cardinality-aware emission: Single → scalar, Multiple → YAML array.
    expect(content).toContain(`ems__Effort_status: "[[${STATUS_UID}]]"`);
    expect(content).toMatch(
      new RegExp(`ems__Effort_relatesTo:\\n\\s+- "\\[\\[${RELATES_UID}\\]\\]"`),
    );
  });

  it("falls back to label form when classUid is absent (discovery gave no uid)", async () => {
    const store = await buildStore();
    const sparql = {
      isReady: () => true,
      getTripleStore: () => store,
    } as unknown as SPARQLQueryService;

    command = buildCommand(sparql);
    await run({ selectedClass: selectedTask(undefined), sparql });

    const content = created[0].content;
    expect(content).toContain('"[[ems__Task]]"');
    expect(content).not.toContain(`"[[${TASK_UID}]]"`);
  });

  it("emits scalar (no array) when the triple store is not ready — non-fatal shape fallback", async () => {
    const sparql = {
      isReady: () => false,
      getTripleStore: jest.fn(),
    } as unknown as SPARQLQueryService;

    command = buildCommand(sparql);
    await run({ selectedClass: selectedTask(TASK_UID), sparql });

    const content = created[0].content;
    // classUid still applies (independent of shapes).
    expect(content).toContain(`"[[${TASK_UID}]]"`);
    // No shapes → relatesTo stays scalar (not wrapped in a YAML array).
    expect(content).not.toMatch(/ems__Effort_relatesTo:\n\s+-/);
    expect(content).toContain(`ems__Effort_relatesTo: "[[${RELATES_UID}]]"`);
    // getTripleStore must NOT be touched when the store is not ready.
    expect(sparql.getTripleStore as jest.Mock).not.toHaveBeenCalled();
  });

  it("swallows a shape-loader throw (non-fatal) — asset still created, scalar fallback", async () => {
    // isReady() true but the store's match() rejects → ShapeLoader.loadFromRDFGraph
    // throws → loadShapeRegistry's catch returns undefined → scalar emission, no crash.
    const explodingStore = {
      match: jest.fn().mockRejectedValue(new Error("graph walk failed")),
    };
    const sparql = {
      isReady: () => true,
      getTripleStore: () => explodingStore,
    } as unknown as SPARQLQueryService;

    command = buildCommand(sparql);
    await run({ selectedClass: selectedTask(TASK_UID), sparql });

    expect(created).toHaveLength(1);
    const content = created[0].content;
    // classUid still applies; property stays scalar (no array) after the fallback.
    expect(content).toContain(`"[[${TASK_UID}]]"`);
    expect(content).not.toMatch(/ems__Effort_relatesTo:\n\s+-/);
    expect(content).toContain(`ems__Effort_relatesTo: "[[${RELATES_UID}]]"`);
  });
});
