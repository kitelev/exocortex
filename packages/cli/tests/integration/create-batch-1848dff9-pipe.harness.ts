#!/usr/bin/env -S npx tsx
/**
 * req 1848dff9 (issue #4347, `cli create-batch`) — the EARLY-CLOSING-READER half,
 * through a REAL PIPE on the BUILT bundle. Added by #4456.
 *
 * Why this harness exists at all. The jest axis that was supposed to cover this
 * (`B16` in create-batch.integration.test.ts) mocks `process.stdout.write` and then
 * synthesises the failure by emitting `'error'` on the mocked stream — so no pipe,
 * no real EPIPE and no flush is ever exercised. Measured on pristine
 * `origin/main`: removing `guardStdioAgainstClosedReader()` from
 * `createBatchCommand` reddened NOT ONE axis of the shipped suite, on two
 * independent trees (issue #4456). B16 observes the handler's POLICY — it reddens
 * when the handler rethrows EPIPE — but it cannot observe whether the handler is
 * INSTALLED at all, because something other than our listener keeps the emitted
 * event from failing the test. The delivered-effect half cannot live in jest by
 * construction (integration-test-revert-verify §A66); the same limit is already
 * documented by `helpers/exit-assertions.ts` and was solved the same way for the
 * siblings `set-body` (#4443), `get-body` (#4449) and the three `--dry-run` verbs
 * (#4451).
 *
 *   npx tsx packages/cli/tests/integration/create-batch-1848dff9-pipe.harness.ts [--dist <index.js>] [--no-build]
 *
 * ⛔ Like its three siblings, this harness runs LOCALLY and under the mutant
 * driver, NOT in CI: it needs the CLI built, which the CLI jest job does not do,
 * and it is not named `*-verify.{sh,py}` so verify-harness-runner does not sweep it
 * either (harness-invocation-surface §A19 — saying that inapplicability out loud
 * rather than leaving it to read as an oversight).
 *
 * MEASURED on the built bundle, 200-item batch, guard present vs `void 0;`
 * (2026-09-29, this harness's own probe):
 *
 *   scenario                                   guarded      guard removed
 *   reader reads both streams to EOF            rc=0         rc=0
 *   stdout reader gone before the echo          rc=0         rc=1 + EPIPE trace
 *   stdout reader gone after the 27 402 B echo  rc=0         rc=1 + EPIPE trace
 *   stderr reader gone mid-preview (--dry-run)  rc=0         rc=1
 *
 * In every red run all 200 files were ALREADY on disk — which is the whole point:
 * the batch's outcome is decided by the time anything is written, so EPIPE on stdio
 * means "the reader left", not "the batch failed", and an exit code of 1 tells an
 * agent to retry a batch that fully succeeded.
 *
 * Axes:
 *   C1 the REAL path with the stdout reader gone before the echo is written
 *      (`create-batch items.json --vault v | head -c 0`) — rc=0, every item still
 *      on disk, and no EPIPE stack trace reaching the user
 *   C2 `--dry-run` with the STDERR reader leaving mid-preview (`2>&1 | head`, the
 *      scenario M24's own note names) — rc=0 and the vault untouched
 *   C3 control: the same `--dry-run` read to EOF on BOTH streams — rc=0, the stdout
 *      echo PARSES with one entry per item, the stderr preview is complete. This is
 *      what makes C1/C2 statements about a departing READER rather than about
 *      running the batch at all: a mutant that broke the batch would redden C3 too.
 *   C4 canary: the already-guarded sibling `create --dry-run` under the IDENTICAL
 *      early-stderr probe returns rc=0. It lives in another file, so it stays green
 *      while C1/C2 redden — which is what distinguishes "the subject lost its
 *      guard" from "the probe is broken" (integration-test-revert-verify §A13).
 *
 * Prints `✅ C<n>` / `❌ C<n>` per axis and `PASS=<n> FAIL=<n>`; exit 1 on failure.
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

/** Generous per-run budget. Measured runs land near 0.3 s. */
const RUN_TIMEOUT_MS = 120_000;
/** Items per batch — the echo is ~137 B each, so 200 gives a ~27 KB stdout. */
const ITEMS = 200;
const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

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

