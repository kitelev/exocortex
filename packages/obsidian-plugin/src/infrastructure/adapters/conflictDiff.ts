/**
 * conflictDiff — pure presentation helper for the IntelliJ-style 3-pane
 * ExoSync conflict resolver (design 2026-06-21, finding a0a3d1d6).
 *
 * This is a VISUALISATION concern (homoiconicity Q3 — rendering core), NOT a
 * merge engine: it never decides a resolution, it only describes how Local and
 * Remote differ from their common `base` so the modal can colour the lines and
 * seed the editable merge pane. The user's choice still flows out through the
 * unchanged `ResolveChoice` → `resolver.resolve` path; zero-loss semantics live
 * in the engine, untouched here.
 *
 * Why an in-house 3-way walk instead of `diff3` from the core: `diff3` returns
 * at the FIRST conflict region (`{ ok:false, conflict }`), which is enough for
 * the engine's "auto-merge or quarantine" decision but NOT for a UI that must
 * (a) navigate EVERY conflict hunk and (b) colour each line. So this module
 * walks all regions, reusing the engine's exact LCS pairing (`lcsMatch`, copied
 * verbatim — it is module-private in diff3.ts) so the alignment matches.
 */

import type { ConflictDetail } from "@kitelev/exocortex-core";

export type DiffClass = "context" | "added" | "removed" | "conflict";

export interface DiffRow {
  text: string;
  cls: DiffClass;
  /** First row of a conflict hunk — the anchor the Prev/Next nav scrolls to. */
  conflictStart?: boolean;
}

/** One conflict hunk's two competing versions (per-hunk accept + nav). */
export interface ConflictHunk {
  localLines: string[];
  remoteLines: string[];
}

export interface PaneModel {
  localRows: DiffRow[];
  remoteRows: DiffRow[];
  /** Merge-pane seed: non-conflicting changes auto-merged, conflicts → local. */
  autoMerge: string;
  /** Number of genuine conflict hunks (both sides changed differently). */
  hunkCount: number;
  /** Number of change regions auto-merged without conflict (UX counter). */
  autoMergedCount: number;
  hasConflict: boolean;
  /** Conflict hunks in document order (for per-hunk accept + navigation). */
  hunks: ConflictHunk[];
  /**
   * Rebuild the merge text from per-hunk choices. `choices[i]` selects the i-th
   * conflict hunk's side; defaults to "local" (the {@link autoMerge} seed) for
   * any index not supplied. Non-conflicting regions are always auto-merged.
   */
  rebuildMerge: (choices: ReadonlyArray<"local" | "remote">) => string;
}

/**
 * Monotonic LCS pairing: index in `a` → index in `b`. Copied verbatim from
 * `packages/core/src/services/sync/diff3.ts` (`lcsMatch` is module-private
 * there) so the UI alignment matches the engine's 3-way merge exactly.
 */
