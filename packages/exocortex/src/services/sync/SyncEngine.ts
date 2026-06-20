/**
 * ExoSync SyncEngine — pull→merge→push orchestrator (RFC 4e4dc453, A1+A2).
 *
 * Per-repo cycle (VL#7): pull → conflict check → merge layer → push,
 * orchestrating the EXISTING write primitive `restCreateCommit` (D3 — no new
 * write path, no modification of the primitive). Conflicting assets go
 * through the optional {@link SyncEngineDeps.mergeLayer} (A2): `use-merged`
 * content is pushed and/or written to disk; `quarantine` routes both
 * versions to the {@link SyncEngineDeps.quarantine} sink (D17) and pins the
 * path in the watermark so the conflict re-derives until resolved. Without a
 * merge layer the engine keeps the A1 contract: any overlap (same uid or
 * same path, including delete-vs-modify) returns `conflict`, touches nothing.
 *
 * Deletes and renames PUSH (#3476): a local delete becomes a `sha: null`
 * tree entry in the same `restCreateCommit` chain (additive D3 contract
 * extension); a rename pushes the new path AND deletes the old path in ONE
 * commit. Safety rails: deletes only in fully-materialized repos (D19);
 * delete-vs-remote-modify routes through the merge layer / quarantine with
 * the deletion WITHHELD; a deletion already absent from the examined head
 * (convergent delete) is dropped — never sent (GitHub rejects sha:null for
 * absent paths); a deletion set that would empty the whole remote tree is
 * deferred (GitHub cannot create an empty tree).
 *
 * What this engine still does NOT do:
 *
 *  - NO binary content. Only {@link isSyncablePath} files participate,
 *    symmetrically (local snapshot, remote diff, pull-apply, delete
 *    inference) — attachments are Phase C (D4/VL#3).
 *
 * Convergence without CAS (D9/D16): the primitive has no expected-head
 * parameter; a concurrent push surfaces as HTTP 422 on the final PATCH
 * (`force:false` non-fast-forward) and is handled by re-pull → re-check →
 * retry, capped at {@link DEFAULT_MAX_PUSH_RETRIES}. The residual window
 * between this engine's conflict check and the primitive's internal fresh
 * GET-ref is detected post-push (parent != examined head) and reported as a
 * `race-window` warning when it overlaps pushed paths.
 *
 * Ordering & isolation (D12): `syncAll` is best-effort per repo —
 * warn-not-block, one failing repo never blocks the rest; callers supply
 * children-before-parent order (or use {@link orderChildrenFirst}).
 *
 * Split directions (#3473): `syncAll`/`sync` accept a {@link SyncDirection}.
 * `pull` runs the cycle with an EMPTY push set — `restCreateCommit` is never
 * called, local changes stay undiffed and re-derive on the next full Sync.
 * `push` detects+pushes the local delta but never applies remote changes to
 * disk — their paths are pinned (same carry-forward as TOCTOU pins) so they
 * re-derive instead of being silently reverted by a later stale push. Split
 * runs NEVER resolve conflicts: neither the A2 merge layer nor the file-mode
 * remote-wins policy (D18) fires; every conflicting path is pinned and
 * deferred to a full Sync (`RepoSyncResult.deferredPaths`). Note the A1
 * contract difference: a merge-layer-less full Sync aborts the whole repo on
 * the first overlap (`conflict` status), while a split run defers the
 * conflict and still processes the non-conflicting remainder.
 */

import {
  restCreateCommit,
  type CommitFileContent,
  type RestCommitRequest,
  type RestCommitTransport,
} from "../../infrastructure/github/restCommit";
import {
  SyncPhaseTimer,
  classifyRestPhase,
  type NowFn,
} from "./SyncPhaseTimer";
import {
  getBlobBytes,
  getBlobText,
  getCommitInfo,
  getHeadSha,
  getTree,
  type RemoteTreeEntry,
} from "./githubRepoReader";
import { detectChanges, extractAssetUid } from "./ChangeDetector";
import { bytesToBase64 } from "../../utilities/base64";
import { gitBlobSha } from "./gitBlobSha";
import { isAuthError } from "./CredentialStore";
import { scanForSecrets } from "./secretScan";
import { withRateLimitBackoff, type BackoffOptions } from "./transportBackoff";
import {
  DEFAULT_MAX_FILE_BYTES,
  contentEquals,
  isFileSpaceSyncablePath,
  isSyncablePath,
  type AssetChange,
  type ChangeDetectionResult,
  type LocalFilesPort,
  type MaterializationCheckPort,
  type MergeLayerPort,
  type MountBaseStorePort,
  type QuarantineEntry,
  type QuarantinePort,
  type RepoSyncResult,
  type Sha1Fn,
  type SyncContent,
  type SyncDirection,
  type SyncRepoSpec,
  type WatermarkFileEntry,
  type WatermarkRecord,
  type WatermarkStorePort,
} from "./syncTypes";

/** D16: retries after the first non-fast-forward failure. */
export const DEFAULT_MAX_PUSH_RETRIES = 3;

export interface SyncEngineDeps {
  transport: RestCommitTransport;
  watermarkStore: WatermarkStorePort;
  materializationCheck: MaterializationCheckPort;
  /** Working-tree access for one repo of the materialized set. */
  localFilesFor: (spec: SyncRepoSpec) => LocalFilesPort;
  /**
   * Per-device record of the commit SHA each repo was MOUNTED at (#3590).
   * Absent ⇒ no first-sync merge base is available, so a no-watermark
   * divergence stays the conservative `full-conflict` (status quo, zero
   * regression). When present, asset-mode first-sync uses the recorded SHA's
   * tree as the true 3-way merge base — a remote that advanced on disjoint
   * files since the mount cleanly merges instead of false-conflicting, while a
   * real overlapping edit still routes through the merge/quarantine layer
   * (M1 zero-loss intact). See {@link MountBaseStorePort}.
   */
  mountBaseStore?: MountBaseStorePort;
  /**
   * #3590 full fix — base BACKFILL source for repos MOUNTED BEFORE the mount
   * layer began recording the base (or by any path that never recorded one):
   * those have no `mountBaseStore` entry, so the v16.98.7 fix could not fire and
   * every first-sync on an advanced remote false-conflicted. When the store has
   * no entry for a repo, the engine asks this provider for the commit SHA the
   * LOCAL working tree is based on — the platform's AUTHORITATIVE checked-out
   * commit (desktop: the git submodule's HEAD). The returned SHA is NOT trusted
   * blindly: it goes through the SAME genuine-ancestor verification as a recorded
   * mount base (non-ancestor / unresolvable → conservative `full-conflict`,
   * never a guessed base / silent overwrite, M1 zero-loss). Returns `null` when
   * no authoritative source exists (mobile/REST mount, non-submodule, git
   * unavailable) → the conservative fallback is unchanged (no regression). On a
   * verified hit the engine persists the SHA into `mountBaseStore` (backfill), so
   * subsequent first-syncs reuse it without re-invoking the provider. Absent ⇒
   * pre-fix behaviour (only recorded mount bases are honoured).
   */
  localBaseShaProvider?: (spec: SyncRepoSpec) => Promise<string | null>;
  sha1: Sha1Fn;
  /**
   * Clock for the Phase 0 per-phase timing instrumentation (measure-first).
   * Defaults to `Date.now`. Injected in tests for deterministic durations.
   */
  now?: NowFn;
  baseURL?: string;
  /** Cap on 422 re-pull→retry cycles (D16). Default {@link DEFAULT_MAX_PUSH_RETRIES}. */
  maxPushRetries?: number;
  commitMessage?: (
    spec: SyncRepoSpec,
    fileCount: number,
    /** Deletions in the same commit (#3476). Older callbacks may ignore it. */
    deleteCount?: number,
  ) => string;
  /**
   * Defence-in-depth PAT redactor applied to error details/warnings and
   * forwarded to `restCreateCommit` (parity with the plugin's createCommit
   * path). Both production transports already redact their own error
   * strings; defaults to identity.
   */
  redact?: (message: string) => string;
  /**
   * A2 merge layer (production composition: `GatedStructuredMerger`). Absent
   * ⇒ A1 behavior: any local/remote overlap returns `conflict`, nothing
   * pushed, nothing written.
   */
  mergeLayer?: MergeLayerPort;
  /**
   * Quarantine sink for unresolvable / SHACL-invalid merges (D17) and for
   * D16 terminal-quarantine (contended files after retry exhaustion).
   * Production: `SyncedQuarantineStore`. Optional — skipping it loses no
   * data: the file stays untouched on disk and the watermark pin (or the
   * non-advanced watermark) re-derives the conflict every sync.
   */
  quarantine?: QuarantinePort;
  /**
   * Rate-limit backoff tuning (R6). The engine always wraps the transport
   * with `withRateLimitBackoff`; inject `sleep`/`random` in tests.
   */
  backoff?: BackoffOptions;
  /**
   * Per-file size cap for file-mode repos (Phase C). Oversized files are
   * excluded symmetrically with a warning. Default
   * {@link DEFAULT_MAX_FILE_BYTES}.
   */
  maxFileBytes?: number;
}

/**
 * #3498 — coarse in-flight phases observed WHILE a single repo is processing.
 * A UI surfaces them as live trace lines («detecting… / pulling remote tree… /
 * merge layer firing…»). Strictly observation-only — the engine never branches
 * on the observer.
 */
export type SyncProgressPhase = "detecting" | "pulling-remote" | "merging";

/** A single in-flight progress event (#3498). */
export interface SyncProgressEvent {
  /** Repo key the phase belongs to (matches `RepoSyncResult.repoKey`). */
  repoKey: string;
  phase: SyncProgressPhase;
}

/**
 * Observation-only progress callback (#3498). It MUST NOT affect the sync
 * outcome — the engine wraps every call in a try/catch so a faulty observer
 * can never throw into the cycle (info-channel discipline #3186; the consumer
 * routes these to the info channel, never the warn channel).
 */
export type SyncProgressFn = (event: SyncProgressEvent) => void;

/**
 * Mode-scoped helpers (Phase C). Computed ONCE per repo in `syncLocked`
 * and threaded through — the syncable predicate MUST be applied
 * identically at every tree/snapshot site (disk snapshot, remote diff,
 * bootstrap, watermark build, race-window check); an asymmetric filter
 * would invert exclusions into phantom adds/deletes.
 */
interface ModeOps {
  fileMode: boolean;
  syncable: (path: string) => boolean;
  /** Remote tree entry filter: syncable path AND under the size cap. */
  treeFilter: (e: RemoteTreeEntry) => boolean;
}

/** UTF-8 strict decode — `null` for content that is not valid UTF-8. */
function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Engine content → write-primitive content (bytes go base64). */
function toCommitContent(content: SyncContent): CommitFileContent {
  return typeof content === "string"
    ? content
    : { base64: bytesToBase64(content) };
}

/**
 * Byte-exact port access with a LOUD failure (Phase C port contract). The
 * engine pre-flights the methods' presence before any mutation; these
 * guards are the type-safe second line — a throw here surfaces as the
 * repo's `error` result, never silent corruption.
 */
async function readBinaryStrict(
  port: LocalFilesPort,
  path: string,
): Promise<Uint8Array> {
  if (port.readBinary === undefined) {
    throw new Error(
      "LocalFilesPort.readBinary is required for file-mode sync (Phase C)",
    );
  }
  return port.readBinary(path);
}

async function writeBinaryStrict(
  port: LocalFilesPort,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  if (port.writeBinary === undefined) {
    throw new Error(
      "LocalFilesPort.writeBinary is required for file-mode sync (Phase C)",
    );
  }
  return port.writeBinary(path, bytes);
}

/** Reject absolute, backslash, empty-segment, `.`/`..` paths (zip-slip guard). */
function isSafeRepoRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return path.split("/").every((s) => s.length > 0 && s !== "." && s !== "..");
}

/**
 * Non-fast-forward detection. Both production transports (plugin
 * `GitHubRestClient`, CLI `RestPushService`) throw HTTP errors with the
 * message shape `GitHub request {METHOD} {url} → HTTP {status}: {body}` —
 * an informal contract this matcher depends on (kept loose on purpose).
 * The structural `ref update mismatch` error from the primitive (PATCH
 * succeeded but the ref moved elsewhere) is treated as retryable too.
 */
export function isNonFastForwardError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    (/HTTP 422/.test(msg) && /git\/refs/.test(msg)) ||
    /ref update mismatch/.test(msg) ||
    // #3476 deletion race: a concurrent commit removed/renamed a deletion
    // target between this engine's absence guard and the tree POST —
    // GitHub rejects the sha:null entry with 422 GitRPC::BadObjectState.
    // Retryable like a ref race: the D16 re-pull recomputes the deletion
    // set and the absence guard drops the vanished path.
    (/HTTP 422/.test(msg) &&
      /git\/trees/.test(msg) &&
      /BadObjectState/.test(msg))
  );
}

/** Sort children before parents (D12): deeper localPath syncs first. */
export function orderChildrenFirst(specs: SyncRepoSpec[]): SyncRepoSpec[] {
  const depth = (p: string): number =>
    p.split("/").filter((s) => s.length > 0).length;
  return [...specs].sort((a, b) => depth(b.localPath) - depth(a.localPath));
}

/** Remote change derived from the base..head tree diff. */
interface RemoteChange {
  path: string;
  kind: "change" | "delete";
  /** For `change`: blob SHA + fetched content + parsed uid. */
  blobSha?: string;
  /** Text in asset mode; raw bytes in file mode (Phase C). */
  content?: SyncContent;
  uid?: string;
}

function diffTrees(
  base: WatermarkFileEntry[],
  head: RemoteTreeEntry[],
): { changed: RemoteTreeEntry[]; deleted: WatermarkFileEntry[] } {
  const baseByPath = new Map(base.map((e) => [e.path, e]));
  const headPaths = new Set<string>();
  const changed: RemoteTreeEntry[] = [];
  for (const h of head) {
    headPaths.add(h.path);
    const b = baseByPath.get(h.path);
    if (b === undefined || b.blobSha !== h.blobSha) changed.push(h);
  }
  const deleted = base.filter((b) => !headPaths.has(b.path));
  return { changed, deleted };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Replace pinned paths' new-tree entries with their PREVIOUS watermark entry.
 * A pinned path's remote change was never applied to disk (TOCTOU skip,
 * unsafe path, quarantined conflict) — keeping the old base entry makes the
 * divergence re-derive on the next sync instead of silently inverting into a
 * phantom local edit. Pinned paths with no previous entry are dropped
 * entirely (a never-seen remote add re-surfaces as a remote add); pinned
 * paths missing from the new tree (skipped remote delete) keep their old
 * entry appended so the delete re-derives too.
 */
