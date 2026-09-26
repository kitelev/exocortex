/**
 * req e5e45283 — the diagnostic floor on the CLI surface.
 *
 * Two guarantees the core axes cannot see, because they live in the commands:
 *   B1/B2  `exosync-parity` prints what the run COST and what is LEFT. Until
 *          now it printed neither, while `exosync sync` printed both — and
 *          parity is the expensive one (83 requests for 21 mounts).
 *   B3/B4  every run appends one line to a durable journal, so "who spent the
 *          budget, and when" survives the run that answered it.
 *
 * The axes drive the real command entry point (`runExosyncParity`) over a real
 * temp vault, not a formatter in isolation — deleting the print call or the
 * journal call has to redden them (integration-test-revert-verify §ПЯТАЯ
 * механика: the wiring is a separate axis from the thing being wired).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { RestCommitTransport } from "@kitelev/exocortex-core";
import { runExosyncParity } from "../../../src/commands/exosync-parity.js";
import { runExosyncSync } from "../../../src/commands/exosync-sync.js";
import {
  RUN_LOG_FILENAME,
  runLogEntry,
  appendSyncRunLog,
} from "../../../src/services/syncRunLog.js";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const OWNER = "test-owner";
const REPO = "exoas-parity";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const FAKE_PAT = "ghp_0000000000000000000000000000000000";

/**
 * Vault with a MATERIALIZED AssetSpace — declaration plus a real file under the
 * derived mount path. Both halves are load-bearing: without the mount the round
 * is vacuous ("nothing to check") and the run never reaches the transport, so
 * an axis asserting a non-zero request count would measure nothing.
 */
function makeVault(): { vault: string; cleanup: () => void } {
  const vault = mkdtempSync(path.join(tmpdir(), "quota-floor-"));
  writeFileSync(
    path.join(vault, "space-decl.md"),
    `---\nexo__Asset_uid: decl-uid\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${REPO}\n---\n\nDeclaration\n`,
  );
  const mounted = path.join(vault, MOUNT, "assets", "a.md");
  mkdirSync(path.dirname(mounted), { recursive: true });
  writeFileSync(mounted, `---\nexo__Asset_uid: u-a\n---\n\nbody A\n`);
  mkdirSync(path.join(vault, ".obsidian", "plugins", "exocortex"), {
    recursive: true,
  });
  return {
    vault,
    cleanup: () => rmSync(vault, { recursive: true, force: true }),
  };
}

/** Transport that answers every request with the quota headers GitHub sends. */
function quotaTransport(remaining: string): RestCommitTransport {
  const headers = (name: string): string | null =>
    ({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": remaining,
      "x-ratelimit-used": "1",
    })[name.toLowerCase()] ?? null;
  return async () => {
    throw Object.assign(
      new Error(
        `GitHub request GET https://api.github.com/x → HTTP 404: not found`,
      ),
      { headers },
    );
  };
}

function runParity(
  vault: string,
  transport: RestCommitTransport,
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  return runExosyncParity(
    { vault, token: FAKE_PAT },
    { transportFactory: () => transport, out: (l) => lines.push(l), env: {} },
  ).then((code) => ({ code, lines }));
}

