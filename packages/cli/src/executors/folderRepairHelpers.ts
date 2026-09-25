import path from "path";
import { extractAssetReference } from "@kitelev/exocortex-core";
import type { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Shared CLI-side folder-repair helpers. Consumed by the `audit-*` / `create` /
 * `set-property` commands and `isDefinedByRangeGuard`. Previously duplicated
 * across executors (audit #3384 finding H4; the batch `repair-folder` copy went
 * with the dead `BatchExecutor`, ticket 99a904a9, and the single-file copy's
 * consumer `FolderRepairExecutor` with the dead `CommandExecutor` family, task
 * 94e64b8c).
 *
 * ⛔ `apply repair-folder` does NOT go through these helpers: its grounding is
 * `service_call` → `repairFolder` → core `FolderRepairService`, which resolves
 * `exo__Asset_isDefinedBy` via `IVaultAdapter.getFirstLinkpathDest`.
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
  // root-level source; both prior copies resolved identically here — the
  // (since removed) FolderRepairExecutor produced "./<ref>.md" and the batch
  // copy produced "<ref>.md", which `NodeFsAdapter.resolvePath` (path.join)
  // and the downstream `path.dirname` collapse to the same value.
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
 * (Try 4) branches.
 *
 * A root-level ontology (`path.dirname` → ".") returns "" so the caller writes
 * to the vault root — the same convention core `FolderRepairService.repairFolder`
 * uses for `expectedFolder === ""`.
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
  return coLocationFolderFromPath(ontologyPath);
}

/**
 * The co-location folder for an ALREADY-RESOLVED ontology path — the tail half of
 * {@link resolveCoLocationFolder}, split out so a caller that has already paid for
 * the resolution does not pay for it twice.
 *
 * ⛤ Why it is exported: `findReferencedFile`'s last resort scans every markdown
 * file in the vault and parses its frontmatter, so a second resolution of the SAME
 * reference is not free — measured at roughly the cost of the first (~1.0x). The
 * isDefinedBy range guard resolves the anchor to read its class; `cli create` then
 * needs the same anchor's folder, and feeds the guard's result in here instead of
 * resolving again.
 */
export function coLocationFolderFromPath(
  ontologyPath: string | null,
): string | null {
  if (!ontologyPath) {
    return null;
  }
  const dir = path.dirname(ontologyPath);
  return dir === "." ? "" : dir;
}

/**
 * Resolve the wikilink *target* of a single frontmatter reference to a
 * comparable token, robust to how YAML parsed it. A QUOTED wikilink
 * (`"[[uid|label]]"`) parses to a string and goes straight through
 * {@link extractAssetReference}. An UNQUOTED wikilink (`[[uid]]` / `- [[uid]]`)
 * is treated by YAML as a nested flow-sequence and parses to a nested array
 * (`["uid"]` / `[["uid"]]`) whose innermost string is the already-bracket-
 * stripped linkpath — so descend to that string first, then run the same
 * extractor (which also strips a `|alias` suffix). Returns null for anything
 * that doesn't reduce to a string. Used for both `exo__Instance_class` refs and
 * the `exo__Asset_isDefinedBy` anchor.
 */
function wikilinkTarget(ref: unknown): string | null {
  let cur: unknown = ref;
  while (Array.isArray(cur)) {
    if (cur.length === 0) {
      return null;
    }
    cur = cur[0];
  }
  return extractAssetReference(cur);
}

/**
 * Both sibling populations of a class, produced by one vault scan
 * ({@link scanClassNeighbours}). Kept as a pair so the fail-open diagnostic
 * quotes the very counts the placement decision was taken on.
 */
export interface ClassNeighbourScan {
  /**
   * Folders holding siblings of the class that ALSO share the new asset's
   * isDefinedBy anchor — the population priority-2 places by.
   */
  sameAnchor: Map<string, number>;
  /**
   * Folders holding siblings of the class under ANY anchor. Superset of
   * {@link sameAnchor}; used ONLY for the fail-open diagnostic (a class whose
   * instances demonstrably live somewhere, while THIS create lands in the
   * inbox default, means the placement was decided by the absence of an
   * anchor — not by the class having no home).
   */
  anyAnchor: Map<string, number>;
}

