import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, TFile } from "obsidian";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  ApplicationErrorHandler,
  Namespace,
} from "exocortex";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

/**
 * Issue #3321 / RFC 0a0791c1 — VaultRDFIndexer must forward the active
 * effective-ontology filter snapshot to `NoteToRDFConverter.convertVault`
 * on both initial walk (`initialize`) and refresh (`refresh`).
 *
 * `refresh(effectiveOntologies?)` matches the `IRdfIndexer` contract from
 * B.4 so a `FocusProfileSwitchManager` instance can drive a profile-switch
 * reindex without knowing about the AssetSpace folder map. The folder map
 * is managed independently via `setAssetSpaceFolderToUid` (plugin-driven
 * at onload / on AssetSpace topology change).
 *
 * Following sibling `VaultRDFIndexer.excluded-folders.test.ts`: we mock
 * `exocortex` exports wholesale but keep the indexer's actual code under
 * test, then assert on the `convertVault` arguments AND on the new
 * `updateFile` filter guard.
 */

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
    shouldSkipFileForEffectiveSet: actual.shouldSkipFileForEffectiveSet,
  };
});
jest.mock("../../../src/adapters/ObsidianVaultAdapter");

describe("VaultRDFIndexer — effectiveOntologies plumbing (Issue #3321)", () => {
  let mockApp: App;
  let mockTripleStore: jest.Mocked<InMemoryTripleStore>;
  let mockConverter: jest.Mocked<NoteToRDFConverter>;

  // AssetSpace UID samples lifted from real vault data (profile-base
  // `_alwaysOnOverlay`, see assetspaces/shared-identities/ae00f219-...md).
  const EXO_AS_UID = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";
  const EXOCMD_AS_UID = "60967c6a-4e8a-4ee3-8922-db98b981e4f4";
  const EMS_AS_UID = "11111111-2222-3333-4444-555555555555"; // synthetic

  const makeFolderMap = (): ReadonlyMap<string, string> =>
    new Map<string, string>([
      ["assetspaces/exo", EXO_AS_UID],
      ["assetspaces/exocmd", EXOCMD_AS_UID],
      ["assetspaces/ems", EMS_AS_UID],
    ]);

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

  describe("snapshot lifecycle", () => {
    it("defaults to no filter and no folder map (backward-compat)", () => {
      const indexer = new VaultRDFIndexer(mockApp);
      expect(indexer.getEffectiveOntologies()).toBeNull();
      expect(indexer.getAssetSpaceFolderToUid()).toBeNull();
    });

    it("setEffectiveOntologies stores the snapshot without triggering reindex", () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const set = new Set<string>([EXO_AS_UID]);

      indexer.setEffectiveOntologies(set);

      expect(indexer.getEffectiveOntologies()).toBe(set);
      expect(mockConverter.convertVault).not.toHaveBeenCalled();
    });

    it("setAssetSpaceFolderToUid stores the map without triggering reindex", () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const map = makeFolderMap();

      indexer.setAssetSpaceFolderToUid(map);

      expect(indexer.getAssetSpaceFolderToUid()).toBe(map);
      expect(mockConverter.convertVault).not.toHaveBeenCalled();
    });

    it("clears each snapshot independently when null is passed", () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setEffectiveOntologies(new Set([EXO_AS_UID]));
      indexer.setAssetSpaceFolderToUid(makeFolderMap());
      indexer.setEffectiveOntologies(null);
      indexer.setAssetSpaceFolderToUid(null);
      expect(indexer.getEffectiveOntologies()).toBeNull();
      expect(indexer.getAssetSpaceFolderToUid()).toBeNull();
    });
  });

  describe("initialize", () => {
    it("forwards both stored snapshots to convertVault", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const eff = new Set<string>([EXO_AS_UID, EXOCMD_AS_UID]);
      const map = makeFolderMap();
      indexer.setEffectiveOntologies(eff);
      indexer.setAssetSpaceFolderToUid(map);

      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalledTimes(1);
      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBe(eff);
      expect(callArg.assetSpaceFolderToUid).toBe(map);
      expect(callArg.excludedFolders).toEqual([]);
    });

    it("forwards undefined when no filter is set (backward-compat)", async () => {
      const indexer = new VaultRDFIndexer(mockApp);

      await indexer.initialize();

      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBeUndefined();
      expect(callArg.assetSpaceFolderToUid).toBeUndefined();
    });
  });

  describe("refresh — IRdfIndexer contract", () => {
    it("forwards both stored snapshots when called with no argument", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const eff = new Set<string>([EXO_AS_UID]);
      const map = makeFolderMap();
      indexer.setEffectiveOntologies(eff);
      indexer.setAssetSpaceFolderToUid(map);

      await indexer.refresh();

      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBe(eff);
      expect(callArg.assetSpaceFolderToUid).toBe(map);
    });

    it("updates the effective set when called with a new Set (matches IRdfIndexer)", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const original = new Set<string>([EXO_AS_UID]);
      const replacement = new Set<string>([EXO_AS_UID, EXOCMD_AS_UID]);
      indexer.setEffectiveOntologies(original);
      indexer.setAssetSpaceFolderToUid(makeFolderMap());

      // Single-arg refresh — exactly what FocusProfileSwitchManager calls:
      //   await this.rdfIndexer.refresh(effective);
      await indexer.refresh(replacement);

      expect(indexer.getEffectiveOntologies()).toBe(replacement);
      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBe(replacement);
    });

    it("preserves the stored effective set when refresh() is called without args", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const eff = new Set<string>([EXO_AS_UID]);
      indexer.setEffectiveOntologies(eff);

      await indexer.refresh();

      expect(indexer.getEffectiveOntologies()).toBe(eff);
    });

    it("forwards undefined when nothing is set", async () => {
      const indexer = new VaultRDFIndexer(mockApp);

      await indexer.refresh();

      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBeUndefined();
      expect(callArg.assetSpaceFolderToUid).toBeUndefined();
    });

    it("clears the triple store before re-walking with the filter", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setEffectiveOntologies(new Set<string>([EXO_AS_UID]));
      indexer.setAssetSpaceFolderToUid(makeFolderMap());

      await indexer.refresh();

      const clearOrder = mockTripleStore.clear.mock.invocationCallOrder[0];
      const convertOrder = mockConverter.convertVault.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(convertOrder!);
    });
  });

  describe("updateFile — mid-session filter guard (Issue #3321 R15)", () => {
    /**
     * Constructs a minimal TFile-shaped mock. The real `TFile` is an
     * Obsidian class we can't import in unit tests; the indexer only
     * touches `path`, `extension`, and `basename`.
     */
    const tfile = (path: string): TFile =>
      ({
        path,
        extension: "md",
        basename: path.split("/").pop()!.replace(/\.md$/, ""),
      }) as unknown as TFile;

    it("skips re-indexing AND defensively removes stale triples for a filtered-out AssetSpace file", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setEffectiveOntologies(new Set<string>([EXO_AS_UID]));
      indexer.setAssetSpaceFolderToUid(makeFolderMap());

      // Simulate stale triples in the store from a pre-filter indexing run.
      // `removeFileTriples` calls `match(fileIRI)` then `removeAll(triples)`;
      // we satisfy both by returning one mock triple from `match`.
      mockTripleStore.match.mockResolvedValueOnce([{ id: "stale" } as any]);

      // ems is mapped to EMS_AS_UID; NOT in the active set → filtered.
      // Edit-event for `assetspaces/ems/Task.md` must not produce new triples.
      const file = tfile("assetspaces/ems/Task.md");
      await indexer.updateFile(file);

      // Primary assertion — the file was rejected BEFORE reaching the
      // converter (the discriminating signal between "filter active" and
      // "filter disabled" paths).
      expect(mockConverter.convertNote).not.toHaveBeenCalled();
      // Defensive cleanup assertion — stale triples are explicitly removed,
      // not just left in place. `removeAll` is the real discriminator (the
      // `match` call alone is consistent with several other paths).
      expect(mockTripleStore.removeAll).toHaveBeenCalled();
    });

    it("indexes files inside an in-scope AssetSpace folder normally", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setEffectiveOntologies(new Set<string>([EXO_AS_UID]));
      indexer.setAssetSpaceFolderToUid(makeFolderMap());

      const file = tfile("assetspaces/exo/Class.md");
      await indexer.updateFile(file);

      // exo IS in the active set → file flows through the normal path.
      expect(mockConverter.convertNote).toHaveBeenCalledTimes(1);
    });

    it("indexes files outside `assetspaces/` regardless of the filter", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setEffectiveOntologies(new Set<string>([EXO_AS_UID]));
      indexer.setAssetSpaceFolderToUid(makeFolderMap());

      const file = tfile("03 Knowledge/note.md");
      await indexer.updateFile(file);

      expect(mockConverter.convertNote).toHaveBeenCalledTimes(1);
    });

    it("does NOT guard when no filter is active (backward-compat)", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      // No setEffectiveOntologies call — filter disengaged.

      const file = tfile("assetspaces/ems/Task.md");
      await indexer.updateFile(file);

      // The legacy unfiltered path indexes normally.
      expect(mockConverter.convertNote).toHaveBeenCalledTimes(1);
    });

    it("does NOT guard when the folder map is missing (caller bug; degrade gracefully)", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setEffectiveOntologies(new Set<string>([EXO_AS_UID]));
      // No setAssetSpaceFolderToUid call.

      const file = tfile("assetspaces/ems/Task.md");
      await indexer.updateFile(file);

      // Without the folder map the guard cannot resolve ownership →
      // indexes normally. Consistent with the converter's R15 fall-back.
      expect(mockConverter.convertNote).toHaveBeenCalledTimes(1);
    });
  });
});
