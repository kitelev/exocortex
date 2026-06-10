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
 * What this engine still does NOT do:
 *
 *  - NO pushed deletions/renames. The write primitive's `files` map cannot
 *    express deletions; local deletes and renames are reported as
 *    `deferredDeletes` warnings and re-surface every sync until A3 lands.
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
 */

import {
  restCreateCommit,
  type RestCommitTransport,
} from "../../infrastructure/github/restCommit";
import {
  getBlobText,
  getCommitInfo,
  getHeadSha,
  getTree,
  type RemoteTreeEntry,
} from "./githubRepoReader";
import { detectChanges, extractAssetUid } from "./ChangeDetector";
import { gitBlobSha } from "./gitBlobSha";
import {
  isSyncablePath,
  type AssetChange,
  type ChangeDetectionResult,
  type LocalFilesPort,
  type MaterializationCheckPort,
  type MergeLayerPort,
  type QuarantineEntry,
  type QuarantinePort,
  type RepoSyncResult,
  type Sha1Fn,
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
  sha1: Sha1Fn;
  baseURL?: string;
  /** Cap on 422 re-pull→retry cycles (D16). Default {@link DEFAULT_MAX_PUSH_RETRIES}. */
  maxPushRetries?: number;
  commitMessage?: (spec: SyncRepoSpec, fileCount: number) => string;
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
   * Quarantine sink for unresolvable / SHACL-invalid merges (D17). Optional —
   * skipping it loses no data: the file stays untouched on disk and the
   * watermark pin re-derives the conflict every sync (durable synced store is
   * A3 scope).
   */
  quarantine?: QuarantinePort;
}

/** Reject absolute, backslash, empty-segment, `.`/`..` paths (zip-slip guard). */
function isSafeRepoRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return path
    .split("/")
    .every((s) => s.length > 0 && s !== "." && s !== "..");
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
    /ref update mismatch/.test(msg)
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
  content?: string;
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
  pushFilesAll: Map<string, string>;
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
  quarantineEntries: QuarantineEntry[];
  mergedCount: number;
  warnings: string[];
}

/** Outcome of the pull→check→push retry loop. */
type PushLoopOutcome =
  | { kind: "conflict"; detail: string }
  | { kind: "retry-exhausted"; detail: string }
  | {
      kind: "done";
      examinedHead: string;
      pushedSha: string | undefined;
      applyWrites: RemoteChange[];
      applyDeletes: RemoteChange[];
      pushFiles: Map<string, string>;
      merge: MergeResolution;
    };

const EMPTY_MERGE: MergeResolution = {
  mergedFiles: new Map(),
  mergedWrites: [],
  quarantineEntries: [],
  mergedCount: 0,
  warnings: [],
};

