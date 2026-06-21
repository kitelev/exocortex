/**
 * ExoSync quarantine resolver (RFC 4e4dc453, finding a0a3d1d6 — the "resolver
 * UI reconciles (CQ4)" component announced by `SyncEngine` but never built).
 *
 * The conflict machinery is zero-loss but had NO user-facing way to RESOLVE a
 * quarantined conflict: `markResolved` only fired automatically when a conflict
 * converged on a later sync, and the painful manual path was a 2-pass dance
 * (snap-to-remote → Sync → re-edit → Sync) because a CONFLICTING local version
 * is withheld from push while the path stays pinned (D17).
 *
 * This service short-circuits that. It is platform-free (same hexagonal shape
 * as {@link SyncEngine}): the plugin and CLI each compose it from their own
 * primitives.
 *
 * Design (verified against the engine's convergence + watermark semantics,
 * device-local-first per the design interview 2026-06-20):
 *
 *  - **Source of conflicts = the device-local watermark `pinnedPaths`** (D8),
 *    NOT a separate quarantine repo. A quarantined asset-mode conflict is
 *    always pinned (SyncEngine adds `quarantineEntries[].path` to the pins),
 *    so the resolver needs no extra repo to find conflicts. A configured
 *    quarantine repo is OPTIONAL — used only to drop its cross-device count
 *    via `markResolved` and to cover the cases pins do not (file-mode losing
 *    local, terminal push-fail) which are out of this resolver's scope.
 *
 *  - **3-way reconstruction with NO quarantine repo:** local = disk
 *    ({@link LocalFilesPort}), remote = the AssetSpace head-tree blob, base =
 *    the AssetSpace blob recorded in the watermark (best-effort — may be GC'd).
 *    Classification uses blob SHAs only (one tree fetch + disk hashing), so a
 *    benign pin (one-sided change that will converge on its own) is filtered
 *    OUT — only a genuine 3-way divergence (base≠local≠remote≠base) is listed.
 *
 *  - **Resolution is one action that converges both sides** (interview Q4):
 *    write the chosen content to disk AND commit it to the AssetSpace remote
 *    through the existing `restCreateCommit` (D3 — no new write path), then
 *    snap the watermark entry to the chosen blob and unpin the path. Committing
 *    to the remote is the step that bypasses the "conflicting local is never
 *    pushed" constraint (the 2-pass root cause). A subsequent Sync sees
 *    base==local==remote for the path and finalises cleanly — no re-conflict.
 *
 *  - **Zero-data-loss (⛤ M1):** keep-local preserves the discarded REMOTE
 *    version in the AssetSpace git history (the conflicting commit is never
 *    rewritten). keep-remote / merged discard the LOCAL version — so BEFORE
 *    overwriting it the resolver ALWAYS writes it to a sibling
 *    `.conflict.local.txt` backup (the `.conflict.` infix is refused by BOTH
 *    sync predicates, the `.txt` keeps it out of the triple store — never
 *    re-synced, user-openable). The backup is unconditional: a configured
 *    quarantine repo holds only the version captured AT quarantine time, which
 *    can be stale after a re-edit, so it is no substitute for the exact disk
 *    bytes being overwritten. The user has already SEEN both versions before
 *    confirming, and the discarded one stays recoverable afterwards.
 *
 *  - **Asset-mode only:** `file`-mode FileSpace conflicts (opaque binary
 *    attachments, remote-wins per D18) are NOT user-resolvable through this
 *    text-based 3-way resolver — reading a binary blob as UTF-8 would corrupt
 *    it — so they are filtered out of {@link QuarantineResolver.listOpenConflicts}.
 */

import {
  restCreateCommit,
  type RestCommitTransport,
} from "../../infrastructure/github/restCommit";
import { getBlobText, getCommitInfo, getHeadSha, getTree } from "./githubRepoReader";
import { gitBlobSha } from "./gitBlobSha";
import { extractAssetUid } from "./ChangeDetector";
import type {
  ConflictCacheReadPort,
  ConflictCacheRecord,
} from "./LocalConflictCacheStore";
import {
  OUTBOX_REMOTE_ABSENT,
  type OutboxStorePort,
} from "./LocalOutboxStore";
import type {
  LocalFilesPort,
  QuarantinePort,
  Sha1Fn,
  SyncRepoSpec,
  WatermarkStorePort,
} from "./syncTypes";

