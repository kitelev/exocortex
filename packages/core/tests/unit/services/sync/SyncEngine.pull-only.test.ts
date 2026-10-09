/**
 * req c0810b83 — pull-only repos at the ENGINE entry point (`SyncEngine.sync`)
 * over the production-shape {@link FakeGitHubRepo}. The CLI suite
 * (`packages/cli/tests/unit/commands/exosync-sync.pull-only.test.ts`) drives
 * the list file → command → engine path; these axes pin the engine-side
 * guarantees a command test cannot see:
 *
 *  - a `push` over a pull-only spec makes ZERO requests;
 *  - pins / quarantine records of an earlier two-way life are closed, and an
 *    offline resolution queued in the outbox is DROPPED — never pushed;
 *  - file-mode (binary) pull-only repos mirror byte-exact.
 */

import { describe, expect, it } from "@jest/globals";
import {
  LocalConflictCacheStore,
  LocalOutboxStore,
  QuarantineResolver,
  SyncEngine,
  type MergeLayerPort,
  type RestCommitTransport,
  type SyncRepoSpec,
  type WatermarkFileIO,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

const REQ = "c0810b83-8554-403e-bff0-d341c7d90926";

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

const FILE = "assets/a.md";
const BASE = mdAsset("u1", "base body");
const LOCAL = mdAsset("u1", "LOCAL edit");
const REMOTE = mdAsset("u1", "REMOTE edit");

const forceQuarantine: MergeLayerPort = {
  resolve: async () => ({ action: "quarantine", reason: "unmergeable (test)" }),
};

function setup() {
  const gh = new FakeGitHubRepo({ [FILE]: BASE });
  const requests: string[] = [];
  const inner = gh.transport();
  const transport: RestCommitTransport = async (req) => {
    requests.push(`${req.method} ${req.url}`);
    return inner(req);
  };
  const cache = new LocalConflictCacheStore({ io: memIO() });
  const outbox = new LocalOutboxStore({ io: memIO() });
  const watermarks = new FakeWatermarkStore();
  const disk = new FakeLocalFiles({ [FILE]: BASE });
  const engine = new SyncEngine({
    transport,
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => disk,
    sha1: sha1Hex,
    quarantine: cache,
    outbox,
    mergeLayer: forceQuarantine,
  });
  const resolver = new QuarantineResolver({
    transport: gh.transport(),
    watermarkStore: watermarks,
    localFilesFor: () => disk,
    sha1: sha1Hex,
    conflictCache: cache,
    outbox,
  });
  const spec = gh.spec();
  const pullOnly: SyncRepoSpec = { ...spec, pullOnly: true };
  return { gh, requests, cache, outbox, watermarks, disk, engine, resolver, spec, pullOnly };
}

/** Two-way life: bootstrap, then a genuine quarantined + pinned conflict. */
async function quarantinedConflict(s: ReturnType<typeof setup>): Promise<void> {
  await s.engine.sync(s.spec);
  s.gh.commitDirect("main", { [FILE]: REMOTE }, "device B");
  s.disk.files.set(FILE, LOCAL);
  const r = await s.engine.sync(s.spec);
  expect(r.quarantinedCount).toBe(1);
  expect(s.watermarks.records.get(s.spec.repoKey)?.pinnedPaths).toContain(FILE);
}

describe(`SyncEngine pull-only repos (req ${REQ})`, () => {
  it(`E1 @req:c0810b83-8554-403e-bff0-d341c7d90926 push over a pull-only spec makes zero requests and reports skipped-pull-only`, async () => {
    const s = setup();
    s.disk.files.set(FILE, LOCAL);
    const r = await s.engine.sync(s.pullOnly, "push");
    expect(s.requests).toEqual([]);
    expect(r.status).toBe("skipped-pull-only");
    expect(r.pullOnly).toBe(true);
    expect(r.pushedCount).toBe(0);
    expect(s.gh.headFiles().get(FILE)).toBe(BASE);
  });

  it(`E2 @req:c0810b83-8554-403e-bff0-d341c7d90926 a mirror closes the pins and quarantine records of an earlier two-way life`, async () => {
    const s = setup();
    await quarantinedConflict(s);
    expect((await s.cache.list()).map((e) => e.path)).toEqual([FILE]);
    const r = await s.engine.sync(s.pullOnly, "pull");
    expect(r.status).toBe("synced");
    expect(r.mirrored).toEqual({ restored: [FILE], added: [], removed: [] });
    expect(s.disk.files.get(FILE)).toBe(REMOTE);
    const wm = s.watermarks.records.get(s.spec.repoKey);
    expect(wm?.lastSyncedSha).toBe(s.gh.headSha());
    expect(wm?.pinnedPaths ?? []).toEqual([]);
    expect(await s.cache.list()).toEqual([]);
  });

  it(`E3 @req:c0810b83-8554-403e-bff0-d341c7d90926 a queued offline resolution is dropped by a pull-only sync, never pushed`, async () => {
    const s = setup();
    await quarantinedConflict(s);
    const resolved = await s.resolver.resolve(s.spec, FILE, { take: "local" });
    expect(resolved.awaitingPush).toBe(true);
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(1);
    const head = s.gh.headSha();
    s.requests.length = 0;
    const r = await s.engine.sync(s.pullOnly, "sync");
    expect(r.status).toBe("synced");
    expect(s.requests.filter((x) => !x.startsWith("GET "))).toEqual([]);
    expect(s.gh.headSha()).toBe(head);
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toEqual([]);
    expect(s.disk.files.get(FILE)).toBe(REMOTE);
    expect(r.warnings).toContain(
      "pull-only repo: dropped 1 queued conflict resolution(s) — a pull-only repo is never pushed",
    );
  });

  it(`E4 @req:c0810b83-8554-403e-bff0-d341c7d90926 a file-mode pull-only repo mirrors binaries byte-exact`, async () => {
    const remoteBin = new Uint8Array([0, 255, 1, 254, 2, 253]);
    const gh = new FakeGitHubRepo({ "img/a.bin": remoteBin });
    const disk = new FakeLocalFiles({
      "img/a.bin": new Uint8Array([9, 9, 9]),
      "img/extra.bin": new Uint8Array([7]),
    });
    const watermarks = new FakeWatermarkStore();
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: watermarks,
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => disk,
      sha1: sha1Hex,
    });
    const spec: SyncRepoSpec = { ...gh.spec("file"), pullOnly: true };
    const r = await engine.sync(spec, "pull");
    expect(r.status).toBe("synced");
    expect(Buffer.from(disk.files.get("img/a.bin") as Uint8Array)).toEqual(
      Buffer.from(remoteBin),
    );
    expect(disk.files.has("img/extra.bin")).toBe(false);
    expect(r.mirrored).toEqual({
      restored: ["img/a.bin"],
      added: [],
      removed: ["img/extra.bin"],
    });
    expect(watermarks.records.get(spec.repoKey)?.spaceKind).toBe("file");
  });

  it(`E5 @req:c0810b83-8554-403e-bff0-d341c7d90926 an unsafe remote path is never written by the mirror (warned instead)`, async () => {
    const gh = new FakeGitHubRepo({ [FILE]: BASE, "../evil.md": mdAsset("u-evil") });
    const disk = new FakeLocalFiles({ [FILE]: BASE });
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => disk,
      sha1: sha1Hex,
    });
    const r = await engine.sync({ ...gh.spec(), pullOnly: true }, "pull");
    expect(r.status).toBe("synced");
    expect(disk.files.has("../evil.md")).toBe(false);
    expect(r.warnings).toContain(
      "unsafe remote path skipped by the pull-only mirror: ../evil.md",
    );
  });

  it(`E6 @req:c0810b83-8554-403e-bff0-d341c7d90926 a file-mode remote blob above the size cap is not fetched or written; the local copy is left as is (named limit)`, async () => {
    const gh = new FakeGitHubRepo({
      "img/big.bin": new Uint8Array([1, 2, 3, 4, 5, 6]),
      "img/small.bin": new Uint8Array([1]),
    });
    const disk = new FakeLocalFiles({
      "img/big.bin": new Uint8Array([9, 9]),
      "img/small.bin": new Uint8Array([8]),
    });
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => disk,
      sha1: sha1Hex,
      maxFileBytes: 4,
    });
    const r = await engine.sync({ ...gh.spec("file"), pullOnly: true }, "pull");
    expect(r.status).toBe("synced");
    expect(Array.from(disk.files.get("img/big.bin") as Uint8Array)).toEqual([9, 9]);
    expect(Array.from(disk.files.get("img/small.bin") as Uint8Array)).toEqual([1]);
    expect(r.mirrored).toEqual({ restored: ["img/small.bin"], added: [], removed: [] });
    expect(r.warnings.some((w) => w.startsWith("pull-only mirror skipped oversized remote file img/big.bin (6 bytes > 4 cap)"))).toBe(true);
  });

  // Review N1 of PR #4544: Obsidian's adapter lists a POSIX name `x\..\..\evil.md`
  // as `x/../../evil.md` and its `remove` resolves the `..` — the traversal guard
  // is what keeps the mirror from deleting outside the vault.
  it(`E7 @req:c0810b83-8554-403e-bff0-d341c7d90926 a listed local path with .. segments is never deleted by the mirror (warned instead)`, async () => {
    const gh = new FakeGitHubRepo({ [FILE]: BASE });
    const disk = new FakeLocalFiles({ [FILE]: BASE, "agent/../../evil.md": "outside" });
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => disk,
      sha1: sha1Hex,
    });
    const r = await engine.sync({ ...gh.spec(), pullOnly: true }, "pull");
    expect(r.status).toBe("synced");
    expect(disk.files.get("agent/../../evil.md")).toBe("outside");
    expect(r.mirrored?.removed).toEqual([]);
    expect(r.warnings).toContain(
      "unsafe local path left untouched by the pull-only mirror: agent/../../evil.md",
    );
  });

  // Review N2 of PR #4544: the plugin port lists NFC while a remote path may be
  // NFD; on APFS both name ONE file. The mirror must neither re-add it every run
  // nor delete the NFC-listed copy as an extra.
  // и + combining breve, built from code points so no editor can pre-normalise it
  const NFD = `notes/${String.fromCharCode(0x438, 0x306)}.md`;
  const NFC_NAME = NFD.normalize("NFC"); // й
  function nfcSetup() {
    const gh = new FakeGitHubRepo({ [NFD]: BASE });
    const disk = new FakeLocalFiles({ [NFC_NAME]: BASE });
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => disk,
      sha1: sha1Hex,
    });
    return { gh, disk, engine };
  }

  it(`E8 @req:c0810b83-8554-403e-bff0-d341c7d90926 an NFD remote path whose NFC-listed local copy is identical is not re-written`, async () => {
    const s = nfcSetup();
    expect(NFD).not.toBe(NFC_NAME);
    const r = await s.engine.sync({ ...s.gh.spec(), pullOnly: true }, "pull");
    expect(r.status).toBe("synced");
    expect(r.mirrored?.added).toEqual([]);
    expect(r.mirrored?.restored).toEqual([]);
    expect(s.disk.files.has(NFD)).toBe(false);
  });

  it(`E9 @req:c0810b83-8554-403e-bff0-d341c7d90926 the NFC-listed copy of an NFD remote path is not deleted as an extra`, async () => {
    const s = nfcSetup();
    const r = await s.engine.sync({ ...s.gh.spec(), pullOnly: true }, "pull");
    expect(r.mirrored?.removed).toEqual([]);
    expect(s.disk.files.get(NFC_NAME)).toBe(BASE);
  });
});
