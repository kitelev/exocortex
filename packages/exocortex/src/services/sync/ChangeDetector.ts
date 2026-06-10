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
  /** Allowlist-scoped disk snapshot: repo-relative path → content. */
  localFiles: ReadonlyMap<string, string>;
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
  const { localFiles, watermark, actualBaseTreeSha, sha1 } = params;

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
      uid: extractAssetUid(content),
    });
  }

  const added: AssetChange[] = [];
  const modified: AssetChange[] = [];
  const deleted: AssetChange[] = [];
  const warnings: string[] = [];

  const baseByUid = new Map<string, WatermarkFileEntry>();
  const baseNoUid: WatermarkFileEntry[] = [];
  for (const entry of watermark.files) {
    if (entry.uid !== undefined) baseByUid.set(entry.uid, entry);
    else baseNoUid.push(entry);
  }

  // Pass 1 — uid identity (D18). A uid claims its base entry ONCE: a second
  // disk file with the same uid is a vault anomaly (duplicate uid), not a
  // rename — it falls through to path identity with an explicit warning
  // instead of producing a misleading rename classification.
  const diskLeftover: DiskEntry[] = [];
  const baseMatchedUids = new Set<string>();
  const uidClaimedBy = new Map<string, string>();
  for (const d of disk) {
    const base = d.uid !== undefined ? baseByUid.get(d.uid) : undefined;
    if (d.uid !== undefined && base !== undefined) {
      const claimant = uidClaimedBy.get(d.uid);
      if (claimant !== undefined) {
        warnings.push(
          `duplicate uid ${d.uid} on disk (${claimant}, ${d.path}) — ${d.path} matched by path identity instead`,
        );
        diskLeftover.push(d);
        continue;
      }
      uidClaimedBy.set(d.uid, d.path);
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

  return { kind: "changes", added, modified, deleted, warnings, diskBlobShas };
}