/** One conflict the user can resolve (summary — no content). */
export interface ResolvableConflict {
  repoKey: string;
  /** Repo-relative forward-slash path. */
  path: string;
  /** `exo__Asset_uid` parsed from whichever version carries it, if any. */
  uid?: string;
  /** A local (on-disk) version exists (false ⇒ deleted locally). */
  hasLocal: boolean;
  /** A remote (head-tree) version exists (false ⇒ deleted remotely). */
  hasRemote: boolean;
}

/** A conflict with its three versions materialised (for the diff view). */
export interface ConflictDetail extends ResolvableConflict {
  /** 3-way base; `undefined` ⇒ absent at base OR the blob was GC'd. */
  base?: string;
  /** Local content; `undefined` ⇒ deleted locally. */
  local?: string;
  /** Remote content; `undefined` ⇒ deleted remotely. */
  remote?: string;
}

/** The user's resolution choice for one conflict. */
export type ResolveChoice =
  | { take: "local" }
  | { take: "remote" }
  | { take: "merged"; content: string };

/** Outcome of one {@link QuarantineResolver.resolve}. */
export interface ResolveResult {
  repoKey: string;
  path: string;
  /**
   * The chosen content actually applied (disk + remote). `undefined` only for
   * a keep-remote resolution of a remotely-DELETED path (the resolution is a
   * local delete, no content).
   */
  resolvedTo: "local" | "remote" | "merged";
  /** New AssetSpace commit SHA when the chosen content was pushed. */
  pushedSha?: string;
  /**
   * True when the resolution was applied to disk but its convergent commit was
   * DEFERRED to the next Sync (offline-first, the IntelliJ model) — queued in
   * the deferred-push outbox. The command layer surfaces "resolved, awaiting
   * push". False/absent ⇒ nothing to push (take-remote already matched).
   */
  awaitingPush?: boolean;
  /**
   * Where the discarded LOCAL version was backed up before being overwritten
   * (keep-remote / merged in device-local mode). Absent when nothing was
   * discarded (keep-local) or there was no local version to lose.
   */
  discardedLocalBackupPath?: string;
}

export interface QuarantineResolverDeps {
  /** Read-side + write-side transport for the AssetSpace repos. */
  transport: RestCommitTransport;
  /** Device-local watermark store (the conflict source + the unpin sink). */
  watermarkStore: WatermarkStorePort;
  /** Local working-tree access for one repo (disk read/write). */
  localFilesFor: (spec: SyncRepoSpec) => LocalFilesPort;
  /** Git blob-sha addressing (content parity with the remote tree). */
  sha1: Sha1Fn;
  /** GitHub API base; defaults to `https://api.github.com`. */
  baseURL?: string;
  /** Defence-in-depth redactor for this service's own error strings. */
  redact?: (message: string) => string;
  /**
   * Commit message for a resolution push. Defaults to a conventional
   * `chore(exosync): resolve conflict …` line.
   */
  commitMessage?: (spec: SyncRepoSpec, path: string) => string;
  /**
   * OPTIONAL quarantine sink. When present, a resolution also calls
   * `markResolved` to drop a cross-device unresolved-count. No production caller
   * wires this any more (the synced quarantine store was retired); kept for the
   * port contract + tests. Absent ⇒ pure device-local mode (the pin clears on
   * the next sync anyway).
   */
  quarantine?: QuarantinePort;
  /**
   * OPTIONAL device-local conflict cache (PR-2). When present, the resolver
   * sources a conflict's REMOTE and BASE versions from the cache (captured at
   * quarantine time) instead of fetching the AssetSpace head over the network —
   * so listing and diffing a conflict works fully OFFLINE. The on-disk LOCAL
   * version is always re-read fresh. The network is used only as a fallback for
   * a pinned path with no cache entry (a conflict quarantined before PR-2), and
   * when that fetch fails (offline) such uncached pins are simply omitted from
   * the list rather than aborting it. Absent ⇒ legacy network-only behaviour.
   */
  conflictCache?: ConflictCacheReadPort;
  /**
   * OPTIONAL deferred-push outbox (PR-3b). When present, {@link resolve} writes
   * the chosen version to disk but DEFERS the convergent remote commit to the
   * next Sync (offline-first — no network in resolve). The path stays pinned
   * (the engine flush pushes it, or re-conflicts on a TOCTOU remote-move), and
   * {@link listOpenConflicts} hides paths with a pending outbox entry ("resolved,
   * awaiting push"). Absent ⇒ resolve commits synchronously (legacy/online).
   */
  outbox?: OutboxStorePort;
}

