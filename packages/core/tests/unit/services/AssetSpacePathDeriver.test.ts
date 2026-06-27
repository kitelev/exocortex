import {
  derivePath,
  deriveUrl,
  deriveLegacyFlatPath,
} from "../../../src/services/AssetSpacePathDeriver";

describe("derivePath (RFC 01a83de8 v10 UD1)", () => {
  const EXPECTED = "assetspaces/kitelev/exoas-ems";

  describe("canonical owner/repo extraction — all URL forms collapse equal", () => {
    it.each([
      ["HTTPS bare", "https://github.com/kitelev/exoas-ems"],
      ["HTTPS with .git", "https://github.com/kitelev/exoas-ems.git"],
      ["HTTP scheme", "http://github.com/kitelev/exoas-ems"],
      ["trailing slash", "https://github.com/kitelev/exoas-ems/"],
      [".git + trailing slash", "https://github.com/kitelev/exoas-ems.git/"],
      ["SSH scp-like", "git@github.com:kitelev/exoas-ems.git"],
      ["SSH scp-like no .git", "git@github.com:kitelev/exoas-ems"],
      ["ssh:// URL", "ssh://git@github.com/kitelev/exoas-ems.git"],
      ["ssh:// with port", "ssh://git@github.com:22/kitelev/exoas-ems.git"],
      ["git:// protocol", "git://github.com/kitelev/exoas-ems.git"],
      ["embedded credentials", "https://user:token@github.com/kitelev/exoas-ems"],
      ["embedded user only", "https://user@github.com/kitelev/exoas-ems.git"],
      ["leading/trailing whitespace", "  https://github.com/kitelev/exoas-ems  "],
      ["uppercase .GIT suffix", "https://github.com/kitelev/exoas-ems.GIT"],
    ])("%s → canonical", (_label, url) => {
      expect(derivePath(url)).toBe(EXPECTED);
    });
  });

  describe("two-level Maven layout (owner is preserved, never flattened)", () => {
    it("different owners with same repo name produce distinct paths", () => {
      expect(derivePath("https://github.com/alice/shared")).toBe(
        "assetspaces/alice/shared",
      );
      expect(derivePath("https://github.com/bob/shared")).toBe(
        "assetspaces/bob/shared",
      );
    });

    it("registry / profiles / testlib repos derive their canonical mounts", () => {
      expect(
        derivePath("https://github.com/kitelev/exoas-kitelev-registry"),
      ).toBe("assetspaces/kitelev/exoas-kitelev-registry");
      expect(
        derivePath("https://github.com/kitelev/exoas-kitelev-profiles.git"),
      ).toBe("assetspaces/kitelev/exoas-kitelev-profiles");
      expect(derivePath("git@github.com:kitelev/exoas-testlib.git")).toBe(
        "assetspaces/kitelev/exoas-testlib",
      );
    });

    it("extra path segments beyond owner/repo are ignored (canonical = first two)", () => {
      expect(
        derivePath("https://github.com/kitelev/exoas-ems/tree/main"),
      ).toBe(EXPECTED);
    });
  });

  describe("null on unextractable input (caller falls back to legacy strategy)", () => {
    it.each([
      ["empty string", ""],
      ["whitespace only", "   "],
      ["non-string", 42 as unknown as string],
      ["undefined", undefined as unknown as string],
      ["null", null as unknown as string],
      ["host only, no path", "https://github.com"],
      ["host + trailing slash, no repo", "https://github.com/"],
      ["owner only, no repo", "https://github.com/kitelev"],
      ["scp host only", "git@github.com:"],
      // RFC 01a83de8 Phase 1b T3 — `file://` is a local clone source with no
      // hosted owner/repo; derivePath returns null so callers fall back to the
      // path-prefix strategy (used by the hard-switch E2E with file:// remotes).
      ["file:// triple-slash absolute", "file:///tmp/abc/remote-as1"],
      ["file:// with host segment", "file://localhost/tmp/remote-as1"],
      ["FILE:// uppercase scheme", "FILE:///tmp/abc/remote-as1"],
    ])("%s → null", (_label, input) => {
      expect(derivePath(input)).toBeNull();
    });
  });

  describe("path-traversal / out-of-charset segments rejected (no escape primitive)", () => {
    it.each([
      ["bare ../.. traversal", "../../etc/passwd"],
      ["repo segment is ..", "https://github.com/owner/.."],
      ["owner segment is ..", "https://github.com/../repo"],
      ["repo segment is .", "https://github.com/owner/."],
      ["whitespace in repo", "https://github.com/owner/repo with space"],
      ["slash-encoded escape attempt", "https://github.com/owner/%2e%2e"],
      ["control char in owner", "https://github.com/ow\tner/repo"],
    ])("%s → null", (_label, input) => {
      expect(derivePath(input)).toBeNull();
    });

    it("derived path never contains a `..` component", () => {
      const inputs = [
        "../../etc/passwd",
        "https://github.com/owner/..",
        "git@github.com:../escape.git",
      ];
      for (const input of inputs) {
        const out = derivePath(input);
        if (out !== null) {
          expect(out.split("/")).not.toContain("..");
        }
      }
    });
  });

  describe("idempotency — re-deriving an already-canonical input is stable", () => {
    it("HTTPS and SSH forms of the same repo are interchangeable", () => {
      const https = derivePath("https://github.com/kitelev/exoas-ems.git");
      const ssh = derivePath("git@github.com:kitelev/exoas-ems.git");
      expect(https).toBe(ssh);
      expect(https).toBe(EXPECTED);
    });
  });
});

