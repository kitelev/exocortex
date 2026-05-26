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
});
