import type * as React from "react";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  createTripleStoreClassPropertyResolver,
  type ClassPropertyField,
} from "@kitelev/exocortex-core";
import type { IFile } from "@kitelev/exocortex-core/interfaces/IVaultAdapter";
import { App, TFile } from "obsidian";
import type { ExocortexPluginInterface } from "@plugin/types";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import {
  getPropertySchemaForClass,
  initClassPropertyResolver,
  classPropertyFieldsToSchema,
  FALLBACK_EFFORT_STATUS_VALUES,
} from "@plugin/domain/property-editor/PropertySchemas";
import { PropertyEditorModal } from "@plugin/presentation/modals/PropertyEditorModal";
import type { RelationsFormDeps } from "@plugin/presentation/components/property-editor/PropertyEditorForm";

/**
 * req 9e19f141 — the property editor's schema provider is fed by the DECLARED
 * property resolver (`createTripleStoreClassPropertyResolver`, req 07509cf9,
 * v16.246.0) instead of the OWL layer, which is dead on live data.
 *
 * Production-shape by construction: the store is built by the REAL
 * `NoteToRDFConverter` from note frontmatter, so the dual-IRI forms these guards
 * engage on are EMITTED by the converter rather than staged by the fixture — a
 * class reference whose target carries a `prefix__Name` label comes out
 * SYMBOLICALLY, and `exo__Asset_label` on such an asset comes out as an IRI, not
 * a Literal (`sparql-iri-form-pre-verify` §A29). The resolver, the provider, the
 * modal and `findAssetRefCandidates` are all the production ones.
 *
 * Revert-verify: `property-editor-class-property-9e19f141.{schemas,modal,relations}.spec.json`
 * next to this file, driven by `~/.claude/bin/mutant-driver.py`.
 */

/** `exo__Class` / `exo__Property` — the metaclasses the fixture instantiates. */
const EXO_CLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9";
const EXO_PROPERTY = "38277bfa-d7f9-4a75-b856-b23276ab0db3";

const CLS_BASE = "c1a55000-0000-4000-8000-00000000000b";
const CLS_HOST = "c1a55000-0000-4000-8000-00000000000a";
const CLS_LONE = "c1a55000-0000-4000-8000-00000000000c";
const CLS_PICK = "c1a55000-0000-4000-8000-00000000000d";
const CLS_STAT = "c1a55000-0000-4000-8000-00000000000e";
const CLS_OTHER = "c1a55000-0000-4000-8000-00000000000f";
/**
 * A range class used by NOTHING but the memoisation axes. P6a must start on a
 * COLD cache: a class another axis already scanned would make the "cache lives
 * module-wide" mutant redden P6a too, and then it and the "no memoisation"
 * mutant would share one red set — which proves one conjunct, not two
 * (`integration-test-revert-verify` §A110).
 */
const CLS_SHARED = "c1a55000-0000-4000-8000-000000000010";

/**
 * The status class instance count. Deliberately **9**: it must differ from the
 * SIX of `FALLBACK_EFFORT_STATUS_VALUES` and from the FOUR of the fallback
 * property list, otherwise a mutant that returns a hardcoded list would be
 * indistinguishable from reading the graph (req 9e19f141, condition 1). The
 * live vault currently holds 16 `ems__EffortStatus` instances against 6 in the
 * hardcoded table — the fixture only has to avoid both hardcoded lengths.
 */
const LIVE_STATUS_COUNT = 9;

/** The four keys of `FALLBACK_PROPERTIES`, which is module-private. */
const FALLBACK_KEYS = [
  "exo__Asset_label",
  "exo__Asset_uid",
  "exo__Asset_createdAt",
  "exo__Asset_archived",
];

type Note = { path: string; basename: string; fm: Record<string, unknown> };

const note = (uid: string, fm: Record<string, unknown>): Note => ({
  path: `assetspaces/kitelev/exoas-tst/tst/${uid}.md`,
  basename: uid,
  fm: { exo__Asset_uid: uid, ...fm },
});

