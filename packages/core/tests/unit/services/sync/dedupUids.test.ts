/**
 * dedupUids — the platform-free core shared by the CLI `runDedupUids` and the
 * in-plugin «Deduplicate uids» command (#3676). Covers the report grouping, the
 * keep-first / reassign-rest fix plan (frontmatter rewrite only — never rename),
 * determinism / idempotency, and the rewrite scoping.
 */

import {
  findDuplicateUidGroups,
  planDuplicateUidFix,
  rewriteAssetUid,
  type DedupUidFile,
} from "../../../../src/services/sync/dedupUids";

const fm = (uid: string, body = "body"): string =>
  `---\nexo__Asset_uid: ${uid}\n---\n\n${body}\n`;

describe("findDuplicateUidGroups", () => {
  it("returns only uids shared by >1 file, sorted by uid, paths in input order", () => {
    const files: DedupUidFile[] = [
      { path: "z.md", content: fm("dup-b") },
      { path: "a.md", content: fm("dup-a") },
      { path: "b.md", content: fm("dup-a") },
      { path: "c.md", content: fm("unique") },
      { path: "y.md", content: fm("dup-b") },
    ];
    expect(findDuplicateUidGroups(files)).toEqual([
      { uid: "dup-a", paths: ["a.md", "b.md"] },
      { uid: "dup-b", paths: ["z.md", "y.md"] }, // input order, not sorted
    ]);
  });

  it("ignores files with no frontmatter uid", () => {
    const files: DedupUidFile[] = [
      { path: "a.md", content: "no frontmatter here" },
      { path: "b.md", content: fm("solo") },
    ];
    expect(findDuplicateUidGroups(files)).toEqual([]);
  });

  it("returns an empty array when every uid is unique", () => {
    expect(
      findDuplicateUidGroups([
        { path: "a.md", content: fm("u1") },
        { path: "b.md", content: fm("u2") },
      ]),
    ).toEqual([]);
  });
});

describe("planDuplicateUidFix", () => {
  it("keeps the lexicographically-first path's uid and re-uuids the rest (never renames)", () => {
    let n = 0;
    const freshUid = (): string => `fresh-${++n}`;
    const files: DedupUidFile[] = [
      { path: "b.md", content: fm("shared") },
      { path: "a.md", content: fm("shared") },
      { path: "c.md", content: fm("shared") },
    ];
    const rewrites = planDuplicateUidFix(files, freshUid);
    // a.md (first sorted) is NOT rewritten; b.md + c.md get fresh uids.
    expect(rewrites.map((r) => r.path)).toEqual(["b.md", "c.md"]);
    expect(rewrites.every((r) => r.fromUid === "shared")).toBe(true);
    expect(rewrites.map((r) => r.toUid)).toEqual(["fresh-1", "fresh-2"]);
    // The rewrite is a frontmatter change only — the path (file name) is intact.
    expect(rewrites[0].content).toContain("exo__Asset_uid: fresh-1");
    expect(rewrites[0].content).not.toContain("exo__Asset_uid: shared");
  });

  it("is idempotent — a re-run over the fixed files plans nothing", () => {
    let n = 0;
    const freshUid = (): string => `fresh-${++n}`;
    const files: DedupUidFile[] = [
      { path: "a.md", content: fm("shared") },
      { path: "b.md", content: fm("shared") },
    ];
    const first = planDuplicateUidFix(files, freshUid);
    expect(first).toHaveLength(1);
    // Apply the plan, then re-plan — no duplicates remain.
    const fixed: DedupUidFile[] = files.map((f) => {
      const r = first.find((x) => x.path === f.path);
      return r ? { path: f.path, content: r.content } : f;
    });
    expect(planDuplicateUidFix(fixed, freshUid)).toEqual([]);
  });

  it("plans nothing when there are no duplicates", () => {
    expect(
      planDuplicateUidFix(
        [
          { path: "a.md", content: fm("u1") },
          { path: "b.md", content: fm("u2") },
        ],
        () => "fresh",
      ),
    ).toEqual([]);
  });
});

describe("rewriteAssetUid", () => {
  it("rewrites the frontmatter uid scalar only, leaving the body untouched", () => {
    const content = "---\nexo__Asset_uid: old\nexo__Asset_label: x\n---\n\nexo__Asset_uid: in-body\n";
    const out = rewriteAssetUid(content, "new");
    expect(out).toContain("exo__Asset_uid: new");
    expect(out).toContain("exo__Asset_label: x");
    // a `exo__Asset_uid:` token in the BODY is not re-stamped.
    expect(out).toContain("exo__Asset_uid: in-body");
  });

  it("returns the content unchanged when there is no frontmatter uid line", () => {
    const content = "---\nexo__Asset_label: x\n---\n\nbody\n";
    expect(rewriteAssetUid(content, "new")).toBe(content);
  });
});