export class SyncEngine {
  private readonly deps: SyncEngineDeps;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
  }

  /**
   * Sync every repo of the materialized set, best-effort (D12): a per-repo
   * failure becomes that repo's `error` result, never an exception. Specs are
   * processed in the given order — pass children before parents (use
   * {@link orderChildrenFirst}).
   */
  async syncAll(specs: SyncRepoSpec[]): Promise<RepoSyncResult[]> {
    const results: RepoSyncResult[] = [];
    for (const spec of specs) {
      results.push(await this.sync(spec));
    }
    return results;
  }

  /** Sync one repo. Never throws — failures map to a result status (CQ5). */
  async sync(spec: SyncRepoSpec): Promise<RepoSyncResult> {
    const warnings: string[] = [];
    const deferredDeletes: string[] = [];
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

      const localFiles = this.deps.localFilesFor(spec);
      const disk = new Map<string, string>();
      for (const path of (await localFiles.list()).filter(isSyncablePath)) {
        disk.set(path, await localFiles.read(path));
      }

      const watermark = await this.deps.watermarkStore.get(spec.repoKey);
      if (watermark === null) {
        return await this.bootstrapWatermark(spec, disk, warnings, result);
      }

      const detection = await detectChanges({
        localFiles: disk,
        watermark,
        actualBaseTreeSha: await this.resolveBaseTreeSha(spec, watermark),
        sha1: this.deps.sha1,
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
      );

      const loop = await this.runPushLoop(
        spec,
        watermark,
        pinned,
        disk,
        warnings,
      );
      if (loop.kind === "conflict") {
        return result("conflict", { detail: loop.detail });
      }
      if (loop.kind === "retry-exhausted") {
        return result("retry-exhausted", { detail: loop.detail });
      }
      const { examinedHead, pushedSha, applyWrites, applyDeletes, pushFiles } =
        loop;
      const merge = loop.merge;
      warnings.push(...merge.warnings);

      // Quarantine sink fires ONCE, after the retry loop settled (D17). The
      // entries' paths are pinned below so the conflict re-derives next sync.
      for (const entry of merge.quarantineEntries) {
        await this.deps.quarantine?.quarantine(entry);
        warnings.push(
          `quarantined ${entry.path}: ${entry.reason} — both versions preserved; conflict re-derives until resolved (D17)`,
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
        (watermark.pinnedPaths?.length ?? 0) === 0
      ) {
        return result("synced");
      }

      const newHead = pushedSha ?? examinedHead;
      const newCommit = await getCommitInfo(
        this.deps.transport,
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
          warnings,
        );
        // Do NOT absorb the concurrent commit into the watermark: its changes
        // were never examined nor written to disk, and a watermark built from
        // the new head tree would make the stale local copies look like local
        // edits on the NEXT sync — a silent revert of the concurrent change.
        // Keeping the old watermark is safe: the next sync re-pulls the
        // concurrent change and drops our own pushed files as convergent
        // edits.
        warnings.push(
          `race-window: watermark NOT advanced (pushed commit's parent ${newCommit.parents[0]} != examined head ${examinedHead}) — next sync reconciles the concurrent change`,
        );
        return result("synced", {
          pushedSha,
          pushedCount: pushFiles.size,
          mergedCount: merge.mergedCount,
          quarantinedCount: merge.quarantineEntries.length,
        });
      }

      // Merged contents that differ from the local copy land on disk through
      // the same TOCTOU-guarded apply as remote pulls.
      const { pulledCount, pinnedPaths } = await this.applyRemoteChanges(
        localFiles,
        disk,
        [...applyWrites, ...merge.mergedWrites],
        applyDeletes,
        warnings,
      );

      // Quarantined paths keep their OLD watermark entry (same mechanism as
      // TOCTOU pins): the conflict re-derives every sync until resolved.
      for (const entry of merge.quarantineEntries) {
        pinnedPaths.add(entry.path);
      }

      await this.advanceWatermark(
        spec,
        newHead,
        newCommit.treeSha,
        disk,
        applyWrites,
        watermark,
        pinnedPaths,
        detection.diskBlobShas,
      );

      return result("synced", {
        pushedSha,
        pulledCount,
        pushedCount: pushFiles.size,
        mergedCount: merge.mergedCount,
        quarantinedCount: merge.quarantineEntries.length,
      });
    } catch (err) {
      const redact = this.deps.redact ?? ((m: string): string => m);
      warnings.push(`sync failed: ${redact(errMsg(err))}`);
      return result("error", { detail: redact(errMsg(err)) });
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
          this.deps.transport,
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
   * would misclassify just-applied remote files as local edits). Renames and
   * deletes are deferred — the write primitive cannot express deletions.
   */
  private pinLocalChanges(
    detection: Extract<ChangeDetectionResult, { kind: "changes" }>,
    disk: ReadonlyMap<string, string>,
    warnings: string[],
    deferredDeletes: string[],
  ): PinnedLocalChanges {
    const renames = detection.modified.filter((c) => c.basePath !== undefined);
    const pushable = [
      ...detection.added,
      ...detection.modified.filter((c) => c.basePath === undefined),
    ];
    for (const r of renames) {
      // Pushing the new path while the primitive cannot delete the old one
      // would leave two files with the same uid on the remote — defer the
      // whole rename pair to the merge layer.
      if (r.basePath !== undefined) deferredDeletes.push(r.basePath);
      warnings.push(
        `deferred rename (uid ${r.uid ?? "?"}): ${r.basePath} → ${r.path} not pushed (write primitive cannot delete; merge layer A2/A3)`,
      );
    }
    for (const d of detection.deleted) {
      // Known cosmetic: a CONVERGENT delete (remote deleted it too) is
      // consumed later in matchLocalVsRemote but still reported here as
      // deferred for this cycle; the watermark drops it, so it self-heals
      // on the next sync.
      deferredDeletes.push(d.path);
      warnings.push(
        `deferred delete: ${d.path} not pushed (write primitive cannot delete; merge layer A2/A3)`,
      );
    }
    const localChanges: AssetChange[] = [
      ...pushable,
      ...renames,
      ...detection.deleted.map((d) => ({ ...d })),
    ];
    const localDeletedPaths = new Set(detection.deleted.map((d) => d.path));
    const pushFilesAll = new Map<string, string>();
    for (const c of pushable) {
      const content = disk.get(c.path);
      if (content !== undefined) pushFilesAll.set(c.path, content);
    }
    return { localChanges, localDeletedPaths, pushFilesAll };
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
    disk: ReadonlyMap<string, string>,
    warnings: string[],
  ): Promise<PushLoopOutcome> {
    const { localChanges, localDeletedPaths, pushFilesAll } = pinned;
    const maxRetries = this.deps.maxPushRetries ?? DEFAULT_MAX_PUSH_RETRIES;
    let attempt = 0;
    let examinedHead = "";
    let pushedSha: string | undefined;
    let applyWrites: RemoteChange[] = [];
    let applyDeletes: RemoteChange[] = [];
    let pushFiles = new Map<string, string>();
    let merge: MergeResolution = EMPTY_MERGE;

    for (;;) {
      examinedHead = await getHeadSha(
        this.deps.transport,
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
      const convergedPushPaths = new Set<string>();

      // Pinned paths diverge from the lastSyncedSha tree by construction —
      // their never-applied remote change must re-derive even when the head
      // SHA has not moved since the pinning sync.
      const hasPins = (watermark.pinnedPaths?.length ?? 0) > 0;
      if (examinedHead !== watermark.lastSyncedSha || hasPins) {
        const remote = await this.collectRemoteChanges(
          spec,
          watermark,
          examinedHead,
        );
        const verdict = this.matchLocalVsRemote(
          localChanges,
          localDeletedPaths,
          disk,
          remote,
          convergedPushPaths,
        );
        if (verdict.conflicts.length > 0) {
          if (this.deps.mergeLayer === undefined) {
            return {
              kind: "conflict",
              detail: `overlapping change on ${verdict.conflicts[0].desc} — merge layer (A2/A3) required; nothing pushed, nothing written`,
            };
          }
          merge = await this.resolveMergeConflicts(
            spec,
            watermark,
            verdict.conflicts,
            disk,
          );
        }
        applyWrites = verdict.applyWrites;
        applyDeletes = verdict.applyDeletes;
      }

      pushFiles = new Map([
        ...[...pushFilesAll].filter(([p]) => !convergedPushPaths.has(p)),
        ...merge.mergedFiles,
      ]);
      if (pushFiles.size === 0) break;

      try {
        pushedSha = await restCreateCommit(this.deps.transport, {
          owner: spec.owner,
          repo: spec.repo,
          branch: spec.branch,
          files: pushFiles,
          message:
            this.deps.commitMessage?.(spec, pushFiles.size) ??
            `chore(exosync): sync ${pushFiles.size} file(s)`,
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
            detail: `non-fast-forward push failed after ${maxRetries} retries (D16 cap) — quarantine convergence is A3 scope`,
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
      merge,
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
    disk: ReadonlyMap<string, string>,
  ): Promise<MergeResolution> {
    const mergeLayer = this.deps.mergeLayer;
    if (mergeLayer === undefined) return EMPTY_MERGE;
    const baseByPath = new Map(watermark.files.map((f) => [f.path, f]));
    const mergedFiles = new Map<string, string>();
    const mergedWrites: RemoteChange[] = [];
    const quarantineEntries: QuarantineEntry[] = [];
    const warnings: string[] = [];
    let mergedCount = 0;

    const entry = (
      group: ConflictGroup,
      reason: string,
      base?: string,
    ): QuarantineEntry => ({
      repoKey: spec.repoKey,
      path: group.local.path,
      ...(group.local.uid !== undefined ? { uid: group.local.uid } : {}),
      reason,
      ...(base !== undefined ? { baseContent: base } : {}),
      ...(disk.has(group.local.path)
        ? { localContent: disk.get(group.local.path) }
        : {}),
      ...(group.remotes[0]?.content !== undefined
        ? { remoteContent: group.remotes[0].content }
        : {}),
    });

    for (const group of conflicts) {
      const baseEntry =
        baseByPath.get(group.local.basePath ?? group.local.path) ??
        baseByPath.get(group.remotes[0]?.path ?? "");
      let base: string | undefined;
      if (baseEntry !== undefined) {
        base = await getBlobText(
          this.deps.transport,
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

      const decision = await mergeLayer.resolve({
        path: group.local.path,
        ...(group.local.uid !== undefined ? { uid: group.local.uid } : {}),
        ...(base !== undefined ? { base } : {}),
        ...(disk.has(group.local.path)
          ? { local: disk.get(group.local.path) }
          : {}),
        ...(remote.kind === "change" && remote.content !== undefined
          ? { remote: remote.content }
          : {}),
      });

      if (decision.action === "quarantine") {
        quarantineEntries.push(entry(group, decision.reason, base));
        continue;
      }

      mergedCount++;
      for (const w of decision.warnings ?? []) {
        warnings.push(`merge(${group.local.path}): ${w}`);
      }
      const remoteContent =
        remote.kind === "change" ? remote.content : undefined;
      if (decision.content !== remoteContent) {
        mergedFiles.set(group.local.path, decision.content);
      }
      if (decision.content !== disk.get(group.local.path)) {
        mergedWrites.push({
          path: group.local.path,
          kind: "change",
          content: decision.content,
          ...(group.local.uid !== undefined ? { uid: group.local.uid } : {}),
        });
      }
    }

    return { mergedFiles, mergedWrites, quarantineEntries, mergedCount, warnings };
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
    disk: ReadonlyMap<string, string>,
    applyWrites: RemoteChange[],
    applyDeletes: RemoteChange[],
    warnings: string[],
  ): Promise<{ pulledCount: number; pinnedPaths: Set<string> }> {
    let pulledCount = 0;
    const pinnedPaths = new Set<string>();
    const tryRead = async (path: string): Promise<string | undefined> => {
      try {
        return await localFiles.read(path);
      } catch {
        return undefined;
      }
    };
    for (const w of applyWrites) {
      if (w.content === undefined) continue; // change entries always carry content
      if (!isSafeRepoRelativePath(w.path)) {
        warnings.push(`unsafe remote path skipped on pull-apply: ${w.path}`);
        pinnedPaths.add(w.path);
        continue;
      }
      const current = await tryRead(w.path);
      if (current !== disk.get(w.path)) {
        warnings.push(
          `pull-apply skipped: ${w.path} changed on disk mid-sync (TOCTOU) — remote change re-derives next sync`,
        );
        pinnedPaths.add(w.path);
        continue;
      }
      await localFiles.write(w.path, w.content);
      pulledCount++;
    }
    for (const d of applyDeletes) {
      if (!isSafeRepoRelativePath(d.path)) {
        warnings.push(`unsafe remote path skipped on pull-delete: ${d.path}`);
        pinnedPaths.add(d.path);
        continue;
      }
      if (disk.has(d.path)) {
        const current = await tryRead(d.path);
        if (current !== undefined && current !== disk.get(d.path)) {
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
    disk: ReadonlyMap<string, string>,
    applyWrites: RemoteChange[],
    previous: WatermarkRecord,
    pinnedPaths: ReadonlySet<string>,
    diskBlobShas: ReadonlyMap<string, string>,
  ): Promise<void> {
    const newTree = (
      await getTree(
        this.deps.transport,
        spec.owner,
        spec.repo,
        newTreeSha,
        this.deps.baseURL,
      )
    ).filter((e) => isSyncablePath(e.path));
    const files = applyWatermarkPins(
      await this.buildWatermarkFiles(
        spec,
        newTree,
        disk,
        applyWrites,
        previous,
        diskBlobShas,
      ),
      previous,
      pinnedPaths,
    );
    await this.deps.watermarkStore.set(spec.repoKey, {
      lastSyncedSha: newHead,
      rootTreeSha: newTreeSha,
      files,
      ...(pinnedPaths.size > 0 ? { pinnedPaths: [...pinnedPaths] } : {}),
    });
  }

  /**
   * First-sync bootstrap (safe subset): when no watermark exists but the
   * local working tree EXACTLY equals the remote head tree (fresh mount), the
   * watermark is seeded and the sync is a no-op. Any difference is a genuine
   * first-sync divergence → full-conflict (A2/A3, D22).
   */
  private async bootstrapWatermark(
    spec: SyncRepoSpec,
    disk: ReadonlyMap<string, string>,
    warnings: string[],
    result: (
      status: RepoSyncResult["status"],
      extra?: Partial<RepoSyncResult>,
    ) => RepoSyncResult,
  ): Promise<RepoSyncResult> {
    const head = await getHeadSha(
      this.deps.transport,
      spec.owner,
      spec.repo,
      spec.branch,
      this.deps.baseURL,
    );
    const headCommit = await getCommitInfo(
      this.deps.transport,
      spec.owner,
      spec.repo,
      head,
      this.deps.baseURL,
    );
    const headTree = (
      await getTree(
        this.deps.transport,
        spec.owner,
        spec.repo,
        headCommit.treeSha,
        this.deps.baseURL,
      )
    ).filter((e) => isSyncablePath(e.path));

    if (headTree.length !== disk.size) {
      return result("full-conflict", {
        detail: `first-sync: no watermark and local tree (${disk.size} files) differs from remote head (${headTree.length} files) — A2/A3 scope`,
      });
    }
    for (const entry of headTree) {
      const content = disk.get(entry.path);
      if (
        content === undefined ||
        (await gitBlobSha(content, this.deps.sha1)) !== entry.blobSha
      ) {
        return result("full-conflict", {
          detail: `first-sync: no watermark and local content diverges from remote head at ${entry.path} — A2/A3 scope`,
        });
      }
    }

    const files: WatermarkFileEntry[] = headTree.map((e) => {
      const content = disk.get(e.path);
      const uid = content !== undefined ? extractAssetUid(content) : undefined;
      return { path: e.path, blobSha: e.blobSha, ...(uid ? { uid } : {}) };
    });
    await this.deps.watermarkStore.set(spec.repoKey, {
      lastSyncedSha: head,
      rootTreeSha: headCommit.treeSha,
      files,
    });
    warnings.push(
      `watermark bootstrapped from head ${head} (local tree identical to remote)`,
    );
    return result("synced");
  }

  /** Fetch base..head remote changes with contents + uids. */
  private async collectRemoteChanges(
    spec: SyncRepoSpec,
    watermark: WatermarkRecord,
    head: string,
  ): Promise<RemoteChange[]> {
    const headCommit = await getCommitInfo(
      this.deps.transport,
      spec.owner,
      spec.repo,
      head,
      this.deps.baseURL,
    );
    const headTree = (
      await getTree(
        this.deps.transport,
        spec.owner,
        spec.repo,
        headCommit.treeSha,
        this.deps.baseURL,
      )
    ).filter((e) => isSyncablePath(e.path));
    const { changed, deleted } = diffTrees(watermark.files, headTree);

    const changes: RemoteChange[] = [];
    for (const c of changed) {
      const content = await getBlobText(
        this.deps.transport,
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
    return changes;
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
    disk: ReadonlyMap<string, string>,
    remote: RemoteChange[],
    convergedPushPaths: Set<string>,
  ): {
    conflicts: ConflictGroup[];
    applyWrites: RemoteChange[];
    applyDeletes: RemoteChange[];
  } {
    const consumed = new Set<RemoteChange>();
    const conflicts: ConflictGroup[] = [];
    const remoteByUid = new Map<string, RemoteChange[]>();
    const remoteByPath = new Map<string, RemoteChange>();
    for (const r of remote) {
      if (r.uid !== undefined) {
        const list = remoteByUid.get(r.uid) ?? [];
        list.push(r);
        remoteByUid.set(r.uid, list);
      }
      remoteByPath.set(r.path, r);
    }

    for (const local of localChanges) {
      const candidates = new Set<RemoteChange>();
      if (local.uid !== undefined) {
        for (const r of remoteByUid.get(local.uid) ?? []) candidates.add(r);
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
        conflicting.push(r);
        consumed.add(r); // conflicting remote is owned by the merge layer
      }
      if (conflicting.length > 0) {
        conflicts.push({
          local,
          localIsDelete,
          remotes: conflicting,
          desc: `${local.uid ?? local.path} (local ${localIsDelete ? "delete" : "change"} vs remote ${conflicting[0].kind} at ${conflicting[0].path})`,
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
    pushFiles: Map<string, string>,
    warnings: string[],
  ): Promise<void> {
    try {
      const parentCommit = await getCommitInfo(
        this.deps.transport,
        spec.owner,
        spec.repo,
        actualParent,
        this.deps.baseURL,
      );
      const parentTree = (
        await getTree(
          this.deps.transport,
          spec.owner,
          spec.repo,
          parentCommit.treeSha,
          this.deps.baseURL,
        )
      ).filter((e) => isSyncablePath(e.path));
      const examinedFiles: WatermarkFileEntry[] =
        examinedHead === watermark.lastSyncedSha
          ? watermark.files
          : (
              await getTree(
                this.deps.transport,
                spec.owner,
                spec.repo,
                (
                  await getCommitInfo(
                    this.deps.transport,
                    spec.owner,
                    spec.repo,
                    examinedHead,
                    this.deps.baseURL,
                  )
                ).treeSha,
                this.deps.baseURL,
              )
            ).filter((e) => isSyncablePath(e.path));
      const { changed, deleted } = diffTrees(examinedFiles, parentTree);
      for (const c of changed) {
        if (pushFiles.has(c.path)) {
          warnings.push(
            `race-window: concurrent commit ${actualParent} changed ${c.path} between conflict check (head ${examinedHead}) and push — local version won; previous version recoverable from git history`,
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
    disk: ReadonlyMap<string, string>,
    applied: RemoteChange[],
    previous: WatermarkRecord,
    diskBlobShas?: ReadonlyMap<string, string>,
  ): Promise<WatermarkFileEntry[]> {
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
        diskBlobShas?.get(path) ?? (await gitBlobSha(content, this.deps.sha1));
      uidByBlobSha.set(sha, extractAssetUid(content));
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
          this.deps.transport,
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
