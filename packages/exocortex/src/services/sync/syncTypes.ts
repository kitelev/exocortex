/**
 * ExoSync A1 — shared types & ports (RFC 4e4dc453, decisions D3/D8/D12/D16/D18/D19/D22).
 *
 * Platform-free hexagonal core, following the `restCommit.ts` (injected
 * transport) and `AssetSpaceMount.ts` (injected FileSystemPort/HttpClient)
 * precedents. The genuinely platform-specific pieces — how local files hit
 * disk, where the per-device watermark persists, how SHA-1 is computed — are
 * injected via the ports below; the sync orchestration itself is platform-free
 * (iOS-portable, same as the write primitive it reuses).
 */

import type { SyncPhaseTimings } from "./SyncPhaseTimer";

/**
 * Which `exo__Space` subtype a sync unit declares (Phase C, onto-RFC
 * 18808c73). `"asset"` (default) — UID-bearing markdown assets, text-only
 * allowlist, structured merge. `"file"` — opaque blobs (attachments): every
 * file syncs byte-exact, no uid identity, no structured merge — conflicts
 * resolve remote-wins with the losing LOCAL version preserved in quarantine
 * (D18). The kind comes from the vault's RDF declaration
 * (`exo__Instance_class` → `exo__FileSpace`), read by the spec collector —
 * never from hardcoded paths.
 */
export type SpaceKind = "asset" | "file";

/** One repo of the active profile's materialized set (sync unit, D7/VL#4). */
export interface SyncRepoSpec {
  owner: string;
  repo: string;
  branch: string;
  /** Stable key for watermark storage (convention: `owner/repo#branch`). */
  repoKey: string;
  /**
   * Local mount path inside the vault/superproject. Used only for
   * children-before-parent ordering (D12) — deeper paths sync first.
   */
  localPath: string;
  /** Space subtype (Phase C). Absent ⇒ `"asset"` (backward compatible). */
  spaceKind?: SpaceKind;
}

/**
 * File content traveling through the engine: UTF-8 text (asset mode) or
 * raw bytes (file mode, Phase C). Binary never round-trips through string
 * decode — that would corrupt it.
 */
export type SyncContent = string | Uint8Array;

/** Byte/string equality across the two content representations. */
export function contentEquals(
  a: SyncContent | undefined,
  b: SyncContent | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "string" || typeof b === "string") return false;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** One file of the watermark snapshot (remote tree at lastSyncedSha). */
export interface WatermarkFileEntry {
  /** Repo-relative path, forward-slash normalised. */
  path: string;
  /** Git blob SHA (as reported by the remote tree). */
  blobSha: string;
  /** `exo__Asset_uid` parsed from frontmatter at last sync, if present (D18). */
  uid?: string;
}

/**
 * Per-device, per-repo sync base (D8). Lives in a NON-synced store
 * (`data.local.json`-style, `.local.`-infix Sync-excluded). The snapshot is the
 * REMOTE tree at `lastSyncedSha`, scoped to the sync text allowlist — it is the
 * 3-way base for change detection. It is never trusted blindly: D22 validates
 * `rootTreeSha` against the actual remote commit before any diff.
 */
export interface WatermarkRecord {
  /** Commit SHA of the last fully-synced state. */
  lastSyncedSha: string;
  /** Root tree SHA of that commit — O(1) D22 base validation. */
  rootTreeSha: string;
  /** Allowlist-scoped snapshot of the remote tree at `lastSyncedSha`. */
  files: WatermarkFileEntry[];
  /**
   * Paths whose remote change was NOT applied in the sync that produced this
   * record (TOCTOU skip, unsafe path, quarantined conflict). Their `files`
   * entries are the PREVIOUS base, intentionally diverging from the
   * `lastSyncedSha` tree so the divergence re-derives next sync. Non-empty ⇒
   * the engine must diff against the head tree even when the head SHA equals
   * `lastSyncedSha`.
   */
  pinnedPaths?: string[];
  /**
   * Set to `"file"` for watermarks written by a file-mode sync (Phase C).
   * Purely diagnostic / downgrade guard: an older engine reading a
   * file-mode watermark would md-filter the head tree and infer phantom
   * deletes for binary entries — the marker lets future versions detect
   * and refuse that. Additive; absent for asset-mode records.
   */
  spaceKind?: SpaceKind;
}