/** Sentinel for "this version is absent" in SHA comparisons (a delete). */
const ABSENT = " absent";

export class QuarantineResolver {
  private readonly deps: QuarantineResolverDeps;

  constructor(deps: QuarantineResolverDeps) {
    this.deps = deps;
  }

  /**
   * Genuine 3-way conflicts across the given materialized repos, sourced from
   * the device-local watermark pins (no quarantine repo required). A pinned
   * path is included ONLY when all three versions differ from each other
   * (base≠local≠remote≠base) — a one-sided change (which converges on the next
   * sync) is filtered out so the list is exactly "needs a human choice".
   */
  async listOpenConflicts(
    specs: readonly SyncRepoSpec[],
  ): Promise<ResolvableConflict[]> {
    const out: ResolvableConflict[] = [];
    for (const spec of specs) {
      out.push(...(await this.listRepoConflicts(spec)));
    }
    return out;
  }

  private async listRepoConflicts(
    spec: SyncRepoSpec,
  ): Promise<ResolvableConflict[]> {
    // Asset-mode only: a file-mode FileSpace conflict is opaque binary resolved
    // remote-wins (D18) — the losing local lives in the device-local conflict
    // cache (its binary payload), not here, and a UTF-8 3-way would corrupt it.
    // Skip the whole spec.
    if (spec.spaceKind === "file") return [];
    const watermark = await this.deps.watermarkStore.get(spec.repoKey);
    let pinned = watermark?.pinnedPaths ?? [];
    if (pinned.length === 0) return [];

    // Hide paths with a pending deferred-push outbox entry — they are "resolved,
    // awaiting push" (PR-3b). The path stays pinned until the engine flush pushes
    // it (or re-conflicts on a TOCTOU remote-move), but the user already chose,
    // so it must not re-appear as an open conflict.
    if (this.deps.outbox !== undefined) {
      const pendingForRepo = await this.deps.outbox.listForRepo(spec.repoKey);
      if (pendingForRepo.length > 0) {
        const pendingPaths = new Set(pendingForRepo.map((e) => e.path));
        pinned = pinned.filter((p) => !pendingPaths.has(p));
        if (pinned.length === 0) return [];
      }
    }

    const baseShaByPath = new Map<string, string>();
    for (const f of watermark?.files ?? []) baseShaByPath.set(f.path, f.blobSha);

    // Cache-first (offline): the device-local cache holds the REMOTE+BASE
    // versions captured at quarantine time, so a fully-cached repo needs ZERO
    // network. The head tree is fetched only when some pin is NOT cached (a
    // pre-PR-2 conflict). When a cache IS wired and that fetch fails (offline),
    // uncached pins are omitted rather than aborting the whole list — so the
    // cached conflicts still surface. Without a cache the resolver keeps its
    // legacy network-only behaviour: a fetch failure propagates (no silent []).
    const hasCache = this.deps.conflictCache !== undefined;
    const cachedByPath = await this.cachedRecordsFor(spec, pinned);
    const someUncached = pinned.some((p) => !cachedByPath.has(p));
    let remoteShaByPath = new Map<string, string>();
    let networkAvailable = true;
    if (someUncached) {
      if (hasCache) {
        try {
          remoteShaByPath = await this.remoteTreeShas(spec);
        } catch {
          networkAvailable = false; // offline — only cached pins can be listed
        }
      } else {
        remoteShaByPath = await this.remoteTreeShas(spec); // legacy: propagate
      }
    }

    const localFiles = this.deps.localFilesFor(spec);
    const onDisk = new Set(await localFiles.list());

    const out: ResolvableConflict[] = [];
    for (const path of pinned) {
      const cached = cachedByPath.get(path);
      let baseSha: string;
      let remoteSha: string;
      if (cached !== undefined) {
        remoteSha =
          cached.remoteContent !== undefined
            ? await gitBlobSha(cached.remoteContent, this.deps.sha1)
            : ABSENT;
        baseSha =
          cached.baseContent !== undefined
            ? await gitBlobSha(cached.baseContent, this.deps.sha1)
            : (baseShaByPath.get(path) ?? ABSENT);
      } else {
        // Uncached pin: needs the head tree. Offline ⇒ cannot classify it, omit.
        if (!networkAvailable) continue;
        remoteSha = remoteShaByPath.get(path) ?? ABSENT;
        baseSha = baseShaByPath.get(path) ?? ABSENT;
      }

      let localSha = ABSENT;
      let localContent: string | undefined;
      if (onDisk.has(path)) {
        localContent = await localFiles.read(path);
        localSha = await gitBlobSha(localContent, this.deps.sha1);
      }
      // Genuine 3-way divergence only: every pair differs. A one-sided change
      // (local==base or remote==base) converges without a human; local==remote
      // is already converged. Excluding those keeps the list trustworthy.
      const genuine =
        localSha !== remoteSha &&
        localSha !== baseSha &&
        remoteSha !== baseSha;
      if (!genuine) continue;

      const uid =
        (localContent !== undefined ? extractAssetUid(localContent) : undefined) ??
        cached?.uid;
      out.push({
        repoKey: spec.repoKey,
        path,
        ...(uid !== undefined ? { uid } : {}),
        hasLocal: localSha !== ABSENT,
        hasRemote: remoteSha !== ABSENT,
      });
    }
    return out;
  }

