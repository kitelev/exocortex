import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, TFile, EventRef } from "obsidian";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  ApplicationErrorHandler,
  Namespace,
} from "exocortex";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

// Mock `exocortex` wholesale (matches the sibling VaultRDFIndexer.test.ts
// strategy) but pin `isPathExcluded` / `normaliseExcludedFolders` to the
// PRODUCTION implementations via `jest.requireActual`. Replicating helpers
// inline drifts from production semantics over time — e.g. the trailing-
// slash auto-append landed in `normaliseExcludedFolders` after this suite
// was written, and an inline copy without it would let sibling-folder
// over-match silently slip back in (see ~/.claude/rules/test-fixture-
// realism.md). The other exports are stubs because the indexer pulls them
// in for types or unrelated subsystems we don't exercise here.
jest.mock("exocortex", () => {
  const actual = jest.requireActual("exocortex");
  return {
    InMemoryTripleStore: jest.fn(),
    NoteToRDFConverter: jest.fn(),
    ApplicationErrorHandler: jest.fn(),
    RDFSInferenceEngine: jest.fn(),
    NonInheritablePropertyRegistry: jest.fn(),
    PropertyCardinalityRegistry: jest.fn(),
    PrototypeChainMaterializer: jest.fn(),
    INFERRED_GRAPH: "https://exocortex.my/graph/inferred",
    Namespace: { EXO: { term: jest.fn() } },
    NetworkError: class NetworkError extends Error {},
    ServiceError: class ServiceError extends Error {
      constructor(msg: string, public meta?: unknown) {
        super(msg);
      }
    },
    IRI: class IRI {
      constructor(public value: string) {}
      toString() {
        return this.value;
      }
    },
    isPathExcluded: actual.isPathExcluded,
    normaliseExcludedFolders: actual.normaliseExcludedFolders,
  };
});
jest.mock("../../../src/adapters/ObsidianVaultAdapter");

