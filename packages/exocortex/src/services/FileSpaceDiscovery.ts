/**
 * FileSpace discovery — RDF-declaration-driven indexer exclusions
 * (onto-RFC 18808c73 Phase 5, ExoSync RFC 4e4dc453 Phase C).
 *
 * An `exo__FileSpace` is a git-backed space of OPAQUE file blobs: the RDF
 * indexer must skip its content (no parsing, no triple store, no SHACL).
 * Which spaces are filespaces is declared in the vault (homoiconicity Q1):
 * a FileSpace declaration is an ordinary `.md` asset whose
 * `exo__Instance_class` references the `exo__FileSpace` class. This module
 * turns those declarations into folder-exclusion prefixes — the SAME
 * mechanism `convertVaultWithValidation` already applies to user-configured
 * `excludedFolders` — so the skip is derived from `rdf:type`, never from
 * hardcoded paths (R3 of the onto-RFC).
 *
 * Class identity is the frozen class UID (same precedent as
 * `ASSET_SPACE_CLASS_UID` in the plugin's AssetSpace detection): a
 * UUID-form `[[<uid>]]` wikilink matches directly; a non-UUID wikilink
 * target (e.g. a label-named link) is resolved through the adapter's link
 * resolver and matches when the destination's `exo__Asset_uid` is the
 * FileSpace class UID. No subclass walk — `exo__AssetSpace` and
 * `exo__FileSpace` are the two leaf subtypes of `exo__Space` (D13).
 *
 * The mount folder is derived from the declaration's
 * `exo__AssetSpace_source` (dual-read `?? _git`, domain-widened onto
 * `exo__Space` by the onto-RFC) via {@link derivePath} —
 * `assetspaces/<owner>/<repo>` — mirroring the sync layer's
 * `collectSyncRepoSpecs`. Declarations without a derivable mount produce a
 * warning and exclude nothing (fail-open: better to index too much than to
 * silently drop user content from the graph).
 *
 * Convention: the declaration itself lives OUTSIDE its mount folder (like
 * AssetSpace ABox instances). A declaration inside its own mount would be
 * excluded together with the content (chicken-and-egg) — detected and
 * surfaced as a warning.
 */

import type {
  IVaultFileReader,
  IVaultFrontmatterManager,
  IVaultLinkResolver,
} from "../interfaces/IVaultAdapter";
import { derivePath } from "./AssetSpacePathDeriver";

/**
 * Class UID of `exo__FileSpace` (TBox: exoas-exo, onto-RFC 18808c73).
 * Frozen by the onto-RFC — same precedent as the plugin's
 * `ASSET_SPACE_CLASS_UID` (`73bd00e4-…`).
 */
export const FILE_SPACE_CLASS_UID = "aad8913e-5e9f-4047-879d-93cc46befd52";

/** Wikilink — captures the target (UUID or label form), ignores the alias. */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The minimal adapter surface discovery needs (ISP — see IVaultAdapter). */
export type FileSpaceDiscoveryVault = Pick<IVaultFileReader, "getAllFiles"> &
  Pick<IVaultFrontmatterManager, "getFrontmatter"> &
  IVaultLinkResolver;

export interface FileSpaceDiscoveryResult {
  /**
   * Folder-exclusion prefixes (trailing slash) for every FileSpace whose
   * mount path could be derived. Feed alongside user `excludedFolders`.
   */
  prefixes: string[];
  /** Vault paths of the FileSpace declaration assets themselves. */
  declarationPaths: string[];
  /** Non-fatal anomalies (no source, underivable mount, self-inclusion). */
  warnings: string[];
}

function wikilinkTargets(value: unknown): string[] {
  const candidates: unknown[] = Array.isArray(value) ? value : [value];
  const targets: string[] = [];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(c)) !== null) {
      targets.push(m[1].trim());
    }
  }
  return targets;
}

/**
 * Cheap pure probe: does this frontmatter declare `exo__FileSpace`
 * membership via a UUID-form `exo__Instance_class` wikilink? Used by
 * per-event handlers (plugin live-edit path) where resolving label-form
 * links would be too heavy — full walks use
 * {@link discoverFileSpaceExclusions}, which also resolves label form.
 */
export function frontmatterDeclaresFileSpace(
  fm: Record<string, unknown> | null | undefined,
): boolean {
  if (!fm) return false;
  return wikilinkTargets(fm["exo__Instance_class"]).some(
    (t) => UUID_RE.test(t) && t.toLowerCase() === FILE_SPACE_CLASS_UID,
  );
}

/**
 * Best-effort frontmatter read: discovery runs BEFORE the converter's
 * per-file try/catch, so a file whose metadata throws (corrupt YAML, broken
 * cache) must not abort the whole walk — an unreadable file is simply not a
 * FileSpace declaration. The converter's own pass surfaces the error.
 */
