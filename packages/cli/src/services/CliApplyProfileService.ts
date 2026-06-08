/**
 * CLI-side apply-profile orchestrator (Issue #3416 — UI↔CLI parity).
 *
 * Turns the `apply-profile` scaffold into a real mount-state switch: tears down
 * AssetSpaces NOT in the target profile's effective set and materialises those
 * that ARE, via the GitHub REST tarball path (no `git` binary). Mirrors the
 * plugin's mount-state model (the profile-apply manager REST switch):
 *
 *   - "an AssetSpace is materialised iff its derived folder exists on disk"
 *     (`derivePath(_source)` → `assetspaces/<owner>/<repo>`)
 *   - R24 TS-floor guard — the target profile's *declared* set (pre-floor) must
 *     explicitly include every floor AssetSpace; otherwise the switch refuses
 *     before any mutation (anti-self-brick, "explicit intent")
 *
 * Reuses the existing CLI Node-native mount mechanics
 * ({@link BootstrapAssetSpaceService.pullAssetSpace} +
 * `ensureGitmodulesEntry` / `unmountAssetSpace`) — already shipped + battle-
 * tested by the `bootstrap` command — instead of importing the Obsidian-coupled
 * `RestAssetSpaceMount`. The hexagonal core-extraction that would unify the
 * plugin + CLI mount paths behind one ports-based core is a DEFERRED follow-up
 * (the dual-mount drift surface is pre-existing from `bootstrap`, not introduced
 * here).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

import type { ApplyPlan } from "exocortex";
import {
  derivePath,
  assertTsFloor as assertTsFloorGuard,
  SDK_FLOOR_ASSETSPACE_UIDS,
  TsFloorViolationError,
} from "exocortex";

import {
  ASSET_SPACE_CLASS_UID,
  PROFILE_CLASS_UID,
  parseWikilinkArray,
  type ResolveFilterResult,
} from "./CliProfileResolver.js";
import { BootstrapAssetSpaceService } from "./BootstrapAssetSpaceService.js";

/**
 * R24 TS-floor guard error. Re-exported from the `exocortex` core
 * ({@link exocortex/src/domain/profile/TsFloorGuard}) so the single class
 * identity is shared across plugin + CLI — `e instanceof TsFloorViolationError`
 * works regardless of import path. Retained as a named export here for
 * backward-compat with the `apply-profile` command.
 */
export { TsFloorViolationError };

/** AssetSpace descriptor metadata needed for the mount-state diff. */
export interface AssetSpaceInfo {
  /** `exo__Asset_uid` of the AssetSpace descriptor. */
  uid: string;
  /** Repo URL — `exo__AssetSpace_source` ?? legacy `exo__AssetSpace_git`. */
  git: string;
  /**
   * Derived vault-relative mount folder — `derivePath(git)` (Maven-style,
   * traversal-safe `assetspaces/<owner>/<repo>`). Descriptors whose source is
   * un-derivable (`derivePath` → null) are skipped by `scanVault` rather than
   * falling back to a guessed folder, because this folder feeds a destructive
   * `rmSync` on tear-down (see scanVault safety note).
   */
  folderName: string;
  /** Display label — `exo__AssetSpace_namespace` ?? derived ?? uid prefix. */
  label: string;
}

/** A single AssetSpace scheduled for tear-down. */
export interface TearDownTarget {
  asUid: string;
  folderName: string;
  label: string;
  files: string[];
}

/** A single AssetSpace scheduled for materialisation. */
export interface MaterializeTarget {
  asUid: string;
  folderName: string;
  /** HTTPS GitHub URL used for the tarball pull (normalised from `git`). */
  httpsUrl: string;
  label: string;
}

/** Result of {@link CliApplyProfileService.buildDiff}. */
export interface ApplyProfileDiff {
  toDestroy: TearDownTarget[];
  toMaterialize: MaterializeTarget[];
  plan: ApplyPlan;
}

/** Result of {@link CliApplyProfileService.execute}. */
export interface ApplyProfileExecResult {
  destroyed: string[];
  materialized: string[];
}

export interface CliApplyProfileServiceOptions {
  /** Absolute vault root. */
  vaultPath: string;
  /**
   * Mount mechanics provider. Defaults to a fresh `BootstrapAssetSpaceService`.
   * Tests inject one with a fake `fetchImpl` so materialisation needs no
   * network.
   */
  mount?: BootstrapAssetSpaceService;
  /** Git ref to pull on materialise. Default `main`. */
  ref?: string;
}

/**
 * Convert any GitHub git URL form (HTTPS / SSH scp-like / git://) to the
 * canonical `https://github.com/<owner>/<repo>` form the tarball API needs.
 * Reuses `derivePath` (the single source of truth for owner/repo extraction);
 * falls back to the input unchanged when `derivePath` cannot parse it.
 */
export function toHttpsGitHubUrl(git: string): string {
  const folder = derivePath(git);
  if (folder === null) return git;
  const ownerRepo = folder.slice("assetspaces/".length);
  return `https://github.com/${ownerRepo}`;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".obsidian",
  ".exocortex",
  ".git",
]);

