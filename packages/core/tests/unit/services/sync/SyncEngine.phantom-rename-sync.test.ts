/**
 * ExoSync phantom-watermark re-derive loop — sync()-level convergence
 * (Issue #3835 corrected root cause + Issue #3886 downstream coverage).
 *
 * The live loop on `vault-exodev`/`exoas-shared-private` asset `617d340c`
 * (folder-anchor `$shared-private-assets/to-tbank`) is NOT an unrelated
 * cross-path delete (the shape PR #3885 guarded — `r.path !== local.basePath`).
 * It is a **uid-matched RENAME whose old (tmp) path was deleted on the remote
 * while the new path was edited on both sides with divergent content**:
 *
 *   base (watermark): asset uid at the dead `tmp-to-tbank` path
 *   local disk:       asset uid at `to-tbank`, WITH the correct trailing `#`
 *   remote head:      asset uid at `to-tbank`, WITHOUT the `#`, `tmp-to-tbank` gone
 *
 * `detectChanges` derives a local RENAME `tmp-to-tbank → to-tbank`
 * (`local.basePath === tmp-to-tbank`); `collectRemoteChanges` emits a remote
 * CHANGE at `to-tbank` (no-`#`) plus a remote DELETE of `tmp-to-tbank`. The
 * remote delete of the OLD path is the rename's OWN old-path delete — but the
 * convergent-rename branch consumed it ONLY when the remote carried *identical*
 * content at the new path (`blobSha === local.blobSha`). Here both sides moved
 * to `to-tbank` with DIFFERENT content (the `#` divergence) → the delete stayed
 * conflicting → `group.remotes.length === 2` → "ambiguous conflict: local change
 * overlaps 2 remote changes" → pinned to re-derive WITHOUT registering in
 * `quarantine list` → an unresolvable loop (deterministic across sessions).
 *
 * The #3885 method-level test used a PLAIN local edit (no `basePath`), so it
 * exercised a shape that never reproduces the live rename — which is exactly
 * why the shipped v16.184.1 guard missed. These tests drive the REAL
 * `SyncEngine.sync()` derivation (bootstrap → diverge via a real remote commit
 * + real local file ops → `detectChanges`/`collectRemoteChanges` produce the
 * rename+delete themselves), asserting the user-visible downstream: the loop
 * CONVERGES (keep-local push) after the fix, and stays a 2-remote ambiguous pin
 * before it.
 */

import { SyncEngine, type MergeLayerPort } from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";
import type { SyncEngineDeps, SyncRepoSpec } from "../../../../src";

/** Keep-local resolver: the divergence is cosmetic, local is authoritative. */
const keepLocalMerger: MergeLayerPort = {
  resolve: async (input) => ({
    action: "use-merged",
    content: input.local ?? "",
  }),
};

/** Quarantine-everything resolver: a 1-remote conflict registers (not merged). */
const quarantineAllMerger: MergeLayerPort = {
  resolve: async () => ({
    action: "quarantine",
    reason: "test: always quarantine",
  }),
};

function makeEngine(
  gh: FakeGitHubRepo,
  local: FakeLocalFiles,
  overrides: Partial<SyncEngineDeps> = {},
): { engine: SyncEngine; watermarks: FakeWatermarkStore } {
  const watermarks = new FakeWatermarkStore();
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    ...overrides,
  });
  return { engine, watermarks };
}

async function bootstrap(engine: SyncEngine, spec: SyncRepoSpec): Promise<void> {
  const result = await engine.sync(spec);
  expect(result.status).toBe("synced");
}

const UID = "617d340c-abc7-4cb3-824d-ef97b70e9943";
// Dead tmp/transient path — present only in the stale watermark base.
const PHANTOM = "shared-private-assets/tmp-to-tbank/617d340c.md";
// Live folder-anchor path — carries the correct trailing `#` locally.
const REAL = "shared-private-assets/to-tbank/617d340c.md";

// Same asset, divergent `exo__Ontology_url` bodies (the `#` is the divergence).
const BASE_AT_TMP = mdAsset(UID, "url: .../tmp-to-tbank");
const LOCAL_HASH = mdAsset(UID, "url: .../to-tbank#");
const REMOTE_NOHASH = mdAsset(UID, "url: .../to-tbank");

