/**
 * @jest-environment node
 *
 * req c0810b83 — pull-only repos. A device-local list
 * `<vault>/.exocortex/exosync-pull-only` (one `owner/repo` per line, `#`
 * comments and blank lines ignored) makes the listed repos READ-ONLY on this
 * device:
 *
 *  - `exosync push` and the push phase of `exosync sync` never send them
 *    (`skipped-pull-only`, exit stays 0 — a bot pushing its whole vault
 *    stays green);
 *  - `exosync pull` and the pull phase of `exosync sync` turn the mount
 *    folder into a MIRROR of the remote head (edits overwritten, extras
 *    removed, missing files written), listing the paths on stdout AND stderr;
 *  - `exosync-parity --json` marks them `"pullOnly": true`;
 *  - a malformed line refuses the run (exit 2) before any REST request;
 *  - no list file ⇒ behaviour exactly as before.
 *
 * Every axis drives the REAL command entry points (`runExosyncSync`,
 * `runExosyncParity`) over a real vault on disk — the list is read from the
 * file the bots will carry, not injected into a helper.
 *
 * Fixture: TWO declared + materialized repos with disjoint names — `bot`
 * (the protected one) and `own` (an ordinary two-way repo, the control).
 * Each has its OWN production-shape `FakeGitHubRepo`; the transport routes by
 * the repo segment of the URL and records every request, so «repo X was
 * (not) touched» is read from what the engine actually asked the network for.
 */
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { FakeGitHubRepo, mdAsset } from "../../../../core/tests/unit/services/sync/fakeGitHub";
import { runExosyncSync } from "../../../src/commands/exosync-sync";
import { runExosyncParity } from "../../../src/commands/exosync-parity";
import type { RestCommitTransport, SyncDirection } from "@kitelev/exocortex-core";

const OWNER = "test-owner";
const FAKE_PAT = "ghp_" + "P".repeat(36);
const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const LIST = ".exocortex/exosync-pull-only";

const A_REMOTE = mdAsset("u-a", "canonical instruction text");
const B_REMOTE = mdAsset("u-b", "second instruction");
const OWN_REMOTE = mdAsset("u-own", "own note");

interface Fixture {
  vault: string;
  remotes: Record<string, FakeGitHubRepo>;
  cleanup: () => void;
}

/** Two repos, local trees identical to their remotes (a clean mount). */
function makeVault(): Fixture {
  const vault = mkdtempSync(path.join(tmpdir(), "exosync-pull-only-"));
  const remotes: Record<string, FakeGitHubRepo> = {
    bot: new FakeGitHubRepo({ "assets/a.md": A_REMOTE, "assets/b.md": B_REMOTE }),
    own: new FakeGitHubRepo({ "assets/own.md": OWN_REMOTE }),
  };
  const localFiles: Record<string, Record<string, string>> = {
    bot: { "assets/a.md": A_REMOTE, "assets/b.md": B_REMOTE },
    own: { "assets/own.md": OWN_REMOTE },
  };
  for (const repo of Object.keys(remotes)) {
    writeFileSync(
      path.join(vault, `decl-${repo}.md`),
      `---\nexo__Asset_uid: decl-${repo}\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${repo}\n---\n\nDeclaration\n`,
    );
    for (const [rel, content] of Object.entries(localFiles[repo])) {
      writeLocal(vault, repo, rel, content);
    }
  }
  return { vault, remotes, cleanup: () => rmSync(vault, { recursive: true, force: true }) };
}

function localPath(vault: string, repo: string, rel: string): string {
  return path.join(vault, `assetspaces/${OWNER}/${repo}`, rel);
}

