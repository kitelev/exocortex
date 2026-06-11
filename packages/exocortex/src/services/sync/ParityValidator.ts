/**
 * ExoSync parity validation harness (RFC 4e4dc453 Phase E / E1 — metrics
 * M1 + M2 for the parallel-run window).
 *
 * Read-only, platform-free validator comparing the LOCAL materialized state
 * of each sync unit against its REMOTE head. Cross-device parity follows by
 * transitivity through the shared remote (the rendezvous argument): after a
 * fully successful sync, device A ≅ head and device B ≅ head ⇒ A ≅ B —
 * each device only ever checks itself against the head it syncs with.
 *
 * ## What the metrics mean operationally
 *
 *  - **M2 (recall parity)** — per repo, the count of paths whose content
 *    SEMANTICALLY differs between local and remote head (triple-set proxy,
 *    see `assetSemanticCompare`), excluding the accounted categories
 *    (quarantine pins, deferred local deletes, pure formatting drift).
 *    Right after a fully successful sync the expected value is 0.
 *  - **M1 (zero data loss)** — single snapshots cannot observe loss
 *    directly, so M1 is measured as TWO detectors:
 *      1. *edit conservation* (post-sync rounds): every pre-sync dirty
 *         path's content must survive the round — unchanged on disk,
 *         pushed into the new head, transformed by a recorded merge
 *         (`RepoSyncResult.mergedPaths`), preserved in quarantine
 *         (`quarantinedPaths`), or pinned in the watermark. Anything else
 *         is a conservation violation (the wrongful-overwrite class an
 *         endpoint comparison alone is structurally blind to).
 *      2. *persistent divergence* (round N vs N-1): a pending discrepancy
 *         with the IDENTICAL (localSha, remoteSha) pair surviving a sync
 *         round means the engine failed to converge it — escalated to a
 *         violation. Fresh pending entries are NOT violations (they are
 *         the normal in-flight state of a manual-sync system, VL#1).
 *
 * ## Classification is path-keyed by design
 *
 * No uid matching, no rename detection: a not-yet-pushed local rename
 * classifies as `pending-local-add` + `deferred-local-delete`, which is
 * exactly what the remote will observe (post-#3476 both halves propagate
 * on the next sync). Duplicate-uid vault anomalies therefore cannot
 * affect the harness at all (by construction).
 *
 * ## Read-only contract
 *
 * The validator takes a GET-only watermark source and never mutates disk,
 * remote, or watermark state. The CLI consumer additionally hard-fails the
 * write path of its watermark IO (the plugin's live store must never be
 * written by a concurrent process — its write chain serialises in-process
 * only).
 */

import type { RestCommitTransport } from "../../infrastructure/github/restCommit";
import {
  getCommitInfo,
  getHeadSha,
  getTree,
  getBlobText,
  type RemoteTreeEntry,
} from "./githubRepoReader";
import { gitBlobSha } from "./gitBlobSha";
import { isAuthError } from "./CredentialStore";
import { withRateLimitBackoff, type BackoffOptions } from "./transportBackoff";
import {
  DEFAULT_MAX_FILE_BYTES,
  isFileSpaceSyncablePath,
  isSyncablePath,
  type LocalFilesPort,
  type RepoSyncResult,
  type Sha1Fn,
  type SyncRepoSpec,
  type WatermarkRecord,
} from "./syncTypes";
import {
  compareAssetSemantics,
  isFormatOnlyDrift,
} from "./assetSemanticCompare";
import type { YamlCodec } from "./StructuredMerger";

/** GET-only watermark access (the validator must never be able to write). */
export interface ReadonlyWatermarkSource {
  get(repoKey: string): Promise<WatermarkRecord | null>;
}