// ---- fixture ---------------------------------------------------------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cb-pipe-"));
const itemsFile = path.join(scratch, "items.json");
fs.writeFileSync(
  itemsFile,
  JSON.stringify(
    Array.from({ length: ITEMS }, (_, i) => ({
      class: TASK_CLASS_UID,
      label: `Batch pipe item ${String(i).padStart(4, "0")}`,
    })),
  ),
);

/**
 * ~200 KiB of Cyrillic prose for the C4 canary: `create --dry-run` must write a
 * preview well past the pipe buffer, so a reader leaving after 200 B leaves the
 * writer mid-preview. Multi-byte, so a byte/char confusion cannot hide in it.
 */
const canaryBodyFile = path.join(scratch, "canary-body.md");
fs.writeFileSync(
  canaryBodyFile,
  "Наули — практика, и эта строка повторяется, чтобы предпросмотр вышел за буфер пайпа.\n".repeat(
    2200,
  ),
);

/** A fresh, empty vault per run — C1 counts what the run itself created. */
function freshVault(tag: string): string {
  const vault = fs.mkdtempSync(path.join(scratch, `${tag}-`));
  fs.mkdirSync(path.join(vault, "assetspaces/kitelev/exoas-my/tasks"), {
    recursive: true,
  });
  return vault;
}

/** Every `.md` under a vault — "what this run created", by CONTENT not by echo. */
function markdownFiles(vault: string): string[] {
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

type Leave = "none" | "stdout-before" | "stderr-mid";

interface Run {
  /** Exit code, or "timeout" when the process had to be killed. */
  rc: number | "timeout";
  /** Bytes the reader actually took off each stream before it left (if it left). */
  seenOut: number;
  seenErr: number;
  /** stdout text — only collected when the stdout reader stays to EOF. */
  outText: string;
  /** stderr text — only collected when the stderr reader stays to EOF. */
  errText: string;
}

/**
 * Run the built bundle with BOTH streams as genuine pipes and let one reader
 * LEAVE, the way `| head -c 0` and `2>&1 | head` do.
 *
 * ⛔ The timeout is load-bearing, not hygiene: natural termination is part of what
 * this harness measures, so a subject that HANGS is an expected failure mode — and
 * without a timeout the harness hangs with it, which is indistinguishable from "the
 * axis does not differentiate" (integration-test-revert-verify §A70/§A116).
 */
function runLeaving(args: string[], leave: Leave): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [DIST, ...args], {
      cwd: TREE,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let seenOut = 0;
    let seenErr = 0;
    let outText = "";
    let errText = "";
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ rc: "timeout", seenOut, seenErr, outText, errText });
    }, RUN_TIMEOUT_MS);
    // ⛔ Destroyed BEFORE the first byte, deliberately: on the real path the whole
    // stdout echo is one write at the very end, so a "leave after N bytes" reader
    // would never fire and the axis would depend on the pipe buffer size instead of
    // on the guard. Leaving up front is what `| head -c 0` does, and it is
    // deterministic on every platform.
    if (leave === "stdout-before") child.stdout.destroy();
    child.stdout.on("data", (chunk: Buffer) => {
      seenOut += chunk.length;
      if (leave !== "stdout-before") outText += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      seenErr += chunk.length;
      if (leave === "stderr-mid") {
        // Leave once a prefix has been read — exactly what `2>&1 | head` or a
        // reader quitting `less` does to the writer still mid-preview.
        if (seenErr >= 200) child.stderr.destroy();
      } else errText += chunk.toString("utf-8");
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      done({ rc: code ?? -1, seenOut, seenErr, outText, errText });
    });
  });
}

const EPIPE_TRACE = /EPIPE|Unhandled 'error'/;

