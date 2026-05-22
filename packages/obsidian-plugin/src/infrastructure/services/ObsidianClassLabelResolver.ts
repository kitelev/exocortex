import type { App } from "obsidian";
import type { ClassLabelToUidResolver } from "exocortex";

/**
 * Issue #3220 — build a metadata-cache-backed {@link ClassLabelToUidResolver}.
 *
 * # Why this lives in the plugin layer
 *
 * `GroundingExecutor.executeCreateInstance` writes `exo__Instance_class` from
 * `grounding.targetClass`. In production cold-start, that value is label-form
 * (`"ems__Task"`) rather than UUID-canon (`"1b20a8f0-..."`) because the command
 * was resolved against a store lacking the class TBox file:
 *
 *   - `ExocmdFastResolver` (#3171) mini-store = open asset + `assetspaces/exocmd`
 *     only; the class TBox lives in `assetspaces/ems`.
 *   - the persisted binding cache (#3183) bakes the label and survives restart.
 *
 * `CommandResolver.findUidByLabel` (#3212) therefore returns null and the
 * grounding keeps the bare label — the production gap reproduced in the
 * 2026-05-22 UI smoke that motivated #3220.
 *
 * Obsidian's metadata cache, by contrast, is fully warm well before the user
 * can click a button — it is the always-available source for the reverse
 * label → UID lookup. `getFirstLinkpathDest` resolves the linkpath against both
 * filenames AND `aliases`, so the UUID-named class file (`1b20a8f0-...md` with
 * `aliases: [ems__Task]`) is found by its symbolic label. This mirrors the
 * forward UUID → label expansion already in `DynamicCommandButtonGroupBuilder.
 * extractAssetClasses` (#3141), only in the opposite direction.
 *
 * Returns `null` when the label resolves to no file, the file has no
 * `exo__Asset_uid`, or the metadata-cache API surface is unavailable —
 * `GroundingExecutor` then preserves its prior label-form output.
 */
export function createObsidianClassLabelResolver(
  app: App,
): ClassLabelToUidResolver {
  return (label: string): string | null => {
    const dest = app.metadataCache?.getFirstLinkpathDest?.(label, "");
    if (!dest) return null;
    const frontmatter = app.metadataCache?.getFileCache?.(dest)?.frontmatter;
    const uid = frontmatter?.["exo__Asset_uid"];
    return typeof uid === "string" && uid.length > 0 ? uid : null;
  };
}