function readFrontmatterSafe(
  vault: FileSpaceDiscoveryVault,
  file: Parameters<FileSpaceDiscoveryVault["getFrontmatter"]>[0],
): Record<string, unknown> | null {
  try {
    return vault.getFrontmatter(file) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** Dual-read `exo__AssetSpace_source ?? _git` (same as the sync layer). */
function readSource(fm: Record<string, unknown>): string | null {
  const source = fm["exo__AssetSpace_source"];
  if (typeof source === "string" && source.length > 0) return source;
  const git = fm["exo__AssetSpace_git"];
  if (typeof git === "string" && git.length > 0) return git;
  return null;
}

/**
 * Scan the vault for FileSpace declarations and derive their mount-folder
 * exclusion prefixes. Pure read pass — one `getFrontmatter` per file (cheap
 * in the plugin via metadataCache; one YAML parse per file in the CLI).
 */
export function discoverFileSpaceExclusions(
  vault: FileSpaceDiscoveryVault,
): FileSpaceDiscoveryResult {
  const prefixes: string[] = [];
  const declarationPaths: string[] = [];
  const warnings: string[] = [];

  // Memoised per walk (reviewer MEDIUM): legacy label-form class links
  // repeat across thousands of files, and the CLI adapter re-parses the
  // destination file on every `getFrontmatter` — one verdict per unique
  // target string caps the resolve cost at the number of distinct classes.
  const refVerdicts = new Map<string, boolean>();

  const isFileSpaceClassRef = (target: string, sourcePath: string): boolean => {
    if (UUID_RE.test(target)) {
      return target.toLowerCase() === FILE_SPACE_CLASS_UID;
    }
    const memo = refVerdicts.get(target);
    if (memo !== undefined) return memo;
    // Label-form link — resolve and check the destination's asset uid.
    // NOTE platform asymmetry: the plugin's metadataCache resolver does NOT
    // resolve aliases, the CLI adapter does — UUID-form links are the
    // canonical, parity-safe declaration shape (UID-canon, CLAUDE.md).
    // `== null` on purpose: the interface says `IFile | null`, but mocks
    // and loose adapters legitimately return `undefined` — treat both as
    // "unresolved".
    const dest = vault.getFirstLinkpathDest(target, sourcePath);
    let verdict = false;
    if (dest != null) {
      const destFm = readFrontmatterSafe(vault, dest);
      const uid = destFm?.["exo__Asset_uid"];
      verdict =
        typeof uid === "string" && uid.toLowerCase() === FILE_SPACE_CLASS_UID;
    }
    refVerdicts.set(target, verdict);
    return verdict;
  };

  /** UUID-form membership only — the sync layer's detection shape. */
  const hasUuidFormRef = (targets: string[]): boolean =>
    targets.some(
      (t) => UUID_RE.test(t) && t.toLowerCase() === FILE_SPACE_CLASS_UID,
    );

  for (const file of vault.getAllFiles()) {
    const fm = readFrontmatterSafe(vault, file);
    if (!fm) continue;
    const targets = wikilinkTargets(fm["exo__Instance_class"]);
    if (!targets.some((t) => isFileSpaceClassRef(t, file.path))) continue;

    declarationPaths.push(file.path);
    if (!hasUuidFormRef(targets)) {
      // The sync layer's spec collector matches UUID-form links ONLY — a
      // label-form-only declaration is indexed-skipped here but will NOT
      // become a sync unit: surface the parity gap instead of leaving the
      // space silently "not indexed AND not synced" (reviewer LOW).
      warnings.push(
        `FileSpace declaration ${file.path} references the class via a label-form link only — the sync layer will not pick it up; use the UUID-form wikilink [[${FILE_SPACE_CLASS_UID}]] (UID-canon)`,
      );
    }

    const source = readSource(fm);
    if (source === null) {
      warnings.push(
        `FileSpace declaration ${file.path} has no exo__AssetSpace_source/_git — mount path underivable, content NOT excluded from the index`,
      );
      continue;
    }
    const mount = derivePath(source);
    if (mount === null) {
      warnings.push(
        `FileSpace declaration ${file.path}: cannot derive mount path from source "${source}" — content NOT excluded from the index`,
      );
      continue;
    }
    const prefix = `${mount}/`;
    if (file.path.startsWith(prefix)) {
      warnings.push(
        `FileSpace declaration ${file.path} lies INSIDE its own mount ${prefix} — it will be excluded from the index together with the content; move the declaration outside the mount folder`,
      );
    }
    prefixes.push(prefix);
  }

  return { prefixes, declarationPaths, warnings };
}
