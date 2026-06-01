import { PluginRdfIndexerAdapter } from "../../src/infrastructure/adapters/PluginRdfIndexerAdapter";

describe("PluginRdfIndexerAdapter", () => {
  it("throws when constructed without an indexer", () => {
    expect(
      () => new PluginRdfIndexerAdapter(undefined as any),
    ).toThrow(/indexer is required/);
  });

  it("delegates refresh(effectiveOntologies) to indexer.refresh(set)", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const indexer = { refresh } as any;
    const adapter = new PluginRdfIndexerAdapter(indexer);
    const set = new Set([
      "https://exocortex.my/ontology/exo",
      "https://exocortex.my/ontology/ems",
    ]);
    await adapter.refresh(set);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(set);
  });

  it("propagates errors from indexer.refresh", async () => {
    const indexer = {
      refresh: jest.fn().mockRejectedValue(new Error("boom")),
    } as any;
    const adapter = new PluginRdfIndexerAdapter(indexer);
    await expect(adapter.refresh(new Set())).rejects.toThrow(/boom/);
  });
});
