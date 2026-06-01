/**
 * CLI-side FocusProfile resolver — parity with plugin's
 * `FocusProfileSwitchManager.resolveEffectiveSet` + `FocusProfileOnloadWiring`
 * (Issue #3323, RFC 0a0791c1 Variant A MVP).
 *
 * Walks the vault filesystem to:
 *   1. Build folderMap: `assetspaces/<folder>` → AssetSpace UID
 *   2. Build ontologyToAs: Ontology UID → owning AssetSpace UID (via
 *      `exo__AssetSpace_containsOntology` declarations)
 *   3. Resolve FocusProfile chain (`_extends*` + `_includes` + `_alwaysOnOverlay`)
 *      to a declared Ontology UID set
 *   4. Translate declared Ontology UIDs → AssetSpace UIDs through ontologyToAs
 *   5. Apply TS-floor AssetSpace UIDs (Vision Lock #17): $exo, $exocmd,
 *      $shared-identities — guarantees plugin/CLI keeps functioning regardless
 *      of profile config
 *   6. Safe-degrade: if effective set has zero AS-folder overlap, return null
 *      (caller falls back to no-filter / full vault) to prevent self-brick
 *
 * **Phase 6 follow-up** (deferred): extract the shared resolver / translation
 * logic to `packages/exocortex/` so plugin and CLI consume one implementation.
 * For the spike P0 we duplicate the plugin's logic verbatim — drift surface
 * tracked by `multi-parser-predicate-migration.md` rule + this comment.
 */

import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";

/**
 * AssetSpace UID of `$exo` — TS-floor anchor (Vision Lock #17).
 * Mirrors `packages/obsidian-plugin/src/infrastructure/adapters/FocusProfileOnloadWiring.ts:45`.
 */
export const TS_FLOOR_AS_UID_EXO = "49fd2e56-4656-4ca7-a789-f472b16ea260";
/**
 * AssetSpace UID of `$exocmd` — TS-floor anchor (Vision Lock #17).
 * Mirrors plugin constant.
 */
export const TS_FLOOR_AS_UID_EXOCMD = "c9c65b0f-1e01-47c1-a1f9-1bf70b11df6a";
/**
 * AssetSpace UID of `$shared-identities` — TS-floor anchor (Vision Lock #17).
 * Mirrors plugin constant.
 */
export const TS_FLOOR_AS_UID_SHARED_IDENTITIES =
  "0cde1557-6320-4bd0-a7c4-8b72afc38720";

/** TS-floor AssetSpace UIDs — always added to the effective set. */
export const TS_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> = new Set([
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
]);

/** Class UID of `exo__AssetSpace` (TBox). Mirrors plugin's `AssetSpaceManager.ASSET_SPACE_CLASS_UID`. */
export const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
/** Class UID of `exo__FocusProfile` (TBox). Mirrors plugin's `FocusProfileSwitchManager.FOCUS_PROFILE_CLASS_UID`. */
export const FOCUS_PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

/** Max `_extends` chain depth (matches plugin default). */
const DEFAULT_MAX_EXTENDS_DEPTH = 5;

export interface ResolveFilterResult {
  /** AssetSpace UID set the converter should retain (incl. TS-floor). */
  effective: ReadonlySet<string>;
  /** `assetspaces/<folder>` → AS UID map the converter uses to look up file owners. */
  folderMap: ReadonlyMap<string, string>;
  /** Diagnostic — declared Ontology UIDs the profile chain produced (pre-translation). */
  declaredOntologies: ReadonlySet<string>;
  /** Diagnostic — Ontology UIDs that had no AS owner in `containsOntology` (translation miss). */
  untranslated: ReadonlyArray<string>;
}

export type ResolveFilterOutcome =
  | { outcome: "engaged"; result: ResolveFilterResult }
  | { outcome: "no-profile" }
  | { outcome: "missing-profile"; profileUid: string }
  | { outcome: "degraded"; reason: string }
  | { outcome: "error"; reason: string };

export interface CliFocusProfileResolverOptions {
  /** Primary vault path. */
  vaultPath: string;
  /** Additional vault paths (mirrors CLI `--also`). */
  alsoVaultPaths?: ReadonlyArray<string>;
  /** Override max `_extends` chain depth (default 5). */
  maxExtendsDepth?: number;
  /** Injectable logger for warn-level diagnostics (defaults to no-op). */
  warn?: (msg: string) => void;
}

interface AssetMeta {
  uid: string;
  filePath: string;
  vaultRoot: string;
  frontmatter: Record<string, unknown>;
}

interface ProfileFrontmatter {
  uid: string;
  label?: string;
  includes: string[];
  extends: string | null;
  alwaysOnOverlay: string[];
}

