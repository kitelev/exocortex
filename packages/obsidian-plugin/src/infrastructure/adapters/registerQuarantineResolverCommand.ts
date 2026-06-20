/**
 * Palette registration for «Exocortex: Resolve sync conflicts» (finding
 * a0a3d1d6). Extracted so the id/name contract is unit-testable (Obsidian
 * persists hotkeys by command id — the id MUST stay byte-exact across releases).
 *
 * Obsidian renders the label as «Exocortex: Resolve sync conflicts».
 */

import type { QuarantineResolverCommands } from "./QuarantineResolverCommands";

/** Structural slice of `Plugin.addCommand` (no `obsidian` runtime import). */
export interface ResolverCommandRegistrar {
  addCommand(command: {
    id: string;
    name: string;
    callback: () => void;
  }): unknown;
}

export function registerQuarantineResolverCommand(
  plugin: ResolverCommandRegistrar,
  resolverCommands: QuarantineResolverCommands,
): void {
  plugin.addCommand({
    id: "exosync-resolve-conflicts",
    name: "Resolve sync conflicts",
    callback: () => {
      void resolverCommands.invokeResolve();
    },
  });
}
