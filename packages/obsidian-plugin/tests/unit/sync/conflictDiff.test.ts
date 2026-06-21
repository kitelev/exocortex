import type { ConflictDetail } from "@kitelev/exocortex-core";
import {
  buildPaneModel,
  type DiffRow,
} from "../../../src/infrastructure/adapters/conflictDiff";

/** Helper: a conflict detail with sane defaults. */
function detail(p: Partial<ConflictDetail>): ConflictDetail {
  return {
    repoKey: "repo",
    path: "a.md",
    hasLocal: p.local !== undefined,
    hasRemote: p.remote !== undefined,
    ...p,
  };
}

const texts = (rows: DiffRow[], cls: string): string[] =>
  rows.filter((r) => r.cls === cls).map((r) => r.text);

describe("conflictDiff.buildPaneModel", () => {
  it("3-way: local-only addition is green on the local pane, auto-merges", () => {
    const m = buildPaneModel(
      detail({ base: "a\nb", local: "a\nb\nc", remote: "a\nb" }),
    );
    expect(m.hasConflict).toBe(false);
    expect(m.hunkCount).toBe(0);
    expect(m.autoMergedCount).toBe(1);
    expect(texts(m.localRows, "added")).toEqual(["c"]);
    expect(m.autoMerge).toBe("a\nb\nc");
    // rebuildMerge with no choices === the auto-merge seed.
    expect(m.rebuildMerge([])).toBe(m.autoMerge);
  });

  it("3-way: local-only removal shows the dropped base line as red", () => {
    const m = buildPaneModel(
      detail({ base: "a\nb\nc", local: "a\nc", remote: "a\nb\nc" }),
    );
    expect(m.hasConflict).toBe(false);
    expect(texts(m.localRows, "removed")).toEqual(["b"]);
    expect(m.autoMerge).toBe("a\nc");
  });

  it("3-way: divergent edits are a conflict hunk (both panes, navigable)", () => {
    const m = buildPaneModel(detail({ base: "x", local: "L", remote: "R" }));
    expect(m.hasConflict).toBe(true);
    expect(m.hunkCount).toBe(1);
    expect(m.hunks).toEqual([{ localLines: ["L"], remoteLines: ["R"] }]);
    expect(texts(m.localRows, "conflict")).toEqual(["L"]);
    expect(texts(m.remoteRows, "conflict")).toEqual(["R"]);
    // First conflict row is the nav anchor on both panes.
    expect(m.localRows.find((r) => r.conflictStart)?.text).toBe("L");
    expect(m.remoteRows.find((r) => r.conflictStart)?.text).toBe("R");
    // Default seed = local; per-hunk flip to remote rebuilds the merge.
    expect(m.autoMerge).toBe("L");
    expect(m.rebuildMerge(["remote"])).toBe("R");
    expect(m.rebuildMerge(["local"])).toBe("L");
  });

  it("add/delete: a side deleted locally → placeholder + whole remote green", () => {
    const m = buildPaneModel(
      detail({ base: "a", local: undefined, remote: "r1\nr2" }),
    );
    expect(m.hasConflict).toBe(true);
    expect(m.hunkCount).toBe(1);
    expect(m.localRows).toEqual([
      { text: "(deleted on this side)", cls: "removed", conflictStart: true },
    ]);
    expect(texts(m.remoteRows, "added")).toEqual(["r1", "r2"]);
    // Default keeps the surviving (remote) side; seed === rebuild([]).
    expect(m.autoMerge).toBe("r1\nr2");
    expect(m.rebuildMerge([])).toBe(m.autoMerge);
    // Flipping to "local" accepts the deletion (empty result).
    expect(m.rebuildMerge(["local"])).toBe("");
  });

  it("no base (GC'd): falls back to a 2-way Local↔Remote conflict", () => {
    const m = buildPaneModel(
      detail({ base: undefined, local: "a\nb", remote: "a\nc" }),
    );
    expect(m.hasConflict).toBe(true);
    expect(m.hunkCount).toBe(1);
    expect(m.hunks).toEqual([{ localLines: ["b"], remoteLines: ["c"] }]);
    expect(m.autoMerge).toBe("a\nb");
    expect(m.rebuildMerge(["remote"])).toBe("a\nc");
  });

  it("auto-merge seed: non-conflicting edits on both sides merge cleanly", () => {
    const m = buildPaneModel(
      detail({
        base: "a\nb\nc\nd",
        local: "a\nX\nc\nd", // changed b→X
        remote: "a\nb\nc\nY", // changed d→Y
      }),
    );
    expect(m.hasConflict).toBe(false);
    expect(m.hunkCount).toBe(0);
    expect(m.autoMergedCount).toBe(2);
    expect(m.autoMerge).toBe("a\nX\nc\nY");
  });

  it("3-way: identical content yields all-context, no conflict, no change", () => {
    const m = buildPaneModel(
      detail({ base: "a\nb", local: "a\nb", remote: "a\nb" }),
    );
    expect(m.hasConflict).toBe(false);
    expect(m.hunkCount).toBe(0);
    expect(m.autoMergedCount).toBe(0);
    expect(m.localRows.every((r) => r.cls === "context")).toBe(true);
    expect(m.autoMerge).toBe("a\nb");
  });

  it("multiple conflict hunks are all collected for navigation", () => {
    const m = buildPaneModel(
      detail({
        base: "a\nb\nc\nd\ne",
        local: "a\nL1\nc\nL2\ne",
        remote: "a\nR1\nc\nR2\ne",
      }),
    );
    expect(m.hunkCount).toBe(2);
    expect(m.hunks).toEqual([
      { localLines: ["L1"], remoteLines: ["R1"] },
      { localLines: ["L2"], remoteLines: ["R2"] },
    ]);
    // Two nav anchors per pane.
    expect(m.localRows.filter((r) => r.conflictStart)).toHaveLength(2);
    // Per-hunk: take remote for hunk 0, keep local for hunk 1.
    expect(m.rebuildMerge(["remote", "local"])).toBe("a\nR1\nc\nL2\ne");
  });

  it("3-way: a convergent edit (both sides identical) is auto-merged, not a conflict", () => {
    const m = buildPaneModel(
      detail({ base: "a\nb\nc", local: "a\nX\nc", remote: "a\nX\nc" }),
    );
    expect(m.hasConflict).toBe(false);
    expect(m.hunkCount).toBe(0);
    expect(m.autoMergedCount).toBe(1);
    expect(m.autoMerge).toBe("a\nX\nc");
  });

  it("defensive: both sides absent yields an empty, crash-free model", () => {
    // Unreachable in production (the resolver filters out local===remote===absent),
    // but buildPaneModel is exported — guard against a future direct caller.
    const m = buildPaneModel(detail({ local: undefined, remote: undefined }));
    expect(m.autoMerge).toBe("");
    expect(m.localRows).toEqual([
      { text: "(deleted on this side)", cls: "removed", conflictStart: true },
    ]);
    expect(m.remoteRows).toEqual([]);
  });
});
