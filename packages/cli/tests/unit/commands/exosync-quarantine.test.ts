/**
 * @jest-environment node
 *
 * `exocortex exosync quarantine <list|resolve>` + `exosync dedup-uids` —
 * CLI parity for the quarantine resolver (finding a0a3d1d6).
 *
 * Production-shape (test-fixture-realism): a real temp vault with an AssetSpace
 * declaration (so `collectVaultSpecs` finds it), a hand-seeded device-local
 * watermark with a pinned conflict (exactly what the engine leaves), and the
 * FakeGitHubRepo transport (real git blob SHAs, force:false 422). The commands
 * drive the SAME `QuarantineResolver` the plugin modal uses.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  FakeGitHubRepo,
  mdAsset,
  sha1Hex,
} from "../../../../exocortex/tests/unit/services/sync/fakeGitHub";
import { gitBlobSha } from "exocortex";
import {
  runQuarantineList,
  runQuarantineResolve,
  runDedupUids,
} from "../../../src/commands/exosync-quarantine";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const OWNER = "test-owner";
const REPO = "test-repo";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const REPO_KEY = `${OWNER}/${REPO}#main`;
const CONFLICT = "alpha.md";
const FAKE_PAT = "ghp_" + "C".repeat(36);

function mkTmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/**
 * Build a temp vault holding an AssetSpace declaration + a mounted local file,
 * and seed the device-local watermark with `CONFLICT` pinned (base recorded).
 */
