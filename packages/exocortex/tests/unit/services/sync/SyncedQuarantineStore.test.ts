/**
 * ExoSync A3 — synced quarantine store (D17/CQ4) against the
 * production-shape FakeGitHubRepo (real blob SHAs, force:false 422).
 */

import {
  SyncedQuarantineStore,
  type QuarantineEntry,
  type QuarantineEntryRecord,
} from "../../../../src";
import { FakeGitHubRepo, sha1Hex } from "./fakeGitHub";

function makeStore(
  gh: FakeGitHubRepo,
  overrides: Partial<ConstructorParameters<typeof SyncedQuarantineStore>[0]> = {},
): { store: SyncedQuarantineStore; clock: { n: number } } {
  const clock = { n: 0 };
  const store = new SyncedQuarantineStore({
    transport: gh.transport(),
    sha1: sha1Hex,
    owner: gh.owner,
    repo: gh.repo,
    branch: gh.branch,
    now: () => `2026-06-10T00:00:0${clock.n++}`,
    ...overrides,
  });
  return { store, clock };
}

const ENTRY: QuarantineEntry = {
  repoKey: "o/canonical#main",
  path: "assets/a.md",
  uid: "u1",
  reason: "frontmatter key changed differently on both sides",
  baseContent: "base",
  localContent: "local",
  remoteContent: "remote",
};

function entryFiles(gh: FakeGitHubRepo): Map<string, QuarantineEntryRecord> {
  const out = new Map<string, QuarantineEntryRecord>();
  for (const [path, content] of gh.headFiles()) {
    if (path.startsWith("entries/") && path.endsWith(".json")) {
      out.set(path, JSON.parse(content) as QuarantineEntryRecord);
    }
  }
  return out;
}

