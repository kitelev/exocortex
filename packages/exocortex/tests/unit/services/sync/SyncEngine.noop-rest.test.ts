/**
 * ExoSync Phase 1 (perf) — no-op REST round-trip halving.
 *
 * After the mtime-manifest collapsed a no-op sync's LOCAL cost (read + SHA-1
 * of every file → a stat sweep), the next dominant per-sync cost on a 14-AS
 * iPhone vault is the REMOTE round-trips: every sync makes TWO sequential REST
 * calls per AS even when nothing changed —
 *   1. getCommitInfo(base) — D22 base-tree validation, and
 *   2. getHeadSha          — the push-loop's head check.
 * On a no-op steady-state sync the first is PROVABLY redundant: git commits are
 * content-addressed, so the commit at `watermark.lastSyncedSha` can never carry
 * a tree other than the recorded `rootTreeSha`. When the head ref STILL points
 * at lastSyncedSha the base commit is by definition reachable AND its tree is
 * necessarily rootTreeSha — getCommitInfo(base) cannot tell us anything new.
 * The engine therefore fetches the head ONCE, and when it equals lastSyncedSha
 * passes the recorded rootTreeSha straight through, skipping the round-trip:
 * 2 REST/AS → 1.
 *
 * ⛤ The zero-loss invariant is SACRED. These tests prove (a) the perf win
 * (no-op REST drops to a single getHeadSha — `integration-test-revert-verify`
 * against the manifest-off status quo), (b) the skip ONLY fires on the
 * head-unmoved path (a moved head re-runs the full getCommitInfo(base)
 * validation), (c) the periodic full-rehash valve performs the full base
 * validation even on a no-op (the zero-loss backstop for a corrupt watermark),
 * (d) OUTCOME parity (skip on/off produce identical detection), and (e) an
 * actual push always re-fetches the freshest head, so the 422 push race stays
 * resolved with zero loss.
 *
 * Production-shape (`test-fixture-realism`): the SAME `FakeGitHubRepo` (real
 * Git Data API route semantics + force:false fast-forward enforcement) and a
 * stat-tracking local port (writes bump mtime; stat reports live byte size)
 * the mtime-manifest suite uses, plus a recording transport that attributes
 * each REST round-trip to its Git Data API endpoint.
 */

import {
  SyncEngine,
  type LocalFilesPort,
  type LocalManifestRecord,
  type LocalManifestStorePort,
  type RestCommitRequest,
  type RestCommitTransport,
  type SyncEngineDeps,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

/**
 * Local port with real-filesystem semantics: a write bumps the file's mtime;
 * `stat` reports the live `(mtimeMs, size)`. (Identical contract to the
 * mtime-manifest suite's `StatLocalFiles` — the manifest cache requires it.)
 */
class StatLocalFiles implements LocalFilesPort {
  readonly files = new Map<string, string>();
  private readonly mtimes = new Map<string, number>();
  private clock = 1000;

  constructor(initial: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(initial)) {
      this.files.set(p, c);
      this.mtimes.set(p, ++this.clock);
    }
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async read(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`ENOENT: ${path}`);
    return c;
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.mtimes.set(path, ++this.clock);
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.mtimes.delete(path);
  }
  async stat(
    path: string,
  ): Promise<{ mtimeMs: number; size: number } | null> {
    const c = this.files.get(path);
    if (c === undefined) return null;
    return { mtimeMs: this.mtimes.get(path) ?? 0, size: Buffer.byteLength(c) };
  }

  userEdit(path: string, content: string): void {
    this.files.set(path, content);
    this.mtimes.set(path, ++this.clock);
  }
  addLocal(path: string, content: string): void {
    this.files.set(path, content);
    this.mtimes.set(path, ++this.clock);
  }
  removeLocal(path: string): void {
    this.files.delete(path);
    this.mtimes.delete(path);
  }
}

/** In-memory manifest store mirroring FileLocalManifestStore's contract. */
class MemManifestStore implements LocalManifestStorePort {
  readonly records = new Map<string, LocalManifestRecord>();
  async get(repoKey: string): Promise<LocalManifestRecord | null> {
    return this.records.get(repoKey) ?? null;
  }
  async set(repoKey: string, record: LocalManifestRecord): Promise<void> {
    this.records.set(repoKey, JSON.parse(JSON.stringify(record)));
  }
}

/**
 * Wrap a transport to record every REST round-trip's `(method, url)`. The Git
 * Data API endpoint is recoverable from the URL, so the test can assert
 * precisely which calls a sync made (e.g. that getCommitInfo(base) was
 * skipped).
 */
function recordingTransport(inner: RestCommitTransport): {
  transport: RestCommitTransport;
  requests: Array<{ method: string; url: string }>;
} {
  const requests: Array<{ method: string; url: string }> = [];
  const transport: RestCommitTransport = async (req: RestCommitRequest) => {
    requests.push({ method: req.method, url: req.url });
    return inner(req);
  };
  return { transport, requests };
}

