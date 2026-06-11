/**
 * ExoSync E1 — platform-free space-declaration classification core.
 *
 * These tests pin the behavioural quirks ported verbatim from the plugin's
 * `collectSyncRepoSpecs` (PR #3461 lineage) so the plugin and the CLI
 * collector can never drift: dual-read source, `.git` normalisation,
 * disjoint-class resolution, deterministic dedupe, strict URL allowlist.
 */

import {
  ASSET_SPACE_CLASS_UID,
  SYNC_BRANCH,
  SpaceSpecAccumulator,
  classifySpaceDeclaration,
  isAssetSpaceFrontmatter,
  isFileSpaceFrontmatter,
  parseStrictGitHubRepoURL,
  readSpaceSource,
  type SpaceSpecCandidate,
} from "../../../../src/services/sync/spaceSpecCore";
import { FILE_SPACE_CLASS_UID } from "../../../../src/services/FileSpaceDiscovery";

function assetFm(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}]]`],
    exo__AssetSpace_source: "https://github.com/kitelev/exoas-test",
    ...extra,
  };
}

describe("predicates", () => {
  it("matches AssetSpace class via strict wikilink (string and array shapes)", () => {
    expect(
      isAssetSpaceFrontmatter({
        exo__Instance_class: `[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`,
      }),
    ).toBe(true);
    expect(
      isAssetSpaceFrontmatter({
        exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}]]`],
      }),
    ).toBe(true);
  });

  it("rejects substring UUID noise outside wikilink anchors (Issue #3312)", () => {
    expect(
      isAssetSpaceFrontmatter({
        exo__Instance_class: `notavalid-${ASSET_SPACE_CLASS_UID}`,
      }),
    ).toBe(false);
  });

  it("matches FileSpace class UID", () => {
    expect(
      isFileSpaceFrontmatter({
        exo__Instance_class: [`[[${FILE_SPACE_CLASS_UID}]]`],
      }),
    ).toBe(true);
    expect(isFileSpaceFrontmatter({ exo__Instance_class: "[[other]]" })).toBe(
      false,
    );
  });
});

describe("readSpaceSource (dual-read, RFC 01a83de8 v10)", () => {
  it("prefers _source over _git", () => {
    expect(
      readSpaceSource({
        exo__AssetSpace_source: "https://github.com/a/b",
        exo__AssetSpace_git: "https://github.com/c/d",
      }),
    ).toBe("https://github.com/a/b");
  });

  it("falls back to _git; null when neither", () => {
    expect(
      readSpaceSource({ exo__AssetSpace_git: "https://github.com/c/d" }),
    ).toBe("https://github.com/c/d");
    expect(readSpaceSource({})).toBeNull();
  });
});

describe("parseStrictGitHubRepoURL", () => {
  it("accepts plain https://github.com/<owner>/<repo>", () => {
    expect(parseStrictGitHubRepoURL("https://github.com/kitelev/exoas-ems")).toEqual({
      owner: "kitelev",
      repo: "exoas-ems",
    });
  });

  it.each([
    "http://github.com/a/b",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/b?x=1",
    "git@github.com:a/b.git",
    "https://github.com/a/..",
    "https://github.com/a/.hidden",
    "",
  ])("rejects %s", (url) => {
    expect(parseStrictGitHubRepoURL(url)).toBeNull();
  });

  it("rejects URLs over 256 chars", () => {
    const long = `https://github.com/a/${"b".repeat(260)}`;
    expect(parseStrictGitHubRepoURL(long)).toBeNull();
  });
});