export type ParityDiscrepancyClass =
  /** Local file absent from base and head — not yet pushed. */
  | "pending-local-add"
  /** Local differs, remote still equals the base — not yet pushed. */
  | "pending-local-edit"
  /** Remote file absent from base and disk — not yet pulled. */
  | "pending-remote-add"
  /** Remote differs, local still equals the base — not yet pulled. */
  | "pending-remote-edit"
  /** Remote deleted it, local copy unchanged — delete not yet pulled. */
  | "pending-remote-delete"
  /**
   * Locally deleted, remote still carries the base version — the delete
   * has not been pushed YET. Post-#3476 the engine propagates deletes, so
   * this is a transient pending divergence (counts into M2 like a
   * pending-local-edit) and ESCALATES when it survives a converged sync
   * round unchanged. The historical class name is kept for journal
   * continuity (pre-#3476 entries used it for the accounted A1 gap).
   */
  | "deferred-local-delete"
  /**
   * Both sides moved off the base (or presence conflicts) — the normal
   * in-flight conflict of parallel editing between sync rounds. NOT a
   * violation per se; escalates only when it survives a sync unchanged.
   */
  | "pending-conflict"
  /** Path pinned in the watermark — preserved conflict, accounted (D17). */
  | "quarantine-pinned"
  /** Bytes differ, semantics equal (frontmatter + body) — M2-clean. */
  | "format-only-drift"
  /** Byte-divergent but the semantic-fetch cap was hit — counted into M2. */
  | "unverified-divergence";

export interface ParityDiscrepancy {
  path: string;
  presence: "both" | "local-only" | "remote-only";
  cls: ParityDiscrepancyClass;
  localSha?: string;
  remoteSha?: string;
  frontmatterEqual?: boolean;
  bodyEqual?: boolean;
  detail?: string;
}

export interface ParityM1Violation {
  repoKey: string;
  path: string;
  kind: "conservation" | "persistent-divergence";
  detail: string;
}

export type RepoParityStatus =
  /** Compared against a validated head — counts are authoritative. */
  | "checked"
  /** No watermark — repo never synced on this device; counts informational. */
  | "no-watermark"
  /** Head moved mid-check or the sync hit its race window — discarded. */
  | "inconclusive"
  /** HTTP 401/403 — R8: surface "update your PAT", never treat as success. */
  | "auth-required"
  | "error";

export interface RepoParityReport {
  repoKey: string;
  status: RepoParityStatus;
  filesChecked: number;
  inParity: number;
  discrepancies: ParityDiscrepancy[];
  /** Semantic divergences counted into M2 (excludes accounted categories). */
  m2SemanticDiffs: number;
  /** quarantine-pinned + format-only-drift (accounted, never in M2). */
  accountedCount: number;
  m1Violations: ParityM1Violation[];
  /** File-mode repos: multiset equality of blob SHAs (attachment sub-check). */
  attachmentHashSetIdentical?: boolean;
  headSha?: string;
  warnings: string[];
  detail?: string;
}

/** One harness round — the JSONL journal entry shape (window evidence). */
export interface ParityRoundRecord {
  version: 1;
  ts: string;
  trigger: "post-sync" | "standalone";
  /** Filled by the plugin layer (tri-state internal-plugin probe). */
  obsidianSync?: "enabled" | "disabled" | "unknown";
  repos: RepoParityReport[];
  checkedRepos: number;
  m1Total: number;
  m2Total: number;
  /** True ⇔ M1 == 0 AND M2 == 0 AND at least one repo was actually checked. */
  ok: boolean;
  /** True ⇔ nothing was checked (all errored / never synced) — exit code 2. */
  vacuous: boolean;
}

/** Pre-sync dirty snapshot for the edit-conservation detector. */
export interface ConservationSnapshot {
  /** repoKey → (path → pre-sync local blob SHA) of base-divergent paths. */
  dirtyByRepo: Map<string, Map<string, string>>;
  /**
   * Per-repo snapshot failures (advisor round-2 NEW-3): a repo that could
   * not snapshot has NO conservation coverage this round — silently eaten
   * reasons would make the coverage gap undiagnosable. Callers log these.
   */
  warnings: string[];
}

export interface ParityValidatorDeps {
  transport: RestCommitTransport;
  sha1: Sha1Fn;
  localFilesFor: (spec: SyncRepoSpec) => LocalFilesPort;
  watermarks: ReadonlyWatermarkSource;
  yaml: YamlCodec;
  baseURL?: string;
  /** Symmetric per-file size cap (mirrors the engine). */
  maxFileBytes?: number;
  /** Cap on remote-blob fetches for semantic comparison, per repo. */
  maxSemanticFetchesPerRepo?: number;
  /** ...and across the whole round (mobile budget, advisor HIGH-6). */
  maxSemanticFetchesPerRun?: number;
  redact?: (m: string) => string;
  backoff?: BackoffOptions;
  /** Test seam for the journal timestamp. */
  now?: () => string;
}

