import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, EventRef } from "obsidian";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  ApplicationErrorHandler,
  Namespace,
} from "@kitelev/exocortex-core";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

jest.mock("@kitelev/exocortex-core");
jest.mock("../../../src/adapters/ObsidianVaultAdapter");

/**
 * RFC 9821a379 decision 7 (ticket 058bad52) — the indexer reports a FULL
 * rebuild in flight (`isRefreshing`) and when it settles
 * (`whenRefreshSettled`, success or failure). `IndexStability` reads both.
 *
 * revert-verify: `VaultRDFIndexer.refreshState.spec.json`.
 */
describe("VaultRDFIndexer refresh state (RFC 9821a379 decision 7, ticket 058bad52)", () => {
  const walkResult = {
    triples: [],
    skippedFiles: [],
    summary: { total: 1, indexed: 1, skipped: 0 },
    fileSpaces: { prefixes: [], declarationPaths: [], warnings: [] },
  };
  let converter: { convertVaultWithValidation: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    (
      ApplicationErrorHandler as jest.MockedClass<
        typeof ApplicationErrorHandler
      >
    ).mockImplementation(
      () =>
        ({
          executeWithRetry: jest.fn(async (operation: () => Promise<unknown>) =>
            operation(),
          ),
          handle: jest.fn(),
        }) as never,
    );
    const store = {
      addAll: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      clearGraph: jest.fn().mockResolvedValue(undefined),
      match: jest.fn().mockResolvedValue([]),
      removeAll: jest.fn().mockResolvedValue(0),
    };
    converter = {
      convertVaultWithValidation: jest.fn().mockResolvedValue(walkResult),
    };
    (
      InMemoryTripleStore as jest.MockedClass<typeof InMemoryTripleStore>
    ).mockImplementation(() => store as never);
    (
      NoteToRDFConverter as jest.MockedClass<typeof NoteToRDFConverter>
    ).mockImplementation(() => converter as never);
    (
      ObsidianVaultAdapter as jest.MockedClass<typeof ObsidianVaultAdapter>
    ).mockImplementation(() => ({}) as never);
    (Namespace as unknown as { EXO: unknown }).EXO = {
      term: jest.fn().mockReturnValue({
        value: "https://exocortex.my/ontology/exo#Asset_prototype",
      }),
    };
  });

  function makeIndexer(): VaultRDFIndexer {
    const app = {
      vault: {
        on: jest.fn(() => ({}) as unknown as EventRef),
        offref: jest.fn(),
        getAllFiles: jest.fn(() => []),
      },
      metadataCache: { on: jest.fn(), getFileCache: jest.fn(() => null) },
    } as unknown as App;
    return new VaultRDFIndexer(app, undefined, undefined, [], () => 0);
  }

  it("R1 @req:23f10730-82f7-4037-b566-da79d5fa3378 a full rebuild is reported in flight until it settles", async () => {
    const indexer = makeIndexer();
    await indexer.initialize();
    expect(indexer.isRefreshing()).toBe(false);
    let finish!: () => void;
    converter.convertVaultWithValidation.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(walkResult))),
    );
    const refresh = indexer.refresh();
    expect(indexer.isRefreshing()).toBe(true);
    for (let k = 0; k < 10; k += 1) await Promise.resolve();
    expect(indexer.isRefreshing()).toBe(true);
    finish();
    await refresh;
    await indexer.whenRefreshSettled();
    expect(indexer.isRefreshing()).toBe(false);
  });

  it("R4 @req:23f10730-82f7-4037-b566-da79d5fa3378 whenRefreshSettled resolves only after the rebuild settles", async () => {
    const indexer = makeIndexer();
    await indexer.initialize();
    let finish!: () => void;
    converter.convertVaultWithValidation.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(walkResult))),
    );
    const refresh = indexer.refresh();
    let settled = false;
    void indexer.whenRefreshSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await refresh;
    await indexer.whenRefreshSettled();
    expect(settled).toBe(true);
  });

  it("R2 @req:23f10730-82f7-4037-b566-da79d5fa3378 a failed rebuild also settles (the latch never rejects)", async () => {
    const indexer = makeIndexer();
    await indexer.initialize();
    converter.convertVaultWithValidation.mockRejectedValueOnce(
      new Error("walk failed"),
    );
    const refresh = indexer.refresh().catch(() => undefined);
    await expect(indexer.whenRefreshSettled()).resolves.toBeUndefined();
    await refresh;
    expect(indexer.isRefreshing()).toBe(false);
  });
  it("R3 @req:23f10730-82f7-4037-b566-da79d5fa3378 only a rebuild that completed is counted", async () => {
    const indexer = makeIndexer();
    await indexer.initialize();
    expect(indexer.getCompletedRefreshCount()).toBe(0);
    await indexer.refresh();
    expect(indexer.getCompletedRefreshCount()).toBe(1);
    converter.convertVaultWithValidation.mockRejectedValueOnce(
      new Error("walk failed"),
    );
    await indexer.refresh().catch(() => undefined);
    expect(indexer.getCompletedRefreshCount()).toBe(1);
  });
});
