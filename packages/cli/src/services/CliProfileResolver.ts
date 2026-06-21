/**
 * CLI-side Profile resolver — parity with the plugin's profile-apply manager
 * (effective-set resolution) + onload wiring
 * (Issue #3323, RFC 0a0791c1 Variant A MVP).
 *
 * Walks the vault filesystem to:
 *   1. Build folderMap: `assetspaces/<folder>` → AssetSpace UID
 *   2. Resolve Profile chain (`_imports*` + `_includes`) to a declared UID set
 *      (`_includes` are AssetSpace UIDs per RFC 01a83de8 Phase 2)
 *   3. Resolve declared AssetSpace UIDs against folderMap (the former
 *      Ontology→AS translation via `exo__AssetSpace_containsOntology` was removed
 *      in Phase 3 T3b-cleanup — profiles declare AS UIDs directly)
 *   4. Apply the SDK-floor AssetSpace UIDs (Vision Lock #17 / floor={exo},
 *      RFC 5aa2a73a / #3440): `$exo` only — guarantees the CLI/headless engine
 *      keeps functioning regardless of profile config. `$shared-identities`
 *      and `$exocmd` are OPTIONAL (not in any floor tier post-#3440)
 *   5. Safe-degrade: if effective set has zero AS-folder overlap, return null
 *      (caller falls back to no-filter / full vault) to prevent self-brick
 *
 * **Phase 6 follow-up** (deferred): extract the shared resolver / translation
 * logic to `packages/core/` so plugin and CLI consume one implementation.
 * For the spike P0 we duplicate the plugin's logic verbatim — drift surface
 * tracked by `multi-parser-predicate-migration.md` rule + this comment.
 */

import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";

import {
  SDK_FLOOR_ASSETSPACE_UIDS,
  derivePath,
  transitiveDependsOnClosure,
} from "@kitelev/exocortex-core";

// TS-floor anchors (Vision Lock #17) — re-exported from the `exocortex` core
// guard (RFC 01a83de8 §3.4 / EV8, issue #3426). Single source of truth.
export {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  SDK_FLOOR_ASSETSPACE_UIDS,
} from "@kitelev/exocortex-core";

/**
 * TS-floor AssetSpace UIDs the CLI/headless engine enforces — the **SDK floor**
 * = `{exo}` (RFC 5aa2a73a / #3440). `$shared-identities` and `$exocmd` are
 * OPTIONAL. A bare SDK vault is a first-class config and never forces the
 * UI-command library. (The plugin uses the same `{exo}` floor — both tiers
 * collapsed to `{exo}` in #3440.)
 */
export const TS_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> =
  SDK_FLOOR_ASSETSPACE_UIDS;

/** Class UID of `exo__AssetSpace` (TBox). Mirrors plugin's `AssetSpaceManager.ASSET_SPACE_CLASS_UID`. */
export const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
/** Class UID of `exo__Profile` (TBox). Mirrors the plugin profile-apply manager PROFILE_CLASS_UID. */
export const PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

/** Max `_extends` chain depth (matches plugin default). */
const DEFAULT_MAX_EXTENDS_DEPTH = 5;

export interface ResolveFilterResult {
  /** AssetSpace UID set the converter should retain (incl. TS-floor). */
  effective: ReadonlySet<string>;
  /** `assetspaces/<folder>` → AS UID map the converter uses to look up file owners. */
  folderMap: ReadonlyMap<string, string>;
  /** Diagnostic — declared UIDs the profile chain produced (`_includes` ∪ floor). */
  declaredOntologies: ReadonlySet<string>;
  /** Diagnostic — declared UIDs that matched no known AssetSpace folder. */
  untranslated: ReadonlyArray<string>;
}

export type ResolveFilterOutcome =
  | { outcome: "engaged"; result: ResolveFilterResult }
  | { outcome: "no-profile" }
  | { outcome: "missing-profile"; profileUid: string }
  | { outcome: "degraded"; reason: string }
  | { outcome: "error"; reason: string };

