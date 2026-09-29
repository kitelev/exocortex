#!/usr/bin/env -S npx tsx
/**
 * issue #4444 — the DELIVERED-PREVIEW half of `--dry-run` for the three remaining
 * commands that wrote an UNBOUNDED preview to stderr and then called
 * `process.exit(0)`: `set-property`, `remove-property`, `create`. Through a REAL
 * stderr PIPE, on the BUILT bundle.
 *
 * The jest axes mock `process.stderr.write` and `process.exit`, so no pipe and no
 * flush is ever exercised: they judge the intermediate record, and the product of
 * `--dry-run` is the DELIVERED preview (integration-test-revert-verify §A66). A
 * harness is the only form that can see it, and it needs the CLI built — which the
 * CLI jest job does not do — so it runs locally and under the mutant driver, not in
 * CI (same shape as set-body-4436-pipe.harness.ts and
 * get-body-9de09856-pipe.harness.ts, which fixed the two siblings).
 *
 *   npx tsx packages/cli/tests/integration/dryrun-4444-pipe.harness.ts [--dist <index.js>] [--no-build]
 *
 * Why it exists — measured on the shipped pattern with a 605 686-byte asset
 * (stderr captured ALONE; stdout fully separated, see §measurement note below):
 *
 *     command            stderr → FILE   stderr → PIPE     lost
 *     set-property         605 729          73 728         87.8 %
 *     remove-property      605 708          73 728         87.8 %
 *     create               605 895          65 536         89.2 %
 *
 * `process.exit` does not wait for an asynchronous write, and stderr IS
 * asynchronous when it is a pipe. `--dry-run` exists to be READ BEFORE APPLYING,
 * so a silently truncated preview is a decision surface that lies: the operator
 * sees a document ending where the buffer ended and concludes the asset is shorter
 * than it is (dry-run-preview-not-real-output). The tail marker is absent in all
 * three truncated previews, so "complete" is checked by CONTENT, not only length.
 *
 * ⛤ #4444 measured the two property verbs and named `create` by code identity
 * ("НЕ мерен"); the create row above is this harness's own measurement.
 *
 * ⛔ MEASUREMENT NOTE, because getting it wrong inverts the verdict: stderr must be
 * captured with stdout FULLY SEPARATED. The shell form `cmd 2>&1 >/dev/null | cat`
 * looks like "stderr only" and is not — under zsh MULTIOS stdout is duplicated into
 * the same pipe, so the ~178-byte stdout JSON echo lands inside the "delivered
 * preview" and inflates it (first pass of this measurement reported 65 714 instead
 * of 73 728/65 536 for exactly that reason). Every axis below therefore uses
 * `stdio: ["ignore", "ignore", "pipe"]` — two distinct OS handles, no shell.
 *
 * ⛤ HOW THE EXPECTATION IS ESTABLISHED, and its honest limit. The load-bearing
 * expectation is COMPUTED FROM THE FIXTURE, not read back from the subject: the
 * preview must contain the ENTIRE body this harness wrote, tail marker included,
 * and be at least that many bytes. A truncated preview cannot satisfy it. On top of
 * that, `set-property` / `remove-property` accept `--frozen-clock`, so their
 * preview is deterministic and the PIPE and FILE runs must be byte-identical. ⛔
 * `create` has no `--frozen-clock` and mints a fresh uid, so its two runs differ by
 * design — its byte-equality axis compares them after canonicalising the uid,
 * `createdAt` and `updatedAt`. Byte-computing the full expected document here was
 * rejected deliberately: canonical property ordering lives in core, and a second
 * implementation in a harness is free to drift from the one under test
 * (test-fixture-realism).
 *
 * Axes — six per command, same shape in each block:
 *   set-property     T1  T2  T3  T4  T5  T6
 *   remove-property  T7  T8  T9  T10 T11 T12
 *   create           T13 T14 T15 T16 T17 T18
 *
 *   ·1  a >64 KiB `--dry-run` preview arrives COMPLETE through a stderr PIPE
 *   ·2  the same preview arrives complete through a FILE (control: isolates "pipe
 *       handling" from "building the preview at all" — a mutant that broke the
 *       preview itself reddens both)
 *   ·3  `--dry-run` changed nothing on disk and still exited 0 (a preview must not
 *       become a write)
 *   ·4  the real, non-dry-run path through a pipe is unaffected: stdout echo
 *       parses, the effect on disk is correct, rc=0
 *   ·5  a reader that LEAVES EARLY gets rc=0 and no EPIPE stack trace — the paired
 *       half of dropping the exit (#4443 round-1 / #4447)
 *   ·6  nothing holds the event loop open: every path above terminated naturally,
 *       well inside the budget, with its exit code unchanged
 *
 * Prints `✅ T<n>` / `❌ T<n>` per axis and `PASS=<n> FAIL=<n>`; exit 1 on failure.
 */
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// fileURLToPath, not new URL().pathname — the latter is not percent-decoded, so a
// tree path containing a space would resolve wrongly.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PKG = path.resolve(HERE, "../..");
const TREE = path.resolve(CLI_PKG, "../..");

