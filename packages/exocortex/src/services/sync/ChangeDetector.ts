/**
 * ExoSync ChangeDetector (RFC 4e4dc453 — D8/D18/D22, CQ2).
 *
 * Pure (no I/O) diff of the local working tree against the per-device
 * watermark base. Identity is `exo__Asset_uid` from frontmatter where present
 * (D18) — a renamed asset (same uid, new path) classifies as MODIFIED with a
 * `basePath`, not as delete+add. Files without a uid match by path.
 *
 * D22 base validation: the watermark is never trusted blindly. The caller
 * passes the ACTUAL root tree SHA of the `lastSyncedSha` commit (fetched from
 * the remote); a missing watermark (first sync) or a mismatch (backup-restore,
 * history rewrite, corrupt store — R10) yields `full-conflict`, which the
 * caller must hand to the merge/quarantine layer (A2/A3) — NEVER a silent
 * overwrite.
 */

import type {
  AssetChange,
  ChangeDetectionResult,
  Sha1Fn,
  SyncContent,
  WatermarkFileEntry,
  WatermarkRecord,
} from "./syncTypes";
import { gitBlobSha } from "./gitBlobSha";

/**
 * Extract `exo__Asset_uid` from a markdown asset's YAML frontmatter.
 *
 * Narrow by design: sync identity needs ONE scalar key, so a bounded
 * frontmatter-block regex is used instead of a YAML parser (the uid is a plain
 * scalar by vault convention — UID-canon, CLAUDE.md).
 */
export function extractAssetUid(content: string): string | undefined {
  // Close delimiter anchored to line end — a frontmatter line merely
  // STARTING with `---` (e.g. `----` scalar) must not end the block early.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(content);
  if (!fm) return undefined;
  const m = /^exo__Asset_uid:[ \t]*["']?([^\s"']+)["']?[ \t]*$/m.exec(fm[1]);
  return m ? m[1] : undefined;
}

export interface DetectChangesParams {
  /**
   * Allowlist-scoped disk snapshot: repo-relative path → content. Phase C
   * file-mode passes raw bytes — uid identity never applies to bytes
   * (opaque blobs match by path), text identity is unchanged. With the
   * mtime-manifest optimisation active this holds ONLY the files actually
   * read this sync (new / mtime-or-size-changed); unchanged files arrive via
   * {@link cachedEntries} instead — the two maps are DISJOINT and together
   * cover every present syncable path.
   */
  localFiles: ReadonlyMap<string, SyncContent>;
  /**
   * Precomputed `{ blobSha, uid }` for files the caller already knows are
   * unchanged since the last sync (mtime-manifest cache hit, perf). Folded
   * into the disk snapshot WITHOUT re-reading or re-hashing. Keys MUST be
   * disjoint from {@link localFiles}. Absent/empty ⇒ every file is hashed
   * from `localFiles` (status quo, zero regression).
   */
  cachedEntries?: ReadonlyMap<string, { blobSha: string; uid?: string }>;
  watermark: WatermarkRecord | null;
  /**
   * Actual root tree SHA of the `watermark.lastSyncedSha` commit on the
   * remote, or `null` when it could not be resolved (commit GC'd / history
   * rewritten / 404). Ignored when `watermark` is null.
   */
  actualBaseTreeSha: string | null;
  sha1: Sha1Fn;
}

interface DiskEntry {
  path: string;
  blobSha: string;
  uid?: string;
}