/** Per-device watermark persistence port (D8; production impl is A3 scope). */
export interface WatermarkStorePort {
  get(repoKey: string): Promise<WatermarkRecord | null>;
  set(repoKey: string, record: WatermarkRecord): Promise<void>;
}

/**
 * Per-device, per-repo record of the commit SHA the AssetSpace was MOUNTED at
 * (#3590). The mount/apply layer extracts this SHA correct-by-construction from
 * the GitHub tarball wrapper dir (`<owner>-<repo>-<sha>/`) and records it the
 * instant the working tree is materialized — BEFORE the user makes any local
 * edits and BEFORE the remote head can advance.
 *
 * It is the true 3-way **merge base** for the FIRST sync (no watermark yet): the
 * common ancestor of the local working tree and the remote head. Without it, a
 * first-sync where the remote has advanced on DISJOINT files since the mount
 * could only be classified as a `full-conflict` (the engine cannot tell a clean
 * remote-only change from an overlapping edit), blocking onboarding (#3590).
 *
 * Lives in the SAME non-synced device-local store as the watermark
 * (`.local.`-infix, Sync-excluded) — the merge base is device-specific. Like
 * the watermark, it is never trusted blindly: the engine verifies the recorded
 * SHA is a genuine ancestor of the current remote head before using its tree as
 * the base, and falls back to the conservative `full-conflict` if it is absent,
 * unresolvable (GC'd / rewritten), or not an ancestor — never a silent
 * overwrite (M1 zero-loss).
 */
export interface MountBaseStorePort {
  /** The commit SHA the repo was mounted at, or `null` if none recorded. */
  get(repoKey: string): Promise<string | null>;
  /** Record the mounted commit SHA (called by the apply/mount layer). */
  set(repoKey: string, sha: string): Promise<void>;
}

/**
 * One file's entry in the per-device local mtime-manifest (perf, ExoSync
 * Phase 1). A content-addressing CACHE keyed by `(mtimeMs, size)`: when a
 * file's current stat matches a stored entry, its `blobSha` (and parsed
 * `uid`) are reused WITHOUT reading or re-hashing the file. The keying fact:
 * any real edit through Obsidian/the OS bumps `mtimeMs` (and usually `size`),
 * so an unchanged `(mtimeMs, size)` reliably means unchanged content. The one
 * theoretical hole — a content edit that preserves BOTH mtime and byte-size —
 * is backstopped by the periodic full re-hash (see
 * {@link LocalManifestRecord.lastFullRehashMs}) and, when the remote also
 * moved, by the remote tree-SHA diff. NEVER a content authority.
 */
export interface LocalManifestEntry {
  /** File modification time (ms) captured when the blobSha was computed. */
  mtimeMs: number;
  /** File byte size captured when the blobSha was computed. */
  size: number;
  /** Git blob SHA of the content at that `(mtimeMs, size)`. */
  blobSha: string;
  /** `exo__Asset_uid` parsed from the content then, if present (asset mode). */
  uid?: string;
}

/**
 * Per-device, per-repo local file manifest (perf cache). Lives in the SAME
 * NON-synced device-local store family as the watermark (`.local.`-infix,
 * Sync-excluded) — file mtimes are device-specific. Tolerant: a
 * missing/corrupt record means "no cache" → the engine reads+hashes every
 * file (status quo), never a wrong skip.
 */
