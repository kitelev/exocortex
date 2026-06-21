import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, TFile, EventRef } from "obsidian";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  ApplicationErrorHandler,
  Namespace,
} from "exocortex";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

jest.mock("exocortex");
jest.mock("../../../src/adapters/ObsidianVaultAdapter");

/**
 * Issue #3472 — full-walk stats recording.
 *
 * The «indexing complete» notice needs N files / M skipped / duration from
 * the last FULL vault walk. The skipped counter must be the one produced by
 * the Issue #3468 aggregation (`convertVaultWithValidation().summary`), not
 * a second parallel metric. Incremental per-file updates must not touch the
 * recorded stats — they are quiet by design.
 */
describe("VaultRDFIndexer walk stats (Issue #3472)", () => {
  let mockApp: App;
  let mockTripleStore: jest.Mocked<InMemoryTripleStore>;
  let mockConverter: jest.Mocked<NoteToRDFConverter>;
  let now: jest.Mock<number, []>;

  // Production-shape summary as produced by NoteToRDFConverter (#3468):
  // summary.skipped === skippedFiles.length (invariant violations +
  // invalid IRIs), summary.indexed === total - skipped.
  const walkResult = {
    triples: [],
    skippedFiles: [
      { path: "bad-iri.md", reason: "invalid IRI" },
      { path: "violation.md", reason: "invariant violation" },
      { path: "violation-2.md", reason: "invariant violation" },
    ],
    summary: { total: 100, indexed: 97, skipped: 3 },
    fileSpaces: { prefixes: [], declarationPaths: [], warnings: [] },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (ApplicationErrorHandler as jest.MockedClass<typeof ApplicationErrorHandler>).mockImplementation(() => ({
      executeWithRetry: jest.fn().mockImplementation(async (operation: () => Promise<unknown>) => {
        return await operation();
      }),
      handle: jest.fn(),
    } as any));

    mockApp = {
      vault: {
        on: jest.fn(() => ({}) as unknown as EventRef),
        off: jest.fn(),
        offref: jest.fn(),
        getAllFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        on: jest.fn(),
        off: jest.fn(),
        getFileCache: jest.fn().mockReturnValue(null),
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
      convertVaultWithValidation: jest.fn().mockResolvedValue(walkResult),
      convertNote: jest.fn().mockResolvedValue([]),
    } as any;

    (InMemoryTripleStore as jest.MockedClass<typeof InMemoryTripleStore>).mockImplementation(() => mockTripleStore);
    (NoteToRDFConverter as jest.MockedClass<typeof NoteToRDFConverter>).mockImplementation(() => mockConverter);
    (ObsidianVaultAdapter as jest.MockedClass<typeof ObsidianVaultAdapter>).mockImplementation(() => ({}) as any);

    const mockPrototypePredicate = { value: "https://exocortex.my/ontology/exo#Asset_prototype" };
    (Namespace as any).EXO = { term: jest.fn().mockReturnValue(mockPrototypePredicate) };

    now = jest.fn<number, []>();
  });

  function makeIndexer(): VaultRDFIndexer {
    return new VaultRDFIndexer(mockApp, undefined, undefined, [], now);
  }

  it("returns null before any full walk has completed", () => {
    const indexer = makeIndexer();

    expect(indexer.getLastWalkStats()).toBeNull();
  });

  it("records stats of the initial walk from the #3468 summary (initialize)", async () => {
    now.mockReturnValueOnce(1000).mockReturnValueOnce(4500);
    const indexer = makeIndexer();

    await indexer.initialize();

    expect(indexer.getLastWalkStats()).toEqual({
      total: 100,
      indexed: 97,
      skipped: 3,
      durationMs: 3500,
      finishedAt: 4500,
    });
  });

  it("records fresh stats on a full refresh", async () => {
    now
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(4500) // initialize walk
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(12_000); // refresh walk
    const indexer = makeIndexer();
    await indexer.initialize();

    mockConverter.convertVaultWithValidation.mockResolvedValueOnce({
      ...walkResult,
      summary: { total: 101, indexed: 99, skipped: 2 },
    } as any);
    await indexer.refresh();

    expect(indexer.getLastWalkStats()).toEqual({
      total: 101,
      indexed: 99,
      skipped: 2,
      durationMs: 2000,
      finishedAt: 12_000,
    });
  });

  it("does NOT touch walk stats on incremental per-file updates", async () => {
    now.mockReturnValueOnce(1000).mockReturnValueOnce(4500);
    const indexer = makeIndexer();
    await indexer.initialize();
    const statsAfterInit = indexer.getLastWalkStats();

    const mockFile = { path: "test.md", extension: "md" } as TFile;
    await indexer.updateFile(mockFile);

    expect(indexer.getLastWalkStats()).toEqual(statsAfterInit);
  });

  it("does not record stats when the walk fails", async () => {
    now.mockReturnValue(1000);
    mockConverter.convertVaultWithValidation.mockRejectedValueOnce(
      new Error("walk failed"),
    );
    const indexer = makeIndexer();

    let threw = false;
    try {
      await indexer.initialize();
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(indexer.getLastWalkStats()).toBeNull();
  });

  // ── #al-activitylog-progress: onIndexProgress threading into convertVault ──

  it("forwards the onIndexProgress sink into convertVaultWithValidation (initialize)", async () => {
    now.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const onIndexProgress = jest.fn();
    const indexer = new VaultRDFIndexer(
      mockApp,
      undefined,
      undefined,
      [],
      now,
      onIndexProgress,
    );

    await indexer.initialize();

    expect(mockConverter.convertVaultWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: onIndexProgress }),
    );
  });

  it("forwards the onIndexProgress sink into convertVaultWithValidation (refresh)", async () => {
    now.mockReturnValue(1000);
    const onIndexProgress = jest.fn();
    const indexer = new VaultRDFIndexer(
      mockApp,
      undefined,
      undefined,
      [],
      now,
      onIndexProgress,
    );
    await indexer.initialize();
    mockConverter.convertVaultWithValidation.mockClear();

    await indexer.refresh();

    expect(mockConverter.convertVaultWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: onIndexProgress }),
    );
  });

  it("passes onProgress: undefined when no sink is wired (default)", async () => {
    now.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const indexer = new VaultRDFIndexer(mockApp, undefined, undefined, [], now);

    await indexer.initialize();

    expect(mockConverter.convertVaultWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: undefined }),
    );
  });
});