  /** Cache records for the given pinned paths (empty when no cache wired). */
  private async cachedRecordsFor(
    spec: SyncRepoSpec,
    pinned: readonly string[],
  ): Promise<Map<string, ConflictCacheRecord>> {
    const out = new Map<string, ConflictCacheRecord>();
    const cache = this.deps.conflictCache;
    if (cache === undefined) return out;
    for (const path of pinned) {
      const rec = await cache.get(spec.repoKey, path);
      if (rec !== null) out.set(path, rec);
    }
    return out;
  }

  /**
   * Count distinct uids that appear on >1 markdown file across the given specs
   * (device-local disk scan, NO network — same scope/filter as `exosync
   * dedup-uids`). Used by the command layer to explain WHY
   * {@link listOpenConflicts} is empty while the sync summary reported
   * quarantined/deferred entries (#a0a3d1d6 dissonance): duplicate uids (#3477)
   * suppress uid-identity, routing conflicts to cross-path `deferred` (one-sided)
   * or ambiguous-quarantine — exactly the pins the genuine-3-way filter
   * legitimately excludes. The fix is `dedup-uids` + a re-sync, NOT the resolver,
   * so the empty-state points the user there instead of a misleading "✅".
   */
  async detectDuplicateUids(
    specs: readonly SyncRepoSpec[],
  ): Promise<number> {
    const countByUid = new Map<string, number>();
    for (const spec of specs) {
      const localFiles = this.deps.localFilesFor(spec);
      for (const rel of await localFiles.list()) {
        if (!rel.endsWith(".md")) continue;
        let content: string;
        try {
          content = await localFiles.read(rel);
        } catch {
          continue; // unreadable file — skip, never abort the scan
        }
        const uid = extractAssetUid(content);
        if (uid === undefined) continue;
        countByUid.set(uid, (countByUid.get(uid) ?? 0) + 1);
      }
    }
    let dups = 0;
    for (const count of countByUid.values()) if (count > 1) dups++;
    return dups;
  }

  /** Materialise the three versions of one conflict for the diff view. */
  async loadConflict(
    spec: SyncRepoSpec,
    path: string,
  ): Promise<ConflictDetail> {
    const localFiles = this.deps.localFilesFor(spec);
    const onDisk = new Set(await localFiles.list());
    const local = onDisk.has(path) ? await localFiles.read(path) : undefined;

    // Offline-first: the cache holds the remote + base versions captured at
    // quarantine time, so a cached conflict diffs with ZERO network. The
    // on-disk LOCAL version is always read fresh above.
    const cached = (await this.deps.conflictCache?.get(spec.repoKey, path)) ?? null;
    let remote: string | undefined;
    let base: string | undefined;
    if (cached !== null) {
      remote = cached.remoteContent;
      base = cached.baseContent;
    } else {
      const remoteShaByPath = await this.remoteTreeShas(spec);
      const remoteSha = remoteShaByPath.get(path);
      remote =
        remoteSha !== undefined ? await this.blobText(spec, remoteSha) : undefined;

      const watermark = await this.deps.watermarkStore.get(spec.repoKey);
      const baseSha = (watermark?.files ?? []).find((f) => f.path === path)
        ?.blobSha;
      // Best-effort: the base blob may have been GC'd / rewritten upstream.
      if (baseSha !== undefined) {
        try {
          base = await this.blobText(spec, baseSha);
        } catch {
          base = undefined;
        }
      }
    }

    const uid =
      (local !== undefined ? extractAssetUid(local) : undefined) ??
      (remote !== undefined ? extractAssetUid(remote) : undefined) ??
      cached?.uid;
    return {
      repoKey: spec.repoKey,
      path,
      ...(uid !== undefined ? { uid } : {}),
      hasLocal: local !== undefined,
      hasRemote: remote !== undefined,
      ...(base !== undefined ? { base } : {}),
      ...(local !== undefined ? { local } : {}),
      ...(remote !== undefined ? { remote } : {}),
    };
  }

