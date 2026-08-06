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

import type { ApplyPlan } from "@kitelev/exocortex-core";
import {
  derivePath,
  deriveUrl,
  assertTsFloorReconciled,
  SDK_FLOOR,
  CATALOG_KEEP_NAMESPACES,
  TsFloorViolationError,
  parseYamlFrontmatterTolerant,
  classifyMountTransition,
  parkedPathFor,
  type MountState,
} from "@kitelev/exocortex-core";

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
  /**
   * `exo__AssetSpace_namespace` (empty string when absent). The fork-safe
   * floor identity (issue #3511): the EKA central registry mints a NEW
   * descriptor UID for the same `$exo` AssetSpace, so the R24 floor guard
   * matches by namespace as well as by legacy UID.
   */
  namespace: string;
  /**
   * req `18ecf16f` / `d4ccc901` — RAW `exo__AssetSpace_dependsOnKind`: what
   * depending on THIS AssetSpace means. Kept uninterpreted so
   * `resolveDependencyKind`'s safe default (`tbox`) applies to every unreadable
   * form. Decides park vs destroy when this AssetSpace leaves the effective set.
   */
  dependsOnKind?: string;
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
  /**
   * req `d4ccc901` — how the bytes arrive. `"unpark"` = local rename back from
   * `.exocortex/parked/` (offline, no download); `"pull"` = GitHub tarball.
   * Both reach the SAME destination state through the same bookkeeping; this
   * discriminates the acquisition step only.
   */
  source: "pull" | "unpark";
}

/** Result of {@link CliApplyProfileService.buildDiff}. */
export interface ApplyProfileDiff {
  toDestroy: TearDownTarget[];
  /**
   * req `d4ccc901` — AssetSpaces leaving the effective set over a SOFT edge:
   * moved aside, not deleted. Disjoint from {@link ApplyProfileDiff.toDestroy}
   * by construction (one classification per AssetSpace).
   */
  toPark: TearDownTarget[];
  toMaterialize: MaterializeTarget[];
  plan: ApplyPlan;
}

