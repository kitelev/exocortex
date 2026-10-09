/**
 * ExoSync — a missing 3-way base recovered from the remote history of the
 * path (ems__Bug 1e2f9630, historyBase.ts).
 *
 * Production shape (measured 2026-10-10 on 17 vaults, 30 no-base conflict
 * cache entries): the local copy of a registry descriptor equals an EARLIER
 * remote version (created 11.09, edited 12.09: `exo__Asset_updatedAt` +
 * `dependsOn`), the path is absent from the merge base, and the real
 * StructuredMerger declares `exo__Asset_updatedAt` "changed differently on
 * both sides" → quarantine of a copy that was merely behind. 27 of 30 such
 * entries had their local copy in the remote history of the path.
 *
 * Every axis drives the REAL `SyncEngine.sync()` + the REAL
 * GatedStructuredMerger over the production-shape FakeGitHubRepo.
 */

import { createHash } from "node:crypto";
import * as yaml from "js-yaml";
import {
  GatedStructuredMerger,
  InMemoryQuarantineStore,
  StructuredMerger,
  SyncEngine,
  type RestCommitRequest,
  type RestCommitTransport,
  type SyncEngineDeps,
  type YamlCodec,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeMountBaseStore,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

const DESC = "registry/3c2fb27e-12a2-4793-a5dd-7a72c6e41def.md";
const OTHER = "registry/01dc96d9-2137-48d5-bea9-aebbd74ee751.md";

/** A registry descriptor as it looks in exoas-registry (scalar updatedAt + list dependsOn). */
function descriptor(
  updatedAt: string,
  dependsOn: string[],
  body = "Дескриптор.",
): string {
  return [
    "---",
    "exo__Asset_uid: 3c2fb27e-12a2-4793-a5dd-7a72c6e41def",
    'exo__Asset_label: "kitelev/exoas-lit"',
    "exo__Asset_createdAt: 2026-09-11T19:25:42",
    `exo__Asset_updatedAt: ${updatedAt}`,
    "exo__AssetSpace_dependsOn:",
    ...dependsOn.map((d) => `  - "[[${d}]]"`),
    "---",
    "",
    body,
    "",
  ].join("\n");
}

const V1 = descriptor("2026-09-11T19:25:42", [
  "aaaaaaaa-0000-4000-8000-000000000001",
]);
const V2 = descriptor("2026-09-12T15:24:18", [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "bbbbbbbb-0000-4000-8000-000000000002",
]);
const V3 = descriptor("2026-09-13T09:00:00", [
  "bbbbbbbb-0000-4000-8000-000000000002",
]);

/** Records every request so axes can assert what the recovery spent. */
function recording(inner: RestCommitTransport): {
  transport: RestCommitTransport;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    transport: async (req: RestCommitRequest) => {
      urls.push(`${req.method} ${req.url}`);
      return inner(req);
    },
  };
}

function makeEngine(
  transport: RestCommitTransport,
  local: FakeLocalFiles,
  overrides: Partial<SyncEngineDeps> = {},
): {
  engine: SyncEngine;
  watermarks: FakeWatermarkStore;
  store: InMemoryQuarantineStore;
} {
  const watermarks = new FakeWatermarkStore();
  const store = new InMemoryQuarantineStore();
  const engine = new SyncEngine({
    transport,
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    mergeLayer: new GatedStructuredMerger(new StructuredMerger(codec)),
    quarantine: store,
    // The REST/tarball/bot shape: no recorded mount base, no submodule HEAD.
    mountBaseStore: new FakeMountBaseStore(),
    localBaseShaProvider: async () => null,
    ...overrides,
  });
  return { engine, watermarks, store };
}

