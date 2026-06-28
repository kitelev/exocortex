import type { TFile } from "obsidian";
import type { IVaultAdapter, MetadataExtractor } from "@kitelev/exocortex-core";
import type { DailyEffortItem } from "../ExoLayoutRenderer";
import { DailyNoteHelpers } from "./DailyNoteHelpers";

/**
 * collectDayEfforts — gathers the efforts of a daily note's day for the
 * `daily-efforts-by-class` Layout blocks (RFC pn__DailyNote toggles, req
 * a38ac95b).
 *
 * Returns `null` when `file` is not a daily note (or no day can be derived) —
 * the renderer then renders the daily-efforts blocks empty. Otherwise returns
 * every effort whose timestamps fall in the day (`isEffortInDay`), in vault
 * order, as the minimal `{ path, title, metadata }` shape the partition needs.
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
    if (!DailyNoteHelpers.isEffortInDay(metadata, day)) continue;
    const label =
      typeof metadata.exo__Asset_label === "string" &&
      metadata.exo__Asset_label.trim().length > 0
        ? (metadata.exo__Asset_label as string)
        : candidate.basename;
    efforts.push({ path: candidate.path, title: label, metadata });
  }
  return efforts;
}