const argv = process.argv.slice(2);
const distFlag = argv.indexOf("--dist");
const DIST =
  distFlag >= 0
    ? path.resolve(argv[distFlag + 1])
    : path.join(CLI_PKG, "dist/index.js");
const NO_BUILD = argv.includes("--no-build");

/** Generous per-run budget. Axis ·6 asserts the far tighter real figure. */
const RUN_TIMEOUT_MS = 120_000;
/** Natural termination budget for axis ·6 — measured runs land near 0.3 s. */
const NATURAL_TERMINATION_BUDGET_MS = 20_000;

let pass = 0;
let fail = 0;
const ok = (name: string, msg = ""): void => {
  pass += 1;
  console.log(`✅ ${name}${msg ? " — " + msg : ""}`);
};
const bad = (name: string, msg: string): void => {
  fail += 1;
  console.log(`❌ ${name} — ${msg}`);
};

/** Rebuild so a MUTATED copy of the tree is measured, not a stale bundle. */
if (!NO_BUILD) {
  const r = spawnSync("npm", ["run", "build", "-w", "@kitelev/exocortex-cli"], {
    cwd: TREE,
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    console.log(`❌ BUILD — rc=${r.status}\n${(r.stderr || "").slice(-2000)}`);
    process.exit(1);
  }
}
if (!fs.existsSync(DIST)) {
  console.log(`❌ BUILD — no bundle at ${DIST}`);
  process.exit(1);
}

// ---- fixture vault ---------------------------------------------------------
const vault = fs.mkdtempSync(path.join(os.tmpdir(), "dryrun-4444-"));
const REL_DIR = "assetspaces/kitelev/exoas-my/tasks";
fs.mkdirSync(path.join(vault, REL_DIR), { recursive: true });

const FROZEN = "2026-01-02T03:04:05";
const TAIL_MARKER = "==ХВОСТ-ДОЕХАЛ==";
/**
 * ~300 KiB of Cyrillic prose — comfortably past the pipe buffer where the
 * truncation appears (measured at 64 and 72 KiB depending on the command, so the
 * fixture must clear the larger one by a wide margin), and multi-byte so a
 * byte/char confusion cannot hide in it. The tail carries a unique marker, which is
 * what makes "complete" a statement about CONTENT.
 */
const bigBody =
  "Наули — практика, и эта строка повторяется много раз, чтобы предпросмотр вышел за буфер пайпа.\n".repeat(
    3500,
  ) + `${TAIL_MARKER}\n`;
const BIG_BODY_BYTES = Buffer.byteLength(bigBody, "utf8");

const bodyFile = path.join(vault, "big-body.md");
fs.writeFileSync(bodyFile, bigBody);

/** One asset per command block, so the blocks cannot interfere via shared state. */
const UIDS = {
  setProperty: "b1b1b1b1-0000-4000-8000-000000000001",
  removeProperty: "b2b2b2b2-0000-4000-8000-000000000002",
} as const;

const assetRel = (uid: string): string => `${REL_DIR}/${uid}.md`;
const seedAsset = (uid: string): void => {
  const fm =
    `---\nexo__Asset_uid: ${uid}\n` +
    `exo__Asset_label: "Dry-run pipe fixture"\n` +
    `exo__Asset_updatedAt: 2020-01-01T00:00:00\n` +
    `exo__Asset_note: "old"\n---\n`;
  fs.writeFileSync(path.join(vault, assetRel(uid)), fm + bigBody);
};
seedAsset(UIDS.setProperty);
seedAsset(UIDS.removeProperty);

interface Run {
  rc: number;
  /** stderr bytes ONLY — stdout goes to a separate handle and can never leak in. */
  err: Buffer;
  /** stdout bytes ONLY. */
  out: Buffer;
  ms: number;
}

/** stderr as a genuine PIPE, stdout as a genuine and SEPARATE pipe. No shell. */
function runPiped(args: string[]): Run {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [DIST, ...args], {
    cwd: TREE,
    maxBuffer: 64 * 1024 * 1024,
    // ⛔ A timeout is load-bearing, not hygiene: natural termination is exactly the
    // property this harness measures, so a subject that HANGS is the expected
    // failure mode — and without a timeout the harness hangs with it, which is
    // indistinguishable from "the axis does not differentiate"
    // (integration-test-revert-verify §A70/§A116). rc 124/null is reported as red.
    timeout: RUN_TIMEOUT_MS,
  });
  return {
    rc: r.status ?? -1,
    err: r.stderr ?? Buffer.alloc(0),
    out: r.stdout ?? Buffer.alloc(0),
    ms: Date.now() - t0,
  };
}

