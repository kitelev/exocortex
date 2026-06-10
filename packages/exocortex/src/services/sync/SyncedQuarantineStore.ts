/**
 * ExoSync synced quarantine store (RFC 4e4dc453 D17, A3).
 *
 * Durable QuarantinePort: conflict copies are committed to a SEPARATE
 * synced quarantine repo through the same `restCreateCommit` primitive
 * (D3 — no new write path). Entries survive reinstall / device loss, are
 * visible cross-device, and give the real unresolved-count (CQ4).
 *
 * Deliberate non-ontology design (interaction-fix in the RFC):
 *
 *  - The quarantine repo is a PLAIN synced dir, NOT an `exo__FileSpace` —
 *    A3 does not depend on the Phase C ontology.
 *  - Entries are `.json` files: the RDF walker only parses `.md`, so the
 *    quarantine is automatically excluded from the triple store (no UID,
 *    no SHACL), and `isSyncablePath` refuses `.json` symmetrically, so
 *    entries never leak into the canonical sync cycle.
 *  - Always-mounted floor, EXEMPT from the D19 full-materialization gate:
 *    this store writes straight through the transport and never passes
 *    through `SyncEngine`'s gate — a quarantine flush is never skipped,
 *    and delete-from-absence never applies to it.
 *
 * Idempotency & churn control: one entry = ONE stable filename
 * (slug + 8-hex sha1 of `repoKey\0path`). Re-quarantining preserves the
 * original `quarantinedAt` and SKIPS the push when the entry is
 * semantically identical — an unresolved conflict that re-derives every
 * sync produces zero commits until its content actually changes.
 *
 * Deletion: the write primitive cannot delete files, so resolution is a
 * tombstone-by-overwrite — `markResolved` rewrites the entry with
 * `status: "resolved"`. Open entries are the ones that count (CQ4).
 *
 * Secrets: entry contents are REDACTED (not refused) — a conflict copy
 * embedding a PAT is still preserved durably, minus the secret.
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
} from "./githubRepoReader";
import { isNonFastForwardError } from "./SyncEngine";
import { redactSecrets } from "./secretScan";
import type { QuarantineEntry, QuarantinePort, Sha1Fn } from "./syncTypes";

/** Persisted shape of one quarantine entry file. */
export interface QuarantineEntryRecord {
  version: 1;
  repoKey: string;
  path: string;
  uid?: string;
  reason: string;
  status: "open" | "resolved";
  quarantinedAt: string;
  resolvedAt?: string;
  baseContent?: string;
  localContent?: string;
  remoteContent?: string;
}

export interface SyncedQuarantineStoreDeps {
  /**
   * Transport for the quarantine repo. Pass the SAME rate-limit-backoff-
   * wrapped transport the engine uses (`withRateLimitBackoff`) — the
   * quarantine flush is the highest-volume caller.
   */
  transport: RestCommitTransport;
  sha1: Sha1Fn;
  /** The dedicated quarantine repo (always-mounted floor, D19-exempt). */
  owner: string;
  repo: string;
  branch: string;
  baseURL?: string;
  redact?: (message: string) => string;
  /** Injected clock (ISO string) — deterministic tests. */
  now?: () => string;
  /** Direct retries on a 422 concurrent-push race. Default 3. */
  maxPushRetries?: number;
}

const ENTRIES_PREFIX = "entries/";
const MAX_SLUG_LENGTH = 80;

/** Filesystem-safe, length-bounded slug (collision-proofed by the hash). */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, MAX_SLUG_LENGTH);
}

function parseRecord(raw: string): QuarantineEntryRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const r = parsed as Record<string, unknown>;
    if (
      typeof r.repoKey !== "string" ||
      typeof r.path !== "string" ||
      typeof r.reason !== "string" ||
      (r.status !== "open" && r.status !== "resolved")
    ) {
      return null;
    }
    return parsed as QuarantineEntryRecord;
  } catch {
    return null;
  }
}

/** Open-entry summary (CQ4). */
export interface OpenQuarantineEntry {
  entryPath: string;
  repoKey: string;
  path: string;
  uid?: string;
  reason: string;
  quarantinedAt: string;
}

export class SyncedQuarantineStore implements QuarantinePort {
  private readonly deps: SyncedQuarantineStoreDeps;

  constructor(deps: SyncedQuarantineStoreDeps) {
    this.deps = deps;
  }

  async quarantine(entry: QuarantineEntry): Promise<void> {
    await this.quarantineAll([entry]);
  }

  /**
   * Persist many entries in ONE commit (a D16 terminal flush can carry
   * dozens of contended files). Unchanged entries are skipped; when every
   * entry is unchanged, no commit happens at all.
   */
  async quarantineAll(entries: QuarantineEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const entryPaths = await Promise.all(
      entries.map((e) => this.entryPath(e.repoKey, e.path)),
    );
    const existing = await this.readEntries(entryPaths);

    const files = new Map<string, string>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryPath = entryPaths[i];
      const prior = existing.get(entryPath) ?? null;
      // Reopening a resolved entry is a NEW conflict event → fresh
      // timestamp; an entry that is already open keeps its original one.
      const quarantinedAt =
        prior !== null && prior.status === "open"
          ? prior.quarantinedAt
          : (this.deps.now ?? (() => new Date().toISOString()))();
      const record: QuarantineEntryRecord = {
        version: 1,
        repoKey: entry.repoKey,
        path: entry.path,
        ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
        // Redacted like the contents: SHACL-gate reasons can quote
        // frontmatter values (defence-in-depth symmetry).
        reason: redactSecrets(entry.reason),
        status: "open",
        quarantinedAt,
        ...(entry.baseContent !== undefined
          ? { baseContent: redactSecrets(entry.baseContent) }
          : {}),
        ...(entry.localContent !== undefined
          ? { localContent: redactSecrets(entry.localContent) }
          : {}),
        ...(entry.remoteContent !== undefined
          ? { remoteContent: redactSecrets(entry.remoteContent) }
          : {}),
      };
      const serialized = JSON.stringify(record, null, 2);
      if (prior !== null && JSON.stringify(prior, null, 2) === serialized) {
        continue; // semantically identical — zero commit churn
      }
      files.set(entryPath, serialized);
    }
    if (files.size === 0) return;

