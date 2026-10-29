/**
 * RFC 9821a379 decision 7 (ticket 058bad52) — the index state reaches the
 * plugin through the REAL chain SPARQLApi → SPARQLQueryService →
 * VaultRDFIndexer (no mocked service): a passthrough that drops the value would
 * make the block answer from a store being rebuilt. AC10: so does the
 * «file removed» signal the plugin re-renders on.
 *
 * revert-verify: `SPARQLApi.indexState.spec.json`.
 */
import { SPARQLApi } from "../../../../src/application/api/SPARQLApi";
import type ExocortexPlugin from "../../../../src/ExocortexPlugin";
import type { VaultRDFIndexer } from "../../../../src/infrastructure/VaultRDFIndexer";
import type { TFile } from "obsidian";
import { IRI, Literal, Triple } from "@kitelev/exocortex-core";

function api(): { api: SPARQLApi; indexer: VaultRDFIndexer } {
  const app = {
    vault: {
      on: jest.fn(),
      offref: jest.fn(),
      getMarkdownFiles: jest.fn(() => []),
    },
    metadataCache: { on: jest.fn(), getFileCache: jest.fn(() => null) },
  };
  const sparql = new SPARQLApi({ app } as unknown as ExocortexPlugin);
  return {
    api: sparql,
    indexer: sparql.getRdfIndexer() as unknown as VaultRDFIndexer,
  };
}

describe("SPARQLApi — index state passthrough (RFC 9821a379 decision 7, ticket 058bad52)", () => {
  it("C1 @req:23f10730-82f7-4037-b566-da79d5fa3378 a full rebuild in flight in the indexer is reported by the API", () => {
    const { api: sparql, indexer } = api();
    expect(sparql.isIndexRefreshing()).toBe(false);
    jest.spyOn(indexer, "isRefreshing").mockReturnValue(true);
    expect(sparql.isIndexRefreshing()).toBe(true);
  });

  it("C2 @req:23f10730-82f7-4037-b566-da79d5fa3378 the API waits for the indexer's rebuild to settle", async () => {
    const { api: sparql, indexer } = api();
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    jest.spyOn(indexer, "whenRefreshSettled").mockReturnValue(settled);
    let done = false;
    void sparql.whenIndexRefreshSettled().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await settled;
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("C3 @req:23f10730-82f7-4037-b566-da79d5fa3378 the count of completed rebuilds is the indexer's", () => {
    const { api: sparql, indexer } = api();
    expect(sparql.getCompletedIndexRefreshCount()).toBe(0);
    jest.spyOn(indexer, "getCompletedRefreshCount").mockReturnValue(3);
    expect(sparql.getCompletedIndexRefreshCount()).toBe(3);
  });

  it("C4 @req:23f10730-82f7-4037-b566-da79d5fa3378 a file the indexer removed reaches the API's listener (RFC AC10)", async () => {
    const { api: sparql, indexer } = api();
    await indexer.getTripleStore().add(
      new Triple(
        new IRI("obsidian://vault/episodes/e1.md"),
        new IRI("https://exocortex.my/ontology/exo#Asset_label"),
        new Literal("E1"),
      ),
    );
    const listener = jest.fn();
    sparql.onIndexFileRemoved(listener);
    await indexer.removeFile({ path: "episodes/e1.md" } as TFile);
    expect(listener).toHaveBeenCalledWith("episodes/e1.md");
  });
});