  /**
   * Apply the user's choice. Two modes:
   *
   * **Deferred-push (offline-first, when an outbox is wired — PR-3b):**
   *  1. preserve the discarded LOCAL version to a `.conflict.` disk backup;
   *  2. write the chosen content to disk;
   *  3. when a push is needed (take-local/merged differing from remote) — read
   *     the remote from the cache (NO network), queue the push in the outbox
   *     with the remote blob-SHA as a TOCTOU key, and KEEP the path pinned. The
   *     engine flushes the outbox on the next Sync: it pushes only if the remote
   *     has not moved since (else the conflict re-surfaces — zero-loss). The pin
   *     is left so a TOCTOU re-conflict re-derives naturally; the resolver hides
   *     outbox-pending paths from its list ("resolved, awaiting push").
   *  4. when NO push is needed (take-remote already matches) — snap the watermark
   *     to the choice + unpin + markResolved (converged locally, nothing to send).
   *
   * **Synchronous (legacy/online, no outbox):** fetch the live remote, commit
   * the choice immediately (`restCreateCommit`), snap the watermark + unpin +
   * markResolved — the original one-action convergence.
   *
   * Order matters for M1 in both modes: the backup precedes the disk overwrite,
   * and no convergence bookkeeping runs before the bytes are safely on disk /
   * queued — a failure leaves the path pinned and the disk choice in place.
   */
  async resolve(
    spec: SyncRepoSpec,
    path: string,
    choice: ResolveChoice,
  ): Promise<ResolveResult> {
    const localFiles = this.deps.localFilesFor(spec);
    const onDisk = new Set(await localFiles.list());
    const local = onDisk.has(path) ? await localFiles.read(path) : undefined;

    const deferred = this.deps.outbox !== undefined;
    // The remote version + its blob-SHA. Deferred mode reads the cache (OFFLINE,
    // captured at quarantine time); the legacy path fetches the live remote.
    const { remote, remoteSha } = deferred
      ? await this.remoteForResolve(spec, path)
      : await this.liveRemoteForResolve(spec, path);

    const chosen = this.chosenContent(choice, local, remote);

    // (1) Zero-loss: preserve the EXACT disk bytes we are about to overwrite.
    // ALWAYS back up a discarded local: a configured quarantine repo / cache
    // captured `localContent` at QUARANTINE time, but the user may have re-edited
    // the file since, so the captured copy can be stale and is NOT a substitute
    // for the current disk version. The backup is cheap, idempotent, and excluded
    // from both sync (`.txt`, not `.md`) and the triple store.
    let discardedLocalBackupPath: string | undefined;
    const discardsLocal = choice.take !== "local";
    if (discardsLocal && local !== undefined && local !== chosen) {
      discardedLocalBackupPath = backupPathFor(path);
      await localFiles.write(discardedLocalBackupPath, local);
    }

    // (2) Apply the choice to disk (delete when keep-remote of a remote-delete).
    if (chosen === undefined) {
      await localFiles.delete(path);
    } else {
      await localFiles.write(path, chosen);
    }

    const remoteMatchesChoice =
      (chosen === undefined && remote === undefined) || chosen === remote;

    // (3a) Deferred-push: queue the convergent commit instead of sending it now.
    // Only when a push is genuinely needed (chosen differs from remote and has
    // content). The pin is intentionally LEFT in place — the engine flush snaps
    // and unpins on a clean push, or the pin re-derives the conflict on a TOCTOU
    // remote-move. markResolved is NOT called (the conflict is still open until
    // the push lands; the resolver hides it via the outbox).
    if (
      deferred &&
      this.deps.outbox !== undefined &&
      !remoteMatchesChoice &&
      chosen !== undefined
    ) {
      await this.deps.outbox.enqueue({
        repoKey: spec.repoKey,
        path,
        chosenContent: chosen,
        resolvedTo: choice.take === "merged" ? "merged" : "local",
        // Map the resolver's absent-sentinel to the outbox's (same value, but
        // explicit so the engine flush compares against the canonical token).
        baseRemoteSha: remoteSha === ABSENT ? OUTBOX_REMOTE_ABSENT : remoteSha,
        resolvedAt: "",
      });
      return {
        repoKey: spec.repoKey,
        path,
        resolvedTo: choice.take,
        awaitingPush: true,
        ...(discardedLocalBackupPath !== undefined
          ? { discardedLocalBackupPath }
          : {}),
      };
    }

    // (3b) Converge now: push when needed (legacy/online), then snap + unpin.
    let pushedSha: string | undefined;
    if (!remoteMatchesChoice) {
      pushedSha = await this.commitChoice(spec, path, chosen);
    }

    // (4) Snap the watermark base for this path to the chosen blob and unpin it
    // — the next sync sees base==local==remote and finalises without a merge.
    await this.snapWatermark(spec, path, chosen);

    // (5) Drop the cross-device count immediately when a repo is configured.
    if (this.deps.quarantine?.markResolved !== undefined) {
      await this.deps.quarantine.markResolved(spec.repoKey, path);
    }

    return {
      repoKey: spec.repoKey,
      path,
      resolvedTo: choice.take,
      ...(pushedSha !== undefined ? { pushedSha } : {}),
      ...(discardedLocalBackupPath !== undefined
        ? { discardedLocalBackupPath }
        : {}),
    };
  }

