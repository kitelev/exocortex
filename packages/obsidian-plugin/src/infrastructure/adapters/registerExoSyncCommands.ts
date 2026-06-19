/**
 * Palette registration for the ExoSync command set (RFC 4e4dc453 Phase B/E
 * + Issue #3473). Extracted from `ExocortexPlugin.onload` so the
 * registration contract is unit-testable: ids/names of the pre-existing
 * commands MUST stay byte-exact (Obsidian persists hotkeys by command id),
 * and «Sync» MUST stay first — it is the default/primary cycle; the split
 * «Pull» / «Push» commands are advanced ergonomics, not a replacement.
 *
 * Obsidian renders palette labels as "<plugin name>: <command name>", so
 * the names below surface as «Exocortex: Sync» / «Exocortex: Pull» /
 * «Exocortex: Push» / «Exocortex: Check sync status» (the parity report,
 * de-jargoned per RFC 0002 §3.2 P3).
 */

import type { SyncCommands } from "./SyncCommands";
import { GROOMED_COMMAND_NAMES } from "@plugin/application/services/commandPaletteContract";

/**
 * Structural slice of Obsidian's `Plugin.addCommand` — keeps this module
 * free of an `obsidian` runtime import (unit-testable with a plain object).
 */
export interface ExoSyncCommandRegistrar {
  addCommand(command: {
    id: string;
    name: string;
    callback: () => void;
  }): unknown;
}

export function registerExoSyncCommands(
  plugin: ExoSyncCommandRegistrar,
  syncCommands: SyncCommands,
): void {
  // ExoSync Phase B (RFC 4e4dc453) — manual sync of the materialized
  // AssetSpace set over requestUrl (works on BOTH platforms; the point is
  // iOS, where no git binary exists). Registered unconditionally: with no
  // PAT the handler surfaces the R8 "configure PAT" prompt instead of
  // hiding the command.
  plugin.addCommand({
    id: "exosync-sync",
    name: "Sync",
    callback: () => {
      void syncCommands.invokeSync();
    },
  });

  // Issue #3473 — split directions NEXT TO the default Sync. Pull applies
  // remote changes only (safe read — nothing leaves the device); Push sends
  // the local delta only (remote changes pinned to re-derive). All three
  // share one D11 running flag inside SyncCommands.
  plugin.addCommand({
    id: "exosync-pull",
    name: "Pull",
    callback: () => {
      void syncCommands.invokePull();
    },
  });
  plugin.addCommand({
    id: "exosync-push",
    name: "Push",
    callback: () => {
      void syncCommands.invokePush();
    },
  });

  // ExoSync Phase E (RFC 4e4dc453, E1) — standalone M1/M2 parity report
  // over the same materialized set (the post-sync round runs automatically
  // after a full Sync; this command is the on-demand probe — also the
  // manual divergence check for split-only usage, which skips the round).
  // RFC 0002 §3.2 (P3) — de-jargon: «Sync parity report» → «Check sync status».
  // Sourced from the palette grooming contract so production + test never drift.
  plugin.addCommand({
    id: "exosync-parity-report",
    name: GROOMED_COMMAND_NAMES["exosync-parity-report"],
    callback: () => {
      void syncCommands.invokeParityReport();
    },
  });
}