describe("classifySpaceDeclaration", () => {
  it("returns not-space for ordinary assets", () => {
    expect(classifySpaceDeclaration({}, "x.md")).toEqual({ kind: "not-space" });
  });

  it("classifies an AssetSpace declaration into a spec (no spaceKind field)", () => {
    const v = classifySpaceDeclaration(
      assetFm({ exo__Asset_uid: " uid-1 " }),
      "decl.md",
    );
    expect(v.kind).toBe("candidate");
    if (v.kind !== "candidate") return;
    expect(v.candidate.spec).toEqual({
      owner: "kitelev",
      repo: "exoas-test",
      branch: SYNC_BRANCH,
      repoKey: `kitelev/exoas-test#${SYNC_BRANCH}`,
      localPath: "assetspaces/kitelev/exoas-test",
    });
    expect(v.candidate.spaceKind).toBe("asset");
    expect(v.candidate.asUid).toBe("uid-1");
    expect(v.warning).toBeUndefined();
  });

  it("classifies a FileSpace declaration with spaceKind: file", () => {
    const v = classifySpaceDeclaration(
      {
        exo__Instance_class: [`[[${FILE_SPACE_CLASS_UID}]]`],
        exo__AssetSpace_git: "https://github.com/kitelev/exofs-files",
      },
      "fs.md",
    );
    expect(v.kind).toBe("candidate");
    if (v.kind !== "candidate") return;
    expect(v.candidate.spec.spaceKind).toBe("file");
  });

  it("normalises .git / .GIT suffix once for BOTH parser and mount path (PR #3461 LOW)", () => {
    const v = classifySpaceDeclaration(
      assetFm({
        exo__AssetSpace_source: "https://github.com/kitelev/exoas-test.GIT",
      }),
      "decl.md",
    );
    expect(v.kind).toBe("candidate");
    if (v.kind !== "candidate") return;
    expect(v.candidate.spec.repo).toBe("exoas-test");
    expect(v.candidate.spec.localPath).toBe("assetspaces/kitelev/exoas-test");
  });

  it("both classes (disjoint) → asset wins with a warning", () => {
    const v = classifySpaceDeclaration(
      assetFm({
        exo__Instance_class: [
          `[[${ASSET_SPACE_CLASS_UID}]]`,
          `[[${FILE_SPACE_CLASS_UID}]]`,
        ],
      }),
      "decl.md",
    );
    expect(v.kind).toBe("candidate");
    if (v.kind !== "candidate") return;
    expect(v.candidate.spaceKind).toBe("asset");
    expect(v.warning).toMatch(/BOTH exo__AssetSpace and exo__FileSpace/);
  });

  it("AssetSpace without source → silent skip; FileSpace without source → warned skip", () => {
    const asset = classifySpaceDeclaration(
      { exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}]]`] },
      "a.md",
    );
    expect(asset).toEqual({ kind: "skip" });

    const file = classifySpaceDeclaration(
      { exo__Instance_class: [`[[${FILE_SPACE_CLASS_UID}]]`] },
      "f.md",
    );
    expect(file.kind).toBe("skip");
    if (file.kind !== "skip") return;
    expect(file.warning).toMatch(/mount path underivable/);
  });

  it("non-GitHub source → warned skip", () => {
    const v = classifySpaceDeclaration(
      assetFm({ exo__AssetSpace_source: "git@github.com:a/b.git" }),
      "decl.md",
    );
    expect(v.kind).toBe("skip");
    if (v.kind !== "skip") return;
    expect(v.warning).toMatch(/not a plain https:\/\/github\.com/);
  });
});

describe("SpaceSpecAccumulator", () => {
  function candidate(
    repo: string,
    spaceKind: "asset" | "file",
    asUid?: string,
  ): SpaceSpecCandidate {
    return {
      spec: {
        owner: "kitelev",
        repo,
        branch: SYNC_BRANCH,
        repoKey: `kitelev/${repo}#${SYNC_BRANCH}`,
        localPath: `assetspaces/kitelev/${repo}`,
        ...(spaceKind === "file" ? { spaceKind } : {}),
      },
      spaceKind,
      ...(asUid !== undefined ? { asUid } : {}),
    };
  }

  it("offer → commit accumulates specs and asUid map", () => {
    const acc = new SpaceSpecAccumulator();
    const c = candidate("r1", "asset", "uid-1");
    expect(acc.offer(c)).toBe(c.spec);
    acc.commit(c);
    expect(acc.specs).toEqual([c.spec]);
    expect(acc.asUidByRepoKey.get(c.spec.repoKey)).toBe("uid-1");
  });

  it("duplicate repoKey with the same kind → consumed silently", () => {
    const acc = new SpaceSpecAccumulator();
    const first = candidate("r1", "asset");
    acc.offer(first);
    acc.commit(first);
    expect(acc.offer(candidate("r1", "asset"))).toBeNull();
    expect(acc.warnings).toHaveLength(0);
    expect(acc.specs).toHaveLength(1);
  });

  it("conflicting kinds (file first, asset second) → committed spec demoted to asset + warning", () => {
    const acc = new SpaceSpecAccumulator();
    const fileFirst = candidate("r1", "file");
    acc.offer(fileFirst);
    acc.commit(fileFirst);

    expect(acc.offer(candidate("r1", "asset"))).toBeNull();
    expect(acc.warnings.join("\n")).toMatch(/declared as BOTH/);
    expect(acc.specs[0].spaceKind).toBeUndefined();
  });

  it("conflicting kinds (asset first) → warning, asset stays", () => {
    const acc = new SpaceSpecAccumulator();
    const assetFirst = candidate("r1", "asset");
    acc.offer(assetFirst);
    acc.commit(assetFirst);

    expect(acc.offer(candidate("r1", "file"))).toBeNull();
    expect(acc.warnings.join("\n")).toMatch(/declared as BOTH/);
    expect(acc.specs[0].spaceKind).toBeUndefined();
  });

  it("repoKey stays seen even when the caller never commits (failed existence check)", () => {
    const acc = new SpaceSpecAccumulator();
    expect(acc.offer(candidate("r1", "asset"))).not.toBeNull();
    // caller's existence check failed → no commit
    expect(acc.offer(candidate("r1", "asset"))).toBeNull();
    expect(acc.specs).toHaveLength(0);
  });
});