export interface LocalManifestRecord {
  version: 1;
  /** Cache entries keyed by repo-relative forward-slash path. */
  files: Record<string, LocalManifestEntry>;
  /**
   * Wall-clock (ms) of the last FULL re-hash (cache bypass). Zero-loss
   * safety valve: when `now - lastFullRehashMs >= fullRehashIntervalMs` the
   * engine ignores the cache and re-hashes every file, catching the
   * (extraordinarily rare) edit that preserved both mtime and size. Bounds
   * the staleness window to the interval regardless of sync frequency.
   */
  lastFullRehashMs: number;
}

/**
 * Per-device local manifest persistence port (perf). Absent ⇒ the
 * mtime-manifest optimisation is disabled and the engine reads+hashes every
 * file each sync (status quo, zero regression). Tolerant on read (corrupt ⇒
 * `null` ⇒ full re-hash), atomic on write (temp+rename) like the watermark
 * store — a torn manifest is harmless (re-hash) but must never be a wrong
 * skip.
 */
export interface LocalManifestStorePort {
  get(repoKey: string): Promise<LocalManifestRecord | null>;
  set(repoKey: string, record: LocalManifestRecord): Promise<void>;
}

/**
 * Local working-tree access for ONE repo, repo-relative forward-slash paths.
 * String content only — binary attachments are out of A1 scope (Phase C,
 * D4/VL#3); the engine additionally applies {@link isSyncablePath} so adapters
 * may list everything.
 */
export interface LocalFilesPort {
  /** List repo-relative paths of all currently materialized files. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  /**
   * Write a file. Implementations MUST write atomically (temp file +
   * rename) — a crash mid-write must never leave a torn file on disk
   * (engineering baseline, RFC 4e4dc453 A3). The engine routes merged
   * contents and pulled remote changes through this method.
   */
  write(path: string, content: string): Promise<void>;
  /** Remove a file. MUST be a no-op if the path does not exist. */
  delete(path: string): Promise<void>;
  /**
   * Byte-exact read (Phase C, file-mode repos). REQUIRED for
   * `spaceKind: "file"` specs — the engine refuses to sync a file-mode
   * repo through a port without it (a string round-trip would corrupt
   * binary content), surfacing a loud `error` result instead.
   */
  readBinary?(path: string): Promise<Uint8Array>;
  /** Byte-exact atomic write (same atomicity contract as {@link write}). */
  writeBinary?(path: string, bytes: Uint8Array): Promise<void>;
  /**
   * Cheap file metadata (modification time + byte size) WITHOUT reading the
   * content — the mtime-manifest optimisation (perf, ExoSync Phase 1). Returns
   * `null` when the path does not exist. OPTIONAL: a port without it disables
   * the optimisation (the engine falls back to reading+hashing every file —
   * status quo, zero regression). CLI: `node:fs` `stat().mtimeMs`/`size`;
   * plugin: `DataAdapter.stat().mtime`/`size`. Used ONLY to decide whether a
   * file is unchanged since the last sync — NEVER as a content authority (the
   * blobSha cache is keyed by `(mtime, size)`, and a periodic full re-hash +
   * the remote tree-SHA still backstop a mtime-preserving edit; M1 zero-loss).
   */
  stat?(path: string): Promise<{ mtimeMs: number; size: number } | null>;
}

/** Result of the full-materialization gate check (D19). */
export interface MaterializationCheck {
  fullyMaterialized: boolean;
  reason?: string;
}

/**
 * Full-materialization gate (D19). The MOUNT layer owns the knowledge of
 * whether a repo is 100% materialized (working-tree file-set == manifest,
 * superproject pointer resolvable); the engine only enforces the semantics:
 * a non-fully-materialized repo is SKIPPED with a warning and deletes are
 * NEVER inferred from local absence.
 */
export interface MaterializationCheckPort {
  check(spec: SyncRepoSpec): Promise<MaterializationCheck>;
}