export interface ParityRunOptions {
  trigger: "post-sync" | "standalone";
  /** Enables the edit-conservation detector (capture BEFORE the sync). */
  snapshot?: ConservationSnapshot;
  /** The sync round's results — merged/quarantined path accounting. */
  syncResults?: RepoSyncResult[];
  /** Previous journal entry — enables persistent-divergence escalation. */
  previousRound?: ParityRoundRecord | null;
}

const DEFAULT_SEMANTIC_FETCHES_PER_REPO = 50;
const DEFAULT_SEMANTIC_FETCHES_PER_RUN = 200;

/**
 * Pending classes that escalate when they survive a sync unchanged.
 *
 * `pending-local-add` is deliberately ABSENT (advisor round-2 NEW-1, PR
 * #3474): a uid-rename is deferred by design even in a "synced" cycle (the
 * engine pushes neither the delete nor the re-add — A1 gap), so the new
 * path legitimately persists as an un-pushed add across successful syncs;
 * escalating it would flag an M1 violation on every round after any
 * routine note rename. Detection loss is ~nil: a VANISHED add is the
 * conservation detector's job (add paths are base-divergent ⇒ in the
 * dirty snapshot), and a stuck-but-present add is plainly visible in M2.
 */
const ESCALATABLE: ReadonlySet<ParityDiscrepancyClass> = new Set([
  "pending-local-edit",
  "pending-remote-add",
  "pending-remote-edit",
  "pending-remote-delete",
  // Post-#3476 the engine pushes deletes — one that survives a CONVERGED
  // sync round unchanged is an engine failure, no longer an accounted gap.
  "deferred-local-delete",
  "pending-conflict",
  "unverified-divergence",
]);

/** Classes accounted as preserved/clean — never counted into M2. */
const ACCOUNTED: ReadonlySet<ParityDiscrepancyClass> = new Set([
  "quarantine-pinned",
  "format-only-drift",
]);

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isNotFoundError(err: unknown): boolean {
  return /HTTP 404/.test(errMsg(err));
}

interface LocalSnapshot {
  /** path → blob SHA of every syncable, size-admitted local file. */
  shas: Map<string, string>;
  /** path → text content (asset mode only; file mode keeps no contents). */
  texts: Map<string, string>;
  warnings: string[];
}

export class ParityValidator {
  private readonly deps: ParityValidatorDeps;
  private readonly transport: RestCommitTransport;

  constructor(deps: ParityValidatorDeps) {
    this.deps = deps;
    this.transport = withRateLimitBackoff(deps.transport, deps.backoff);
  }

  /**
   * Capture the pre-sync dirty set (call BEFORE `SyncEngine.syncAll`).
   * Local walk + hash only — zero API calls. Paths that differ from the
   * watermark base are the edits whose conservation the post-sync round
   * verifies. Repos without a watermark contribute nothing (first sync is
   * full-conflict territory, handled by the engine itself).
   */
  async captureSnapshot(specs: SyncRepoSpec[]): Promise<ConservationSnapshot> {
    const dirtyByRepo = new Map<string, Map<string, string>>();
    const warnings: string[] = [];
    const redact = this.deps.redact ?? ((m: string): string => m);
    for (const spec of specs) {
      try {
        const watermark = await this.deps.watermarks.get(spec.repoKey);
        if (watermark === null) continue;
        const base = new Map(
          watermark.files.map((f) => [f.path, f.blobSha] as const),
        );
        // Mode-correct walk (code-reviewer MEDIUM, PR #3474): a file-mode
        // repo must snapshot its binaries byte-exact — the text walk would
        // both miss attachment edits (no conservation coverage) and
        // mis-hash non-UTF8 content (phantom dirty → false M1).
        const local = await this.readLocalSnapshot(
          spec,
          spec.spaceKind === "file",
        );
        const dirty = new Map<string, string>();
        for (const [path, sha] of local.shas) {
          if (base.get(path) !== sha) dirty.set(path, sha);
        }
        if (dirty.size > 0) dirtyByRepo.set(spec.repoKey, dirty);
      } catch (err) {
        // Best-effort by contract: a repo that cannot snapshot simply has
        // no conservation coverage this round (never blocks the sync) —
        // but the REASON must surface (advisor round-2 NEW-3).
        warnings.push(
          `${spec.repoKey}: conservation snapshot failed (${redact(errMsg(err))}) — no coverage this round`,
        );
      }
    }
    return { dirtyByRepo, warnings };
  }

