/**
 * req ebbe3db4 (RFC 14217015 AC1c, scenario S8) — the plugin's incremental
 * re-index purges the stale materialized edge of a statement whose class is a
 * SUBCLASS of exo__Statement («Тезис» `exoization__Thesis`).
 *
 * Since req ebbe3db4 the converter materializes `<subject> <predicate> <object>`
 * for a subclass statement too. Issue #3936 routed a reified statement to a full
 * `refresh()` (its edge has a non-file subject that the subject-scoped
 * `removeFileTriples` cannot evict) by `<file> rdf:type exo#Statement` — but a
 * thesis is typed by ITS class, so that test missed it and the old edge stayed
 * stale after an edit. `wasReifiedStatement` now keys on the file's
 * `exo:Statement_subject` triple.
 *
 * Same production shape as the #3936 suite: REAL `InMemoryTripleStore`, REAL
 * `updateFile` dispatch; only the converter (emission source) and the inference
 * scaffolding are mocked.
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

// The thesis is typed by ITS OWN class — never `exo#Statement`.
const thesisClass = new DomainIRI("https://exocortex.my/ontology/exoization#Thesis");
const rdfType = Namespace.RDF.term("type");
const stmtSubjectPred = Namespace.EXO.term("Statement_subject");

// Thesis-file triples + the materialized edge. The `exo:Statement_subject`
// triple (subject = file IRI) is what `wasReifiedStatement` detects; the edge
// (subject = subjIRI) is the non-file-IRI-subject triple `removeFileTriples`
// cannot evict.
const stmtTriples = (objIRI: DomainIRI): DomainTriple[] => [
  new DomainTriple(stmtFileIRI, rdfType, thesisClass),
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

describe("req ebbe3db4 — a SUBCLASS statement's incremental re-index purges its stale edge", () => {
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

  it("S8 @req:ebbe3db4-ab96-4e5c-ada1-198698c91570 purges the OLD edge of a Thesis-typed statement on a live edit", async () => {
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

  it("S8b @req:ebbe3db4-ab96-4e5c-ada1-198698c91570 an ordinary note edit still takes the incremental path (no full refresh)", async () => {
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
    expect(mockConverter.convertNote.mock.calls).toHaveLength(1);
  });
});
