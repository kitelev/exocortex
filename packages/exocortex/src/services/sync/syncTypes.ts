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
}

/** Per-device watermark persistence port (D8; production impl is A3 scope). */
export interface WatermarkStorePort {
  get(repoKey: string): Promise<WatermarkRecord | null>;
  set(repoKey: string, record: WatermarkRecord): Promise<void>;
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
  write(path: string, content: string): Promise<void>;
  /** Remove a file. MUST be a no-op if the path does not exist. */
  delete(path: string): Promise<void>;
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
    };

/** Per-repo sync outcome (CQ5). `syncAll` never throws — D12 warn-not-block. */
export interface RepoSyncResult {
  repoKey: string;
  status:
    | "synced"
    | "skipped-not-materialized"
    | "full-conflict"
    | "conflict"
    | "retry-exhausted"
    | "error";
  /** New commit SHA when a push happened. */
  pushedSha?: string;
  /** Remote changes applied to local disk (pull phase). */
  pulledCount: number;
  /** Files pushed to remote. */
  pushedCount: number;
  warnings: string[];
  /**
   * Local deletes/renames detected but NOT pushed in A1 (the write primitive
   * cannot express deletions; propagating them is merge-layer scope, A2/A3).
   * They re-surface on every sync until that layer lands.
   */
  deferredDeletes: string[];
  detail?: string;
}

/**
 * A1 sync text allowlist: only UID-bearing markdown assets participate in
 * sync. Binary/non-UTF8 content (attachments) is Phase C scope (D4/VL#3) —
 * reading a binary as a string and pushing/writing it back would silently
 * corrupt it, so non-allowlisted paths are excluded SYMMETRICALLY: from the
 * local snapshot, from the remote diff, from pull-apply, and from
 * delete-inference.
 */
export function isSyncablePath(path: string): boolean {
  return path.endsWith(".md");
}