  /** Run one validation round over the materialized set. Never throws. */
  async runRound(
    specs: SyncRepoSpec[],
    opts: ParityRunOptions,
  ): Promise<ParityRoundRecord> {
    const now = this.deps.now ?? ((): string => new Date().toISOString());
    let runFetchBudget =
      this.deps.maxSemanticFetchesPerRun ?? DEFAULT_SEMANTIC_FETCHES_PER_RUN;

    const repos: RepoParityReport[] = [];
    for (const spec of specs) {
      const report = await this.checkRepo(spec, opts, {
        take: (n: number): boolean => {
          if (runFetchBudget < n) return false;
          runFetchBudget -= n;
          return true;
        },
      });
      repos.push(report);
    }

    // Escalation requires a sync BETWEEN the two snapshots (a pending edit
    // legitimately persists across standalone checks when the user simply
    // has not synced yet) — only post-sync rounds guarantee that. And the
    // sync must have actually CONVERGED the repo: a failed cycle (error /
    // secret-detected / retry-exhausted / conflict / busy / skipped) never
    // advanced the watermark, so its pendings legitimately survive — an
    // escalation there would pollute the M1 evidence window with false
    // positives every round (code-reviewer HIGH, PR #3474).
    if (opts.previousRound != null && opts.trigger === "post-sync") {
      this.escalatePersistentDivergence(
        repos,
        opts.previousRound,
        opts.syncResults,
      );
    }

    const checkedRepos = repos.filter((r) => r.status === "checked").length;
    const m1Total = repos.reduce((s, r) => s + r.m1Violations.length, 0);
    const m2Total = repos.reduce(
      (s, r) => s + (r.status === "checked" ? r.m2SemanticDiffs : 0),
      0,
    );
    return {
      version: 1,
      ts: now(),
      trigger: opts.trigger,
      repos,
      checkedRepos,
      m1Total,
      m2Total,
      ok: m1Total === 0 && m2Total === 0 && checkedRepos > 0,
      vacuous: checkedRepos === 0,
    };
  }

  // ── per-repo check ──────────────────────────────────────────────────