/** stderr redirected to a FILE — the control channel. */
function runToFile(args: string[], outFile: string): Run {
  const t0 = Date.now();
  const fd = fs.openSync(outFile, "w");
  const r = spawnSync(process.execPath, [DIST, ...args], {
    cwd: TREE,
    stdio: ["ignore", "pipe", fd],
    timeout: RUN_TIMEOUT_MS,
  });
  fs.closeSync(fd);
  return {
    rc: r.status ?? -1,
    err: fs.readFileSync(outFile),
    out: r.stdout ?? Buffer.alloc(0),
    ms: Date.now() - t0,
  };
}

/**
 * Canonicalise the fields that legitimately differ between two runs of a command
 * WITHOUT `--frozen-clock` (only `create`): the minted uid and the two timestamps.
 */
const canonicalise = (s: string): string =>
  s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<UID>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, "<TS>");

/** Byte-count of every .md under the vault — a cheap "nothing was created" probe. */
function markdownFiles(): string[] {
  const acc: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) acc.push(p);
    }
  };
  walk(vault);
  return acc.sort();
}

interface Block {
  /** Axis ids: [pipe, file, dryRunReadOnly, realPath, earlyReader, natural]. */
  ids: [string, string, string, string, string, string];
  label: string;
  /** `--dry-run` argv, WITHOUT --vault/--dry-run (added by the runner). */
  dryRun: string[];
  /** The real, mutating argv (no --dry-run). */
  real: string[];
  /** Verifies the real run's effect on disk; returns null when correct. */
  checkRealEffect: (echo: string) => string | null;
  /** Deterministic preview? (`--frozen-clock` available) */
  deterministic: boolean;
}

const spRel = assetRel(UIDS.setProperty);
const rpRel = assetRel(UIDS.removeProperty);

