import { TFile, type App } from "obsidian";
import { hasEmptyProperties, type HostFunction } from "@kitelev/exocortex-core";

/**
 * Factory for the `hasObsoleteProperties` precondition host function used by
 * the homoiconic exocmd "Clean Properties" command (vault asset
 * `0da175e1-79e3-46b8-975b-adadeb40887a`). Returns `true` only when the
 * target asset's frontmatter contains at least one EMPTY property — a value
 * that is `null`/`undefined`, an exactly-empty string `""` (a quoted
 * whitespace-only value is kept), an empty array (or a block-form list of
 * all-empty items), or an empty object — exactly the properties the
 * `cleanProperties` service (`PropertyCleanupService.cleanEmptyProperties`) removes.
 *
 * Hides the inline button + the Cmd+P palette entry on assets that have no
 * empty properties to clean. Without this registration
 * `PreconditionEvaluator.evaluateHostFunction` fails open (`return true`) on
 * the async inline-button path and the button would show on EVERY asset —
 * the exact bug this closes. Mirrors the `isInWrongFolder` / "Repair Folder"
 * wiring (`createIsInWrongFolderHostFunction`, Issue #3302).
 *
 * The host-function NAME is the legacy `hasObsoleteProperties` baked into the
 * precondition asset (`79a7fb4b`); keeping that name means the fix reaches the
 * user on a plain plugin update with no re-sync of the `exoas-exocmd`
 * assetspace. The behaviour it computes is "has empty frontmatter values",
 * delegated to the pure core `hasEmptyProperties` helper.
 *
 * Falls back to `false` (hide) whenever the file or its frontmatter cannot be
 * resolved — fail-closed for consistency with the other exocmd host gates.
 */
export function createHasEmptyPropertiesHostFunction(app: App): HostFunction {
  return (ctx) => {
    const filePath =
      typeof ctx.filePath === "string" && ctx.filePath.length > 0
        ? ctx.filePath
        : null;
    if (filePath === null) return false;

    // Templater templates (09 Templates/) carry exo__Asset_isDefinedBy by
    // pattern inheritance but are NOT assets and must never be cleaned — never
    // surface this destructive command on them (mirror
    // createIsInWrongFolderHostFunction + co-location-enforce hook exclusion,
    // RFC 0b7a2fad CR-1).
    if (filePath.split("/").includes("09 Templates")) return false;

    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return false;

    const metadata =
      (app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined) ?? {};

    return hasEmptyProperties(metadata);
  };
}
