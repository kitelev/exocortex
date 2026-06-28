/**
 * Palette registration for «Exocortex: Deduplicate uids» (#3676 — Desktop↔Mobile
 * Command Parity for `exosync dedup-uids`). Extracted so the id/name contract is
 * unit-testable (Obsidian persists hotkeys by command id — the id MUST stay
 * byte-exact across releases).
 *
 * Registered UNCONDITIONALLY on both platforms — the whole point of #3676 is
 * that a phone user, pointed at "run exosync dedup-uids" by the sync/resolver
 * dissonance messages, can act on it. No `Platform.isMobile` gating (the fix is
 * driven over `vault.adapter`, not Node `fs`).
 *
 * Obsidian renders the label as «Exocortex: Deduplicate uids».
 */

import type { DedupUidsCommands } from "./DedupUidsCommands";

/** Structural slice of `Plugin.addCommand` (no `obsidian` runtime import). */
export interface DedupUidsCommandRegistrar {
  addCommand(command: {
    id: string;
    name: string;
    callback: () => void;
  }): unknown;
}

export function registerDedupUidsCommand(
  plugin: DedupUidsCommandRegistrar,
  dedupCommands: DedupUidsCommands,
): void {
  plugin.addCommand({
    id: "exosync-dedup-uids",
    name: "Deduplicate uids",
    callback: () => {
      void dedupCommands.invokeDedup();
    },
  });
}
