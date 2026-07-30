/**
 * Issue #3936 — an incremental re-index of a reified `exo__Statement` note must
 * NOT leave its OLD materialized logical edge stale in the store.
 *
 * `convertLegacyNote` (EKA D5) emits, for a note typed `exo__Statement`, an
 * extra edge `<subject> <predicate> <object>` whose SUBJECT is the statement's
 * referent — NOT the statement file's IRI. `VaultRDFIndexer.removeFileTriples`
 * is subject-scoped to the file IRI (`match(fileIRI)`), so on a live edit that
 * changes the statement's object A→B the OLD edge `<subj> <pred> A` survives the
 * incremental purge and lingers alongside the new `<subj> <pred> B` — a
 * stale-divergent triple a SPARQL `<subj> <pred> ?o` query would wrongly see as
 * {A, B} until the next FULL refresh (reload / profile-apply) self-heals it.
 *
 * Fix: `updateFile` detects (from the PRE-edit store state) that the file is a
 * reified statement and does a full `refresh()` (clear + rebuild) instead of the
 * subject-scoped incremental path, purging the stale edge.
 *
 * Production-shape: this uses the REAL `InMemoryTripleStore` (asserts actual
 * store contents), the REAL `Namespace`/`IRI`/`Triple`, and the REAL `updateFile`
 * dispatch. Only the converter (emission source) and the inference scaffolding
 * are mocked, so the store-mutation behaviour under test is genuine. Empirically
 * verified to FAIL pre-fix (old edge lingers) and PASS post-fix (old edge gone).
 *
 * Scope note (issue premise re-scoped on this branch): the A2 symbolic
 * superclass edges the issue also cited do NOT exist here (their PR #3935 was
 * CLOSED, not merged). The enum `rdf:type` shadow is intentionally out of scope
 * — those are globally-true, idempotent facts about the enum instance, never
 * stale-divergent. The reified-statement edge is the one real stale case.
 */
import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, TFile } from "obsidian";
import {
  InMemoryTripleStore,
  DomainIRI,
  DomainTriple,
  Namespace,
  ApplicationErrorHandler,
  NoteToRDFConverter,
} from "@kitelev/exocortex-core";

// Real core everything (store, IRI, Triple, Namespace, isPathExcluded, …),
// overriding ONLY the converter (emission source we control) + inference
// scaffolding + error handler (run-inline). This keeps the store mutation and
// the updateFile dispatch genuine — the crux of the regression.
jest.mock("@kitelev/exocortex-core", () => {
  const actual = jest.requireActual("@kitelev/exocortex-core");
  return {
    ...actual,
    NoteToRDFConverter: jest.fn(),
    ApplicationErrorHandler: jest.fn(),
    RDFSInferenceEngine: jest.fn(),
    NonInheritablePropertyRegistry: jest.fn(),
    PropertyCardinalityRegistry: jest.fn(),
    PrototypeChainMaterializer: jest.fn(),
  };
});
jest.mock("../../../src/adapters/ObsidianVaultAdapter");

const STMT_PATH = "concepts/stmt.md";
const stmtFileIRI = new DomainIRI(`obsidian://vault/${STMT_PATH}`);
const subjIRI = new DomainIRI("obsidian://vault/concepts/subject.md");
const predIRI = new DomainIRI("https://exocortex.my/ontology/exo#related");
const objAIRI = new DomainIRI("obsidian://vault/concepts/objA.md");
const objBIRI = new DomainIRI("obsidian://vault/concepts/objB.md");

const statementClass = Namespace.EXO.term("Statement");
const rdfType = Namespace.RDF.term("type");
const stmtSubjectPred = Namespace.EXO.term("Statement_subject");

// Statement-file triples + the materialized reified edge. The rdf:type triple
// (subject = file IRI) is what `wasReifiedStatement` detects; the reified edge
// (subject = subjIRI) is the non-file-IRI-subject triple `removeFileTriples`
// cannot evict.
const stmtTriples = (objIRI: DomainIRI): DomainTriple[] => [
  new DomainTriple(stmtFileIRI, rdfType, statementClass),
  new DomainTriple(stmtFileIRI, stmtSubjectPred, subjIRI),
  new DomainTriple(subjIRI, predIRI, objIRI),
];