export class CliApplyProfileService {
  private readonly vaultPath: string;
  private readonly mount: BootstrapAssetSpaceService;
  private readonly ref: string;

  constructor(opts: CliApplyProfileServiceOptions) {
    this.vaultPath = opts.vaultPath;
    this.mount = opts.mount ?? new BootstrapAssetSpaceService();
    this.ref = opts.ref ?? "main";
  }

  /**
   * Single vault walk collecting AssetSpace descriptors (class match by UID,
   * consistent with `CliProfileResolver`) and Profile labels. The
   * descriptor's *location* is irrelevant to the mount folder — a registry-
   * hosted descriptor (e.g. `exoas-kitelev-registry`) still describes an
   * AssetSpace that mounts at `derivePath(_source)`, so the descriptor survives
   * an unmount and provides the URL for switch-back.
   */
  scanVault(): {
    infos: AssetSpaceInfo[];
    profileLabels: Map<string, string>;
  } {
    const infos: AssetSpaceInfo[] = [];
    const profileLabels = new Map<string, string>();
    const seen = new Set<string>();
    const stack: string[] = [this.vaultPath];

    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: import("node:fs").Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
          stack.push(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const fm = this.readFrontmatter(full);
        if (fm === null) continue;
        const uid = fm["exo__Asset_uid"];
        if (typeof uid !== "string" || uid.length === 0) continue;

        const classes = parseWikilinkArray(fm["exo__Instance_class"]);

        if (classes.includes(ASSET_SPACE_CLASS_UID)) {
          if (seen.has(uid)) continue;
          // Dual-read `_source ?? _git` (RFC 01a83de8 v10 T3).
          const source =
            typeof fm["exo__AssetSpace_source"] === "string"
              ? (fm["exo__AssetSpace_source"] as string)
              : "";
          const git =
            source ||
            (typeof fm["exo__AssetSpace_git"] === "string"
              ? (fm["exo__AssetSpace_git"] as string)
              : "");
          // `git` is essential for both folder derivation and materialise.
          // `namespace` is NOT required: real registry descriptors (Maven-
          // style, e.g. testlib) legitimately omit it — gating on it would
          // silently drop them from the switch. Label falls back gracefully.
          if (git.length === 0) continue;
          // Destructive-op safety: the mount folder MUST be DERIVABLE from the
          // source URL (`assetspaces/<owner>/<repo>` — always traversal-safe,
          // see AssetSpacePathDeriver). The plugin falls back to the
          // descriptor's own parent folder when `derivePath` fails, but for the
          // CLI's destructive `rmSync` that fallback would tear down the
          // descriptor's registry/location — or the VAULT ROOT for a root-level
          // descriptor (empty folder). Skip undeterminable descriptors entirely.
          const folderName = derivePath(git);
          if (folderName === null) continue;
          const namespace =
            typeof fm["exo__AssetSpace_namespace"] === "string"
              ? (fm["exo__AssetSpace_namespace"] as string)
              : "";
          const label =
            namespace || lastSegment(folderName) || uid.slice(0, 8);
          seen.add(uid);
          infos.push({ uid, git, folderName, label });
        }

        if (classes.includes(PROFILE_CLASS_UID)) {
          const label = fm["exo__Asset_label"];
          if (typeof label === "string" && label.length > 0) {
            profileLabels.set(uid, label);
          }
        }
      }
    }
    return { infos, profileLabels };
  }

  /**
   * R24 TS-floor guard. The profile's *declared* AssetSpace set (pre-floor —
   * `result.declaredOntologies` intersected with known AssetSpace UIDs) must
   * contain every floor AssetSpace, otherwise the apply would tear one
   * down and brick the engine.
   *
   * EV8 — delegates to the single named guard in `exocortex`. The CLI/headless
   * engine enforces the **SDK floor** = `{exo}` (RFC 5aa2a73a / #3440):
   * `$shared-identities` and `$exocmd` are optional, so a bare SDK vault
   * legitimately omits them. Tests live in `packages/exocortex/tests/domain/profile/`.
   *
   * @throws {TsFloorViolationError} if any SDK-floor AssetSpace is absent.
   */
  assertTsFloor(declaredAsUids: ReadonlySet<string>): void {
    assertTsFloorGuard(declaredAsUids, SDK_FLOOR_ASSETSPACE_UIDS);
  }

  /**
   * Compute the mount-state diff + the `ApplyPlan` from the resolver's
   * engaged result. Pure (no filesystem mutation) — `existsSync` reads only.
   */
  buildDiff(params: {
    targetProfileUid: string;
    targetProfileLabel: string;
    sourceProfileUid: string | null;
    sourceProfileLabel: string;
    result: ResolveFilterResult;
    infos: AssetSpaceInfo[];
  }): ApplyProfileDiff {
    const { targetProfileUid, targetProfileLabel, sourceProfileUid, sourceProfileLabel, result, infos } =
      params;

    const infoByUid = new Map<string, AssetSpaceInfo>();
    for (const info of infos) infoByUid.set(info.uid, info);
    const knownAsUids = new Set(infoByUid.keys());

    // R24 — declared (pre-floor) AssetSpace set the user explicitly intends.
    const declaredAsUids = new Set<string>();
    for (const uid of result.declaredOntologies) {
      if (knownAsUids.has(uid)) declaredAsUids.add(uid);
    }
    this.assertTsFloor(declaredAsUids);

    // Effective set for the mount-state diff. `result.effective` derives folder
    // membership from the resolver's own (1-level `parentFolderRelative`)
    // folderMap, which can drop a declared AssetSpace whose descriptor lives
    // under a Maven 2-level mount (`assetspaces/<owner>/<repo>`). scanVault's
    // `knownAsUids` use derivePath (the canonical mount-folder deriver), so we
    // union the user's DECLARED-and-known AS in to honour explicit intent.
    // Necessary after issue #3426: with exocmd removed from the SDK floor it is
    // no longer auto-injected, so a profile that explicitly includes exocmd
    // must still retain it here (SDK-floor members survive via result.effective
    // regardless).
    const effective = new Set<string>([...result.effective, ...declaredAsUids]);

    // Mount-state: an AssetSpace is materialised iff its derived folder exists.
    const materializedUids = new Set<string>();
    for (const info of infos) {
      if (existsSync(join(this.vaultPath, info.folderName))) {
        materializedUids.add(info.uid);
      }
    }

    const toDestroy: TearDownTarget[] = [];
    for (const info of infos) {
      if (!materializedUids.has(info.uid)) continue;
      if (effective.has(info.uid)) continue;
      toDestroy.push({
        asUid: info.uid,
        folderName: info.folderName,
        label: info.label,
        files: this.enumerateFilesUnder(info.folderName),
      });
    }

    const toMaterialize: MaterializeTarget[] = [];
    for (const asUid of effective) {
      if (materializedUids.has(asUid)) continue;
      const info = infoByUid.get(asUid);
      // AssetSpace in effective set but no descriptor (or no git URL) — cannot
      // materialise; skip (matches plugin's `info === undefined` skip).
      if (info === undefined) continue;
      toMaterialize.push({
        asUid: info.uid,
        folderName: info.folderName,
        httpsUrl: toHttpsGitHubUrl(info.git),
        label: info.label,
      });
    }

    const filesToDestroy = new Map<string, string[]>();
    for (const t of toDestroy) filesToDestroy.set(t.asUid, t.files);

    const plan: ApplyPlan = {
      targetProfileUid,
      targetProfileLabel,
      sourceProfileUid,
      sourceProfileLabel,
      filesToDestroy,
      assetSpacesBeingTornDown: toDestroy.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
        fileCount: t.files.length,
      })),
      assetSpacesBeingMaterialized: toMaterialize.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
      })),
    };

    return { toDestroy, toMaterialize, plan };
  }

  /**
   * Execute the diff: unmount each tear-down target, then materialise each
   * AssetSpace via REST tarball pull + `.gitmodules` append. Tear-down before
   * materialise mirrors the plugin's destroy-then-materialise ordering.
   *
   * No rollback (mount-state is self-describing — re-running reconciles to the
   * target). Idempotent at the per-AS level: a target already in the desired
   * state would not appear in the diff.
   */
  async execute(diff: ApplyProfileDiff): Promise<ApplyProfileExecResult> {
    const destroyed: string[] = [];
    const materialized: string[] = [];

    for (const target of diff.toDestroy) {
      this.mount.unmountAssetSpace(this.vaultPath, target.folderName);
      destroyed.push(target.asUid);
    }

    for (const target of diff.toMaterialize) {
      const absTarget = join(this.vaultPath, target.folderName);
      await this.mount.pullAssetSpace(target.httpsUrl, this.ref, absTarget);
      this.mount.ensureGitmodulesEntry(
        this.vaultPath,
        target.folderName,
        target.httpsUrl,
      );
      materialized.push(target.asUid);
    }

    return { destroyed, materialized };
  }

  // ───────────────────────────── internals ─────────────────────────────

  /** Recursive walk of a mount folder → vault-relative file paths. */
  private enumerateFilesUnder(folderName: string): string[] {
    const out: string[] = [];
    const abs = join(this.vaultPath, folderName);
    const stack: string[] = [abs];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: import("node:fs").Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".")) continue;
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        out.push(relativeVaultPath(full, this.vaultPath));
      }
    }
    return out;
  }

  private readFrontmatter(filePath: string): Record<string, unknown> | null {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
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

/** Normalise an absolute path to a forward-slash vault-relative path. */
function relativeVaultPath(absPath: string, vaultRoot: string): string {
  const normRoot = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const rel = absPath.startsWith(normRoot)
    ? absPath.slice(normRoot.length)
    : absPath;
  return rel.split("\\").join("/");
}

/** Last `/`-segment of a vault-relative folder (used as a label fallback). */
function lastSegment(folder: string): string {
  const parts = folder.split("/").filter((s) => s.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}
