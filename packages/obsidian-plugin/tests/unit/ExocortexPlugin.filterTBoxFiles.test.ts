/**
 * RFC c7da0bca Phase 5 — unit tests for `ExocortexPlugin.filterTBoxFiles`
 * pure helper. Code-reviewer HIGH catch on PR #3277 — settings →
 * bootstrap wiring was previously empirically untested. Empirical
 * regression class: `bb00efed → ems-commands/` migration silently
 * stayed unindexed because no test pinned which folders the bootstrap
 * walks.
 *
 * Filter contract:
 *  - matches vault-relative path via `String.startsWith` against each prefix
 *  - returns empty array on empty prefix list (degraded mode)
 *  - trailing-slash on prefix prevents over-match
 *    (`assetspaces/ems/` vs `assetspaces/ems-commands/`)
 *  - no path traversal sanitisation needed — input intersects with
 *    `vault.getMarkdownFiles()` which is vault-scoped
 */
import ExocortexPlugin from "../../src/ExocortexPlugin";

describe("ExocortexPlugin.filterTBoxFiles (RFC c7da0bca Phase 5)", () => {
  it("returns matching files when prefix matches path start", () => {
    const files = [
      { path: "assetspaces/exo/Class.md" },
      { path: "assetspaces/ems/Task.md" },
      { path: "03 Knowledge/foo.md" },
    ];
    const result = ExocortexPlugin.filterTBoxFiles(files, [
      "assetspaces/exo/",
      "assetspaces/ems/",
    ]);
    expect(result.map((f) => f.path)).toEqual([
      "assetspaces/exo/Class.md",
      "assetspaces/ems/Task.md",
    ]);
  });

  it("includes files in ems-commands/ when prefix listed (regression: RFC aaaa2dea Phase 2 migration of bb00efed)", () => {
    const files = [
      { path: "assetspaces/ems-commands/bb00efed-7b17-42f5-a2c4-7cadf3e0ab36.md" },
      { path: "assetspaces/ems-commands/a6ef8fda-addb-40c3-940c-fe55fd7e8500.md" },
    ];
    const result = ExocortexPlugin.filterTBoxFiles(files, [
      "assetspaces/exo/",
      "assetspaces/ems/",
      "assetspaces/ems-commands/",
      "assetspaces/ims/",
      "assetspaces/exocmd/",
    ]);
    expect(result).toHaveLength(2);
  });

  it("does NOT over-match assetspaces/ems-commands/ when only assetspaces/ems/ is configured (trailing-slash safety)", () => {
    const files = [
      { path: "assetspaces/ems/Effort.md" },
      { path: "assetspaces/ems-commands/bb00efed-7b17-42f5-a2c4-7cadf3e0ab36.md" },
    ];
    const result = ExocortexPlugin.filterTBoxFiles(files, ["assetspaces/ems/"]);
    expect(result.map((f) => f.path)).toEqual(["assetspaces/ems/Effort.md"]);
  });

  it("returns empty array when prefix list is empty (degraded mode)", () => {
    const files = [
      { path: "assetspaces/exo/x.md" },
      { path: "assetspaces/ems/y.md" },
    ];
    expect(ExocortexPlugin.filterTBoxFiles(files, [])).toEqual([]);
  });

  it("returns empty array when no path matches any prefix", () => {
    const files = [
      { path: "03 Knowledge/note.md" },
      { path: "01 Inbox/scratch.md" },
    ];
    const result = ExocortexPlugin.filterTBoxFiles(files, [
      "assetspaces/exo/",
      "assetspaces/ems/",
    ]);
    expect(result).toEqual([]);
  });

  it("supports user-added submodule prefixes (e.g. kitelev/) without code change", () => {
    const files = [
      { path: "assetspaces/kitelev/c862dfda-85d2-4dc0-892e-f0efdcd054f4.md" },
      { path: "assetspaces/pmbok-ontology/Risk.md" },
      { path: "assetspaces/ems/Task.md" },
    ];
    const result = ExocortexPlugin.filterTBoxFiles(files, [
      "assetspaces/ems/",
      "assetspaces/kitelev/",
      "assetspaces/pmbok-ontology/",
    ]);
    expect(result).toHaveLength(3);
  });

  it("handles empty file list without error", () => {
    expect(
      ExocortexPlugin.filterTBoxFiles([], ["assetspaces/exo/"]),
    ).toEqual([]);
  });

  // ----------------------------------------------------------------------
  //  #3588 — EKA audience-layered layout: assetspaces are mounted under
  //  `assetspaces/<owner>/<assetspace>/<namespace>/<uid>.md` (e.g.
  //  `assetspaces/kitelev/exoas-exocmd/exocmd/<uid>.md`,
  //  `assetspaces/kitelev/exoas-public/ems/<uid>.md`). A plain `startsWith`
  //  prefix never matches that depth → bootstrap walked 0 files → command/
  //  binding/grounding triples only arrived via the slow incremental
  //  convertVault cold-start → create-buttons appeared late (root of the
  //  #3587 eka-gui partial-store race). A single-segment `*` wildcard in a
  //  prefix matches exactly one path segment, so `assetspaces/*/*/exocmd/`
  //  reaches the namespace folder under ANY owner+assetspace WITHOUT pulling
  //  unrelated assetspaces (leaf ABox like `exoas-my/pn/`) or the whole of
  //  `exoas-public` (its 30+ framework namespaces concept/person/ui/…).
  // ----------------------------------------------------------------------
  describe("#3588 EKA layout — segment-wildcard prefixes", () => {
    it("matches the EKA exocmd namespace folder under owner+assetspace via assetspaces/*/*/exocmd/", () => {
      const files = [
        { path: "assetspaces/kitelev/exoas-exocmd/exocmd/22093ca1.md" },
        { path: "assetspaces/kitelev/exoas-public/ems/82c74542.md" },
        { path: "assetspaces/kitelev/exoas-public/ems-commands/bb00efed.md" },
        { path: "assetspaces/kitelev/exoas-exo/exo/Class.md" },
      ];
      const result = ExocortexPlugin.filterTBoxFiles(files, [
        "assetspaces/*/*/exo/",
        "assetspaces/*/*/ems/",
        "assetspaces/*/*/ems-commands/",
        "assetspaces/*/*/ims/",
        "assetspaces/*/*/exocmd/",
      ]);
      expect(result.map((f) => f.path).sort()).toEqual([
        "assetspaces/kitelev/exoas-exo/exo/Class.md",
        "assetspaces/kitelev/exoas-exocmd/exocmd/22093ca1.md",
        "assetspaces/kitelev/exoas-public/ems-commands/bb00efed.md",
        "assetspaces/kitelev/exoas-public/ems/82c74542.md",
      ]);
    });

    it("a `*` matches exactly one segment — does NOT collapse owner+assetspace into one", () => {
      // `assetspaces/*/exocmd/` (single wildcard) must NOT match the
      // two-level EKA nesting `assetspaces/<owner>/<assetspace>/exocmd/`.
      const files = [
        { path: "assetspaces/kitelev/exoas-exocmd/exocmd/x.md" },
      ];
      expect(
        ExocortexPlugin.filterTBoxFiles(files, ["assetspaces/*/exocmd/"]),
      ).toEqual([]);
    });

    it("EKA glob is scope-tight: does NOT pull leaf-ABox or unrelated exoas-public framework namespaces", () => {
      const files = [
        // wanted (TBox namespaces)
        { path: "assetspaces/kitelev/exoas-public/ems/Area.md" },
        { path: "assetspaces/kitelev/exoas-exocmd/exocmd/cmd.md" },
        // NOT wanted: personal leaf ABox
        { path: "assetspaces/kitelev/exoas-my/pn/2026-06-18.md" },
        { path: "assetspaces/kitelev/exoas-my/ztlk/note.md" },
        { path: "assetspaces/kitelev/exoas-tbank/og/secret.md" },
        // NOT wanted: exoas-public framework namespaces unrelated to ems create-buttons
        { path: "assetspaces/kitelev/exoas-public/concept/c.md" },
        { path: "assetspaces/kitelev/exoas-public/person/p.md" },
        { path: "assetspaces/kitelev/exoas-public/ui/layout.md" },
      ];
      const result = ExocortexPlugin.filterTBoxFiles(files, [
        "assetspaces/*/*/exo/",
        "assetspaces/*/*/ems/",
        "assetspaces/*/*/ems-commands/",
        "assetspaces/*/*/ims/",
        "assetspaces/*/*/exocmd/",
      ]);
      expect(result.map((f) => f.path).sort()).toEqual([
        "assetspaces/kitelev/exoas-exocmd/exocmd/cmd.md",
        "assetspaces/kitelev/exoas-public/ems/Area.md",
      ]);
    });

    it("matches files nested DEEPER than the namespace folder (prefix semantics preserved)", () => {
      const files = [
        { path: "assetspaces/kitelev/exoas-exocmd/exocmd/sub/deep.md" },
      ];
      expect(
        ExocortexPlugin.filterTBoxFiles(files, ["assetspaces/*/*/exocmd/"]),
      ).toHaveLength(1);
    });

    it("wildcard prefix still honours trailing-slash boundary (ems vs ems-commands)", () => {
      const files = [
        { path: "assetspaces/kitelev/exoas-public/ems/Effort.md" },
        { path: "assetspaces/kitelev/exoas-public/ems-commands/bb00efed.md" },
      ];
      const result = ExocortexPlugin.filterTBoxFiles(files, [
        "assetspaces/*/*/ems/",
      ]);
      expect(result.map((f) => f.path)).toEqual([
        "assetspaces/kitelev/exoas-public/ems/Effort.md",
      ]);
    });

    it("REGRESSION GUARD: legacy two-vault `assetspaces/<ns>/` prefixes still match (no wildcard)", () => {
      const files = [
        { path: "assetspaces/exo/Class.md" },
        { path: "assetspaces/ems/Task.md" },
        { path: "assetspaces/ems-commands/bb00efed.md" },
        { path: "assetspaces/exocmd/22093ca1.md" },
        { path: "03 Knowledge/foo.md" },
      ];
      const result = ExocortexPlugin.filterTBoxFiles(files, [
        "assetspaces/exo/",
        "assetspaces/ems/",
        "assetspaces/ems-commands/",
        "assetspaces/ims/",
        "assetspaces/exocmd/",
      ]);
      expect(result.map((f) => f.path).sort()).toEqual([
        "assetspaces/ems-commands/bb00efed.md",
        "assetspaces/ems/Task.md",
        "assetspaces/exo/Class.md",
        "assetspaces/exocmd/22093ca1.md",
      ]);
    });

    it("legacy + EKA prefixes coexist (mixed-layout vault during migration)", () => {
      const files = [
        { path: "assetspaces/ems/legacy.md" },
        { path: "assetspaces/kitelev/exoas-public/ems/eka.md" },
      ];
      const result = ExocortexPlugin.filterTBoxFiles(files, [
        "assetspaces/ems/",
        "assetspaces/*/*/ems/",
      ]);
      expect(result).toHaveLength(2);
    });
  });
});
