/**
 * Generic 3-way sequence merge (classic diff3) over string arrays
 * (RFC 4e4dc453 A2 — D21 building block).
 *
 * Alignment is LCS-based (base↔local, base↔remote); stable elements (matched
 * in BOTH pairings) anchor the walk. For each unstable region between
 * anchors:
 *
 *  - local == base   → take remote
 *  - remote == base  → take local
 *  - local == remote → take either (convergent)
 *  - otherwise       → CONFLICT (no auto-resolution — D1: unresolvable goes
 *                      to quarantine, never guessed)
 *
 * Sequence sizes here are paragraphs/sections of one markdown asset, so the
 * O(n·m) LCS table is perfectly fine.
 */

export type Diff3Result =
  | { ok: true; merged: string[] }
  | {
      ok: false;
      /** Conflicting slices, for diagnostics/quarantine messages. */
      conflict: { base: string[]; local: string[]; remote: string[] };
    };

/** Monotonic LCS pairing: index in `a` → index in `b`. */
function lcsMatch(a: readonly string[], b: readonly string[]): Map<number, number> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] / b[j..]
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

/** 3-way merge of `local` and `remote` against their common `base`. */
export function diff3(
  base: readonly string[],
  local: readonly string[],
  remote: readonly string[],
): Diff3Result {
  const ml = lcsMatch(base, local);
  const mr = lcsMatch(base, remote);

  const merged: string[] = [];
  let bi = 0;
  let li = 0;
  let ri = 0;

  for (;;) {
    // Next base index anchored in BOTH pairings.
    let anchor = bi;
    while (
      anchor < base.length &&
      !(ml.has(anchor) && mr.has(anchor))
    ) {
      anchor++;
    }
    const lEnd = anchor < base.length ? (ml.get(anchor) as number) : local.length;
    const rEnd = anchor < base.length ? (mr.get(anchor) as number) : remote.length;

    const baseChunk = base.slice(bi, anchor);
    const localChunk = local.slice(li, lEnd);
    const remoteChunk = remote.slice(ri, rEnd);

    const localChanged = !sliceEq(localChunk, baseChunk);
    const remoteChanged = !sliceEq(remoteChunk, baseChunk);
    if (!localChanged && !remoteChanged) {
      merged.push(...baseChunk);
    } else if (!localChanged) {
      merged.push(...remoteChunk);
    } else if (!remoteChanged) {
      merged.push(...localChunk);
    } else if (sliceEq(localChunk, remoteChunk)) {
      merged.push(...localChunk); // convergent edit
    } else {
      return {
        ok: false,
        conflict: { base: baseChunk, local: localChunk, remote: remoteChunk },
      };
    }

    if (anchor >= base.length) break;
    merged.push(base[anchor]); // stable element
    bi = anchor + 1;
    li = lEnd + 1;
    ri = rEnd + 1;
  }

  return { ok: true, merged };
}