/**
 * Injected SHA-1 over raw bytes, hex-encoded lowercase. CLI: `node:crypto`;
 * plugin: `crypto.subtle.digest("SHA-1", …)`. Used ONLY for git blob-sha
 * computation (content addressing parity with the remote tree) — not for
 * security.
 */
export type Sha1Fn = (bytes: Uint8Array) => Promise<string>;

/** One locally changed asset, matched by `exo__Asset_uid` where present (D18). */
export interface AssetChange {
  /** Current path on disk (for deletions — the base path). */
  path: string;
  uid?: string;
  /** Disk blob SHA for added/modified; base blob SHA for deleted. */
  blobSha: string;
  /** For uid-matched renames: the path the asset had in the base snapshot. */
  basePath?: string;
}

/** Outcome of {@link detectChanges} (CQ2). */
export type ChangeDetectionResult =
  | {
      kind: "full-conflict";
      /**
       * `first-sync`: no watermark exists (D22) — the divergence must go
       * through the merge/quarantine layer (A2/A3), never silent overwrite.
       * `base-mismatch`: the stored watermark does not match the actual remote
       * tree at `lastSyncedSha` (backup-restore, history rewrite, corrupt
       * store — R10).
       */
      reason: "first-sync" | "base-mismatch";
      detail?: string;
    }
  | {
      kind: "changes";
      added: AssetChange[];
      modified: AssetChange[];
      deleted: AssetChange[];
      /** Non-fatal anomalies (e.g. duplicate uid on disk). */
      warnings: string[];
      /**
       * Git blob SHA per disk path, computed during detection — callers reuse
       * it (watermark build) instead of re-hashing the whole working tree.
       */
      diskBlobShas: Map<string, string>;
      /**
       * Uids seen on MORE than one path (on disk or in the base) — a vault
       * anomaly (#3477, template-copy artifact). The whole group matched by
       * path identity; the engine must suppress uid-based remote matching
       * for these uids too, or a single remote change cross-conflicts with
       * every member of the group.
       */
      duplicateUids: ReadonlySet<string>;
    };

/**
 * Direction of a sync run (#3473). Both split directions are SUBSETS of the
 * full cycle: `pull` applies remote changes only (nothing leaves the device
 * — no push, local changes stay undiffed), `push` sends the local delta only
 * (remote changes are never applied to disk — their paths are pinned so they
 * re-derive on the next pull/Sync). Split runs NEVER resolve conflicts:
 * every conflicting path is pinned and deferred to a full `sync` run.
 */
export type SyncDirection = "sync" | "pull" | "push";