async function makeConflictVault(opts: {
  base: string;
  local: string;
  extraMount?: Record<string, string>;
}): Promise<{ vault: string; gh: FakeGitHubRepo; remote: string; cleanup: () => void }> {
  const remote = mdAsset("uid-1", "REMOTE edit");
  const gh = new FakeGitHubRepo({ [CONFLICT]: opts.base });
  const baseSha = gh.headSha();
  const baseTreeSha = gh.commits.get(baseSha)!.treeSha;
  gh.commitDirect("main", { [CONFLICT]: remote }, "remote edit");

  const vault = mkTmp("exosync-q-");
  writeFileSync(
    path.join(vault, "space-decl.md"),
    `---\nexo__Asset_uid: decl-uid\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${REPO}\n---\n\nDeclaration\n`,
  );
  const mountDir = path.join(vault, MOUNT);
  mkdirSync(mountDir, { recursive: true });
  writeFileSync(path.join(mountDir, CONFLICT), opts.local);
  for (const [rel, content] of Object.entries(opts.extraMount ?? {})) {
    const full = path.join(mountDir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  const wmDir = path.join(vault, ".obsidian", "plugins", "exocortex");
  mkdirSync(wmDir, { recursive: true });
  const record = {
    lastSyncedSha: baseSha,
    rootTreeSha: baseTreeSha,
    files: [
      { path: CONFLICT, blobSha: await gitBlobSha(opts.base, sha1Hex), uid: "uid-1" },
    ],
    pinnedPaths: [CONFLICT],
  };
  writeFileSync(
    path.join(wmDir, "exosync-watermarks.local.json"),
    JSON.stringify({ version: 1, repos: { [REPO_KEY]: record } }, null, 2),
  );

  return {
    vault,
    gh,
    remote,
    cleanup: () => rmSync(vault, { recursive: true, force: true }),
  };
}

const deps = (gh: FakeGitHubRepo, lines: string[]) => ({
  transportFactory: () => gh.transport(),
  out: (l: string) => lines.push(l),
  env: {},
});

describe("exosync quarantine list", () => {
  it("lists a genuine open conflict from the device-local watermark", async () => {
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL edit"),
    });
    const lines: string[] = [];
    try {
      const code = await runQuarantineList(
        { vault: fx.vault, token: FAKE_PAT },
        deps(fx.gh, lines),
      );
      expect(code).toBe(0);
      const text = lines.join("\n");
      expect(text).toMatch(/1 open conflict/);
      expect(text).toContain(CONFLICT);
      expect(text).toMatch(/local vs remote/);
      expect(text).toMatch(/uid=uid-1/);
    } finally {
      fx.cleanup();
    }
  });

  it("reports nothing to resolve when no real divergence", async () => {
    const same = mdAsset("uid-1", "converged");
    const fx = await makeConflictVault({ base: mdAsset("uid-1", "old"), local: same });
    // Make the remote equal local too (converged) by re-committing.
    fx.gh.commitDirect("main", { [CONFLICT]: same }, "converge");
    const lines: string[] = [];
    try {
      const code = await runQuarantineList(
        { vault: fx.vault, token: FAKE_PAT },
        deps(fx.gh, lines),
      );
      expect(code).toBe(0);
      expect(lines.join("\n")).toMatch(/No open conflicts/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("exosync quarantine resolve", () => {
  it("--take local converges disk + remote to local and reports the push", async () => {
    const local = mdAsset("uid-1", "LOCAL edit");
    const fx = await makeConflictVault({ base: mdAsset("uid-1", "base"), local });
    const lines: string[] = [];
    try {
      const code = await runQuarantineResolve(
        CONFLICT,
        { vault: fx.vault, token: FAKE_PAT, take: "local" },
        deps(fx.gh, lines),
      );
      expect(code).toBe(0);
      // Remote head now holds the local choice (the 2-pass-killer commit).
      expect(fx.gh.headFiles().get(CONFLICT)).toBe(local);
      // Disk still holds local.
      expect(readFileSync(path.join(fx.vault, MOUNT, CONFLICT), "utf-8")).toBe(local);
      expect(lines.join("\n")).toMatch(/Resolved alpha\.md \(local\)/);
    } finally {
      fx.cleanup();
    }
  });

  it("--take remote writes remote to disk and preserves the discarded local (zero-loss)", async () => {
    const local = mdAsset("uid-1", "LOCAL edit");
    const fx = await makeConflictVault({ base: mdAsset("uid-1", "base"), local });
    const lines: string[] = [];
    try {
      const code = await runQuarantineResolve(
        CONFLICT,
        { vault: fx.vault, token: FAKE_PAT, take: "remote" },
        deps(fx.gh, lines),
      );
      expect(code).toBe(0);
      expect(readFileSync(path.join(fx.vault, MOUNT, CONFLICT), "utf-8")).toBe(
        fx.remote,
      );
      // ZERO-LOSS: the discarded local lives on in a .txt backup, byte-for-byte.
      const backup = path.join(fx.vault, MOUNT, `${CONFLICT}.conflict-local.txt`);
      expect(existsSync(backup)).toBe(true);
      expect(readFileSync(backup, "utf-8")).toBe(local);
      expect(lines.join("\n")).toMatch(/discarded local version is preserved/);
    } finally {
      fx.cleanup();
    }
  });

  it("exits 1 with a hint when the path is not an open conflict", async () => {
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL"),
    });
    const lines: string[] = [];
    try {
      const code = await runQuarantineResolve(
        "ghost.md",
        { vault: fx.vault, token: FAKE_PAT, take: "local" },
        deps(fx.gh, lines),
      );
      expect(code).toBe(1);
      expect(lines.join("\n")).toMatch(/No open conflict for "ghost\.md"/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("exosync dedup-uids", () => {
  it("reports duplicate uids on disk (exit 1) and --fix re-uuids all but the first", async () => {
    // Two distinct notes wrongly sharing a uid (copy-without-changing-uid).
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL"),
      extraMount: {
        "dup-a.md": mdAsset("dupe-uid", "note A"),
        "dup-b.md": mdAsset("dupe-uid", "note B"),
      },
    });
    try {
      const lines1: string[] = [];
      const reportCode = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT },
        deps(fx.gh, lines1),
      );
      expect(reportCode).toBe(1); // needs attention
      expect(lines1.join("\n")).toMatch(/duplicate uid/);
      expect(lines1.join("\n")).toContain("dupe-uid");

      const lines2: string[] = [];
      const fixCode = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT, fix: true },
        deps(fx.gh, lines2),
      );
      expect(fixCode).toBe(0);
      // The first (alphabetical) keeps the uid; the second gets a fresh one.
      // Assert the uid LINE specifically (the label still mentions "dupe-uid").
      const a = readFileSync(path.join(fx.vault, MOUNT, "dup-a.md"), "utf-8");
      const b = readFileSync(path.join(fx.vault, MOUNT, "dup-b.md"), "utf-8");
      expect(a).toMatch(/^exo__Asset_uid: dupe-uid$/m);
      expect(b).not.toMatch(/^exo__Asset_uid: dupe-uid$/m);
      expect(b).toMatch(/^exo__Asset_uid: [0-9a-f-]{36}$/m);

      // Idempotent: a second pass finds no duplicates.
      const lines3: string[] = [];
      const again = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT },
        deps(fx.gh, lines3),
      );
      expect(again).toBe(0);
      expect(lines3.join("\n")).toMatch(/No duplicate uids/);
    } finally {
      fx.cleanup();
    }
  });
});