export interface CliProfileResolverOptions {
  /** Primary vault path. */
  vaultPath: string;
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
}

/**
 * CLI-side Profile resolver. Single-shot — instantiate, call
 * `resolveFilter(profileUid)`, discard. No internal mutable state to keep
 * concurrent CLI invocations safe.
 */
export class CliProfileResolver {
  private readonly vaultPaths: ReadonlyArray<string>;
  private readonly maxExtendsDepth: number;
  private readonly warn: (msg: string) => void;

  constructor(options: CliProfileResolverOptions) {
    this.vaultPaths = [path.resolve(options.vaultPath)];
    this.maxExtendsDepth = options.maxExtendsDepth ?? DEFAULT_MAX_EXTENDS_DEPTH;
    this.warn = options.warn ?? (() => undefined);
  }

  /**
   * Resolve a profile UID to its effective AssetSpace set.
   *
   * Outcomes:
   * - `engaged` — effective set computed; `result.effective` is the AS-UID set
   *   the CLI apply materialises (+ `result.folderMap` for diagnostics)
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
      profiles: Map<string, ProfileFrontmatter>;
      dependsOn: Map<string, string[]>;
    };
    try {
      scan = await this.scanAllVaults();
    } catch (e) {
      const reason = `[CliProfileResolver] vault scan threw — ${String(e)}`;
      this.warn(reason);
      return { outcome: "error", reason };
    }

    const profile = scan.profiles.get(profileUid);
    if (profile === undefined) {
      this.warn(
        `[CliProfileResolver] profileUid=${profileUid} not found in any scanned vault — falling back to no-filter (full vault).`,
      );
      return { outcome: "missing-profile", profileUid };
    }

    // Walk chain → directly-declared AssetSpace UID set (`_includes` ∪ `_imports*`).
    const declaredRoots = new Set<string>();
    try {
      this.walkProfileChain(profileUid, scan.profiles, declaredRoots, new Set(), 0);
    } catch (e) {
      const reason = `[CliProfileResolver] profile chain walk threw — ${String(e)}`;
      this.warn(reason);
      return { outcome: "error", reason };
    }

    // EKA Alpha D18 (issue #3511) — a profile declares only LEAF AssetSpaces;
    // expand to the transitive `exo__AssetSpace_dependsOn` closure so the
    // effective set includes every required dependency (e.g. exodev →
    // shared-private → public → exo → w3c). Pre-EKA self-describing vaults have
    // no dependsOn edges, so the closure equals the literal declared set there.
    const declared = transitiveDependsOnClosure(declaredRoots, scan.dependsOn);

    // Resolve declared UIDs against the AssetSpace folder map. RFC 01a83de8
    // Phase 2 retargeted `_includes` to AssetSpace UIDs, so they match the
    // folder map directly; the former Ontology→AS translation (via
    // `exo__AssetSpace_containsOntology`) is dead and was removed in Phase 3
    // T3b-cleanup. UIDs that don't resolve to a known AS folder are surfaced as
    // `untranslated` for diagnostics.
    const folderMapValues = new Set(scan.folderMap.values());
    const effectiveAs = new Set<string>();
    const untranslated: string[] = [];
    for (const uid of declared) {
      if (folderMapValues.has(uid)) {
        effectiveAs.add(uid);
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
        `[CliProfileResolver] profileUid=${profileUid} produced effective set with zero AssetSpace folder overlap ` +
        `(${effectiveAs.size} AS UIDs incl. floor; ${scan.folderMap.size} folders known). ` +
        `Likely cause: profile declares AssetSpace UIDs not present as descriptors, or vault has no scanned AssetSpaces. ` +
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
        `Profile chain exceeds max depth ${this.maxExtendsDepth} at ${uid} — possible cycle`,
      );
    }
    if (visited.has(uid)) return; // cycle guard
    visited.add(uid);

    const profile = profiles.get(uid);
    if (profile === undefined) return; // tolerate missing parent — leaf

    for (const ont of profile.includes) out.add(ont);

    if (
      typeof profile.extends === "string" &&
      profile.extends.length > 0
    ) {
      this.walkProfileChain(profile.extends, profiles, out, visited, depth + 1);
    }
  }

  private async scanAllVaults(): Promise<{
    folderMap: Map<string, string>;
    profiles: Map<string, ProfileFrontmatter>;
    dependsOn: Map<string, string[]>;
  }> {
    const folderMap = new Map<string, string>();
    const profiles = new Map<string, ProfileFrontmatter>();
    const dependsOn = new Map<string, string[]>();

    for (const vaultRoot of this.vaultPaths) {
      if (!(await fs.pathExists(vaultRoot))) {
        this.warn(
          `[CliProfileResolver] vault path does not exist: ${vaultRoot} — skipping.`,
        );
        continue;
      }
      const assets = await this.walkVault(vaultRoot);
      for (const asset of assets) {
        const classes = parseWikilinkArray(
          asset.frontmatter["exo__Instance_class"],
        );

        if (classes.some((c) => c === ASSET_SPACE_CLASS_UID)) {
          // AssetSpace asset — register folderMap from TWO sources so a profile's
          // declared `_includes` UIDs resolve regardless of WHERE the descriptor
          // physically lives (issue #3511):
          //
          //   Source A (legacy self-describing) — the descriptor's own parent
          //     folder (first path segment). Kept for descriptors with NO
          //     git-url (`exo__AssetSpace_source`/`_git`) — backward-compat.
          //
          //   Source B (EKA central registry) — the canonical mount folder
          //     DERIVED from the descriptor's git-url via `derivePath` (the same
          //     deriver `CliApplyProfileService.scanVault` + `bootstrap`/
          //     `assetspace-add` use; equals the `.gitmodules` mount path). This
          //     gives a UNIQUE folder key per repo, so N descriptors co-located
          //     in one central registry no longer collapse to a single key (the
          //     bug that produced "zero AssetSpace folder overlap → degraded").
          //
          // `folderMap.values()` (the AS-UID set) is what the degrade/effective
          // check consumes — both sources contribute the descriptor's UID, so
          // every scanned AssetSpace becomes resolvable.
          const selfFolder = parentFolderRelative(asset.filePath, asset.vaultRoot);
          if (selfFolder.length > 0 && !folderMap.has(selfFolder)) {
            folderMap.set(selfFolder, asset.uid);
          }
          const source =
            typeof asset.frontmatter["exo__AssetSpace_source"] === "string"
              ? (asset.frontmatter["exo__AssetSpace_source"] as string)
              : typeof asset.frontmatter["exo__AssetSpace_git"] === "string"
                ? (asset.frontmatter["exo__AssetSpace_git"] as string)
                : "";
          if (source.length > 0) {
            const derived = derivePath(source);
            if (derived !== null) {
              folderMap.set(derived, asset.uid); // url-derived key wins (canonical)
            }
          }
          // EKA Alpha D18 dependsOn DAG (issue #3511) — collect transitive-dep
          // edges so the resolver can expand a leaf-only profile to its closure.
          const deps = parseWikilinkArray(
            asset.frontmatter["exo__AssetSpace_dependsOn"],
          );
          if (deps.length > 0) {
            dependsOn.set(asset.uid, deps);
          }
        }

        if (classes.some((c) => c === PROFILE_CLASS_UID)) {
          const profile: ProfileFrontmatter = {
            uid: asset.uid,
            label: typeof asset.frontmatter["exo__Asset_label"] === "string"
              ? (asset.frontmatter["exo__Asset_label"] as string)
              : undefined,
            // RFC 01a83de8 Phase 2 — `_includes` now AssetSpace UIDs (range
            // retarget); `_extends` renamed → `_imports` (single-parent MVP).
            includes: parseWikilinkArray(
              asset.frontmatter["exo__Profile_includes"],
            ),
            extends:
              parseWikilinkArray(
                asset.frontmatter["exo__Profile_imports"],
              )[0] ?? null,
          };
          profiles.set(asset.uid, profile);
        }
      }
    }

    return { folderMap, profiles, dependsOn };
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
