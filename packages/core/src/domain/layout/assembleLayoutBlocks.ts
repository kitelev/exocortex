/**
 * assembleLayoutBlocks — build each Layout's ordered block list from the
 * blocks that name it (RFC 9821a379 decision 3, «развернуть по UWI»).
 *
 * The link points block → Layout: a block carries `exo__LayoutBlock_layout`
 * (→ its Layout) and optionally `exo__LayoutBlock_order`. A Layout no longer
 * lists its blocks (`exo__Layout_blocks` is not read). This function is the
 * single place that inverts the link:
 *
 *   - a block belongs to the Layout its `exo__LayoutBlock_layout` TARGET
 *     names (the part before `|`; the display text is ignored) — matched by
 *     the Layout's uid, its file basename, or its label;
 *   - a target that names MORE than one Layout (a label two Layouts share)
 *     attaches to none (warn) — an ambiguous link is not guessed;
 *   - order: `exo__LayoutBlock_order` ASC; blocks without an order go after
 *     the numbered ones; ties (and the unordered tail) by block uid ASC;
 *   - a Layout that no block names is dropped (warn) — «Layout без блоков не
 *     выбирается», so `LayoutSelector` never sees it.
 *
 * Pure: inputs are not mutated; Layouts come back as new objects with
 * `blocks` = block uids in render order (the form `ExoLayoutRenderer`
 * resolves against `blocksByUid`).
 *
 * @module domain/layout
 */

import type { Layout } from "./Layout";
import type { LayoutBlock } from "./LayoutBlock";

function basename(path: string): string {
  const last = path.lastIndexOf("/");
  const file = last >= 0 ? path.slice(last + 1) : path;
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(0, dot) : file;
}

function compareBlocks(a: LayoutBlock, b: LayoutBlock): number {
  if (a.order !== null && b.order !== null && a.order !== b.order) {
    return a.order - b.order;
  }
  if (a.order !== null && b.order === null) return -1;
  if (a.order === null && b.order !== null) return 1;
  if (a.uid < b.uid) return -1;
  if (a.uid > b.uid) return 1;
  return 0;
}

export function assembleLayoutBlocks(
  layouts: readonly Layout[],
  blocks: readonly LayoutBlock[],
  warn: (message: string) => void = () => {},
): Layout[] {
  const byKey = new Map<string, Set<number>>();
  const index = (key: string, at: number): void => {
    if (key.length === 0) return;
    let set = byKey.get(key);
    if (set === undefined) {
      set = new Set();
      byKey.set(key, set);
    }
    set.add(at);
  };
  layouts.forEach((layout, at) => {
    index(layout.uid, at);
    index(basename(layout.sourcePath), at);
    index(layout.label, at);
  });

  const members: LayoutBlock[][] = layouts.map(() => []);
  for (const block of blocks) {
    const ref = block.layoutRef;
    if (ref === null) continue;
    const targets = new Set<number>(byKey.get(ref) ?? []);
    if (targets.size === 0) {
      warn(
        `LayoutBlock ${block.uid}: exo__LayoutBlock_layout names no known Layout ("${ref}", ${block.sourcePath})`,
      );
      continue;
    }
    if (targets.size > 1) {
      warn(
        `LayoutBlock ${block.uid}: exo__LayoutBlock_layout "${ref}" names ${targets.size} Layouts — attached to none (${block.sourcePath})`,
      );
      continue;
    }
    const [at] = targets;
    members[at].push(block);
  }

  const out: Layout[] = [];
  layouts.forEach((layout, at) => {
    const own = members[at];
    if (own.length === 0) {
      warn(
        `Layout ${layout.uid}: no exo__LayoutBlock names this Layout through exo__LayoutBlock_layout — the Layout is not selected (exo__Layout_blocks is no longer read) (${layout.sourcePath})`,
      );
      return;
    }
    const ordered = [...own].sort(compareBlocks).map((b) => b.uid);
    out.push({ ...layout, blocks: ordered });
  });
  return out;
}
