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
    expect(result).toEqual({ kind: "changes", added: [], modified: [], deleted: [] });
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
