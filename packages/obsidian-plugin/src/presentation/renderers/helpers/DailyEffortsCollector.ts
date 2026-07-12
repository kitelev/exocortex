import type { TFile } from "obsidian";
import type { IVaultAdapter, MetadataExtractor } from "@kitelev/exocortex-core";
import type { DailyEffortItem } from "../ExoLayoutRenderer";
import { DailyNoteHelpers } from "./DailyNoteHelpers";

/**
 * collectDayEfforts — gathers the efforts of a daily note's day for the
 * `daily-efforts-by-class` Layout blocks (RFC pn__DailyNote toggles, req
 * a38ac95b; `closed` axis added by req b2a33efc / issue #3781).
 *
 * Returns `null` when `file` is not a daily note (or no day can be derived) —
 * the renderer then renders the daily-efforts blocks empty. Otherwise returns
 * every effort that is EITHER in the day (`isEffortInDay` — start/end/planned)
 * OR closed on the day (`isEffortClosedInDay` — resolution/end), in vault
 * order, each stamped with `inDay` / `closedInDay` so the renderer can build
 * the class buckets from the `inDay` subset (ZERO regression to a38ac95b) and
 * the "closed" list from the `closedInDay` subset. A single O(n) scan feeds
 * both axes. A Trashed-only closure (resolution only, no start/end/planned) is
 * collected here via `closedInDay` and appears ONLY in the closed axis.
 *
 * Read-path is Obsidian-core only via `vaultAdapter` (no Node `fs`, no
 * `Platform` gate) — identical on desktop and mobile (Desktop↔Mobile parity).
 */
export function collectDayEfforts(
  file: TFile,
  vaultAdapter: IVaultAdapter,
  metadataExtractor: MetadataExtractor,
): DailyEffortItem[] | null {
  const info = DailyNoteHelpers.extractDailyNoteInfo(file, metadataExtractor);
  if (!info.isDailyNote || !info.day) {
    return null;
  }
  const day = info.day;
  const efforts: DailyEffortItem[] = [];
  for (const candidate of vaultAdapter.getAllFiles()) {
    const metadata = metadataExtractor.extractMetadata(candidate);
    const inDay = DailyNoteHelpers.isEffortInDay(metadata, day);
    const closedInDay = DailyNoteHelpers.isEffortClosedInDay(metadata, day);
    // Union: collect an effort relevant to the day on EITHER axis.
    if (!inDay && !closedInDay) continue;
    const label =
      typeof metadata.exo__Asset_label === "string" &&
      metadata.exo__Asset_label.trim().length > 0
        ? (metadata.exo__Asset_label as string)
        : candidate.basename;
    efforts.push({
      path: candidate.path,
      title: label,
      metadata,
      inDay,
      closedInDay,
    });
  }
  return efforts;
}
