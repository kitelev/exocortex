/**
 * Link text of an IRI cell in the `query-table` block (RFC 9821a379 AC5,
 * ticket 058bad52): the asset's DISPLAY NAME — the homoiconic
 * `exo__DisplayNameSpec` system, built exactly as the Relations table builds it
 * (`RelationsRenderer.createDisplayNameResolver`), so the same asset reads the
 * same in both tables (status/class prefix included).
 *
 * `null` when the path is not an existing vault file: the cell is then plain
 * text, never a link — `openLinkText` on a missing path would CREATE a note.
 */
import { TFile } from "obsidian";
import type { ExocortexPluginInterface, ObsidianApp } from "@plugin/types";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import {
  createQueryTableProvider,
  type QueryTableLinkText,
  type QueryTableProvider,
  type QueryTableProviderDeps,
} from "./QueryTableProvider";

export function createObsidianQueryTableLinkText(
  app: ObsidianApp,
  plugin: Pick<ExocortexPluginInterface, "printNameRuleService" | "settings">,
): QueryTableLinkText {
  const ruleService = plugin.printNameRuleService ?? null;
  const settings =
    plugin.settings?.displayNameSettings ?? DEFAULT_DISPLAY_NAME_SETTINGS;
  const resolver = new DisplayNameResolver(
    settings,
    ruleService,
    ruleService?.createMetadataResolver() ?? null,
  );
  return (vaultPath) => {
    const file = app.vault.getAbstractFileByPath(vaultPath);
    if (!(file instanceof TFile)) return null;
    const frontmatter = (app.metadataCache.getFileCache(file)?.frontmatter ??
      {}) as Record<string, unknown>;
    const rawLabel = frontmatter["exo__Asset_label"];
    const label =
      typeof rawLabel === "string" && rawLabel.trim() !== ""
        ? rawLabel
        : file.basename;
    return (
      resolver.resolve({
        metadata: { ...frontmatter, exo__Asset_label: label },
        basename: file.basename,
      }) ?? label
    );
  };
}

/**
 * The plugin's `query-table` provider (ticket 058bad52): the shared runner, the
 * query's label from the same uid index as its body, link text from the
 * Relations display-name resolver. One factory so the wiring is testable.
 */
export function createObsidianQueryTableProvider(deps: {
  readonly app: ObsidianApp;
  readonly plugin: Pick<
    ExocortexPluginInterface,
    "printNameRuleService" | "settings"
  >;
  readonly runner: QueryTableProviderDeps["runner"];
  readonly queryLabels: { resolveLabel(queryUid: string): string | null };
}): QueryTableProvider {
  return createQueryTableProvider({
    runner: deps.runner,
    queryLabel: (uid) => deps.queryLabels.resolveLabel(uid),
    createLinkText: () =>
      createObsidianQueryTableLinkText(deps.app, deps.plugin),
  });
}