  private async checkRepo(
    spec: SyncRepoSpec,
    opts: ParityRunOptions,
    runBudget: { take: (n: number) => boolean },
  ): Promise<RepoParityReport> {
    const warnings: string[] = [];
    const redact = this.deps.redact ?? ((m: string): string => m);
    const report = (
      status: RepoParityStatus,
      extra: Partial<RepoParityReport> = {},
    ): RepoParityReport => ({
      repoKey: spec.repoKey,
      status,
      filesChecked: 0,
      inParity: 0,
      discrepancies: [],
      m2SemanticDiffs: 0,
      accountedCount: 0,
      m1Violations: [],
      warnings,
      ...extra,
    });

    // A sync that hit its race window did NOT advance the watermark — the
    // snapshot this round would compare against is mid-reconciliation.
    const syncResult = opts.syncResults?.find(
      (r) => r.repoKey === spec.repoKey,
    );
    if (syncResult?.warnings.some((w) => w.startsWith("race-window"))) {
      return report("inconclusive", {
        detail:
          "sync hit its race window (watermark not advanced) — parity deferred to the next round",
      });
    }
    // D19 × #3476: under partial materialization local absence is NOT
    // divergence — comparing would mass-classify every missing file as a
    // deferred-local-delete (now an M2-counting pending class) and flood
    // the journal with false positives.
    if (syncResult?.status === "skipped-not-materialized") {
      return report("inconclusive", {
        detail:
          "repo not fully materialized (D19) — local absence is not divergence; parity deferred to the next round",
      });
    }

    try {
      const fileMode = spec.spaceKind === "file";
      const headSha = await getHeadSha(
        this.transport,
        spec.owner,
        spec.repo,
        spec.branch,
        this.deps.baseURL,
      );
      const commit = await getCommitInfo(
        this.transport,
        spec.owner,
        spec.repo,
        headSha,
        this.deps.baseURL,
      );
      const tree = await getTree(
        this.transport,
        spec.owner,
        spec.repo,
        commit.treeSha,
        this.deps.baseURL,
      );

      const maxBytes = this.deps.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
      const syncable = fileMode ? isFileSpaceSyncablePath : isSyncablePath;
      const remote = new Map<string, RemoteTreeEntry>();
      for (const entry of tree) {
        if (!syncable(entry.path)) continue;
        if (entry.size !== undefined && entry.size > maxBytes) {
          warnings.push(
            `remote ${entry.path} exceeds the ${maxBytes}-byte cap — excluded symmetrically`,
          );
          continue;
        }
        remote.set(entry.path, entry);
      }

      const local = await this.readLocalSnapshot(spec, fileMode);
      warnings.push(...local.warnings);

      const watermark = await this.deps.watermarks.get(spec.repoKey);
      if (watermark === null) {
        // Never synced on this device — endpoint diff would be all noise.
        let inParity = 0;
        for (const [path, sha] of local.shas) {
          if (remote.get(path)?.blobSha === sha) inParity++;
        }
        const union = new Set([...local.shas.keys(), ...remote.keys()]);
        return report("no-watermark", {
          filesChecked: union.size,
          inParity,
          headSha,
          detail: `repo has no sync watermark on this device (${union.size - inParity} raw diff(s)) — run a sync first; not counted toward M1/M2`,
        });
      }

      const base = new Map(
        watermark.files.map((f) => [f.path, f.blobSha] as const),
      );
      const pinned = new Set(watermark.pinnedPaths ?? []);

      const { discrepancies, inParity, filesChecked } =
        await this.classifyAll(spec, local, remote, base, pinned, fileMode, {
          warnings,
          runBudget,
        });

      // Moved-head guard: a push/edit landing remotely mid-walk makes the
      // comparison internally inconsistent — discard, next round re-checks.
      const headAfter = await getHeadSha(
        this.transport,
        spec.owner,
        spec.repo,
        spec.branch,
        this.deps.baseURL,
      );
      if (headAfter !== headSha) {
        return report("inconclusive", {
          headSha,
          detail: `remote head moved during the check (${headSha.slice(0, 7)} → ${headAfter.slice(0, 7)}) — parity deferred to the next round`,
        });
      }

      const m1Violations = this.checkConservation(
        spec,
        opts,
        local,
        remote,
        pinned,
        syncResult,
      );

      const m2SemanticDiffs = discrepancies.filter(
        (d) => !ACCOUNTED.has(d.cls),
      ).length;
      const accountedCount = discrepancies.length - m2SemanticDiffs;

      let attachmentHashSetIdentical: boolean | undefined;
      if (fileMode) {
        const localSet = [...local.shas.values()].sort().join("\n");
        const remoteSet = [...remote.values()]
          .map((e) => e.blobSha)
          .sort()
          .join("\n");
        attachmentHashSetIdentical = localSet === remoteSet;
      }

      return report("checked", {
        filesChecked,
        inParity,
        discrepancies,
        m2SemanticDiffs,
        accountedCount,
        m1Violations,
        headSha,
        ...(attachmentHashSetIdentical !== undefined
          ? { attachmentHashSetIdentical }
          : {}),
      });
    } catch (err) {
      if (isAuthError(err)) {
        return report("auth-required", {
          detail: redact(
            `authentication failed: ${errMsg(err)} — the PAT is expired, revoked or under-scoped; update it (R8)`,
          ),
        });
      }
      if (isNotFoundError(err)) {
        // Dead repo pointer OR a fine-grained PAT whose allowlist omits this
        // private repo (GitHub hides existence with 404) — documented blind
        // spot; the hint keeps auth misconfiguration from masquerading as a
        // missing repo indefinitely.
        warnings.push(
          `repo unreachable (HTTP 404): dead AssetSpace pointer, or the fine-grained PAT does not allowlist this repo — skipped`,
        );
        return report("error", { detail: redact(errMsg(err)) });
      }
      warnings.push(`parity check failed: ${redact(errMsg(err))}`);
      return report("error", { detail: redact(errMsg(err)) });
    }
  }