/** GET git/commits/{sha} — the getCommitInfo round-trip (D22 base + remote head). */
function commitGets(reqs: Array<{ method: string; url: string }>): number {
  return reqs.filter((r) => r.method === "GET" && r.url.includes("/git/commits/"))
    .length;
}
/** GET git/refs/heads/{branch} — the getHeadSha round-trip. */
function headGets(reqs: Array<{ method: string; url: string }>): number {
  return reqs.filter(
    (r) => r.method === "GET" && r.url.includes("/git/refs/heads/"),
  ).length;
}

function makeEngine(
  transport: RestCommitTransport,
  local: LocalFilesPort,
  overrides: Partial<SyncEngineDeps> = {},
): SyncEngine {
  return new SyncEngine({
    transport,
    watermarkStore: new FakeWatermarkStore(),
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    now: () => 1_000_000, // fixed clock; default 12h rehash → no auto-rehash
    ...overrides,
  });
}

const A = "assets/a.md";
const B = "assets/b.md";
const C = "assets/c.md";

/**
 * Drive the engine to a WARM cache: sync 1 seeds the watermark, sync 2 (manifest
 * still empty ⇒ full re-hash) writes the manifest. The 3rd+ sync is the
 * steady-state under test.
 */
async function warmUp(engine: SyncEngine, gh: FakeGitHubRepo): Promise<void> {
  await engine.syncAll([gh.spec()], "sync");
  await engine.syncAll([gh.spec()], "sync");
}

