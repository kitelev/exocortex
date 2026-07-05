import {
  hasEmptyProperties,
  type HostFunction,
  type IFile,
  type IVaultAdapter,
} from "@kitelev/exocortex-core";

/**
 * CLI counterpart of the plugin's
 * `obsidian-plugin/src/infrastructure/precondition/createHasEmptyPropertiesHostFunction.ts`.
 *
 * Returns `true` only when the asset referenced by `ctx.filePath` has at least
 * one EMPTY frontmatter property — a value that is `null`/`undefined`, an empty
 * string (after trim), an empty array, or an empty object — exactly the
 * properties `PropertyCleanupService.cleanEmptyProperties` removes. Used by the
 * homoiconic "Clean Properties" exocmd command (vault asset
 * `0da175e1-79e3-46b8-975b-adadeb40887a`) to keep
 * `npx exocortex-cli apply clean-properties <path>` from running on assets that
 * have nothing to clean.
 *
 * Fail-closed on missing context, missing file, or unreadable frontmatter —
 * mirrors the plugin factory's contract so visible/invocable gating is
 * symmetric between surfaces.
 */
export function createHasEmptyPropertiesHostFunction(
  vaultAdapter: IVaultAdapter,
): HostFunction {
  return (ctx) => {
    const filePath =
      typeof ctx.filePath === "string" && ctx.filePath.length > 0
        ? ctx.filePath
        : null;
    if (filePath === null) return false;

    const node = vaultAdapter.getAbstractFileByPath(filePath);
    if (node === null || !("basename" in node)) return false;
    const file = node as IFile;

    const metadata =
      (vaultAdapter.getFrontmatter(file) as Record<string, unknown> | null) ??
      {};

    return hasEmptyProperties(metadata);
  };
}