function makeFile(path: string): TFile {
  return {
    path,
    extension: "md",
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
    name: path.split("/").pop()!,
  } as unknown as TFile;
}

describe("Issue #3936 — reified exo__Statement incremental re-index purges the stale edge", () => {
  let mockApp: App;
  let mockConverter: jest.Mocked<NoteToRDFConverter>;
  // The current full-vault emission (what a refresh re-reads); flipped to the
  // post-edit state before firing updateFile.
  let currentFull: DomainTriple[];

  beforeEach(() => {
    jest.clearAllMocks();
    currentFull = stmtTriples(objAIRI); // initial: object = A

    (
      ApplicationErrorHandler as jest.MockedClass<typeof ApplicationErrorHandler>
    ).mockImplementation(
      () =>
        ({
          executeWithRetry: jest
            .fn()
            .mockImplementation(async (op: () => Promise<unknown>) => op()),
          handle: jest.fn(),
        }) as any,
    );

    mockApp = {
      vault: {
        on: jest.fn().mockReturnValue({}),
        off: jest.fn(),
        offref: jest.fn(),
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getAllFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        on: jest.fn(),
        off: jest.fn(),
        getFileCache: jest.fn().mockReturnValue(null),
      },
    } as unknown as App;

    mockConverter = {
      convertVault: jest.fn().mockImplementation(async () => currentFull),
      convertVaultWithValidation: jest.fn().mockImplementation(async () => ({
        triples: currentFull,
        skippedFiles: [],
        summary: { total: 1, indexed: 1, skipped: 0 },
        fileSpaces: { prefixes: [], declarationPaths: [], warnings: [] },
      })),
      // Only reached on the incremental (pre-fix) path — returns the NEW note.
      convertNote: jest.fn().mockImplementation(async () => stmtTriples(objBIRI)),
    } as any;

    (
      NoteToRDFConverter as jest.MockedClass<typeof NoteToRDFConverter>
    ).mockImplementation(() => mockConverter);

    const mocked = jest.requireMock("@kitelev/exocortex-core") as any;
    for (const cls of [
      "RDFSInferenceEngine",
      "NonInheritablePropertyRegistry",
      "PropertyCardinalityRegistry",
      "PrototypeChainMaterializer",
    ]) {
      mocked[cls].mockImplementation(() => ({
        materialize: jest.fn().mockResolvedValue(undefined),
        initialize: jest.fn().mockResolvedValue(undefined),
      }));
    }
  });

  it("purges the OLD reified edge on a live statement edit (KEY: fails pre-fix)", async () => {
    const indexer = new VaultRDFIndexer(mockApp);
    await indexer.initialize();
    const store: InMemoryTripleStore = indexer.getTripleStore();

    // Sanity: initial store has the A edge, not B.
    expect(await store.match(subjIRI, predIRI, objAIRI)).toHaveLength(1);
    expect(await store.match(subjIRI, predIRI, objBIRI)).toHaveLength(0);

    // Simulate the on-disk edit (object A→B) a refresh will re-read.
    currentFull = stmtTriples(objBIRI);

    await indexer.updateFile(makeFile(STMT_PATH));

    // KEY: the OLD A edge must be GONE (stale-divergent otherwise).
    expect(await store.match(subjIRI, predIRI, objAIRI)).toHaveLength(0);
    // And the NEW B edge is present.
    expect((await store.match(subjIRI, predIRI, objBIRI)).length).toBeGreaterThan(0);
  });

  it("does NOT full-refresh an ordinary (non-statement) note edit — incremental path preserved", async () => {
    // A non-statement note: no rdf:type exo__Statement in the store.
    currentFull = [
      new DomainTriple(
        new DomainIRI("obsidian://vault/concepts/plain.md"),
        Namespace.EXO.term("Asset_label"),
        // a literal-ish; label value irrelevant to the dispatch assertion
        new DomainIRI("obsidian://vault/concepts/whatever.md"),
      ),
    ];
    const indexer = new VaultRDFIndexer(mockApp);
    await indexer.initialize();

    const refreshSpy = jest.spyOn(indexer, "refresh");
    await indexer.updateFile(makeFile("concepts/plain.md"));

    // Ordinary edit → incremental path (convertNote), NOT a full refresh.
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(mockConverter.convertNote).toHaveBeenCalledTimes(1);
  });
});