/** Diff disk vs watermark base. See module docstring for identity rules. */
export async function detectChanges(
  params: DetectChangesParams,
): Promise<ChangeDetectionResult> {
  const { localFiles, cachedEntries, watermark, actualBaseTreeSha, sha1 } =
    params;

  if (watermark === null) {
    return { kind: "full-conflict", reason: "first-sync" };
  }
  if (actualBaseTreeSha === null) {
    return {
      kind: "full-conflict",
      reason: "base-mismatch",
      detail: `watermark commit ${watermark.lastSyncedSha} not resolvable on remote`,
    };
  }
  if (actualBaseTreeSha !== watermark.rootTreeSha) {
    return {
      kind: "full-conflict",
      reason: "base-mismatch",
      detail: `stored root tree ${watermark.rootTreeSha} != actual ${actualBaseTreeSha} at ${watermark.lastSyncedSha}`,
    };
  }

  const disk: DiskEntry[] = [];
  const diskBlobShas = new Map<string, string>();
  for (const [path, content] of localFiles) {
    const blobSha = await gitBlobSha(content, sha1);
    diskBlobShas.set(path, blobSha);
    disk.push({
      path,
      blobSha,
      // Bytes are opaque (file-mode, D18): no uid identity — path matches.
      uid: typeof content === "string" ? extractAssetUid(content) : undefined,
    });
  }
  // mtime-manifest cache hits (perf): unchanged files whose blobSha+uid the
  // caller already resolved — no read, no hash. Disjoint from `localFiles`.
  if (cachedEntries !== undefined) {
    for (const [path, entry] of cachedEntries) {
      diskBlobShas.set(path, entry.blobSha);
      disk.push({ path, blobSha: entry.blobSha, uid: entry.uid });
    }
  }

  const added: AssetChange[] = [];
  const modified: AssetChange[] = [];
  const deleted: AssetChange[] = [];
  const warnings: string[] = [];

  // #3477: uid identity is only sound while a uid is UNIQUE on each side.
  // A uid on ≥2 disk paths or ≥2 base paths (template-copy artifact) makes
  // the WHOLE group fall back to path identity: no rename inference, and —
  // critically — no uid-keyed base collapse (a Map keyed by such a uid kept
  // only the LAST duplicate and lost the others, so their files classified
  // as adds forever and their deletions never derived).
  const diskUidPaths = new Map<string, string[]>();
  for (const d of disk) {
    if (d.uid === undefined) continue;
    const list = diskUidPaths.get(d.uid) ?? [];
    list.push(d.path);
    diskUidPaths.set(d.uid, list);
  }
  const baseUidPaths = new Map<string, string[]>();
  for (const entry of watermark.files) {
    if (entry.uid === undefined) continue;
    const list = baseUidPaths.get(entry.uid) ?? [];
    list.push(entry.path);
    baseUidPaths.set(entry.uid, list);
  }
  const duplicateUids = new Set<string>();
  for (const [uid, paths] of diskUidPaths) {
    if (paths.length > 1) duplicateUids.add(uid);
  }
  for (const [uid, paths] of baseUidPaths) {
    if (paths.length > 1) duplicateUids.add(uid);
  }
  // The warning fires on EVERY detection run while the anomaly persists —
  // same cadence as the pre-#3477 claim-collision warning (the vault owner
  // is expected to deduplicate the uids; diagnostics must not go quiet).
  for (const uid of [...duplicateUids].sort()) {
    const diskPaths = diskUidPaths.get(uid) ?? [];
    const where =
      diskPaths.length > 1
        ? `on disk (${diskPaths.join(", ")})`
        : `in the sync base (${(baseUidPaths.get(uid) ?? []).join(", ")})`;
    warnings.push(
      `duplicate uid ${uid} ${where} — uid identity suppressed for the group; every path matched by path identity (#3477)`,
    );
  }

  const baseByUid = new Map<string, WatermarkFileEntry>();
  const baseNoUid: WatermarkFileEntry[] = [];
  for (const entry of watermark.files) {
    if (entry.uid !== undefined && !duplicateUids.has(entry.uid)) {
      baseByUid.set(entry.uid, entry);
    } else {
      baseNoUid.push(entry);
    }
  }

  // Pass 1 — uid identity (D18), unique uids only (#3477). A second disk
  // file with the same uid cannot reach this pass — the dup pre-scan above
  // routed the whole group to path identity.
  const diskLeftover: DiskEntry[] = [];
  const baseMatchedUids = new Set<string>();
  for (const d of disk) {
    const base =
      d.uid !== undefined && !duplicateUids.has(d.uid)
        ? baseByUid.get(d.uid)
        : undefined;
    if (d.uid !== undefined && base !== undefined) {
      baseMatchedUids.add(d.uid);
      if (base.blobSha !== d.blobSha || base.path !== d.path) {
        modified.push({
          path: d.path,
          uid: d.uid,
          blobSha: d.blobSha,
          ...(base.path !== d.path ? { basePath: base.path } : {}),
        });
      }
    } else {
      diskLeftover.push(d);
    }
  }

  // Pass 2 — path identity for leftovers (uid-less files; in-place uid edits).
  const baseLeftover = new Map<string, WatermarkFileEntry>();
  for (const entry of baseNoUid) baseLeftover.set(entry.path, entry);
  for (const [uid, entry] of baseByUid) {
    if (!baseMatchedUids.has(uid)) baseLeftover.set(entry.path, entry);
  }
  for (const d of diskLeftover) {
    const base = baseLeftover.get(d.path);
    if (base !== undefined) {
      baseLeftover.delete(d.path);
      if (base.blobSha !== d.blobSha) {
        modified.push({ path: d.path, uid: d.uid, blobSha: d.blobSha });
      }
    } else {
      added.push({ path: d.path, uid: d.uid, blobSha: d.blobSha });
    }
  }

  // Remaining base entries have no uid match and no path match → deleted.
  for (const base of baseLeftover.values()) {
    deleted.push({ path: base.path, uid: base.uid, blobSha: base.blobSha });
  }

  return {
    kind: "changes",
    added,
    modified,
    deleted,
    warnings,
    diskBlobShas,
    duplicateUids,
  };
}