describe("VaultRDFIndexer — excludedFolders plumbing", () => {
  let mockApp: App;
  let mockTripleStore: jest.Mocked<InMemoryTripleStore>;
  let mockConverter: jest.Mocked<NoteToRDFConverter>;

  beforeEach(() => {
    jest.clearAllMocks();

    (
      ApplicationErrorHandler as jest.MockedClass<
        typeof ApplicationErrorHandler
      >
    ).mockImplementation(
      () =>
        ({
          executeWithRetry: jest
            .fn()
            .mockImplementation(async (operation: () => Promise<unknown>) => {
              return await operation();
            }),
          handle: jest.fn(),
        }) as any,
    );

    mockApp = {
      vault: {
        on: jest.fn(),
        off: jest.fn(),
        offref: jest.fn(),
        getAllFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        on: jest.fn(),
        off: jest.fn(),
      },
    } as unknown as App;

    mockTripleStore = {
      addAll: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      clearGraph: jest.fn().mockResolvedValue(undefined),
      match: jest.fn().mockResolvedValue([]),
      removeAll: jest.fn().mockResolvedValue(0),
    } as any;

    mockConverter = {
      convertVault: jest.fn().mockResolvedValue([]),
      convertNote: jest.fn().mockResolvedValue([]),
    } as any;

    (
      InMemoryTripleStore as jest.MockedClass<typeof InMemoryTripleStore>
    ).mockImplementation(() => mockTripleStore);
    (
      NoteToRDFConverter as jest.MockedClass<typeof NoteToRDFConverter>
    ).mockImplementation(() => mockConverter);
    (
      ObsidianVaultAdapter as jest.MockedClass<typeof ObsidianVaultAdapter>
    ).mockImplementation(() => ({}) as any);

    // RDFS inference scaffolding — VaultRDFIndexer always runs an inference
    // pass after a full vault walk; these mocks just need to expose the
    // method names so the await-chain resolves.
    const {
      RDFSInferenceEngine,
      NonInheritablePropertyRegistry,
      PropertyCardinalityRegistry,
      PrototypeChainMaterializer,
    } = jest.requireMock("exocortex") as {
      RDFSInferenceEngine: jest.Mock;
      NonInheritablePropertyRegistry: jest.Mock;
      PropertyCardinalityRegistry: jest.Mock;
      PrototypeChainMaterializer: jest.Mock;
    };
    RDFSInferenceEngine.mockImplementation(() => ({
      materialize: jest.fn().mockResolvedValue(undefined),
    }));
    NonInheritablePropertyRegistry.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
    }));
    PropertyCardinalityRegistry.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
    }));
    PrototypeChainMaterializer.mockImplementation(() => ({
      materialize: jest.fn().mockResolvedValue(undefined),
    }));

    const mockPrototypePredicate = {
      value: "https://exocortex.my/ontology/exo#Asset_prototype",
    };
    (Namespace as any).EXO = {
      term: jest.fn().mockReturnValue(mockPrototypePredicate),
    };
  });

  describe("initialize", () => {
    it("forwards configured excludedFolders to converter.convertVault", async () => {
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "09 Templates/",
        "10 Drafts/",
      ]);

      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalledWith({
        excludedFolders: ["09 Templates/", "10 Drafts/"],
      });
    });

    it("defaults to an empty list when no excludedFolders argument is passed", async () => {
      const indexer = new VaultRDFIndexer(mockApp);

      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalledWith({
        excludedFolders: [],
      });
    });

    it("normalises the constructor argument (drops empty entries, trims whitespace)", async () => {
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "  09 Templates/  ",
        "",
        "   ",
        "10 Drafts/",
      ]);

      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalledWith({
        excludedFolders: ["09 Templates/", "10 Drafts/"],
      });
    });

    it("auto-appends a trailing slash to user-typed entries without one", async () => {
      // Regression guard — exercises that `requireActual` for
      // `normaliseExcludedFolders` brings the production auto-append rule
      // into this suite. A unit-of-production-truth test: if the helper
      // ever loses auto-append, this fails here (sibling-folder over-match
      // would slip back in silently otherwise).
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "09 Templates",
        "10 Drafts/",
      ]);

      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalledWith({
        excludedFolders: ["09 Templates/", "10 Drafts/"],
      });
    });
  });

  describe("refresh", () => {
    it("forwards configured excludedFolders to converter.convertVault", async () => {
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "09 Templates/",
      ]);

      await indexer.refresh();

      expect(mockConverter.convertVault).toHaveBeenCalledWith({
        excludedFolders: ["09 Templates/"],
      });
    });
  });

  describe("updateFile", () => {
    function makeFile(path: string): TFile {
      return {
        path,
        extension: "md",
        basename: path.split("/").pop()!.replace(/\.md$/, ""),
        name: path.split("/").pop()!,
      } as unknown as TFile;
    }

    it("skips convertNote for files inside an excluded folder", async () => {
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "09 Templates/",
      ]);

      const templatesFile = makeFile("09 Templates/some-template.md");

      await indexer.updateFile(templatesFile);

      // The whole point of the feature: a per-file event for an excluded
      // folder must NOT push the file through the converter (which is what
      // emits the "Skipping file with invariant violation" warn-log).
      expect(mockConverter.convertNote).not.toHaveBeenCalled();
    });

    it("still calls convertNote for files OUTSIDE excluded folders", async () => {
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "09 Templates/",
      ]);

      const realFile = makeFile("03 Knowledge/real-task.md");

      await indexer.updateFile(realFile);

      expect(mockConverter.convertNote).toHaveBeenCalledTimes(1);
      // Match by `.path` rather than reference equality — the indexer
      // currently passes `file as IFile` directly, but a defensive
      // path-based check tolerates future wrapping (e.g. an adapter that
      // produces a fresh IFile object).
      const passed = mockConverter.convertNote.mock.calls[0][0] as {
        path: string;
      };
      expect(passed.path).toBe(realFile.path);
    });

    it("removes stale triples when an excluded-folder file is edited", async () => {
      // Scenario: a file was indexed earlier (before the user added its
      // folder to the exclusion list). When the user next edits the file,
      // the indexer should evict its stale triples so SPARQL queries no
      // longer see them — even though we no longer re-convert.
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "09 Templates/",
      ]);

      const templatesFile = makeFile("09 Templates/old-asset.md");

      await indexer.updateFile(templatesFile);

      expect(mockTripleStore.match).toHaveBeenCalled();
      // removeAll is invoked even with an empty `match` result; the
      // important contract is that the indexer DID attempt to evict.
      expect(mockTripleStore.removeAll).toHaveBeenCalled();
    });

    it("ignores non-markdown files regardless of folder exclusion", async () => {
      const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [
        "09 Templates/",
      ]);
      const pngFile = {
        path: "03 Knowledge/picture.png",
        extension: "png",
      } as unknown as TFile;

      await indexer.updateFile(pngFile);

      expect(mockConverter.convertNote).not.toHaveBeenCalled();
      // Also the eviction path must not fire for non-md files — they were
      // never indexed in the first place.
      expect(mockTripleStore.removeAll).not.toHaveBeenCalled();
    });
  });
});