function writeLocal(vault: string, repo: string, rel: string, content: string): void {
  const full = localPath(vault, repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function readLocal(vault: string, repo: string, rel: string): string {
  return readFileSync(localPath(vault, repo, rel), "utf-8");
}

function writeList(vault: string, text: string): void {
  mkdirSync(path.join(vault, ".exocortex"), { recursive: true });
  writeFileSync(path.join(vault, LIST), text);
}

interface RunOutcome {
  code: number;
  out: string[];
  err: string[];
  /** `METHOD url` of every request, in order. */
  requests: string[];
}

function routingTransport(fx: Fixture, requests: string[]): RestCommitTransport {
  return async (req) => {
    requests.push(`${req.method} ${req.url}`);
    const m = /\/repos\/[^/]+\/([^/]+)\//.exec(req.url);
    const gh = m === null ? undefined : fx.remotes[m[1]];
    if (gh === undefined) throw new Error(`unrouted request ${req.url}`);
    return gh.transport()(req);
  };
}

async function sync(
  fx: Fixture,
  direction: SyncDirection,
  extra: { json?: boolean } = {},
): Promise<RunOutcome> {
  const requests: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const code = await runExosyncSync(
    direction,
    { vault: fx.vault, token: FAKE_PAT, ...extra },
    {
      transportFactory: () => routingTransport(fx, requests),
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      env: {},
    },
  );
  return { code, out, err, requests };
}

async function parity(fx: Fixture, json: boolean): Promise<RunOutcome> {
  const requests: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const code = await runExosyncParity(
    { vault: fx.vault, token: FAKE_PAT, json },
    {
      transportFactory: () => routingTransport(fx, requests),
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      env: {},
    },
  );
  return { code, out, err, requests };
}

const touched = (requests: string[], repo: string): string[] =>
  requests.filter((r) => r.includes(`/repos/${OWNER}/${repo}/`));
const writes = (requests: string[], repo: string): string[] =>
  touched(requests, repo).filter((r) => !r.startsWith("GET "));

/** Seed both watermarks from a clean mount (bootstrap no-op), list absent. */
async function seeded(): Promise<Fixture> {
  const fx = makeVault();
  const seed = await sync(fx, "pull");
  expect(seed.code).toBe(0);
  return fx;
}

describe("exosync pull-only repos (req c0810b83)", () => {
  it("P1 @req:c0810b83-8554-403e-bff0-d341c7d90926 pull restores a locally edited file of a pull-only repo and names it on stdout", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      writeLocal(fx.vault, "bot", "assets/a.md", mdAsset("u-a", "INJECTED instruction"));
      const r = await sync(fx, "pull");
      expect(r.code).toBe(0);
      expect(readLocal(fx.vault, "bot", "assets/a.md")).toBe(A_REMOTE);
      expect(r.out).toContain(
        "  pull-only mirror (local changes overwritten by the remote head): restored assets/a.md",
      );
    } finally {
      fx.cleanup();
    }
  });

  it("P2 @req:c0810b83-8554-403e-bff0-d341c7d90926 pull removes a local extra file and writes a missing remote one", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      writeLocal(fx.vault, "bot", "assets/injected.md", mdAsset("u-x", "rogue rule"));
      rmSync(localPath(fx.vault, "bot", "assets/b.md"));
      const r = await sync(fx, "pull");
      expect(r.code).toBe(0);
      expect(existsSync(localPath(fx.vault, "bot", "assets/injected.md"))).toBe(false);
      expect(readLocal(fx.vault, "bot", "assets/b.md")).toBe(B_REMOTE);
      expect(r.out).toContain(
        "  pull-only mirror (local changes overwritten by the remote head): added assets/b.md; removed assets/injected.md",
      );
    } finally {
      fx.cleanup();
    }
  });

  it("P15 @req:c0810b83-8554-403e-bff0-d341c7d90926 every mirrored path is also printed on stderr, one line per path, even under --json", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      writeLocal(fx.vault, "bot", "assets/a.md", mdAsset("u-a", "INJECTED instruction"));
      writeLocal(fx.vault, "bot", "assets/injected.md", mdAsset("u-x", "rogue rule"));
      rmSync(localPath(fx.vault, "bot", "assets/b.md"));
      const r = await sync(fx, "pull", { json: true });
      expect(r.code).toBe(0);
      expect(r.err).toEqual([
        `[ExoSync pull-only] ${OWNER}/bot: restored assets/a.md`,
        `[ExoSync pull-only] ${OWNER}/bot: added assets/b.md`,
        `[ExoSync pull-only] ${OWNER}/bot: removed assets/injected.md`,
      ]);
    } finally {
      fx.cleanup();
    }
  });

  it("P3 @req:c0810b83-8554-403e-bff0-d341c7d90926 push skips the pull-only repo without a single request while the neighbouring repo pushes; exit 0", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      writeLocal(fx.vault, "bot", "assets/a.md", mdAsset("u-a", "INJECTED instruction"));
      const ownEdit = mdAsset("u-own", "own note, edited");
      writeLocal(fx.vault, "own", "assets/own.md", ownEdit);
      const botHead = fx.remotes.bot.headSha();
      const r = await sync(fx, "push");
      expect(r.code).toBe(0);
      expect(touched(r.requests, "bot")).toEqual([]);
      expect(fx.remotes.bot.headSha()).toBe(botHead);
      expect(r.out.some((l) => l.startsWith(`${OWNER}/bot#main: skipped-pull-only — `))).toBe(true);
      // control — the neighbour is pushed as before
      expect(fx.remotes.own.headFiles().get("assets/own.md")).toBe(ownEdit);
      expect(writes(r.requests, "own").length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  it("P4 @req:c0810b83-8554-403e-bff0-d341c7d90926 sync mirrors the pull-only repo, never commits to it, and leaves no pin, outbox entry or quarantine for it", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      writeLocal(fx.vault, "bot", "assets/a.md", mdAsset("u-a", "INJECTED instruction"));
      const botHead = fx.remotes.bot.headSha();
      const r = await sync(fx, "sync");
      expect(r.code).toBe(0);
      expect(writes(r.requests, "bot")).toEqual([]);
      expect(fx.remotes.bot.headSha()).toBe(botHead);
      expect(readLocal(fx.vault, "bot", "assets/a.md")).toBe(A_REMOTE);
      expect(r.out.join("\n")).toMatch(/push phase skipped-pull-only/);
      const store = path.join(fx.vault, ".obsidian/plugins/exocortex");
      const wm = JSON.parse(readFileSync(path.join(store, "exosync-watermarks.local.json"), "utf-8"));
      const record = wm.repos[`${OWNER}/bot#main`];
      expect(record).toBeDefined();
      expect(record.lastSyncedSha).toBe(botHead);
      expect(record.pinnedPaths ?? []).toEqual([]);
      for (const f of ["exosync-outbox.local.json", "exosync-conflicts.local.json"]) {
        const p = path.join(store, f);
        if (existsSync(p)) expect(readFileSync(p, "utf-8")).not.toContain(`${OWNER}/bot#main`);
      }
    } finally {
      fx.cleanup();
    }
  });

  it("P5 @req:c0810b83-8554-403e-bff0-d341c7d90926 a repo NOT on the list keeps its local edit through pull and pushes it (control)", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      const ownEdit = mdAsset("u-own", "own note, edited");
      writeLocal(fx.vault, "own", "assets/own.md", ownEdit);
      const pulled = await sync(fx, "pull");
      expect(pulled.code).toBe(0);
      expect(readLocal(fx.vault, "own", "assets/own.md")).toBe(ownEdit);
      expect(pulled.err.filter((l) => l.includes(`${OWNER}/own`))).toEqual([]);
      const pushed = await sync(fx, "push");
      expect(pushed.code).toBe(0);
      expect(fx.remotes.own.headFiles().get("assets/own.md")).toBe(ownEdit);
    } finally {
      fx.cleanup();
    }
  });

  const MALFORMED_LIST = "# bot vaults\n\ntest-owner/bot # instructions\n";
  const MALFORMED_TEXT =
    'invalid pull-only list .exocortex/exosync-pull-only line 3: expected "owner/repo" (blank lines and # comments are ignored), got "test-owner/bot # instructions"';

  it("P6 @req:c0810b83-8554-403e-bff0-d341c7d90926 a malformed list line refuses pull, push, sync and parity with exit 2 before any request, naming the line and its content", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, MALFORMED_LIST);
      for (const direction of ["pull", "push", "sync"] as const) {
        const r = await sync(fx, direction);
        expect(r.code).toBe(2);
        expect(r.requests).toEqual([]);
        expect(r.out.join("\n")).toContain(MALFORMED_TEXT);
      }
      const p = await parity(fx, true);
      expect(p.code).toBe(2);
      expect(p.requests).toEqual([]);
      expect(p.out.join("\n")).toContain(MALFORMED_TEXT);
    } finally {
      fx.cleanup();
    }
  });

  it("P14 @req:c0810b83-8554-403e-bff0-d341c7d90926 the malformed-list refusal is mirrored on stderr", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, MALFORMED_LIST);
      const r = await sync(fx, "push");
      expect(r.err.join("\n")).toContain(MALFORMED_TEXT);
      const p = await parity(fx, false);
      expect(p.err.join("\n")).toContain(MALFORMED_TEXT);
    } finally {
      fx.cleanup();
    }
  });

  it("P7 @req:c0810b83-8554-403e-bff0-d341c7d90926 without the list file every repo is two-way exactly as before (edit survives pull, push sends it)", async () => {
    const fx = await seeded();
    try {
      const edit = mdAsset("u-a", "edited on this device");
      writeLocal(fx.vault, "bot", "assets/a.md", edit);
      const pulled = await sync(fx, "pull", { json: true });
      expect(pulled.code).toBe(0);
      expect(readLocal(fx.vault, "bot", "assets/a.md")).toBe(edit);
      expect(pulled.err).toEqual([]);
      const results = JSON.parse(pulled.out.find((l) => l.startsWith("["))!);
      for (const res of results) {
        expect(res).not.toHaveProperty("pullOnly");
        expect(res).not.toHaveProperty("mirrored");
      }
      const pushed = await sync(fx, "push");
      expect(pushed.code).toBe(0);
      expect(fx.remotes.bot.headFiles().get("assets/a.md")).toBe(edit);
    } finally {
      fx.cleanup();
    }
  });

  it('P8 @req:c0810b83-8554-403e-bff0-d341c7d90926 exosync-parity --json marks the pull-only repo "pullOnly": true and only it', async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      const p = await parity(fx, true);
      expect([0, 1]).toContain(p.code);
      const json = JSON.parse(p.out.find((l) => l.startsWith("{"))!);
      const bot = json.repos.find((x: { repoKey: string }) => x.repoKey === `${OWNER}/bot#main`);
      const own = json.repos.find((x: { repoKey: string }) => x.repoKey === `${OWNER}/own#main`);
      expect(bot.pullOnly).toBe(true);
      expect(own).toBeDefined();
      expect(own).not.toHaveProperty("pullOnly");
    } finally {
      fx.cleanup();
    }
  });

  it("P9 @req:c0810b83-8554-403e-bff0-d341c7d90926 the human parity report tags the pull-only repo line [pull-only]", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      const p = await parity(fx, false);
      expect(p.out.some((l) => l.startsWith(`${OWNER}/bot#main @`) && l.includes(" [pull-only]: "))).toBe(true);
      expect(p.out.some((l) => l.startsWith(`${OWNER}/own#main`) && l.includes("[pull-only]"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  const GHOST_WARNING =
    "warn: pull-only list .exocortex/exosync-pull-only line 1 names test-owner/ghost, which is not a materialized sync unit on this device — nothing to protect";

  it("P10 @req:c0810b83-8554-403e-bff0-d341c7d90926 a listed repo that is not materialized warns and the run proceeds", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/ghost\n`);
      const r = await sync(fx, "pull");
      expect(r.code).toBe(0);
      expect(r.out).toContain(GHOST_WARNING);
    } finally {
      fx.cleanup();
    }
  });

  it("P18 @req:c0810b83-8554-403e-bff0-d341c7d90926 the unmatched-entry warning is repeated on stderr (a typo must not hide behind discarded stdout)", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/ghost\n`);
      const r = await sync(fx, "push");
      expect(r.code).toBe(0);
      expect(r.err).toContain(GHOST_WARNING);
    } finally {
      fx.cleanup();
    }
  });

  it("P16 @req:c0810b83-8554-403e-bff0-d341c7d90926 a local extra whose name carries a backslash is removed too (legal on POSIX)", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      writeLocal(fx.vault, "bot", "assets/x\\injected.md", mdAsset("u-x", "rogue rule"));
      const r = await sync(fx, "pull");
      expect(r.code).toBe(0);
      expect(existsSync(localPath(fx.vault, "bot", "assets/x\\injected.md"))).toBe(false);
      expect(r.err).toContain(`[ExoSync pull-only] ${OWNER}/bot: removed assets/x\\injected.md`);
    } finally {
      fx.cleanup();
    }
  });

  it("P17 @req:c0810b83-8554-403e-bff0-d341c7d90926 without the list the human parity line keeps its exact pre-feature shape", async () => {
    const fx = await seeded();
    try {
      const p = await parity(fx, false);
      const line = p.out.find((l) => l.startsWith(`${OWNER}/own#main`));
      expect(line).toMatch(
        /^test-owner\/own#main @[0-9a-f]{7}: checked — \d+\/\d+ in parity, M2 diffs \d+, accounted \d+, M1 violations \d+$/,
      );
    } finally {
      fx.cleanup();
    }
  });

  it("P19 @req:c0810b83-8554-403e-bff0-d341c7d90926 a repo taken OFF the list goes back to two-way from an exact base: no conflict, only the new local edit is pushed", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      writeLocal(fx.vault, "bot", "assets/a.md", mdAsset("u-a", "INJECTED instruction"));
      expect((await sync(fx, "pull")).code).toBe(0);
      rmSync(path.join(fx.vault, LIST));
      const edit = mdAsset("u-b", "legitimate edit after leaving the list");
      writeLocal(fx.vault, "bot", "assets/b.md", edit);
      const r = await sync(fx, "sync", { json: true });
      expect(r.code).toBe(0);
      const results = JSON.parse(r.out.find((l) => l.startsWith("["))!);
      const bot = results.find((x: { repoKey: string }) => x.repoKey === `${OWNER}/bot#main`);
      expect(bot.status).toBe("synced");
      expect(bot.pushedCount).toBe(1);
      expect(fx.remotes.bot.headFiles().get("assets/b.md")).toBe(edit);
      expect(fx.remotes.bot.headFiles().get("assets/a.md")).toBe(A_REMOTE);
    } finally {
      fx.cleanup();
    }
  });

  it("P11 @req:c0810b83-8554-403e-bff0-d341c7d90926 list matching ignores case, a leading BOM, comments, blank lines, CRLF and surrounding blanks", async () => {
    const fx = await seeded();
    try {
      const bom = String.fromCharCode(0xfeff);
      writeList(fx.vault, `${bom}# bots\r\n\r\n   Test-Owner/BOT   \r\n`);
      writeLocal(fx.vault, "bot", "assets/a.md", mdAsset("u-a", "INJECTED instruction"));
      const r = await sync(fx, "pull");
      expect(r.code).toBe(0);
      expect(readLocal(fx.vault, "bot", "assets/a.md")).toBe(A_REMOTE);
    } finally {
      fx.cleanup();
    }
  });

  it("P13 @req:c0810b83-8554-403e-bff0-d341c7d90926 a trailing .git on a list entry still names the repo", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot.git\n`);
      writeLocal(fx.vault, "bot", "assets/a.md", mdAsset("u-a", "INJECTED instruction"));
      const r = await sync(fx, "pull");
      expect(r.code).toBe(0);
      expect(readLocal(fx.vault, "bot", "assets/a.md")).toBe(A_REMOTE);
    } finally {
      fx.cleanup();
    }
  });

  it("P12 @req:c0810b83-8554-403e-bff0-d341c7d90926 --json push reports the pull-only repo as skipped-pull-only with pullOnly: true", async () => {
    const fx = await seeded();
    try {
      writeList(fx.vault, `${OWNER}/bot\n`);
      const r = await sync(fx, "push", { json: true });
      expect(r.code).toBe(0);
      const results = JSON.parse(r.out.find((l) => l.startsWith("["))!);
      const bot = results.find((x: { repoKey: string }) => x.repoKey === `${OWNER}/bot#main`);
      expect(bot.status).toBe("skipped-pull-only");
      expect(bot.pullOnly).toBe(true);
      const own = results.find((x: { repoKey: string }) => x.repoKey === `${OWNER}/own#main`);
      expect(own.status).toBe("synced");
      expect(own).not.toHaveProperty("pullOnly");
    } finally {
      fx.cleanup();
    }
  });
});
