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
} from "../../../../core/tests/unit/services/sync/fakeGitHub";
import { gitBlobSha } from "@kitelev/exocortex-core";
import { Command } from "commander";
import {
  runQuarantineList,
  runQuarantineResolve,
  runDedupUids,
  planDedupGroup,
  normalizeForCompare,
  registerQuarantineCommands,
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

  // ── req 85630457: the hint must PARSE, not merely read well ────────────────
  //
  // ⛔ These axes derive the expectation from the LIVE command definition
  //    (`registeredArguments` / `options`), never from a literal copy of the
  //    hint. A literal expectation would pass while the command's real arity
  //    drifts underneath it — exactly the divergence that produced #4206.

  /** The real `exosync quarantine resolve` sub-command, as the CLI registers it. */
  function liveResolveCommand(): Command {
    const exosync = new Command("exosync");
    registerQuarantineCommands(exosync);
    const quarantine = exosync.commands.find((c) => c.name() === "quarantine");
    const resolve = quarantine?.commands.find((c) => c.name() === "resolve");
    if (resolve === undefined) {
      throw new Error("BROKEN: sub-command `resolve` not registered");
    }
    return resolve;
  }

  /**
   * Walk the printed hint the way Commander walks argv: a flag that DECLARES a
   * value swallows the next token; everything else is a positional.
   *
   * ⛔ Which flags swallow is read off the LIVE command, not guessed — otherwise
   *    the parser here would drift from the parser that actually rejects the
   *    user's paste.
   *
   * ⛤ Measured, not assumed. Against the pre-fix hint the OLD parser (counting
   *    placeholders "up to the first flag") went red on 1 of the 2 @req axes,
   *    this one goes red on both:
   *
   *      old parser + pre-fix hint → 1 failed  (only "--file spelling")
   *      this parser + pre-fix hint → 2 failed (+ "positionals `resolve` declares")
   *
   *    So the stray `<path>` after `--take` was HALF-covered, not uncovered — an
   *    earlier draft of this comment claimed the old axis missed #4206 "entirely",
   *    which the two runs above refute. The gain is the positional count itself:
   *    without it a stray placeholder that happens to spell an existing flag's
   *    value stays invisible.
   */
  function parseHint(
    lines: string[],
    cmd: Command,
  ): { positionals: string[]; flags: string[] } {
    const hint = lines.find((l) => l.startsWith("Resolve with:"));
    if (hint === undefined) {
      throw new Error("BROKEN: hint line not printed");
    }
    const takesValue = new Map(
      cmd.options.map((o) => [o.long, o.required || o.optional]),
    );
    const tokens = hint.split(/\s+/);
    const after = tokens.slice(tokens.indexOf("resolve") + 1);
    const positionals: string[] = [];
    const flags: string[] = [];
    for (let i = 0; i < after.length; i += 1) {
      const token = after[i];
      if (token.startsWith("--")) {
        flags.push(token);
        if (takesValue.get(token) === true) i += 1; // its value, not a positional
        continue;
      }
      positionals.push(token);
    }
    return { positionals, flags };
  }

  async function hintLines(): Promise<string[]> {
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL edit"),
    });
    const lines: string[] = [];
    try {
      await runQuarantineList({ vault: fx.vault, token: FAKE_PAT }, deps(fx.gh, lines));
      return lines;
    } finally {
      fx.cleanup();
    }
  }

  it("@req:85630457-1bda-4ea8-b0df-b3df6cf0a335 hint carries exactly the positionals `resolve` declares", async () => {
    const resolveCmd = liveResolveCommand();
    const { positionals } = parseHint(await hintLines(), resolveCmd);
    // Derived from prod, not asserted as a constant: if `resolve` ever gains a
    // second positional, this follows it instead of going stale.
    expect(positionals).toHaveLength(resolveCmd.registeredArguments.length);
  });

  it("@req:85630457-1bda-4ea8-b0df-b3df6cf0a335 every flag the hint prints is declared on `resolve`", async () => {
    const resolveCmd = liveResolveCommand();
    const { flags } = parseHint(await hintLines(), resolveCmd);
    const declared = resolveCmd.options.map((o) => o.long);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.filter((f) => !declared.includes(f))).toEqual([]);
  });

  it("@req:85630457-1bda-4ea8-b0df-b3df6cf0a335 the merge choice is spelled with its `--file` flag", async () => {
    const text = (await hintLines()).join("\n");
    expect(text).toMatch(/--take file[^\n]*--file <[^>]+>/);
  });

  it("@req:85630457-1bda-4ea8-b0df-b3df6cf0a335 prints no hint when there is nothing to resolve", async () => {
    const same = mdAsset("uid-1", "converged");
    const fx = await makeConflictVault({ base: mdAsset("uid-1", "old"), local: same });
    fx.gh.commitDirect("main", { [CONFLICT]: same }, "converge");
    const lines: string[] = [];
    try {
      await runQuarantineList({ vault: fx.vault, token: FAKE_PAT }, deps(fx.gh, lines));
      expect(lines.some((l) => l.startsWith("Resolve with:"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

describe("exosync quarantine resolve", () => {
  it("--take local applies to disk and DEFERS the push to the next sync (offline-first, PR-3b)", async () => {
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
      // Disk holds the chosen (local) content immediately.
      expect(readFileSync(path.join(fx.vault, MOUNT, CONFLICT), "utf-8")).toBe(local);
      // The convergent push is DEFERRED — the remote is NOT touched at resolve
      // time (the engine flushes the outbox on the next `exosync sync`).
      expect(fx.gh.headFiles().get(CONFLICT)).toBe(fx.remote);
      expect(lines.join("\n")).toMatch(/Resolved alpha\.md \(local\)/);
      expect(lines.join("\n")).toMatch(/awaiting push/);
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
      const backup = path.join(fx.vault, MOUNT, `${CONFLICT}.conflict.local.txt`);
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

/** Deterministic uuid generator for the pure-classifier unit tests. */
function mkSeq(): () => string {
  let n = 0;
  return () => `fresh-uuid-${++n}`;
}

describe("dedup-uids zero-loss classifier (planDedupGroup / normalizeForCompare)", () => {
  // ⛤ THE critical safety property: differing content is NEVER deleted.
  // Revert-verify: break `normalizeForCompare` (e.g. collapse the body) so it
  // treats distinct notes as identical → this test goes RED (a delete is
  // emitted for differing content). Restore → GREEN.
  it("SAFETY: never plans a delete for content that differs from every kept copy", () => {
    const decisions = planDedupGroup(
      "dupe-uid",
      [
        { path: "a.md", content: mdAsset("dupe-uid", "alpha body") },
        { path: "b.md", content: mdAsset("dupe-uid", "BETA body — totally different") },
      ],
      mkSeq(),
    );
    // No delete for differing content — both variants must survive.
    expect(decisions.filter((d) => d.action === "delete")).toHaveLength(0);
    expect(decisions.some((d) => d.action === "keep")).toBe(true);
    expect(decisions.some((d) => d.action === "reuuid")).toBe(true);
  });

  it("plans a DELETE only for a whitespace-identical copy (zero-loss); keeps the lexicographic-first", () => {
    const base = mdAsset("dupe-uid", "same body");
    // b is identical to a save for CRLF line endings + trailing blank lines.
    const crlfCopy = base.replace(/\n/g, "\r\n") + "\n\n";
    const decisions = planDedupGroup(
      "dupe-uid",
      [
        { path: "b.md", content: crlfCopy },
        { path: "a.md", content: base },
      ],
      mkSeq(),
    );
    const deletes = decisions.filter((d) => d.action === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatchObject({ path: "b.md", identicalTo: "a.md" });
    expect(decisions.find((d) => d.action === "keep")?.path).toBe("a.md");
    expect(decisions.some((d) => d.action === "reuuid")).toBe(false);
  });

  it("byte-identical duplicates: keep the first, delete the rest", () => {
    const note = mdAsset("dupe-uid", "identical");
    const decisions = planDedupGroup(
      "dupe-uid",
      [
        { path: "x/a.md", content: note },
        { path: "x/b.md", content: note },
        { path: "x/c.md", content: note },
      ],
      mkSeq(),
    );
    expect(decisions.find((d) => d.action === "keep")?.path).toBe("x/a.md");
    expect(decisions.filter((d) => d.action === "delete").map((d) => d.path)).toEqual([
      "x/b.md",
      "x/c.md",
    ]);
    expect(decisions.some((d) => d.action === "reuuid")).toBe(false);
  });

  it("mixed group: identical copy → delete, distinct variant → re-uuid (both survive)", () => {
    const v1 = mdAsset("dupe-uid", "variant ONE");
    const decisions = planDedupGroup(
      "dupe-uid",
      [
        { path: "a.md", content: v1 },
        { path: "b.md", content: v1 }, // identical to a
        { path: "c.md", content: mdAsset("dupe-uid", "variant TWO — different") },
      ],
      mkSeq(),
    );
    expect(decisions.find((d) => d.action === "keep")?.path).toBe("a.md");
    expect(decisions.filter((d) => d.action === "delete").map((d) => d.path)).toEqual(["b.md"]);
    const reuuid = decisions.filter((d) => d.action === "reuuid");
    expect(reuuid).toHaveLength(1);
    expect(reuuid[0]).toMatchObject({ path: "c.md", fromUid: "dupe-uid" });
  });

  it("normalizeForCompare collapses ONLY line-endings + trailing blanks, never field values or content", () => {
    const a = "---\nexo__Asset_uid: x\n---\n\nbody\n";
    // same content: only CRLF vs LF + trailing blank lines differ (not data)
    const b = "---\r\nexo__Asset_uid: x\r\n---\r\n\r\nbody\r\n\r\n";
    expect(normalizeForCompare(a)).toBe(normalizeForCompare(b));
    // a differing timestamp value is NOT collapsed → stays distinct
    const c = "---\nexo__Asset_uid: x\nexo__Asset_updatedAt: 2026-01-01\n---\n\nbody\n";
    const d = "---\nexo__Asset_uid: x\nexo__Asset_updatedAt: 2026-02-02\n---\n\nbody\n";
    expect(normalizeForCompare(c)).not.toBe(normalizeForCompare(d));
    // Conservative: a trailing-whitespace difference (Markdown hard line break
    // is two trailing spaces) is NOT collapsed → DIFFERING → re-uuid, not delete.
    const e = "---\nexo__Asset_uid: x\n---\n\nline one\nline two\n";
    const f = "---\nexo__Asset_uid: x\n---\n\nline one  \nline two\n";
    expect(normalizeForCompare(e)).not.toBe(normalizeForCompare(f));
  });
});

describe("exosync dedup-uids --auto (zero-loss auto-resolve, e2e disk)", () => {
  it("--auto is DRY-RUN by default — prints the plan, changes nothing (exit 1)", async () => {
    const note = mdAsset("dupe-uid", "identical content");
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL"),
      extraMount: { "dup-a.md": note, "dup-b.md": note },
    });
    try {
      const lines: string[] = [];
      const code = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT, auto: true },
        deps(fx.gh, lines),
      );
      expect(code).toBe(1); // dups still present
      const out = lines.join("\n");
      expect(out).toMatch(/DRY-RUN/);
      expect(out).toMatch(/DELETE\s+.*dup-b\.md/);
      // nothing mutated
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-a.md"))).toBe(true);
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-b.md"))).toBe(true);
      expect(readFileSync(path.join(fx.vault, MOUNT, "dup-b.md"), "utf-8")).toBe(note);
    } finally {
      fx.cleanup();
    }
  });

  it("--auto --apply deletes a byte-identical copy, keeping the canonical content (zero-loss)", async () => {
    const note = mdAsset("dupe-uid", "the surviving content");
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL"),
      extraMount: { "dup-a.md": note, "dup-b.md": note },
    });
    try {
      const lines: string[] = [];
      const code = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT, auto: true, apply: true },
        deps(fx.gh, lines),
      );
      expect(code).toBe(0);
      // lexicographic-first kept, the rest deleted; content preserved verbatim
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-a.md"))).toBe(true);
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-b.md"))).toBe(false);
      expect(readFileSync(path.join(fx.vault, MOUNT, "dup-a.md"), "utf-8")).toBe(note);
      expect(lines.join("\n")).toMatch(/deleted .*dup-b\.md/);
    } finally {
      fx.cleanup();
    }
  });

  it("SAFETY e2e: --auto --apply NEVER deletes differing content — re-uuids instead, both survive intact", async () => {
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL"),
      extraMount: {
        "dup-a.md": mdAsset("dupe-uid", "note A — keep me"),
        "dup-b.md": mdAsset("dupe-uid", "note B — DIFFERENT, must never be deleted"),
      },
    });
    try {
      const lines: string[] = [];
      const code = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT, auto: true, apply: true },
        deps(fx.gh, lines),
      );
      expect(code).toBe(0);
      // BOTH files survive — differing content is re-uuid'd, never deleted.
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-a.md"))).toBe(true);
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-b.md"))).toBe(true);
      const a = readFileSync(path.join(fx.vault, MOUNT, "dup-a.md"), "utf-8");
      const b = readFileSync(path.join(fx.vault, MOUNT, "dup-b.md"), "utf-8");
      expect(a).toContain("note A — keep me");
      expect(b).toContain("note B — DIFFERENT, must never be deleted");
      // distinct uids now: anchor keeps the original, the variant gets a fresh one
      expect(a).toMatch(/^exo__Asset_uid: dupe-uid$/m);
      expect(b).not.toMatch(/^exo__Asset_uid: dupe-uid$/m);
      expect(b).toMatch(/^exo__Asset_uid: [0-9a-f-]{36}$/m);
      const out = lines.join("\n");
      expect(out).toMatch(/re-uuid .*dup-b\.md/);
      // No file was actually deleted — only the summary counter mentions "deleted 0".
      expect(out).not.toMatch(/deleted \S+\.md/);
      expect(out).toMatch(/deleted 0 identical/);
    } finally {
      fx.cleanup();
    }
  });

  it("--auto --apply mixed group: delete the identical copy AND re-uuid the distinct variant; idempotent", async () => {
    const v1 = mdAsset("dupe-uid", "variant ONE");
    const fx = await makeConflictVault({
      base: mdAsset("uid-1", "base"),
      local: mdAsset("uid-1", "LOCAL"),
      extraMount: {
        "dup-a.md": v1,
        "dup-b.md": v1, // byte-identical to a → delete
        "dup-c.md": mdAsset("dupe-uid", "variant TWO — different"), // distinct → re-uuid
      },
    });
    try {
      const lines: string[] = [];
      const code = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT, auto: true, apply: true },
        deps(fx.gh, lines),
      );
      expect(code).toBe(0);
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-a.md"))).toBe(true); // anchor kept
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-b.md"))).toBe(false); // identical → deleted
      expect(existsSync(path.join(fx.vault, MOUNT, "dup-c.md"))).toBe(true); // distinct → re-uuid'd
      const c = readFileSync(path.join(fx.vault, MOUNT, "dup-c.md"), "utf-8");
      expect(c).toContain("variant TWO — different");
      expect(c).toMatch(/^exo__Asset_uid: [0-9a-f-]{36}$/m);
      expect(c).not.toMatch(/^exo__Asset_uid: dupe-uid$/m);

      // Idempotent: a second pass finds no duplicates.
      const lines2: string[] = [];
      const again = await runDedupUids(
        { vault: fx.vault, token: FAKE_PAT },
        deps(fx.gh, lines2),
      );
      expect(again).toBe(0);
      expect(lines2.join("\n")).toMatch(/No duplicate uids/);
    } finally {
      fx.cleanup();
    }
  });
});