const BLOCKS: Block[] = [
  {
    ids: ["T1", "T2", "T3", "T4", "T5", "T6"],
    label: "set-property",
    deterministic: true,
    dryRun: [
      "set-property", spRel,
      "--property", "exo__Asset_note", "--value", "NEW",
      "--frozen-clock", FROZEN,
    ],
    real: [
      "set-property", spRel,
      "--property", "exo__Asset_note", "--value", "NEW",
      "--frozen-clock", FROZEN,
    ],
    checkRealEffect: (echo) => {
      const onDisk = fs.readFileSync(path.join(vault, spRel), "utf-8");
      // ⛔ Quoting is the WRITER's choice, not this axis's business: set-property
      // serialises a bare word unquoted (`exo__Asset_note: NEW`) while the fixture
      // seeded it quoted. Asserting `"NEW"` made this axis red against a CORRECT
      // subject on its first run — the axis, not the command, was wrong.
      if (!/^exo__Asset_note:[ \t]*"?NEW"?[ \t]*$/m.test(onDisk))
        return "the new value is not on disk";
      if (!onDisk.includes(TAIL_MARKER)) return "the body tail was lost by the write";
      if (!echo.includes('"changed":true')) return `echo did not report changed:true: ${echo.slice(0, 160)}`;
      return null;
    },
  },
  {
    ids: ["T7", "T8", "T9", "T10", "T11", "T12"],
    label: "remove-property",
    deterministic: true,
    dryRun: [
      "remove-property", rpRel,
      "--property", "exo__Asset_note",
      "--frozen-clock", FROZEN,
    ],
    real: [
      "remove-property", rpRel,
      "--property", "exo__Asset_note",
      "--frozen-clock", FROZEN,
    ],
    checkRealEffect: (echo) => {
      const onDisk = fs.readFileSync(path.join(vault, rpRel), "utf-8");
      if (onDisk.includes("exo__Asset_note:")) return "the property is still on disk";
      if (!onDisk.includes(TAIL_MARKER)) return "the body tail was lost by the write";
      if (!echo.includes('"removed":true')) return `echo did not report removed:true: ${echo.slice(0, 160)}`;
      return null;
    },
  },
  {
    ids: ["T13", "T14", "T15", "T16", "T17", "T18"],
    label: "create",
    deterministic: false,
    dryRun: [
      "create",
      "--class", "1b20a8f0-d745-4e93-91db-4531b3df120e",
      "--label", "Dry-run pipe probe",
      "--body-file", bodyFile,
      "--skip-wikilink-validation",
    ],
    real: [
      "create",
      "--class", "1b20a8f0-d745-4e93-91db-4531b3df120e",
      "--label", "Dry-run pipe probe (real)",
      "--body-file", bodyFile,
      "--skip-wikilink-validation",
    ],
    checkRealEffect: (echo) => {
      let parsed: { path?: string };
      try {
        parsed = JSON.parse(echo) as { path?: string };
      } catch (e) {
        return `stdout echo did not parse: ${(e as Error).message}`;
      }
      if (!parsed.path) return "echo carried no path";
      const created = path.join(vault, parsed.path);
      if (!fs.existsSync(created)) return `the echoed path does not exist: ${parsed.path}`;
      const onDisk = fs.readFileSync(created, "utf-8");
      if (!onDisk.includes(TAIL_MARKER)) return "the created asset lost the body tail";
      return null;
    },
  },
];

/**
 * Collected for axis ·6 — every run of a block with its wall time and exit code.
 * `rcOwnedByAnotherAxis` marks a run whose EXIT CODE is another axis's verdict; ·6
 * still checks its wall time (that is ·6's own subject) but must not re-judge its rc.
 */
interface Timing {
  what: string;
  ms: number;
  rc: number;
  rcOwnedByAnotherAxis?: boolean;
}
const timings: Record<string, Timing[]> = {};

