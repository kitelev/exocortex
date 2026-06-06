import { derivePath } from "../../../src/services/AssetSpacePathDeriver";

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