/**
 * One full-vault frontmatter scan producing BOTH sibling populations of a class
 * (issue #3934 for the placement, 3f8b640f for the diagnostic). One pass, two
 * answers: the diagnostic is DERIVED from the very scan that decides placement
 * rather than authored next to it, so the numbers printed can never drift from
 * the numbers the decision used.
 *
 * A file is a `sameAnchor` sibling iff BOTH:
 *   1. any value of its `exo__Instance_class` (a string OR a YAML list) resolves
 *      via {@link wikilinkTarget} to the created asset's class UID OR its
 *      short-name label — matching bare-uid `[[uid]]`, alias `[[uid|label]]`,
 *      and label `[[label]]` forms uniformly (the class-def file references the
 *      `exo__Class` metaclass, never this class UID, so it is never a false
 *      sibling); AND
 *   2. its `exo__Asset_isDefinedBy` resolves to the SAME anchor as the new
 *      asset's (`newAnchor` = {@link wikilinkTarget} of the new isDefinedBy,
 *      e.g. `!kitelev` / `!aiKnow`, or null for an empty isDefinedBy).
 *
 * `anyAnchor` drops requirement 2 — it is every home of the class, and feeds
 * ONLY the diagnostic.
 *
 * The anchor is the audience/home signal: a single class can span multiple
 * homes (e.g. `inbox__ExoAssistantKnowledge` is used both for RFCs anchored
 * `[[!kitelev]]` living in `exoas-exodev/inbox/` AND for ExoAssistant infra
 * knowledge anchored to the resolvable `$exoass` ontology living in
 * `exoas-exoass/exoass/`). Matching class ALONE would let the larger,
 * differently-anchored population outvote the true neighbours; matching class
 * AND the same anchor selects exactly the assets whose placement was governed
 * by the same (unresolvable/bang) anchor as the new one. The
 * resolvable-isDefinedBy assets co-located via priority-1 never share a bang
 * anchor, so they are excluded.
 *
 * Runs ONLY in the fail-open branch (isDefinedBy already failed to resolve a
 * folder), so the cost is bounded to the rare bang-anchor RFC/aiKnow create.
 */
export async function scanClassNeighbours(
  fsAdapter: NodeFsAdapter,
  classUid: string,
  classLabel: string,
  isDefinedBy: unknown,
): Promise<ClassNeighbourScan> {
  const empty: ClassNeighbourScan = {
    sameAnchor: new Map(),
    anyAnchor: new Map(),
  };
  const targets = new Set<string>();
  if (classUid) targets.add(classUid);
  if (classLabel) targets.add(classLabel);
  if (targets.size === 0) {
    return empty;
  }
  // The new asset's audience anchor (`!kitelev` / `!aiKnow` / an unresolvable
  // uid, or null for empty). Only siblings sharing this exact anchor count.
  const newAnchor = wikilinkTarget(isDefinedBy);

  const allFiles = await fsAdapter.getMarkdownFiles();
  const folderCounts = new Map<string, number>();
  const anyAnchorCounts = new Map<string, number>();

  for (const file of allFiles) {
    let metadata: Record<string, unknown>;
    try {
      metadata = await fsAdapter.getFileMetadata(file);
    } catch {
      continue;
    }
    // 1. class matches (any wikilink form, list-aware).
    const rawClass = metadata["exo__Instance_class"];
    const refs = Array.isArray(rawClass) ? rawClass : [rawClass];
    const isSibling = refs.some((ref) => {
      const target = wikilinkTarget(ref);
      return target !== null && targets.has(target);
    });
    if (!isSibling) {
      continue;
    }
    const dir = path.dirname(file);
    const folder = dir === "." ? "" : dir;
    anyAnchorCounts.set(folder, (anyAnchorCounts.get(folder) ?? 0) + 1);
    // 2. same isDefinedBy anchor as the new asset.
    if (wikilinkTarget(metadata["exo__Asset_isDefinedBy"]) !== newAnchor) {
      continue;
    }
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }

  return { sameAnchor: folderCounts, anyAnchor: anyAnchorCounts };
}

/**
 * Canonical home = the vault-relative folder holding the MOST siblings of the
 * given population; ties resolve lexicographically, so the answer is
 * deterministic. Returns `null` for an empty population.
 *
 * A root-level majority (`path.dirname` → ".") is recorded as "" so the caller —
 * whose truthiness check mirrors {@link resolveCoLocationFolder} — keeps its
 * `01 Inbox` default rather than writing to the vault root.
 */
export function pickCanonicalHome(
  folderCounts: Map<string, number>,
): string | null {
  if (folderCounts.size === 0) {
    return null;
  }

  // Canonical home = the folder with the most siblings. Iterate in a
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

/**
 * The pre-3f8b640f placement contract (`folder | null`), preserved verbatim as
 * a thin composition of {@link scanClassNeighbours} and
 * {@link pickCanonicalHome}.
 *
 * ⛔ It has NO production caller since 3f8b640f — `create` needs both
 * populations and therefore calls the two halves directly. It is kept as the
 * named statement of the #3934 contract, and `folderRepairHelpers.test.ts`
 * asserts it stays byte-equal to that composition, so the claim can go red
 * instead of merely being written down.
 */
export async function resolveNeighbourFolderByClass(
  fsAdapter: NodeFsAdapter,
  classUid: string,
  classLabel: string,
  isDefinedBy: unknown,
): Promise<string | null> {
  const { sameAnchor } = await scanClassNeighbours(
    fsAdapter,
    classUid,
    classLabel,
    isDefinedBy,
  );
  return pickCanonicalHome(sameAnchor);
}
