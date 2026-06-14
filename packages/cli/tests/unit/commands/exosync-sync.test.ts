/**
 * @jest-environment node
 *
 * Unit tests for `exocortex exosync <sync|pull|push>` (EKA M3.7 PA-exosync,
 * RFC 4e4dc453 Phase B CLI parity).
 *
 * Two layers:
 *  1. The NEW node:fs ports the command introduces — writable
 *     `nodeLocalFilesPort`, writable `nodeWatermarkFileIO`,
 *     `nodeMaterializationCheck` — exercised directly against a real temp
 *     dir (this is the genuinely-new code; the engine itself is exhaustively
 *     tested in the exocortex package).
 *  2. `runExosyncSync` wiring end-to-end against the production-shape
 *     `FakeGitHubRepo` (real git blob SHAs, force:false 422 semantics) — a
 *     bootstrap `sync` then a `pull` that must materialise a remote-added
 *     file on disk THROUGH the real writable port, proving port → engine →
 *     disk composition + direction plumbing + exit codes.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { FakeGitHubRepo, mdAsset } from "../../../../exocortex/tests/unit/services/sync/fakeGitHub";
import {
  nodeLocalFilesPort,
  nodeWatermarkFileIO,
  nodeMaterializationCheck,
  runExosyncSync,
  type ExosyncSyncOptions,
} from "../../../src/commands/exosync-sync";
import type { SyncRepoSpec } from "exocortex";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const OWNER = "test-owner";
const REPO = "test-repo";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const FILE_A = "assets/a.md";
const FILE_B = "assets/b.md";
const FAKE_PAT = "ghp_" + "C".repeat(36);

function mkTmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("nodeLocalFilesPort (writable)", () => {
  let root: string;
  beforeEach(() => {
    root = mkTmp("exosync-port-");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes a file atomically, creating parent directories", async () => {
    const port = nodeLocalFilesPort(root);
    await port.write("nested/deep/x.md", "hello");
    expect(readFileSync(path.join(root, "nested/deep/x.md"), "utf-8")).toBe("hello");
    expect(await port.read("nested/deep/x.md")).toBe("hello");
    // No temp leftover.
    expect(existsSync(path.join(root, "nested/deep/x.md.local.tmp"))).toBe(false);
  });

  it("lists repo-relative forward-slash paths and skips .git", async () => {
    const port = nodeLocalFilesPort(root);
    await port.write("a/b.md", "1");
    await port.write("c.md", "2");
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, ".git", "HEAD"), "ref: x");
    const listed = (await port.list()).sort();
    expect(listed).toEqual(["a/b.md", "c.md"]);
  });

  it("delete is a no-op when the path does not exist", async () => {
    const port = nodeLocalFilesPort(root);
    await expect(port.delete("ghost.md")).resolves.toBeUndefined();
    await port.write("real.md", "x");
    await port.delete("real.md");
    expect(existsSync(path.join(root, "real.md"))).toBe(false);
  });

  it("round-trips binary content through writeBinary/readBinary", async () => {
    const port = nodeLocalFilesPort(root);
    const bytes = new Uint8Array([0, 1, 2, 255, 254]);
    await port.writeBinary!("blob.bin", bytes);
    expect([...(await port.readBinary!("blob.bin"))]).toEqual([...bytes]);
  });
});

describe("nodeWatermarkFileIO", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkTmp("exosync-wm-");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns null when the watermark file is absent", async () => {
    const io = nodeWatermarkFileIO(path.join(dir, "sub", "wm.json"));
    expect(await io.read()).toBeNull();
  });

  it("writes atomically (creating parents) and round-trips", async () => {
    const file = path.join(dir, "plugins", "exocortex", "wm.json");
    const io = nodeWatermarkFileIO(file);
    await io.writeAtomic('{"version":1}');
    expect(await io.read()).toBe('{"version":1}');
    expect(existsSync(`${file}.local.tmp`)).toBe(false);
  });
});

describe("nodeMaterializationCheck", () => {
  let vault: string;
  beforeEach(() => {
    vault = mkTmp("exosync-mat-");
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  const spec = (localPath: string, kind?: "asset" | "file"): SyncRepoSpec => ({
    owner: OWNER,
    repo: REPO,
    branch: "main",
    repoKey: `${OWNER}/${REPO}#main`,
    localPath,
    ...(kind === "file" ? { spaceKind: kind } : {}),
  });

  it("flags a missing mount folder as not materialized", async () => {
    const check = nodeMaterializationCheck(vault);
    const r = await check.check(spec("assetspaces/x/y"));
    expect(r.fullyMaterialized).toBe(false);
    expect(r.reason).toMatch(/does not exist/);
  });

  it("flags an empty non-file mount folder as not materialized", async () => {
    mkdirSync(path.join(vault, MOUNT), { recursive: true });
    const r = await nodeMaterializationCheck(vault).check(spec(MOUNT));
    expect(r.fullyMaterialized).toBe(false);
    expect(r.reason).toMatch(/empty/);
  });

  it("accepts a non-empty mount folder", async () => {
    mkdirSync(path.join(vault, MOUNT), { recursive: true });
    writeFileSync(path.join(vault, MOUNT, "a.md"), "x");
    const r = await nodeMaterializationCheck(vault).check(spec(MOUNT));
    expect(r.fullyMaterialized).toBe(true);
  });

  it("accepts an empty FileSpace folder (legitimate first-sync state)", async () => {
    mkdirSync(path.join(vault, MOUNT), { recursive: true });
    const r = await nodeMaterializationCheck(vault).check(spec(MOUNT, "file"));
    expect(r.fullyMaterialized).toBe(true);
  });
});

/** Build a temp vault with one materialized AssetSpace declaration + mount. */
function makeVault(mountFiles: Record<string, string>): {
  vault: string;
  cleanup: () => void;
} {
  const vault = mkTmp("exosync-sync-test-");
  writeFileSync(
    path.join(vault, "space-decl.md"),
    `---\nexo__Asset_uid: decl-uid\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${REPO}\n---\n\nDeclaration\n`,
  );
  for (const [rel, content] of Object.entries(mountFiles)) {
    const full = path.join(vault, MOUNT, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return { vault, cleanup: () => rmSync(vault, { recursive: true, force: true }) };
}

describe("runExosyncSync — wiring", () => {
  it("returns 2 (vacuous) when no materialized AssetSpaces are present", async () => {
    const vault = mkTmp("exosync-empty-");
    const lines: string[] = [];
    try {
      const code = await runExosyncSync(
        "sync",
        { vault, token: FAKE_PAT },
        { out: (l) => lines.push(l), env: {} },
      );
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/Nothing to sync/);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  it("throws when no token is available", async () => {
    const fx = makeVault({ [FILE_A]: mdAsset("u1") });
    try {
      await expect(
        runExosyncSync("sync", { vault: fx.vault }, { env: {} }),
      ).rejects.toThrow(/GitHub token is required/);
    } finally {
      fx.cleanup();
    }
  });

  it("pull materialises a remote-added file on disk (port → engine → disk)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const fx = makeVault({ [FILE_A]: mdAsset("u1") });
    const out = (over: Partial<ExosyncSyncOptions> = {}) => ({
      transportFactory: () => gh.transport(),
      out: () => {},
      env: {},
      ...over,
    });
    try {
      // Bootstrap: local == remote → clean adopt, watermark established.
      const bootstrap = await runExosyncSync(
        "sync",
        { vault: fx.vault, token: FAKE_PAT },
        out(),
      );
      expect(bootstrap).toBe(0);
      const wmPath = path.join(
        fx.vault,
        ".obsidian",
        "plugins",
        "exocortex",
        "exosync-watermarks.local.json",
      );
      expect(existsSync(wmPath)).toBe(true);

      // Device B adds FILE_B on the remote.
      gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote add") }, "device B");
      expect(existsSync(path.join(fx.vault, MOUNT, FILE_B))).toBe(false);

      // Pull applies it to disk through the real node:fs writable port.
      const lines: string[] = [];
      const pull = await runExosyncSync(
        "pull",
        { vault: fx.vault, token: FAKE_PAT },
        out({ out: (l: string) => lines.push(l) }),
      );
      expect(pull).toBe(0);
      const pulledPath = path.join(fx.vault, MOUNT, FILE_B);
      expect(existsSync(pulledPath)).toBe(true);
      expect(readFileSync(pulledPath, "utf-8")).toBe(mdAsset("u2", "remote add"));
      expect(lines.join("\n")).toMatch(/pulled 1/);
      // Pull pushes nothing — the remote head did not move further.
      expect(gh.headFiles().has(FILE_B)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});