const classNote = (uid: string, label: string, superUid?: string): Note =>
  note(uid, {
    exo__Instance_class: [`[[${EXO_CLASS}]]`],
    exo__Asset_label: label,
    ...(superUid ? { exo__Class_superClass: [`[[${superUid}]]`] } : {}),
  });

const propertyNote = (opts: {
  uid: string;
  label: string;
  domainUid: string;
  rangeUid?: string;
  rangeLiteral?: string;
  minCount?: number;
}): Note =>
  note(opts.uid, {
    exo__Instance_class: [`[[${EXO_PROPERTY}]]`],
    exo__Asset_label: opts.label,
    exo__Property_domain: [`[[${opts.domainUid}]]`],
    ...(opts.rangeUid ? { exo__Property_range: [`[[${opts.rangeUid}]]`] } : {}),
    ...(opts.rangeLiteral ? { exo__Property_range: opts.rangeLiteral } : {}),
    ...(opts.minCount === undefined ? {} : { exo__Property_minCount: opts.minCount }),
  });

const instanceNote = (uid: string, label: string, clsUid: string): Note =>
  note(uid, { exo__Asset_label: label, exo__Instance_class: [`[[${clsUid}]]`] });

/** Property definitions declared on the host's own class. */
const HOST_PROPERTY_KEYS = [
  "tst__Host_alpha",
  "tst__Host_beta",
  "tst__Host_gamma",
  "tst__Host_pick",
  "tst__Host_state",
  "tst__Host_when",
  "tst__Host_count",
  "tst__Host_flag",
];
/** Property definitions declared on the ANCESTOR — inherited through the chain. */
const BASE_PROPERTY_KEYS = [
  "tst__Base_note",
  "tst__Base_must",
  "exo__Asset_uid",
  "exo__Asset_createdAt",
  "exo__Asset_archived",
  "exo__Asset_isDefinedBy",
];
const DECLARED_KEYS = [...HOST_PROPERTY_KEYS, ...BASE_PROPERTY_KEYS].sort();

const fixtureNotes = (): Note[] => [
  classNote(CLS_BASE, "tst__Base"),
  classNote(CLS_HOST, "tst__Host", CLS_BASE),
  classNote(CLS_LONE, "tst__Lone"),
  classNote(CLS_PICK, "tst__Pick"),
  classNote(CLS_STAT, "tst__Stat"),
  classNote(CLS_OTHER, "tst__Other"),
  classNote(CLS_SHARED, "tst__Shared"),

  // Three reference fields SHARING one range class — the memoisation input.
  propertyNote({ uid: "d0000000-0000-4000-8000-00000000000a", label: "tst__Host_alpha", domainUid: CLS_HOST, rangeUid: CLS_SHARED }),
  propertyNote({ uid: "d0000000-0000-4000-8000-00000000000b", label: "tst__Host_beta", domainUid: CLS_HOST, rangeUid: CLS_SHARED }),
  propertyNote({ uid: "d0000000-0000-4000-8000-00000000000c", label: "tst__Host_gamma", domainUid: CLS_HOST, rangeUid: CLS_SHARED }),
  // The reference field P3 reads — its own range class, so the memoisation
  // axes below stay on a class nothing else has scanned.
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000016", label: "tst__Host_pick", domainUid: CLS_HOST, rangeUid: CLS_PICK }),
  // A reference field whose range is the enum-like status class.
  propertyNote({ uid: "d0000000-0000-4000-8000-00000000000d", label: "tst__Host_state", domainUid: CLS_HOST, rangeUid: CLS_STAT }),
  // Datatype ranges — one per mapped field type.
  propertyNote({ uid: "d0000000-0000-4000-8000-00000000000e", label: "tst__Host_when", domainUid: CLS_HOST, rangeLiteral: "xsd:dateTime" }),
  propertyNote({ uid: "d0000000-0000-4000-8000-00000000000f", label: "tst__Host_count", domainUid: CLS_HOST, rangeLiteral: "xsd:integer" }),
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000010", label: "tst__Host_flag", domainUid: CLS_HOST, rangeLiteral: "xsd:boolean" }),
  // Inherited from the ancestor: one plain (no range ⇒ `text`), one REQUIRED.
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000011", label: "tst__Base_note", domainUid: CLS_BASE }),
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000012", label: "tst__Base_must", domainUid: CLS_BASE, minCount: 1 }),
  // Three of the four fallback keys are DECLARED here; `exo__Asset_label` is
  // deliberately left out so "the fallback list does not merge itself in"
  // stays observable by its ABSENCE.
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000013", label: "exo__Asset_uid", domainUid: CLS_BASE, rangeLiteral: "xsd:integer" }),
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000014", label: "exo__Asset_createdAt", domainUid: CLS_BASE }),
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000017", label: "exo__Asset_archived", domainUid: CLS_BASE }),
  // A SYSTEM relation key with an object range: it must be typed like any
  // other reference field, yet never offered as a create-predicate.
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000018", label: "exo__Asset_isDefinedBy", domainUid: CLS_BASE, rangeUid: CLS_PICK }),
  // Declared on an UNRELATED class — "every declared property" must not be
  // satisfiable by returning everything.
  propertyNote({ uid: "d0000000-0000-4000-8000-000000000015", label: "tst__Other_noise", domainUid: CLS_OTHER }),

  instanceNote("a0000000-0000-4000-8000-000000000001", "Pick A", CLS_PICK),
  instanceNote("a0000000-0000-4000-8000-000000000002", "Pick B", CLS_PICK),
  instanceNote("a0000000-0000-4000-8000-000000000003", "Shared One", CLS_SHARED),
  ...Array.from({ length: LIVE_STATUS_COUNT }, (_, i) =>
    instanceNote(
      `50000000-0000-4000-8000-00000000000${i.toString(16)}`,
      `Status ${i}`,
      CLS_STAT,
    ),
  ),
];

