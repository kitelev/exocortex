import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";
import type { App, EventRef, TFile } from "obsidian";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  ApplicationErrorHandler,
  Namespace,
  discoverFileSpaceExclusions,
} from "@kitelev/exocortex-core";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

jest.mock("@kitelev/exocortex-core");
jest.mock("../../../src/adapters/ObsidianVaultAdapter");

/**
 * RFC 9821a379 AC10, second half (ticket 058bad52, founder's decision
 * 2026-10-30) — the indexer tells its listeners which file was deleted, once
 * the deletion has changed the store: AFTER the file's triples left it (after
 * the full rebuild in flight, if any — and dropping the triples that rebuild
 * read before the file went), or after the rebuild a deleted FileSpace
 * declaration or reified statement needs. A deletion that changed nothing (no
 * triples) and an edit are not announced.
 *
 * revert-verify: `VaultRDFIndexer.fileRemoved.spec.json`.
 */
describe("VaultRDFIndexer file-removed listeners (RFC 9821a379 AC10, ticket 058bad52)", () => {
  const file = { path: "episodes/e1.md", extension: "md" } as TFile;
  let events: string[];
  let fileTriples: unknown[];
  let slotTriples: unknown[];
  let declarationPaths: string[];
  let livePaths: Set<string>;
  let converter: {
    convertVaultWithValidation: jest.Mock;
    convertNote: jest.Mock;
  };

  function walkResult() {
    return {
      triples: [],
      skippedFiles: [],
      summary: { total: 1, indexed: 1, skipped: 0 },
      fileSpaces: { prefixes: [], declarationPaths, warnings: [] },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (discoverFileSpaceExclusions as jest.Mock).mockReset();
    events = [];
    fileTriples = [{ triple: "episodes/e1.md exo:Asset_label" }];
    slotTriples = [];
    declarationPaths = [];
    livePaths = new Set();
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
      // removeFileTriples: match(subject); wasReifiedStatement:
      // match(subject, exo:Statement_subject); hasInstances: match(_, prototype).
      match: jest.fn(async (_s?: unknown, p?: { value: string }) => {
        if (p === undefined) return fileTriples;
        return p.value.endsWith("#Statement_subject") ? slotTriples : [];
      }),
      removeAll: jest.fn(async (triples: unknown[]) => {
        events.push("removed");
        return triples.length;
      }),
    };
    converter = {
      convertVaultWithValidation: jest.fn(async () => {
        events.push("rebuilt");
        return walkResult();
      }),
      convertNote: jest.fn().mockResolvedValue([]),
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
      term: jest.fn((name: string) => ({
        value: `https://exocortex.my/ontology/exo#${name}`,
      })),
    };
  });

  async function makeIndexer(): Promise<VaultRDFIndexer> {
    const app = {
      vault: {
        on: jest.fn(() => ({}) as unknown as EventRef),
        offref: jest.fn(),
        getAllFiles: jest.fn(() => []),
        getAbstractFileByPath: jest.fn((path: string) =>
          livePaths.has(path) ? ({ path } as TFile) : null,
        ),
      },
      metadataCache: { on: jest.fn(), getFileCache: jest.fn(() => null) },
    } as unknown as App;
    const indexer = new VaultRDFIndexer(app, undefined, undefined, [], () => 0);
    await indexer.initialize();
    events = [];
    return indexer;
  }

  /** A rebuild held open until `finish()`; the walk had read e1.md already. */
  function holdRebuild(): () => Promise<void> {
    let release!: () => void;
    converter.convertVaultWithValidation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            events.push("rebuilt");
            resolve(walkResult());
          };
        }),
    );
    // The walk starts a few microtasks after refresh() (it awaits clear()).
    return async () => {
      for (let k = 0; k < 10; k += 1) await Promise.resolve();
      release();
    };
  }

  it("D1 @req:23f10730-82f7-4037-b566-da79d5fa3378 a deleted file is announced with its path, after its triples left the store", async () => {
    const indexer = await makeIndexer();
    indexer.onFileRemoved((path) => events.push(`notified ${path}`));
    await indexer.removeFile(file);
    expect(events).toEqual(["removed", "notified episodes/e1.md"]);
  });

  it("D2 @req:23f10730-82f7-4037-b566-da79d5fa3378 nothing is removed or announced while a full rebuild is in flight", async () => {
    const indexer = await makeIndexer();
    const finish = holdRebuild();
    const refresh = indexer.refresh();
    indexer.onFileRemoved((path) => events.push(`notified ${path}`));
    const removal = indexer.removeFile(file);
    for (let k = 0; k < 10; k += 1) await Promise.resolve();
    expect(events).toEqual([]);
    await finish();
    await refresh;
    await removal;
  });

  it("D9 @req:23f10730-82f7-4037-b566-da79d5fa3378 the triples a rebuild read of a file deleted meanwhile are dropped after it, then announced", async () => {
    const indexer = await makeIndexer();
    const finish = holdRebuild();
    const refresh = indexer.refresh();
    indexer.onFileRemoved((path) => events.push(`notified ${path}`));
    const removal = indexer.removeFile(file);
    await finish();
    await refresh;
    await removal;
    expect(events).toEqual(["rebuilt", "removed", "notified episodes/e1.md"]);
  });

  it("D10 @req:23f10730-82f7-4037-b566-da79d5fa3378 a path re-created during the rebuild keeps its triples and is not announced", async () => {
    const indexer = await makeIndexer();
    const finish = holdRebuild();
    const refresh = indexer.refresh();
    const listener = jest.fn();
    indexer.onFileRemoved(listener);
    const removal = indexer.removeFile(file);
    livePaths.add(file.path);
    await finish();
    await refresh;
    await removal;
    expect(events).toEqual(["rebuilt"]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("D14 @req:23f10730-82f7-4037-b566-da79d5fa3378 a reified statement re-created during the rebuild gets no purging rebuild and is not announced", async () => {
    slotTriples = [{ triple: "episodes/e1.md exo:Statement_subject" }];
    const indexer = await makeIndexer();
    const finish = holdRebuild();
    const refresh = indexer.refresh();
    const listener = jest.fn();
    indexer.onFileRemoved(listener);
    const removal = indexer.removeFile(file);
    livePaths.add(file.path);
    await finish();
    await refresh;
    await removal;
    expect(events).toEqual(["rebuilt"]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("D6 @req:23f10730-82f7-4037-b566-da79d5fa3378 deleting a reified statement is announced after the rebuild that purges its edge", async () => {
    slotTriples = [{ triple: "episodes/e1.md exo:Statement_subject" }];
    const indexer = await makeIndexer();
    indexer.onFileRemoved((path) => events.push(`notified ${path}`));
    await indexer.removeFile(file);
    expect(events).toEqual(["rebuilt", "notified episodes/e1.md"]);
  });

  it("D12 @req:23f10730-82f7-4037-b566-da79d5fa3378 a reified statement deleted while a rebuild that read it is in flight gets its own purging rebuild after it", async () => {
    slotTriples = [{ triple: "episodes/e1.md exo:Statement_subject" }];
    const indexer = await makeIndexer();
    const finish = holdRebuild();
    const refresh = indexer.refresh();
    indexer.onFileRemoved((path) => events.push(`notified ${path}`));
    const removal = indexer.removeFile(file);
    await finish();
    await refresh;
    await removal;
    expect(events).toEqual(["rebuilt", "rebuilt", "notified episodes/e1.md"]);
  });

  it("D13 @req:23f10730-82f7-4037-b566-da79d5fa3378 a FileSpace declaration deleted while a rebuild that read it is in flight gets its own re-mounting rebuild after it", async () => {
    declarationPaths = [file.path];
    const indexer = await makeIndexer();
    (discoverFileSpaceExclusions as jest.Mock).mockReturnValue({
      prefixes: ["files/"],
      declarationPaths: [],
      warnings: [],
    });
    const finish = holdRebuild();
    const refresh = indexer.refresh();
    indexer.onFileRemoved((path) => events.push(`notified ${path}`));
    const removal = indexer.removeFile(file);
    await finish();
    await refresh;
    await removal;
    expect(events).toEqual(["rebuilt", "rebuilt", "notified episodes/e1.md"]);
  });

  it("D11 @req:23f10730-82f7-4037-b566-da79d5fa3378 deleting a FileSpace declaration that changes the mounts is announced after the rebuild", async () => {
    declarationPaths = [file.path];
    const indexer = await makeIndexer();
    (discoverFileSpaceExclusions as jest.Mock).mockReturnValue({
      prefixes: ["files/"],
      declarationPaths: [],
      warnings: [],
    });
    indexer.onFileRemoved((path) => events.push(`notified ${path}`));
    await indexer.removeFile(file);
    expect(events).toEqual(["rebuilt", "notified episodes/e1.md"]);
  });

  it("D8 @req:23f10730-82f7-4037-b566-da79d5fa3378 deleting a file without triples (an attachment, an excluded folder) is not announced", async () => {
    fileTriples = [];
    const indexer = await makeIndexer();
    const listener = jest.fn();
    indexer.onFileRemoved(listener);
    await indexer.removeFile({ path: "attachments/pic.png", extension: "png" } as TFile);
    expect(listener).not.toHaveBeenCalled();
  });

  it("D3 @req:23f10730-82f7-4037-b566-da79d5fa3378 an edit of a file is not announced as a deletion", async () => {
    const indexer = await makeIndexer();
    const listener = jest.fn();
    indexer.onFileRemoved(listener);
    await indexer.updateFile(file);
    expect(events).toContain("removed");
    expect(listener).not.toHaveBeenCalled();
  });

  it("D4 @req:23f10730-82f7-4037-b566-da79d5fa3378 an unsubscribed listener is not told", async () => {
    const indexer = await makeIndexer();
    const listener = jest.fn();
    const unsubscribe = indexer.onFileRemoved(listener);
    unsubscribe();
    await indexer.removeFile(file);
    expect(listener).not.toHaveBeenCalled();
  });

  it("D7 @req:23f10730-82f7-4037-b566-da79d5fa3378 unsubscribing one listener leaves the others subscribed", async () => {
    const indexer = await makeIndexer();
    const kept = jest.fn();
    indexer.onFileRemoved(kept);
    const unsubscribe = indexer.onFileRemoved(jest.fn());
    unsubscribe();
    await indexer.removeFile(file);
    expect(kept).toHaveBeenCalledWith("episodes/e1.md");
  });

  it("D5 @req:23f10730-82f7-4037-b566-da79d5fa3378 a failing listener neither stops the next one nor fails the removal", async () => {
    const indexer = await makeIndexer();
    const next = jest.fn();
    indexer.onFileRemoved(() => {
      throw new Error("listener failed");
    });
    indexer.onFileRemoved(next);
    await expect(indexer.removeFile(file)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith("episodes/e1.md");
  });
});
