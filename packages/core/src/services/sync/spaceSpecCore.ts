/**
 * Platform-free space-declaration classification core (ExoSync Phase E, E1 —
 * RFC 4e4dc453).
 *
 * ONE source of truth for "which vault frontmatter declares a sync unit and
 * what `SyncRepoSpec` does it map to". The plugin's `collectSyncRepoSpecs`
 * (App/metadataCache walk) and the CLI's `exosync-parity` collector (node-fs
 * walk) both delegate here — the four behavioural quirks below previously
 * lived only in the plugin and would otherwise drift apart across consumers
 * (the exact multi-parser failure mode the parity-gate CI check exists for):
 *
 *  1. dual-read `exo__AssetSpace_source ?? _git` (RFC 01a83de8 v10);
 *  2. `.git` suffix normalised ONCE, case-insensitively, and the SAME string
 *     fed to both the URL parser and the mount-path deriver;
 *  3. a declaration carrying BOTH disjoint Space classes resolves to `asset`
 *     (its md-only allowlist can never corrupt attachments) with a warning;
 *  4. the same repo declared twice with CONFLICTING kinds resolves to
 *     `asset` deterministically regardless of walk order.
 *
 * Pure functions + an order-explicit accumulator — no I/O, no platform API.
 * The only platform-specific step (does the mount folder exist on disk?) is
 * left to the caller, BETWEEN `offer()` and `commit()`.
 */

import { FILE_SPACE_CLASS_UID } from "../FileSpaceDiscovery";
import { derivePath } from "../AssetSpacePathDeriver";
import type { SpaceKind, SyncRepoSpec } from "./syncTypes";

/**
 * Class UID of `exo__AssetSpace` (TBox root). Used to discriminate AssetSpace
 * ABox instances from other assets when scanning the vault. Hardcoded by RFC
 * 0a0791c1 (UID frozen by RFC v2 `2a98f345`, implemented 2026-05-17).
 * Previously lived in the plugin's `AssetSpaceFrontmatter` — moved here so
 * the CLI shares the identical predicate (the plugin re-exports it).
 */
export const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";

/**
 * Per-repo sync branch. AssetSpace ABox declares no branch property and the
 * REST mount layer pulls `ref="main"` — same constant here. NOTE: changing
 * this later (e.g. API-resolved default branch) changes `repoKey` and resets
 * watermarks → one-time first-sync full-conflict per repo.
 */
export const SYNC_BRANCH = "main";

/**
 * Strict wikilink regex — matches `[[<uuid>]]` or `[[<uuid>|<label>]]`,
 * capturing the canonical UUIDv4 form (8-4-4-4-12 hex, case-insensitive).
 * Anchored to the wikilink brackets so substring matches like
 * `notavalid-73bd00e4-...` do not falsely register as the AssetSpace class.
 * See Issue #3312 MEDIUM #1.
 */
const WIKILINK_UID_RE =
  /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|[^\]]*)?\]\]/gi;

/** Shared strict-wikilink membership test over `exo__Instance_class`. */
function instanceClassHasUid(
  fm: Record<string, unknown>,
  classUid: string,
): boolean {
  const classes = fm["exo__Instance_class"];
  const candidates: unknown[] = Array.isArray(classes) ? classes : [classes];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    WIKILINK_UID_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_UID_RE.exec(c)) !== null) {
      if (m[1].toLowerCase() === classUid) return true;
    }
  }
  return false;
}

/**
 * Predicate — does this frontmatter declare `exo__Instance_class` containing
 * the AssetSpace class UID? Handles both wikilink-string and array-of-string
 * shapes. Membership is decided by strict wikilink regex (not loose
 * substring). See Issue #3312.
 */
export function isAssetSpaceFrontmatter(fm: Record<string, unknown>): boolean {
  return instanceClassHasUid(fm, ASSET_SPACE_CLASS_UID);
}

/** Predicate — `exo__Instance_class` references `exo__FileSpace` (UUID form)? */
export function isFileSpaceFrontmatter(fm: Record<string, unknown>): boolean {
  return instanceClassHasUid(fm, FILE_SPACE_CLASS_UID);
}