/** Per-repo sync outcome (CQ5). `syncAll` never throws — D12 warn-not-block. */
export interface RepoSyncResult {
  repoKey: string;
  status:
    | "synced"
    | "skipped-not-materialized"
    | "full-conflict"
    | "conflict"
    | "retry-exhausted"
    /** Another sync/apply operation is already running (D11 guard). */
    | "busy"
    /**
     * Push/pull failed with HTTP 401/403 (NOT rate-limit) — the PAT is
     * expired, revoked or under-scoped. Consumers must surface an explicit
     * "update your PAT" prompt (R8) and never treat this as success.
     */
    | "auth-required"
    | "error";
  /** New commit SHA when a push happened. */
  pushedSha?: string;
  /** Remote changes applied to local disk (pull phase). */
  pulledCount: number;
  /** Files pushed to remote. */
  pushedCount: number;
  /** Conflicting assets resolved by the merge layer (A2). */
  mergedCount: number;
  /**
   * Conflicting assets the merge layer could NOT resolve (or whose merged
   * result failed the SHACL gate). Each is routed to the QuarantinePort
   * (when wired), left untouched on disk AND pinned in the watermark so the
   * conflict re-derives every sync until resolved (D17; synced quarantine
   * store is A3 scope).
   */
  quarantinedCount: number;
  /**
   * Paths whose content the merge layer legitimately TRANSFORMED this round
   * (3-way structured merge applied). Additive (ExoSync E1): the parity
   * harness's edit-conservation check needs per-path identity — a pre-sync
   * dirty path whose post-sync content matches neither the pre-sync blob
   * nor the new head tree is accounted for (not a lost edit) exactly when
   * it is listed here. Absent/empty ⇒ no merges this round.
   */
  mergedPaths?: string[];
  /**
   * Paths routed to the quarantine sink this round — unresolved entries AND
   * file-mode resolved remote-wins copies (whose losing LOCAL version lives
   * only in quarantine, never pinned — advisor C2). Additive (ExoSync E1):
   * the conservation check accepts a vanished local version when its path
   * is listed here (the bytes are preserved durably, M1-safe).
   */
  quarantinedPaths?: string[];
  warnings: string[];
  /**
   * Paths whose DELETION was propagated to the remote in the pushed commit
   * (#3476): plain local deletes and the old half of renames. Absent/empty
   * ⇒ no deletions pushed this round.
   */
  pushedDeletes?: string[];
  /**
   * Local deletes/renames detected but NOT pushed THIS cycle: pull-only
   * runs (the push set is empty by construction, #3473) and deletions
   * withheld by the conflict path (delete-vs-modify → merge/quarantine).
   * They re-derive on the next sync — never silently dropped.
   */
  deferredDeletes: string[];
  /**
   * Split-run deferrals (#3473): paths whose resolution was deferred to a
   * full Sync — conflicts (any direction) and, in push-only runs, remote
   * changes that were detected but never applied to disk. Each is pinned in
   * the watermark so it re-derives on the next run (in the race-window path
   * the watermark is not advanced at all — strictly more conservative than
   * a pin, same re-derivation guarantee). Absent/empty ⇒ nothing deferred
   * this round (always absent for full `sync` runs).
   */
  deferredPaths?: string[];
  /**
   * Phase 0 (measure-first) — per-phase wall-clock breakdown of this repo's
   * sync: local list/read/write, SHA-1 hashing, and each remote REST class
   * (head/commit/tree/blob/push), plus operation counts. Observation-only,
   * always populated by the engine. Consumers aggregate it into a readable
   * per-sync summary so the dominant phase is visible on the device (iPhone).
   * See {@link SyncPhaseTimings}.
   */
  timings?: SyncPhaseTimings;
  detail?: string;
}

/** One conflicting asset handed to the merge layer (D1). */
export interface MergeConflictInput {
  /** Canonical (local) repo-relative path. */
  path: string;
  uid?: string;
  /** 3-way base content; `undefined` = did not exist at the base. */
  base?: string;
  /** Local content; `undefined` = deleted locally. */
  local?: string;
  /** Remote content; `undefined` = deleted remotely. */
  remote?: string;
}

/** Merge-layer verdict for one conflicting asset. */
export type MergeDecision =
  | { action: "use-merged"; content: string; warnings?: string[] }
  | { action: "quarantine"; reason: string };

/**
 * The A2 merge layer port. Production composition is
 * `GatedStructuredMerger` (StructuredMerger + open-world SHACL gate); the
 * engine stays agnostic. Absent ⇒ A1 behavior (any overlap = `conflict`
 * status, nothing touched).
 */
export interface MergeLayerPort {
  resolve(input: MergeConflictInput): Promise<MergeDecision>;
}

/** Both versions of an unresolvable conflict, for quarantine (D17). */
export interface QuarantineEntry {
  repoKey: string;
  path: string;
  uid?: string;
  reason: string;
  baseContent?: string;
  localContent?: string;
  remoteContent?: string;
  /**
   * Losing LOCAL version of a binary remote-wins resolution (Phase C,
   * D18). Synced stores persist these as a `.conflict.<ext>` payload file
   * next to the entry record — openable by the user, byte-exact. NOTE:
   * secret redaction does not apply to bytes (R5 residual, documented).
   */
  localContentBytes?: Uint8Array;
}

