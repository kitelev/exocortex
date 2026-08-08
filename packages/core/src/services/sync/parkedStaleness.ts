/**
 * Staleness of a PARKED AssetSpace (req 75dba148).
 *
 * A parked AssetSpace is **frozen at the moment it was parked**: its bytes stay
 * on the device under `.exocortex/parked/<owner>/<repo>`, but the derived mount
 * is gone, so sync-unit enumeration skips it by construction (req 4eca4900).
 * An active mount converges on every sync round; a parked one converges
 * **never** — and until this module nothing reported how far it had drifted.
 *
 * The verdict is deliberately three-valued. `unknown` is not a failure state to
 * be smoothed over: an empty or failed response is **not** evidence of freshness,
 * and reporting "current" for an unreachable remote would turn the indicator into
 * a weak verifier that can only ever look green.
 *
 * `current` is therefore reachable ONLY from the single branch where BOTH a
 * watermark was found AND the head read returned a SHA. That is a property of
 * the control flow — not a defensive `if` a later edit could invert.
 *
 * ## Cost
 * At most **one** `GET git/refs/heads/{branch}` per parked repo, and none at all
 * when the device has no watermark for it (nothing to compare against, so the
 * call would buy nothing). Callers drive this from an explicit probe, never from
 * a `metadataCache` event — an un-debounced whole-vault traversal on a cache
 * event is the documented cause of an indexing storm and iPhone Jetsam.
 *
 * ## Why a boolean fact and not "N commits behind"
 * `GET git/refs/heads/{branch}` returns the head SHA and nothing else — no date,
 * no distance. A commit distance would need a second, differently-priced call per
 * repo. The missing signal was "is this frozen copy still the remote's head?";
 * the distance is a separate decision with its own budget.
 */

import type { RestCommitTransport } from "../../infrastructure/github/restCommit";
import { getHeadSha } from "./githubRepoReader";
import type { SyncRepoSpec, WatermarkStorePort } from "./syncTypes";

/**
 * `behind` — the device copy is pinned to a commit that is no longer the remote
 * head. (A parked mount is read-only for ExoSync: it is never pushed from, so a
 * divergence can only mean the remote moved on without it.)
 *
 * `current` — the pinned commit IS the remote head.
 *
 * `unknown` — the question could not be answered: no watermark on this device,
 * or the remote could not be read. Never conflate with `current`.
 */
export type ParkedFreshness = "behind" | "current" | "unknown";

export interface ParkedStalenessVerdict {
  /** `owner/repo#branch` — the watermark key, stable across mount/park moves. */
  readonly repoKey: string;
  /** The DERIVED mount path the AssetSpace would occupy if it were active. */
  readonly localPath: string;
  readonly freshness: ParkedFreshness;
  /** The commit this device last synced, or `null` when it never synced it. */
  readonly lastSyncedSha: string | null;
  /** The remote head, or `null` when it was not read (or not readable). */
  readonly remoteHeadSha: string | null;
  /** Why the verdict is `unknown`. Absent for `behind` / `current`. */
  readonly reason?: string;
}

export interface ParkedStalenessDeps {
  readonly transport: RestCommitTransport;
  /** Read-only watermark access — this check never writes. */
  readonly watermarks: Pick<WatermarkStorePort, "get">;
  readonly baseURL?: string;
  /**
   * Strip secrets from transport error text before it lands in a report.
   * Defence in depth: the transport redacts its own messages, but a verdict
   * `reason` is printed and serialised into `--json` output too.
   */
  readonly redact?: (message: string) => string;
}

/**
 * Resolve ONE parked sync unit to a freshness verdict.
 *
 * Never throws: a transport failure is part of the answer (`unknown`), not an
 * abort — one unreachable repo must not hide the verdict of every other parked
 * repo in the same report.
 */
export async function checkParkedStaleness(
  spec: SyncRepoSpec,
  deps: ParkedStalenessDeps,
): Promise<ParkedStalenessVerdict> {
  const base = { repoKey: spec.repoKey, localPath: spec.localPath } as const;
  const redact = deps.redact ?? ((m: string): string => m);

  let lastSyncedSha: string | null = null;
  try {
    const record = await deps.watermarks.get(spec.repoKey);
    const sha = record?.lastSyncedSha ?? "";
    if (sha.length > 0) lastSyncedSha = sha;
  } catch (error) {
    return {
      ...base,
      freshness: "unknown",
      lastSyncedSha: null,
      remoteHeadSha: null,
      reason: `watermark unreadable: ${redact(errorText(error))}`,
    };
  }

  // No watermark ⇒ nothing to compare a head against, so the refs call is not
  // made at all. This is the cost cap's floor, not an optimisation: the verdict
  // would be `unknown` either way.
  if (lastSyncedSha === null) {
    return {
      ...base,
      freshness: "unknown",
      lastSyncedSha: null,
      remoteHeadSha: null,
      reason: "never synced on this device (no watermark)",
    };
  }

  let remoteHeadSha: string;
  try {
    remoteHeadSha = await getHeadSha(
      deps.transport,
      spec.owner,
      spec.repo,
      spec.branch,
      deps.baseURL,
    );
  } catch (error) {
    return {
      ...base,
      freshness: "unknown",
      lastSyncedSha,
      remoteHeadSha: null,
      reason: `remote unreachable: ${redact(errorText(error))}`,
    };
  }

  // The ONLY branch that can yield `current`: a watermark was found above AND
  // the head read succeeded.
  return {
    ...base,
    freshness: remoteHeadSha === lastSyncedSha ? "current" : "behind",
    lastSyncedSha,
    remoteHeadSha,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
