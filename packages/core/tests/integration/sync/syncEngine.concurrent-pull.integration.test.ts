/**
 * ExoSync C (RFC 6a1a6518 Phase 2) — bounded-concurrency blob-fetch on pull,
 * end-to-end through the REAL SyncEngine over the production-shape
 * `FakeGitHubRepo` transport (NO network).
 *
 * This is the CI-reliable integration binding for req
 * a04c4fce-c77b-4754-a3eb-b074289173f3. It composes the real engine + its real
 * `collectRemoteChanges` pull path, driving a transport that (per test) delays
 * or fails individual `GET git/blobs/{sha}` calls. It proves the three
 * load-bearing halves of C:
 *   1. INDEXED WRITE-BACK — even when the blobs COMPLETE out of the `changed`
 *      order, the `changes[]` array handed to the order-sensitive consumer
 *      `matchLocalVsRemote` is in `changed` order (byte-identical to sequential);
 *   2. FAIL-FAST — one failing blob rejects the whole pull with ZERO partial
 *      apply (all files keep their pre-sync content);
 *   3. BOUNDED CONCURRENCY — peak in-flight blob fetches reach the cap on a big
 *      delta (real parallelism, deterministic) and the wall-clock is >=3x under
 *      the sequential lower bound (measured, CI-skipped via expectFasterThan).
 *
 * @req:a04c4fce-c77b-4754-a3eb-b074289173f3
 */

import { createHash } from "node:crypto";
import {
  SyncEngine,
  type RestCommitRequest,
  type RestCommitResponse,
  type RestCommitTransport,
  type SyncProgressEvent,
} from "../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "../../unit/services/sync/fakeGitHub";
import { expectFasterThan } from "../../helpers/perfAssert";

const REQ = "a04c4fce-c77b-4754-a3eb-b074289173f3";

/** Real git blob SHA over UTF-8 text — mirrors the fake, so a v2 asset's SHA
 *  can be mapped back to its `changed` index for index-tied fetch latency. */
function gitSha(content: string): string {
  const body = Buffer.from(content, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]))
    .digest("hex");
}

const path = (i: number): string => `assets/f${String(i).padStart(3, "0")}.md`;
/** N assets, version-tagged body so v1 and v2 have DISTINCT blob SHAs (edits
 *  of the SAME uid — no rename, no new asset). */
function nFiles(n: number, ver: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++)
    out[path(i)] = mdAsset(`u${i}`, `body-${ver}-${i}`);
  return out;
}

function makeEngine(
  transport: RestCommitTransport,
  wm: FakeWatermarkStore,
  local: FakeLocalFiles,
): SyncEngine {
  return new SyncEngine({
    transport,
    watermarkStore: wm,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
  });
}

/**
 * Build an N-file remote delta ready to PULL: local + remote both start at v1
 * (a first sync establishes the watermark, so the pull afterwards is a clean
 * N-file remote CHANGE), then the remote advances every file to v2.
 * Returns the shared stores + the raw fake transport for the caller to decorate.
 */
async function buildDelta(n: number): Promise<{
  gh: FakeGitHubRepo;
  local: FakeLocalFiles;
  wm: FakeWatermarkStore;
  inner: RestCommitTransport;
  v2: Record<string, string>;
}> {
  const v1 = nFiles(n, "v1");
  const gh = new FakeGitHubRepo(v1);
  const local = new FakeLocalFiles(v1);
  const wm = new FakeWatermarkStore();
  const inner = gh.transport();
  // Establish the watermark at v1 (local == remote → synced, no apply).
  const first = await makeEngine(inner, wm, local).sync(gh.spec());
  expect(first.status).toBe("synced");
  const v2 = nFiles(n, "v2");
  gh.commitDirect(gh.branch, v2, "bulk v2");
  return { gh, local, wm, inner, v2 };
}

