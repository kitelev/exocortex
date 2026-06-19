/**
 * Palette registration for the «Exocortex: Refresh link labels» command
 * (Веха 1 / MVP, WBS `844ced36`). Extracted from `ExocortexPlugin.onload` so
 * the registration contract is unit-testable: the command id MUST stay
 * byte-exact (Obsidian persists hotkeys by command id).
 *
 * Obsidian renders palette labels as "<plugin name>: <command name>", so the
 * name `Refresh link labels` surfaces as «Exocortex: Refresh link labels».
 *
 * Registered UNCONDITIONALLY (no `Platform.isMobile` gate): the handler is a
 * pure in-memory re-resolve (index refresh + editor-view reconfigure + layout
 * re-render) with no Node `fs` / git dependency, so it works identically on
 * desktop and mobile (Desktop↔Mobile Command Parity invariant).
 */

import type { LinkLabelRefreshService } from "@plugin/application/services/LinkLabelRefreshService";

/**
 * Structural slice of Obsidian's `Plugin.addCommand` — keeps this module free
 * of an `obsidian` runtime import (unit-testable with a plain object).
 */
export interface RefreshLinkLabelsCommandRegistrar {
  addCommand(command: {
    id: string;
    name: string;
    callback: () => void;
  }): unknown;
}

export function registerRefreshLinkLabelsCommand(
  plugin: RefreshLinkLabelsCommandRegistrar,
  service: LinkLabelRefreshService,
): void {
  plugin.addCommand({
    id: "refresh-link-labels",
    name: "Refresh link labels",
    callback: () => {
      // Fire-and-forget: refresh() is graceful (never throws, never shows a
      // Notice), so the palette callback needs no error handling.
      void service.refresh();
    },
  });
}
