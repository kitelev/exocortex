import {
  PropertyEditorModal,
} from "../../src/presentation/modals/PropertyEditorModal";
import {
  InMemoryTripleStore,
  IRI,
  Literal,
  Namespace,
  Triple,
  vaultPathToIRI,
} from "@kitelev/exocortex-core";
import { App, TFile } from "obsidian";
import * as obsidian from "obsidian";
import type { ExocortexPluginInterface } from "@plugin/types";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import { extractInstanceClass } from "@plugin/domain/property-editor/extractInstanceClass";
import { getPropertySchemaForClass } from "@plugin/domain/property-editor/PropertySchemas";
import type { RelationsFormDeps } from "@plugin/presentation/components/property-editor/PropertyEditorForm";

jest.mock("../../src/presentation/utils/ReactRenderer");
jest.mock("../../src/presentation/components/ErrorBoundary");
jest.mock("../../src/presentation/components/property-editor/PropertyEditorForm");
jest.mock("../../src/domain/property-editor/extractInstanceClass");
// Real implementation by default; the ticket-7d91d13a describe swaps in a
// wikilink schema so `buildRelationsDeps` exposes the seeded predicate as an option.
const actualPropertySchemas = jest.requireActual("../../src/domain/property-editor/PropertySchemas");
jest.mock("../../src/domain/property-editor/PropertySchemas", () => ({
  ...jest.requireActual("../../src/domain/property-editor/PropertySchemas"),
  getPropertySchemaForClass: jest.fn(
    jest.requireActual("../../src/domain/property-editor/PropertySchemas").getPropertySchemaForClass,
  ),
}));