function applyWatermarkPins(
  files: WatermarkFileEntry[],
  previous: WatermarkRecord,
  pinnedPaths: ReadonlySet<string>,
): WatermarkFileEntry[] {
  if (pinnedPaths.size === 0) return files;
  const prevByPath = new Map(previous.files.map((e) => [e.path, e]));
  const newPaths = new Set(files.map((e) => e.path));
  const out: WatermarkFileEntry[] = [];
  for (const f of files) {
    if (!pinnedPaths.has(f.path)) {
      out.push(f);
      continue;
    }
    const prev = prevByPath.get(f.path);
    if (prev !== undefined) out.push(prev);
  }
  for (const p of pinnedPaths) {
    if (newPaths.has(p)) continue;
    const prev = prevByPath.get(p);
    if (prev !== undefined) out.push(prev);
  }
  return out;
}

/** Local change-set pinned for the whole D16 retry loop. */
interface PinnedLocalChanges {
  localChanges: AssetChange[];
  localDeletedPaths: Set<string>;
  pushFilesAll: Map<string, SyncContent>;
  /**
   * Deletions to PUSH (#3476): deletePath → owner local path. The owner is
   * the local change the deletion belongs to — the deleted path itself for
   * a plain delete, the NEW path for a rename — so the push loop can
   * withhold a deletion whenever its owner conflicted/converged (the
   * conflict outcome replaces the raw push, deletion included).
   */
  pushDeletionsAll: Map<string, string>;
  /**
   * Uids duplicated on disk or in the base (#3477) — uid-based remote
   * matching is suppressed for them (path identity for the whole group).
   */
  dupUids: ReadonlySet<string>;
}

/** One local change overlapping one-or-more remote changes (merge input). */
interface ConflictGroup {
  local: AssetChange;
  localIsDelete: boolean;
  remotes: RemoteChange[];
  desc: string;
}

/** Per-iteration verdict of the A2 merge layer over all conflict groups. */
interface MergeResolution {
  /** path → merged content to PUSH (differs from what the remote has). */
  mergedFiles: Map<string, string>;
  /** Merged contents to write to DISK (differ from the local copy). */
  mergedWrites: RemoteChange[];
  /**
   * Unresolved conflicts (D17): flushed to the sink AND pinned in the
   * watermark so they re-derive every sync until the user resolves them.
   */
  quarantineEntries: QuarantineEntry[];
  /**
   * Phase C file-mode remote-wins copies (D18): the conflict is ALREADY
   * resolved on disk (remote version applied; losing local version inside
   * the entry). Flushed to the sink for durability but NOT pinned —
   * pinning would re-derive a settled conflict and the next sync's
   * convergence would auto-`markResolved` the record before the user saw
   * it (advisor C2).
   */
  resolvedQuarantineEntries: QuarantineEntry[];
  mergedCount: number;
  /** Paths of successful merges — surfaced as `RepoSyncResult.mergedPaths` (E1). */
  mergedPaths: string[];
  warnings: string[];
}

/** Outcome of the pull→check→push retry loop. */
type PushLoopOutcome =
  | { kind: "conflict"; detail: string }
  | {
      kind: "retry-exhausted";
      detail: string;
      /** The contended payload of the LAST attempt — terminal-quarantine input (D16→D17). */
      pushFiles: Map<string, SyncContent>;
      /** Last iteration's merge resolution — its quarantine entries must not be lost. */
      merge: MergeResolution;
    }
  | { kind: "secret-detected"; detail: string }
  | {
      kind: "done";
      examinedHead: string;
      pushedSha: string | undefined;
      applyWrites: RemoteChange[];
      applyDeletes: RemoteChange[];
      pushFiles: Map<string, SyncContent>;
      /** Deletions propagated in the pushed commit (#3476). */
      pushedDeletions: string[];
      /**
       * Deletions detected but WITHHELD this cycle (#3476): the owner local
       * change conflicted/converged (its outcome replaces the raw push) or
       * the deletion set would have emptied the whole remote tree. They
       * re-derive next sync — surfaced as `deferredDeletes`.
       */
      withheldDeletions: string[];
      merge: MergeResolution;
      /** REMOTE paths excluded by the size cap (file mode) — pinned by the caller. */
      remoteOversized: Set<string>;
      /**
       * Detected-but-NOT-pushed paths whose bytes were already identical in
       * the examined head tree (#3475 phantom-commit guard). Non-empty ⇒ the
       * per-file watermark snapshot is stale for these paths — the caller
       * must fall through to the full watermark rebuild so they converge.
       */
      alreadyInHead: string[];
      /**
       * Split-run deferrals (#3473) — paths the caller must PIN: conflicts
       * (any split direction) and push-only's unapplied remote changes.
       */
      deferredPaths: Set<string>;
      /**
       * Push-only's detected-but-NEVER-applied remote changes. Fed to the
       * watermark rebuild as a content-addressed uid-seed ONLY (their blobs
       * are already fetched — re-fetching would burn one API call each);
       * the entries themselves are discarded by the pin carry-forward.
       */
      deferredRemoteChanges: RemoteChange[];
      /**
       * Deferral warnings of the FINAL iteration (per-iteration like
       * `merge.warnings` — pushing them into the cumulative array inside
       * the D16 retry loop would duplicate them per attempt).
       */
      deferredWarnings: string[];
    };

/**
 * Outcome of the ASSET-mode first-sync probe ({@link SyncEngine.bootstrapWatermark}).
 *  - `settled`: the cycle is fully decided here — a clean mount (local tree
 *    identical to remote) was seeded → `synced`, or a GENUINE divergence (a
 *    remote-head file absent locally, or a same-path content difference) →
 *    `full-conflict` (A2/A3, D22 — never a silent overwrite).
 *  - `additive-base`: the local tree is a pure SUPERSET of the remote head
 *    (R ⊆ L by path+blob — only local-only new files diverge, #3565). The
 *    caller continues the normal cycle with this synthetic base so the
 *    local-only files derive as pushable adds (a clean fast-forward).
 */
type FirstSyncBootstrap =
  | { kind: "settled"; outcome: RepoSyncResult }
  | { kind: "additive-base"; base: WatermarkRecord };

const EMPTY_MERGE: MergeResolution = {
  mergedFiles: new Map(),
  mergedWrites: [],
  quarantineEntries: [],
  resolvedQuarantineEntries: [],
  mergedCount: 0,
  mergedPaths: [],
  warnings: [],
};

/** path → blobSha lookup over a (raw) remote tree listing. */
function treeByPath(entries: RemoteTreeEntry[]): Map<string, string> {
  return new Map(entries.map((e) => [e.path, e.blobSha]));
}

/** Per-path quarantine identity for `RepoSyncResult.quarantinedPaths` (E1). */
function quarantinedPathsOf(merge: MergeResolution): string[] {
  return [
    ...merge.quarantineEntries.map((e) => e.path),
    ...merge.resolvedQuarantineEntries.map((e) => e.path),
  ];
}