describe("SyncedQuarantineStore — D17 durable synced entries", () => {
  it("commits one stable JSON entry per conflict (no UID, no .md — never RDF-indexed)", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);

    await store.quarantine(ENTRY);

    const entries = entryFiles(gh);
    expect(entries.size).toBe(1);
    const [path, record] = [...entries.entries()][0];
    expect(path).toMatch(/^entries\/o_canonical_main\/assets_a\.md-[0-9a-f]{8}\.json$/);
    expect(record).toMatchObject({
      version: 1,
      repoKey: ENTRY.repoKey,
      path: ENTRY.path,
      uid: "u1",
      reason: ENTRY.reason,
      status: "open",
      quarantinedAt: "2026-06-10T00:00:00",
      baseContent: "base",
      localContent: "local",
      remoteContent: "remote",
    });
    expect(gh.headFiles().get("README.md")).toBe("init"); // neighbours intact
  });

  it("binary entry (Phase C, D18): bytes land in a sibling .conflict.<ext> payload, record carries path+sha", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);
    const losingPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x7f]);

    await store.quarantine({
      repoKey: "o/files#main",
      path: "attachments/image.png",
      reason: "file-mode remote-wins (D18): losing LOCAL version",
      localContentBytes: losingPng,
    });

    const entries = entryFiles(gh);
    expect(entries.size).toBe(1);
    const [, record] = [...entries.entries()][0];
    // Single byte source (M4): no base64 inside the JSON record…
    expect(record.localContent).toBeUndefined();
    expect(record.conflictCopyPath).toMatch(
      /^entries\/o_files_main\/attachments_image\.png-[0-9a-f]{8}\.conflict\.png$/,
    );
    expect(typeof record.localContentSha).toBe("string");
    // …the payload file holds the loser byte-exact (user-openable).
    expect(gh.headBlob(record.conflictCopyPath!)).toEqual(
      Buffer.from(losingPng),
    );

    // Idempotency keys off the payload sha — identical bytes, zero churn.
    const before = gh.headSha();
    await store.quarantine({
      repoKey: "o/files#main",
      path: "attachments/image.png",
      reason: "file-mode remote-wins (D18): losing LOCAL version",
      localContentBytes: losingPng,
    });
    expect(gh.headSha()).toBe(before);

    // Changed bytes → record sha changes → payload re-pushed.
    const newerPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x80]);
    await store.quarantine({
      repoKey: "o/files#main",
      path: "attachments/image.png",
      reason: "file-mode remote-wins (D18): losing LOCAL version",
      localContentBytes: newerPng,
    });
    expect(gh.headSha()).not.toBe(before);
    const updated = [...entryFiles(gh).values()][0];
    expect(gh.headBlob(updated.conflictCopyPath!)).toEqual(
      Buffer.from(newerPng),
    );
  });

  it("is idempotent — re-quarantining an identical conflict produces ZERO new commits", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);

    await store.quarantine(ENTRY);
    const headAfterFirst = gh.headSha();
    await store.quarantine(ENTRY); // same conflict re-derives next sync
    await store.quarantine(ENTRY);

    expect(gh.headSha()).toBe(headAfterFirst); // no commit churn
    expect(await store.unresolvedCount()).toBe(1);
  });

  it("a changed conflict updates the entry but preserves the original quarantinedAt", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);

    await store.quarantine(ENTRY);
    await store.quarantine({ ...ENTRY, localContent: "local v2" });

    const [record] = [...entryFiles(gh).values()];
    expect(record.localContent).toBe("local v2");
    expect(record.quarantinedAt).toBe("2026-06-10T00:00:00"); // original kept
  });

  it("quarantineAll batches many entries into ONE commit", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);
    const before = gh.commits.size;

    await store.quarantineAll([
      ENTRY,
      { ...ENTRY, path: "assets/b.md", uid: "u2" },
      { ...ENTRY, repoKey: "o/other#main", path: "assets/c.md", uid: "u3" },
    ]);

    expect(gh.commits.size).toBe(before + 1); // single commit
    expect(entryFiles(gh).size).toBe(3);
    expect(await store.unresolvedCount()).toBe(3);
  });

  it("markResolved tombstones by overwrite; absent/resolved entries are no-ops", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);
    await store.quarantine(ENTRY);

    await store.markResolved(ENTRY.repoKey, ENTRY.path);

    const [record] = [...entryFiles(gh).values()];
    expect(record.status).toBe("resolved");
    expect(record.resolvedAt).toBe("2026-06-10T00:00:01");
    expect(await store.unresolvedCount()).toBe(0);

    const head = gh.headSha();
    await store.markResolved(ENTRY.repoKey, ENTRY.path); // already resolved
    await store.markResolved("o/none#main", "ghost.md"); // never existed
    expect(gh.headSha()).toBe(head); // both no-ops, zero commits
  });

  it("re-quarantining a RESOLVED entry reopens it with a fresh timestamp", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);
    await store.quarantine(ENTRY); // t0
    await store.markResolved(ENTRY.repoKey, ENTRY.path); // t1

    await store.quarantine(ENTRY); // new conflict event → t2

    const [record] = [...entryFiles(gh).values()];
    expect(record.status).toBe("open");
    expect(record.quarantinedAt).toBe("2026-06-10T00:00:02");
    expect(record.resolvedAt).toBeUndefined();
    expect(await store.unresolvedCount()).toBe(1);
  });

  it("redacts secrets inside conflict copies instead of dropping the entry", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);
    const pat = `ghp_${"a1B2".repeat(10)}`;

    await store.quarantine({ ...ENTRY, localContent: `token: ${pat}` });

    const [record] = [...entryFiles(gh).values()];
    expect(record.localContent).toBe("token: [REDACTED:github-token]");
    expect(JSON.stringify([...gh.blobs.values()])).not.toContain(pat);
  });

  it("retries a 422 concurrent-push race and converges (no CAS)", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh);
    let raced = false;
    gh.onBeforePatch = () => {
      if (!raced) {
        raced = true;
        gh.commitDirect(gh.branch, { "other-device.md": "concurrent" }, "device B");
      }
    };

    await store.quarantine(ENTRY);

    expect(entryFiles(gh).size).toBe(1);
    expect(gh.headFiles().get("other-device.md")).toBe("concurrent"); // both survive
  });

  it("missing branch → clear init hint on write, empty list on read", async () => {
    const gh = new FakeGitHubRepo({ "README.md": "init" });
    const { store } = makeStore(gh, { branch: "quarantine-branch-missing" });

    await expect(store.quarantine(ENTRY)).rejects.toThrow(
      /initialize the quarantine repo/,
    );
    expect(await store.listOpen()).toEqual([]);
    expect(await store.unresolvedCount()).toBe(0);
  });
});
