/**
 * ExoSync Phase C — file-mode (exo__FileSpace) engine tests
 * (RFC 4e4dc453 D18/VL#11, onto-RFC 18808c73).
 *
 * AC2: attachments sync as plain git content (no LFS); a concurrent PNG
 * edit resolves remote-wins with the losing LOCAL bytes preserved in
 * quarantine (`.conflict.png` payload — nothing is lost).
 * AC4: a path-based `![[image.png]]` ref survives sync byte-identical.
 *
 * The GitHub side is the production-shape `FakeGitHubRepo` (REAL git blob
 * SHAs over raw bytes, base64 blob routes, sha-form tree entries).
 */

import {
  SyncEngine,
  contentEquals,
  type QuarantineEntry,
  type QuarantinePort,
  type SyncEngineDeps,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeTextOnlyLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

/** Capturing QuarantinePort — records entries, supports markResolved. */
class CapturingQuarantine implements QuarantinePort {
  readonly entries: QuarantineEntry[] = [];
  readonly resolved: Array<{ repoKey: string; path: string }> = [];
  async quarantine(entry: QuarantineEntry): Promise<void> {
    this.entries.push(entry);
  }
  async quarantineAll(entries: QuarantineEntry[]): Promise<void> {
    this.entries.push(...entries);
  }
  async markResolved(repoKey: string, path: string): Promise<void> {
    this.resolved.push({ repoKey, path });
  }
}

function makeEngine(
  gh: FakeGitHubRepo,
  local: FakeLocalFiles | FakeTextOnlyLocalFiles,
  overrides: Partial<SyncEngineDeps> = {},
): {
  engine: SyncEngine;
  watermarks: FakeWatermarkStore;
  quarantine: CapturingQuarantine;
} {
  const watermarks = new FakeWatermarkStore();
  const quarantine = new CapturingQuarantine();
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    quarantine,
    ...overrides,
  });
  return { engine, watermarks, quarantine };
}

const PNG_V1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const PNG_V2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]);
const PNG_V3 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x03]);
const IMG = "attachments/image.png";
const NOTE = "notes/photo-note.md";
const NOTE_BODY = "Look at this:\n\n![[image.png]]\n";

describe("SyncEngine file-mode — first sync (advisor C1: no dead-end)", () => {
  it("pulls everything into an EMPTY local folder (fresh mount)", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1, [NOTE]: NOTE_BODY });
    const local = new FakeLocalFiles({});
    const { engine, watermarks } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(result.pulledCount).toBe(2);
    expect(local.files.get(IMG)).toEqual(PNG_V1); // byte-exact
    expect(watermarks.records.get(gh.spec().repoKey)!.spaceKind).toBe("file");
  });

  it("resolves a divergent first-sync remote-wins with the local copy quarantined", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V2 }); // diverged before first sync
    const { engine, quarantine } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(local.files.get(IMG)).toEqual(PNG_V1); // remote wins on disk
    expect(quarantine.entries).toHaveLength(1);
    expect(quarantine.entries[0].localContentBytes).toEqual(PNG_V2); // loser preserved
  });

  it("pushes local-only files on first sync (zero-loss over resurrection)", async () => {
    const gh = new FakeGitHubRepo({ [NOTE]: NOTE_BODY });
    const local = new FakeLocalFiles({ [NOTE]: NOTE_BODY, [IMG]: PNG_V1 });
    const { engine } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(gh.headBlob(IMG)).toEqual(Buffer.from(PNG_V1)); // byte-exact on remote
  });
});

describe("SyncEngine file-mode — attachments as plain git content (AC2, VL#11)", () => {
  it("pushes a new local PNG byte-exact (no LFS, blob+sha tree route)", async () => {
    const gh = new FakeGitHubRepo({ [NOTE]: NOTE_BODY });
    const local = new FakeLocalFiles({ [NOTE]: NOTE_BODY });
    const { engine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file")); // bootstrap

    local.files.set(IMG, PNG_V1);
    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(gh.headBlob(IMG)).toEqual(Buffer.from(PNG_V1));
  });

  it("pulls a remote PNG edit byte-exact", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file")); // bootstrap

    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B edits the png");
    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(result.pulledCount).toBe(1);
    expect(local.files.get(IMG)).toEqual(PNG_V2);
  });

  it("CONCURRENT png edit → remote-wins + losing local bytes in quarantine, NOT pinned", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine, watermarks, quarantine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file")); // bootstrap

    // Both sides edit the same attachment.
    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B");
    local.files.set(IMG, PNG_V3);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    // Remote wins on disk; the losing LOCAL bytes are preserved (AC2).
    expect(local.files.get(IMG)).toEqual(PNG_V2);
    expect(result.quarantinedCount).toBe(1);
    expect(quarantine.entries).toHaveLength(1);
    expect(quarantine.entries[0]).toMatchObject({ path: IMG });
    expect(quarantine.entries[0].localContentBytes).toEqual(PNG_V3);
    expect(quarantine.entries[0].reason).toMatch(/remote-wins/);

    // Advisor C2: a RESOLVED conflict must NOT be pinned — pinning would
    // re-derive it and auto-markResolved the entry on the next sync.
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.pinnedPaths ?? []).toEqual([]);

    // Convergence: the next sync is a clean no-op (no ping-pong).
    const second = await engine.sync(gh.spec("file"));
    expect(second.status).toBe("synced");
    expect(second.pushedCount).toBe(0);
    expect(second.quarantinedCount).toBe(0);
    expect(quarantine.resolved).toEqual([]); // nothing auto-closed
  });

  it("remote delete vs local edit → deleted locally, local bytes quarantined", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine, quarantine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file"));

    gh.commitDirect("main", {}, "device B deletes the png", [IMG]);
    local.files.set(IMG, PNG_V3);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(local.files.has(IMG)).toBe(false); // remote delete wins
    expect(quarantine.entries).toHaveLength(1);
    expect(quarantine.entries[0].localContentBytes).toEqual(PNG_V3);
  });

  it("local delete vs remote edit → remote restored, nothing quarantined", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine, quarantine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file"));

    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B edits");
    local.files.delete(IMG);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(local.files.get(IMG)).toEqual(PNG_V2); // restored
    expect(quarantine.entries).toEqual([]); // local side had nothing to lose
  });
});