// tsx transpiles this harness to CJS, where top-level await is unavailable — every
// axis and the verdict live in an async IIFE so the summary prints AFTER the last one.
void (async (): Promise<void> => {
  // ---- C1: the REAL path, stdout reader gone before the echo -----------------
  {
    const vault = freshVault("c1");
    const r = await runLeaving(
      [
        "create-batch",
        itemsFile,
        "--vault",
        vault,
        "--skip-wikilink-validation",
      ],
      "stdout-before",
    );
    const written = markdownFiles(vault).length;
    if (r.rc === "timeout") bad("C1", "the process hung after the reader left");
    else if (r.rc !== 0)
      bad(
        "C1",
        `rc=${r.rc} although ${written} of ${ITEMS} item(s) were written — an early-closing reader turns a finished batch into a failure (the guard is what keeps it 0); stderr tail=${r.errText.slice(-300)}`,
      );
    else if (written !== ITEMS)
      bad(
        "C1",
        `rc=0 but only ${written} of ${ITEMS} item(s) reached the disk`,
      );
    else if (EPIPE_TRACE.test(r.errText))
      bad("C1", "rc=0 but an EPIPE stack trace reached the user");
    else
      ok(
        "C1",
        `reader gone before the echo — rc=0, all ${ITEMS} items written`,
      );
  }

  // ---- C2: --dry-run, stderr reader leaves mid-preview -----------------------
  // The scenario M24's own note names: "planning writes warnings to stderr long
  // before finish(), and `2>&1 | head` closes that pipe too."
  {
    const vault = freshVault("c2");
    const before = markdownFiles(vault).length;
    const r = await runLeaving(
      [
        "create-batch",
        itemsFile,
        "--vault",
        vault,
        "--dry-run",
        "--skip-wikilink-validation",
      ],
      "stderr-mid",
    );
    const after = markdownFiles(vault).length;
    if (r.rc === "timeout") bad("C2", "the process hung after the reader left");
    else if (r.rc !== 0)
      bad(
        "C2",
        `rc=${r.rc} after the stderr reader left at ${r.seenErr} B of the preview — the guard is what keeps it 0`,
      );
    else if (after !== before)
      bad("C2", `--dry-run created ${after - before} file(s)`);
    else
      ok(
        "C2",
        `stderr reader left at ${r.seenErr} B mid-preview — rc=0, vault untouched`,
      );
  }

  // ---- C3: control — both streams read to EOF --------------------------------
  {
    const vault = freshVault("c3");
    const before = markdownFiles(vault).length;
    const r = await runLeaving(
      [
        "create-batch",
        itemsFile,
        "--vault",
        vault,
        "--dry-run",
        "--skip-wikilink-validation",
      ],
      "none",
    );
    const after = markdownFiles(vault).length;
    if (r.rc !== 0)
      bad("C3", `rc=${r.rc}; stderr tail=${r.errText.slice(-300)}`);
    else if (after !== before)
      bad("C3", `--dry-run created ${after - before} file(s)`);
    else {
      let parsed: { uuid: string; path: string; label: string }[];
      try {
        parsed = JSON.parse(r.outText) as typeof parsed;
      } catch (e) {
        bad("C3", `the stdout echo did not parse: ${(e as Error).message}`);
        parsed = [];
      }
      if (parsed.length === 0) {
        /* already reported */
      } else if (parsed.length !== ITEMS)
        bad("C3", `the echo carried ${parsed.length} of ${ITEMS} item(s)`);
      else if (
        !r.errText.includes(
          `Batch pipe item ${String(ITEMS - 1).padStart(4, "0")}`,
        )
      )
        bad("C3", "the stderr preview is missing the last item");
      else
        ok(
          "C3",
          `both streams to EOF — rc=0, echo parses with ${parsed.length} items, ${r.seenErr} B of preview complete`,
        );
    }
  }

  // ---- C4: canary — an already-guarded sibling under the SAME probe ----------
  // `create` got this guard in #4451 and this harness does not mutate its file, so
  // C4 stays green while C1/C2 redden. That is what says "the probe is sound and
  // the subject is the difference" rather than "the probe broke".
  {
    const vault = freshVault("c4");
    const r = await runLeaving(
      [
        "create",
        "--class",
        TASK_CLASS_UID,
        "--label",
        "Canary for the create-batch pipe probe",
        "--body-file",
        canaryBodyFile,
        "--vault",
        vault,
        "--dry-run",
        "--skip-wikilink-validation",
      ],
      "stderr-mid",
    );
    if (r.rc === "timeout")
      bad("C4", "the guarded sibling hung after the reader left");
    else if (r.rc !== 0)
      bad(
        "C4",
        `rc=${r.rc} from the already-guarded sibling \`create --dry-run\` — the PROBE is broken, not the subject`,
      );
    else
      ok(
        "C4",
        `guarded sibling \`create --dry-run\` survives the same departure at ${r.seenErr} B (probe canary)`,
      );
  }

  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