  /**
   * Remote version + git blob-SHA for a resolution, OFFLINE-first: the cache
   * (captured at quarantine time) when present, else the live remote head as a
   * fallback for an uncached (pre-PR-2) pin. The SHA is the TOCTOU key the engine
   * flush re-validates against the live remote before pushing.
   */
  private async remoteForResolve(
    spec: SyncRepoSpec,
    path: string,
  ): Promise<{ remote: string | undefined; remoteSha: string }> {
    const cached = (await this.deps.conflictCache?.get(spec.repoKey, path)) ?? null;
    if (cached !== null) {
      const remote = cached.remoteContent;
      const remoteSha =
        remote !== undefined ? await gitBlobSha(remote, this.deps.sha1) : ABSENT;
      return { remote, remoteSha };
    }
    return this.liveRemoteForResolve(spec, path);
  }

  /** Live remote version + blob-SHA from the AssetSpace head (network). */
  private async liveRemoteForResolve(
    spec: SyncRepoSpec,
    path: string,
  ): Promise<{ remote: string | undefined; remoteSha: string }> {
    const remoteShaByPath = await this.remoteTreeShas(spec);
    const sha = remoteShaByPath.get(path);
    const remote = sha !== undefined ? await this.blobText(spec, sha) : undefined;
    return { remote, remoteSha: sha ?? ABSENT };
  }

  private chosenContent(
    choice: ResolveChoice,
    local: string | undefined,
    remote: string | undefined,
  ): string | undefined {
    switch (choice.take) {
      case "local":
        if (local === undefined) {
          throw new Error(
            "resolve: cannot keep local — no local version exists on disk",
          );
        }
        return local;
      case "remote":
        return remote; // undefined ⇒ remote delete wins (local removed)
      case "merged":
        return choice.content;
    }
  }

