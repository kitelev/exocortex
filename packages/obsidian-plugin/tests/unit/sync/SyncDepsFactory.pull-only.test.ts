/**
 * req c0810b83 — the PLUGIN collector reads the same device-local pull-only
 * list (`.exocortex/exosync-pull-only`) through `vault.adapter` and marks the
 * listed sync units via the shared core helper, so the plugin's Sync / Pull /
 * Push commands get the engine's pull-only behaviour by construction (the
 * engine branch itself is covered by the core and CLI suites).
 */
import { collectSyncRepoSpecs } from "../../../src/infrastructure/adapters/SyncDepsFactory";
import type { App } from "obsidian";
import { InMemoryAdapter, assetSpaceFm, makeApp } from "./syncTestHelpers";

const LIST = ".exocortex/exosync-pull-only";

function appWith(listText: string | null): App {
  const adapter = new InMemoryAdapter();
  adapter.mkdirAll("assetspaces/o/r");
  adapter.mkdirAll("assetspaces/o/other");
  if (listText !== null) {
    adapter.mkdirAll(".exocortex");
    adapter.files.set(LIST, listText);
  }
  return makeApp({
    adapter,
    mdFiles: [{ path: "as1.md" }, { path: "as2.md" }],
    frontmatters: new Map([
      ["as1.md", assetSpaceFm("uid-1", "https://github.com/o/r")],
      ["as2.md", assetSpaceFm("uid-2", "https://github.com/o/other")],
    ]),
  }) as unknown as App;
}

describe("collectSyncRepoSpecs — pull-only list (req c0810b83)", () => {
  it("G1 @req:c0810b83-8554-403e-bff0-d341c7d90926 a listed repo is marked pullOnly, an unlisted one is not", async () => {
    const result = await collectSyncRepoSpecs(appWith("# bots\no/r\n"));
    const byKey = new Map(result.specs.map((s) => [s.repoKey, s]));
    expect(byKey.get("o/r#main")?.pullOnly).toBe(true);
    expect(byKey.get("o/other#main")).toBeDefined();
    expect(byKey.get("o/other#main")).not.toHaveProperty("pullOnly");
    expect(result.warnings).toEqual([]);
  });

  it("G2 @req:c0810b83-8554-403e-bff0-d341c7d90926 a malformed line rejects the collection, naming the line and its content", async () => {
    await expect(collectSyncRepoSpecs(appWith("o/r\nnot a repo\n"))).rejects.toThrow(
      'invalid pull-only list .exocortex/exosync-pull-only line 2: expected "owner/repo" (blank lines and # comments are ignored), got "not a repo"',
    );
  });

  it("G3 @req:c0810b83-8554-403e-bff0-d341c7d90926 without the list file no spec is marked", async () => {
    const result = await collectSyncRepoSpecs(appWith(null));
    expect(result.specs).toHaveLength(2);
    for (const spec of result.specs) expect(spec).not.toHaveProperty("pullOnly");
  });
});