  // ── local snapshot ──────────────────────────────────────────────────

  private async readLocalSnapshot(
    spec: SyncRepoSpec,
    fileMode: boolean,
  ): Promise<LocalSnapshot> {
    const port = this.deps.localFilesFor(spec);
    const syncable = fileMode ? isFileSpaceSyncablePath : isSyncablePath;
    const maxBytes = this.deps.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    const shas = new Map<string, string>();
    const texts = new Map<string, string>();
    const warnings: string[] = [];

    if (fileMode && port.readBinary === undefined) {
      throw new Error(
        "file-mode repo requires a LocalFilesPort with readBinary — refusing to hash through the text-only port (binary would corrupt)",
      );
    }

    const encoder = new TextEncoder();
    for (const path of await port.list()) {
      if (!syncable(path)) continue;
      try {
        if (fileMode) {
          const bytes = await (
            port.readBinary as NonNullable<LocalFilesPort["readBinary"]>
          )(path);
          if (bytes.byteLength > maxBytes) {
            warnings.push(
              `local ${path} exceeds the ${maxBytes}-byte cap — excluded symmetrically`,
            );
            continue;
          }
          shas.set(path, await gitBlobSha(bytes, this.deps.sha1));
        } else {
          const text = await port.read(path);
          if (encoder.encode(text).byteLength > maxBytes) {
            warnings.push(
              `local ${path} exceeds the ${maxBytes}-byte cap — excluded symmetrically`,
            );
            continue;
          }
          texts.set(path, text);
          shas.set(path, await gitBlobSha(text, this.deps.sha1));
        }
      } catch (err) {
        const redact = this.deps.redact ?? ((m: string): string => m);
        warnings.push(
          `local ${path} unreadable (${redact(errMsg(err))}) — skipped`,
        );
      }
    }
    return { shas, texts, warnings };
  }

  // ── classification ──────────────────────────────────────────────────

  private async classifyAll(
    spec: SyncRepoSpec,
    local: LocalSnapshot,
    remote: ReadonlyMap<string, RemoteTreeEntry>,
    base: ReadonlyMap<string, string>,
    pinned: ReadonlySet<string>,
    fileMode: boolean,
    ctx: { warnings: string[]; runBudget: { take: (n: number) => boolean } },
  ): Promise<{
    discrepancies: ParityDiscrepancy[];
    inParity: number;
    filesChecked: number;
  }> {
    const discrepancies: ParityDiscrepancy[] = [];
    let inParity = 0;
    let repoFetchBudget =
      this.deps.maxSemanticFetchesPerRepo ?? DEFAULT_SEMANTIC_FETCHES_PER_REPO;

    const paths = new Set<string>([...local.shas.keys(), ...remote.keys()]);
    for (const path of [...paths].sort()) {
      const localSha = local.shas.get(path);
      const remoteEntry = remote.get(path);
      const remoteSha = remoteEntry?.blobSha;
      const baseSha = base.get(path);

      if (localSha !== undefined && remoteSha !== undefined) {
        if (localSha === remoteSha) {
          inParity++;
          continue;
        }
        discrepancies.push(
          await this.classifyContentDiff(
            spec,
            path,
            localSha,
            remoteSha,
            baseSha,
            pinned,
            fileMode,
            local,
            { ...ctx, takeRepoFetch: () => repoFetchBudget-- > 0 },
          ),
        );
        continue;
      }

      if (localSha !== undefined) {
        // local-only
        let d: ParityDiscrepancy;
        if (pinned.has(path)) {
          d = { path, presence: "local-only", cls: "quarantine-pinned", localSha };
        } else if (baseSha === undefined) {
          d = { path, presence: "local-only", cls: "pending-local-add", localSha };
        } else if (baseSha === localSha) {
          d = {
            path,
            presence: "local-only",
            cls: "pending-remote-delete",
            localSha,
            detail: "remote deleted it; the local copy is unchanged",
          };
        } else {
          d = {
            path,
            presence: "local-only",
            cls: "pending-conflict",
            localSha,
            detail: "remote deleted it AND the local copy was edited",
          };
        }
        discrepancies.push(d);
        continue;
      }

      if (remoteSha !== undefined) {
        // remote-only
        let d: ParityDiscrepancy;
        if (pinned.has(path)) {
          d = { path, presence: "remote-only", cls: "quarantine-pinned", remoteSha };
        } else if (baseSha === undefined) {
          d = { path, presence: "remote-only", cls: "pending-remote-add", remoteSha };
        } else if (baseSha === remoteSha) {
          d = {
            path,
            presence: "remote-only",
            cls: "deferred-local-delete",
            remoteSha,
            detail:
              "locally deleted; the delete propagates on the next sync (#3476) — escalates if it survives a converged round",
          };
        } else {
          d = {
            path,
            presence: "remote-only",
            cls: "pending-conflict",
            remoteSha,
            detail: "locally deleted AND the remote copy was edited",
          };
        }
        discrepancies.push(d);
      }
    }

    return { discrepancies, inParity, filesChecked: paths.size };
  }