const PICK_A = "a0000000-0000-4000-8000-000000000001";
const PICK_B = "a0000000-0000-4000-8000-000000000002";

const asFile = (n: Note): IFile =>
  ({ path: n.path, basename: n.basename, name: `${n.basename}.md`, extension: "md" }) as unknown as IFile;

/** A vault adapter warm enough for the converter to resolve every `[[uid]]`. */
const adapterFor = (notes: Note[]) => {
  const byUid = new Map(notes.map((n) => [n.basename, n]));
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const files = notes.map(asFile);
  return {
    getFiles: () => files,
    getMarkdownFiles: () => files,
    getAbstractFileByPath: (p: string) => (byPath.has(p) ? asFile(byPath.get(p)!) : null),
    getFirstLinkpathDest: (lp: string) => (byUid.has(lp) ? asFile(byUid.get(lp)!) : null),
    getFrontmatter: (f: IFile) => byPath.get(f.path)?.fm ?? null,
    getFrontmatterWithFallback: async (f: IFile) => byPath.get(f.path)?.fm ?? null,
    read: async () => "",
    getName: () => "tst-vault",
  } as never;
};

/** Build the production-shape store: every note through the REAL converter. */
const buildStore = async (notes: Note[]): Promise<InMemoryTripleStore> => {
  const store = new InMemoryTripleStore();
  const converter = new NoteToRDFConverter(adapterFor(notes));
  for (const n of notes) {
    const triples = await converter.convertNoteFromFrontmatter(asFile(n), n.fm);
    for (const t of triples) await store.add(t);
  }
  return store;
};

jest.mock("@plugin/presentation/utils/ReactRenderer");

/**
 * `findAssetRefCandidates` is wrapped rather than replaced: the axes need the
 * REAL scan (it is the production candidate source) AND a call counter. A plain
 * arrow in the factory — NOT `jest.fn` — because this config sets
 * `resetMocks: true`, which would strip a `jest.fn` implementation before the
 * first test ever runs (`integration-test-revert-verify` §A87).
 */