/** Dual-read `exo__AssetSpace_source ?? _git` (RFC 01a83de8 v10). */
export function readSpaceSource(fm: Record<string, unknown>): string | null {
  const source = fm["exo__AssetSpace_source"];
  if (typeof source === "string" && source.length > 0) return source;
  const git = fm["exo__AssetSpace_git"];
  if (typeof git === "string" && git.length > 0) return git;
  return null;
}

// Strict allowlist — anchored, no paths/queries/fragments, no scheme
// variants. Mirrors `GitHubRestClient.REPO_URL_REGEX` (the plugin keeps its
// own copy for tarball pulls; the SYNC-unit shape is decided here).
const REPO_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;

/**
 * Strict GitHub repo URL parse — the sync layer's allowlist (same semantics
 * as the plugin's `validateRepoURL` + `parseGitHubURL` pair, collapsed into
 * one pure function): anchored `https://github.com/<owner>/<repo>`, ≤256
 * chars, no extra path segments, no path-traversal patterns. Returns null
 * on any mismatch (callers warn-and-skip; D12 warn-not-block).
 *
 * Verbatim quirk #5 (code-reviewer LOW, PR #3474): the legacy chain
 * stripped `.git` TWICE — the caller's normalisation plus the
 * `(?:\.git)?$` in `parseGitHubURL` — so `…/r.git.git` parsed as repo `r`.
 * Preserved here (case-sensitive second strip, exactly like the legacy
 * regex) to keep repoKeys — and therefore watermarks — stable.
 */
export function parseStrictGitHubRepoURL(
  url: string,
): { owner: string; repo: string } | null {
  if (typeof url !== "string" || url.length === 0 || url.length > 256) {
    return null;
  }
  if (!REPO_URL_REGEX.test(url)) return null;
  const trailing = url.slice("https://github.com/".length);
  const [owner, rawRepo, ...rest] = trailing.split("/");
  if (rest.length > 0) return null;
  if (owner === ".." || rawRepo === ".." || rawRepo.startsWith(".")) {
    return null;
  }
  const repo = rawRepo.replace(/\.git$/, "");
  if (repo.length === 0) return null;
  return { owner, repo };
}

/** One classified sync-unit candidate (existence check still pending). */
export interface SpaceSpecCandidate {
  spec: SyncRepoSpec;
  spaceKind: SpaceKind;
  /** `exo__Asset_uid` of the declaration asset (staging-dir veto input, D19). */
  asUid?: string;
}

/** Outcome of classifying ONE declaration's frontmatter. */
export type SpaceClassification =
  | { kind: "not-space" }
  | { kind: "skip"; warning?: string }
  | { kind: "candidate"; candidate: SpaceSpecCandidate; warning?: string };

/**
 * Classify one markdown asset's frontmatter as a sync-unit declaration.
 * Pure — no dedupe (that is the accumulator's job) and no existence check
 * (platform-specific). Behaviour is the exact port of the plugin's
 * `collectSyncRepoSpecs` per-file logic (PR #3461 lineage).
 */