/**
 * CLI-side FocusProfile resolver. Single-shot — instantiate, call
 * `resolveFilter(profileUid)`, discard. No internal mutable state to keep
 * concurrent CLI invocations safe.
 */
export class CliFocusProfileResolver {
  private readonly vaultPaths: ReadonlyArray<string>;
  private readonly maxExtendsDepth: number;
  private readonly warn: (msg: string) => void;

  constructor(options: CliFocusProfileResolverOptions) {
    const also = options.alsoVaultPaths ?? [];
    this.vaultPaths = [options.vaultPath, ...also].map((p) => path.resolve(p));
    this.maxExtendsDepth = options.maxExtendsDepth ?? DEFAULT_MAX_EXTENDS_DEPTH;
    this.warn = options.warn ?? (() => undefined);
  }

  /**
   * Resolve `--profile <uid>` to the converter filter pair.
   *
   * Outcomes:
   * - `engaged` — filter computed; pass `result.effective` + `result.folderMap`
   *   to `NoteToRDFConverter.convertVault({ effectiveOntologies, assetSpaceFolderToUid })`
   * - `no-profile` — `profileUid` was null/undefined; caller indexes full vault
   * - `missing-profile` — UID provided but no asset with that UID found; caller
   *   indexes full vault (defensive; surface warn)
   * - `degraded` — translated effective set has zero AS-folder overlap; caller
   *   indexes full vault (R15 self-brick mitigation)
   * - `error` — vault walk / yaml parse threw; caller indexes full vault
   */
  async resolveFilter(
    profileUid: string | null | undefined,
  ): Promise<ResolveFilterOutcome> {
    if (profileUid === null || profileUid === undefined || profileUid === "") {
      return { outcome: "no-profile" };
    }

    let scan: {
      folderMap: Map<string, string>;
      ontologyToAs: Map<string, string>;
      profiles: Map<string, ProfileFrontmatter>;
    };
    try {
      scan = await this.scanAllVaults();
    } catch (e) {
      const reason = `[CliFocusProfileResolver] vault scan threw — ${String(e)}`;
      this.warn(reason);
      return { outcome: "error", reason };
    }

    const profile = scan.profiles.get(profileUid);
    if (profile === undefined) {
      this.warn(
        `[CliFocusProfileResolver] profileUid=${profileUid} not found in any scanned vault — falling back to no-filter (full vault).`,
      );
      return { outcome: "missing-profile", profileUid };
    }

    // Walk chain → declared Ontology UID set
    const declared = new Set<string>();
    try {
      this.walkProfileChain(profileUid, scan.profiles, declared, new Set(), 0);
    } catch (e) {
      const reason = `[CliFocusProfileResolver] profile chain walk threw — ${String(e)}`;
      this.warn(reason);
      return { outcome: "error", reason };
    }

    // Translate Ontology UIDs → AS UIDs
    const folderMapValues = new Set(scan.folderMap.values());
    const effectiveAs = new Set<string>();
    const untranslated: string[] = [];
    for (const uid of declared) {
      if (folderMapValues.has(uid)) {
        effectiveAs.add(uid);
        continue;
      }
      const translated = scan.ontologyToAs.get(uid);
      if (translated !== undefined) {
        effectiveAs.add(translated);
        continue;
      }
      untranslated.push(uid);
    }

    // Always lay TS-floor at AS UID level
    for (const floor of TS_FLOOR_ASSETSPACE_UIDS) {
      effectiveAs.add(floor);
    }

    // R15 zero-overlap degrade
    const hasOverlap = Array.from(effectiveAs).some((uid) =>
      folderMapValues.has(uid),
    );
    if (!hasOverlap) {
      const reason =
        `[CliFocusProfileResolver] profileUid=${profileUid} produced effective set with zero AssetSpace folder overlap ` +
        `(${effectiveAs.size} AS UIDs after translation+floor; ${scan.folderMap.size} folders known). ` +
        `Likely cause: profile declares Ontology UIDs not covered by containsOntology, or vault has no scanned AssetSpaces. ` +
        `Falling back to no-filter (full vault indexed).`;
      this.warn(reason);
      return { outcome: "degraded", reason };
    }

    return {
      outcome: "engaged",
      result: {
        effective: effectiveAs,
        folderMap: scan.folderMap,
        declaredOntologies: declared,
        untranslated,
      },
    };
  }

  // ===== Internal helpers =====

