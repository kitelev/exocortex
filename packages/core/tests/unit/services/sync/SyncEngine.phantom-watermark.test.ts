/**
 * ExoSync phantom-watermark re-derive loop (Issue #3835).
 *
 * A stale watermark base-entry for a path that no longer exists on EITHER the
 * remote head OR the local disk (a dead `tmp-*` transient from an old move) is
 * derived as a phantom remote DELETE. Because it shares the asset's uid with the
 * real remote change, `matchLocalVsRemote` grouped BOTH under the local edit →
 * `group.remotes.length === 2` → the merge layer raised
 * "ambiguous conflict: local change overlaps 2 remote changes" and PINNED the
 * group to re-derive WITHOUT registering it in `quarantine list` — an
 * unresolvable loop (`exosync quarantine resolve` is a no-op; every sync
 * re-defers the same phantom). Empirically deterministic across sessions on
 * `vault-exodev`/`exoas-shared-private` asset `617d340c` (folder-anchor
 * `$shared-private-assets/to-tbank`), confirmed 2026-07-05 and 2026-07-12.
 *
 * The `matchLocalVsRemote` copy-vs-rename guard skipped cross-path evidence only
 * for `kind === "change"` — leaving a cross-path `kind === "delete"` of a
 * dead-everywhere path to inflate the conflict group. These tests exercise the
 * REAL `matchLocalVsRemote` with the exact (AssetChange, RemoteChange[]) inputs
 * the upstream derivation produces (types are real, not stubs), and lock the
 * fix (drop the phantom delete, collapse to the single real change).
 */

import { SyncEngine } from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  sha1Hex,
} from "./fakeGitHub";

function makeEngine(): SyncEngine {
  return new SyncEngine({
    transport: new FakeGitHubRepo().transport(),
    watermarkStore: new FakeWatermarkStore(),
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => new FakeLocalFiles(),
    sha1: sha1Hex,
  });
}

const UID = "617d340c-abc7-4cb3-824d-ef97b70e9943";
// Live asset path (folder-anchor, carries the correct trailing `#` locally).
const REAL = "shared-private-assets/to-tbank/617d340c.md";
// Dead tmp/transient path from an old move — present ONLY in the stale
// watermark base, absent on both the remote head and the local disk.
const PHANTOM = "shared-private-assets/tmp-to-tbank/617d340c.md";

/** Invoke the private conflict-grouping method with real inputs. */
function match(
  engine: SyncEngine,
  args: {
    localChanges: unknown[];
    remote: unknown[];
    disk: Map<string, string>;
    headTreeByPath: Map<string, string>;
    localDeletedPaths?: Set<string>;
  },
): { conflicts: Array<{ remotes: Array<{ path: string; kind: string }> }>; applyDeletes: Array<{ path: string }> } {
  return (engine as unknown as {
    matchLocalVsRemote: (
      localChanges: unknown[],
      localDeletedPaths: Set<string>,
      disk: ReadonlyMap<string, string>,
      remote: unknown[],
      convergedPushPaths: Set<string>,
      dupUids: ReadonlySet<string>,
      headTreeByPath: ReadonlyMap<string, string>,
    ) => {
      conflicts: Array<{ remotes: Array<{ path: string; kind: string }> }>;
      applyDeletes: Array<{ path: string }>;
    };
  }).matchLocalVsRemote(
    args.localChanges,
    args.localDeletedPaths ?? new Set(),
    args.disk,
    args.remote,
    new Set(),
    new Set(),
    args.headTreeByPath,
  );
}

describe("SyncEngine.matchLocalVsRemote — #3835 phantom-watermark cross-path delete", () => {
  it("drops a cross-path remote DELETE dead on both sides → group collapses to the single real change (converges, not an ambiguous 2-remote pin)", () => {
    const engine = makeEngine();
    const result = match(engine, {
      // Local `#` edit of the live asset (a plain edit — no rename, no basePath).
      localChanges: [{ path: REAL, uid: UID, blobSha: "local-hash-blob" }],
      remote: [
        // Real remote edit of the same live path (the no-`#` version).
        { path: REAL, kind: "change", uid: UID, blobSha: "remote-nohash-blob", content: "remote" },
        // Phantom: a stale watermark base-entry for the dead tmp path, derived as
        // a remote delete. Shares the uid → grouped alongside the real change.
        { path: PHANTOM, kind: "delete", uid: UID },
      ],
      // The live asset is on disk; the phantom path is NOT.
      disk: new Map([[REAL, "local"]]),
      // The remote head carries only the live path; the phantom path is gone.
      headTreeByPath: new Map([[REAL, "remote-nohash-blob"]]),
    });

    // FIX: the phantom delete is dropped → exactly one conflict group with ONE
    // remote (the real change). Reverting the guard leaves the phantom in →
    // remotes.length === 2 → the ambiguous-conflict re-derive loop.
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].remotes).toHaveLength(1);
    expect(result.conflicts[0].remotes[0].path).toBe(REAL);
    // The phantom is consumed everywhere — never re-applied as a delete either.
    expect(result.applyDeletes.map((r) => r.path)).not.toContain(PHANTOM);
  });

  it("negative control: a cross-path remote DELETE the local STILL holds on disk is a real delete-vs-keep conflict — NOT dropped", () => {
    const engine = makeEngine();
    const result = match(engine, {
      localChanges: [{ path: REAL, uid: UID, blobSha: "local-hash-blob" }],
      remote: [
        { path: REAL, kind: "change", uid: UID, blobSha: "remote-nohash-blob", content: "remote" },
        { path: PHANTOM, kind: "delete", uid: UID },
      ],
      // The "phantom" path IS on the local disk → a genuine delete-vs-keep, the
      // guard's `!disk.has(r.path)` clause must NOT drop it.
      disk: new Map([[REAL, "local"], [PHANTOM, "local-still-has-it"]]),
      headTreeByPath: new Map([[REAL, "remote-nohash-blob"]]),
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].remotes).toHaveLength(2);
  });

  it("negative control: a remote DELETE of the asset's OWN live path (r.path === local.path) is a real delete-vs-edit — NOT dropped", () => {
    const engine = makeEngine();
    const result = match(engine, {
      localChanges: [{ path: REAL, uid: UID, blobSha: "local-hash-blob" }],
      remote: [
        // Remote deleted the very path the local is editing → genuine conflict.
        { path: REAL, kind: "delete", uid: UID },
      ],
      disk: new Map([[REAL, "local"]]),
      // head no longer carries REAL (it was deleted remotely).
      headTreeByPath: new Map<string, string>(),
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].remotes).toHaveLength(1);
    expect(result.conflicts[0].remotes[0].kind).toBe("delete");
  });
});