describe("SyncEngine file-mode — path-based refs survive sync (AC4)", () => {
  it("a note with ![[image.png]] and its target both survive a remote-edit cycle byte-identical", async () => {
    const gh = new FakeGitHubRepo({ [NOTE]: NOTE_BODY, [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [NOTE]: NOTE_BODY, [IMG]: PNG_V1 });
    const { engine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file")); // bootstrap

    // Device B re-encodes the image; the note is untouched.
    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B re-encodes");
    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    // The embed target still exists under the SAME repo-relative path and
    // the note's `![[image.png]]` markup is byte-identical — the
    // basename-resolved path ref cannot break (render-by-test, AC4).
    expect(local.files.get(IMG)).toEqual(PNG_V2);
    const note = local.files.get(NOTE);
    expect(typeof note).toBe("string");
    expect(note).toBe(NOTE_BODY);
    expect(note as string).toContain("![[image.png]]");
  });
});

describe("SyncEngine file-mode — guards", () => {
  it("refuses LOUDLY to sync a file-mode repo through a text-only port", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeTextOnlyLocalFiles({});
    const { engine } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("error");
    expect(result.detail).toMatch(/readBinary\/writeBinary/);
  });

  it("refuses LOUDLY to sync a file-mode repo without a quarantine sink (reviewer CRITICAL, AC2)", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V2 });
    const { engine } = makeEngine(gh, local, { quarantine: undefined });

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("error");
    expect(result.detail).toMatch(/quarantine sink/);
    expect(local.files.get(IMG)).toEqual(PNG_V2); // disk untouched
  });

  it("withholds the destructive remote-wins apply when the quarantine flush FAILS (reviewer CRITICAL, AC2)", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine, watermarks, quarantine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file")); // bootstrap

    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B");
    local.files.set(IMG, PNG_V3);
    quarantine.quarantineAll = async () => {
      throw new Error("quarantine repo unreachable");
    };

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    // The losing local bytes were NOT durably preserved → the remote
    // version must NOT land on disk; the path pins and re-derives.
    expect(local.files.get(IMG)).toEqual(PNG_V3);
    expect(result.warnings.join(" ")).toMatch(/remote-wins apply withheld/);
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.pinnedPaths).toContain(IMG);

    // Sink recovers → next sync resolves remote-wins normally.
    quarantine.quarantineAll = async (entries) => {
      quarantine.entries.push(...entries);
    };
    const second = await engine.sync(gh.spec("file"));
    expect(second.status).toBe("synced");
    expect(local.files.get(IMG)).toEqual(PNG_V2);
    expect(quarantine.entries.some((e) => e.path === IMG)).toBe(true);
    // Advisor round-2 must-fix: the pin that cleared THIS cycle belongs to
    // the entry created THIS cycle — auto-markResolved would tombstone the
    // record before the user ever saw it (CQ4).
    expect(quarantine.resolved).toEqual([]);
  });

  it("kind flip file→asset: refuses LOUDLY instead of inferring phantom deletes", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1, [NOTE]: NOTE_BODY });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1, [NOTE]: NOTE_BODY });
    const { engine } = makeEngine(gh, local);
    await engine.sync(gh.spec("file")); // file-mode watermark written

    const result = await engine.sync(gh.spec()); // now resolves to asset

    expect(result.status).toBe("error");
    expect(result.detail).toMatch(/FILE-mode sync/);
    expect(local.files.get(IMG)).toEqual(PNG_V1); // nothing touched
  });

  it("kind flip asset→file: rebuilds through the first-sync layer (no ADD-push over remote)", async () => {
    const gh = new FakeGitHubRepo({ [NOTE]: NOTE_BODY });
    const local = new FakeLocalFiles({ [NOTE]: NOTE_BODY });
    const { engine, quarantine } = makeEngine(gh, local);
    await engine.sync(gh.spec()); // asset-mode watermark (md-only)

    // Device B updates a binary the asset-mode base never saw; the local
    // copy diverges too — a naive ADD-push would overwrite device B.
    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B adds binary");
    local.files.set(IMG, PNG_V3);

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(/kind flip/);
    // Divergence went through remote-wins, not a blind push.
    expect(local.files.get(IMG)).toEqual(PNG_V2);
    expect(gh.headBlob(IMG)).toEqual(Buffer.from(PNG_V2));
    expect(
      quarantine.entries.some(
        (e) => e.path === IMG && contentEquals(e.localContentBytes, PNG_V3),
      ),
    ).toBe(true);
  });

  it("file shrinking back under the cap derives as a CONFLICT, not a silent ADD-push (advisor round-2)", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine, quarantine } = makeEngine(gh, local, { maxFileBytes: 16 });
    await engine.sync(gh.spec("file")); // bootstrap

    // Local grows over the cap (drops out of scope) while device B edits.
    local.files.set(IMG, new Uint8Array(64).fill(0xee));
    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B");
    await engine.sync(gh.spec("file")); // excluded cycle (pinned)

    // The local file shrinks back under the cap, still diverging from the
    // remote — this must resolve remote-wins, NOT push over device B.
    local.files.set(IMG, PNG_V3);
    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(gh.headBlob(IMG)).toEqual(Buffer.from(PNG_V2)); // remote intact
    expect(local.files.get(IMG)).toEqual(PNG_V2); // remote wins on disk
    expect(
      quarantine.entries.some(
        (e) => e.path === IMG && contentEquals(e.localContentBytes, PNG_V3),
      ),
    ).toBe(true); // losing local bytes preserved
  });

  it("oversized REMOTE blob is excluded symmetrically — local copy is NOT phantom-deleted (reviewer HIGH)", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine } = makeEngine(gh, local, { maxFileBytes: 16 });
    await engine.sync(gh.spec("file")); // bootstrap (PNG_V1 is 9 bytes)

    // Device B (out-of-band) pushes a version OVER the cap.
    gh.commitDirect(
      "main",
      { [IMG]: new Uint8Array(64).fill(0xcd) },
      "oversized re-encode",
    );
    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    // The local ≤cap copy must survive — dropping the oversized entry from
    // the head tree alone would have read as a remote DELETE.
    expect(local.files.get(IMG)).toEqual(PNG_V1);
    expect(result.warnings.join(" ")).toMatch(/oversized REMOTE file/);
  });

  it("local file growing over the cap does NOT read as a local delete nor get silently overwritten (reviewer HIGH)", async () => {
    const gh = new FakeGitHubRepo({ [IMG]: PNG_V1 });
    const local = new FakeLocalFiles({ [IMG]: PNG_V1 });
    const { engine, quarantine } = makeEngine(gh, local, { maxFileBytes: 16 });
    await engine.sync(gh.spec("file")); // bootstrap

    // The local file grows over the cap; device B edits the same path.
    const oversizedLocal = new Uint8Array(64).fill(0xee);
    local.files.set(IMG, oversizedLocal);
    gh.commitDirect("main", { [IMG]: PNG_V2 }, "device B");

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    // The oversized local file is fully out of sync scope: not deleted,
    // not overwritten by the remote edit, nothing quarantined for it.
    expect(local.files.get(IMG)).toEqual(oversizedLocal);
    expect(result.deferredDeletes).toEqual([]);
    expect(quarantine.entries).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/oversized file/);
  });

  it("skips oversized local files symmetrically with a warning (size cap)", async () => {
    const big = new Uint8Array(64).fill(0xab);
    const gh = new FakeGitHubRepo({ [NOTE]: NOTE_BODY });
    const local = new FakeLocalFiles({ [NOTE]: NOTE_BODY, [IMG]: big });
    const { engine } = makeEngine(gh, local, { maxFileBytes: 16 });

    const result = await engine.sync(gh.spec("file"));

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(/oversized file/);
    expect(gh.headBlob(IMG)).toBeUndefined(); // never pushed
  });

  it("asset-mode specs still ignore binary entirely (regression — semantics untouched)", async () => {
    const gh = new FakeGitHubRepo({ "assets/a.md": mdAsset("u1") });
    const local = new FakeLocalFiles({
      "assets/a.md": mdAsset("u1"),
      [IMG]: PNG_V1, // present on disk, NOT allowlisted in asset mode
    });
    const { engine, watermarks } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec()); // no spaceKind → asset

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0);
    expect(gh.headBlob(IMG)).toBeUndefined();
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.spaceKind).toBeUndefined();
    expect(record.files.map((f) => f.path)).toEqual(["assets/a.md"]);
  });

  it("md files inside a FileSpace are opaque too — no uid identity in the watermark", async () => {
    const gh = new FakeGitHubRepo({ [NOTE]: mdAsset("u9") });
    const local = new FakeLocalFiles({ [NOTE]: mdAsset("u9") });
    const { engine, watermarks } = makeEngine(gh, local);

    await engine.sync(gh.spec("file"));

    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.files).toEqual([
      { path: NOTE, blobSha: expect.any(String) },
    ]);
  });
});