describe("deriveUrl (RFC 0005 Phase 0 — inverse of derivePath)", () => {
  const ALL_GITHUB_FORMS: Array<[string, string]> = [
    ["HTTPS bare", "https://github.com/kitelev/exoas-ems"],
    ["HTTPS with .git", "https://github.com/kitelev/exoas-ems.git"],
    ["HTTP scheme", "http://github.com/kitelev/exoas-ems"],
    ["trailing slash", "https://github.com/kitelev/exoas-ems/"],
    [".git + trailing slash", "https://github.com/kitelev/exoas-ems.git/"],
    ["SSH scp-like", "git@github.com:kitelev/exoas-ems.git"],
    ["SSH scp-like no .git", "git@github.com:kitelev/exoas-ems"],
    ["ssh:// URL", "ssh://git@github.com/kitelev/exoas-ems.git"],
    ["ssh:// with port", "ssh://git@github.com:22/kitelev/exoas-ems.git"],
    ["git:// protocol", "git://github.com/kitelev/exoas-ems.git"],
    ["embedded credentials", "https://user:token@github.com/kitelev/exoas-ems"],
    ["leading/trailing whitespace", "  https://github.com/kitelev/exoas-ems  "],
  ];

  // The requirement-bound test (revert-verify keys on this — neutralising the
  // deriveUrl body, e.g. `return null`, makes the reconstruction + round-trip
  // assertions go RED; restoring → GREEN).
  it("@req:1e56367b-ca1d-4c8b-8839-343e82cee2d3 reconstructs the canonical github URL from a mount path, is the exact inverse of derivePath under the github-https invariant, and returns null for non-conforming paths", () => {
    // 1. Direct reconstruction from a canonical mount path.
    expect(deriveUrl("assetspaces/kitelev/exoas-exo")).toBe(
      "https://github.com/kitelev/exoas-exo",
    );
    // 2. Exact inverse: deriveUrl(derivePath(url)) === canonical github URL for
    //    every URL form derivePath normalises.
    for (const [, url] of ALL_GITHUB_FORMS) {
      const path = derivePath(url);
      expect(path).not.toBeNull();
      expect(deriveUrl(path as string)).toBe(
        "https://github.com/kitelev/exoas-ems",
      );
    }
    // 3. null for a non-conforming path (caller falls back to its legacy URL
    //    source — the .gitmodules registry, until RFC 0005 Phase 1 removes it).
    expect(deriveUrl("not-assetspaces/owner/repo")).toBeNull();
    expect(deriveUrl("assetspaces/onlyone")).toBeNull();
  });

  describe("canonical reconstruction (path → https github URL)", () => {
    it.each([
      ["kitelev/exoas-exo", "assetspaces/kitelev/exoas-exo", "https://github.com/kitelev/exoas-exo"],
      ["different owner same repo", "assetspaces/alice/shared", "https://github.com/alice/shared"],
      ["dotted/.-/_ chars in repo", "assetspaces/kitelev/exoas-kitelev-registry", "https://github.com/kitelev/exoas-kitelev-registry"],
      ["leading slash tolerated", "/assetspaces/kitelev/exoas-ems", "https://github.com/kitelev/exoas-ems"],
      ["trailing slash tolerated", "assetspaces/kitelev/exoas-ems/", "https://github.com/kitelev/exoas-ems"],
      ["extra segments ignored (first two used)", "assetspaces/kitelev/exoas-ems/sub/dir", "https://github.com/kitelev/exoas-ems"],
      ["surrounding whitespace trimmed", "  assetspaces/kitelev/exoas-ems  ", "https://github.com/kitelev/exoas-ems"],
    ])("%s → URL", (_label, path, expected) => {
      expect(deriveUrl(path)).toBe(expected);
    });
  });

  describe("exact inverse of derivePath — round-trip for every URL form", () => {
    it.each(ALL_GITHUB_FORMS)(
      "%s → derivePath → deriveUrl === canonical github URL",
      (_label, url) => {
        const path = derivePath(url);
        expect(path).not.toBeNull();
        expect(deriveUrl(path as string)).toBe(
          "https://github.com/kitelev/exoas-ems",
        );
      },
    );
  });

  describe("null on non-conforming paths (caller falls back)", () => {
    it.each([
      ["empty string", ""],
      ["whitespace only", "   "],
      ["non-string", 42 as unknown as string],
      ["undefined", undefined as unknown as string],
      ["null", null as unknown as string],
      ["wrong prefix", "not-assetspaces/owner/repo"],
      ["no prefix at all", "owner/repo"],
      ["assetspaces only", "assetspaces"],
      ["assetspaces/ prefix only", "assetspaces/"],
      ["owner only (one segment)", "assetspaces/onlyone"],
      ["bare slashes", "assetspaces///"],
    ])("%s → null", (_label, input) => {
      expect(deriveUrl(input)).toBeNull();
    });
  });

  describe("traversal / out-of-charset segments rejected (no escape into URL)", () => {
    it.each([
      ["owner is ..", "assetspaces/../repo"],
      ["repo is ..", "assetspaces/owner/.."],
      ["repo is .", "assetspaces/owner/."],
      ["owner is .", "assetspaces/./repo"],
      ["whitespace in repo", "assetspaces/owner/repo with space"],
      ["url-encoded escape attempt", "assetspaces/owner/%2e%2e"],
      ["control char in owner", "assetspaces/ow\tner/repo"],
      ["slash-bearing segment via encoding", "assetspaces/owner/re%2Fpo"],
    ])("%s → null", (_label, input) => {
      expect(deriveUrl(input)).toBeNull();
    });

    it("reconstructed URL never carries a `..` path component", () => {
      for (const input of [
        "assetspaces/../repo",
        "assetspaces/owner/..",
        "assetspaces/./repo",
      ]) {
        const out = deriveUrl(input);
        if (out !== null) expect(out.split("/")).not.toContain("..");
      }
    });
  });

  describe("idempotent inverse — HTTPS and SSH forms reconstruct identically", () => {
    it("the same repo via any form round-trips to one canonical URL", () => {
      const fromHttps = deriveUrl(
        derivePath("https://github.com/kitelev/exoas-ems.git") as string,
      );
      const fromSsh = deriveUrl(
        derivePath("git@github.com:kitelev/exoas-ems.git") as string,
      );
      expect(fromHttps).toBe(fromSsh);
      expect(fromHttps).toBe("https://github.com/kitelev/exoas-ems");
    });
  });
});