for (const block of BLOCKS) {
  const [idPipe, idFile, idReadOnly, idReal, , idNatural] = block.ids;
  const t: Timing[] = [];
  timings[idNatural] = t;

  const dryArgs = [...block.dryRun, "--vault", vault, "--dry-run"];

  // ---- ·2 FILE control FIRST: it is the oracle the pipe run is compared against,
  //         and it also proves the preview is built at all.
  const fileOut = path.join(vault, `${block.label}.preview`);
  const fileRun = runToFile(dryArgs, fileOut);
  t.push({ what: "--dry-run → file", ms: fileRun.ms, rc: fileRun.rc });
  const fileText = fileRun.err.toString("utf-8");
  if (fileRun.rc !== 0) bad(idFile, `rc=${fileRun.rc}`);
  else if (!fileText.includes(TAIL_MARKER))
    bad(idFile, "the FILE preview is missing the fixture tail marker — the preview itself is broken");
  else if (fileRun.err.length < BIG_BODY_BYTES)
    bad(idFile, `FILE preview ${fileRun.err.length} B < the ${BIG_BODY_BYTES} B body it must contain`);
  else ok(idFile, `${fileRun.err.length} B to a file (control), tail intact`);

  // ---- ·1 the same preview through a real stderr PIPE
  const pipeRun = runPiped(dryArgs);
  t.push({ what: "--dry-run → pipe", ms: pipeRun.ms, rc: pipeRun.rc });
  const pipeText = pipeRun.err.toString("utf-8");
  if (pipeRun.rc !== 0) bad(idPipe, `rc=${pipeRun.rc}; stderr tail=${pipeText.slice(-200)}`);
  else if (!pipeText.includes(TAIL_MARKER))
    bad(
      idPipe,
      `pipe delivered ${pipeRun.err.length} of ${fileRun.err.length} B and the tail marker is ABSENT` +
        ` (${((100 * (fileRun.err.length - pipeRun.err.length)) / Math.max(1, fileRun.err.length)).toFixed(1)}% lost)`,
    );
  else if (pipeRun.err.length < BIG_BODY_BYTES)
    bad(idPipe, `pipe preview ${pipeRun.err.length} B < the ${BIG_BODY_BYTES} B body it must contain`);
  else if (
    block.deterministic
      ? pipeText !== fileText
      : canonicalise(pipeText) !== canonicalise(fileText)
  )
    bad(
      idPipe,
      block.deterministic
        ? `pipe and file previews differ under --frozen-clock (${pipeRun.err.length} vs ${fileRun.err.length} B)`
        : `pipe and file previews differ after canonicalising uid/timestamps (${pipeRun.err.length} vs ${fileRun.err.length} B)`,
    );
  else
    ok(
      idPipe,
      `${pipeRun.err.length} B through a stderr pipe, tail intact, ${block.deterministic ? "byte-identical to" : "canonically equal to"} the file control`,
    );

  // ---- ·3 --dry-run is read-only
  const before = markdownFiles().map((p) => `${p}:${fs.readFileSync(p).length}`);
  const roRun = runPiped(dryArgs);
  t.push({ what: "--dry-run (read-only probe)", ms: roRun.ms, rc: roRun.rc });
  const after = markdownFiles().map((p) => `${p}:${fs.readFileSync(p).length}`);
  if (roRun.rc !== 0) bad(idReadOnly, `rc=${roRun.rc}`);
  else if (before.join("|") !== after.join("|"))
    bad(idReadOnly, "the --dry-run preview changed the vault");
  else ok(idReadOnly, `vault byte-identical after --dry-run (${before.length} assets), rc=0`);

  // ---- ·4 the real path still works through a pipe
  const realRun = runPiped([...block.real, "--vault", vault]);
  t.push({ what: "real path → pipe", ms: realRun.ms, rc: realRun.rc });
  if (realRun.rc !== 0) bad(idReal, `rc=${realRun.rc}; stderr tail=${realRun.err.toString("utf-8").slice(-200)}`);
  else {
    const problem = block.checkRealEffect(realRun.out.toString("utf-8").trim());
    if (problem) bad(idReal, problem);
    else ok(idReal, "the real path is unaffected: echo parses, effect on disk correct, rc=0");
  }
}

