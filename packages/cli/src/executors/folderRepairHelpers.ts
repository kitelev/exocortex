import path from "path";
import { extractAssetReference } from "@kitelev/exocortex-core";
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

/**
 * Resolve the co-location target folder for a NEW asset from its
 * `exo__Asset_isDefinedBy` value, using the same resolver as `apply
 * repair-folder` / `audit co-location` (RFC 0b7a2fad CR-1). Returns the
 * vault-relative folder where the asset should be placed, or `null` when
 * placement cannot be determined — fail-open by design, matching the audit's
 * skip-accounting:
 *   - missing / empty / non-string `isDefinedBy`  → null (empty-isDefinedBy)
 *   - `!`-prefixed reference (intentional anchor)  → null (bang-prefix)
 *   - reference that doesn't resolve in this vault → null (unresolvable)
 *
 * On `null`, the caller keeps its default folder (`01 Inbox`).
 *
 * The asset doesn't exist on disk yet, so an empty source path is passed to
 * {@link findReferencedFile}; this makes its "same folder as source" heuristic
 * (Try 2) probe only the vault root, which never spuriously matches a
 * UID-named ontology file living under `assetspaces/`. Resolution therefore
 * comes from the direct-path (Try 1), UID-index (Try 3) or basename-scan
 * (Try 4) branches — exactly as it does for `apply repair-folder`.
 *
 * A root-level ontology (`path.dirname` → ".") returns "" so the caller writes
 * to the vault root, matching FolderRepairExecutor's expected-folder convention.
 */
export async function resolveCoLocationFolder(
  fsAdapter: NodeFsAdapter,
  isDefinedBy: unknown,
): Promise<string | null> {
  const reference = extractAssetReference(isDefinedBy);
  if (!reference || reference.startsWith("!")) {
    return null;
  }

  const ontologyPath = await findReferencedFile(fsAdapter, reference, "");
  if (!ontologyPath) {
    return null;
  }

  const dir = path.dirname(ontologyPath);
  return dir === "." ? "" : dir;
}

/**
 * Resolve the co-location target folder for a NEW instance-asset by
 * CLASS-neighbour (issue #3934) — the fail-open successor to
 * {@link resolveCoLocationFolder} for the case where the asset's
 * `exo__Asset_isDefinedBy` yields no folder (bang-anchor `[[!kitelev]]` /
 * `[[!aiKnow]]`, empty, or unresolvable). Places the new asset next to its
 * EXISTING sibling instances of the same class, deriving the folder from where
 * instances already live — data-driven, with NO hardcoded class→folder map, so
 * the product obeys the co-location invariant itself rather than requiring an
 * explicit `--folder` (Andrey's design decision, #3934).
 *
 * A file is a sibling instance iff any value of its `exo__Instance_class`
 * (a string OR a YAML list) resolves via {@link extractAssetReference} (the
 * wikilink *target*) to the created asset's class UID OR its short-name label —
 * matching bare-uid `[[uid]]`, alias `[[uid|label]]`, and label `[[label]]`
 * forms uniformly. (The class-def file itself references the `exo__Class`
 * metaclass, never this class UID, so it is never a false sibling.)
 *
 * Returns the vault-relative folder holding the MOST sibling instances (the
 * canonical home; deterministic lexicographic tie-break), or `null` when the
 * class has no existing instances anywhere in the vault. A root-level majority
 * (`path.dirname` → ".") returns "" so the caller — whose truthiness check
 * mirrors {@link resolveCoLocationFolder} — keeps its `01 Inbox` default rather
 * than writing a brand-new asset to the vault root.
 *
 * This performs one full-vault frontmatter scan; it runs ONLY in the fail-open
 * branch (isDefinedBy already failed to resolve a folder), i.e. the rare
 * bang-anchor RFC/aiKnow create, so the cost is bounded to that path.
 */
export async function resolveNeighbourFolderByClass(
  fsAdapter: NodeFsAdapter,
  classUid: string,
  classLabel: string,
): Promise<string | null> {
  const targets = new Set<string>();
  if (classUid) targets.add(classUid);
  if (classLabel) targets.add(classLabel);
  if (targets.size === 0) {
    return null;
  }

  const allFiles = await fsAdapter.getMarkdownFiles();
  const folderCounts = new Map<string, number>();

  for (const file of allFiles) {
    let metadata: Record<string, unknown>;
    try {
      metadata = await fsAdapter.getFileMetadata(file);
    } catch {
      continue;
    }
    const rawClass = metadata["exo__Instance_class"];
    const refs = Array.isArray(rawClass) ? rawClass : [rawClass];
    const isSibling = refs.some((ref) => {
      const target = extractAssetReference(ref);
      return target !== null && targets.has(target);
    });
    if (!isSibling) {
      continue;
    }
    const dir = path.dirname(file);
    const folder = dir === "." ? "" : dir;
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }

  if (folderCounts.size === 0) {
    return null;
  }

  // Canonical home = the folder with the most sibling instances. Iterate in a
  // lexicographically-sorted order so ties resolve deterministically.
  let best: string | null = null;
  let bestCount = -1;
  const sorted = Array.from(folderCounts.entries()).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  for (const [folder, count] of sorted) {
    if (count > bestCount) {
      best = folder;
      bestCount = count;
    }
  }
  return best;
}
