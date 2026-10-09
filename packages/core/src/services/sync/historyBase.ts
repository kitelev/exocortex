/**
 * ExoSync history base recovery — a missing 3-way base found in the remote
 * history of the path.
 *
 * The merge base of a conflict comes from the watermark (`watermark.files`).
 * When the path is absent there — a first sync without a usable mount base
 * (the synthetic R⊆L base excludes divergent files by construction), a mount
 * base older than the file, a split-run pin that carried the path's absence
 * forward, a copy delivered to disk outside the sync — the merge runs with
 * `base: undefined`, and every scalar that differs between the sides becomes
 * a conflict (`exo__Asset_updatedAt` always differs). A local copy that is
 * merely BEHIND the remote is then quarantined as if it had been edited.
 *
 * The base can be recovered: if the local content is byte-identical (same
 * git blob SHA) to the version of THIS path in a past commit of the remote
 * head's history, that version is the true merge base — the local copy
 * carries no edit since. Feeding it as `base` lets the ordinary 3-way merge
 * take the remote side.
 *
 * Fail-closed in every direction (M1 zero-loss): a blob that exists on the
 * remote but NOT in this path's history (e.g. orphaned by a rejected push of
 * a local edit) is not evidence; any request failure, an exhausted budget or
 * a walk past the version cap leaves the base undefined — the conflict
 * quarantines exactly as before.
 *
 * Cost is paid only on the no-base conflict path: one `git/blobs` existence
 * check (a real local edit was usually never pushed → stops here), then one
 * commit-list page and one `contents?ref=` per version, newest first.
 */

import type { RestCommitTransport } from "../../infrastructure/github/restCommit";
import type { Sha1Fn } from "./syncTypes";
import { gitBlobSha } from "./gitBlobSha";
import {
  getBlobText,
  getPathBlobShaAt,
  listPathCommitShas,
} from "./githubRepoReader";
import { isRateLimitError } from "./transportBackoff";

/** Versions of one path inspected at most (one commit-list page). */
export const HISTORY_BASE_MAX_VERSIONS = 30;

/** REST requests base recovery may spend per conflict-resolution pass. */
export const HISTORY_BASE_REQUEST_BUDGET = 60;

/**
 * Smallest per-conflict share of the pass budget: existence check + commit
 * list + the two newest versions — the common "one remote edit behind" case.
 */
export const HISTORY_BASE_MIN_SHARE = 4;

/** Mutable request budget (per conflict, carved from the per-pass total). */
export interface HistoryBaseBudget {
  remaining: number;
}

export interface HistoryBaseQuery {
  /**
   * Transport WITHOUT rate-limit backoff: the probe is optional work and must
   * never spend the sync's shared rate-limit wait budget that the push needs.
   */
  transport: RestCommitTransport;
  owner: string;
  repo: string;
  baseURL?: string;
  sha1: Sha1Fn;
  /** Repo-relative path (same on both sides). */
  path: string;
  /** The remote head the merge resolves against. */
  head: string;
  /** Local content of the path. */
  local: string;
  budget: HistoryBaseBudget;
}

export type HistoryBaseResult =
  /** Local = the path's version at `commitSha` → `base` (= local) recovered. */
  | { kind: "recovered"; base: string; commitSha: string }
  /** No evidence (local edit, foreign blob, request failure) — base stays undefined. */
  | { kind: "not-found" }
  /** The budget ran out before a verdict — base stays undefined. */
  | { kind: "budget-exhausted" }
  /** GitHub rate-limited a probe — base stays undefined, the caller stops probing. */
  | { kind: "rate-limited" };

export async function recoverBaseFromHistory(
  q: HistoryBaseQuery,
): Promise<HistoryBaseResult> {
  const spend = (): boolean => {
    if (q.budget.remaining <= 0) return false;
    q.budget.remaining -= 1;
    return true;
  };
  const localSha = await gitBlobSha(q.local, q.sha1);

  if (!spend()) return { kind: "budget-exhausted" };
  try {
    await getBlobText(q.transport, q.owner, q.repo, localSha, q.baseURL);
  } catch (err) {
    if (isRateLimitError(err)) return { kind: "rate-limited" };
    // Never on the remote (the usual real local edit) or unreadable.
    return { kind: "not-found" };
  }

  if (!spend()) return { kind: "budget-exhausted" };
  let commits: string[];
  try {
    commits = await listPathCommitShas(
      q.transport,
      q.owner,
      q.repo,
      q.path,
      q.head,
      HISTORY_BASE_MAX_VERSIONS,
      q.baseURL,
    );
  } catch (err) {
    if (isRateLimitError(err)) return { kind: "rate-limited" };
    return { kind: "not-found" };
  }

  for (const commitSha of commits.slice(0, HISTORY_BASE_MAX_VERSIONS)) {
    if (!spend()) return { kind: "budget-exhausted" };
    let blobSha: string;
    try {
      blobSha = await getPathBlobShaAt(
        q.transport,
        q.owner,
        q.repo,
        q.path,
        commitSha,
        q.baseURL,
      );
    } catch (err) {
      if (isRateLimitError(err)) return { kind: "rate-limited" };
      continue; // e.g. the commit that deleted the path — no version there
    }
    if (blobSha === localSha) {
      return { kind: "recovered", base: q.local, commitSha };
    }
  }
  return { kind: "not-found" };
}