describe("SyncEngine — no-op REST halving (perf, zero-loss)", () => {
  it("warm no-op sync makes ONE REST round-trip — getCommitInfo(base) skipped", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const { transport, requests } = recordingTransport(gh.transport());
    const engine = makeEngine(transport, local, {
      localManifestStore: new MemManifestStore(),
    });

    await warmUp(engine, gh);
    requests.length = 0; // record only the steady-state no-op sync
    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(0);
    expect(r.pulledCount).toBe(0);
    // The headline before/after signal: ONE REST round-trip, the getHeadSha —
    // the getCommitInfo(base) D22 validation is provably moot (head unmoved).
    expect(r.timings!.counts.restCalls).toBe(1);
    expect(headGets(requests)).toBe(1);
    expect(commitGets(requests)).toBe(0);
  });

  it("manifest OFF keeps the status-quo two REST round-trips (the 'before')", async () => {
    // integration-test-revert-verify pair for the test above: with NO manifest
    // store the optimisation is dormant, so a no-op still spends the full
    // getCommitInfo(base) + getHeadSha — exactly what the optimised path drops.
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const { transport, requests } = recordingTransport(gh.transport());
    const engine = makeEngine(transport, local); // no localManifestStore

    await engine.syncAll([gh.spec()], "sync"); // seed watermark
    requests.length = 0;
    const [r] = await engine.syncAll([gh.spec()], "sync"); // no-op

    expect(r.status).toBe("synced");
    expect(r.timings!.counts.restCalls).toBe(2);
    expect(headGets(requests)).toBe(1);
    expect(commitGets(requests)).toBe(1); // getCommitInfo(base) NOT skipped
  });

  it("a moved head re-runs the FULL getCommitInfo(base) validation and pulls", async () => {
    // Zero-loss: the skip fires ONLY when the head is unmoved. A remote change
    // moves the head, so the base validation is performed and the change pulled.
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const { transport, requests } = recordingTransport(gh.transport());
    const engine = makeEngine(transport, local, {
      localManifestStore: new MemManifestStore(),
    });

    await warmUp(engine, gh);
    gh.commitDirect(gh.branch, { [A]: mdAsset("u1", "device B") }, "device B");
    requests.length = 0;
    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pulledCount).toBe(1);
    expect(local.files.get(A)).toBe(mdAsset("u1", "device B"));
    // getCommitInfo(base) is NOT skipped when the head moved (≥1 commit GET:
    // the base validation; the remote-head fetch adds another).
    expect(commitGets(requests)).toBeGreaterThanOrEqual(1);
  });

  it("the periodic full re-hash valve runs the FULL base validation on a no-op (zero-loss backstop)", async () => {
    // The skip is gated on `!fullRehash`. Forcing a re-hash every sync (the same
    // valve that guards the mtime-preserving edit) ALSO restores the full
    // getCommitInfo(base) D22 validation — the backstop for a corrupt watermark
    // whose rootTreeSha drifted from files[] yet stayed JSON-parseable.
    const files = { [A]: mdAsset("u1") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const { transport, requests } = recordingTransport(gh.transport());
    const engine = makeEngine(transport, local, {
      localManifestStore: new MemManifestStore(),
      localManifestFullRehashMs: 0, // re-hash (and re-validate base) every sync
    });

    await warmUp(engine, gh);
    requests.length = 0;
    const [r] = await engine.syncAll([gh.spec()], "sync"); // no-op

    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(0);
    expect(commitGets(requests)).toBe(1); // base validated despite no-op
    expect(r.timings!.counts.restCalls).toBe(2);
  });

  it("OUTCOME parity: the REST skip ON vs OFF produce identical detection", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2"), [C]: mdAsset("u3") };
    const scenario = (local: StatLocalFiles, gh: FakeGitHubRepo): void => {
      local.userEdit(A, mdAsset("u1", "local edit")); // local modify → push
      local.addLocal("assets/d.md", mdAsset("u4")); // local add → push
      local.removeLocal(B); // local delete → push
      gh.commitDirect(gh.branch, { [C]: mdAsset("u3", "remote") }, "device B"); // remote → pull
    };

    // ON — skip active (manifest warm, default rehash interval).
    const ghOn = new FakeGitHubRepo(files);
    const localOn = new StatLocalFiles(files);
    const engOn = makeEngine(ghOn.transport(), localOn, {
      localManifestStore: new MemManifestStore(),
    });
    await warmUp(engOn, ghOn);
    scenario(localOn, ghOn);
    const [on] = await engOn.syncAll([ghOn.spec()], "sync");

    // OFF — skip dormant (manifest warm but full re-hash every sync ⇒ full D22).
    const ghOff = new FakeGitHubRepo(files);
    const localOff = new StatLocalFiles(files);
    const engOff = makeEngine(ghOff.transport(), localOff, {
      localManifestStore: new MemManifestStore(),
      localManifestFullRehashMs: 0,
    });
    await warmUp(engOff, ghOff);
    scenario(localOff, ghOff);
    const [off] = await engOff.syncAll([ghOff.spec()], "sync");

    // Identical OUTCOME — the skip changes only WHICH REST calls are made.
    expect(on.status).toBe(off.status);
    expect(on.pushedCount).toBe(off.pushedCount);
    expect(on.pulledCount).toBe(off.pulledCount);
    expect((on.pushedDeletes ?? []).sort()).toEqual(
      (off.pushedDeletes ?? []).sort(),
    );
    expect([...localOn.files.entries()].sort()).toEqual(
      [...localOff.files.entries()].sort(),
    );
    expect([...ghOn.headFiles().entries()].sort()).toEqual(
      [...ghOff.headFiles().entries()].sort(),
    );
  });

  it("a push with the skip active still succeeds (head unmoved, base skipped)", async () => {
    const files = { [A]: mdAsset("u1") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const { transport, requests } = recordingTransport(gh.transport());
    const engine = makeEngine(transport, local, {
      localManifestStore: new MemManifestStore(),
    });

    await warmUp(engine, gh);
    local.userEdit(A, mdAsset("u1", "local edit"));
    requests.length = 0;
    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(1);
    expect(gh.headFiles().get(A)).toBe(mdAsset("u1", "local edit"));
    // The push path is the fuller one (NOT the 1-REST no-op): it re-fetches the
    // head it pushes against rather than relying solely on the pre-fetched value
    // — the pre-fetch (1) plus the push loop's own head check + restCreateCommit.
    // (The base D22 skip is proven cleanly by the no-op test, where nothing
    // pushes so restCreateCommit never fetches the head commit.)
    expect(headGets(requests)).toBeGreaterThanOrEqual(2);
    expect(r.timings!.counts.restCalls).toBeGreaterThan(1);
  });

  it("ZERO-LOSS: a 422 push race is still resolved (the skip does not break the retry)", async () => {
    // The skip + head pre-fetch must not weaken the optimistic-push contract: a
    // concurrent disjoint remote commit landing between the engine's commit and
    // its PATCH must still 422 → re-pull → re-push, losing nothing.
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const engine = makeEngine(gh.transport(), local, {
      localManifestStore: new MemManifestStore(),
    });

    await warmUp(engine, gh);
    let injected = false;
    gh.onBeforePatch = (): void => {
      if (injected) return;
      injected = true;
      gh.commitDirect(gh.branch, { [B]: mdAsset("u2", "raced in") }, "device B");
    };
    local.userEdit(A, mdAsset("u1", "local edit"));
    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.warnings.join(" ")).toMatch(/non-fast-forward push \(attempt 1\/3\)/);
    // Both survive: the local edit pushed, the raced-in remote change pulled.
    expect(gh.headFiles().get(A)).toBe(mdAsset("u1", "local edit"));
    expect(gh.headFiles().get(B)).toBe(mdAsset("u2", "raced in"));
    expect(local.files.get(B)).toBe(mdAsset("u2", "raced in"));
  });

  it("pull-only sync with a moved head reuses the pre-fetched head (no double getHeadSha)", async () => {
    // A pull-only sync (remote change, nothing local to push) is safe to reuse
    // the pre-fetched head — it is non-destructive. The reuse avoids a second
    // getHeadSha in the push loop.
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const { transport, requests } = recordingTransport(gh.transport());
    const engine = makeEngine(transport, local, {
      localManifestStore: new MemManifestStore(),
    });

    await warmUp(engine, gh);
    gh.commitDirect(gh.branch, { [A]: mdAsset("u1", "remote only") }, "device B");
    requests.length = 0;
    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pulledCount).toBe(1);
    expect(local.files.get(A)).toBe(mdAsset("u1", "remote only"));
    // Head moved ⇒ getCommitInfo(base) runs (D22) AND collectRemoteChanges
    // fetches the head commit — but the push loop reuses the pre-fetched head
    // (nothing to push), so getHeadSha fires exactly once.
    expect(headGets(requests)).toBe(1);
  });
});
