/**
 * ExoSync ChangeDetector unit tests (RFC 4e4dc453 A1 — D8/D18/D22, CQ2).
 */

import {
  detectChanges,
  extractAssetUid,
  gitBlobSha,
  type WatermarkRecord,
} from "../../../../src";
import { mdAsset, sha1Hex } from "./fakeGitHub";

async function watermarkFor(
  files: Record<string, string>,
  sha = "base-commit-sha",
  rootTreeSha = "base-tree-sha",
): Promise<WatermarkRecord> {
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    entries.push({
      path,
      blobSha: await gitBlobSha(content, sha1Hex),
      ...(extractAssetUid(content) ? { uid: extractAssetUid(content) } : {}),
    });
  }
  return { lastSyncedSha: sha, rootTreeSha, files: entries };
}

describe("extractAssetUid", () => {
  it("extracts a plain scalar uid from frontmatter", () => {
    expect(extractAssetUid(mdAsset("7097576a-148d-468f-98e9-ef8428829765"))).toBe(
      "7097576a-148d-468f-98e9-ef8428829765",
    );
  });

  it("extracts a quoted uid", () => {
    expect(
      extractAssetUid('---\nexo__Asset_uid: "abc-123"\n---\nbody'),
    ).toBe("abc-123");
  });

  it("returns undefined without frontmatter or without the key", () => {
    expect(extractAssetUid("# no frontmatter")).toBeUndefined();
    expect(extractAssetUid("---\nexo__Asset_label: x\n---\n")).toBeUndefined();
  });

  it("does not match the key outside the frontmatter block", () => {
    expect(
      extractAssetUid("---\nkey: v\n---\nexo__Asset_uid: not-frontmatter\n"),
    ).toBeUndefined();
  });
});

describe("gitBlobSha", () => {
  it("matches git's well-known empty-blob SHA", async () => {
    expect(await gitBlobSha("", sha1Hex)).toBe(
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    );
  });

  it("matches git hash-object for known content", async () => {
    // $ printf 'hello\n' | git hash-object --stdin
    expect(await gitBlobSha("hello\n", sha1Hex)).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });
});

