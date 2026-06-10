/**
 * ExoSync A1 integration test — SyncEngine against REAL GitHub
 * (RFC 4e4dc453, AC: "non-conflict цикл pull→push против реального GitHub").
 *
 * Talks to the dedicated sandbox repo `kitelev/exosync-test-sandbox` on a
 * disposable per-run branch (created in beforeAll, deleted in afterAll —
 * `main` is never touched). Auth: `EXOSYNC_TEST_TOKEN` env var or
 * `gh auth token`; when neither resolves the suite self-skips so CI and
 * unauthenticated environments stay green.
 *
 * NOT in the CI allowlist (scripts/test-ci-batched.sh) by design: it needs
 * network + a PAT with write access to the sandbox. Run manually:
 *
 *   node ./node_modules/jest/bin/jest.js --config packages/exocortex/jest.config.js \
 *     --testPathPatterns="integration/sync/" --forceExit
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import {
  SyncEngine,
  restCreateCommit,
  getHeadSha,
  getBlobText,
  getTree,
  getCommitInfo,
  type LocalFilesPort,
  type RestCommitTransport,
  type SyncRepoSpec,
  type WatermarkRecord,
  type WatermarkStorePort,
} from "../../../src";

const OWNER = "kitelev";
const REPO = "exosync-test-sandbox";
const SOURCE_BRANCH = "main";

function resolveToken(): string | null {
  if (process.env.EXOSYNC_TEST_TOKEN) return process.env.EXOSYNC_TEST_TOKEN;
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 15_000,
    }).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Same contract as the production transports (throw non-2xx, same message shape). */
function makeTransport(token: string): RestCommitTransport {
  return async (req) => {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "exosync-a1-integration-test",
      Authorization: `Bearer ${token}`,
    };
    if (req.contentType) headers["Content-Type"] = req.contentType;
    const resp = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await resp.text().catch(() => "");
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(
        `GitHub request ${req.method} ${req.url} → HTTP ${resp.status}: ${text.slice(0, 300)}`,
      );
    }
    return {
      status: resp.status,
      json: text.length > 0 ? JSON.parse(text) : undefined,
      text,
    };
  };
}

const sha1Hex = async (bytes: Uint8Array): Promise<string> =>
  createHash("sha1").update(bytes).digest("hex");

/** Real-filesystem LocalFilesPort rooted at a temp dir. */
class FsLocalFiles implements LocalFilesPort {
  constructor(private readonly root: string) {}
  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else out.push(relative(this.root, full).split("\\").join("/"));
      }
    };
    if (existsSync(this.root)) walk(this.root);
    return out;
  }
  async read(path: string): Promise<string> {
    return readFileSync(join(this.root, path), "utf8");
  }
  async write(path: string, content: string): Promise<void> {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  async delete(path: string): Promise<void> {
    const full = join(this.root, path);
    if (existsSync(full)) unlinkSync(full);
  }
}

class MemWatermarks implements WatermarkStorePort {
  readonly records = new Map<string, WatermarkRecord>();
  async get(key: string): Promise<WatermarkRecord | null> {
    return this.records.get(key) ?? null;
  }
  async set(key: string, record: WatermarkRecord): Promise<void> {
    this.records.set(key, record);
  }
}

function asset(uid: string, body: string): string {
  return `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: "Integration asset ${uid}"\n---\n\n${body}\n`;
}

const token = resolveToken();
const describeIfToken = token === null ? describe.skip : describe;