const mockRefCandidateCalls: string[] = [];
jest.mock("@plugin/presentation/utils/assetRefCandidates", () => ({
  __esModule: true,
  findAssetRefCandidates: (app: unknown, classUid: string) => {
    mockRefCandidateCalls.push(classUid);
    return jest
      .requireActual("@plugin/presentation/utils/assetRefCandidates")
      .findAssetRefCandidates(app, classUid);
  },
}));

jest.mock("@plugin/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
}));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("property editor — declared-property schema (req 9e19f141)", () => {
  let store: InMemoryTripleStore;
  let notes: Note[];

  beforeEach(async () => {
    mockRefCandidateCalls.length = 0;
    notes = fixtureNotes();
    store = await buildStore(notes);
    initClassPropertyResolver(createTripleStoreClassPropertyResolver(store));
  });

  afterEach(() => {
    initClassPropertyResolver(null);
  });

  // ---------------------------------------------------------------- provider

  it("P1 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a class with declared properties gets THEM, and the fallback list does not shadow them", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);

    expect(schema.map((p) => p.name).sort()).toEqual(DECLARED_KEYS);
    // 14 declared against the 4 of the fallback list — the shape of the req.
    expect(schema).toHaveLength(14);
    // Fallback-only keys that the fixture does NOT declare must be absent:
    // their presence would mean the fallback was merged in, not replaced.
    expect(schema.map((p) => p.name)).not.toContain("exo__Asset_label");
    // A property declared on an unrelated class must not leak in.
    expect(schema.map((p) => p.name)).not.toContain("tst__Other_noise");
  });

  it("P2 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a class with no declared properties keeps the previous behaviour — the fallback list", async () => {
    const schema = await getPropertySchemaForClass(CLS_LONE);

    expect(schema.map((p) => p.name)).toEqual(FALLBACK_KEYS);
    expect(schema).toHaveLength(4);
  });

  it("P7 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a declared property with minCount > 0 is marked required, from the resolver's own flag", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);

    // The fixture SEEDS `minCount: 1` — the live `ems__Task` chain has none at
    // all (0 of 73), so without the seed this axis would be vacuously green
    // (`integration-test-revert-verify` §A105 / §A111).
    expect(schema.find((p) => p.name === "tst__Base_must")?.required).toBe(true);
    expect(schema.find((p) => p.name === "tst__Base_note")?.required).toBe(false);
    // Exactly two: the seeded one (from the GRAPH's minCount) and
    // `exo__Asset_createdAt` (from the FALLBACK shape — see P18). Naming both
    // keeps the flag observable rather than letting a blanket "required"
    // pass this axis.
    expect(schema.filter((p) => p.required).map((p) => p.name).sort()).toEqual([
      "exo__Asset_createdAt",
      "tst__Base_must",
    ]);
  });

  it("P8 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 declared system keys inherit read-only from the fallback list instead of becoming editable", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);

    expect(schema.find((p) => p.name === "exo__Asset_uid")?.readOnly).toBe(true);
    expect(schema.find((p) => p.name === "exo__Asset_createdAt")?.readOnly).toBe(true);
    // Exactly the two the fallback marks — nothing else is silently frozen.
    expect(schema.filter((p) => p.readOnly).map((p) => p.name).sort()).toEqual([
      "exo__Asset_createdAt",
      "exo__Asset_uid",
    ]);
    expect(schema.find((p) => p.name === "tst__Base_note")?.readOnly).toBeUndefined();
  });

  it("P11 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a date range renders as a timestamp field", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    expect(schema.find((p) => p.name === "tst__Host_when")?.type).toBe("timestamp");
  });

  it("P12 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a numeric range renders as a number field", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    expect(schema.find((p) => p.name === "tst__Host_count")?.type).toBe("number");
  });

  it("P13 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a boolean range renders as a boolean field", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    expect(schema.find((p) => p.name === "tst__Host_flag")?.type).toBe("boolean");
  });

  it("P14 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a property with no declared range falls back to text, and an object range becomes a reference field", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    expect(schema.find((p) => p.name === "tst__Base_note")?.type).toBe("text");
    expect(schema.find((p) => p.name === "tst__Host_alpha")?.type).toBe("wikilink");
  });

  /**
   * The mapper is exported and takes the port's shape, so its branches are
   * exercised on the inputs that shape admits — including a field whose label
   * differs from its key, and one whose label is empty. On the live graph the
   * engine always sets `label === propertyKey`, so these two branches are only
   * separable on a public-API input (`integration-test-revert-verify` §A93).
   */
  const mapperFields: ClassPropertyField[] = [
    { propertyKey: "tst__A_keyed", label: "Nice caption", fieldType: "text", required: false },
    { propertyKey: "tst__A_unlabelled", label: "", fieldType: "text", required: false },
  ];

  it("P10a @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 the frontmatter key comes from propertyKey, never from the caption", () => {
    const schema = classPropertyFieldsToSchema(mapperFields);

    expect(schema[0].name).toBe("tst__A_keyed");
    expect(schema[0].label).toBe("Nice caption");
  });

  it("P10b @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 an empty caption falls back to the frontmatter key", () => {
    const schema = classPropertyFieldsToSchema(mapperFields);

    expect(schema[1].name).toBe("tst__A_unlabelled");
    expect(schema[1].label).toBe("tst__A_unlabelled");
  });


  /**
   * The live TBox declares NO `exo__Property_range` for the fallback keys
   * (measured 2026-09-22: the engine types `exo__Asset_label`, `_uid`,
   * `_createdAt`, `_archived` all as `text`), so taking the engine's answer
   * verbatim would silently downgrade shipped field shapes. The fixture mirrors
   * that: these keys are declared WITHOUT a range.
   */
  it("P16 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a fallback key the graph cannot type keeps the fallback's field type — a boolean stays a boolean, not text", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    expect(schema.find((p) => p.name === "exo__Asset_archived")?.type).toBe("boolean");
  });

  it("P17 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 the same for a timestamp — a range-less createdAt is not downgraded to text", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    expect(schema.find((p) => p.name === "exo__Asset_createdAt")?.type).toBe("timestamp");
  });

  it("P18 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a fallback key the graph cannot type keeps the fallback's required flag", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    // `_createdAt` is mandatory in the fallback list; `_archived` is not — so this
    // is the flag travelling, not a blanket "everything from the fallback is required".
    expect(schema.find((p) => p.name === "exo__Asset_createdAt")?.required).toBe(true);
    expect(schema.find((p) => p.name === "exo__Asset_archived")?.required).toBe(false);
  });

  it("P19 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a DECLARED range still wins over the fallback's guess — the graph is the source wherever it speaks", async () => {
    const schema = await getPropertySchemaForClass(CLS_HOST);
    // `exo__Asset_uid` is declared with `xsd:integer` in the fixture. Declaring the
    // missing ranges in the TBox is exactly how the fallback branch gets retired,
    // so this input is what production looks like AFTER that repair.
    const uid = schema.find((p) => p.name === "exo__Asset_uid");
    expect(uid?.type).toBe("number");
    // …and the read-only decision is a separate branch, unaffected by it.
    expect(uid?.readOnly).toBe(true);
  });

  // ------------------------------------------------------------------- modal

  describe("through the modal", () => {
    let modal: PropertyEditorModal;
    let mockRender: jest.Mock;
    let vaultModify: jest.Mock;
    let app: App;
    let plugin: ExocortexPluginInterface;
    let hostFile: TFile;
    let notifier: { success: jest.Mock; error: jest.Mock; info: jest.Mock; warn: jest.Mock };

    const HOST_NOTE = "---\nexo__Instance_class:\n  - \"[[" + CLS_HOST + "]]\"\n---\nbody\n";

    beforeEach(() => {
      // ⛔ Clear the resolver the outer `beforeEach` wired: these axes must be
      // fed by the MODAL's own wiring, not by the harness. Without this line a
      // mutant that drops `initSchemaResolver()` would leave every modal axis
      // green — the axes would pass for a reason that is not the product.
      initClassPropertyResolver(null);
      mockRender = jest.fn();
      (ReactRenderer as jest.Mock).mockImplementation(() => ({
        render: mockRender,
        unmount: jest.fn(),
      }));
      vaultModify = jest.fn().mockResolvedValue(undefined);
      notifier = { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };

      app = {
        vault: {
          read: jest.fn().mockResolvedValue(HOST_NOTE),
          modify: vaultModify,
          getMarkdownFiles: () =>
            notes.map((n) => ({ basename: n.basename, path: n.path })),
        },
        metadataCache: {
          getFileCache: (f: { path: string }) => ({
            frontmatter: notes.find((n) => n.path === f.path)?.fm,
          }),
        },
      } as unknown as App;

      plugin = {
        refreshLayout: jest.fn(),
        // Reachable but NOT ready: the reified pass is skipped by the
        // cold-start guard, so only the schema/range pass runs.
        getSPARQLApi: () => ({ getTripleStore: () => store, isReady: () => false }),
      } as unknown as ExocortexPluginInterface;

      hostFile = {
        basename: "host-asset",
        path: "assetspaces/kitelev/exoas-tst/tst/host-asset.md",
        name: "host-asset.md",
        extension: "md",
      } as TFile;
    });

    /** Open the modal the way production does and return the built deps. */
    const open = async (): Promise<RelationsFormDeps> => {
      modal = new PropertyEditorModal(
        app,
        plugin,
        hostFile,
        { exo__Instance_class: [`[[${CLS_HOST}]]`] },
        notifier as never,
      );
      (modal as unknown as { contentEl: unknown }).contentEl = {
        addClass: jest.fn(),
        empty: jest.fn(),
        createDiv: jest.fn().mockImplementation(() => document.createElement("div")),
        createEl: jest.fn().mockImplementation((tag: string) => document.createElement(tag)),
      };
      modal.onOpen();
      await flush();
      const call = mockRender.mock.calls.at(-1);
      const el = call?.[1] as React.ReactElement<{
        children: React.ReactElement<{ relations?: RelationsFormDeps }>;
      }>;
      const deps = el?.props?.children?.props?.relations;
      expect(deps).toBeDefined();
      return deps as RelationsFormDeps;
    };

    it("P3 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a declared reference field offers the candidates of ITS range class", async () => {
      const deps = await open();

      const option = deps.predicateOptions.find((o) => o.key === "tst__Host_pick");
      expect(option).toBeDefined();
      expect(deps.resolveCandidates(option?.rangeClassUid)).toEqual([
        { uid: PICK_A, label: "Pick A" },
        { uid: PICK_B, label: "Pick B" },
      ]);
    });

    it("P5 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 the status-like field offers one option per LIVE instance, not the length of a hardcoded list", async () => {
      const deps = await open();

      const option = deps.predicateOptions.find((o) => o.key === "tst__Host_state");
      expect(option).toBeDefined();
      expect(deps.resolveCandidates(option?.rangeClassUid)).toHaveLength(LIVE_STATUS_COUNT);
      // Fixture hygiene, stated in the test as the req requires: 9 must differ
      // from BOTH hardcoded lengths, or a "return the hardcoded list" mutant
      // would be indistinguishable from reading the graph.
      expect(LIVE_STATUS_COUNT).not.toBe(FALLBACK_EFFORT_STATUS_VALUES.length);
      expect(LIVE_STATUS_COUNT).not.toBe(FALLBACK_KEYS.length);
    });

    it("P4 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a chosen candidate is written as a bare-UID wikilink, and the write actually happened", async () => {
      const deps = await open();

      await deps.createInline("tst__Host_alpha", PICK_A);

      // The conjunct: an empty artefact is not a pass (§A63).
      expect(vaultModify).toHaveBeenCalledTimes(1);
      const written = vaultModify.mock.calls[0][1] as string;
      expect(written).toContain(`"[[${PICK_A}]]"`);
      // Not the path form: no folder segments, no `.md` inside the wikilink.
      expect(written).not.toMatch(/\[\[[^\]]*\//);
      expect(written).not.toMatch(/\[\[[^\]]*\.md/);
    });

    it("P6a @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 fields sharing a range class are scanned once WITHIN one open", async () => {
      const deps = await open();

      const shared = ["tst__Host_alpha", "tst__Host_beta", "tst__Host_gamma"].map((k) =>
        deps.predicateOptions.find((o) => o.key === k),
      );
      expect(shared.every((o) => o !== undefined)).toBe(true);
      const rangeKey = shared[0]?.rangeClassUid;
      expect(rangeKey).toBeDefined();
      expect(shared.every((o) => o?.rangeClassUid === rangeKey)).toBe(true);

      mockRefCandidateCalls.length = 0;
      for (const option of shared) deps.resolveCandidates(option?.rangeClassUid);

      expect(mockRefCandidateCalls.filter((c) => c === rangeKey)).toHaveLength(1);
    });

    it("P6b @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 the candidate cache does NOT outlive the open — a second open re-scans exactly once", async () => {
      const first = await open();
      mockRefCandidateCalls.length = 0;
      const rangeKey = first.predicateOptions.find((o) => o.key === "tst__Host_alpha")?.rangeClassUid;
      first.resolveCandidates(rangeKey);
      first.resolveCandidates(rangeKey);

      const second = await open();
      second.resolveCandidates(rangeKey);
      second.resolveCandidates(rangeKey);

      // One scan per OPEN: 1 + 1. A cache that outlived the open would give 1
      // (stale candidates across opens); no cache at all would give 4.
      expect(mockRefCandidateCalls.filter((c) => c === rangeKey)).toHaveLength(2);
    });

    it("P20 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a SYSTEM relation key is never offered as a create-predicate, however it is typed", async () => {
      const deps = await open();

      const offered = deps.predicateOptions.map((o) => o.key);
      // It IS in the schema as a reference field — the exclusion is about the
      // create-row, not about typing.
      const schema = await getPropertySchemaForClass(CLS_HOST);
      expect(schema.find((p) => p.name === "exo__Asset_isDefinedBy")?.type).toBe("wikilink");
      // …but offering it would let one click append a SECOND isDefinedBy
      // (`createInlineRelation` never replaces), breaking co-location.
      expect(offered).not.toContain("exo__Asset_isDefinedBy");
      // The non-system reference fields are still offered, so this is an
      // exclusion and not an empty list.
      expect(offered).toContain("tst__Host_pick");
    });

    it("P9 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 a field with no resolved range class is not scanned at all", async () => {
      const deps = await open();
      mockRefCandidateCalls.length = 0;

      expect(deps.resolveCandidates(undefined)).toEqual([]);

      expect(mockRefCandidateCalls).toHaveLength(0);
    });

    it("P15 @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3 opening with no reachable store CLEARS a resolver left over from a previous open", async () => {
      // A previous modal's resolver, built over a store that may no longer be
      // the live one. Opening without a store must not let it answer.
      initClassPropertyResolver(createTripleStoreClassPropertyResolver(store));
      expect(await getPropertySchemaForClass(CLS_HOST)).toHaveLength(14);

      plugin = { refreshLayout: jest.fn() } as unknown as ExocortexPluginInterface;
      modal = new PropertyEditorModal(
        app,
        plugin,
        hostFile,
        { exo__Instance_class: [`[[${CLS_HOST}]]`] },
        notifier as never,
      );
      (modal as unknown as { contentEl: unknown }).contentEl = {
        addClass: jest.fn(),
        empty: jest.fn(),
        createDiv: jest.fn().mockImplementation(() => document.createElement("div")),
        createEl: jest.fn().mockImplementation((tag: string) => document.createElement(tag)),
      };

      modal.onOpen();
      await flush();

      // A resolver left over from a previous modal — built over a store that may
      // no longer be the live one — must not answer here.
      expect(await getPropertySchemaForClass(CLS_HOST)).toHaveLength(4);
    });
  });
});
