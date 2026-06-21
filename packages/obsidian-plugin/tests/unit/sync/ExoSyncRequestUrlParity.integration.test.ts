/**
 * ExoSync Phase B desktop-parity integration (RFC 4e4dc453, AC#3).
 *
 * Drives the REAL composition — `collectSyncRepoSpecs` → `buildSyncEngine`
 * (real `GitHubRestClient` over a mocked `requestUrl`) → `SyncEngine` — and
 * mirrors the engine-level scenarios of `SyncEngine.test.ts` through the
 * `requestUrl` transport layer: push, pull, structured merge, quarantine
 * (conflict-copy), durable quarantine repo, auth-required (R8).
 *
 * The remote is the same `FakeGitHubRepo` Git Data API state machine the
 * Phase A engine tests use (production message-shape contract), adapted at
 * the `requestUrl` level so the REAL `GitHubRestClient.request()` error path
 * (`GitHub request {M} {url} → HTTP {N}: {body}`) is exercised end-to-end.
 */

jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  requestUrl: jest.fn(),
}));

// jsdom lacks TextEncoder/TextDecoder — the engine's gitBlobSha needs them.
import { TextDecoder, TextEncoder } from "node:util";
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
}

import { requestUrl } from "obsidian";
import type { App } from "obsidian";
import {
  FakeGitHubRepo,
  sha1Hex,
} from "../../../../exocortex/tests/unit/services/sync/fakeGitHub";
import {
  buildSyncEngine,
  collectSyncRepoSpecs,
} from "../../../src/infrastructure/adapters/SyncDepsFactory";
import { PluginLocalDataStore } from "../../../src/infrastructure/adapters/PluginLocalDataStore";
import {
  InMemoryAdapter,
  assetSpaceFm,
  fakeRequestUrlRouter,
  makeApp,
} from "./syncTestHelpers";

const requestUrlMock = requestUrl as unknown as jest.Mock;

const OWNER = "test-owner";
const REPO = "test-repo";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const SOURCE = `https://github.com/${OWNER}/${REPO}`;
const QUARANTINE_URL = `https://github.com/${OWNER}/quarantine`;
const PAT = `ghp_${"x".repeat(36)}`;

const asset = (uid: string, label: string, extra?: string): string =>
  `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: ${label}\n${
    extra !== undefined ? `${extra}\n` : ""
  }---\n\nbody\n`;

interface Harness {
  repo: FakeGitHubRepo;
  quarantineRepo: FakeGitHubRepo;
  adapter: InMemoryAdapter;
  sync: () => Promise<
    Awaited<ReturnType<import("exocortex").SyncEngine["syncAll"]>>
  >;
}

async function makeHarness(opts: {
  initialFiles: Record<string, string>;
  withQuarantineRepo?: boolean;
}): Promise<Harness> {
  const repo = new FakeGitHubRepo(opts.initialFiles);
  const quarantineRepo = new FakeGitHubRepo({});
  requestUrlMock.mockImplementation(
    fakeRequestUrlRouter({
      [`${OWNER}/${REPO}`]: repo,
      [`${OWNER}/quarantine`]: quarantineRepo,
    }),
  );

  const adapter = new InMemoryAdapter();
  adapter.mkdirAll(`.obsidian/plugins/exocortex`);
  adapter.seedFile(
    `.obsidian/plugins/exocortex/data.local.json`,
    JSON.stringify({ pat: PAT }),
  );
  adapter.mkdirAll(MOUNT);
  for (const [path, content] of Object.entries(opts.initialFiles)) {
    adapter.seedFile(`${MOUNT}/${path}`, content);
  }

  const app = makeApp({
    adapter,
    mdFiles: [{ path: "as1.md" }],
    frontmatters: new Map([["as1.md", assetSpaceFm("as-uid-1", SOURCE)]]),
  }) as unknown as App;

  const localDataStore = new PluginLocalDataStore({ app });
  await localDataStore.init();

  const sync = async () => {
    const collection = await collectSyncRepoSpecs(app);
    const { engine, pat } = await buildSyncEngine({
      app,
      localDataStore,
      asUidByRepoKey: collection.asUidByRepoKey,
      sha1: sha1Hex,
      ...(opts.withQuarantineRepo === true
        ? { quarantineRepoUrl: QUARANTINE_URL }
        : {}),
    });
    expect(pat).toBe(PAT);
    return engine.syncAll(collection.specs);
  };

  return { repo, quarantineRepo, adapter, sync };
}