  private async classifyContentDiff(
    spec: SyncRepoSpec,
    path: string,
    localSha: string,
    remoteSha: string,
    baseSha: string | undefined,
    pinned: ReadonlySet<string>,
    fileMode: boolean,
    local: LocalSnapshot,
    ctx: {
      warnings: string[];
      runBudget: { take: (n: number) => boolean };
      takeRepoFetch: () => boolean;
    },
  ): Promise<ParityDiscrepancy> {
    const shas = { localSha, remoteSha };
    if (pinned.has(path)) {
      return { path, presence: "both", cls: "quarantine-pinned", ...shas };
    }
    if (baseSha !== undefined && baseSha === localSha) {
      return { path, presence: "both", cls: "pending-remote-edit", ...shas };
    }
    if (baseSha !== undefined && baseSha === remoteSha) {
      return { path, presence: "both", cls: "pending-local-edit", ...shas };
    }

    // Both sides moved off the base (or no base entry). File-mode blobs are
    // opaque — no semantic layer; asset mode gets the triple-set proxy.
    if (fileMode) {
      return {
        path,
        presence: "both",
        cls: "pending-conflict",
        ...shas,
        detail: "binary content differs on both sides",
      };
    }

    if (!ctx.takeRepoFetch() || !ctx.runBudget.take(1)) {
      ctx.warnings.push(
        `semantic-fetch cap reached — ${path} left unverified (counted into M2)`,
      );
      return { path, presence: "both", cls: "unverified-divergence", ...shas };
    }

    const localText = local.texts.get(path);
    let remoteText: string;
    try {
      remoteText = await getBlobText(
        this.transport,
        spec.owner,
        spec.repo,
        remoteSha,
        this.deps.baseURL,
      );
    } catch (err) {
      const redact = this.deps.redact ?? ((m: string): string => m);
      ctx.warnings.push(
        `blob fetch for ${path} failed (${redact(errMsg(err))}) — left unverified`,
      );
      return { path, presence: "both", cls: "unverified-divergence", ...shas };
    }

    const cmp = compareAssetSemantics(localText ?? "", remoteText, this.deps.yaml);
    if (isFormatOnlyDrift(cmp)) {
      return {
        path,
        presence: "both",
        cls: "format-only-drift",
        ...shas,
        frontmatterEqual: true,
        bodyEqual: true,
      };
    }
    return {
      path,
      presence: "both",
      cls: "pending-conflict",
      ...shas,
      frontmatterEqual: cmp.frontmatterEqual,
      bodyEqual: cmp.bodyEqual,
      detail: `semantic divergence (frontmatter ${cmp.frontmatterEqual ? "equal" : "differs"}, body ${cmp.bodyEqual ? "equal" : "differs"})`,
    };
  }

  // ── M1 detectors ────────────────────────────────────────────────────