  private walkProfileChain(
    uid: string,
    profiles: Map<string, ProfileFrontmatter>,
    out: Set<string>,
    visited: Set<string>,
    depth: number,
  ): void {
    if (depth > this.maxExtendsDepth) {
      throw new Error(
        `FocusProfile chain exceeds max depth ${this.maxExtendsDepth} at ${uid} — possible cycle`,
      );
    }
    if (visited.has(uid)) return; // cycle guard
    visited.add(uid);

    const profile = profiles.get(uid);
    if (profile === undefined) return; // tolerate missing parent — leaf

    for (const ont of profile.includes) out.add(ont);
    for (const ont of profile.alwaysOnOverlay) out.add(ont);

    if (
      typeof profile.extends === "string" &&
      profile.extends.length > 0
    ) {
      this.walkProfileChain(profile.extends, profiles, out, visited, depth + 1);
    }
  }

  private async scanAllVaults(): Promise<{
    folderMap: Map<string, string>;
    ontologyToAs: Map<string, string>;
    profiles: Map<string, ProfileFrontmatter>;
  }> {
    const folderMap = new Map<string, string>();
    const ontologyToAs = new Map<string, string>();
    const profiles = new Map<string, ProfileFrontmatter>();

    for (const vaultRoot of this.vaultPaths) {
      if (!(await fs.pathExists(vaultRoot))) {
        this.warn(
          `[CliFocusProfileResolver] vault path does not exist: ${vaultRoot} — skipping.`,
        );
        continue;
      }
      const assets = await this.walkVault(vaultRoot);
      for (const asset of assets) {
        const classes = parseWikilinkArray(
          asset.frontmatter["exo__Instance_class"],
        );

        if (classes.some((c) => c === ASSET_SPACE_CLASS_UID)) {
          // AssetSpace asset — register folderMap + containsOntology
          const folder = parentFolderRelative(asset.filePath, asset.vaultRoot);
          if (folder.length > 0) {
            folderMap.set(folder, asset.uid);
          }
          const declared = parseWikilinkArray(
            asset.frontmatter["exo__AssetSpace_containsOntology"],
          );
          for (const ont of declared) {
            ontologyToAs.set(ont, asset.uid);
          }
        }

        if (classes.some((c) => c === FOCUS_PROFILE_CLASS_UID)) {
          const profile: ProfileFrontmatter = {
            uid: asset.uid,
            label: typeof asset.frontmatter["exo__Asset_label"] === "string"
              ? (asset.frontmatter["exo__Asset_label"] as string)
              : undefined,
            includes: parseWikilinkArray(
              asset.frontmatter["exo__FocusProfile_includes"],
            ),
            extends:
              parseWikilinkArray(
                asset.frontmatter["exo__FocusProfile_extends"],
              )[0] ?? null,
            alwaysOnOverlay: parseWikilinkArray(
              asset.frontmatter["exo__FocusProfile_alwaysOnOverlay"],
            ),
          };
          profiles.set(asset.uid, profile);
        }
      }
    }

    return { folderMap, ontologyToAs, profiles };
  }

  private async walkVault(vaultRoot: string): Promise<AssetMeta[]> {
    const out: AssetMeta[] = [];
    const stack: string[] = [vaultRoot];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            entry.name === ".obsidian" ||
            entry.name === ".exocortex"
          ) {
            continue;
          }
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const fm = await this.tryReadFrontmatter(fullPath);
        if (fm === null) continue;
        const uid = fm["exo__Asset_uid"];
        if (typeof uid !== "string" || uid.length === 0) continue;
        out.push({
          uid,
          filePath: fullPath,
          vaultRoot,
          frontmatter: fm,
        });
      }
    }
    return out;
  }

  private async tryReadFrontmatter(
    filePath: string,
  ): Promise<Record<string, unknown> | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
    // Fast bail-out — files without --- on first line can't be frontmatter
    if (!content.startsWith("---")) return null;
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match === null) return null;
    try {
      const parsed = yaml.load(match[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Parse a frontmatter value that may be a single wikilink string, an array
 * of wikilinks, or undefined/null. Returns the bare UID portion of each
 * wikilink (`[[UID|alias]]` → `UID`, `[[UID]]` → `UID`, `UID` → `UID`).
 *
 * Non-string entries are dropped. Empty / unparseable entries are dropped.
 */
export function parseWikilinkArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const arr: unknown[] = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const uid = extractUidFromWikilink(raw);
    if (uid !== null) out.push(uid);
  }
  return out;
}

/** Strip `[[` / `]]` / `|alias` wrappers and return the inner identifier. */
export function extractUidFromWikilink(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * Compute the `assetspaces/<folder>` portion of an absolute file path
 * relative to its vault root. Returns "" when the file is not inside an
 * `assetspaces/<folder>/` namespace.
 */
function parentFolderRelative(absPath: string, vaultRoot: string): string {
  const rel = path.relative(vaultRoot, absPath).replace(/\\/g, "/");
  if (!rel.startsWith("assetspaces/")) return "";
  const rest = rel.slice("assetspaces/".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx < 0) return "";
  return `assetspaces/${rest.slice(0, slashIdx)}`;
}