describe("ExoSync over requestUrl (desktop parity, AC#3)", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
  });

  it("bootstraps the watermark when disk equals the remote head", async () => {
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one") },
    });

    const results = await h.sync();

    expect(results).toHaveLength(1);
    expect(results[0].detail).toBeUndefined();
    expect(results[0].status).toBe("synced");
    expect(
      results[0].warnings.some((w) => w.includes("bootstrapped")),
    ).toBe(true);
  });

  it("pushes a local edit to the remote", async () => {
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one") },
    });
    await h.sync(); // bootstrap

    h.adapter.seedFile(`${MOUNT}/a.md`, asset("u1", "one-edited"));
    const results = await h.sync();

    expect(results[0].status).toBe("synced");
    expect(results[0].pushedCount).toBe(1);
    expect(results[0].pushedSha).toBeDefined();
    expect(h.repo.headFiles().get("a.md")).toContain("one-edited");
  });

  it("pulls a remote change to disk", async () => {
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one") },
    });
    await h.sync(); // bootstrap

    h.repo.commitDirect(
      "main",
      { "a.md": asset("u1", "one-remote") },
      "device B",
    );
    const results = await h.sync();

    expect(results[0].status).toBe("synced");
    expect(results[0].pulledCount).toBe(1);
    expect(await h.adapter.read(`${MOUNT}/a.md`)).toContain("one-remote");
  });

  it("merges divergent frontmatter keys from both sides (A2 parity)", async () => {
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one", "extra: base") },
    });
    await h.sync(); // bootstrap

    // Local edits the label; device B edits the `extra` key.
    h.adapter.seedFile(
      `${MOUNT}/a.md`,
      asset("u1", "one-local", "extra: base"),
    );
    h.repo.commitDirect(
      "main",
      { "a.md": asset("u1", "one", "extra: remote") },
      "device B",
    );
    const results = await h.sync();

    expect(results[0].status).toBe("synced");
    expect(results[0].mergedCount).toBe(1);
    const disk = await h.adapter.read(`${MOUNT}/a.md`);
    expect(disk).toContain("one-local");
    expect(disk).toContain("extra: remote");
    const remote = h.repo.headFiles().get("a.md");
    expect(remote).toContain("one-local");
    expect(remote).toContain("extra: remote");
  });

  it("quarantines an unresolvable conflict, leaving disk and remote intact", async () => {
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one") },
    });
    await h.sync(); // bootstrap

    // Both sides change the SAME key to different values — no clean 3-way.
    h.adapter.seedFile(`${MOUNT}/a.md`, asset("u1", "local-version"));
    h.repo.commitDirect(
      "main",
      { "a.md": asset("u1", "remote-version") },
      "device B",
    );
    const results = await h.sync();

    expect(results[0].status).toBe("synced");
    expect(results[0].quarantinedCount).toBe(1);
    // Conflict-copy semantics: nothing overwritten on either side.
    expect(await h.adapter.read(`${MOUNT}/a.md`)).toContain("local-version");
    expect(h.repo.headFiles().get("a.md")).toContain("remote-version");
  });

  it("captures the 3 versions in the device-local conflict cache even with NO quarantine repo (offline foundation)", async () => {
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one") },
      // NB: no withQuarantineRepo — the device-local cache must be wired anyway.
    });
    await h.sync(); // bootstrap

    h.adapter.seedFile(`${MOUNT}/a.md`, asset("u1", "local-version"));
    h.repo.commitDirect(
      "main",
      { "a.md": asset("u1", "remote-version") },
      "device B",
    );
    const results = await h.sync();
    expect(results[0].quarantinedCount).toBe(1);

    // The factory wired LocalConflictCacheStore unconditionally → the 3 versions
    // are on disk in the `.local.` (Sync-excluded) cache, ready for an offline
    // resolve. (Revert-verify: drop the cache wiring in buildSyncEngine and this
    // file never gets written → FAIL.)
    const cachePath = `.obsidian/plugins/exocortex/exosync-conflicts.local.json`;
    expect(await h.adapter.exists(cachePath)).toBe(true);
    const store = JSON.parse(await h.adapter.read(cachePath)) as {
      entries: Record<string, { localContent?: string; remoteContent?: string }>;
    };
    const records = Object.values(store.entries);
    expect(records).toHaveLength(1);
    expect(records[0].localContent).toContain("local-version");
    expect(records[0].remoteContent).toContain("remote-version");
  });

  it("persists both versions to the synced quarantine repo (D17)", async () => {
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one") },
      withQuarantineRepo: true,
    });
    await h.sync(); // bootstrap

    h.adapter.seedFile(`${MOUNT}/a.md`, asset("u1", "local-version"));
    h.repo.commitDirect(
      "main",
      { "a.md": asset("u1", "remote-version") },
      "device B",
    );
    const results = await h.sync();

    expect(results[0].quarantinedCount).toBe(1);
    const entries = [...h.quarantineRepo.headFiles().entries()].filter(
      ([path]) => path.startsWith("entries/"),
    );
    expect(entries).toHaveLength(1);
    const record = JSON.parse(entries[0][1]) as {
      status: string;
      localContent?: string;
      remoteContent?: string;
    };
    expect(record.status).toBe("open");
    expect(record.localContent).toContain("local-version");
    expect(record.remoteContent).toContain("remote-version");
  });

  it("maps HTTP 401 to auth-required, never success (R8 — desktop parity)", async () => {
    // Same scenario as the engine-level R8 test: every request rejects 401
    // from the very first sync. Through the REAL GitHubRestClient.request()
    // the non-2xx response becomes the production error message shape that
    // `isAuthError` consumes.
    const h = await makeHarness({
      initialFiles: { "a.md": asset("u1", "one") },
    });
    requestUrlMock.mockResolvedValue({
      status: 401,
      text: "Bad credentials",
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    });

    const results = await h.sync();

    expect(results[0].status).toBe("auth-required");
    expect(results[0].detail).toMatch(/PAT/);
  });
});