/** Result of {@link CliApplyProfileService.execute}. */
export interface ApplyProfileExecResult {
  destroyed: string[];
  /** req `d4ccc901` — moved to `.exocortex/parked/`, NOT deleted. */
  parked: string[];
  /** Includes unparked AssetSpaces — they reach `active` through this path. */
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
 *
 * `derivePath` (url → `assetspaces/<owner>/<repo>`) composed with `deriveUrl`
 * (path → `https://github.com/<owner>/<repo>`) is the single source of truth for
 * the url→canonical-url reconstruction (RFC 0005 Phase 0 — the path→url half used
 * to be duplicated inline here). Falls back to the input unchanged when
 * `derivePath` cannot parse it (`deriveUrl` of a `derivePath` output never
 * returns null — the path is already validated).
 */
export function toHttpsGitHubUrl(git: string): string {
  const folder = derivePath(git);
  if (folder === null) return git;
  return deriveUrl(folder) ?? git;
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
          const rawKind = fm["exo__AssetSpace_dependsOnKind"];
          const dependsOnKind =
            typeof rawKind === "string"
              ? rawKind
              : Array.isArray(rawKind) && typeof rawKind[0] === "string"
                ? (rawKind[0] as string)
                : undefined;
          seen.add(uid);
          infos.push({ uid, git, folderName, label, namespace, dependsOnKind });
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
   * legitimately omits them. Tests live in `packages/core/tests/domain/profile/`.
   *
   * Issue #3511 (EKA Alpha) — the floor is matched by legacy UID OR
   * `exo__AssetSpace_namespace`, so a central-registry vault whose `$exo`
   * descriptor carries a different UID (but namespace `"exo"`) still satisfies
   * the floor. `declaredNamespaces` is the set of namespaces of the declared
   * (closure ∩ known) AssetSpaces.
   *
   * @throws {TsFloorViolationError} if the SDK floor is satisfied by neither
   *   a declared UID nor a declared namespace.
   */
  assertTsFloor(
    declaredAsUids: ReadonlySet<string>,
    declaredNamespaces: ReadonlySet<string>,
  ): void {
    assertTsFloorReconciled(declaredAsUids, declaredNamespaces, SDK_FLOOR);
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
    // `result.declaredOntologies` is the `_includes` chain expanded by the
    // `exo__AssetSpace_dependsOn` closure (issue #3511), so a leaf-only profile's
    // transitive floor dependency (e.g. exoas-exo) is part of the declared set.
    const declaredAsUids = new Set<string>();
    const declaredNamespaces = new Set<string>();
    for (const uid of result.declaredOntologies) {
      if (knownAsUids.has(uid)) {
        declaredAsUids.add(uid);
        const ns = infoByUid.get(uid)?.namespace;
        if (ns !== undefined && ns.length > 0) declaredNamespaces.add(ns);
      }
    }
    this.assertTsFloor(declaredAsUids, declaredNamespaces);

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

    // req `d4ccc901` — mount-state is now THREE-valued. `active` keeps its
    // historical definition (the derived folder exists); `parked` means the
    // folder was moved under `.exocortex/parked/` and the bytes are still on
    // this device; `absent` means neither. `active` wins if both paths somehow
    // exist — the live mount is the copy in use, and `parkAssetSpace` refuses
    // that collision rather than resolving it silently.
    const stateByUid = new Map<string, MountState>();
    for (const info of infos) {
      const state: MountState = existsSync(join(this.vaultPath, info.folderName))
        ? "active"
        : existsSync(join(this.vaultPath, parkedPathFor(info.folderName)))
          ? "parked"
          : "absent";
      stateByUid.set(info.uid, state);
    }
    const materializedUids = new Set<string>(
      [...stateByUid].filter(([, s]) => s === "active").map(([uid]) => uid),
    );

    // EKA Alpha (issue #3511) — never tear down the catalog AssetSpaces
    // (central registry + profiles) that supply descriptors/profiles for
    // resolution. Keep any already-materialised one so a leaf-profile apply
    // can't `rm` the registry that holds every descriptor (one-level
    // self-brick). NOT force-materialised — a vault without them is unaffected.
    for (const info of infos) {
      if (
        CATALOG_KEEP_NAMESPACES.has(info.namespace) &&
        materializedUids.has(info.uid)
      ) {
        effective.add(info.uid);
      }
    }

    // req `d4ccc901` — one classification pass over every known AssetSpace.
    // Departures PARTITION: an AssetSpace goes to `toDestroy` XOR `toPark`,
    // never both, because parking moves the whole mount folder. That partition
    // is what keeps the confirm-gate honest — `filesToDestroy` is derived from
    // `toDestroy` alone, so a parked AssetSpace's files are absent from the
    // "N files to remove" count instead of being reported twice under two
    // different verbs.
    const toDestroy: TearDownTarget[] = [];
    const toPark: TearDownTarget[] = [];
    const toMaterialize: MaterializeTarget[] = [];

    for (const info of infos) {
      const transition = classifyMountTransition({
        state: stateByUid.get(info.uid) ?? "absent",
        inEffectiveSet: effective.has(info.uid),
        dependsOnKind: info.dependsOnKind,
      });
      switch (transition) {
        case "none":
          break;
        case "destroy":
          toDestroy.push({
            asUid: info.uid,
            folderName: info.folderName,
            label: info.label,
            files: this.enumerateFilesUnder(info.folderName),
          });
          break;
        case "park":
          toPark.push({
            asUid: info.uid,
            folderName: info.folderName,
            label: info.label,
            files: this.enumerateFilesUnder(info.folderName),
          });
          break;
        // `unpark` and `materialize` are the same destination — `active` — and
        // travel one list so they share the post-acquisition bookkeeping
        // (`.gitmodules` registration). Only `source` differs, and it decides
        // one thing: whether the bytes come off this device or the network.
        case "unpark":
        case "materialize":
          toMaterialize.push({
            asUid: info.uid,
            folderName: info.folderName,
            httpsUrl: toHttpsGitHubUrl(info.git),
            label: info.label,
            source: transition === "unpark" ? "unpark" : "pull",
          });
          break;
      }
    }

    const filesToDestroy = new Map<string, string[]>();
    for (const t of toDestroy) filesToDestroy.set(t.asUid, t.files);

    const unparkedUids = new Set(
      toMaterialize.filter((t) => t.source === "unpark").map((t) => t.asUid),
    );

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
      assetSpacesBeingParked: toPark.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
        fileCount: t.files.length,
      })),
      assetSpacesBeingMaterialized: toMaterialize.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
      })),
      assetSpacesBeingUnparked: toMaterialize
        .filter((t) => unparkedUids.has(t.asUid))
        .map((t) => ({ asUid: t.asUid, asLabel: t.label })),
    };

    return { toDestroy, toPark, toMaterialize, plan };
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
    const parked: string[] = [];
    const materialized: string[] = [];

    for (const target of diff.toDestroy) {
      this.mount.unmountAssetSpace(this.vaultPath, target.folderName);
      destroyed.push(target.asUid);
    }

    // req `d4ccc901` — parking runs with the other departures, before any
    // arrival, so a mount folder is always vacated before it could be claimed.
    for (const target of diff.toPark) {
      this.mount.parkAssetSpace(this.vaultPath, target.folderName);
      parked.push(target.asUid);
    }

    for (const target of diff.toMaterialize) {
      // req `d4ccc901` — ONE arrival path. `source` selects how the bytes are
      // acquired and nothing else: the `.gitmodules` registration and the
      // `materialized` bookkeeping below are shared, so an unparked AssetSpace
      // cannot end up in a half-registered state that a pulled one avoids.
      if (target.source === "unpark") {
        this.mount.unparkAssetSpace(this.vaultPath, target.folderName);
      } else {
        const absTarget = join(this.vaultPath, target.folderName);
        await this.mount.pullAssetSpace(target.httpsUrl, this.ref, absTarget);
      }
      this.mount.ensureGitmodulesEntry(
        this.vaultPath,
        target.folderName,
        target.httpsUrl,
      );
      materialized.push(target.asUid);
    }

    return { destroyed, parked, materialized };
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
      // Tolerant parse (#3901 / #3800): a duplicated YAML key resolves last-wins
      // instead of throwing (which the bare `yaml.load` did → caught → null),
      // so a dup-key asset still resolves. Non-dup input is byte-identical.
      const parsed = parseYamlFrontmatterTolerant(match[1], filePath);
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
