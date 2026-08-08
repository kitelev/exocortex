/**
 * Staleness of a PARKED AssetSpace (req 75dba148).
 *
 * The two seams the production code depends on — the watermark store and the
 * REST transport — are injected, so BOTH the failure branch and the call budget
 * are directly observable here. That is what this suite locks:
 *
 *  - the verdict is derived from `lastSyncedSha` vs the remote head, and the
 *    head is read with a **refs** call (never a tree/blob download);
 *  - `current` is reachable ONLY when a watermark exists AND the head read
 *    succeeded — an unreachable remote must report `unknown`, never `current`;
 *  - the cost cap: at most ONE refs call per repo, and ZERO when there is no
 *    watermark to compare against.
 *
 * The transport fake records every request, so "exactly one refs call" is an
 * assertion over observed traffic rather than a claim about the code's shape.
 */

import {
  checkParkedStaleness,
  type ParkedStalenessDeps,
  type RestCommitTransport,
  type SyncRepoSpec,
  type WatermarkRecord,
} from "../../../../src";

const OWNER = "test-owner";
const REPO = "exoas-parked";
const BRANCH = "main";

const SPEC: SyncRepoSpec = {
  owner: OWNER,
  repo: REPO,
  branch: BRANCH,
  repoKey: `${OWNER}/${REPO}#${BRANCH}`,
  localPath: `assetspaces/${OWNER}/${REPO}`,
};

const SYNCED_SHA = "a".repeat(40);
const MOVED_SHA = "b".repeat(40);

function watermark(lastSyncedSha: string): WatermarkRecord {
  return { lastSyncedSha, rootTreeSha: "c".repeat(40), files: [] };
}

interface Recorded {
  transport: RestCommitTransport;
  requests: string[];
}

/** Transport fake that answers ONLY `GET git/refs/heads/*` and logs traffic. */
function refsTransport(headSha: string | Error): Recorded {
  const requests: string[] = [];
  const transport: RestCommitTransport = async (req) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && /\/git\/refs\/heads\//.test(req.url)) {
      if (headSha instanceof Error) throw headSha;
      return { status: 200, json: { object: { sha: headSha } } };
    }
    throw new Error(`unexpected request: ${req.method} ${req.url}`);
  };
  return { transport, requests };
}

function deps(
  recorded: Recorded,
  record: WatermarkRecord | null,
  over: Partial<ParkedStalenessDeps> = {},
): ParkedStalenessDeps {
  return {
    transport: recorded.transport,
    watermarks: { get: async () => record },
    ...over,
  };
}

describe("checkParkedStaleness @req:75dba148-15c4-401e-a7b5-be2392557c58", () => {
  it("reports BEHIND with both SHAs when the remote moved on, using exactly one refs call", async () => {
    const recorded = refsTransport(MOVED_SHA);

    const verdict = await checkParkedStaleness(
      SPEC,
      deps(recorded, watermark(SYNCED_SHA)),
    );

    expect(verdict.freshness).toBe("behind");
    expect(verdict.lastSyncedSha).toBe(SYNCED_SHA);
    expect(verdict.remoteHeadSha).toBe(MOVED_SHA);
    expect(verdict.repoKey).toBe(SPEC.repoKey);

    // Cost cap: ONE call, and it is the refs primitive — not a tree walk or a
    // blob download. Asserting the URL shape is what makes "not a full download"
    // observable rather than assumed.
    expect(recorded.requests).toHaveLength(1);
    expect(recorded.requests[0]).toBe(
      `GET https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`,
    );
  });

  it("reports current when the parked copy still is the remote head", async () => {
    const recorded = refsTransport(SYNCED_SHA);

    const verdict = await checkParkedStaleness(
      SPEC,
      deps(recorded, watermark(SYNCED_SHA)),
    );

    expect(verdict.freshness).toBe("current");
    expect(verdict.remoteHeadSha).toBe(SYNCED_SHA);
    expect(recorded.requests).toHaveLength(1);
  });

  it("canary — an unreachable remote reports unknown, NEVER current", async () => {
    const recorded = refsTransport(new Error("getaddrinfo ENOTFOUND api.github.com"));

    const verdict = await checkParkedStaleness(
      SPEC,
      deps(recorded, watermark(SYNCED_SHA)),
    );

    // Both halves matter: an empty/failed response is not evidence of freshness,
    // so the indicator must not be able to look green when it learned nothing.
    expect(verdict.freshness).toBe("unknown");
    expect(verdict.freshness).not.toBe("current");
    expect(verdict.remoteHeadSha).toBeNull();
    expect(verdict.lastSyncedSha).toBe(SYNCED_SHA); // what we DO know is kept
    expect(verdict.reason).toMatch(/remote unreachable/);
    expect(recorded.requests).toHaveLength(1); // it tried once, and only once
  });

  it("reports unknown WITHOUT any refs call when the device never synced the repo", async () => {
    const recorded = refsTransport(SYNCED_SHA);

    const verdict = await checkParkedStaleness(SPEC, deps(recorded, null));

    expect(verdict.freshness).toBe("unknown");
    expect(verdict.lastSyncedSha).toBeNull();
    expect(verdict.reason).toMatch(/never synced/);
    // The floor of the cost cap: with nothing to compare against, the call is
    // not worth making — the verdict would be `unknown` either way.
    expect(recorded.requests).toEqual([]);
  });

  it("redacts transport error text before it reaches the report", async () => {
    const secret = "ghp_" + "S".repeat(36);
    const recorded = refsTransport(new Error(`HTTP 401 for token ${secret}`));

    const verdict = await checkParkedStaleness(
      SPEC,
      deps(recorded, watermark(SYNCED_SHA), {
        redact: (m) => m.replace(secret, "***"),
      }),
    );

    expect(verdict.freshness).toBe("unknown");
    expect(verdict.reason).not.toContain(secret);
    expect(verdict.reason).toContain("***");
  });

  it("treats an unreadable watermark store as unknown rather than throwing", async () => {
    const recorded = refsTransport(SYNCED_SHA);

    const verdict = await checkParkedStaleness(SPEC, {
      transport: recorded.transport,
      watermarks: {
        get: async () => {
          throw new Error("watermark file is corrupt");
        },
      },
    });

    // One unreadable repo must not abort the verdict of every other parked repo
    // sharing the same report.
    expect(verdict.freshness).toBe("unknown");
    expect(verdict.reason).toMatch(/watermark unreadable/);
    expect(recorded.requests).toEqual([]);
  });
});