describeIfToken("SyncEngine — real GitHub integration (sandbox)", () => {
  jest.setTimeout(180_000);

  const transport = makeTransport(token ?? "");
  const branch = `a1-run-${Date.now()}`;
  const spec: SyncRepoSpec = {
    owner: OWNER,
    repo: REPO,
    branch,
    repoKey: `${OWNER}/${REPO}#${branch}`,
    localPath: "assetspaces/sandbox",
  };
  const FILE_A = "assets/integration-a.md";
  const FILE_B = "assets/integration-b.md";

  let tmpRoot: string;
  let local: FsLocalFiles;
  let watermarks: MemWatermarks;
  let engine: SyncEngine;

  beforeAll(async () => {
    // Disposable branch off main — the test NEVER touches main.
    const mainSha = await getHeadSha(transport, OWNER, REPO, SOURCE_BRANCH);
    await transport({
      method: "POST",
      url: `https://api.github.com/repos/${OWNER}/${REPO}/git/refs`,
      contentType: "application/json",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
    });

    // Seed the branch through the SAME production write primitive.
    await restCreateCommit(transport, {
      owner: OWNER,
      repo: REPO,
      branch,
      files: new Map([
        [FILE_A, asset("int-u1", "seed A")],
        [FILE_B, asset("int-u2", "seed B")],
      ]),
      message: "test(exosync-a1): seed integration branch",
    });

    // Materialize the FULL head tree locally (what a real mount produces) —
    // the branch also carries main's README.md etc.
    tmpRoot = mkdtempSync(join(tmpdir(), "exosync-a1-"));
    local = new FsLocalFiles(tmpRoot);
    const head = await getHeadSha(transport, OWNER, REPO, branch);
    const headTree = await getTree(
      transport,
      OWNER,
      REPO,
      (await getCommitInfo(transport, OWNER, REPO, head)).treeSha,
    );
    for (const entry of headTree) {
      if (!entry.path.endsWith(".md")) continue;
      await local.write(
        entry.path,
        await getBlobText(transport, OWNER, REPO, entry.blobSha),
      );
    }

    watermarks = new MemWatermarks();
    engine = new SyncEngine({
      transport,
      watermarkStore: watermarks,
      materializationCheck: { check: async () => ({ fullyMaterialized: true }) },
      localFilesFor: () => local,
      sha1: sha1Hex,
      commitMessage: (s, n) => `test(exosync-a1): sync ${n} file(s) [${s.repoKey}]`,
    });
  });

  afterAll(async () => {
    try {
      // Raw fetch: the RestCommitTransport contract is GET/POST/PATCH only.
      await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token ?? ""}`,
            "User-Agent": "exosync-a1-integration-test",
          },
        },
      );
    } catch {
      // best-effort cleanup; sandbox branches are disposable by convention
    }
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("bootstraps the watermark from a disk identical to the remote head", async () => {
    const result = await engine.sync(spec);
    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0);
    expect(watermarks.records.get(spec.repoKey)?.lastSyncedSha).toBe(
      await getHeadSha(transport, OWNER, REPO, branch),
    );
  });

  it("pushes a local edit — the commit lands on the real remote", async () => {
    const edited = asset("int-u1", "edited locally on device A");
    await local.write(FILE_A, edited);

    const result = await engine.sync(spec);

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    const head = await getHeadSha(transport, OWNER, REPO, branch);
    expect(head).toBe(result.pushedSha);
    const tree = await getTree(
      transport,
      OWNER,
      REPO,
      (await getCommitInfo(transport, OWNER, REPO, head)).treeSha,
    );
    const entry = tree.find((e) => e.path === FILE_A);
    expect(entry).toBeDefined();
    expect(await getBlobText(transport, OWNER, REPO, entry?.blobSha ?? "")).toBe(edited);
  });

  it("pull→push: applies a disjoint device-B change and pushes the local one", async () => {
    // Device B — direct production-primitive push of a DIFFERENT file.
    const deviceB = asset("int-u2", "device B edit");
    await restCreateCommit(transport, {
      owner: OWNER,
      repo: REPO,
      branch,
      files: new Map([[FILE_B, deviceB]]),
      message: "test(exosync-a1): device B disjoint edit",
    });

    const deviceA = asset("int-u1", "device A second edit");
    await local.write(FILE_A, deviceA);

    const result = await engine.sync(spec);

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(result.pulledCount).toBe(1);
    expect(await local.read(FILE_B)).toBe(deviceB); // pulled to disk
    const head = await getHeadSha(transport, OWNER, REPO, branch);
    const tree = await getTree(
      transport,
      OWNER,
      REPO,
      (await getCommitInfo(transport, OWNER, REPO, head)).treeSha,
    );
    const a = tree.find((e) => e.path === FILE_A);
    const b = tree.find((e) => e.path === FILE_B);
    expect(await getBlobText(transport, OWNER, REPO, a?.blobSha ?? "")).toBe(deviceA);
    expect(await getBlobText(transport, OWNER, REPO, b?.blobSha ?? "")).toBe(deviceB);
  });

  it("conflict: overlapping edits → nothing pushed, nothing overwritten", async () => {
    const remoteEdit = asset("int-u1", "device B CONFLICTING edit");
    await restCreateCommit(transport, {
      owner: OWNER,
      repo: REPO,
      branch,
      files: new Map([[FILE_A, remoteEdit]]),
      message: "test(exosync-a1): device B conflicting edit",
    });
    const headBefore = await getHeadSha(transport, OWNER, REPO, branch);

    const localEdit = asset("int-u1", "device A CONFLICTING edit");
    await local.write(FILE_A, localEdit);

    const result = await engine.sync(spec);

    expect(result.status).toBe("conflict");
    expect(await getHeadSha(transport, OWNER, REPO, branch)).toBe(headBefore); // remote untouched
    expect(await local.read(FILE_A)).toBe(localEdit); // disk untouched
  });
});

if (token === null) {
  it("integration suite skipped — no GitHub token (EXOSYNC_TEST_TOKEN / gh auth token)", () => {
    expect(token).toBeNull();
  });
}
