/**
 * QuarantineResolver OFFLINE read (PR-3a): with a device-local conflict cache
 * wired, listing and diffing a conflict needs ZERO network — the remote+base
 * versions come from the cache (captured at quarantine time), and the on-disk
 * LOCAL version is always re-read fresh. A transport that THROWS on every call
 * proves the offline path; revert-verify = WITHOUT the cache the same transport
 * throws (the legacy network listing).
 */

import { describe, expect, it } from "@jest/globals";
import {
  LocalConflictCacheStore,
  QuarantineResolver,
  gitBlobSha,
  type QuarantineEntry,
  type RestCommitTransport,
  type SyncRepoSpec,
  type WatermarkFileIO,
  type WatermarkRecord,
} from "../../../../src";
import {
  FakeLocalFiles,
  FakeWatermarkStore,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

const REPO_KEY = "o/r#main";
const PATH = "alpha.md";

function spec(): SyncRepoSpec {
  return {
    owner: "o",
    repo: "r",
    branch: "main",
    repoKey: REPO_KEY,
    localPath: "assetspaces/r",
  };
}

/** Transport that throws on ANY call — any network use fails the test. */
const offlineTransport: RestCommitTransport = async () => {
  throw new Error("OFFLINE: no network calls allowed");
};

function memIO(): WatermarkFileIO {
  let content: string | null = null;
  return {
    async read(): Promise<string | null> {
      return content;
    },
    async writeAtomic(c: string): Promise<void> {
      content = c;
    },
  };
}

async function cacheWith(
  entries: QuarantineEntry[],
): Promise<LocalConflictCacheStore> {
  const store = new LocalConflictCacheStore({ io: memIO() });
  await store.quarantineAll(entries);
  return store;
}

const BASE = mdAsset("u1", "base body");
const LOCAL = mdAsset("u1", "LOCAL edit");
const REMOTE = mdAsset("u1", "REMOTE edit");

async function watermarkPins(pins: string[]): Promise<FakeWatermarkStore> {
  const w = new FakeWatermarkStore();
  const record: WatermarkRecord = {
    lastSyncedSha: "base-sha",
    rootTreeSha: "base-tree",
    files: [
      { path: PATH, blobSha: await gitBlobSha(BASE, sha1Hex), uid: "u1" },
    ],
    pinnedPaths: pins,
  };
  await w.set(REPO_KEY, record);
  return w;
}

describe("QuarantineResolver — OFFLINE list/diff from the device-local cache", () => {
  it("lists a genuine 3-way conflict with ZERO network (cache supplies remote+base)", async () => {
    const cache = await cacheWith([
      {
        repoKey: REPO_KEY,
        path: PATH,
        uid: "u1",
        reason: "frontmatter conflict",
        baseContent: BASE,
        localContent: LOCAL,
        remoteContent: REMOTE,
      },
    ]);
    const disk = new FakeLocalFiles({ [PATH]: LOCAL });
    const resolver = new QuarantineResolver({
      transport: offlineTransport,
      watermarkStore: await watermarkPins([PATH]),
      localFilesFor: () => disk,
      sha1: sha1Hex,
      conflictCache: cache,
    });

    const conflicts = await resolver.listOpenConflicts([spec()]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      repoKey: REPO_KEY,
      path: PATH,
      uid: "u1",
      hasLocal: true,
      hasRemote: true,
    });
  });

  it("diffs a conflict offline — base/local/remote from cache, local re-read from disk", async () => {
    const cache = await cacheWith([
      {
        repoKey: REPO_KEY,
        path: PATH,
        reason: "x",
        baseContent: BASE,
        localContent: LOCAL,
        remoteContent: REMOTE,
      },
    ]);
    // Disk has a FRESHER local edit than the cache captured — must win.
    const freshLocal = mdAsset("u1", "LOCAL re-edited after quarantine");
    const disk = new FakeLocalFiles({ [PATH]: freshLocal });
    const resolver = new QuarantineResolver({
      transport: offlineTransport,
      watermarkStore: await watermarkPins([PATH]),
      localFilesFor: () => disk,
      sha1: sha1Hex,
      conflictCache: cache,
    });

    const detail = await resolver.loadConflict(spec(), PATH);
    expect(detail.base).toBe(BASE);
    expect(detail.remote).toBe(REMOTE);
    expect(detail.local).toBe(freshLocal); // fresh disk, not the cached snapshot
  });

  it("REVERT-VERIFY: without a cache the same offline transport aborts the listing", async () => {
    const disk = new FakeLocalFiles({ [PATH]: LOCAL });
    const resolver = new QuarantineResolver({
      transport: offlineTransport,
      watermarkStore: await watermarkPins([PATH]),
      localFilesFor: () => disk,
      sha1: sha1Hex,
      // no conflictCache → legacy network listing → throws offline
    });
    await expect(resolver.listOpenConflicts([spec()])).rejects.toThrow(
      /OFFLINE/,
    );
  });

  it("hybrid: an uncached pin is omitted offline (not aborted) — cached pins still list", async () => {
    const cache = await cacheWith([
      {
        repoKey: REPO_KEY,
        path: PATH,
        reason: "x",
        baseContent: BASE,
        localContent: LOCAL,
        remoteContent: REMOTE,
      },
    ]);
    const disk = new FakeLocalFiles({ [PATH]: LOCAL });
    const resolver = new QuarantineResolver({
      transport: offlineTransport,
      watermarkStore: await watermarkPins([PATH, "legacy-uncached.md"]),
      localFilesFor: () => disk,
      sha1: sha1Hex,
      conflictCache: cache,
    });

    // legacy-uncached.md needs the head tree (offline ⇒ throws) → omitted, not
    // aborting the whole list; the cached PATH still surfaces.
    const conflicts = await resolver.listOpenConflicts([spec()]);
    expect(conflicts.map((c) => c.path)).toEqual([PATH]);
  });

  it("filters a cached-but-converged pin (local == remote) offline", async () => {
    const same = mdAsset("u1", "both arrived here");
    const cache = await cacheWith([
      {
        repoKey: REPO_KEY,
        path: PATH,
        reason: "x",
        baseContent: BASE,
        localContent: same,
        remoteContent: same,
      },
    ]);
    const disk = new FakeLocalFiles({ [PATH]: same }); // disk == remote ⇒ converged
    const resolver = new QuarantineResolver({
      transport: offlineTransport,
      watermarkStore: await watermarkPins([PATH]),
      localFilesFor: () => disk,
      sha1: sha1Hex,
      conflictCache: cache,
    });
    expect(await resolver.listOpenConflicts([spec()])).toHaveLength(0);
  });
});