describe("SyncEngine.sync() — #3835 phantom-watermark rename-with-conflicting-edit converges (real derivation)", () => {
  it("converges keep-local (pushes the `#`) — NOT an ambiguous 2-remote re-derive pin", async () => {
    const gh = new FakeGitHubRepo({ [PHANTOM]: BASE_AT_TMP });
    const local = new FakeLocalFiles({ [PHANTOM]: BASE_AT_TMP });
    const { engine, watermarks } = makeEngine(gh, local, {
      mergeLayer: keepLocalMerger,
    });
    await bootstrap(engine, gh.spec());

    // Watermark base now carries the asset at the (soon-to-be-dead) tmp path —
    // the exact stale-base precondition, produced by a REAL sync, not injected.
    expect(
      watermarks.records.get(gh.spec().repoKey)!.files.map((f) => f.path),
    ).toEqual([PHANTOM]);

    // Remote (device B): rename tmp → to-tbank with the no-`#` content; drop tmp.
    gh.commitDirect(
      "main",
      { [REAL]: REMOTE_NOHASH },
      "device B: rename tmp→to-tbank (no #)",
      [PHANTOM],
    );
    // Local: rename tmp → to-tbank with the `#` content.
    local.files.delete(PHANTOM);
    local.files.set(REAL, LOCAL_HASH);

    const result = await engine.sync(gh.spec());

    // FIX: the tmp delete is the rename's OWN old-path delete AND the asset
    // exists at the new path on BOTH sides (same uid) → convergent, dropped →
    // the group collapses to the single new-path content conflict → keep-local
    // merge pushes the `#`. Reverting the fix leaves remotes.length === 2 →
    // "ambiguous conflict ... 2 remote changes" → nothing merged, `#` never
    // converges (the live #3835 loop).
    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).not.toMatch(/ambiguous conflict/);
    expect(result.quarantinedCount).toBe(0);
    expect(result.mergedPaths ?? []).toContain(REAL);
    // The `#` reached the remote HEAD — the correct local change converged.
    expect(gh.headFiles().get(REAL)).toBe(LOCAL_HASH);
    // The dead tmp path is gone on the remote (never resurrected).
    expect(gh.headFiles().has(PHANTOM)).toBe(false);

    // And it does NOT loop: the next sync is a clean no-op (watermark converged).
    const next = await engine.sync(gh.spec());
    expect(next.status).toBe("synced");
    expect(next.quarantinedCount).toBe(0);
    expect(next.pushedSha).toBeUndefined();
    expect(next.warnings).toEqual([]);
  });

  it("registers a single-remote quarantine (resolvable) when the merge layer declines — not the unregistered 2-remote pin", async () => {
    const gh = new FakeGitHubRepo({ [PHANTOM]: BASE_AT_TMP });
    const local = new FakeLocalFiles({ [PHANTOM]: BASE_AT_TMP });
    const { engine } = makeEngine(gh, local, {
      mergeLayer: quarantineAllMerger,
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect(
      "main",
      { [REAL]: REMOTE_NOHASH },
      "device B: rename tmp→to-tbank (no #)",
      [PHANTOM],
    );
    local.files.delete(PHANTOM);
    local.files.set(REAL, LOCAL_HASH);

    const result = await engine.sync(gh.spec());

    // With the fix the group is a NORMAL single-remote conflict → it registers
    // as one quarantine entry on the LIVE path (`exosync quarantine list` shows
    // it → `--take local` is applicable). Before the fix it was the
    // "ambiguous conflict ... 2 remote changes" pin instead.
    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).not.toMatch(/ambiguous conflict/);
    expect(result.quarantinedCount).toBe(1);
    expect(result.quarantinedPaths ?? []).toEqual([REAL]);
  });

  it("negative control: a GENUINE remote delete of the asset (no remote copy at the new path) keeps conflicting → NOT silently resurrected", async () => {
    const OLD = "assets/old.md";
    const NEW = "assets/new.md";
    const KEEP = "assets/keep.md"; // survives so the remote tree is never empty
    const BASE = mdAsset(UID, "base at old path");
    const gh = new FakeGitHubRepo({ [OLD]: BASE, [KEEP]: mdAsset("keep") });
    const local = new FakeLocalFiles({ [OLD]: BASE, [KEEP]: mdAsset("keep") });
    const { engine } = makeEngine(gh, local, {
      mergeLayer: quarantineAllMerger,
    });
    await bootstrap(engine, gh.spec());

    // Remote genuinely deletes the asset (both old AND new absent remotely).
    gh.commitDirect("main", {}, "device B: delete the asset entirely", [OLD]);
    // Local renames old → new (still wants the asset, just moved).
    local.files.delete(OLD);
    local.files.set(NEW, mdAsset(UID, "local rename"));

    const result = await engine.sync(gh.spec());

    // The remote carries NO change at NEW (it deleted the asset) →
    // `remoteAtNewPath` is undefined → the old-path delete stays conflicting
    // (unchanged by the fix, which only relaxes the SAME-uid-at-new-path case).
    // With a quarantining merge layer the rename is NOT pushed → no resurrection.
    expect(result.status).toBe("synced");
    expect(gh.headFiles().has(NEW)).toBe(false); // asset NOT resurrected
    expect(result.quarantinedCount).toBeGreaterThanOrEqual(1);
  });
});
