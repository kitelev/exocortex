import { PluginRdfIndexerAdapter } from "../../src/infrastructure/adapters/PluginRdfIndexerAdapter";

describe("PluginRdfIndexerAdapter", () => {
  it("throws when constructed without an indexer", () => {
    expect(
      () => new PluginRdfIndexerAdapter(undefined as any),
    ).toThrow(/indexer is required/);
  });

  it("delegates refresh() to indexer.refresh()", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const indexer = { refresh } as any;
    const adapter = new PluginRdfIndexerAdapter(indexer);
    await adapter.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith();
  });

  it("propagates errors from indexer.refresh", async () => {
    const indexer = {
      refresh: jest.fn().mockRejectedValue(new Error("boom")),
    } as any;
    const adapter = new PluginRdfIndexerAdapter(indexer);
    await expect(adapter.refresh()).rejects.toThrow(/boom/);
  });

  it("fires onAfterRefresh hook after each successful refresh (H1 cascade)", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const onAfterRefresh = jest.fn().mockResolvedValue(undefined);
    const adapter = new PluginRdfIndexerAdapter(
      { refresh } as any,
      onAfterRefresh,
    );

    await adapter.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onAfterRefresh).toHaveBeenCalledTimes(1);

    await adapter.refresh();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onAfterRefresh).toHaveBeenCalledTimes(2);
  });

  it("hook fires AFTER indexer.refresh resolves (order matters for re-injection)", async () => {
    const callOrder: string[] = [];
    const refresh = jest.fn(async () => {
      callOrder.push("indexer.refresh");
    });
    const onAfterRefresh = jest.fn(async () => {
      callOrder.push("onAfterRefresh");
    });
    const adapter = new PluginRdfIndexerAdapter(
      { refresh } as any,
      onAfterRefresh,
    );

    await adapter.refresh();
    expect(callOrder).toEqual(["indexer.refresh", "onAfterRefresh"]);
  });

  it("hook failure is swallowed — must not break the switch pipeline", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const onAfterRefresh = jest
      .fn()
      .mockRejectedValue(new Error("hook regression"));
    const adapter = new PluginRdfIndexerAdapter(
      { refresh } as any,
      onAfterRefresh,
    );

    // Must not reject even though the hook rejected — the refresh
    // itself succeeded, and a hook regression must not invalidate
    // already-mutated state.
    await expect(adapter.refresh()).resolves.toBeUndefined();
    expect(onAfterRefresh).toHaveBeenCalledTimes(1);
  });

  it("hook is optional — adapter works without one (backwards compat)", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const adapter = new PluginRdfIndexerAdapter({ refresh } as any);
    await expect(adapter.refresh()).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