export class SyncEngine {
  private readonly deps: SyncEngineDeps;
  /**
   * Backoff-wrapped transport (R6) — ALL remote calls go through it. Phase 0:
   * additionally wrapped with timing instrumentation so every REST round-trip
   * is attributed to a phase bucket (observation-only, never branches).
   */
  private readonly transport: RestCommitTransport;
  /**
   * Phase 0: timing-wrapped `sha1`. ALL hashing goes through `gitBlobSha(_,
   * this.sha1)` so the `hash` bucket captures the hypothesised hot path.
   */
  private readonly sha1: Sha1Fn;
  /** Phase 0 clock (default `Date.now`; injected in tests). */
  private readonly now: NowFn;
  /**
   * Phase 0: the timer of the AS currently being synced. Set by `syncLocked`
   * and read by the transport/sha1/localFiles chokepoint wrappers. Safe as a
   * single field because syncs are serialised by the D11 `opInProgress`
   * guard; `null` outside a sync (the wrappers skip timing then).
   */
  private activeTimer: SyncPhaseTimer | null = null;
  /** D11 — one sync/apply operation at a time. */
  private opInProgress = false;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
    this.now = deps.now ?? ((): number => Date.now());
    this.transport = this.instrumentTransport(
      withRateLimitBackoff(deps.transport, deps.backoff),
    );
    this.sha1 = this.instrumentSha1(deps.sha1);
  }

  /**
   * Phase 0 — wrap the transport so every REST round-trip is timed into its
   * phase bucket (by URL/method) and counted. Transparent pass-through: same
   * args, same return, same throw; timing accrues in `finally`. No-op when no
   * sync is in flight (`activeTimer === null`).
   */
  private instrumentTransport(raw: RestCommitTransport): RestCommitTransport {
    return async (req: RestCommitRequest) => {
      const timer = this.activeTimer;
      if (timer === null) return raw(req);
      timer.bumpRest();
      return timer.time(classifyRestPhase(req), () => raw(req));
    };
  }

  /**
   * Phase 0 — wrap `sha1` so every digest accrues to the `hash` bucket and the
   * hashed-file count. `gitBlobSha` calls this exactly once per file, so the
   * bucket ≈ wall-clock spent hashing all files.
   */
  private instrumentSha1(raw: Sha1Fn): Sha1Fn {
    return (data) => {
      const timer = this.activeTimer;
      if (timer === null) return raw(data);
      timer.bumpHashed();
      return timer.time("hash", () => raw(data));
    };
  }

  /**
   * Phase 0 — wrap a per-repo `LocalFilesPort` so the directory walk, file
   * reads and pull-applied writes are timed. Transparent: every method
   * delegates; only the timed ones are decorated. Optional byte-port methods
   * are forwarded only when the underlying port provides them.
   */
  private instrumentLocalFiles(raw: LocalFilesPort): LocalFilesPort {
    const timed = <T>(
      phase: Parameters<SyncPhaseTimer["time"]>[0],
      op: () => Promise<T>,
    ): Promise<T> => {
      const timer = this.activeTimer;
      return timer === null ? op() : timer.time(phase, op);
    };
    const wrapped: LocalFilesPort = {
      list: () => timed("localList", () => raw.list()),
      read: (path) => {
        this.activeTimer?.bumpRead();
        return timed("localRead", () => raw.read(path));
      },
      write: (path, content) =>
        timed("localWrite", () => {
          this.activeTimer?.bumpWritten();
          return raw.write(path, content);
        }),
      delete: (path) => raw.delete(path),
    };
    // Bind the optional byte-port methods to `raw` so the wrapper closures call
    // a plain bound function — no non-null assertion, no unbound-method.
    const rawReadBinary = raw.readBinary?.bind(raw);
    if (rawReadBinary !== undefined) {
      wrapped.readBinary = (path) => {
        this.activeTimer?.bumpRead();
        return timed("localRead", () => rawReadBinary(path));
      };
    }
    const rawWriteBinary = raw.writeBinary?.bind(raw);
    if (rawWriteBinary !== undefined) {
      wrapped.writeBinary = (path, bytes) =>
        timed("localWrite", () => {
          this.activeTimer?.bumpWritten();
          return rawWriteBinary(path, bytes);
        });
    }
    return wrapped;
  }

  /**
   * D11 busy verdict — the caller retries after the running op finishes.
   * Scope note: the guard currently covers SYNC operations of this engine
   * instance only; wiring the profile-APPLY side into the same exclusion
   * is Phase B composition scope (the apply path has its own
   * `_switchInProgress` journal today).
   */
  private busyResult(spec: SyncRepoSpec): RepoSyncResult {
    return {
      repoKey: spec.repoKey,
      status: "busy",
      pulledCount: 0,
      pushedCount: 0,
      mergedCount: 0,
      quarantinedCount: 0,
      warnings: [],
      deferredDeletes: [],
      detail:
        "another sync operation is in progress (D11 guard) — retry after it finishes",
    };
  }

  /**
   * Mode-scoped predicate set, computed ONCE per repo (advisor H2: the
   * SAME predicate must gate all six tree/snapshot sites symmetrically).
   */
  private modeOps(spec: SyncRepoSpec): ModeOps {
    const fileMode = spec.spaceKind === "file";
    const syncable = fileMode ? isFileSpaceSyncablePath : isSyncablePath;
    const maxBytes = this.deps.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    return {
      fileMode,
      syncable,
      treeFilter: (e: RemoteTreeEntry): boolean =>
        syncable(e.path) &&
        // Size cap applies in file mode only; entries without a reported
        // size pass (their blob fetch is the authority).
        (!fileMode || e.size === undefined || e.size <= maxBytes),
    };
  }

  /**
   * Phase C file-mode first-sync base (advisor C1): a synthetic watermark
   * whose file set is the disk∩head intersection of ALREADY-IDENTICAL
   * blobs. Fed into the normal cycle, this makes every divergence derive
   * naturally: local-only files → adds (pushed), remote-only/differing
   * files → remote changes (pulled, or remote-wins + quarantine on
   * overlap). NOT persisted — the real watermark is written by
   * `advanceWatermark` at the end of the successful cycle.
   */
  private async buildFileModeFirstSyncBase(
    spec: SyncRepoSpec,
    disk: ReadonlyMap<string, SyncContent>,
    mode: ModeOps,
    warnings: string[],
  ): Promise<WatermarkRecord> {
    const head = await getHeadSha(
      this.transport,
      spec.owner,
      spec.repo,
      spec.branch,
      this.deps.baseURL,
    );
    const headCommit = await getCommitInfo(
      this.transport,
      spec.owner,
      spec.repo,
      head,
      this.deps.baseURL,
    );
    const headTree = (
      await getTree(
        this.transport,
        spec.owner,
        spec.repo,
        headCommit.treeSha,
        this.deps.baseURL,
      )
    ).filter(mode.treeFilter);

    const files: WatermarkFileEntry[] = [];
    for (const entry of headTree) {
      const content = disk.get(entry.path);
      if (content === undefined) continue;
      if ((await gitBlobSha(content, this.sha1)) === entry.blobSha) {
        files.push({ path: entry.path, blobSha: entry.blobSha });
      }
    }
    warnings.push(
      `first-sync (file mode): synthetic base from ${files.length} already-identical file(s) at head ${head} — divergence resolves through the remote-wins layer (D22)`,
    );
    return {
      lastSyncedSha: head,
      rootTreeSha: headCommit.treeSha,
      files,
      spaceKind: "file",
    };
  }

  /**
   * Sync every repo of the materialized set, best-effort (D12): a per-repo
   * failure becomes that repo's `error` result, never an exception. Specs are
   * processed in the given order — pass children before parents (use
   * {@link orderChildrenFirst}). Acquires the D11 guard ONCE for the whole
   * run — per-repo cycles inside never see their own guard.
   */
  async syncAll(
    specs: SyncRepoSpec[],
    direction: SyncDirection = "sync",
    onProgress?: SyncProgressFn,
  ): Promise<RepoSyncResult[]> {
    if (this.opInProgress) return specs.map((spec) => this.busyResult(spec));
    this.opInProgress = true;
    try {
      const results: RepoSyncResult[] = [];
      for (const spec of specs) {
        results.push(await this.syncLocked(spec, direction, onProgress));
      }
      return results;
    } finally {
      this.opInProgress = false;
    }
  }

  /** Sync one repo. Never throws — failures map to a result status (CQ5). */
  async sync(
    spec: SyncRepoSpec,
    direction: SyncDirection = "sync",
    onProgress?: SyncProgressFn,
  ): Promise<RepoSyncResult> {
    if (this.opInProgress) return this.busyResult(spec);
    this.opInProgress = true;
    try {
      return await this.syncLocked(spec, direction, onProgress);
    } finally {
      this.opInProgress = false;
    }
  }

  /**
   * Fire an in-flight progress event (#3498). Observation-only: a throwing
   * observer is swallowed so it can never affect the sync outcome.
   */
  private emitProgress(
    onProgress: SyncProgressFn | undefined,
    repoKey: string,
    phase: SyncProgressPhase,
  ): void {
    if (onProgress === undefined) return;
    try {
      onProgress({ repoKey, phase });
    } catch {
      // observation-only — never let a faulty observer break the cycle
    }
  }

  private async syncLocked(
    spec: SyncRepoSpec,
    direction: SyncDirection = "sync",
    onProgress?: SyncProgressFn,
  ): Promise<RepoSyncResult> {
    // Phase 0 — fresh per-AS timer. Set as the engine's `activeTimer` so the
    // transport/sha1/localFiles chokepoint wrappers attribute their durations
    // to this repo, and restored in `finally` (nested safe via save/restore).
    const timer = new SyncPhaseTimer(this.now);
    const prevTimer = this.activeTimer;
    this.activeTimer = timer;
    const warnings: string[] = [];
    const deferredDeletes: string[] = [];
    // Deletions detected this cycle whose push loop is still IN FLIGHT —
    // a non-retryable throw mid-loop lands in the catch below, which must
    // still report them as deferred (contract: never silently dropped).
    // Cleared once the loop returns (its outcome handling owns reporting).
    let inFlightDeletionPaths: string[] = [];
    const result = (
      status: RepoSyncResult["status"],
      extra: Partial<RepoSyncResult> = {},
    ): RepoSyncResult => ({
      repoKey: spec.repoKey,
      status,
      pulledCount: 0,
      pushedCount: 0,
      mergedCount: 0,
      quarantinedCount: 0,
      warnings,
      deferredDeletes,
      // Phase 0 — snapshot at the return point captures the full breakdown
      // for whatever phases ran (early skips snapshot ~zero, harmless).
      timings: timer.snapshot(),
      ...extra,
    });

    try {
      // D19 — full-materialization gate. Skipped repo: no diff, no push, and
      // critically NO delete inference from local absence.
      const gate = await this.deps.materializationCheck.check(spec);
      if (!gate.fullyMaterialized) {
        warnings.push(
          `skipped: repo not fully materialized${gate.reason ? ` (${gate.reason})` : ""} — deletes NOT inferred (D19)`,
        );
        return result("skipped-not-materialized");
      }

      const mode = this.modeOps(spec);
      // Phase 0 — instrument the per-repo port so local list/read/write
      // durations attribute to this AS's timer (the hypothesised hot path).
      const localFiles = this.instrumentLocalFiles(
        this.deps.localFilesFor(spec),
      );
      if (
        mode.fileMode &&
        (localFiles.readBinary === undefined ||
          localFiles.writeBinary === undefined)
      ) {
        // Loud, not silent: a string round-trip would corrupt binary
        // content, so a file-mode repo without byte-exact port methods
        // must never sync (Phase C port contract).
        return result("error", {
          detail:
            "file-mode repo requires a LocalFilesPort with readBinary/writeBinary — refusing to sync through the text-only port (binary would corrupt)",
        });
      }
      if (mode.fileMode && this.deps.quarantine === undefined) {
        // D18 remote-wins DESTROYS the local version on disk; the losing
        // bytes exist nowhere else, so a durable quarantine sink is a hard
        // prerequisite for file mode — unlike asset mode, where "no sink"
        // degrades safely (nothing is overwritten, pins re-derive).
        // Reviewer CRITICAL (AC2 zero-data-loss).
        return result("error", {
          detail:
            "file-mode repo requires a quarantine sink (D18 remote-wins preserves losing local bytes there) — configure the quarantine repo before syncing FileSpaces",
        });
      }

      const maxBytes = this.deps.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
      const disk = new Map<string, SyncContent>();
      // Paths excluded by the size cap on the LOCAL side. The exclusion
      // must hold across every representation (disk snapshot, diff base,
      // remote diff, watermark) — a path visible on one side only would
      // read as a phantom add/delete (reviewer HIGH: cap-boundary
      // crossing).
      const sizeExcluded = new Set<string>();
      for (const path of (await localFiles.list()).filter(mode.syncable)) {
        if (mode.fileMode) {
          const bytes = await readBinaryStrict(localFiles, path);
          if (bytes.byteLength > maxBytes) {
            sizeExcluded.add(path);
            warnings.push(
              `skipped oversized file ${path} (${bytes.byteLength} bytes > ${maxBytes} cap) — excluded from sync symmetrically (Phase C size cap)`,
            );
            continue;
          }
          disk.set(path, bytes);
        } else {
          disk.set(path, await localFiles.read(path));
        }
      }

      let watermark = await this.deps.watermarkStore.get(spec.repoKey);
      // Kind-flip guard (reviewer MEDIUM — makes the documented downgrade
      // marker operational): a file-mode watermark read by an asset-mode
      // sync would md-filter the head tree and infer phantom deletes for
      // every binary entry.
      if (watermark?.spaceKind === "file" && !mode.fileMode) {
        return result("error", {
          detail:
            "watermark was written by a FILE-mode sync but the spec now resolves to asset mode — refusing (fix the conflicting Space declarations, or clear the watermark to restart)",
        });
      }
      // Reverse flip (asset watermark + file-mode spec): the md-only base
      // would make every local binary read as an ADD and push over
      // unexamined remote versions. Rebuild through the file-mode
      // first-sync layer instead — divergence goes through remote-wins
      // (advisor round-2).
      if (
        watermark !== null &&
        mode.fileMode &&
        watermark.spaceKind !== "file"
      ) {
        warnings.push(
          "watermark was written by an ASSET-mode sync — rebuilding the base through the file-mode first-sync layer (kind flip)",
        );
        watermark = null;
      }
      let syntheticFirstSyncBase = false;
      if (watermark === null) {
        if (!mode.fileMode) {
          // Asset-mode first-sync (#3565). A clean mount (local tree identical
          // to remote) seeds the watermark and no-ops. A PURELY ADDITIVE
          // divergence — local-only new files, every remote-head file still
          // present on disk byte-identical (R ⊆ L) — hands back a synthetic
          // base so those locals derive as pushable adds (a clean
          // fast-forward, no remote changes to reconcile). A GENUINE
          // divergence (a remote file absent locally, or a same-path content
          // difference) stays `full-conflict` — routed to the merge/quarantine
          // layer (A2/A3, D22), never a silent overwrite.
          const bootstrap = await this.bootstrapWatermark(
            spec,
            disk,
            warnings,
            result,
          );
          if (bootstrap.kind === "settled") return bootstrap.outcome;
          syntheticFirstSyncBase = true;
          watermark = bootstrap.base;
        } else {
          syntheticFirstSyncBase = true;
          // Phase C file-mode first-sync (advisor C1): there is no exact-match
          // requirement — divergence resolves through the remote-wins layer,
          // which IS the file-mode merge/quarantine layer (D22-compatible).
          // The synthetic base = the intersection of disk and remote head
          // where blobs already match; everything else derives as local adds
          // (pushed — may re-create files another device deleted; data
          // resurrection is the accepted first-sync trade-off, M1 zero-loss
          // wins) or remote changes (pulled / conflicting → remote-wins).
          watermark = await this.buildFileModeFirstSyncBase(
            spec,
            disk,
            mode,
            warnings,
          );
        }
      }

      // A size-excluded LOCAL path must also vanish from the diff base —
      // its watermark entry would otherwise read as a local delete (and a
      // remote edit on it would silently overwrite the oversized local
      // file via the conflict path). The UNFILTERED record survives as
      // `persistedWatermark`: the watermark advance pins excluded paths
      // and carries their previous entries forward, so a file crossing
      // back under the cap derives as a modify/conflict — never as a
      // fresh ADD that could push over an unexamined remote version.
      const persistedWatermark = watermark;
      if (mode.fileMode && sizeExcluded.size > 0) {
        watermark = {
          ...watermark,
          files: watermark.files.filter((f) => !sizeExcluded.has(f.path)),
        };
      }

      this.emitProgress(onProgress, spec.repoKey, "detecting");
      const detection = await detectChanges({
        localFiles: disk,
        watermark,
        actualBaseTreeSha: await this.resolveBaseTreeSha(spec, watermark),
        sha1: this.sha1,
      });
      if (detection.kind === "full-conflict") {
        return result("full-conflict", {
          detail: `${detection.reason}${detection.detail ? `: ${detection.detail}` : ""} — divergence must go through merge/quarantine (A2/A3), not overwrite`,
        });
      }
      warnings.push(...detection.warnings);

      const pinned = this.pinLocalChanges(
        detection,
        disk,
        warnings,
        deferredDeletes,
        direction,
      );
      inFlightDeletionPaths = [...pinned.pushDeletionsAll.keys()];

      const loop = await this.runPushLoop(
        spec,
        watermark,
        pinned,
        disk,
        warnings,
        mode,
        syntheticFirstSyncBase,
        sizeExcluded,
        direction,
        onProgress,
      );
      inFlightDeletionPaths = [];
      if (loop.kind !== "done" && pinned.pushDeletionsAll.size > 0) {
        // Nothing was pushed on these outcomes — every detected deletion is
        // honestly deferred (re-derives next sync).
        deferredDeletes.push(...pinned.pushDeletionsAll.keys());
      }
      if (loop.kind === "conflict") {
        return result("conflict", { detail: loop.detail });
      }
      if (loop.kind === "secret-detected") {
        return result("error", { detail: loop.detail });
      }
      if (loop.kind === "retry-exhausted") {
        // D16 terminal-quarantine: the contended files of the last attempt
        // PLUS any pending merge-quarantine entries (they would otherwise be
        // lost — the loop recomputes the merge per iteration). The watermark
        // is NOT advanced, so everything re-derives next sync regardless.
        warnings.push(...loop.merge.warnings);
        const terminal = await this.buildTerminalQuarantineEntries(
          spec,
          watermark,
          loop.pushFiles,
          loop.merge.quarantineEntries,
          disk,
        );
        const entries = [
          ...loop.merge.quarantineEntries,
          ...loop.merge.resolvedQuarantineEntries,
          ...terminal,
        ];
        await this.flushQuarantine(entries, warnings);
        return result("retry-exhausted", {
          detail: loop.detail,
          quarantinedCount: entries.length,
          ...(entries.length > 0
            ? { quarantinedPaths: entries.map((e) => e.path) }
            : {}),
        });
      }
      const { examinedHead, pushedSha, applyWrites, applyDeletes, pushFiles } =
        loop;
      const merge = loop.merge;
      warnings.push(...merge.warnings);
      warnings.push(...loop.deferredWarnings);
      // Withheld deletions (#3476: conflicted owner / empty-tree refusal)
      // re-derive next sync — reported, never silently dropped.
      deferredDeletes.push(...loop.withheldDeletions);
      const deferredExtra: Partial<RepoSyncResult> =
        loop.deferredPaths.size > 0
          ? { deferredPaths: [...loop.deferredPaths] }
          : {};
      const pushedDeletesExtra: Partial<RepoSyncResult> =
        loop.pushedDeletions.length > 0
          ? { pushedDeletes: loop.pushedDeletions }
          : {};

      // Quarantine sink fires ONCE, after the retry loop settled (D17). The
      // UNRESOLVED entries' paths are pinned below so the conflict
      // re-derives next sync; remote-wins RESOLVED entries (file mode) are
      // flushed for durability but never pinned (advisor C2 — a pin would
      // auto-markResolved the record on the next convergent sync).
      const flushed = await this.flushQuarantine(
        [...merge.quarantineEntries, ...merge.resolvedQuarantineEntries],
        warnings,
      );

      // Reviewer CRITICAL (AC2): the remote-wins apply DESTROYS the local
      // version, whose only surviving copy is the quarantine entry — when
      // the flush did not durably persist, the destructive applies for
      // those paths are withheld (disk untouched) and the paths are pinned
      // so the conflict re-derives next sync, flush retried.
      const withheldPaths = new Set<string>();
      if (!flushed && merge.resolvedQuarantineEntries.length > 0) {
        for (const entry of merge.resolvedQuarantineEntries) {
          withheldPaths.add(entry.path);
        }
        warnings.push(
          `quarantine flush failed — remote-wins apply withheld for ${withheldPaths.size} path(s); local files untouched, conflict re-derives next sync (D18 durability gate)`,
        );
      }

      // No-op fast path: nothing pushed, head unmoved, nothing to apply —
      // the watermark is already exact; skip the head-tree fetch and the
      // full watermark rebuild (A1 perf finding: double hashing on no-op).
      // A pinned watermark is NOT exact by construction — fall through so a
      // convergently-resolved pin gets cleared by the full rebuild.
      if (
        pushedSha === undefined &&
        examinedHead === watermark.lastSyncedSha &&
        applyWrites.length === 0 &&
        applyDeletes.length === 0 &&
        merge.mergedWrites.length === 0 &&
        merge.quarantineEntries.length === 0 &&
        merge.resolvedQuarantineEntries.length === 0 &&
        (watermark.pinnedPaths?.length ?? 0) === 0 &&
        // Dropped already-in-HEAD paths (#3475) mean the per-file snapshot
        // is stale — fall through so the rebuild converges it (otherwise
        // the phantom re-derives on every sync).
        loop.alreadyInHead.length === 0 &&
        // Split-run deferrals (#3473) must persist their pins. Defence-in-
        // depth: deferral only happens in the remote-diff branch, whose
        // three gates (head moved / pins / forceRemoteDiff) each already
        // block this fast path.
        loop.deferredPaths.size === 0 &&
        // First-sync synthetic base (file mode) must still PERSIST the
        // watermark even when nothing changed — otherwise every sync
        // re-runs first-sync discovery.
        !syntheticFirstSyncBase
      ) {
        return result("synced");
      }

      const newHead = pushedSha ?? examinedHead;
      const newCommit = await getCommitInfo(
        this.transport,
        spec.owner,
        spec.repo,
        newHead,
        this.deps.baseURL,
      );

      if (pushedSha !== undefined && newCommit.parents[0] !== examinedHead) {
        await this.checkRaceWindow(
          spec,
          watermark,
          examinedHead,
          newCommit.parents[0],
          pushFiles,
          new Set(loop.pushedDeletions),
          warnings,
          mode,
        );
        // Do NOT absorb the concurrent commit into the watermark: its changes
        // were never examined nor written to disk, and a watermark built from
        // the new head tree would make the stale local copies look like local
        // edits on the NEXT sync — a silent revert of the concurrent change.
        // Keeping the old watermark is safe: the next sync re-pulls the
        // concurrent change and drops our own pushed files as convergent
        // edits. Convergence for `alreadyInHead` paths (#3475) is equally
        // deferred — their stale entries re-derive next sync and resolve
        // through the same convergent-edit drop.
        warnings.push(
          `race-window: watermark NOT advanced (pushed commit's parent ${newCommit.parents[0]} != examined head ${examinedHead}) — next sync reconciles the concurrent change`,
        );
        // Split-run deferred pins (#3473) are intentionally dropped here:
        // the watermark was not advanced at all, and the OLD base entry is
        // strictly more conservative than a pin — everything re-derives.
        return result("synced", {
          pushedSha,
          pushedCount: pushFiles.size,
          mergedCount: merge.mergedCount,
          quarantinedCount:
            merge.quarantineEntries.length +
            merge.resolvedQuarantineEntries.length,
          ...(merge.mergedPaths.length > 0
            ? { mergedPaths: merge.mergedPaths }
            : {}),
          ...(quarantinedPathsOf(merge).length > 0
            ? { quarantinedPaths: quarantinedPathsOf(merge) }
            : {}),
          ...deferredExtra,
          ...pushedDeletesExtra,
        });
      }

      // Merged contents that differ from the local copy land on disk through
      // the same TOCTOU-guarded apply as remote pulls.
      const { pulledCount, pinnedPaths } = await this.applyRemoteChanges(
        localFiles,
        disk,
        [...applyWrites, ...merge.mergedWrites].filter(
          (w) => !withheldPaths.has(w.path),
        ),
        applyDeletes.filter((d) => !withheldPaths.has(d.path)),
        warnings,
      );

      // Quarantined paths keep their OLD watermark entry (same mechanism as
      // TOCTOU pins): the conflict re-derives every sync until resolved.
      for (const entry of merge.quarantineEntries) {
        pinnedPaths.add(entry.path);
      }
      // Split-run deferrals (#3473) pin the same way: conflicts (any split
      // direction) and push-only's never-applied remote changes re-derive
      // on the next pull/Sync instead of silently inverting into phantom
      // local edits.
      for (const path of loop.deferredPaths) {
        pinnedPaths.add(path);
      }
      // Withheld remote-wins paths (flush failure) re-derive the same way.
      for (const path of withheldPaths) {
        pinnedPaths.add(path);
      }
      // Size-excluded paths (either side) pin too: the carry-forward keeps
      // their PREVIOUS watermark entry, so a file crossing back under the
      // cap derives as a modify/conflict — without the pin it would re-read
      // as a fresh local ADD and silently push over an unexamined remote
      // version (advisor round-2, cap-crossing ADD-bypass).
      if (mode.fileMode) {
        for (const path of sizeExcluded) pinnedPaths.add(path);
        for (const path of loop.remoteOversized) pinnedPaths.add(path);
      }

      await this.advanceWatermark(
        spec,
        newHead,
        newCommit.treeSha,
        disk,
        // Merged writes carry their precomputed blob SHA (A2 deferred LOW) —
        // the watermark rebuild must not re-fetch blobs it already knows.
        // Push-only's deferred remote changes join as a content-addressed
        // uid-seed ONLY (#3473): their blobs are already fetched, and the
        // pin carry-forward discards their new-tree entries anyway.
        [...applyWrites, ...merge.mergedWrites, ...loop.deferredRemoteChanges],
        // The UNFILTERED record — applyWatermarkPins must find the
        // previous entries of size-excluded paths to carry them forward.
        persistedWatermark,
        pinnedPaths,
        detection.diskBlobShas,
        mode,
        sizeExcluded,
      );

      // A pin that existed on the PREVIOUS watermark and cleared in this
      // cycle means its conflict resolved convergently — best-effort close
      // the matching quarantine entry (CQ4 unresolved-count accuracy).
      // Paths whose entry was CREATED this very cycle (file-mode resolved
      // remote-wins copies) are skipped — their pin cleared because the
      // conflict settled NOW, and auto-resolving would tombstone the
      // record before the user ever saw it (advisor round-2 must-fix).
      await this.resolveClearedPins(
        spec,
        persistedWatermark,
        pinnedPaths,
        warnings,
        new Set(merge.resolvedQuarantineEntries.map((e) => e.path)),
      );

      return result("synced", {
        pushedSha,
        pulledCount,
        pushedCount: pushFiles.size,
        mergedCount: merge.mergedCount,
        quarantinedCount:
          merge.quarantineEntries.length +
          merge.resolvedQuarantineEntries.length,
        ...(merge.mergedPaths.length > 0
          ? { mergedPaths: merge.mergedPaths }
          : {}),
        ...(quarantinedPathsOf(merge).length > 0
          ? { quarantinedPaths: quarantinedPathsOf(merge) }
          : {}),
        ...deferredExtra,
        ...pushedDeletesExtra,
      });
    } catch (err) {
      const redact = this.deps.redact ?? ((m: string): string => m);
      if (inFlightDeletionPaths.length > 0) {
        deferredDeletes.push(...inFlightDeletionPaths);
      }
      if (isAuthError(err)) {
        return result("auth-required", {
          detail: redact(
            `authentication failed: ${errMsg(err)} — the PAT is expired, revoked or under-scoped; update it in the per-device secure storage (R8). Never treated as success.`,
          ),
        });
      }
      warnings.push(`sync failed: ${redact(errMsg(err))}`);
      return result("error", { detail: redact(errMsg(err)) });
    } finally {
      // Phase 0 — restore the previous timer (null outside a sync) so the
      // chokepoint wrappers never accumulate into a stale repo's breakdown.
      this.activeTimer = prevTimer;
    }
  }

  /**
   * Flush quarantine entries to the sink (D17/D18), preferring the batched
   * `quarantineAll` (one commit per flush — a terminal flush can carry
   * dozens of files).
   *
   * Returns whether the entries are DURABLY persisted. For D17 unresolved
   * entries a failure safely degrades to a warning (the file stays
   * untouched on disk and the pin / non-advanced watermark re-derives the
   * conflict next sync). For D18 file-mode RESOLVED entries the caller
   * MUST gate the destructive remote-wins apply on this result — the
   * losing local bytes exist nowhere else (reviewer CRITICAL, AC2).
   */
  private async flushQuarantine(
    entries: QuarantineEntry[],
    warnings: string[],
  ): Promise<boolean> {
    if (entries.length === 0) return true;
    const redact = this.deps.redact ?? ((m: string): string => m);
    for (const entry of entries) {
      warnings.push(redact(`quarantined ${entry.path}: ${entry.reason}`));
    }
    const sink = this.deps.quarantine;
    if (sink === undefined) return false;
    try {
      if (sink.quarantineAll !== undefined) {
        await sink.quarantineAll(entries);
      } else {
        for (const entry of entries) {
          await sink.quarantine(entry);
        }
      }
      return true;
    } catch (err) {
      const redact = this.deps.redact ?? ((m: string): string => m);
      warnings.push(
        `quarantine sink failed: ${redact(errMsg(err))} — files untouched on disk; the conflict re-derives next sync (D17 degradation)`,
      );
      return false;
    }
  }

  /**
   * Terminal-quarantine input (D16): one entry per contended push file,
   * with the current remote head version attached best-effort (the base is
   * recoverable from git history via the watermark SHA — not fetched, to
   * keep the flush cheap). Paths already covered by merge-quarantine
   * entries are skipped (disjoint by construction; defensive anyway).
   *
   * `localContent` is the ON-DISK version (the durable record must show
   * what the user actually has) — for a merge-resolved-but-contended path
   * the push payload is a merged PROPOSAL that was never applied to disk;
   * it is dropped (the merge re-derives next sync) and the reason notes it.
   */
  private async buildTerminalQuarantineEntries(
    spec: SyncRepoSpec,
    watermark: WatermarkRecord,
    pushFiles: Map<string, SyncContent>,
    alreadyQuarantined: QuarantineEntry[],
    disk: ReadonlyMap<string, SyncContent>,
  ): Promise<QuarantineEntry[]> {
    const covered = new Set(alreadyQuarantined.map((e) => e.path));
    const remoteByPath = new Map<string, string>();
    try {
      const head = await getHeadSha(
        this.transport,
        spec.owner,
        spec.repo,
        spec.branch,
        this.deps.baseURL,
      );
      const headTree = (
        await getTree(
          this.transport,
          spec.owner,
          spec.repo,
          (
            await getCommitInfo(
              this.transport,
              spec.owner,
              spec.repo,
              head,
              this.deps.baseURL,
            )
          ).treeSha,
          this.deps.baseURL,
        )
      ).filter((e) => pushFiles.has(e.path));
      for (const e of headTree) {
        remoteByPath.set(
          e.path,
          await getBlobText(
            this.transport,
            spec.owner,
            spec.repo,
            e.blobSha,
            this.deps.baseURL,
          ),
        );
      }
    } catch {
      // best-effort — entries still carry the local version
    }

    const entries: QuarantineEntry[] = [];
    for (const [path, content] of pushFiles) {
      if (covered.has(path)) continue;
      const diskContent = disk.get(path);
      const localContent = diskContent ?? content;
      const wasMergedProposal =
        diskContent !== undefined && !contentEquals(diskContent, content);
      const uid =
        typeof localContent === "string"
          ? extractAssetUid(localContent)
          : undefined;
      const remoteContent = remoteByPath.get(path);
      entries.push({
        repoKey: spec.repoKey,
        path,
        ...(uid !== undefined ? { uid } : {}),
        reason: `non-fast-forward push failed after ${this.deps.maxPushRetries ?? DEFAULT_MAX_PUSH_RETRIES} retries (D16) — a concurrent writer keeps moving ${spec.branch}; base recoverable from git history at ${watermark.lastSyncedSha}${wasMergedProposal ? "; the contended push payload was a merged proposal (never applied to disk) — the merge re-derives next sync" : ""}`,
        ...(typeof localContent === "string"
          ? { localContent }
          : { localContentBytes: localContent }),
        ...(remoteContent !== undefined ? { remoteContent } : {}),
      });
    }
    return entries;
  }

  /**
   * Best-effort `markResolved` for pins that cleared in this cycle (the
   * conflict converged) — keeps the cross-device unresolved-count honest
   * (CQ4). No-ops when the port lacks `markResolved` or the pin came from
   * a TOCTOU skip (no entry exists — the store treats that as a no-op).
   */
  private async resolveClearedPins(
    spec: SyncRepoSpec,
    previous: WatermarkRecord,
    newPins: ReadonlySet<string>,
    warnings: string[],
    skipPaths: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const sink = this.deps.quarantine;
    if (sink === undefined || sink.markResolved === undefined) return;
    const cleared = (previous.pinnedPaths ?? []).filter(
      (p) => !newPins.has(p) && !skipPaths.has(p),
    );
    for (const path of cleared) {
      try {
        await sink.markResolved?.(spec.repoKey, path);
      } catch (err) {
        const redact = this.deps.redact ?? ((m: string): string => m);
        warnings.push(
          `quarantine markResolved failed for ${path}: ${redact(errMsg(err))} — unresolved-count may overcount until the resolver UI reconciles (CQ4)`,
        );
      }
    }
  }

  /**
   * D22 — resolve the ACTUAL base tree on the remote; never trust the stored
   * watermark blindly (R10). `null` = commit not resolvable (GC'd, rewritten).
   */
  private async resolveBaseTreeSha(
    spec: SyncRepoSpec,
    watermark: WatermarkRecord,
  ): Promise<string | null> {
    try {
      return (
        await getCommitInfo(
          this.transport,
          spec.owner,
          spec.repo,
          watermark.lastSyncedSha,
          this.deps.baseURL,
        )
      ).treeSha;
    } catch {
      return null;
    }
  }

  /**
   * Pin the local change-set for the whole retry loop (recomputing mid-retry
   * would misclassify just-applied remote files as local edits).
   *
   * Deletes and renames PUSH (#3476): a plain delete becomes a `sha: null`
   * tree entry; a rename pushes the new path AND deletes the old path in
   * the SAME commit (no uid-duplicate window on the remote). Pull-only runs
   * (#3473) keep the defer — their push set is empty by construction, so
   * the delete re-derives and propagates on the next push/Sync.
   */
  private pinLocalChanges(
    detection: Extract<ChangeDetectionResult, { kind: "changes" }>,
    disk: ReadonlyMap<string, SyncContent>,
    warnings: string[],
    deferredDeletes: string[],
    direction: SyncDirection,
  ): PinnedLocalChanges {
    const renames = detection.modified.filter((c) => c.basePath !== undefined);
    const pushable = [
      ...detection.added,
      ...detection.modified.filter((c) => c.basePath === undefined),
    ];
    const pushDeletionsAll = new Map<string, string>();
    if (direction === "pull") {
      for (const r of renames) {
        if (r.basePath !== undefined) deferredDeletes.push(r.basePath);
        warnings.push(
          `pull-only: rename (uid ${r.uid ?? "?"}) ${r.basePath} → ${r.path} not pushed — propagates on the next push/Sync (#3473)`,
        );
      }
      for (const d of detection.deleted) {
        deferredDeletes.push(d.path);
        warnings.push(
          `pull-only: delete of ${d.path} not pushed — propagates on the next push/Sync (#3473)`,
        );
      }
    } else {
      for (const r of renames) {
        if (r.basePath !== undefined) pushDeletionsAll.set(r.basePath, r.path);
      }
      for (const d of detection.deleted) {
        pushDeletionsAll.set(d.path, d.path);
      }
    }
    const localChanges: AssetChange[] = [
      ...pushable,
      ...renames,
      ...detection.deleted.map((d) => ({ ...d })),
    ];
    const localDeletedPaths = new Set(detection.deleted.map((d) => d.path));
    const pushFilesAll = new Map<string, SyncContent>();
    // Renames' NEW-path content joins the push set (#3476) — paired with
    // the old-path deletion above, both halves land in one commit.
    for (const c of [...pushable, ...(direction === "pull" ? [] : renames)]) {
      const content = disk.get(c.path);
      if (content !== undefined) pushFilesAll.set(c.path, content);
    }
    return {
      localChanges,
      localDeletedPaths,
      pushFilesAll,
      pushDeletionsAll,
      dupUids: detection.duplicateUids,
    };
  }

  /**
   * Pull → no-conflict check → push, with the D16 422 retry loop. Returns a
   * discriminated outcome; `done` carries everything the caller needs to
   * finish the cycle (race-window check, pull-apply, watermark advance).
   */
  private async runPushLoop(
    spec: SyncRepoSpec,
    watermark: WatermarkRecord,
    pinned: PinnedLocalChanges,
    disk: ReadonlyMap<string, SyncContent>,
    warnings: string[],
    mode: ModeOps,
    forceRemoteDiff = false,
    sizeExcluded: ReadonlySet<string> = new Set(),
    direction: SyncDirection = "sync",
    onProgress?: SyncProgressFn,
  ): Promise<PushLoopOutcome> {
    const {
      localChanges,
      localDeletedPaths,
      pushFilesAll,
      pushDeletionsAll,
      dupUids,
    } = pinned;
    const maxRetries = this.deps.maxPushRetries ?? DEFAULT_MAX_PUSH_RETRIES;
    let attempt = 0;
    let examinedHead = "";
    let pushedSha: string | undefined;
    let applyWrites: RemoteChange[] = [];
    let applyDeletes: RemoteChange[] = [];
    let pushFiles = new Map<string, SyncContent>();
    let pushDeletions = new Set<string>();
    let withheldDeletions: string[] = [];
    let merge: MergeResolution = EMPTY_MERGE;
    let alreadyInHead: string[] = [];
    let deferredPaths = new Set<string>();
    let deferredRemoteChanges: RemoteChange[] = [];
    let deferredWarnings: string[] = [];
    const remoteOversized = new Set<string>();

    for (;;) {
      examinedHead = await getHeadSha(
        this.transport,
        spec.owner,
        spec.repo,
        spec.branch,
        this.deps.baseURL,
      );
      applyWrites = [];
      applyDeletes = [];
      // Merge resolution is recomputed per iteration — a re-pull changes the
      // remote side, so a previous iteration's verdicts are stale.
      merge = EMPTY_MERGE;
      // Per-iteration like the merge verdicts: a retry re-reads the head, so
      // the previous iteration's tree (and drops) are stale (#3475).
      alreadyInHead = [];
      // Per-iteration like the merge verdicts (#3473): a re-pull changes the
      // remote set, and warnings pushed into the cumulative array inside the
      // D16 retry loop would duplicate per attempt.
      deferredPaths = new Set<string>();
      deferredRemoteChanges = [];
      deferredWarnings = [];
      let headTreeByPath: Map<string, string> | undefined;
      const convergedPushPaths = new Set<string>();

      // Pinned paths diverge from the lastSyncedSha tree by construction —
      // their never-applied remote change must re-derive even when the head
      // SHA has not moved since the pinning sync. A synthetic first-sync
      // base (file mode) is ALSO a deliberate subset of the head tree —
      // its remote-only/differing files must derive as remote changes.
      const hasPins = (watermark.pinnedPaths?.length ?? 0) > 0;
      if (
        examinedHead !== watermark.lastSyncedSha ||
        hasPins ||
        forceRemoteDiff
      ) {
        this.emitProgress(onProgress, spec.repoKey, "pulling-remote");
        const remote = await this.collectRemoteChanges(
          spec,
          watermark,
          examinedHead,
          mode,
          sizeExcluded,
          warnings,
          remoteOversized,
        );
        headTreeByPath = remote.headTreeByPath;
        const verdict = this.matchLocalVsRemote(
          localChanges,
          localDeletedPaths,
          disk,
          remote.changes,
          convergedPushPaths,
          dupUids,
          remote.headTreeByPath,
        );
        if (verdict.conflicts.length > 0) {
          // #3498 — conflict resolution is about to fire (file-mode remote-wins
          // OR the A2 merge layer). Split runs only defer, so the "merging"
          // phase is the full-Sync signal that the merge layer is engaging.
          if (direction === "sync") {
            this.emitProgress(onProgress, spec.repoKey, "merging");
          }
          if (direction !== "sync") {
            // Split runs NEVER resolve conflicts (#3473): neither the A2
            // merge layer nor file-mode remote-wins (D18) fires. Every
            // involved path is pinned so the conflict re-derives on the
            // next full Sync; the conflicting local change is already
            // excluded from the push set via `convergedPushPaths`.
            for (const group of verdict.conflicts) {
              deferredPaths.add(group.local.path);
              if (group.local.basePath !== undefined) {
                deferredPaths.add(group.local.basePath);
              }
              for (const remote of group.remotes) {
                deferredPaths.add(remote.path);
                if (remote.kind === "change") {
                  deferredRemoteChanges.push(remote);
                }
              }
            }
            deferredWarnings.push(
              `${direction}-only: ${verdict.conflicts.length} conflict(s) deferred to a full Sync (${verdict.conflicts
                .map((g) => g.desc)
                .join("; ")}) — paths pinned, nothing merged`,
            );
          } else if (mode.fileMode) {
            // Phase C file mode (D18): opaque blobs never merge — every
            // conflict resolves remote-wins deterministically, with the
            // losing LOCAL version preserved in quarantine. Resolved
            // in-place: remote side flows into applyWrites/applyDeletes,
            // nothing reaches the A2 merge layer.
            merge = this.resolveFileModeConflicts(
              spec,
              verdict.conflicts,
              disk,
              verdict.applyWrites,
              verdict.applyDeletes,
            );
          } else if (this.deps.mergeLayer === undefined) {
            return {
              kind: "conflict",
              detail: `overlapping change on ${verdict.conflicts[0].desc} — merge layer (A2/A3) required; nothing pushed, nothing written`,
            };
          } else {
            merge = await this.resolveMergeConflicts(
              spec,
              watermark,
              verdict.conflicts,
              disk,
            );
          }
          // Cross-path remote changes consumed by a conflict group were
          // never applied to disk — pin them, same invariant as push-only
          // deferrals: absorbing them into the advanced watermark would
          // make the locally-absent path read as a local DELETE next sync
          // and push a wrongful deletion of a file nobody deleted (#3477
          // arrival cycle: a remote dup copy + a concurrent local edit).
          // Same-path remotes need no pin — the conflict outcome (merge /
          // quarantine / file-mode remote-wins) settles them in place.
          if (direction === "sync") {
            for (const group of verdict.conflicts) {
              for (const r of group.remotes) {
                if (r.path === group.local.path) continue;
                deferredPaths.add(r.path);
                if (r.kind === "change") deferredRemoteChanges.push(r);
                deferredWarnings.push(
                  `conflict group ${group.desc}: remote change at ${r.path} NOT applied — pinned to re-derive on the next sync (#3477)`,
                );
              }
            }
          }
        }
        applyWrites = verdict.applyWrites;
        applyDeletes = verdict.applyDeletes;
        if (
          direction === "push" &&
          (applyWrites.length > 0 || applyDeletes.length > 0)
        ) {
          // Push-only (#3473): remote changes are detected but NEVER applied
          // to disk. Pinning is mandatory — advancing the watermark to the
          // pushed head WITHOUT a pin would absorb the unapplied remote blob
          // and make the stale local copy read as a "local edit" next sync
          // (a silent revert of the remote change).
          for (const w of applyWrites) {
            deferredPaths.add(w.path);
            deferredRemoteChanges.push(w);
          }
          for (const d of applyDeletes) {
            deferredPaths.add(d.path);
          }
          deferredWarnings.push(
            `push-only: ${applyWrites.length + applyDeletes.length} remote change(s) NOT applied — pinned to re-derive on the next pull/Sync`,
          );
          applyWrites = [];
          applyDeletes = [];
        }
      }

      // Pull-only (#3473): the push set is EMPTY by construction — the
      // local change-set above still feeds conflict detection (protecting
      // local edits from being overwritten by the pull-apply), but nothing
      // ever reaches `restCreateCommit`.
      pushFiles =
        direction === "pull"
          ? new Map<string, SyncContent>()
          : new Map<string, SyncContent>([
              ...[...pushFilesAll].filter(([p]) => !convergedPushPaths.has(p)),
              ...merge.mergedFiles,
            ]);

      // Deletions of this iteration (#3476). A deletion whose OWNER local
      // change conflicted/converged is withheld: the conflict outcome
      // (merge/quarantine/pin) replaces the raw push, deletion included —
      // the path re-derives next sync instead of being deleted under a
      // remote edit. (Pull-only runs never populate `pushDeletionsAll`.)
      pushDeletions = new Set<string>();
      withheldDeletions = [];
      for (const [delPath, owner] of pushDeletionsAll) {
        if (convergedPushPaths.has(owner)) {
          withheldDeletions.push(delPath);
          continue;
        }
        // A path deleted by one local change but re-written by another
        // (rename away + new file created at the old path) needs no
        // deletion — the write overwrites it; sending both would be
        // ambiguous (the primitive rejects the overlap loudly).
        if (pushFiles.has(delPath)) continue;
        pushDeletions.add(delPath);
      }

      // #3475 phantom-commit guard: drop pushFiles whose bytes are ALREADY
      // identical in the examined head tree. Parallel-run state: another
      // device pushed the same content and this device's PER-FILE watermark
      // snapshot is stale (D22 validates only rootTreeSha) — without the
      // guard, restCreateCommit lands an empty or partially-identical commit
      // with an inflated `sync N file(s)` message. In the remote-diff branch
      // above this is expected to be a no-op (the convergent-edit drop covers
      // disk-sourced phantoms; the merge layer excludes remote-equal merged
      // content) — the fast path (head unmoved, no pins) is the one that
      // needs it. Runs BEFORE the R5 secret scan: bytes already durable in
      // HEAD must not trigger a push refusal.
      if (
        (pushFiles.size > 0 || pushDeletions.size > 0) &&
        headTreeByPath === undefined
      ) {
        // Fast path: `examinedHead === watermark.lastSyncedSha`, and
        // `rootTreeSha` was D22-verified against the actual commit this
        // very cycle (detectChanges) — one tree GET, and only when there
        // is something to push (the no-change happy path never gets here).
        headTreeByPath = treeByPath(
          await getTree(
            this.transport,
            spec.owner,
            spec.repo,
            watermark.rootTreeSha,
            this.deps.baseURL,
          ),
        );
      }
      if (pushFiles.size > 0 && headTreeByPath !== undefined) {
        for (const [path, content] of pushFiles) {
          const headBlobSha = headTreeByPath.get(path);
          if (
            headBlobSha !== undefined &&
            headBlobSha === (await gitBlobSha(content, this.sha1))
          ) {
            pushFiles.delete(path);
            alreadyInHead.push(path);
          }
        }
        if (alreadyInHead.length > 0) {
          warnings.push(
            `phantom push skipped: ${alreadyInHead.length} file(s) already identical in remote HEAD (${alreadyInHead.join(", ")}) — excluded from the commit (#3475)`,
          );
        }
      }
      if (pushDeletions.size > 0 && headTreeByPath !== undefined) {
        // #3476 absence guard (mirror of #3475 for deletions): a path
        // already gone from the examined head (convergent delete, remote
        // rename) must NOT be sent — GitHub rejects a sha:null entry for
        // an absent path with HTTP 422 GitRPC::BadObjectState. Nothing is
        // lost: the watermark rebuild drops the path and the delete never
        // re-derives.
        for (const path of [...pushDeletions]) {
          if (!headTreeByPath.has(path)) pushDeletions.delete(path);
        }
        // Empty-tree refusal: GitHub cannot create an EMPTY tree (the POST
        // fails HTTP 404 — empirically verified). A deletion set wiping
        // EVERY entry of the head tree with nothing pushed alongside is
        // deferred loudly instead of failing the whole repo.
        if (pushFiles.size === 0 && pushDeletions.size >= headTreeByPath.size) {
          withheldDeletions.push(...pushDeletions);
          deferredWarnings.push(
            `deletion of ALL ${pushDeletions.size} remaining file(s) deferred — GitHub cannot create an empty tree; the deletes re-derive and propagate once the repo has at least one surviving file`,
          );
          pushDeletions.clear();
        }
      }
      if (pushFiles.size === 0 && pushDeletions.size === 0) break;

      // R5 secret-scan — refuse the WHOLE push (a partial set could ship an
      // inconsistent asset graph). Findings carry path+kind, never the
      // secret. File mode: UTF-8-decodable contents (plain notes inside a
      // FileSpace) still scan; true binary (non-UTF-8) is skipped — secret
      // patterns are text-shaped (R5 residual, documented).
      const scannable = new Map<string, string>();
      for (const [p, c] of pushFiles) {
        if (typeof c === "string") {
          scannable.set(p, c);
        } else {
          const text = decodeUtf8Strict(c);
          if (text !== null) scannable.set(p, text);
        }
      }
      const findings = scanForSecrets(scannable);
      if (findings.length > 0) {
        return {
          kind: "secret-detected",
          detail: `secret-scan: refusing to push — ${findings
            .map((f) => `${f.path} (${f.kind})`)
            .join(", ")} (R5); remove the secret and re-sync`,
        };
      }

      try {
        pushedSha = await restCreateCommit(this.transport, {
          owner: spec.owner,
          repo: spec.repo,
          branch: spec.branch,
          files: new Map(
            [...pushFiles].map(([p, c]) => [p, toCommitContent(c)]),
          ),
          deletions: [...pushDeletions],
          message:
            this.deps.commitMessage?.(
              spec,
              pushFiles.size,
              pushDeletions.size,
            ) ??
            `chore(exosync): sync ${pushFiles.size} file(s)${pushDeletions.size > 0 ? `, ${pushDeletions.size} deletion(s)` : ""}`,
          baseURL: this.deps.baseURL,
          redact: this.deps.redact,
        });
        break;
      } catch (err) {
        if (!isNonFastForwardError(err)) throw err;
        attempt++;
        if (attempt > maxRetries) {
          return {
            kind: "retry-exhausted",
            detail: `non-fast-forward push failed after ${maxRetries} retries (D16 cap) — contended files routed to quarantine (D17)`,
            pushFiles,
            merge,
          };
        }
        warnings.push(
          `non-fast-forward push (attempt ${attempt}/${maxRetries}) — re-pulling and retrying (D16)`,
        );
      }
    }

    return {
      kind: "done",
      examinedHead,
      pushedSha,
      applyWrites,
      applyDeletes,
      pushFiles,
      pushedDeletions: pushedSha !== undefined ? [...pushDeletions] : [],
      withheldDeletions,
      merge,
      remoteOversized,
      alreadyInHead,
      deferredPaths,
      deferredRemoteChanges,
      deferredWarnings,
    };
  }

  /**
   * Run every conflict group through the A2 merge layer (D1). `use-merged`
   * splits the merged content into what must be PUSHED (≠ remote copy) and
   * what must be WRITTEN to disk (≠ local copy); `quarantine` collects a
   * both-versions entry (D17) — the engine never writes a quarantined path.
   * The 3-way base is the BASE-tree blob recorded in the watermark, fetched
   * on demand; a path absent from the base (both sides added) merges with
   * `base: undefined`.
   */
  private async resolveMergeConflicts(
    spec: SyncRepoSpec,
    watermark: WatermarkRecord,
    conflicts: ConflictGroup[],
    disk: ReadonlyMap<string, SyncContent>,
  ): Promise<MergeResolution> {
    const mergeLayer = this.deps.mergeLayer;
    if (mergeLayer === undefined) return EMPTY_MERGE;
    const baseByPath = new Map(watermark.files.map((f) => [f.path, f]));
    const mergedFiles = new Map<string, string>();
    const mergedWrites: RemoteChange[] = [];
    const quarantineEntries: QuarantineEntry[] = [];
    const warnings: string[] = [];
    const mergedPaths: string[] = [];
    let mergedCount = 0;

    // Asset-mode invariant: every disk/remote content here is text — the
    // merge layer never sees file-mode repos (their conflicts resolve in
    // `resolveFileModeConflicts`). The guard narrows the type.
    const asText = (c: SyncContent | undefined): string | undefined =>
      typeof c === "string" ? c : undefined;

    const entry = (
      group: ConflictGroup,
      reason: string,
      base?: string,
    ): QuarantineEntry => {
      const localText = asText(disk.get(group.local.path));
      const remoteText = asText(group.remotes[0]?.content);
      return {
        repoKey: spec.repoKey,
        path: group.local.path,
        ...(group.local.uid !== undefined ? { uid: group.local.uid } : {}),
        reason,
        ...(base !== undefined ? { baseContent: base } : {}),
        ...(localText !== undefined ? { localContent: localText } : {}),
        ...(remoteText !== undefined ? { remoteContent: remoteText } : {}),
      };
    };

    for (const group of conflicts) {
      const baseEntry =
        baseByPath.get(group.local.basePath ?? group.local.path) ??
        baseByPath.get(group.remotes[0]?.path ?? "");
      let base: string | undefined;
      if (baseEntry !== undefined) {
        base = await getBlobText(
          this.transport,
          spec.owner,
          spec.repo,
          baseEntry.blobSha,
          this.deps.baseURL,
        );
      }

      if (group.remotes.length > 1) {
        // One local change overlapping SEVERAL remote changes (remote rename
        // + edit, duplicate uid) — ambiguous 3-way input, never auto-merge.
        quarantineEntries.push(
          entry(
            group,
            `ambiguous conflict: local change overlaps ${group.remotes.length} remote changes (${group.remotes.map((r) => r.path).join(", ")})`,
            base,
          ),
        );
        continue;
      }
      const remote = group.remotes[0];

      const localText = asText(disk.get(group.local.path));
      const decision = await mergeLayer.resolve({
        path: group.local.path,
        ...(group.local.uid !== undefined ? { uid: group.local.uid } : {}),
        ...(base !== undefined ? { base } : {}),
        ...(localText !== undefined ? { local: localText } : {}),
        ...(remote.kind === "change" && typeof remote.content === "string"
          ? { remote: remote.content }
          : {}),
      });

      if (decision.action === "quarantine") {
        quarantineEntries.push(entry(group, decision.reason, base));
        continue;
      }

      mergedCount++;
      mergedPaths.push(group.local.path);
      for (const w of decision.warnings ?? []) {
        warnings.push(`merge(${group.local.path}): ${w}`);
      }
      const remoteContent =
        remote.kind === "change" ? remote.content : undefined;
      if (decision.content !== remoteContent) {
        mergedFiles.set(group.local.path, decision.content);
      }
      if (decision.content !== disk.get(group.local.path)) {
        const uid = extractAssetUid(decision.content) ?? group.local.uid;
        mergedWrites.push({
          path: group.local.path,
          kind: "change",
          content: decision.content,
          // Precomputed so the watermark rebuild reuses it instead of
          // re-fetching the merged blob (A2 deferred LOW).
          blobSha: await gitBlobSha(decision.content, this.sha1),
          ...(uid !== undefined ? { uid } : {}),
        });
      }
    }

    return {
      mergedFiles,
      mergedWrites,
      quarantineEntries,
      resolvedQuarantineEntries: [],
      mergedCount,
      mergedPaths,
      warnings,
    };
  }

  /**
   * Phase C file-mode conflict policy (D18): deterministic REMOTE-WINS.
   * Opaque blobs cannot merge; timestamps are unavailable (no mtime in the
   * port, no per-path commit dates without extra API calls), so "last
   * write" is defined by the shared git timeline — the version that
   * reached the remote won. Crucially, the losing side is the LOCAL
   * version, which exists nowhere else — it is preserved as a quarantine
   * entry with byte-exact content (AC2: nothing is lost), while the remote
   * version is already durable in git history.
   *
   * Matrix:
   *  - local change vs remote change → remote lands on disk, local copy →
   *    quarantine.
   *  - local change vs remote delete → file deleted locally, local copy →
   *    quarantine.
   *  - local delete  vs remote change → remote restored on disk; nothing
   *    to quarantine (the local side has no content to lose).
   *
   * Entries are RESOLVED (`resolvedQuarantineEntries`): flushed for
   * durability, never pinned (advisor C2 — a pin would re-derive a settled
   * conflict and auto-`markResolved` the record on the next sync).
   *
   * Convergence: every device accepts the remote side, so all replicas
   * settle on the same bytes without ping-ponging pushes.
   */
  private resolveFileModeConflicts(
    spec: SyncRepoSpec,
    conflicts: ConflictGroup[],
    disk: ReadonlyMap<string, SyncContent>,
    applyWrites: RemoteChange[],
    applyDeletes: RemoteChange[],
  ): MergeResolution {
    const resolvedQuarantineEntries: QuarantineEntry[] = [];
    const warnings: string[] = [];

    for (const group of conflicts) {
      if (group.remotes.length > 1) {
        // Unreachable by construction: file-mode entries carry no uid and
        // no rename basePath, so remote candidates match by path only
        // (≤ 1). Defensive: take the first, surface the anomaly.
        warnings.push(
          `file-mode conflict on ${group.local.path} unexpectedly overlaps ${group.remotes.length} remote changes — resolving against the first`,
        );
      }
      const remote = group.remotes[0];
      const localContent = disk.get(group.local.path);

      if (remote.kind === "change") {
        applyWrites.push(remote);
      } else {
        applyDeletes.push(remote);
      }

      if (group.localIsDelete || localContent === undefined) {
        // Local delete vs remote change: restoring the remote loses
        // nothing — no quarantine entry.
        continue;
      }
      resolvedQuarantineEntries.push({
        repoKey: spec.repoKey,
        path: group.local.path,
        // "wins", not "applied" — the apply can still be withheld (flush
        // failure) or TOCTOU-skipped after this entry is built.
        reason: `file-mode remote-wins (D18): remote ${remote.kind === "change" ? `version ${remote.blobSha}` : "delete"} wins; this is the losing LOCAL version, preserved byte-exact`,
        ...(typeof localContent === "string"
          ? { localContent }
          : { localContentBytes: localContent }),
      });
    }

    return {
      mergedFiles: new Map(),
      mergedWrites: [],
      quarantineEntries: [],
      resolvedQuarantineEntries,
      mergedCount: 0,
      mergedPaths: [],
      warnings,
    };
  }

  /**
   * Apply remote changes to disk AFTER the push succeeded — a failed push
   * must leave the working tree pristine, or the next run misclassifies
   * remote content as local edits.
   *
   * TOCTOU guard (A1 review): each path is re-read immediately before the
   * mutation and compared to the sync-start snapshot. A mismatch means the
   * user edited/created/removed the file mid-sync — the apply is SKIPPED and
   * the path is pinned so the watermark keeps its OLD base entry for it
   * (advancing it would make the next sync push the user's edit over the
   * never-applied remote change: a silent revert). The pinned path re-derives
   * as a remote change (or a proper conflict) on the next sync.
   */
  private async applyRemoteChanges(
    localFiles: LocalFilesPort,
    disk: ReadonlyMap<string, SyncContent>,
    applyWrites: RemoteChange[],
    applyDeletes: RemoteChange[],
    warnings: string[],
  ): Promise<{ pulledCount: number; pinnedPaths: Set<string> }> {
    let pulledCount = 0;
    const pinnedPaths = new Set<string>();
    // TOCTOU re-read matches the snapshot's representation: a byte snapshot
    // re-reads bytes, a text snapshot re-reads text — `contentEquals`
    // compares within the representation.
    const tryRead = async (
      path: string,
      asBytes: boolean,
    ): Promise<SyncContent | undefined> => {
      try {
        return asBytes
          ? await readBinaryStrict(localFiles, path)
          : await localFiles.read(path);
      } catch {
        return undefined;
      }
    };
    const writeContent = async (
      path: string,
      content: SyncContent,
    ): Promise<void> => {
      if (typeof content === "string") {
        await localFiles.write(path, content);
      } else {
        await writeBinaryStrict(localFiles, path, content);
      }
    };
    for (const w of applyWrites) {
      if (w.content === undefined) continue; // change entries always carry content
      if (!isSafeRepoRelativePath(w.path)) {
        warnings.push(`unsafe remote path skipped on pull-apply: ${w.path}`);
        pinnedPaths.add(w.path);
        continue;
      }
      const snapshot = disk.get(w.path);
      const current = await tryRead(
        w.path,
        typeof (snapshot ?? w.content) !== "string",
      );
      if (!contentEquals(current, snapshot)) {
        warnings.push(
          `pull-apply skipped: ${w.path} changed on disk mid-sync (TOCTOU) — remote change re-derives next sync`,
        );
        pinnedPaths.add(w.path);
        continue;
      }
      await writeContent(w.path, w.content);
      pulledCount++;
    }
    for (const d of applyDeletes) {
      if (!isSafeRepoRelativePath(d.path)) {
        warnings.push(`unsafe remote path skipped on pull-delete: ${d.path}`);
        pinnedPaths.add(d.path);
        continue;
      }
      const snapshot = disk.get(d.path);
      if (snapshot !== undefined) {
        const current = await tryRead(d.path, typeof snapshot !== "string");
        if (current !== undefined && !contentEquals(current, snapshot)) {
          warnings.push(
            `pull-delete skipped: ${d.path} changed on disk mid-sync (TOCTOU) — delete-vs-modify re-derives next sync`,
          );
          pinnedPaths.add(d.path);
          continue;
        }
        await localFiles.delete(d.path);
        pulledCount++;
      }
    }
    return { pulledCount, pinnedPaths };
  }

  /**
   * Build and persist the watermark for the new head (D8). Pinned paths keep
   * their PREVIOUS base entry (or stay absent): their remote change was never
   * applied to disk, so absorbing the new-head blob would turn the untouched
   * local copy into a phantom "local edit" next sync — a silent revert of the
   * remote change. D22 is unaffected: it validates `rootTreeSha` integrity,
   * not the per-file snapshot.
   */
  private async advanceWatermark(
    spec: SyncRepoSpec,
    newHead: string,
    newTreeSha: string,
    disk: ReadonlyMap<string, SyncContent>,
    applyWrites: RemoteChange[],
    previous: WatermarkRecord,
    pinnedPaths: ReadonlySet<string>,
    diskBlobShas: ReadonlyMap<string, string>,
    mode: ModeOps,
    sizeExcluded: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const newTree = (
      await getTree(
        this.transport,
        spec.owner,
        spec.repo,
        newTreeSha,
        this.deps.baseURL,
      )
    ).filter((e) => mode.treeFilter(e) && !sizeExcluded.has(e.path));
    const files = applyWatermarkPins(
      await this.buildWatermarkFiles(
        spec,
        newTree,
        disk,
        applyWrites,
        previous,
        diskBlobShas,
        mode,
      ),
      previous,
      pinnedPaths,
    );
    await this.deps.watermarkStore.set(spec.repoKey, {
      lastSyncedSha: newHead,
      rootTreeSha: newTreeSha,
      files,
      ...(pinnedPaths.size > 0 ? { pinnedPaths: [...pinnedPaths] } : {}),
      // Downgrade marker (Phase C): an older engine md-filters the head
      // tree and would infer phantom deletes from a file-mode watermark.
      ...(mode.fileMode ? { spaceKind: "file" as const } : {}),
    });
  }

  /**
   * #3590 — build a first-sync 3-way base from the recorded MOUNT commit when
   * the remote has advanced since the AssetSpace was mounted. Returns:
   *  - `null` — no mount base recorded, the remote has NOT advanced
   *    (mount === head; the cheaper R⊆L path handles it), the recorded SHA is
   *    unresolvable (GC'd / rewritten), or it is NOT a genuine ancestor of the
   *    current head. In every `null` case the caller falls back to the
   *    conservative R⊆L bootstrap (full-conflict on a real divergence) — never
   *    a guessed base, never a silent overwrite.
   *  - `{ kind: "additive-base", base }` — the mount commit's tree, validated
   *    as an ancestor of head. The normal cycle reconciles remote changes
   *    (mount..head) against local changes (disk vs mount) through the SAME
   *    3-way machinery the post-watermark path uses: disjoint → clean merge,
   *    overlap → conflict/quarantine (M1 zero-loss intact).
   *
   * Ancestry is verified by walking head's first-parent chain (bounded) until
   * the recorded SHA is found — a stale/foreign SHA whose tree happened to
   * differ would otherwise mis-classify a remote change as a local edit and
   * push a stale blob over a newer remote version.
   */
  private async tryMountBaseBootstrap(
    spec: SyncRepoSpec,
    head: string,
    disk: ReadonlyMap<string, SyncContent>,
    warnings: string[],
    result: (
      status: RepoSyncResult["status"],
      extra?: Partial<RepoSyncResult>,
    ) => RepoSyncResult,
  ): Promise<FirstSyncBootstrap | null> {
    const store = this.deps.mountBaseStore;

    let mountSha: string | null = null;
    if (store !== undefined) {
      try {
        mountSha = await store.get(spec.repoKey);
      } catch {
        return null; // store read failure → conservative fallback
      }
    }

    // #3590 FULL fix — base BACKFILL. A repo MOUNTED BEFORE the mount layer
    // started recording its base (or by any path that never recorded one) has no
    // store entry → the v16.98.7 recording fix could not fire for it, and every
    // first-sync on an advanced remote false-conflicted (the work-MacBook
    // trigger). Recover the base from the platform's AUTHORITATIVE checked-out
    // commit (desktop: the git submodule HEAD via `localBaseShaProvider`). It is
    // NOT trusted blindly — it goes through the EXACT same genuine-ancestor
    // verification below as a recorded base (non-ancestor → conservative
    // fallback, never a silent merge on a guessed base, M1 zero-loss). `null`
    // (mobile/REST, non-submodule, git unavailable) → conservative fallback
    // unchanged. A verified hit is persisted (backfilled) so subsequent
    // first-syncs reuse it without re-invoking the provider.
    let backfilled = false;
    if (mountSha === null && this.deps.localBaseShaProvider !== undefined) {
      try {
        const candidate = await this.deps.localBaseShaProvider(spec);
        if (typeof candidate === "string" && candidate.length > 0) {
          mountSha = candidate;
          backfilled = true;
        }
      } catch {
        // provider failure (git unavailable, not a submodule) → no candidate →
        // conservative fallback, never a guess.
      }
    }

    // No record/candidate, or the remote has not advanced since the mount (the cheaper
    // R⊆L clean-mount / additive path below handles head == mount exactly).
    // `head.startsWith(mountSha)` (not `===`) so an ABBREVIATED mount SHA
    // (anonymous tarballs carry a 7-char wrapper SHA — extractShaFromWrapper)
    // still recognises the no-advance case and takes the cheap path instead of
    // a needless reconcile round-trip + a misleading "advanced" warning. A
    // false positive (a 7-char prefix collision between head and an older
    // ancestor) is merely conservative — it routes to the R⊆L full-conflict
    // path, never a silent overwrite.
    if (mountSha === null || head.startsWith(mountSha)) return null;

    // Verify the recorded SHA is a GENUINE ancestor of the current head by
    // walking the first-parent chain. The walk doubles as the fetch of the
    // base commit (its treeSha) — no extra round-trip. Any transport failure
    // (unresolvable SHA, truncated/GC'd history) → conservative fallback.
    const MAX_ANCESTRY_WALK = 300;
    let baseCommit: Awaited<ReturnType<typeof getCommitInfo>> | null = null;
    try {
      let cur = head;
      for (let i = 0; i < MAX_ANCESTRY_WALK; i++) {
        const info = await getCommitInfo(
          this.transport,
          spec.owner,
          spec.repo,
          cur,
          this.deps.baseURL,
        );
        // `info.sha` is the canonical (full) SHA; the recorded mount SHA may be
        // an abbreviated tarball-wrapper SHA (anonymous fetches) — match by
        // prefix so both forms resolve to the same commit.
        if (info.sha === mountSha || info.sha.startsWith(mountSha)) {
          baseCommit = info;
          break;
        }
        if (info.parents.length === 0) break; // root reached, not an ancestor
        cur = info.parents[0];
      }
    } catch {
      return null;
    }
    if (baseCommit === null) return null; // not an ancestor within the bound

    // Fetch the base commit's tree → the 3-way merge base snapshot. A truncated
    // tree throws (LOUD) → conservative fallback rather than a wrong diff.
    let baseTree: RemoteTreeEntry[];
    try {
      baseTree = (
        await getTree(
          this.transport,
          spec.owner,
          spec.repo,
          baseCommit.treeSha,
          this.deps.baseURL,
        )
      ).filter((e) => isSyncablePath(e.path));
    } catch {
      return null;
    }

    // #3610 — base-tree⊆working-tree sanity guard (defence-in-depth, from the
    // #3609 advisor review). The base above is a VERIFIED ancestor of head, but
    // ancestry does NOT prove the base tree matches the commit the local working
    // tree was actually derived from. A base file ABSENT from the working tree
    // whose remote-head blob is UNCHANGED since the base would, in the normal
    // 3-way cycle, be inferred as a LOCAL DELETION and silently pushed — correct
    // under the normal lifecycle (a tarball / `git submodule add` materialization
    // makes working-tree == base-commit tree byte-for-byte, so the disk-missing
    // file IS a genuine deletion), but DATA LOSS under out-of-band submodule
    // manipulation that moved the working tree off its derivation commit. The
    // two cases are INDISTINGUISHABLE from {base, disk, head} alone, so route the
    // WHOLE run to full-conflict (merge/quarantine, A2/A3) rather than infer a
    // silent deletion — M1 zero-loss in BOTH directions (no silent delete, no
    // silent resurrection). A file absent from disk that remote CHANGED (≠ base
    // blob) is NOT suspicious here — it falls through to the 3-way machinery as a
    // local-delete-vs-remote-modify conflict; a file absent from disk AND from
    // remote head is a convergent delete and is likewise not flagged. The
    // head-tree fetch is paid only on this rare first-sync-mount-base path (the
    // recorded/backfilled mount is an ancestor and the remote advanced since).
    let headTreeByPath: Map<string, string>;
    try {
      const headCommit = await getCommitInfo(
        this.transport,
        spec.owner,
        spec.repo,
        head,
        this.deps.baseURL,
      );
      headTreeByPath = treeByPath(
        (
          await getTree(
            this.transport,
            spec.owner,
            spec.repo,
            headCommit.treeSha,
            this.deps.baseURL,
          )
        ).filter((e) => isSyncablePath(e.path)),
      );
    } catch {
      return null; // head unresolvable → conservative fallback (R⊆L path)
    }
    const suspicious = baseTree.filter(
      (b) => !disk.has(b.path) && headTreeByPath.get(b.path) === b.blobSha,
    );
    if (suspicious.length > 0) {
      const sample =
        suspicious
          .slice(0, 3)
          .map((s) => s.path)
          .join(", ") + (suspicious.length > 3 ? ", …" : "");
      warnings.push(
        `first-sync (asset mode): base-tree⊆working-tree sanity guard fired — ${suspicious.length} base file(s) absent from the working tree but UNCHANGED on remote head (${sample}); the verified-ancestor base may not match the working tree's derivation commit (out-of-band submodule manipulation) → routing to merge/quarantine instead of inferring a silent deletion (#3610)`,
      );
      return {
        kind: "settled",
        outcome: result("full-conflict", {
          detail: `first-sync: base-tree⊆working-tree sanity guard — ${suspicious.length} base file(s) absent from the working tree are unchanged on remote head (${sample}); refusing to infer a silent deletion from a base that may not match the derivation commit — divergence must go through merge/quarantine (A2/A3), never a silent delete (#3610)`,
        }),
      };
    }

    // uid is intentionally omitted from the base snapshot here: it is only used
    // for rename matching on the base side, and deriving it would require
    // fetching every base blob. Both the local diff (disk uids) and the remote
    // diff (head-blob uids) still carry uids, so uid-based conflict detection
    // is unaffected — a base-side rename merely degrades to delete+add, never a
    // data-loss path.
    const files: WatermarkFileEntry[] = baseTree.map((e) => ({
      path: e.path,
      blobSha: e.blobSha,
    }));
    const base: WatermarkRecord = {
      lastSyncedSha: baseCommit.sha,
      rootTreeSha: baseCommit.treeSha,
      files,
    };
    // #3590 FULL fix — persist the BACKFILLED (now ancestor-VERIFIED) base so a
    // subsequent first-sync (e.g. after an overlapping full-conflict that wrote
    // no watermark) reuses it without re-invoking the provider. Only the verified
    // canonical SHA reaches this point — never an unverified guess (M1).
    // Best-effort: a store-write failure must NOT fail the sync.
    if (backfilled && store !== undefined) {
      try {
        await store.set(spec.repoKey, baseCommit.sha);
      } catch {
        /* non-fatal — next first-sync re-derives the base via the provider */
      }
    }
    warnings.push(
      backfilled
        ? `first-sync (asset mode): BACKFILLED the 3-way base from the locally checked-out commit ${baseCommit.sha} (no recorded mount base) — remote head ${head} advanced since; local edits 3-way merge against it instead of false-conflicting (#3590)`
        : `first-sync (asset mode): reconciling against the recorded mount base ${baseCommit.sha} — remote head ${head} advanced since mount; local edits 3-way merge against it instead of false-conflicting (#3590)`,
    );
    return { kind: "additive-base", base };
  }

  /**
   * Asset-mode first-sync probe (no watermark). Classifies the local working
   * tree against the remote head into one of three outcomes (see
   * {@link FirstSyncBootstrap}):
   *
   *  - **clean mount** — local tree identical to remote: seed the watermark,
   *    no-op (`settled` → `synced`).
   *  - **purely additive** (#3565) — every remote-head file is present on disk
   *    byte-identical (R ⊆ L) and disk has extra local-only files: return a
   *    synthetic base = the remote head tree (`additive-base`). The normal
   *    cycle then derives the local-only files as pushable adds — a clean
   *    fast-forward, no remote changes to reconcile, M1 zero-loss intact
   *    (no overwrite, no merge needed). The real watermark is persisted by
   *    `advanceWatermark` at the end of the successful cycle.
   *  - **genuine divergence** — a remote-head file absent locally, OR a
   *    same-path content difference (overlapping edit): `settled` →
   *    `full-conflict`. Routed to the merge/quarantine layer (A2/A3, D22),
   *    NEVER a silent overwrite. Reserving `full-conflict` for real overlaps
   *    is what distinguishes this from the additive case.
   */
  private async bootstrapWatermark(
    spec: SyncRepoSpec,
    disk: ReadonlyMap<string, SyncContent>,
    warnings: string[],
    result: (
      status: RepoSyncResult["status"],
      extra?: Partial<RepoSyncResult>,
    ) => RepoSyncResult,
  ): Promise<FirstSyncBootstrap> {
    const head = await getHeadSha(
      this.transport,
      spec.owner,
      spec.repo,
      spec.branch,
      this.deps.baseURL,
    );

    // #3590 — true merge-base first-sync. If the mount layer recorded the
    // commit this AssetSpace was mounted at, and the remote has ADVANCED since
    // (head ≠ mount, mount is a genuine ancestor of head), use the mount
    // commit's tree as the 3-way base. The normal cycle then reconciles remote
    // changes (pull) against local changes (push): a divergence on DISJOINT
    // paths cleanly merges instead of false full-conflict, while a real
    // overlapping edit still routes through the merge/quarantine layer (M1
    // zero-loss). Absent / stale / unresolvable / not-an-ancestor → null → the
    // conservative R⊆L path below (full-conflict on overlap) is unchanged.
    const mountBootstrap = await this.tryMountBaseBootstrap(
      spec,
      head,
      disk,
      warnings,
      result,
    );
    if (mountBootstrap !== null) return mountBootstrap;

    const headCommit = await getCommitInfo(
      this.transport,
      spec.owner,
      spec.repo,
      head,
      this.deps.baseURL,
    );
    const headTree = (
      await getTree(
        this.transport,
        spec.owner,
        spec.repo,
        headCommit.treeSha,
        this.deps.baseURL,
      )
    ).filter((e) => isSyncablePath(e.path));

    // Verify R ⊆ L: every remote-head file must be present on disk with an
    // identical blob. A remote file absent locally, or a same-path content
    // difference, is a GENUINE first-sync divergence (remote-side edits/files
    // to reconcile, or an overlapping edit). #3565: the count check that used
    // to gate the additive case is GONE — a pure local-only superset
    // (disk.size > headTree.length) is no longer a conflict.
    //
    // Unlike the historical short-circuit (return `full-conflict` on the FIRST
    // divergence — a whole-repo deadlock), the divergent/absent head files are
    // COLLECTED out of the synthetic base and the run reconciles ZERO-LOSS via
    // the no-base path below — provided a merge layer is wired to route the
    // overlaps safely (else the conservative status quo is preserved).
    const matchingFiles: WatermarkFileEntry[] = [];
    let firstDivergentPath: string | undefined;
    for (const entry of headTree) {
      const content = disk.get(entry.path);
      if (
        content === undefined ||
        (await gitBlobSha(content, this.sha1)) !== entry.blobSha
      ) {
        // Divergent (same-path content difference) or absent on disk: NOT part
        // of the R⊆L synthetic base. Absent-on-disk → a remote-only ADD the
        // cycle pulls (resurrection, the accepted first-sync trade-off, M1 —
        // never inferred as a silent delete). Same-path difference → an add/add
        // overlap routed through the merge/quarantine layer below.
        if (firstDivergentPath === undefined) firstDivergentPath = entry.path;
        continue;
      }
      // Asset-mode-only path (file-mode first-sync goes through the remote-wins
      // layer): contents are text by construction.
      const uid =
        typeof content === "string" ? extractAssetUid(content) : undefined;
      matchingFiles.push({
        path: entry.path,
        blobSha: entry.blobSha,
        ...(uid ? { uid } : {}),
      });
    }

    // The synthetic base = the R⊆L-matching subset. Every base file is present
    // on disk BY CONSTRUCTION, so the #3610 silent-delete inference (a base file
    // absent from the working tree) can never fire on this base.
    const base: WatermarkRecord = {
      lastSyncedSha: head,
      rootTreeSha: headCommit.treeSha,
      files: matchingFiles,
    };

    if (firstDivergentPath !== undefined) {
      // GENUINE first-sync divergence with NO 3-way merge base available
      // (no recorded mount base, no submodule HEAD to backfill — REST/tarball
      // private mounts, mobile). Historically this DEAD-ENDED at `full-conflict`
      // and froze the WHOLE repo, pushing/pulling nothing and establishing no
      // watermark (the empirical exoas-tbank work-MacBook deadlock, WBS
      // bde445cd). With the A2 merge/quarantine layer available, reconcile
      // ZERO-LOSS against the byte-identical subset instead: the normal cycle
      // PULLS remote-only files, PUSHES local-only files, and routes overlapping
      // same-path divergences through the merge layer — a disjoint edit
      // auto-merges (D20 union), a true overlap QUARANTINES both versions (D17).
      // Local stays on disk, remote stays on the remote, both captured in the
      // quarantine sink: never a silent overwrite, never a silent delete.
      //
      // Without a merge layer there is no safe place to route an overlap, so the
      // conservative status quo (full-conflict) is preserved — refuse, never
      // guess. (Production ALWAYS wires the merge layer; the gate is what keeps
      // the no-merge-layer compositions' conservative contract intact.)
      if (this.deps.mergeLayer === undefined) {
        return {
          kind: "settled",
          outcome: result("full-conflict", {
            detail: `first-sync: no watermark and local content diverges from remote head at ${firstDivergentPath} — A2/A3 scope`,
          }),
        };
      }
      warnings.push(
        `first-sync (asset mode): no 3-way merge base and local diverges from remote head (first at ${firstDivergentPath}) — reconciling ZERO-LOSS against ${matchingFiles.length} byte-identical file(s) as a synthetic base: remote-only files pull, local-only files push, overlapping divergences route to the merge/quarantine layer (both versions preserved), never a silent overwrite or delete`,
      );
      return { kind: "additive-base", base };
    }

    // R ⊆ L holds — `matchingFiles` is the FULL remote head tree.
    if (disk.size === headTree.length) {
      // Clean mount — local tree identical to remote: seed + no-op (fast path,
      // avoids the synthetic-base cycle + its extra remote diff for the common
      // 12/13 unchanged repos on every apply-profile).
      await this.deps.watermarkStore.set(spec.repoKey, base);
      warnings.push(
        `watermark bootstrapped from head ${head} (local tree identical to remote)`,
      );
      return { kind: "settled", outcome: result("synced") };
    }

    // disk.size > headTree.length → PURELY ADDITIVE first-sync (#3565): the
    // only divergence is local-only new files (R ⊆ L by path+blob, verified
    // above). Hand the head-tree base back so the normal cycle derives those
    // locals as pushable adds. Without this, the canonical onboarding
    // (apply profile → create asset → Sync) deadlocked: every direction
    // returned `full-conflict — first-sync` and pushed nothing.
    warnings.push(
      `first-sync (asset mode): local tree (${disk.size} files) is a pure superset of remote head ${head} (${headTree.length} files) — ${disk.size - headTree.length} local-only addition(s) derive as pushable adds (#3565)`,
    );
    return { kind: "additive-base", base };
  }

  /**
   * Fetch base..head remote changes with contents + uids. Also returns the
   * RAW head tree as a path→blobSha lookup so the push phase can reuse it
   * for the #3475 phantom-commit guard without a second tree GET.
   */
  private async collectRemoteChanges(
    spec: SyncRepoSpec,
    watermark: WatermarkRecord,
    head: string,
    mode: ModeOps,
    sizeExcluded: ReadonlySet<string> = new Set(),
    warnings: string[] = [],
    remoteOversized: Set<string> = new Set(),
  ): Promise<{
    changes: RemoteChange[];
    headTreeByPath: Map<string, string>;
  }> {
    const headCommit = await getCommitInfo(
      this.transport,
      spec.owner,
      spec.repo,
      head,
      this.deps.baseURL,
    );
    const rawTree = await getTree(
      this.transport,
      spec.owner,
      spec.repo,
      headCommit.treeSha,
      this.deps.baseURL,
    );
    // A REMOTE blob over the size cap (file mode) is excluded from the
    // diff symmetrically: dropping it from the head tree alone would make
    // its base entry read as a remote DELETE and destroy the local ≤cap
    // copy (reviewer HIGH). Locally size-excluded paths are equally
    // invisible on the remote side. The accumulator is caller-owned — the
    // paths get PINNED so re-entry under the cap derives as a conflict.
    if (mode.fileMode) {
      for (const e of rawTree) {
        if (
          mode.syncable(e.path) &&
          !mode.treeFilter(e) &&
          !remoteOversized.has(e.path)
        ) {
          remoteOversized.add(e.path);
          warnings.push(
            `skipped oversized REMOTE file ${e.path} (${e.size ?? "?"} bytes over cap) — excluded from sync symmetrically (Phase C size cap)`,
          );
        }
      }
    }
    const headTree = rawTree.filter(
      (e) => mode.treeFilter(e) && !sizeExcluded.has(e.path),
    );
    const baseFiles = watermark.files.filter(
      (f) => !remoteOversized.has(f.path) && !sizeExcluded.has(f.path),
    );
    const { changed, deleted } = diffTrees(baseFiles, headTree);

    const changes: RemoteChange[] = [];
    for (const c of changed) {
      if (mode.fileMode) {
        // Opaque blobs: byte-exact fetch, no uid identity (D18).
        const bytes = await getBlobBytes(
          this.transport,
          spec.owner,
          spec.repo,
          c.blobSha,
          this.deps.baseURL,
        );
        changes.push({
          path: c.path,
          kind: "change",
          blobSha: c.blobSha,
          content: bytes,
        });
        continue;
      }
      const content = await getBlobText(
        this.transport,
        spec.owner,
        spec.repo,
        c.blobSha,
        this.deps.baseURL,
      );
      changes.push({
        path: c.path,
        kind: "change",
        blobSha: c.blobSha,
        content,
        uid: extractAssetUid(content),
      });
    }
    for (const d of deleted) {
      changes.push({ path: d.path, kind: "delete", uid: d.uid });
    }
    return { changes, headTreeByPath: treeByPath(rawTree) };
  }

  /**
   * Conflict detection: any shared identity — same uid, or same path —
   * between pinned local changes and remote changes is a conflict group,
   * EXCEPT convergent edits (identical blob both sides) and convergent
   * deletes, which are dropped from the push/apply sets. Conflicting remote
   * changes are consumed (never pull-applied as-is); the caller routes the
   * groups through the A2 merge layer — or, without one, maps the first
   * group to the A1 `conflict` status (nothing pushed, nothing written).
   */
  private matchLocalVsRemote(
    localChanges: AssetChange[],
    localDeletedPaths: Set<string>,
    disk: ReadonlyMap<string, SyncContent>,
    remote: RemoteChange[],
    convergedPushPaths: Set<string>,
    dupUids: ReadonlySet<string> = new Set(),
    headTreeByPath?: ReadonlyMap<string, string>,
  ): {
    conflicts: ConflictGroup[];
    applyWrites: RemoteChange[];
    applyDeletes: RemoteChange[];
  } {
    const consumed = new Set<RemoteChange>();
    const conflicts: ConflictGroup[] = [];
    // #3477: uid matching is suppressed for duplicated uids — local-side
    // dups arrive via `dupUids` (ChangeDetector), remote-side dups are
    // counted here over CHANGE entries only. A genuine remote rename is one
    // change + one delete sharing a uid — counting deletes would suppress
    // every rename and silently apply its new path over a local edit.
    const remoteChangeUidCount = new Map<string, number>();
    for (const r of remote) {
      if (r.kind === "change" && r.uid !== undefined) {
        remoteChangeUidCount.set(
          r.uid,
          (remoteChangeUidCount.get(r.uid) ?? 0) + 1,
        );
      }
    }
    const suppressedUids = new Set<string>(dupUids);
    for (const [uid, count] of remoteChangeUidCount) {
      if (count > 1) suppressedUids.add(uid);
    }
    const remoteByUid = new Map<string, RemoteChange[]>();
    const remoteByPath = new Map<string, RemoteChange>();
    for (const r of remote) {
      if (r.uid !== undefined && !suppressedUids.has(r.uid)) {
        const list = remoteByUid.get(r.uid) ?? [];
        list.push(r);
        remoteByUid.set(r.uid, list);
      }
      remoteByPath.set(r.path, r);
    }

    for (const local of localChanges) {
      const candidates = new Set<RemoteChange>();
      if (local.uid !== undefined && !suppressedUids.has(local.uid)) {
        for (const r of remoteByUid.get(local.uid) ?? []) {
          // #3477 copy-vs-rename evidence: a cross-path remote CHANGE
          // sharing the uid is rename evidence only when the local path is
          // GONE from the remote head. If the head still carries our path,
          // the remote change is an independent copy (template-copy
          // arrival) — uid-matching it would cross-conflict the copy with
          // the local edit and strand both behind a spurious quarantine.
          //
          // #3485: for a LOCAL rename A→B the head carries A (the basePath),
          // not B (local.path), so consulting local.path alone never fires
          // the guard — the copy uid-matches the renamed change and the pair
          // quarantines instead of converging in one cycle. The basePath
          // still being on the head is equally strong copy evidence: the
          // asset our rename is based on was not moved remotely, so the
          // cross-path change is an independent copy, not rename evidence.
          if (
            r.kind === "change" &&
            r.path !== local.path &&
            (headTreeByPath?.has(local.path) === true ||
              (local.basePath !== undefined &&
                headTreeByPath?.has(local.basePath) === true))
          ) {
            continue;
          }
          candidates.add(r);
        }
      }
      const byPath = remoteByPath.get(local.path);
      if (byPath !== undefined) candidates.add(byPath);
      if (local.basePath !== undefined) {
        const byBasePath = remoteByPath.get(local.basePath);
        if (byBasePath !== undefined) candidates.add(byBasePath);
      }

      const conflicting: RemoteChange[] = [];
      let localIsDelete = false;
      for (const r of candidates) {
        localIsDelete =
          localDeletedPaths.has(local.path) && !disk.has(local.path);
        if (localIsDelete && r.kind === "delete") {
          consumed.add(r); // convergent delete — already gone on both sides
          continue;
        }
        if (
          !localIsDelete &&
          r.kind === "change" &&
          r.path === local.path &&
          r.blobSha === local.blobSha
        ) {
          // Convergent edit: identical content already on remote — drop from
          // push, drop from apply.
          consumed.add(r);
          convergedPushPaths.add(local.path);
          continue;
        }
        if (
          r.kind === "delete" &&
          local.basePath !== undefined &&
          r.path === local.basePath
        ) {
          // Convergent rename (A2 deferred MEDIUM): both sides renamed
          // basePath → path. The remote delete of the OLD path is only
          // convergent when the remote also carries the SAME content at the
          // NEW path — anything weaker (a genuine remote delete, or a rename
          // with an edit) must keep conflicting: silently consuming it would
          // let the next sync push the renamed copy and resurrect a
          // remotely-deleted asset.
          const remoteAtNewPath = remoteByPath.get(local.path);
          if (
            remoteAtNewPath !== undefined &&
            remoteAtNewPath.kind === "change" &&
            remoteAtNewPath.blobSha === local.blobSha
          ) {
            consumed.add(r); // old path gone on both sides
            continue;
          }
        }
        conflicting.push(r);
        consumed.add(r); // conflicting remote is owned by the merge layer
      }
      if (conflicting.length > 0) {
        conflicts.push({
          local,
          localIsDelete,
          remotes: conflicting,
          // For suppressed (duplicated) uids the uid is ambiguous across
          // paths — identify the group by path instead (#3477).
          desc: `${local.uid !== undefined && !suppressedUids.has(local.uid) ? local.uid : local.path} (local ${localIsDelete ? "delete" : "change"} vs remote ${conflicting[0].kind} at ${conflicting[0].path})`,
        });
        // A conflicting local change must not also be pushed as-is — its
        // outcome (merged content or quarantine) replaces the raw push.
        convergedPushPaths.add(local.path);
      }
    }

    const remaining = remote.filter((r) => !consumed.has(r));
    return {
      conflicts,
      applyWrites: remaining.filter((r) => r.kind === "change"),
      applyDeletes: remaining.filter((r) => r.kind === "delete"),
    };
  }

  /**
   * Post-push race-window detection (the primitive has no CAS, D9): if the
   * pushed commit's parent is not the head this engine examined, a concurrent
   * commit slipped between the conflict check and the primitive's internal
   * fresh GET-ref. Only an overlap with pushed paths is a potential lost
   * update — warn per file (recoverable from git history).
   */
  private async checkRaceWindow(
    spec: SyncRepoSpec,
    watermark: WatermarkRecord,
    examinedHead: string,
    actualParent: string,
    pushFiles: Map<string, SyncContent>,
    pushedDeletions: ReadonlySet<string>,
    warnings: string[],
    mode: ModeOps,
  ): Promise<void> {
    try {
      const parentCommit = await getCommitInfo(
        this.transport,
        spec.owner,
        spec.repo,
        actualParent,
        this.deps.baseURL,
      );
      const parentTree = (
        await getTree(
          this.transport,
          spec.owner,
          spec.repo,
          parentCommit.treeSha,
          this.deps.baseURL,
        )
      ).filter(mode.treeFilter);
      const examinedFiles: WatermarkFileEntry[] =
        examinedHead === watermark.lastSyncedSha
          ? watermark.files
          : (
              await getTree(
                this.transport,
                spec.owner,
                spec.repo,
                (
                  await getCommitInfo(
                    this.transport,
                    spec.owner,
                    spec.repo,
                    examinedHead,
                    this.deps.baseURL,
                  )
                ).treeSha,
                this.deps.baseURL,
              )
            ).filter(mode.treeFilter);
      const { changed, deleted } = diffTrees(examinedFiles, parentTree);
      for (const c of changed) {
        if (pushFiles.has(c.path)) {
          warnings.push(
            `race-window: concurrent commit ${actualParent} changed ${c.path} between conflict check (head ${examinedHead}) and push — local version won; previous version recoverable from git history`,
          );
        }
        if (pushedDeletions.has(c.path)) {
          warnings.push(
            `race-window: concurrent commit ${actualParent} changed ${c.path} which this push DELETED — the delete won; the concurrent version is recoverable from git history`,
          );
        }
      }
      for (const d of deleted) {
        if (pushFiles.has(d.path)) {
          warnings.push(
            `race-window: concurrent commit ${actualParent} deleted ${d.path}; push re-created it`,
          );
        }
      }
    } catch (err) {
      const redact = this.deps.redact ?? ((m: string): string => m);
      warnings.push(`race-window check failed: ${redact(errMsg(err))}`);
    }
  }

  /**
   * Build the watermark snapshot for the new head tree, resolving uids from
   * already-known contents (disk, just-pulled remote blobs, previous
   * watermark) and fetching the rare unknown blob.
   */
  private async buildWatermarkFiles(
    spec: SyncRepoSpec,
    newTree: RemoteTreeEntry[],
    disk: ReadonlyMap<string, SyncContent>,
    applied: RemoteChange[],
    previous: WatermarkRecord,
    diskBlobShas: ReadonlyMap<string, string> | undefined,
    mode: ModeOps,
  ): Promise<WatermarkFileEntry[]> {
    if (mode.fileMode) {
      // Opaque blobs carry no uid identity (D18) — no content resolution,
      // no per-blob fetch (advisor H3: the uid fallback would burn one API
      // call per binary blob on every rebuild for nothing).
      return newTree.map((entry) => ({
        path: entry.path,
        blobSha: entry.blobSha,
      }));
    }
    const uidByBlobSha = new Map<string, string | undefined>();
    for (const r of applied) {
      if (r.kind === "change" && r.blobSha !== undefined) {
        uidByBlobSha.set(r.blobSha, r.uid);
      }
    }
    for (const [path, content] of disk) {
      // Reuse the blob SHA computed during change detection (A1 perf
      // finding: no-op syncs double-hashed the whole working tree).
      const sha =
        diskBlobShas?.get(path) ?? (await gitBlobSha(content, this.sha1));
      uidByBlobSha.set(
        sha,
        typeof content === "string" ? extractAssetUid(content) : undefined,
      );
    }
    for (const prev of previous.files) {
      if (!uidByBlobSha.has(prev.blobSha)) {
        uidByBlobSha.set(prev.blobSha, prev.uid);
      }
    }

    const files: WatermarkFileEntry[] = [];
    for (const entry of newTree) {
      let uid: string | undefined;
      if (uidByBlobSha.has(entry.blobSha)) {
        uid = uidByBlobSha.get(entry.blobSha);
      } else {
        const content = await getBlobText(
          this.transport,
          spec.owner,
          spec.repo,
          entry.blobSha,
          this.deps.baseURL,
        );
        uid = extractAssetUid(content);
      }
      files.push({
        path: entry.path,
        blobSha: entry.blobSha,
        ...(uid ? { uid } : {}),
      });
    }
    return files;
  }
}