describe("req e5e45283 — CLI diagnostic floor", () => {
  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a B1 parity prints a quota line on every run", async () => {
    const fx = makeVault();
    try {
      const { lines } = await runParity(fx.vault, quotaTransport("4321"));
      const quotaLine = lines.find((l) => l.startsWith("[ExoSync quota]"));
      // ⛔ Unconditional: even a run that resolved nothing spent requests, and
      // an absent line reads as "plenty left".
      expect(quotaLine).toBeDefined();
      expect(quotaLine).toContain("REST");
    } finally {
      fx.cleanup();
    }
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a B2 parity's quota line reports restCalls it actually made", async () => {
    const fx = makeVault();
    try {
      const { lines } = await runParity(fx.vault, quotaTransport("4321"));
      const quotaLine = lines.find((l) => l.startsWith("[ExoSync quota]")) ?? "";
      const m = /(\d+) REST/.exec(quotaLine);
      expect(m).not.toBeNull();
      // The counting decorator wraps the assembled chain, so a run that
      // reached the transport at all must report a non-zero count.
      expect(Number(m?.[1])).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a B5 a SUCCESSFUL response puts the real numbers on the quota line", async () => {
    const fx = makeVault();
    try {
      // The head lookup succeeds and carries the headers; everything after it
      // fails. One success is all the requirement needs — the point is that a
      // 2xx is read at all, which no code path did before.
      const headers = (name: string): string | null =>
        ({
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4321",
          "x-ratelimit-used": "679",
        })[name.toLowerCase()] ?? null;
      const transport: RestCommitTransport = async (req) => {
        if (req.url.includes("/git/refs/")) {
          return { status: 200, json: { object: { sha: "a".repeat(40) } }, headers };
        }
        throw new Error(
          `GitHub request GET ${req.url} → HTTP 404: deliberately stopping after the head`,
        );
      };
      const { lines } = await runParity(fx.vault, transport);
      const quotaLine = lines.find((l) => l.startsWith("[ExoSync quota]")) ?? "";
      // ⛔ Not `toBeDefined()`: the line is there even with no reading at all
      // (it says `quota n/a`), so only the NUMBERS distinguish a wired
      // observation from an unwired one.
      expect(quotaLine).toContain("quota 4321/5000");
    } finally {
      fx.cleanup();
    }
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a B3 a run appends exactly one journal line", async () => {
    const fx = makeVault();
    try {
      const logPath = path.join(
        fx.vault,
        ".obsidian",
        "plugins",
        "exocortex",
        RUN_LOG_FILENAME,
      );
      expect(existsSync(logPath)).toBe(false);
      await runParity(fx.vault, quotaTransport("4321"));

      expect(existsSync(logPath)).toBe(true);
      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(entry.command).toBe("parity");
      expect(entry.vault).toBe(fx.vault);
      expect(typeof entry.restCalls).toBe("number");
      expect(typeof entry.exitCode).toBe("number");
      // Local wall-clock with an explicit offset — never a bare UTC stamp.
      expect(String(entry.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/);

      // A second run appends rather than replaces — the journal is the record
      // of a DAY's spending, not of the last command.
      await runParity(fx.vault, quotaTransport("4320"));
      expect(readFileSync(logPath, "utf-8").trim().split("\n")).toHaveLength(2);
    } finally {
      fx.cleanup();
    }
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a B7 `sync` journals its vacuous exit too, not just parity", async () => {
    // Scenario 3 says ANY finished run of EITHER command. Parity's vacuous
    // branch was covered from the start; sync's was not, so "how many runs
    // happened today" was answerable for only one of the two commands.
    const vault = mkdtempSync(path.join(tmpdir(), "quota-vacuous-"));
    try {
      mkdirSync(path.join(vault, ".obsidian", "plugins", "exocortex"), {
        recursive: true,
      });
      const lines: string[] = [];
      const code = await runExosyncSync(
        "sync",
        { vault, token: FAKE_PAT },
        { out: (l) => lines.push(l), env: {} },
      );
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/Nothing to sync/);

      const logPath = path.join(
        vault,
        ".obsidian",
        "plugins",
        "exocortex",
        RUN_LOG_FILENAME,
      );
      expect(existsSync(logPath)).toBe(true);
      const entry = JSON.parse(
        readFileSync(logPath, "utf-8").trim(),
      ) as Record<string, unknown>;
      expect(entry.command).toBe("sync");
      expect(entry.exitCode).toBe(2);
      expect(entry.restCalls).toBe(0);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a B6 the journal directory is created when the vault has none", async () => {
    // A vault the CLI made itself has no plugin directory, and `appendFile`
    // answers ENOENT — which the fail-open catch swallows, losing the line
    // silently. The two sibling stores (watermark, ETag) both mkdir first.
    const vault = mkdtempSync(path.join(tmpdir(), "quota-nodir-"));
    try {
      const logPath = path.join(
        vault,
        ".obsidian",
        "plugins",
        "exocortex",
        RUN_LOG_FILENAME,
      );
      expect(existsSync(path.dirname(logPath))).toBe(false);
      const ok = await appendSyncRunLog(
        logPath,
        runLogEntry({
          command: "sync",
          vault,
          restCalls: 0,
          quota: undefined,
          exitCode: 2,
        }),
      );
      expect(ok).toBe(true);
      expect(readFileSync(logPath, "utf-8").trim().split("\n")).toHaveLength(1);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a B4 journalling never fails the run", async () => {
    // An unwritable path must cost a journal line, never the command: the run
    // has already done its real work by the time this is called.
    const ok = await appendSyncRunLog(
      "/proc/definitely/not/writable/runs.jsonl",
      runLogEntry({
        command: "parity",
        vault: "/tmp/x",
        restCalls: 1,
        quota: undefined,
        exitCode: 0,
      }),
    );
    expect(ok).toBe(false);

    const entry = runLogEntry({
      command: "sync",
      vault: "/tmp/x",
      restCalls: 7,
      quota: undefined,
      exitCode: 1,
    });
    // Absent quota is recorded as null — explicitly "not reported", never 0.
    expect(entry.limit).toBeNull();
    expect(entry.remaining).toBeNull();
    expect(entry.restCalls).toBe(7);
  });
});