describe("SyncEngine — no-base conflict: base recovered from the remote history of the path (ems__Bug 1e2f9630)", () => {
  it("H1 first sync, local copy = an earlier remote version → remote wins, nothing quarantined (revert-verify target)", async () => {
    const gh = new FakeGitHubRepo({ [DESC]: V1 });
    gh.commitDirect(gh.branch, { [DESC]: V2 }, "feat(registry): dependsOn");
    const local = new FakeLocalFiles({ [DESC]: V1 });
    const { engine, store } = makeEngine(gh.transport(), local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0);
    expect(store.entries).toHaveLength(0);
    // The stale local copy is replaced by the remote version, nothing pushed.
    expect(local.files.get(DESC)).toBe(V2);
    expect(result.pushedCount).toBe(0);
    expect(gh.headFiles().get(DESC)).toBe(V2);
    expect(result.warnings.join("\n")).toMatch(
      /no 3-way base recorded — the local copy matches the remote version at [0-9a-f]{7}, treated as behind and used as the base/,
    );
  });

  it("H2 steady state, path absent from the watermark (copy delivered outside the sync, remote then edited) → remote wins, watermark records it unpinned", async () => {
    const gh = new FakeGitHubRepo({ [OTHER]: mdAsset("other") });
    const local = new FakeLocalFiles({ [OTHER]: mdAsset("other") });
    const { engine, watermarks, store } = makeEngine(gh.transport(), local);
    expect((await engine.sync(gh.spec())).status).toBe("synced"); // watermark without DESC

    gh.commitDirect(gh.branch, { [DESC]: V1 }, "feat(registry): descriptor");
    local.files.set(DESC, V1); // the copy arrived on disk without a sync
    gh.commitDirect(gh.branch, { [DESC]: V2 }, "feat(registry): dependsOn");

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0);
    expect(store.entries).toHaveLength(0);
    expect(local.files.get(DESC)).toBe(V2);
    const wm = watermarks.records.get(gh.spec().repoKey)!;
    expect(wm.pinnedPaths ?? []).not.toContain(DESC);
    expect(wm.files.find((f) => f.path === DESC)).toBeDefined();
  });

  it("H3 control: a REAL local edit (content never on the remote) still quarantines both versions — and costs one existence check, no history walk", async () => {
    const gh = new FakeGitHubRepo({ [DESC]: V1 });
    gh.commitDirect(gh.branch, { [DESC]: V2 }, "feat(registry): dependsOn");
    const localEdit = descriptor("2026-09-12T16:00:00", [
      "cccccccc-0000-4000-8000-000000000003",
    ]);
    const local = new FakeLocalFiles({ [DESC]: localEdit });
    const rec = recording(gh.transport());
    const { engine, store } = makeEngine(rec.transport, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({
      path: DESC,
      localContent: localEdit,
      remoteContent: V2,
    });
    expect(store.entries[0].baseContent).toBeUndefined();
    expect(local.files.get(DESC)).toBe(localEdit); // never overwritten
    expect(rec.urls.some((u) => u.includes("/commits?"))).toBe(false);
    expect(rec.urls.some((u) => u.includes("/contents/"))).toBe(false);
  });

  it("H4 safety: the local blob EXISTS on the remote but in NO commit of the path (orphaned by a rejected push) → not evidence, quarantine", async () => {
    const gh = new FakeGitHubRepo({ [DESC]: V1 });
    gh.commitDirect(gh.branch, { [DESC]: V2 }, "feat(registry): dependsOn");
    const localEdit = descriptor("2026-09-12T16:00:00", [
      "dddddddd-0000-4000-8000-000000000004",
    ]);
    // A push of this local edit uploaded the blob, then lost the race (422):
    // the object is on the remote, the history of the path never had it.
    const localSha = await (async () => {
      const body = Buffer.from(localEdit, "utf-8");
      const sha = await sha1Hex(
        new Uint8Array(
          Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]),
        ),
      );
      gh.blobs.set(sha, body);
      return sha;
    })();
    expect(localSha).toMatch(/^[0-9a-f]{40}$/);
    const local = new FakeLocalFiles({ [DESC]: localEdit });
    const { engine, store } = makeEngine(gh.transport(), local);

    const result = await engine.sync(gh.spec());

    expect(result.quarantinedCount).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(local.files.get(DESC)).toBe(localEdit);
    expect(gh.headFiles().get(DESC)).toBe(V2);
  });

  it("H5 budget: an exhausted per-pass request budget leaves the base undefined (quarantine) and says so; `0` disables the recovery", async () => {
    for (const budget of [1, 0]) {
      const gh = new FakeGitHubRepo({ [DESC]: V1 });
      gh.commitDirect(gh.branch, { [DESC]: V2 }, "feat(registry): dependsOn");
      const local = new FakeLocalFiles({ [DESC]: V1 });
      const rec = recording(gh.transport());
      const { engine, store } = makeEngine(rec.transport, local, {
        historyBaseRequestBudget: budget,
      });

      const result = await engine.sync(gh.spec());

      expect(result.quarantinedCount).toBe(1);
      expect(store.entries).toHaveLength(1);
      expect(local.files.get(DESC)).toBe(V1);
      expect(rec.urls.some((u) => u.includes("/commits?"))).toBe(false);
      if (budget === 1) {
        expect(result.warnings.join("\n")).toMatch(
          /history base recovery: 1 no-base conflict\(s\) not fully checked this pass \(request budget\)/,
        );
      }
    }
  });

  it("H6 a failing history request never fails the sync — the conflict quarantines as before", async () => {
    const gh = new FakeGitHubRepo({ [DESC]: V1 });
    gh.commitDirect(gh.branch, { [DESC]: V2 }, "feat(registry): dependsOn");
    const local = new FakeLocalFiles({ [DESC]: V1 });
    const inner = gh.transport();
    const failing: RestCommitTransport = async (req) => {
      if (req.url.includes("/commits?")) {
        throw new Error(
          `GitHub request GET ${req.url} → HTTP 502: Bad Gateway`,
        );
      }
      return inner(req);
    };
    const { engine, store } = makeEngine(failing, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(local.files.get(DESC)).toBe(V1);
  });

  it("H7 the matching version may be DEEPER in the history (behind by several remote edits) → still recovered", async () => {
    const gh = new FakeGitHubRepo({ [DESC]: V1 });
    gh.commitDirect(gh.branch, { [DESC]: V2 }, "feat(registry): dependsOn");
    gh.commitDirect(gh.branch, { [OTHER]: mdAsset("other") }, "unrelated");
    gh.commitDirect(
      gh.branch,
      { [DESC]: V3 },
      "feat(registry): dependsOn again",
    );
    const local = new FakeLocalFiles({ [DESC]: V1, [OTHER]: mdAsset("other") });
    const { engine, store } = makeEngine(gh.transport(), local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0);
    expect(store.entries).toHaveLength(0);
    expect(local.files.get(DESC)).toBe(V3);
  });

  it("H8 a remote RENAME (same uid, other path) is never recovered at the old path — quarantine, the local file untouched", async () => {
    const A = "assets/a.md";
    const B = "assets/b.md";
    const old = labelled("u-ren", "old title");
    const renamed = labelled("u-ren", "new title");
    const gh = new FakeGitHubRepo({ [A]: old });
    gh.commitDirect(gh.branch, { [B]: renamed }, "rename a → b with an edit", [
      A,
    ]);
    const local = new FakeLocalFiles({ [A]: old });
    const { engine, store } = makeEngine(gh.transport(), local);

    const result = await engine.sync(gh.spec());

    expect(result.quarantinedCount).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(local.files.get(A)).toBe(old); // never overwritten with b's content
    expect(gh.headFiles().get(B)).toBe(renamed);
  });

  it("H9 a version is found PAST a commit that deleted the path (added → deleted → re-added)", async () => {
    const gh = new FakeGitHubRepo({ [DESC]: V1 });
    gh.commitDirect(gh.branch, {}, "delete", [DESC]);
    gh.commitDirect(gh.branch, { [DESC]: V3 }, "re-add");
    const local = new FakeLocalFiles({ [DESC]: V1 });
    const { engine, store } = makeEngine(gh.transport(), local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0);
    expect(store.entries).toHaveLength(0);
    expect(local.files.get(DESC)).toBe(V3);
  });

  it("H10 a RATE-LIMITED probe gives up at once: no backoff wait, no further probes this pass, the push still lands", async () => {
    const P1 = "assets/p1.md";
    const P2 = "assets/p2.md";
    const NEW = "assets/new.md";
    const gh = new FakeGitHubRepo({
      [P1]: labelled("u1", "v1"),
      [P2]: labelled("u2", "v1"),
    });
    gh.commitDirect(
      gh.branch,
      { [P1]: labelled("u1", "v2"), [P2]: labelled("u2", "v2") },
      "edit both",
    );
    const local = new FakeLocalFiles({
      [P1]: labelled("u1", "v1"),
      [P2]: labelled("u2", "v1"),
      [NEW]: labelled("u3", "local only"),
    });
    const inner = gh.transport();
    let commitLists = 0;
    const limited: RestCommitTransport = async (req) => {
      if (req.url.includes("/commits?")) {
        commitLists++;
        throw new Error(
          `GitHub request GET ${req.url} → HTTP 429: You have exceeded a secondary rate limit`,
        );
      }
      return inner(req);
    };
    const sleeps: number[] = [];
    const { engine, store } = makeEngine(limited, local, {
      backoff: {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(sleeps).toEqual([]); // the optional probe never waited
    expect(commitLists).toBe(1); // the second conflict was not probed
    expect(result.quarantinedCount).toBe(2);
    expect(store.entries).toHaveLength(2);
    expect(gh.headFiles().get(NEW)).toBe(labelled("u3", "local only"));
    expect(result.warnings.join("\n")).toMatch(
      /history base recovery: 2 no-base conflict\(s\) not fully checked this pass \(GitHub rate limit\)/,
    );
  });

  it("H11 FAIR SHARES: two expensive unrecoverable conflicts first do not starve the cheap phantoms after them", async () => {
    const files: Record<string, string> = {};
    const local: Record<string, string> = {};
    const orphans: string[] = [];
    for (const d of ["assets/a-deep-1.md", "assets/a-deep-2.md"]) {
      const uid = `u-${d}`;
      files[d] = labelled(uid, "v0");
      const edit = labelled(uid, "local edit");
      local[d] = edit;
      orphans.push(edit);
    }
    const phantoms = [
      "assets/z-ph-1.md",
      "assets/z-ph-2.md",
      "assets/z-ph-3.md",
    ];
    for (const p of phantoms) {
      files[p] = labelled(`u-${p}`, "v1");
      local[p] = labelled(`u-${p}`, "v1");
    }
    const gh = new FakeGitHubRepo(files);
    // 31 more versions of each deep path — past the 30-version cap.
    for (let i = 1; i <= 31; i++) {
      gh.commitDirect(
        gh.branch,
        {
          "assets/a-deep-1.md": labelled("u-assets/a-deep-1.md", `v${i}`),
          "assets/a-deep-2.md": labelled("u-assets/a-deep-2.md", `v${i}`),
        },
        `deep v${i}`,
      );
    }
    const edits: Record<string, string> = {};
    for (const p of phantoms) edits[p] = labelled(`u-${p}`, "v2");
    gh.commitDirect(gh.branch, edits, "phantoms v2");
    // The deep local edits were uploaded by a rejected push: the blobs exist
    // remotely, but in no commit of their path — the walk finds nothing.
    for (const o of orphans) addOrphanBlob(gh, o);
    const fs = new FakeLocalFiles(local);
    const { engine, store } = makeEngine(gh.transport(), fs);

    const result = await engine.sync(gh.spec());

    for (const p of phantoms)
      expect(fs.files.get(p)).toBe(labelled(`u-${p}`, "v2"));
    expect(result.quarantinedCount).toBe(2);
    expect(store.entries.map((e) => e.path).sort()).toEqual([
      "assets/a-deep-1.md",
      "assets/a-deep-2.md",
    ]);
    expect(result.warnings.join("\n")).toMatch(
      /history base recovery: 2 no-base conflict\(s\) not fully checked this pass \(request budget\)/,
    );
  });

  it("H12 a conflict skipped because the pass budget is ALREADY spent is reported too (the budget-boundary case)", async () => {
    const phantoms = ["assets/p1.md", "assets/p2.md", "assets/p3.md"];
    const files: Record<string, string> = {};
    const edits: Record<string, string> = {};
    for (const p of phantoms) {
      files[p] = labelled(`u-${p}`, "v1");
      edits[p] = labelled(`u-${p}`, "v2");
    }
    const gh = new FakeGitHubRepo(files);
    gh.commitDirect(gh.branch, edits, "edit all");
    const fs = new FakeLocalFiles({ ...files });
    // Each phantom costs exactly 4 requests (blob, list, 2 versions): two fit.
    const { engine, store } = makeEngine(gh.transport(), fs, {
      historyBaseRequestBudget: 8,
    });

    const result = await engine.sync(gh.spec());

    expect(result.quarantinedCount).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(result.warnings.join("\n")).toMatch(
      /history base recovery: 1 no-base conflict\(s\) not fully checked this pass \(request budget\)/,
    );
  });
});

/** An asset whose label differs per version (a scalar both sides change). */
function labelled(uid: string, label: string): string {
  return `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: "${label}"\n---\n\nbody\n`;
}

/** Upload `content` as a blob that no commit references (a rejected push). */
function addOrphanBlob(gh: FakeGitHubRepo, content: string): void {
  const body = Buffer.from(content, "utf-8");
  const sha = createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]))
    .digest("hex");
  gh.blobs.set(sha, body);
}