function lcsMatch(
  a: readonly string[],
  b: readonly string[],
): Map<number, number> {
  const n = a.length;
  const m = b.length;
  const dp: Int32Array[] = Array.from(
    { length: n + 1 },
    () => new Int32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const match = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      match.set(i, j);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return match;
}

function sliceEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 2-way line alignment of `side` against a reference (`base` in 3-way, the
 * other side when there is no base): matched lines → context, side-only lines →
 * added (green), reference-only lines → removed (red, the reference text shown
 * so the user sees what this side dropped).
 */
function alignAgainstBase(
  side: readonly string[],
  base: readonly string[],
): DiffRow[] {
  const match = lcsMatch(side, base);
  const rows: DiffRow[] = [];
  let si = 0;
  let bi = 0;
  while (si < side.length || bi < base.length) {
    if (si < side.length && match.has(si)) {
      const bj = match.get(si) as number;
      while (bi < bj) {
        rows.push({ text: base[bi], cls: "removed" });
        bi++;
      }
      rows.push({ text: side[si], cls: "context" });
      si++;
      bi++;
    } else if (si < side.length) {
      rows.push({ text: side[si], cls: "added" });
      si++;
    } else {
      rows.push({ text: base[bi], cls: "removed" });
      bi++;
    }
  }
  return rows;
}

type SegmentKind = "stable" | "local" | "remote" | "convergent" | "conflict";

interface Segment {
  kind: SegmentKind;
  localRows: DiffRow[];
  remoteRows: DiffRow[];
  /** Lines this segment contributes to the default auto-merge (conflict→local). */
  mergeLines: string[];
  /** Conflict alternatives (present only when kind === "conflict"). */
  conflictLocal?: string[];
  conflictRemote?: string[];
}

function splitLines(s: string | undefined): string[] {
  if (s === undefined || s === "") return s === "" ? [""] : [];
  return s.split("\n");
}

/** Map an aligned side's non-context rows to conflict class (whole hunk). */
function markConflict(lines: string[]): DiffRow[] {
  if (lines.length === 0) {
    return [
      { text: "(empty on this side)", cls: "conflict", conflictStart: true },
    ];
  }
  return lines.map((text, i) => ({
    text,
    cls: "conflict" as const,
    ...(i === 0 ? { conflictStart: true } : {}),
  }));
}

/** Region kinds for a changed (non-stable) base-gap. */
function changedSegment(
  baseChunk: string[],
  localChunk: string[],
  remoteChunk: string[],
): Segment {
  const localChanged = !sliceEq(localChunk, baseChunk);
  const remoteChanged = !sliceEq(remoteChunk, baseChunk);

  if (localChanged && remoteChanged && !sliceEq(localChunk, remoteChunk)) {
    // Genuine conflict — both sides diverged differently.
    return {
      kind: "conflict",
      localRows: markConflict(localChunk),
      remoteRows: markConflict(remoteChunk),
      mergeLines: localChunk,
      conflictLocal: localChunk,
      conflictRemote: remoteChunk,
    };
  }
  if (localChanged && remoteChanged) {
    // Convergent — both made the same change.
    return {
      kind: "convergent",
      localRows: alignAgainstBase(localChunk, baseChunk),
      remoteRows: alignAgainstBase(remoteChunk, baseChunk),
      mergeLines: localChunk,
    };
  }
  if (localChanged) {
    // Only local changed — auto-merge takes local; remote pane is unchanged.
    return {
      kind: "local",
      localRows: alignAgainstBase(localChunk, baseChunk),
      remoteRows: remoteChunk.map((text) => ({
        text,
        cls: "context" as const,
      })),
      mergeLines: localChunk,
    };
  }
  // Only remote changed — auto-merge takes remote; local pane is unchanged.
  return {
    kind: "remote",
    localRows: localChunk.map((text) => ({ text, cls: "context" as const })),
    remoteRows: alignAgainstBase(remoteChunk, baseChunk),
    mergeLines: remoteChunk,
  };
}

function stableSegment(lines: string[]): Segment {
  const rows = lines.map((text) => ({ text, cls: "context" as const }));
  return {
    kind: "stable",
    localRows: rows,
    remoteRows: rows,
    mergeLines: lines,
  };
}

/**
 * Full 3-way region walk (mirrors diff3's anchor loop but COLLECTS every region
 * instead of returning at the first conflict).
 */
function collectRegions3(
  base: string[],
  local: string[],
  remote: string[],
): Segment[] {
  const ml = lcsMatch(base, local);
  const mr = lcsMatch(base, remote);
  const segments: Segment[] = [];
  let bi = 0;
  let li = 0;
  let ri = 0;

  for (;;) {
    let anchor = bi;
    while (anchor < base.length && !(ml.has(anchor) && mr.has(anchor))) {
      anchor++;
    }
    const lEnd =
      anchor < base.length ? (ml.get(anchor) as number) : local.length;
    const rEnd =
      anchor < base.length ? (mr.get(anchor) as number) : remote.length;

    const baseChunk = base.slice(bi, anchor);
    const localChunk = local.slice(li, lEnd);
    const remoteChunk = remote.slice(ri, rEnd);

    const localChanged = !sliceEq(localChunk, baseChunk);
    const remoteChanged = !sliceEq(remoteChunk, baseChunk);
    if (!localChanged && !remoteChanged) {
      if (baseChunk.length > 0) segments.push(stableSegment(baseChunk));
    } else {
      segments.push(changedSegment(baseChunk, localChunk, remoteChunk));
    }

    if (anchor >= base.length) break;
    segments.push(stableSegment([base[anchor]])); // stable anchor line
    bi = anchor + 1;
    li = lEnd + 1;
    ri = rEnd + 1;
  }

  return segments;
}

/**
 * 2-way fallback when there is no common base (GC'd or absent): align Local
 * against Remote and vice-versa; any non-context run is treated as a conflict
 * hunk (we cannot tell who is "right" without a base).
 */
function collectRegions2(local: string[], remote: string[]): Segment[] {
  // Build a single conflict segment per differing run by aligning local↔remote.
  const match = lcsMatch(local, remote);
  const segments: Segment[] = [];
  let li = 0;
  let ri = 0;
  let pendLocal: string[] = [];
  let pendRemote: string[] = [];

  const flush = (): void => {
    if (pendLocal.length === 0 && pendRemote.length === 0) return;
    segments.push({
      kind: "conflict",
      localRows: markConflict(pendLocal),
      remoteRows: markConflict(pendRemote),
      mergeLines: pendLocal.length > 0 ? pendLocal : pendRemote,
      conflictLocal: pendLocal,
      conflictRemote: pendRemote,
    });
    pendLocal = [];
    pendRemote = [];
  };

  while (li < local.length || ri < remote.length) {
    if (li < local.length && match.has(li)) {
      const rj = match.get(li) as number;
      while (ri < rj) {
        pendRemote.push(remote[ri]);
        ri++;
      }
      flush();
      segments.push(stableSegment([local[li]]));
      li++;
      ri++;
    } else if (li < local.length) {
      pendLocal.push(local[li]);
      li++;
    } else {
      pendRemote.push(remote[ri]);
      ri++;
    }
  }
  flush();
  return segments;
}

/** Whole-side add/delete (one side absent) → one conflict hunk. */
function addDeleteModel(detail: ConflictDetail): PaneModel {
  const localAbsent = detail.local === undefined;
  const localLines = splitLines(detail.local);
  const remoteLines = splitLines(detail.remote);

  const placeholder: DiffRow = {
    text: "(deleted on this side)",
    cls: "removed",
    conflictStart: true,
  };
  const localRows = localAbsent
    ? [placeholder]
    : localLines.map((text, i) => ({
        text,
        cls: "added" as const,
        ...(i === 0 ? { conflictStart: true } : {}),
      }));
  const remoteRows = localAbsent
    ? remoteLines.map((text, i) => ({
        text,
        cls: "added" as const,
        ...(i === 0 ? { conflictStart: true } : {}),
      }))
    : [placeholder];

  // Default keeps the SURVIVING side (the one with content) — rarely does the
  // user want the empty result. autoMerge stays === rebuildMerge([]).
  const defaultSide: "local" | "remote" = localAbsent ? "remote" : "local";
  const rebuildMerge = (choices: ReadonlyArray<"local" | "remote">): string =>
    (choices[0] ?? defaultSide) === "remote"
      ? (detail.remote ?? "")
      : (detail.local ?? "");
  const hunk: ConflictHunk = { localLines, remoteLines };
  return {
    localRows,
    remoteRows,
    autoMerge: rebuildMerge([]),
    hunkCount: 1,
    autoMergedCount: 0,
    hasConflict: true,
    hunks: [hunk],
    rebuildMerge,
  };
}

function buildFromSegments(segments: Segment[]): PaneModel {
  const localRows: DiffRow[] = [];
  const remoteRows: DiffRow[] = [];
  const hunks: ConflictHunk[] = [];
  let autoMergedCount = 0;

  for (const seg of segments) {
    localRows.push(...seg.localRows);
    remoteRows.push(...seg.remoteRows);
    if (seg.kind === "conflict") {
      hunks.push({
        localLines: seg.conflictLocal ?? [],
        remoteLines: seg.conflictRemote ?? [],
      });
    } else if (
      seg.kind === "local" ||
      seg.kind === "remote" ||
      seg.kind === "convergent"
    ) {
      autoMergedCount++;
    }
  }

  const rebuildMerge = (choices: ReadonlyArray<"local" | "remote">): string => {
    const out: string[] = [];
    let ci = 0;
    for (const seg of segments) {
      if (seg.kind === "conflict") {
        const choice = choices[ci] ?? "local";
        out.push(
          ...(choice === "remote"
            ? (seg.conflictRemote ?? [])
            : (seg.conflictLocal ?? [])),
        );
        ci++;
      } else {
        out.push(...seg.mergeLines);
      }
    }
    return out.join("\n");
  };

  return {
    localRows,
    remoteRows,
    autoMerge: rebuildMerge([]),
    hunkCount: hunks.length,
    autoMergedCount,
    hasConflict: hunks.length > 0,
    hunks,
    rebuildMerge,
  };
}

/**
 * Build the 3-pane diff model for one conflict. Picks the strategy from the
 * available versions: whole-side add/delete → one conflict hunk; common base
 * present → true 3-way; base GC'd → 2-way Local↔Remote fallback.
 */
export function buildPaneModel(detail: ConflictDetail): PaneModel {
  // Whole-side add/delete (one side entirely absent).
  if (detail.local === undefined || detail.remote === undefined) {
    return addDeleteModel(detail);
  }

  const local = splitLines(detail.local);
  const remote = splitLines(detail.remote);

  if (detail.base !== undefined) {
    const base = splitLines(detail.base);
    return buildFromSegments(collectRegions3(base, local, remote));
  }
  // No base — 2-way fallback.
  return buildFromSegments(collectRegions2(local, remote));
}
