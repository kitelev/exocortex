/**
 * ExoSync SyncEngine — push-only happy-path orchestrator (RFC 4e4dc453, A1).
 *
 * Per-repo cycle (VL#7): pull → no-conflict check → push, orchestrating the
 * EXISTING write primitive `restCreateCommit` (D3 — no new write path, no
 * modification of the primitive). What A1 deliberately does NOT do:
 *
 *  - NO merge. Any overlap between local and remote changes (same uid or same
 *    path, including delete-vs-modify) returns `conflict` and touches nothing
 *    — the StructuredMerger (A2) and quarantine (A3) own that territory.
 *  - NO pushed deletions/renames. The write primitive's `files` map cannot
 *    express deletions; local deletes and renames are reported as
 *    `deferredDeletes` warnings and re-surface every sync until A2/A3 land.
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

/** Local change-set pinned for the whole D16 retry loop. */
interface PinnedLocalChanges {
  localChanges: AssetChange[];
  localDeletedPaths: Set<string>;
  pushFilesAll: Map<string, string>;
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
        });
      }

      const pulledCount = await this.applyRemoteChanges(
        localFiles,
        disk,
        applyWrites,
        applyDeletes,
        warnings,
      );

      await this.advanceWatermark(
        spec,
        newHead,
        newCommit.treeSha,
        disk,
        applyWrites,
        watermark,
      );

      return result("synced", {
        pushedSha,
        pulledCount,
        pushedCount: pushFiles.size,
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
      const convergedPushPaths = new Set<string>();

      if (examinedHead !== watermark.lastSyncedSha) {
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
        if (verdict.conflict !== undefined) {
          return {
            kind: "conflict",
            detail: `overlapping change on ${verdict.conflict} — merge layer (A2/A3) required; nothing pushed, nothing written`,
          };
        }
        applyWrites = verdict.applyWrites;
        applyDeletes = verdict.applyDeletes;
      }

      pushFiles = new Map(
        [...pushFilesAll].filter(([p]) => !convergedPushPaths.has(p)),
      );
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
    };
  }

  /**
   * Apply remote changes to disk AFTER the push succeeded — a failed push
   * must leave the working tree pristine, or the next run misclassifies
   * remote content as local edits.
   */
  private async applyRemoteChanges(
    localFiles: LocalFilesPort,
    disk: ReadonlyMap<string, string>,
    applyWrites: RemoteChange[],
    applyDeletes: RemoteChange[],
    warnings: string[],
  ): Promise<number> {
    let pulledCount = 0;
    for (const w of applyWrites) {
      if (w.content === undefined) continue; // change entries always carry content
      if (!isSafeRepoRelativePath(w.path)) {
        warnings.push(`unsafe remote path skipped on pull-apply: ${w.path}`);
        continue;
      }
      await localFiles.write(w.path, w.content);
      pulledCount++;
    }
    for (const d of applyDeletes) {
      if (!isSafeRepoRelativePath(d.path)) {
        warnings.push(`unsafe remote path skipped on pull-delete: ${d.path}`);
        continue;
      }
      if (disk.has(d.path)) {
        await localFiles.delete(d.path);
        pulledCount++;
      }
    }
    return pulledCount;
  }

  /** Build and persist the watermark for the new head (D8). */
  private async advanceWatermark(
    spec: SyncRepoSpec,
    newHead: string,
    newTreeSha: string,
    disk: ReadonlyMap<string, string>,
    applyWrites: RemoteChange[],
    previous: WatermarkRecord,
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
    const newRecord: WatermarkRecord = {
      lastSyncedSha: newHead,
      rootTreeSha: newTreeSha,
      files: await this.buildWatermarkFiles(
        spec,
        newTree,
        disk,
        applyWrites,
        previous,
      ),
    };
    await this.deps.watermarkStore.set(spec.repoKey, newRecord);
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
   * No-conflict check (push-only happy path): any shared identity — same uid,
   * or same path — between pinned local changes and remote changes is a
   * conflict, EXCEPT convergent edits (identical blob both sides) and
   * convergent deletes, which are dropped from the push/apply sets.
   */
  private matchLocalVsRemote(
    localChanges: AssetChange[],
    localDeletedPaths: Set<string>,
    disk: ReadonlyMap<string, string>,
    remote: RemoteChange[],
    convergedPushPaths: Set<string>,
  ): {
    conflict?: string;
    applyWrites: RemoteChange[];
    applyDeletes: RemoteChange[];
  } {
    const consumed = new Set<RemoteChange>();
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

      for (const r of candidates) {
        const localIsDelete = localDeletedPaths.has(local.path) && !disk.has(local.path);
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
        return {
          conflict: `${local.uid ?? local.path} (local ${localIsDelete ? "delete" : "change"} vs remote ${r.kind} at ${r.path})`,
          applyWrites: [],
          applyDeletes: [],
        };
      }
    }

    const remaining = remote.filter((r) => !consumed.has(r));
    return {
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
  ): Promise<WatermarkFileEntry[]> {
    const uidByBlobSha = new Map<string, string | undefined>();
    for (const r of applied) {
      if (r.kind === "change" && r.blobSha !== undefined) {
        uidByBlobSha.set(r.blobSha, r.uid);
      }
    }
    for (const content of disk.values()) {
      uidByBlobSha.set(
        await gitBlobSha(content, this.deps.sha1),
        extractAssetUid(content),
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