describe("deriveLegacyFlatPath (#3538 follow-up — flat-mount detection)", () => {
  describe("strips the `exoas-` prefix to the pre-#3538 flat path", () => {
    it.each([
      ["HTTPS", "https://github.com/kitelev/exoas-ems", "assetspaces/ems"],
      [
        "HTTPS with .git",
        "https://github.com/kitelev/exoas-registry.git",
        "assetspaces/registry",
      ],
      [
        "SSH scp-like",
        "git@github.com:kitelev/exoas-kitelev-profiles.git",
        "assetspaces/kitelev-profiles",
      ],
      [
        "all forms normalise",
        "  ssh://git@github.com:22/kitelev/exoas-testlib.git/  ",
        "assetspaces/testlib",
      ],
    ])("%s → flat path", (_label, url, expected) => {
      expect(deriveLegacyFlatPath(url)).toBe(expected);
    });
  });

  it("repo WITHOUT an `exoas-` prefix keeps its name (single level)", () => {
    expect(deriveLegacyFlatPath("https://github.com/alice/shared")).toBe(
      "assetspaces/shared",
    );
  });

  describe("legacy flat path DIFFERS from canonical — the migration signal", () => {
    it("registry: flat (exoas- stripped) vs canonical owner/repo", () => {
      // `deriveFolderName` stripped only the leading `exoas-` token, so
      // `exoas-kitelev-registry` → `kitelev-registry` (NOT `registry`).
      const url = "https://github.com/kitelev/exoas-kitelev-registry";
      expect(deriveLegacyFlatPath(url)).toBe("assetspaces/kitelev-registry");
      expect(derivePath(url)).toBe("assetspaces/kitelev/exoas-kitelev-registry");
      // The two MUST differ — that inequality is exactly what apply-profile's
      // flat-mount detection keys on.
      expect(deriveLegacyFlatPath(url)).not.toBe(derivePath(url));
    });

    it("short repo: flat assetspaces/registry vs canonical owner/repo", () => {
      const url = "https://github.com/kitelev/exoas-registry";
      expect(deriveLegacyFlatPath(url)).toBe("assetspaces/registry");
      expect(derivePath(url)).toBe("assetspaces/kitelev/exoas-registry");
      expect(deriveLegacyFlatPath(url)).not.toBe(derivePath(url));
    });
  });

  describe("null on un-derivable input (same cases as derivePath)", () => {
    it.each([
      ["empty string", ""],
      ["non-string", 42 as unknown as string],
      ["undefined", undefined as unknown as string],
      ["host only, no repo", "https://github.com/kitelev"],
      ["file:// local clone", "file:///tmp/abc/remote-as1"],
      ["path traversal", "https://github.com/owner/.."],
      // `exoas-` with nothing after the prefix → empty flat segment → null.
      ["exoas- prefix only (empty stripped repo)", "https://github.com/o/exoas-"],
    ])("%s → null", (_label, input) => {
      expect(deriveLegacyFlatPath(input)).toBeNull();
    });
  });

  it("inherits derivePath's traversal guard — never emits a `..` component", () => {
    for (const input of [
      "../../etc/passwd",
      "https://github.com/owner/..",
      "git@github.com:../escape.git",
    ]) {
      const out = deriveLegacyFlatPath(input);
      if (out !== null) expect(out.split("/")).not.toContain("..");
    }
  });
});
