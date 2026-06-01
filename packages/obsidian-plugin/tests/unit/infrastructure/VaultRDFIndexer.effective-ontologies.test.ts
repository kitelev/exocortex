import { VaultRDFIndexer, type EffectiveOntologyFilter } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App } from "obsidian";
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
 * Following sibling `VaultRDFIndexer.excluded-folders.test.ts`: we mock
 * `exocortex` exports wholesale but keep the indexer's actual code under
 * test, then assert on the `convertVault` arguments. This is the right
 * granularity for "does the indexer plumb the filter end-to-end" — the
 * converter's own filter semantics are covered by the package-level
 * `NoteToRDFConverter.effective-ontologies.test.ts`.
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

  const makeFilter = (): EffectiveOntologyFilter => ({
    effectiveOntologies: new Set<string>([EXO_AS_UID, EXOCMD_AS_UID]),
    assetSpaceFolderToUid: new Map<string, string>([
      ["assetspaces/exo", EXO_AS_UID],
      ["assetspaces/exocmd", EXOCMD_AS_UID],
    ]),
  });

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

  describe("filter snapshot lifecycle", () => {
    it("defaults to no filter (backward-compat)", () => {
      const indexer = new VaultRDFIndexer(mockApp);
      expect(indexer.getFilter()).toBeNull();
    });

    it("stores the filter via setFilter without triggering reindex", () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const filter = makeFilter();

      indexer.setFilter(filter);

      expect(indexer.getFilter()).toBe(filter);
      // setFilter must NOT call convertVault — order is caller's concern.
      expect(mockConverter.convertVault).not.toHaveBeenCalled();
    });

    it("clears the filter when null is passed", () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setFilter(makeFilter());
      indexer.setFilter(null);

      expect(indexer.getFilter()).toBeNull();
    });
  });

  describe("initialize", () => {
    it("forwards the stored filter snapshot to convertVault", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const filter = makeFilter();
      indexer.setFilter(filter);

      await indexer.initialize();

      expect(mockConverter.convertVault).toHaveBeenCalledTimes(1);
      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBe(filter.effectiveOntologies);
      expect(callArg.assetSpaceFolderToUid).toBe(filter.assetSpaceFolderToUid);
      // excludedFolders still forwarded (backward-compat)
      expect(callArg.excludedFolders).toEqual([]);
    });

    it("forwards undefined filter fields when no filter is set", async () => {
      const indexer = new VaultRDFIndexer(mockApp);

      await indexer.initialize();

      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBeUndefined();
      expect(callArg.assetSpaceFolderToUid).toBeUndefined();
    });
  });

  describe("refresh", () => {
    it("forwards the stored filter snapshot to convertVault (no argument)", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const filter = makeFilter();
      indexer.setFilter(filter);

      await indexer.refresh();

      expect(mockConverter.convertVault).toHaveBeenCalledTimes(1);
      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBe(filter.effectiveOntologies);
      expect(callArg.assetSpaceFolderToUid).toBe(filter.assetSpaceFolderToUid);
    });

    it("updates and applies the filter snapshot atomically when passed", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const firstFilter = makeFilter();
      const secondFilter: EffectiveOntologyFilter = {
        effectiveOntologies: new Set<string>([EXO_AS_UID]),
        assetSpaceFolderToUid: new Map<string, string>([
          ["assetspaces/exo", EXO_AS_UID],
        ]),
      };
      indexer.setFilter(firstFilter);

      // refresh(secondFilter) replaces the stored snapshot AND runs the walk
      await indexer.refresh(secondFilter);

      expect(indexer.getFilter()).toBe(secondFilter);
      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBe(secondFilter.effectiveOntologies);
      expect(callArg.assetSpaceFolderToUid).toBe(secondFilter.assetSpaceFolderToUid);
    });

    it("preserves the stored snapshot when refresh() is called with no argument", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      const filter = makeFilter();
      indexer.setFilter(filter);

      await indexer.refresh();

      // No mutation — the snapshot is still the one we set.
      expect(indexer.getFilter()).toBe(filter);
    });

    it("forwards undefined filter fields when no filter is set", async () => {
      const indexer = new VaultRDFIndexer(mockApp);

      await indexer.refresh();

      const callArg = mockConverter.convertVault.mock.calls[0]![0]!;
      expect(callArg.effectiveOntologies).toBeUndefined();
      expect(callArg.assetSpaceFolderToUid).toBeUndefined();
    });

    it("clears the triple store before re-walking with the filter", async () => {
      const indexer = new VaultRDFIndexer(mockApp);
      indexer.setFilter(makeFilter());

      await indexer.refresh();

      // clear() must come BEFORE convertVault() — otherwise stale triples
      // from the previous filter would remain. The mocks track call order
      // via invocationCallOrder.
      const clearOrder = mockTripleStore.clear.mock.invocationCallOrder[0];
      const convertOrder = mockConverter.convertVault.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(convertOrder!);
    });
  });
});
