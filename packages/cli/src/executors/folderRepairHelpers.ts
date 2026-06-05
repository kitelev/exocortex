import path from "path";
import type { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Shared CLI-side folder-repair helpers. Consumed by both
 * `FolderRepairExecutor` (single-file `repair-folder` command) and
 * `BatchExecutor` (batch `repair-folder` operation). Previously duplicated in
 * each executor (audit #3384 finding H4).
 *
 * These implement the CLI's Node-fs reference-resolution strategy, which is
 * deliberately distinct from the plugin/grounding path (core
 * `FolderRepairService` → `IVaultAdapter.getFirstLinkpathDest`). That
 * divergence is pre-existing and intentionally NOT unified here — this change
 * is a pure dedup, not a behavior change.
 */

/**
 * Resolve a `exo__Asset_isDefinedBy` reference to the vault-relative path of
 * the referenced asset. Tries, in order:
 *   1. direct path (when the reference contains a `/`)
 *   2. same folder as the source file
 *   3. UID index lookup (`findFileByUID`)
 *   4. basename scan across all markdown files
 * Returns `null` when none match.
 */
export async function findReferencedFile(
  fsAdapter: NodeFsAdapter,
  reference: string,
  sourceFilePath: string,
): Promise<string | null> {
  // Normalize reference (add .md extension if not present)
  const normalizedRef = reference.endsWith(".md")
    ? reference
    : `${reference}.md`;

  // Try 1: Direct path (if reference looks like a path)
  if (reference.includes("/")) {
    const exists = await fsAdapter.fileExists(normalizedRef);
    if (exists) {
      return normalizedRef;
    }
  }

  // Try 2: Same folder as source file. `path.dirname` returns "." for a
  // root-level source; both prior copies resolved identically here —
  // FolderRepairExecutor produced "./<ref>.md" and BatchExecutor produced
  // "<ref>.md", which `NodeFsAdapter.resolvePath` (path.join) and the
  // downstream `path.dirname` collapse to the same value.
  const sourceDir = path.dirname(sourceFilePath);
  const sameFolderPath =
    sourceDir !== "." ? `${sourceDir}/${normalizedRef}` : normalizedRef;
  const sameFolderExists = await fsAdapter.fileExists(sameFolderPath);
  if (sameFolderExists) {
    return sameFolderPath;
  }

  // Try 3: Search by UID
  const uidPath = await fsAdapter.findFileByUID(reference);
  if (uidPath) {
    return uidPath;
  }

  // Try 4: Search by filename across vault
  const allFiles = await fsAdapter.getMarkdownFiles();
  const matchingFile = allFiles.find((file) => {
    const baseName = path.basename(file, ".md");
    const refBaseName = path.basename(normalizedRef, ".md");
    return baseName === refBaseName;
  });

  return matchingFile || null;
}

/**
 * Normalize a vault-relative path for equality comparison: backslashes → `/`,
 * strip a leading `./`, strip a trailing `/`.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}