  /** Edit-conservation (detector 1) — see module docstring. */
  private checkConservation(
    spec: SyncRepoSpec,
    opts: ParityRunOptions,
    local: LocalSnapshot,
    remote: ReadonlyMap<string, RemoteTreeEntry>,
    pinned: ReadonlySet<string>,
    syncResult: RepoSyncResult | undefined,
  ): ParityM1Violation[] {
    const dirty = opts.snapshot?.dirtyByRepo.get(spec.repoKey);
    if (dirty === undefined || dirty.size === 0) return [];

    const merged = new Set(syncResult?.mergedPaths ?? []);
    const quarantined = new Set(syncResult?.quarantinedPaths ?? []);

    const violations: ParityM1Violation[] = [];
    for (const [path, preSha] of dirty) {
      if (local.shas.get(path) === preSha) continue; // untouched / pending
      // "Pushed as-is" is a PER-PATH claim, like everything else here —
      // a whole-tree blob-set membership would let a wrongful overwrite
      // of path A hide behind an identical blob at path B (duplicate
      // attachments are realistic; code-reviewer MEDIUM, PR #3474).
      if (remote.get(path)?.blobSha === preSha) continue;
      if (merged.has(path)) continue; // legitimately transformed (3-way)
      if (quarantined.has(path)) continue; // preserved in quarantine
      if (pinned.has(path)) continue; // re-derives next sync
      violations.push({
        repoKey: spec.repoKey,
        path,
        kind: "conservation",
        detail: `pre-sync dirty content ${preSha.slice(0, 7)} survived NOWHERE: disk now ${local.shas.get(path)?.slice(0, 7) ?? "absent"}, not in head tree, not merged/quarantined/pinned — possible lost edit`,
      });
    }
    return violations;
  }

  /** Persistent-divergence escalation (detector 2) — see module docstring. */
  private escalatePersistentDivergence(
    current: RepoParityReport[],
    previous: ParityRoundRecord,
    syncResults: RepoSyncResult[] | undefined,
  ): void {
    for (const repo of current) {
      if (repo.status !== "checked") continue;
      // Only a repo whose sync cycle actually converged ("synced") proves
      // the engine had its chance — anything else legitimately leaves
      // pendings behind. Absent results (no per-repo info) keep the
      // historical behaviour: the post-sync trigger itself is the signal.
      const syncResult = syncResults?.find((r) => r.repoKey === repo.repoKey);
      if (syncResult !== undefined && syncResult.status !== "synced") continue;
      // Deletions the engine DELIBERATELY withheld this cycle (#3476:
      // empty-tree refusal — conflict-withheld ones are pinned and classify
      // as quarantine-pinned instead) are not convergence failures; without
      // the exemption every such path would escalate to a false M1 on the
      // second round and stay there until the repo regains a survivor file.
      const deliberatelyDeferred = new Set(syncResult?.deferredDeletes ?? []);
      const prevRepo = previous.repos.find(
        (r) => r.repoKey === repo.repoKey && r.status === "checked",
      );
      if (prevRepo === undefined) continue;
      const prevByPath = new Map(
        prevRepo.discrepancies
          .filter((d) => ESCALATABLE.has(d.cls))
          .map((d) => [d.path, d] as const),
      );
      for (const d of repo.discrepancies) {
        if (!ESCALATABLE.has(d.cls)) continue;
        if (deliberatelyDeferred.has(d.path)) continue;
        const prev = prevByPath.get(d.path);
        if (
          prev !== undefined &&
          prev.localSha === d.localSha &&
          prev.remoteSha === d.remoteSha
        ) {
          repo.m1Violations.push({
            repoKey: repo.repoKey,
            path: d.path,
            kind: "persistent-divergence",
            detail: `identical divergence (local ${d.localSha?.slice(0, 7) ?? "absent"}, remote ${d.remoteSha?.slice(0, 7) ?? "absent"}) survived a sync round unchanged (${prev.cls} → ${d.cls}) — the engine failed to converge it`,
          });
        }
      }
    }
  }
}

/** One-line human summary for Notices / CLI stdout. */
export function summarizeParityRound(record: ParityRoundRecord): string {
  if (record.vacuous) {
    return `ExoSync parity: VACUOUS — 0 of ${record.repos.length} repo(s) checked (errors / never synced)`;
  }
  const skipped = record.repos.length - record.checkedRepos;
  const tail = skipped > 0 ? `, ${skipped} skipped` : "";
  return record.ok
    ? `ExoSync parity: M1=0, M2=∅ (${record.checkedRepos} repo(s) checked${tail})`
    : `ExoSync parity: M1=${record.m1Total}, M2=${record.m2Total} diff(s) (${record.checkedRepos} repo(s) checked${tail}) — see log`;
}