/**
 * Quarantine persistence port (D17). The durable SYNCED store is
 * {@link SyncedQuarantineStore} (A3); {@link InMemoryQuarantineStore} remains
 * for tests/compositions without a quarantine repo. Skipping the port loses
 * no data: the conflicting file stays untouched on disk, the remote version
 * stays in git history, and the watermark pin re-derives the conflict on
 * every subsequent sync.
 */
export interface QuarantinePort {
  quarantine(entry: QuarantineEntry): Promise<void>;
  /**
   * Persist MANY entries in one operation. Synced implementations SHOULD
   * batch this into a single commit — a terminal-quarantine flush (D16) can
   * carry dozens of contended files, and one commit per entry would burn
   * 4 API calls each. The engine prefers this method when present.
   */
  quarantineAll?(entries: QuarantineEntry[]): Promise<void>;
  /**
   * Mark an entry resolved (best-effort; MUST be a no-op when the entry
   * does not exist). The engine calls this when a previously pinned path
   * clears — the conflict resolved convergently, so the quarantine record
   * no longer counts as open (CQ4). Terminal-quarantine entries (D16) have
   * no pin and are NOT auto-resolved — reconciling them is the resolver
   * UI's job (Phase B).
   */
  markResolved?(repoKey: string, path: string): Promise<void>;
}

/** In-memory QuarantinePort stub (A2) — durable synced store lands in A3. */
export class InMemoryQuarantineStore implements QuarantinePort {
  readonly entries: QuarantineEntry[] = [];
  async quarantine(entry: QuarantineEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/**
 * A1 sync text allowlist: only UID-bearing markdown assets participate in
 * sync. Binary/non-UTF8 content (attachments) is Phase C scope (D4/VL#3) —
 * reading a binary as a string and pushing it back would silently corrupt
 * it, so non-allowlisted paths are excluded SYMMETRICALLY: from the local
 * snapshot, from the remote diff, from pull-apply, and from delete-inference.
 *
 * A3 gitignore-allowlist defence: paths containing the `.local.` infix
 * (watermark/journal device-local artifacts) or `.conflict.` (quarantine
 * conflict copies) are excluded even when they end in `.md` — they must
 * never be pushed nor pulled. NOTE the substring match also silently
 * excludes legitimately-named user notes like `server.local.setup.md`;
 * symmetric exclusion means no corruption, just non-sync of such paths.
 */
export function isSyncablePath(path: string): boolean {
  return (
    path.endsWith(".md") &&
    !path.includes(".local.") &&
    !path.includes(".conflict.")
  );
}

/**
 * Phase C file-mode allowlist: in an `exo__FileSpace` repo EVERY file is
 * opaque sync content (attachments, binaries, plain notes) — no `.md`
 * restriction. The A3 defence infixes still apply symmetrically: `.local.`
 * (device-local artifacts) and `.conflict.` (quarantine conflict copies)
 * must never enter the sync cycle in either mode.
 *
 * AssetSpace semantics are UNTOUCHED — `spaceKind: "asset"` specs keep
 * {@link isSyncablePath}; this predicate applies ONLY to declared
 * FileSpace repos.
 */
export function isFileSpaceSyncablePath(path: string): boolean {
  return !path.includes(".local.") && !path.includes(".conflict.");
}

/**
 * Per-file size cap for file-mode sync (Phase C). GitHub's blob API tops
 * out around 100 MB with a 4/3 base64 inflation, and mobile transports
 * hold the whole request body in memory — oversized files are excluded
 * SYMMETRICALLY (local snapshot, remote diff, watermark, delete inference)
 * with a warning, exactly like non-allowlisted paths. Override via
 * `SyncEngineDeps.maxFileBytes`.
 */
export const DEFAULT_MAX_FILE_BYTES = 30 * 1024 * 1024;