const isBlobGet = (req: RestCommitRequest): RegExpExecArray | null =>
  req.method === "GET"
    ? /\/git\/blobs\/([^/?]+)/.exec(req.url.replace(/^https?:\/\/[^/]+/, ""))
    : null;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Capture the `remote` array (arg #3) handed to the private matchLocalVsRemote,
 *  running the REAL method unchanged — observation only. */
function captureRemote(engine: SyncEngine): {
  get: () => Array<{ path: string; kind: string }> | undefined;
} {
  const proto = Object.getPrototypeOf(engine) as Record<string, unknown>;
  const orig = proto.matchLocalVsRemote as (
    this: unknown,
    ...a: unknown[]
  ) => unknown;
  let captured: Array<{ path: string; kind: string }> | undefined;
  (engine as unknown as Record<string, unknown>).matchLocalVsRemote = function (
    this: unknown,
    ...args: unknown[]
  ) {
    captured = args[3] as Array<{ path: string; kind: string }>;
    return orig.apply(this, args);
  };
  return { get: () => captured };
}

describe("ExoSync C — bounded-concurrency blob-fetch on pull", () => {
  it(`@req:${REQ} indexed write-back keeps changes[] in \`changed\` order even when blobs complete out of order`, async () => {
    const N = 20;
    const { gh, local, wm, inner, v2 } = await buildDelta(N);

    // Index-tied REVERSE latency: f000 (idx 0) resolves LAST, f019 resolves
    // FIRST → completion order is the reverse of the `changed` order. A
    // completion-order push would surface as a reversed changes[]; indexed
    // write-back must not.
    const shaToIdx = new Map<string, number>();
    for (let i = 0; i < N; i++) shaToIdx.set(gitSha(v2[path(i)]), i);
    const UNIT = 3;
    const transport: RestCommitTransport = async (req) => {
      const m = isBlobGet(req);
      if (m) {
        const idx = shaToIdx.get(m[1]);
        if (idx !== undefined) await sleep((N - idx) * UNIT);
      }
      return inner(req);
    };

    const engine = makeEngine(transport, wm, local);
    const cap = captureRemote(engine);
    const res = await engine.sync(gh.spec());
    expect(res.status).toBe("synced");

    // The array handed to the order-sensitive consumer is in `changed` order.
    const changePaths = (cap.get() ?? [])
      .filter((r) => r.kind === "change")
      .map((r) => r.path);
    const expected = Array.from({ length: N }, (_, i) => path(i));
    expect(changePaths).toEqual(expected); // NOT the reverse completion order
    // …and the pull applied the same v2 content to disk (correctness).
    for (let i = 0; i < N; i++) {
      expect(local.files.get(path(i))).toBe(v2[path(i)]);
    }
  });

  it(`@req:${REQ} one failing blob fails-fast the whole pull with ZERO partial apply`, async () => {
    const N = 50;
    const { gh, local, wm, inner, v2 } = await buildDelta(N);
    const v1 = nFiles(N, "v1");

    // Exactly one blob fetch fails (a malformed / 404-shape response).
    const failSha = gitSha(v2[path(25)]);
    const transport: RestCommitTransport = async (req) => {
      const m = isBlobGet(req);
      if (m && m[1] === failSha) {
        throw new Error(`GitHub request GET ${req.url} → HTTP 404: Not Found`);
      }
      return inner(req);
    };

    const res = await makeEngine(transport, wm, local).sync(gh.spec());
    expect(res.status).not.toBe("synced"); // pull aborted (fail-fast)
    // ZERO partial apply — every file still holds its pre-sync v1 content.
    // (A per-blob swallow would apply the 49 non-failing v2 blobs → RED.)
    for (let i = 0; i < N; i++) {
      expect(local.files.get(path(i))).toBe(v1[path(i)]);
    }
  });

  it(`@req:${REQ} the fetch runs with bounded concurrency (peak reaches the cap, never exceeds it) and is >=3x faster than sequential`, async () => {
    const N = 50;
    const L = 15; // per-blob latency
    const { gh, local, wm, inner } = await buildDelta(N);

    let inFlight = 0;
    let maxInFlight = 0;
    const progress: SyncProgressEvent[] = [];
    const transport: RestCommitTransport = async (
      req,
    ): Promise<RestCommitResponse> => {
      if (isBlobGet(req)) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await sleep(L);
          return await inner(req);
        } finally {
          inFlight -= 1;
        }
      }
      return inner(req);
    };

    const engine = makeEngine(transport, wm, local);
    const t0 = Date.now();
    const res = await engine.sync(gh.spec(), "sync", (ev) => progress.push(ev));
    const elapsed = Date.now() - t0;

    expect(res.status).toBe("synced");
    // Real parallelism: peak in-flight reaches the cap (6). A sequential loop
    // caps at 1 → RED. And it never EXCEEDS the cap (bounded).
    expect(maxInFlight).toBeGreaterThanOrEqual(5);
    expect(maxInFlight).toBeLessThanOrEqual(6);
    // Wall-clock (CI-skipped, perf-flake rule): concurrent < sequential floor / 3.
    // Sequential would be >= N*L ms (each of 50 blobs awaited serially @15ms).
    expectFasterThan(elapsed, (N * L) / 3);

    // Visible progress: a growing `fetching-blobs done/total` tick.
    const ticks = progress.filter((e) => e.phase === "fetching-blobs");
    expect(ticks.length).toBeGreaterThan(0);
    const dones = ticks
      .map((e) => e.detail?.done)
      .filter((d): d is number => typeof d === "number");
    expect(dones).toContain(10); // BLOB_PROGRESS_STEP
    expect(Math.max(...dones)).toBeGreaterThan(Math.min(...dones)); // grows
  });
});