describe("detectChanges — D22 base validation", () => {
  it("first-sync: null watermark → full-conflict", async () => {
    const result = await detectChanges({
      localFiles: new Map([["a.md", mdAsset("u1")]]),
      watermark: null,
      actualBaseTreeSha: "anything",
      sha1: sha1Hex,
    });
    expect(result).toEqual({ kind: "full-conflict", reason: "first-sync" });
  });

  it("unresolvable base commit (null actual tree) → base-mismatch", async () => {
    const wm = await watermarkFor({ "a.md": mdAsset("u1") });
    const result = await detectChanges({
      localFiles: new Map([["a.md", mdAsset("u1")]]),
      watermark: wm,
      actualBaseTreeSha: null,
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("full-conflict");
    if (result.kind === "full-conflict") {
      expect(result.reason).toBe("base-mismatch");
    }
  });

  it("stored root tree != actual root tree → base-mismatch (R10: corrupt watermark never trusted)", async () => {
    const wm = await watermarkFor({ "a.md": mdAsset("u1") });
    const result = await detectChanges({
      localFiles: new Map([["a.md", mdAsset("u1")]]),
      watermark: wm,
      actualBaseTreeSha: "some-other-tree",
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("full-conflict");
    if (result.kind === "full-conflict") {
      expect(result.reason).toBe("base-mismatch");
    }
  });
});

describe("detectChanges — uid-keyed diff (D18)", () => {
  const valid = (wm: WatermarkRecord): string => wm.rootTreeSha;

  it("unchanged tree → empty change sets", async () => {
    const files = { "a.md": mdAsset("u1"), "b.md": mdAsset("u2") };
    const wm = await watermarkFor(files);
    const result = await detectChanges({
      localFiles: new Map(Object.entries(files)),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result).toEqual(
      expect.objectContaining({
        kind: "changes",
        added: [],
        modified: [],
        deleted: [],
        warnings: [],
      }),
    );
  });

  it("content edit → modified, matched by uid", async () => {
    const wm = await watermarkFor({ "a.md": mdAsset("u1", "old") });
    const result = await detectChanges({
      localFiles: new Map([["a.md", mdAsset("u1", "NEW")]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0]).toMatchObject({ path: "a.md", uid: "u1" });
      expect(result.added).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
    }
  });

  it("rename: same uid at a new path → modified with basePath, NOT delete+add", async () => {
    const content = mdAsset("u1");
    const wm = await watermarkFor({ "old/a.md": content });
    const result = await detectChanges({
      localFiles: new Map([["new/b.md", content]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.modified).toEqual([
        expect.objectContaining({ path: "new/b.md", basePath: "old/a.md", uid: "u1" }),
      ]);
      expect(result.added).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
    }
  });

  it("new uid → added; uid gone from disk → deleted", async () => {
    const wm = await watermarkFor({ "a.md": mdAsset("u1") });
    const result = await detectChanges({
      localFiles: new Map([["b.md", mdAsset("u2")]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.added).toEqual([expect.objectContaining({ path: "b.md", uid: "u2" })]);
      expect(result.deleted).toEqual([
        expect.objectContaining({ path: "a.md", uid: "u1" }),
      ]);
    }
  });

  it("uid-less files match by path", async () => {
    const wm = await watermarkFor({ "notes.md": "# plain note v1\n" });
    const result = await detectChanges({
      localFiles: new Map([["notes.md", "# plain note v2\n"]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.modified).toEqual([
        expect.objectContaining({ path: "notes.md" }),
      ]);
    }
  });

  it("byte content is OPAQUE (Phase C, D18): no uid extraction even when the bytes contain frontmatter — path identity, out of uid merge-scope", async () => {
    // The same markdown asset passed as BYTES (a FileSpace snapshot) must
    // not gain uid identity — file-mode treats everything as opaque blobs,
    // which is also what keeps label-named pre-migration ABox (no uid)
    // outside the uid merge-scope (AC3).
    const text = mdAsset("u1", "old");
    const wm = await watermarkFor({ "a.md": text });
    const editedBytes = new TextEncoder().encode(mdAsset("u1", "NEW"));
    const result = await detectChanges({
      localFiles: new Map([["a.md", editedBytes]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.modified).toHaveLength(1);
      expect(result.modified[0].path).toBe("a.md");
      expect(result.modified[0].uid).toBeUndefined(); // opaque — no uid
    }
  });

  it("in-place uid edit (same path, different uid) → modified via path pass, not delete+add", async () => {
    const wm = await watermarkFor({ "a.md": mdAsset("u1") });
    const result = await detectChanges({
      localFiles: new Map([["a.md", mdAsset("u9")]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.modified).toEqual([
        expect.objectContaining({ path: "a.md", uid: "u9" }),
      ]);
      expect(result.added).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
    }
  });
});

describe("detectChanges — duplicate uid on disk (A1 review LOW)", () => {
  const valid = (wm: WatermarkRecord): string => wm.rootTreeSha;

  it("warns and matches the second file by path identity, not as a rename", async () => {
    const wm = await watermarkFor({ "a.md": mdAsset("u1") });
    const result = await detectChanges({
      localFiles: new Map([
        ["a.md", mdAsset("u1")],
        ["copy.md", mdAsset("u1")], // duplicated uid — vault anomaly
      ]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.warnings.join(" ")).toMatch(/duplicate uid u1/);
      // NOT a rename of a.md — the copy classifies as an added path.
      expect(result.modified).toEqual([]);
      expect(result.added).toEqual([
        expect.objectContaining({ path: "copy.md", uid: "u1" }),
      ]);
      expect(result.deleted).toEqual([]);
    }
  });
});

describe("detectChanges — duplicate uids use path identity for the WHOLE group (#3477)", () => {
  const valid = (wm: WatermarkRecord): string => wm.rootTreeSha;
  // duplicateUids is introduced by #3477 — structural access keeps the RED
  // commit typecheck-green while the field does not exist yet.
  const dupUidsOf = (result: unknown): ReadonlySet<string> | undefined =>
    (result as { duplicateUids?: ReadonlySet<string> }).duplicateUids;

  it("steady state (disk == base, 3 files sharing one uid) derives NO changes at all", async () => {
    const files = {
      "kitelev/2026-06-10 Note.md": mdAsset("u1", "note 10"),
      "kitelev/2026-06-11 Note.md": mdAsset("u1", "note 11"),
      "kitelev/2026-06-12 Note.md": mdAsset("u1", "note 12"),
    };
    const wm = await watermarkFor(files);
    const result = await detectChanges({
      localFiles: new Map(Object.entries(files)),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      // Today: the first disk file claims the (collapsed) base entry of a
      // DIFFERENT path → phantom rename; the other base entries are LOST →
      // phantom adds. Post-#3477: the whole group matches by path → no-op.
      expect(result.modified).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.warnings.join(" ")).toMatch(/duplicate uid u1/);
      expect(dupUidsOf(result)).toEqual(new Set(["u1"]));
    }
  });

  it("an edit inside the dup-uid group derives exactly ONE path-identity modify (no basePath)", async () => {
    const base = {
      "a.md": mdAsset("u1", "a"),
      "b.md": mdAsset("u1", "b"),
    };
    const wm = await watermarkFor(base);
    const result = await detectChanges({
      localFiles: new Map([
        ["a.md", mdAsset("u1", "a")],
        ["b.md", mdAsset("u1", "b EDITED")],
      ]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.modified).toEqual([
        expect.objectContaining({ path: "b.md", uid: "u1" }),
      ]);
      expect(result.modified[0].basePath).toBeUndefined();
      expect(result.added).toEqual([]);
      expect(result.deleted).toEqual([]);
    }
  });

  it("rename inference is suppressed for EVERY member of the dup-uid group", async () => {
    const base = {
      "a.md": mdAsset("u1", "a"),
      "b.md": mdAsset("u1", "b"),
    };
    const wm = await watermarkFor(base);
    const result = await detectChanges({
      localFiles: new Map(Object.entries(base)),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      for (const change of [...result.added, ...result.modified]) {
        expect(change.basePath).toBeUndefined();
      }
    }
  });

  it("deleting ONE member of the dup-uid group derives a DELETE for that path", async () => {
    const base = {
      "a.md": mdAsset("u1", "a"),
      "b.md": mdAsset("u1", "b"),
    };
    const wm = await watermarkFor(base);
    const result = await detectChanges({
      // b.md deleted locally — its base entry must NOT be lost to the
      // baseByUid collapse (today it is → no delete derives).
      localFiles: new Map([["a.md", mdAsset("u1", "a")]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.deleted).toEqual([
        expect.objectContaining({ path: "b.md" }),
      ]);
      expect(result.modified).toEqual([]);
      expect(result.added).toEqual([]);
    }
  });

  it("watermark-only dup (one file left on disk, two base entries) suppresses uid identity too", async () => {
    const wm = await watermarkFor({
      "a.md": mdAsset("u1", "a"),
      "b.md": mdAsset("u1", "b"),
    });
    const result = await detectChanges({
      // Disk has ONE file with u1 at a THIRD path: with unique-uid
      // semantics this would read as a rename of the collapsed base entry;
      // with base-side dup detected it must stay path identity.
      localFiles: new Map([["c.md", mdAsset("u1", "c")]]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.added).toEqual([
        expect.objectContaining({ path: "c.md", uid: "u1" }),
      ]);
      expect(result.deleted.map((d) => d.path).sort()).toEqual([
        "a.md",
        "b.md",
      ]);
      expect(result.modified).toEqual([]);
      expect(dupUidsOf(result)).toEqual(new Set(["u1"]));
    }
  });

  it("a genuine rename of a UNIQUE uid still classifies as modified+basePath alongside a dup group (#3476 intact)", async () => {
    const wm = await watermarkFor({
      "a.md": mdAsset("u1", "a"),
      "b.md": mdAsset("u1", "b"),
      "old.md": mdAsset("u2", "solo"),
    });
    const result = await detectChanges({
      localFiles: new Map([
        ["a.md", mdAsset("u1", "a")],
        ["b.md", mdAsset("u1", "b")],
        ["renamed.md", mdAsset("u2", "solo")],
      ]),
      watermark: wm,
      actualBaseTreeSha: valid(wm),
      sha1: sha1Hex,
    });
    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.modified).toEqual([
        expect.objectContaining({
          path: "renamed.md",
          uid: "u2",
          basePath: "old.md",
        }),
      ]);
      expect(result.added).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(dupUidsOf(result)).toEqual(new Set(["u1"]));
    }
  });
});