    await this.push(
      files,
      `chore(exosync): quarantine ${files.size} conflict entr${files.size === 1 ? "y" : "ies"} (D17)`,
    );
  }

  /**
   * Tombstone-by-overwrite resolution (the primitive cannot delete).
   * No-op when the entry does not exist or is already resolved.
   */
  async markResolved(repoKey: string, path: string): Promise<void> {
    const entryPath = await this.entryPath(repoKey, path);
    const prior = (await this.readEntries([entryPath])).get(entryPath);
    if (prior === undefined || prior === null || prior.status === "resolved") {
      return;
    }
    const resolved: QuarantineEntryRecord = {
      ...prior,
      status: "resolved",
      resolvedAt: (this.deps.now ?? (() => new Date().toISOString()))(),
    };
    await this.push(
      new Map([[entryPath, JSON.stringify(resolved, null, 2)]]),
      `chore(exosync): resolve quarantine entry for ${path}`,
    );
  }

  /** Open entries across all devices (CQ4). */
  async listOpen(): Promise<OpenQuarantineEntry[]> {
    const tree = await this.headTree();
    if (tree === null) return [];
    const out: OpenQuarantineEntry[] = [];
    for (const e of tree) {
      if (!e.path.startsWith(ENTRIES_PREFIX) || !e.path.endsWith(".json")) {
        continue;
      }
      const record = parseRecord(
        await getBlobText(
          this.deps.transport,
          this.deps.owner,
          this.deps.repo,
          e.blobSha,
          this.deps.baseURL,
        ),
      );
      if (record === null || record.status !== "open") continue;
      out.push({
        entryPath: e.path,
        repoKey: record.repoKey,
        path: record.path,
        ...(record.uid !== undefined ? { uid: record.uid } : {}),
        reason: record.reason,
        quarantinedAt: record.quarantinedAt,
      });
    }
    return out;
  }

  /** Cross-device unresolved-count (CQ4). */
  async unresolvedCount(): Promise<number> {
    return (await this.listOpen()).length;
  }

  private async entryPath(repoKey: string, path: string): Promise<string> {
    const hash = (
      await this.deps.sha1(new TextEncoder().encode(`${repoKey}\0${path}`))
    ).slice(0, 8);
    return `${ENTRIES_PREFIX}${slug(repoKey)}/${slug(path)}-${hash}.json`;
  }

  /** Head tree of the quarantine repo, or null when the branch is empty/absent. */
  private async headTree(): Promise<
    Array<{ path: string; blobSha: string }> | null
  > {
    const { transport, owner, repo, branch, baseURL } = this.deps;
    let head: string;
    try {
      head = await getHeadSha(transport, owner, repo, branch, baseURL);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP 404/.test(msg)) return null;
      throw err;
    }
    const commit = await getCommitInfo(transport, owner, repo, head, baseURL);
    return getTree(transport, owner, repo, commit.treeSha, baseURL);
  }

  private async readEntries(
    entryPaths: string[],
  ): Promise<Map<string, QuarantineEntryRecord | null>> {
    const out = new Map<string, QuarantineEntryRecord | null>();
    const tree = await this.headTreeOrThrowInitHint();
    const byPath = new Map(tree.map((e) => [e.path, e.blobSha]));
    for (const p of entryPaths) {
      const blobSha = byPath.get(p);
      if (blobSha === undefined) {
        out.set(p, null);
        continue;
      }
      out.set(
        p,
        parseRecord(
          await getBlobText(
            this.deps.transport,
            this.deps.owner,
            this.deps.repo,
            blobSha,
            this.deps.baseURL,
          ),
        ),
      );
    }
    return out;
  }

  /**
   * Writes need a base commit: `restCreateCommit` cannot create an initial
   * commit on an empty repo (GET ref 404s). Bootstrapping the quarantine
   * repo (one initial commit) is the mount layer's job — surface a clear
   * hint instead of a bare 404.
   */
  private async headTreeOrThrowInitHint(): Promise<
    Array<{ path: string; blobSha: string }>
  > {
    const tree = await this.headTree();
    if (tree === null) {
      throw new Error(
        `SyncedQuarantineStore: branch ${this.deps.branch} not found on ${this.deps.owner}/${this.deps.repo} — initialize the quarantine repo (one initial commit) before syncing`,
      );
    }
    return tree;
  }

  /** Push with direct 422 retries (fresh GET-ref per attempt — no CAS). */
  private async push(files: Map<string, string>, message: string): Promise<void> {
    const maxRetries = this.deps.maxPushRetries ?? 3;
    let attempt = 0;
    for (;;) {
      try {
        await restCreateCommit(this.deps.transport, {
          owner: this.deps.owner,
          repo: this.deps.repo,
          branch: this.deps.branch,
          files,
          message,
          ...(this.deps.baseURL !== undefined
            ? { baseURL: this.deps.baseURL }
            : {}),
          ...(this.deps.redact !== undefined
            ? { redact: this.deps.redact }
            : {}),
        });
        return;
      } catch (err) {
        attempt++;
        if (!isNonFastForwardError(err) || attempt > maxRetries) throw err;
        // Concurrent quarantine push from another device — entry files are
        // independent overwrites, so a plain retry (fresh ref) converges.
      }
    }
  }
}