jest.mock("obsidian", () => {
  const actual = jest.requireActual("obsidian");
  return {
    // Keep the ES-module flag the spread drops (it is non-enumerable on the
    // compiled mock), so `import * as obsidian` yields THIS object instead of
    // a non-configurable getter wrapper — required for the L2 axes to spy on
    // `requireApiVersion` (ticket 7c02970c).
    __esModule: true,
    ...actual,
  };
});
// Ticket 7c02970c — the modal logs through the channel-routed Logger; a shared
// mock per test lets the L1 axes assert the (message, error) pairs.
jest.mock("../../src/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("PropertyEditorModal", () => {
  let mockApp: App;
  let mockPlugin: ExocortexPluginInterface;
  let mockFile: TFile;
  let mockFrontmatter: Record<string, unknown>;
  let modal: PropertyEditorModal;
  let mockContentEl: any;
  let mockRender: jest.Mock;
  let mockUnmount: jest.Mock;
  let mockNotifier: any;
  /** The modal's (mocked) Logger `error` — ticket 7c02970c. */
  const loggerErrorOf = (m: PropertyEditorModal): jest.Mock =>
    (m as unknown as { logger: { error: jest.Mock } }).logger.error;

  beforeEach(() => {
    mockNotifier = {
      info: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      confirm: jest.fn().mockResolvedValue(true),
    };
    mockRender = jest.fn();
    mockUnmount = jest.fn();
    (ReactRenderer as jest.Mock).mockImplementation(() => ({
      render: mockRender,
      unmount: mockUnmount,
    }));

    (extractInstanceClass as jest.Mock).mockReturnValue("ems__Task");

    mockApp = {
      vault: {
        read: jest.fn().mockResolvedValue("---\nkey: value\n---\ncontent"),
        modify: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as App;

    mockPlugin = {
      refreshLayout: jest.fn(),
    } as unknown as ExocortexPluginInterface;

    mockFile = {
      basename: "test-file",
      path: "test/test-file.md",
      name: "test-file.md",
      extension: "md",
      stat: { ctime: 0, mtime: 0, size: 0 },
      vault: {} as any,
      parent: null,
    } as TFile;

    mockFrontmatter = {
      exo__Instance_class: ["[[ems__Task]]"],
      exo__Asset_label: "Test Task",
    };

    mockContentEl = {
      addClass: jest.fn(),
      createEl: jest.fn().mockImplementation((tag: string, options?: any) => {
        const el = document.createElement(tag);
        if (options?.text) el.textContent = options.text;
        if (options?.cls) el.className = options.cls;
        return el;
      }),
      // Ticket 7c02970c — the modal builds its chrome with `createDiv` (the
      // obsidianmd/prefer-create-el form); mirror createEl's element factory.
      createDiv: jest.fn().mockImplementation((options?: any) => {
        const el = document.createElement("div");
        if (options?.text) el.textContent = options.text;
        if (options?.cls) el.className = options.cls;
        return el;
      }),
      empty: jest.fn(),
    };
  });

  describe("constructor", () => {
    it("should initialize with required parameters", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should store plugin reference", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).plugin).toBe(mockPlugin);
    });

    it("should store file reference", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).file).toBe(mockFile);
    });

    it("should store frontmatter", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).frontmatter).toBe(mockFrontmatter);
    });

    it("should extract instance class from frontmatter", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).instanceClass).toBe("ems__Task");
    });

    it("should initialize ReactRenderer", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect(ReactRenderer).toHaveBeenCalled();
    });
  });

  describe("onOpen", () => {
    beforeEach(() => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should empty content element first", () => {
      modal.onOpen();
      expect(mockContentEl.empty).toHaveBeenCalled();
    });

    it("should add modal class", () => {
      modal.onOpen();
      expect(mockContentEl.addClass).toHaveBeenCalledWith("property-editor-modal");
    });

    it("should create title element", () => {
      modal.onOpen();
      expect(mockContentEl.createDiv).toHaveBeenCalledWith({ cls: "modal-title" });
    });

    it("should create subtitle element", () => {
      modal.onOpen();
      expect(mockContentEl.createDiv).toHaveBeenCalledWith({ cls: "property-editor-subtitle" });
    });

    it("should create container for React component", () => {
      modal.onOpen();
      expect(mockContentEl.createDiv).toHaveBeenCalledWith({ cls: "property-editor-container" });
    });

    it("should call ReactRenderer.render", () => {
      modal.onOpen();
      expect(mockRender).toHaveBeenCalled();
    });
  });

  describe("handleSave", () => {
    beforeEach(() => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should read file content", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
    });

    it("should modify file with updated content", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should show success notice", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockNotifier.success).toHaveBeenCalledWith("Properties saved successfully");
    });

    it("should close modal after save", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(modal.close).toHaveBeenCalled();
    });

    it("should refresh layout after save", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should handle multiple properties", async () => {
      await (modal as any).handleSave({
        key1: "value1",
        key2: "value2",
        key3: "value3",
      });
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should show error notice on vault read failure", async () => {
      (mockApp.vault.read as jest.Mock).mockRejectedValue(new Error("Read failed"));

      await (modal as any).handleSave({ key1: "value1" });

      // Ticket 7c02970c — the toast now comes from the Logger's notice channel.
      expect(loggerErrorOf(modal)).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save properties"),
        expect.any(Error),
      );
    });

    it("should show error notice on vault modify failure", async () => {
      (mockApp.vault.modify as jest.Mock).mockRejectedValue(new Error("Write failed"));

      await (modal as any).handleSave({ key1: "value1" });

      expect(loggerErrorOf(modal)).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save properties"),
        expect.any(Error),
      );
    });

    it("should handle non-Error thrown objects", async () => {
      (mockApp.vault.read as jest.Mock).mockRejectedValue("string error");

      await (modal as any).handleSave({ key1: "value1" });

      expect(loggerErrorOf(modal)).toHaveBeenCalledWith(
        expect.stringContaining("string error"),
        "string error",
      );
    });

    it("should not close modal on error", async () => {
      (mockApp.vault.read as jest.Mock).mockRejectedValue(new Error("Read failed"));

      await (modal as any).handleSave({ key1: "value1" });

      expect(modal.close).not.toHaveBeenCalled();
    });

    it("should handle empty frontmatter update", async () => {
      await (modal as any).handleSave({});
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should handle plugin without refreshLayout", async () => {
      const pluginNoRefresh = { ...mockPlugin, refreshLayout: undefined };
      modal = new PropertyEditorModal(mockApp, pluginNoRefresh as ExocortexPluginInterface, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();

      await expect((modal as any).handleSave({ key1: "value1" })).resolves.not.toThrow();
    });
  });

  describe("handleCancel", () => {
    beforeEach(() => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.close = jest.fn();
    });

    it("should close modal", () => {
      (modal as any).handleCancel();
      expect(modal.close).toHaveBeenCalled();
    });

    it("should not call vault operations", () => {
      (modal as any).handleCancel();
      expect(mockApp.vault.read).not.toHaveBeenCalled();
      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });
  });

  describe("onClose", () => {
    it("should unmount React component", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;

      modal.onClose();

      expect(mockUnmount).toHaveBeenCalledWith(mockContentEl);
    });

    it("should empty content element", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;

      modal.onClose();

      expect(mockContentEl.empty).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle file with no basename", () => {
      const fileNoBn = { ...mockFile, basename: "" };
      modal = new PropertyEditorModal(mockApp, mockPlugin, fileNoBn as TFile, mockFrontmatter, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle empty frontmatter", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, {}, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle frontmatter with null values", () => {
      const fmWithNull = { key1: null, key2: undefined, key3: "" };
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, fmWithNull, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle frontmatter with complex nested values", () => {
      const complexFm = {
        key1: ["a", "b", "c"],
        key2: { nested: { deep: "value" } },
        key3: 42,
      };
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, complexFm, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle concurrent save operations gracefully", async () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();

      const save1 = (modal as any).handleSave({ key1: "value1" });
      const save2 = (modal as any).handleSave({ key2: "value2" });

      await Promise.all([save1, save2]);

      expect(mockApp.vault.read).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * ems__Bug `dcb9ed83` — the reify predicate-def map is built from each property-
   * definition's `exo__Asset_label`, but the converter emits a clean
   * `prefix__LocalName` label as a symbolic IRI (dual-IRI), not a Literal. This
   * drives the REAL private `buildPredicateRangeMap` over a REAL InMemoryTripleStore
   * seeded exactly as the store holds it (label object = symbolic IRI).
   * Revert-verify: dropping the IRI branch of `predicateKeyFromLabelObjects` leaves
   * `predicateDefUidByKey` without the `exo__Asset_relates` key → the assertion RED
   * (reify then throws "no predicate-definition asset was found").
   */
  describe("buildPredicateRangeMap — reify predicate-def resolution (dual-IRI label)", () => {
    const EXO_PROPERTY_RANGE = Namespace.EXO.term("Property_range");
    const EXO_ASSET_LABEL = Namespace.EXO.term("Asset_label");
    const defIri = (uid: string): IRI =>
      new IRI(vaultPathToIRI(`assetspaces/kitelev/exoas-exo/exo/${uid}.md`));

    it("resolves a clean-prefix key whose label is a symbolic IRI (the bug)", async () => {
      const store = new InMemoryTripleStore();
      const relatesDef = defIri("e3a71d16-14b3-4aff-adf7-c9eccd1077b4");
      // Real store shape: Property_range subject = the def's path IRI; its
      // exo__Asset_label object = the symbolic IRI (NOT a Literal).
      await store.add(new Triple(relatesDef, EXO_PROPERTY_RANGE, Namespace.EXO.term("Asset")));
      await store.add(new Triple(relatesDef, EXO_ASSET_LABEL, Namespace.EXO.term("Asset_relates")));

      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      await (modal as any).buildPredicateRangeMap(store);

      expect((modal as any).predicateDefUidByKey.get("exo__Asset_relates")).toBe(
        "e3a71d16-14b3-4aff-adf7-c9eccd1077b4",
      );
      expect((modal as any).keyByPredicateDefUid.get("e3a71d16-14b3-4aff-adf7-c9eccd1077b4")).toBe(
        "exo__Asset_relates",
      );
    });

    it("still resolves a hyphen-prefix key whose label stays a Literal", async () => {
      const store = new InMemoryTripleStore();
      const relatesToConceptDef = defIri("0967a771-c5cf-4fee-9707-9837104977f3");
      await store.add(new Triple(relatesToConceptDef, EXO_PROPERTY_RANGE, Namespace.EXO.term("Asset")));
      await store.add(
        new Triple(relatesToConceptDef, EXO_ASSET_LABEL, new Literal("adapter-exo-ims__relatesToConcept")),
      );

      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      await (modal as any).buildPredicateRangeMap(store);

      expect(
        (modal as any).predicateDefUidByKey.get("adapter-exo-ims__relatesToConcept"),
      ).toBe("0967a771-c5cf-4fee-9707-9837104977f3");
    });
  });

  /**
   * Ticket 7d91d13a (review LOW-2 of #4247) — the relations-picker's candidate
   * class is derived from `exo:Property_range`, and the converter emits a class
   * range as a SYMBOLIC IRI (`…/ems#Effort`) for every class with a
   * `prefix__LocalName` label (348 of the 350 object ranges in vault-exodev,
   * 33 namespaces; 2 are path-form). `uidFromIri` sliced that to the bare local
   * name `Effort`, which is neither the class UID nor its label, so
   * `findAssetRefCandidates` matched nothing → an EMPTY picker for ~every
   * predicate regardless of the subsumption resolver (req 15f48fa1).
   *
   * Production-shape: the REAL `buildRelationsDeps()` (fake SPARQL api → a REAL
   * InMemoryTripleStore seeded as the store holds it; schema stubbed to expose
   * the predicate as a wikilink option) → the option's `rangeClassUid` → the
   * REAL `resolveCandidates` closure → the REAL `findAssetRefCandidates` over a
   * fake `app.metadataCache` — i.e. the exact values the RelationsSection reads.
   *
   * Revert-verify (mutant driver, `RED: [...]` by axis name):
   *  - M1 revert to `uidFromIri(range)` alone            → R1, R3, R4 RED
   *  - M2 normalise via `FrontmatterService.normalizeIRI` → R4 RED (26 live
   *    namespaces are outside its 9-entry map — the generic inverse is the point)
   *  - M3 break the path-form fallback (`?? null`)        → R2 RED
   */
  describe("buildRelationsDeps — symbolic Property_range → picker candidates (ticket 7d91d13a)", () => {
    const EXO_PROPERTY_RANGE = Namespace.EXO.term("Property_range");
    const EXO_ASSET_LABEL = Namespace.EXO.term("Asset_label");
    const defIri = (path: string): IRI => new IRI(vaultPathToIRI(path));
    /** `<prefix>#<local>` symbolic class/predicate IRI (ad-hoc namespaces included). */
    const symbolic = (prefix: string, local: string): IRI => {
      const ns = Namespace.forPrefix(prefix);
      if (!ns) throw new Error(`test fixture: bad namespace prefix ${prefix}`);
      return ns.term(local);
    };

    // Class UIDs (real ones from the shared TBox where they exist).
    const ASSET = "aaaaaaaa-0000-4000-8000-000000000001"; // exo__Asset (root, no superClass)
    const EFFORT = "086f71fa-0000-4000-8000-000000000002"; // ems__Effort → exo__Asset
    const TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task → ems__Effort
    const PROJECT = "7db5eeff-0000-4000-8000-000000000004"; // ems__Project → ems__Effort
    const CONCEPT = "cccccccc-0000-4000-8000-000000000005"; // concept__Concept → exo__Asset

    type FakeFile = { basename: string; path: string; fm: Record<string, unknown> };
    const file = (basename: string, fm: Record<string, unknown>): FakeFile => ({
      basename,
      path: `${basename}.md`,
      fm,
    });
    const classDef = (uid: string, label: string, supers: string[]): FakeFile =>
      file(uid, {
        exo__Asset_uid: uid,
        exo__Asset_label: label,
        exo__Instance_class: ["[[8619c4fc-0000-4000-8000-000000000000|exo__Class]]"],
        ...(supers.length > 0 ? { exo__Class_superClass: supers } : {}),
      });
    const instance = (uid: string, label: string, cls: string): FakeFile =>
      file(uid, { exo__Asset_uid: uid, exo__Asset_label: label, exo__Instance_class: [cls] });

    /** A vault: the class hierarchy + instances of Task / Project / Concept. */
    const vaultFiles = (): FakeFile[] => [
      classDef(ASSET, "exo__Asset", []),
      classDef(EFFORT, "ems__Effort", [`[[${ASSET}|exo__Asset]]`]),
      classDef(TASK, "ems__Task", [`[[${EFFORT}|ems__Effort]]`]),
      classDef(PROJECT, "ems__Project", [`[[${EFFORT}]]`]),
      classDef(CONCEPT, "concept__Concept", [`[[${ASSET}]]`]),
      instance("t-1111", "Task one", `[[${TASK}]]`), // UID-form class ref
      instance("p-2222", "Project two", "[[ems__Project]]"), // legacy label-form class ref
      instance("c-3333", "Concept three", `[[${CONCEPT}]]`),
    ];

    const appWith = (files: FakeFile[]): App =>
      ({
        vault: {
          read: jest.fn().mockResolvedValue("---\nkey: value\n---\ncontent"),
          modify: jest.fn().mockResolvedValue(undefined),
          getMarkdownFiles: () => files,
        },
        metadataCache: {
          getFileCache: (f: FakeFile) => ({ frontmatter: f.fm }),
        },
      }) as unknown as App;

    const pluginWith = (store: InMemoryTripleStore): ExocortexPluginInterface =>
      ({
        refreshLayout: jest.fn(),
        // Store reachable, NOT ready → the reified-relations pass is skipped
        // (cold-start guard), only the range/schema pass runs.
        getSPARQLApi: () => ({ getTripleStore: () => store, isReady: () => false }),
      }) as unknown as ExocortexPluginInterface;

    /** Seed one predicate definition: `key` with the given range object. */
    const seedPredicate = async (
      store: InMemoryTripleStore,
      key: string,
      defPath: string,
      range: IRI,
    ): Promise<void> => {
      const def = defIri(defPath);
      await store.add(new Triple(def, EXO_PROPERTY_RANGE, range));
      // Label = the frontmatter key, emitted as a symbolic IRI (dual-IRI).
      const [prefix, local] = key.split("__");
      await store.add(new Triple(def, EXO_ASSET_LABEL, symbolic(prefix, local)));
    };

    const wikilinkSchema = (...keys: string[]) =>
      keys.map((name) => ({ name, type: "wikilink" as const, required: false, label: name }));

    const depsFor = async (
      store: InMemoryTripleStore,
      files: FakeFile[],
      ...schemaKeys: string[]
    ): Promise<RelationsFormDeps> => {
      (getPropertySchemaForClass as jest.Mock).mockResolvedValue(wikilinkSchema(...schemaKeys));
      modal = new PropertyEditorModal(
        appWith(files),
        pluginWith(store),
        mockFile,
        mockFrontmatter,
        mockNotifier,
      );
      const deps = await (modal as any).buildRelationsDeps();
      expect(deps).toBeDefined();
      return deps as RelationsFormDeps;
    };

    afterEach(() => {
      (getPropertySchemaForClass as jest.Mock).mockReset();
      (getPropertySchemaForClass as jest.Mock).mockImplementation(
        actualPropertySchemas.getPropertySchemaForClass,
      );
    });

    it("R1 @req:e084627c-38b7-4498-be0a-a3e07e790943 a symbolic range (…/ems#Effort) becomes the class LABEL key and the picker offers the subclass instances", async () => {
      const store = new InMemoryTripleStore();
      await seedPredicate(
        store,
        "ems__Effort_parent",
        "assetspaces/kitelev/exoas-public/ems/6528ecfa-0000-4000-8000-000000000006.md",
        Namespace.EMS.term("Effort"),
      );
      const deps = await depsFor(store, vaultFiles(), "ems__Effort_parent");

      const option = deps.predicateOptions.find((o) => o.key === "ems__Effort_parent");
      expect(option?.rangeClassUid).toBe("ems__Effort");

      // The exact call the RelationsSection makes for the chosen predicate.
      const candidates = deps.resolveCandidates(option?.rangeClassUid);
      expect(candidates).toEqual([
        { uid: "p-2222", label: "Project two" },
        { uid: "t-1111", label: "Task one" },
      ]);
    });

    it("R2 @req:e084627c-38b7-4498-be0a-a3e07e790943 a path-form range (obsidian://…/<uid>.md) still maps to the class UID", async () => {
      const store = new InMemoryTripleStore();
      await seedPredicate(
        store,
        "concept__Concept_related",
        "assetspaces/kitelev/exoas-concept/concept/11111111-0000-4000-8000-000000000007.md",
        defIri("assetspaces/kitelev/exoas-concept/concept/d4efa663-df6e-4794-bed7-a8a25d2971e5.md"),
      );
      const deps = await depsFor(store, vaultFiles(), "concept__Concept_related");

      const option = deps.predicateOptions.find((o) => o.key === "concept__Concept_related");
      expect(option?.rangeClassUid).toBe("d4efa663-df6e-4794-bed7-a8a25d2971e5");
    });

    it("R3 @req:e084627c-38b7-4498-be0a-a3e07e790943 a symbolic range naming the ROOT class (…/exo#Asset, no superClass) reaches its definition by label and closes every subclass", async () => {
      const store = new InMemoryTripleStore();
      await seedPredicate(
        store,
        "exo__Asset_relates",
        "assetspaces/kitelev/exoas-exo/exo/e3a71d16-14b3-4aff-adf7-c9eccd1077b4.md",
        Namespace.EXO.term("Asset"),
      );
      const deps = await depsFor(store, vaultFiles(), "exo__Asset_relates");

      const option = deps.predicateOptions.find((o) => o.key === "exo__Asset_relates");
      expect(option?.rangeClassUid).toBe("exo__Asset");
      expect(deps.resolveCandidates(option?.rangeClassUid).map((c) => c.uid)).toEqual([
        "c-3333",
        "p-2222",
        "t-1111",
      ]);
    });

    it("R4 @req:e084627c-38b7-4498-be0a-a3e07e790943 a symbolic range in a namespace outside FrontmatterService.IRI_PREFIX_MAP (…/concept#Concept) resolves through the generic inverse", async () => {
      const store = new InMemoryTripleStore();
      await seedPredicate(
        store,
        "concept__Concept_related",
        "assetspaces/kitelev/exoas-concept/concept/11111111-0000-4000-8000-000000000007.md",
        symbolic("concept", "Concept"),
      );
      const deps = await depsFor(store, vaultFiles(), "concept__Concept_related");

      const option = deps.predicateOptions.find((o) => o.key === "concept__Concept_related");
      expect(option?.rangeClassUid).toBe("concept__Concept");
      expect(deps.resolveCandidates(option?.rangeClassUid)).toEqual([
        { uid: "c-3333", label: "Concept three" },
      ]);
    });

    it("R5 the predicate-definition maps (subject side) are unchanged by the range-key derivation", async () => {
      const store = new InMemoryTripleStore();
      await seedPredicate(
        store,
        "ems__Effort_parent",
        "assetspaces/kitelev/exoas-public/ems/6528ecfa-0000-4000-8000-000000000006.md",
        Namespace.EMS.term("Effort"),
      );
      await depsFor(store, vaultFiles(), "ems__Effort_parent");
      expect((modal as any).predicateDefUidByKey.get("ems__Effort_parent")).toBe(
        "6528ecfa-0000-4000-8000-000000000006",
      );
      expect((modal as any).keyByPredicateDefUid.get("6528ecfa-0000-4000-8000-000000000006")).toBe(
        "ems__Effort_parent",
      );
    });
  });

  /**
   * Ticket 7c02970c (parent bbac67ce) — the pre-existing lint debt of this modal
   * was not cosmetic: three catch handlers logged with a bare `console.error`
   * (bypassing the plugin's channel-routed Logger: console / notice / file
   * toggles), and two call sites invoked `FileManager.trashFile` (Obsidian
   * ≥ 1.6.6) on a plugin whose `minAppVersion` is 1.5.0 — an older host died
   * with a bare `TypeError: trashFile is not a function`.
   *
   * L1 — every catch handler routes through the Logger with the message AND the
   *      error object (mutant: revert to `console.error` → L1a/L1b/L1c RED).
   * L2 — statement-file deletion is guarded by `requireApiVersion("1.6.6")`
   *      through the ONE helper both call sites use (mutants: drop the guard →
   *      L2a/L2c RED; bypass the helper at either call site → that axis RED).
   */
  describe("lint-debt removal — Logger routing + trashFile API guard (ticket 7c02970c)", () => {
    const flushMicrotasks = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const loggerOf = (m: PropertyEditorModal) =>
      (m as unknown as { logger: { error: jest.Mock } }).logger;

    beforeEach(() => {
      modal = new PropertyEditorModal(
        mockApp,
        mockPlugin,
        mockFile,
        mockFrontmatter,
        mockNotifier,
      );
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("L1a a failing relations init is logged through the Logger with the error object", async () => {
      const boom = new Error("store down");
      jest.spyOn(modal as any, "buildRelationsDeps").mockRejectedValue(boom);
      modal.onOpen();
      await flushMicrotasks();
      expect(loggerOf(modal).error).toHaveBeenCalledWith(
        "Relations init error",
        boom,
      );
    });

    it("L1b the ErrorBoundary onError routes the user message + error object through the Logger", () => {
      modal.onOpen();
      const boundaryProps = mockRender.mock.calls[0][1].props;
      const boom = new Error("render exploded");
      boundaryProps.onError(boom);
      expect(loggerOf(modal).error).toHaveBeenCalledWith(
        "Error in property editor: render exploded",
        boom,
      );
    });

    it("L1c a failing save routes the user message + error object through the Logger", async () => {
      const boom = new Error("disk full");
      (mockApp.vault.read as jest.Mock).mockRejectedValue(boom);
      await (modal as any).handleSave({ key1: "value1" });
      expect(loggerOf(modal).error).toHaveBeenCalledWith(
        "Failed to save properties: disk full",
        boom,
      );
    });

    it("L3a a failing save toasts ONCE — logger.error exactly once with the full text, notificationService.error never (no double Notice)", async () => {
      (mockApp.vault.read as jest.Mock).mockRejectedValue(new Error("disk full"));
      await (modal as any).handleSave({ key1: "value1" });
      expect(loggerOf(modal).error).toHaveBeenCalledTimes(1);
      expect(loggerOf(modal).error.mock.calls[0][0]).toBe(
        "Failed to save properties: disk full",
      );
      expect(mockNotifier.error).not.toHaveBeenCalled();
    });

    it("L3b the ErrorBoundary onError toasts ONCE — logger.error exactly once with the full text, notificationService.error never", () => {
      modal.onOpen();
      mockRender.mock.calls[0][1].props.onError(new Error("render exploded"));
      expect(loggerOf(modal).error).toHaveBeenCalledTimes(1);
      expect(loggerOf(modal).error.mock.calls[0][0]).toBe(
        "Error in property editor: render exploded",
      );
      expect(mockNotifier.error).not.toHaveBeenCalled();
    });

    const statementFile = (path: string): TFile =>
      Object.assign(new TFile(), {
        path,
        basename: path.replace(/\.md$/, ""),
        name: path,
      });

    it("L2a deleteReified refuses with the real reason on a host older than 1.6.6 and never calls trashFile", async () => {
      const file = statementFile("statements/s-1.md");
      const trashFile = jest.fn().mockResolvedValue(undefined);
      (mockApp as any).vault.getAbstractFileByPath = jest
        .fn()
        .mockReturnValue(file);
      (mockApp as any).fileManager = { trashFile };
      const spy = jest
        .spyOn(obsidian, "requireApiVersion")
        .mockReturnValue(false);
      try {
        await expect(
          (modal as any).deleteReified({ statementPath: "statements/s-1.md" }),
        ).rejects.toThrow(/Obsidian 1\.6\.6/);
        expect(trashFile).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("L2b deleteReified trashes the statement via FileManager.trashFile on a host ≥ 1.6.6 (control)", async () => {
      const file = statementFile("statements/s-1.md");
      const trashFile = jest.fn().mockResolvedValue(undefined);
      (mockApp as any).vault.getAbstractFileByPath = jest
        .fn()
        .mockReturnValueOnce(file)
        .mockReturnValueOnce(null); // verify-after-write: gone
      (mockApp as any).fileManager = { trashFile };
      await (modal as any).deleteReified({
        statementPath: "statements/s-1.md",
      });
      expect(trashFile).toHaveBeenCalledWith(file);
      expect(mockNotifier.success).toHaveBeenCalledWith(
        "Reified relation removed",
      );
    });

    it("L2c the reify port's deleteStatement is guarded the same way (second call site)", async () => {
      const file = statementFile("statements/s-2.md");
      const trashFile = jest.fn().mockResolvedValue(undefined);
      (mockApp as any).vault.getAbstractFileByPath = jest
        .fn()
        .mockReturnValue(file);
      (mockApp as any).fileManager = { trashFile };
      const ports = (modal as any).reifyPorts("anchor-uid");
      const spy = jest
        .spyOn(obsidian, "requireApiVersion")
        .mockReturnValue(false);
      try {
        await expect(
          ports.deleteStatement("statements/s-2.md"),
        ).rejects.toThrow(/Obsidian 1\.6\.6/);
        expect(trashFile).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      await ports.deleteStatement("statements/s-2.md");
      expect(trashFile).toHaveBeenCalledWith(file);
    });
  });
});