  /** Commit the chosen content to the AssetSpace remote (or delete it). */
  private async commitChoice(
    spec: SyncRepoSpec,
    path: string,
    chosen: string | undefined,
  ): Promise<string> {
    const message =
      this.deps.commitMessage?.(spec, path) ??
      `chore(exosync): resolve conflict for ${path}`;
    if (chosen === undefined) {
      // keep-remote of a remotely-present file never reaches here (no commit);
      // a merged/local choice always has content. A remote DELETE resolution
      // would need a deletion commit — out of this resolver's asset-mode scope.
      throw new Error(
        `resolve: cannot push an empty resolution for ${path}`,
      );
    }
    return restCreateCommit(this.deps.transport, {
      owner: spec.owner,
      repo: spec.repo,
      branch: spec.branch,
      files: new Map([[path, chosen]]),
      message,
      ...(this.deps.baseURL !== undefined ? { baseURL: this.deps.baseURL } : {}),
      ...(this.deps.redact !== undefined ? { redact: this.deps.redact } : {}),
    });
  }

  /**
   * Snap the watermark file entry for `path` to the chosen blob and remove it
   * from `pinnedPaths`. lastSyncedSha/rootTreeSha are deliberately untouched —
   * advancing them would falsely claim OTHER unpulled remote paths as synced
   * (M1 loss). A per-path entry diverging "ahead" of the snapshot tree is the
   * symmetric counterpart of a pinned entry diverging "behind"; the next sync
   * reconciles everything else normally.
   */
  private async snapWatermark(
    spec: SyncRepoSpec,
    path: string,
    chosen: string | undefined,
  ): Promise<void> {
    const record = await this.deps.watermarkStore.get(spec.repoKey);
    if (record === null) return; // no base yet ⇒ nothing to unpin (first-sync)

    const pinnedPaths = (record.pinnedPaths ?? []).filter((p) => p !== path);
    let files = record.files;
    if (chosen === undefined) {
      // keep-remote delete: drop the entry so the path reads as absent at base.
      files = files.filter((f) => f.path !== path);
    } else {
      const blobSha = await gitBlobSha(chosen, this.deps.sha1);
      const uid = extractAssetUid(chosen);
      const entry = {
        path,
        blobSha,
        ...(uid !== undefined ? { uid } : {}),
      };
      const idx = files.findIndex((f) => f.path === path);
      files =
        idx >= 0 ? files.map((f, i) => (i === idx ? entry : f)) : [...files, entry];
    }

    // Omit `pinnedPaths` entirely when the pin set is now empty (the engine's
    // own convention — `(pinnedPaths?.length ?? 0) === 0` reads either form).
    await this.deps.watermarkStore.set(spec.repoKey, {
      ...record,
      files,
      ...(pinnedPaths.length > 0 ? { pinnedPaths } : { pinnedPaths: undefined }),
    });
  }

  /** Path → blobSha of the AssetSpace head tree (one fetch per call). */
  private async remoteTreeShas(spec: SyncRepoSpec): Promise<Map<string, string>> {
    const head = await getHeadSha(
      this.deps.transport,
      spec.owner,
      spec.repo,
      spec.branch,
      this.deps.baseURL,
    );
    const commit = await getCommitInfo(
      this.deps.transport,
      spec.owner,
      spec.repo,
      head,
      this.deps.baseURL,
    );
    const tree = await getTree(
      this.deps.transport,
      spec.owner,
      spec.repo,
      commit.treeSha,
      this.deps.baseURL,
    );
    const out = new Map<string, string>();
    for (const e of tree) out.set(e.path, e.blobSha);
    return out;
  }

  private async blobText(spec: SyncRepoSpec, blobSha: string): Promise<string> {
    return getBlobText(
      this.deps.transport,
      spec.owner,
      spec.repo,
      blobSha,
      this.deps.baseURL,
    );
  }
}

/**
 * Backup path for a discarded LOCAL version, written INTO the AssetSpace mount
 * folder. `foo/bar.md` → `foo/bar.md.conflict.local.txt`. Two independent
 * exclusions, deliberately belt-and-suspenders:
 *
 *  - **`.txt` (not `.md`)** keeps it out of the RDF walker (only `.md` is
 *    parsed) — no duplicate-uid anomaly — AND out of asset-mode sync
 *    (`isSyncablePath` requires `.md`).
 *  - the **`.conflict.` infix** (the SAME segment the synced quarantine store
 *    uses) is refused by BOTH `isSyncablePath` AND `isFileSpaceSyncablePath`,
 *    so the backup is never re-synced even in a `file`-mode FileSpace (where
 *    the `.md` check alone would NOT exclude it). The `.local.` segment is
 *    refused too — every gitignore-allowlist guard catches it.
 */
export function backupPathFor(path: string): string {
  return `${path}.conflict.local.txt`;
}