export function classifySpaceDeclaration(
  fm: Record<string, unknown>,
  declPath: string,
): SpaceClassification {
  const isAsset = isAssetSpaceFrontmatter(fm);
  const isFile = isFileSpaceFrontmatter(fm);
  if (!isAsset && !isFile) return { kind: "not-space" };

  // Phase C: both Space subtypes are sync units. A declaration carrying
  // BOTH class UIDs is contradictory (disjoint in the TBox, R5
  // declarative-only) — the conservative `asset` wins (its md-only
  // allowlist can never corrupt attachments) with a warning.
  let bothClassesWarning: string | undefined;
  if (isAsset && isFile) {
    bothClassesWarning = `declaration at ${declPath} carries BOTH exo__AssetSpace and exo__FileSpace classes (disjoint) — treating as AssetSpace (conservative)`;
  }
  const spaceKind: SpaceKind = isAsset ? "asset" : "file";

  const source = readSpaceSource(fm);
  if (source === null) {
    if (spaceKind === "file") {
      return {
        kind: "skip",
        warning: `skipped FileSpace at ${declPath}: no exo__AssetSpace_source/_git — mount path underivable`,
      };
    }
    return { kind: "skip" };
  }

  // Normalize ONCE and feed the SAME string everywhere — the URL parser
  // strips `.git` case-sensitively while derivePath strips it
  // case-insensitively, so an unnormalized `.GIT` source would diverge
  // repo vs mount path (code-reviewer LOW, PR #3461).
  const normalized = source.replace(/\.git$/i, "");
  const parsed = parseStrictGitHubRepoURL(normalized);
  if (parsed === null) {
    return {
      kind: "skip",
      warning: `skipped AssetSpace at ${declPath}: source is not a plain https://github.com/<owner>/<repo> URL`,
    };
  }

  const localPath = derivePath(normalized);
  if (localPath === null) {
    return {
      kind: "skip",
      warning: `skipped AssetSpace at ${declPath}: cannot derive mount path from source`,
    };
  }

  const repoKey = `${parsed.owner}/${parsed.repo}#${SYNC_BRANCH}`;
  const rawUid = fm["exo__Asset_uid"];
  const asUid =
    typeof rawUid === "string" && rawUid.trim().length > 0
      ? rawUid.trim()
      : undefined;

  return {
    kind: "candidate",
    candidate: {
      spec: {
        owner: parsed.owner,
        repo: parsed.repo,
        branch: SYNC_BRANCH,
        repoKey,
        localPath,
        ...(spaceKind === "file" ? { spaceKind } : {}),
      },
      spaceKind,
      ...(asUid !== undefined ? { asUid } : {}),
    },
    ...(bothClassesWarning !== undefined
      ? { warning: bothClassesWarning }
      : {}),
  };
}

/**
 * Order-explicit accumulator for sync-unit candidates: dedupe by repoKey +
 * deterministic disjoint-kind conflict resolution (`asset` always wins —
 * vault iteration order is non-deterministic, advisor H6 of PR #3461).
 *
 * Caller protocol per declaration, preserving the plugin's exact semantics:
 *
 *   const spec = acc.offer(candidate);       // null ⇒ duplicate, consumed
 *   if (spec !== null && await exists(spec.localPath)) acc.commit(candidate);
 *
 * NOTE `offer()` registers the repoKey as seen even when the caller's
 * existence check later fails — a second declaration of the same repo never
 * re-enters (matches the historical plugin behaviour).
 */
export class SpaceSpecAccumulator {
  readonly specs: SyncRepoSpec[] = [];
  readonly warnings: string[] = [];
  /** AssetSpace ABox uid per repoKey — staging-dir veto input (D19). */
  readonly asUidByRepoKey = new Map<string, string>();
  private readonly seen = new Set<string>();
  private readonly kindByRepoKey = new Map<string, SpaceKind>();

  offer(candidate: SpaceSpecCandidate): SyncRepoSpec | null {
    const { spec, spaceKind } = candidate;
    if (this.seen.has(spec.repoKey)) {
      // Same repo declared twice with CONFLICTING kinds: the resolution must
      // be deterministic regardless of which declaration was seen first —
      // `asset` always wins (its md-only allowlist can never corrupt
      // attachments; the inverse could push text-decoded binary).
      const priorKind = this.kindByRepoKey.get(spec.repoKey);
      if (priorKind !== undefined && priorKind !== spaceKind) {
        this.warnings.push(
          `repo ${spec.repoKey} is declared as BOTH AssetSpace and FileSpace by different assets — treating as AssetSpace (deterministic, conservative); fix the vault (disjoint subtypes)`,
        );
        if (priorKind === "file") {
          this.kindByRepoKey.set(spec.repoKey, "asset");
          const committed = this.specs.find((s) => s.repoKey === spec.repoKey);
          if (committed !== undefined) delete committed.spaceKind;
        }
      }
      return null;
    }
    this.seen.add(spec.repoKey);
    this.kindByRepoKey.set(spec.repoKey, spaceKind);
    return spec;
  }

  commit(candidate: SpaceSpecCandidate): void {
    this.specs.push(candidate.spec);
    if (candidate.asUid !== undefined) {
      this.asUidByRepoKey.set(candidate.spec.repoKey, candidate.asUid);
    }
  }
}