// tsx transpiles this harness to CJS, where top-level await is unavailable — the
// early-reader axes and the verdict live in an async IIFE so the summary still
// prints AFTER the last axis.
void (async (): Promise<void> => {
  for (const block of BLOCKS) {
    const idEarly = block.ids[4];
    const idNatural = block.ids[5];
    const dryArgs = [...block.dryRun, "--vault", vault, "--dry-run"];

    // ---- ·5 a reader that LEAVES EARLY must not turn rc 0 into a crash ----------
    // The paired half of dropping process.exit(0): the exit used to terminate the
    // process synchronously, BEFORE the OS delivered the asynchronous EPIPE that a
    // closed reader causes. Dropping it makes that EPIPE reachable, and with no
    // 'error' listener Node turns it into an uncaught exception — rc=1 plus a stack
    // trace, on the very scenario the truncation fix exists for (`--dry-run | less`,
    // quit with `q`). Reddens when guardStdioAgainstClosedReader() is removed.
    const t0 = Date.now();
    const verdict = await new Promise<number | string>((done) => {
      const child = spawn(process.execPath, [DIST, ...dryArgs], {
        cwd: TREE,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let seen = 0;
      let stderrText = "";
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        done("timeout");
      }, RUN_TIMEOUT_MS);
      child.stderr.on("data", (chunk: Buffer) => {
        stderrText += chunk.toString("utf-8");
        seen += chunk.length;
        // Leave once a prefix has been read — exactly what `| head -c 200` or a
        // reader quitting `less` does to the writer still mid-preview.
        if (seen >= 200) child.stderr.destroy();
      });
      child.on("close", (code) => {
        clearTimeout(killer);
        done(
          code === 0 && /EPIPE|Unhandled 'error'/.test(stderrText)
            ? "epipe-trace"
            : (code ?? -1),
        );
      });
    });
    const earlyMs = Date.now() - t0;
    timings[idNatural].push({
      what: "--dry-run, reader leaves after 200 B",
      ms: earlyMs,
      rc: typeof verdict === "number" ? verdict : -1,
      // ⛔ EXCLUDED from axis ·6's exit-code check, deliberately. ·6 owns "did every
      // path terminate naturally" (a WALL-TIME statement, which this run must still
      // satisfy); the exit code of an early-closing reader is ·5's verdict and ·5's
      // alone. The first run of this spec proved why: dropping the guard reddened
      // BOTH ·5 and ·6 (M2 → [T5, T6] and [T11, T12], [T17, T18]) because ·6
      // re-judged the same rc — one defect, two red axes, and a prediction that
      // looked wrong when the axes were simply coupled
      // (integration-test-revert-verify §A44: red count is a statement about which
      // axes EXECUTE, not about the mutant's theme).
      rcOwnedByAnotherAxis: true,
    });
    if (verdict === 0) ok(idEarly, `reader left after 200 B — rc=0, no EPIPE crash (${earlyMs} ms)`);
    else if (verdict === "timeout") bad(idEarly, "the process hung after the reader left");
    else if (verdict === "epipe-trace")
      bad(idEarly, "rc=0 but an EPIPE stack trace reached the user");
    else
      bad(
        idEarly,
        `rc=${verdict} — an early-closing reader crashes the command (the guard is what keeps it 0)`,
      );

    // ---- ·6 nothing holds the event loop open ---------------------------------
    // Dropping process.exit(0) is only safe if the action has nothing pending when it
    // falls off its end. This axis asserts that EVERY run of the block terminated on
    // its own, well inside the budget — a run that only finished because of the 120 s
    // kill shows up here as an over-budget entry. It also checks the exit codes of the
    // runs it OWNS; the early-closing-reader run is excluded (its rc is axis ·5's
    // verdict), so one defect cannot redden two axes.
    const runs = timings[idNatural];
    const over = runs.filter((r) => r.ms > NATURAL_TERMINATION_BUDGET_MS);
    const badRc = runs.filter((r) => !r.rcOwnedByAnotherAxis && r.rc !== 0);
    if (runs.length < 5)
      bad(idNatural, `only ${runs.length} runs recorded — earlier axes did not execute`);
    else if (over.length > 0)
      bad(
        idNatural,
        `${over.length} run(s) exceeded ${NATURAL_TERMINATION_BUDGET_MS} ms: ` +
          over.map((r) => `${r.what}=${r.ms}ms`).join(", "),
      );
    else if (badRc.length > 0)
      bad(idNatural, `non-zero exit on: ${badRc.map((r) => `${r.what}=rc${r.rc}`).join(", ")}`);
    else
      ok(
        idNatural,
        `${runs.length} paths all terminated naturally, max ${Math.max(...runs.map((r) => r.ms))} ms; ` +
          `rc=0 on the ${runs.filter((r) => !r.rcOwnedByAnotherAxis).length} this axis owns`,
      );
  }

  fs.rmSync(vault, { recursive: true, force: true });
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
