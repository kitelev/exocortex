#!/usr/bin/env -S npx tsx
/**
 * issue #4436 — the DELIVERED-BYTES half of `set-body --dry-run`, through a REAL
 * PIPE on the BUILT bundle. The jest axes mock `process.stderr.write` and
 * `process.exit`, so no pipe and no flush is ever exercised: they judge the
 * intermediate record, and the product of `--dry-run` is the delivered preview
 * (integration-test-revert-verify §A66). A harness is the only form that can see
 * it, and it needs the CLI built — which the CLI jest job does not do — so it runs
 * locally and under the mutant driver, not in CI (same shape as
 * get-body-9de09856-pipe.harness.ts, which fixed the sibling defect in #4434).
 *
 *   npx tsx packages/cli/tests/integration/set-body-4436-pipe.harness.ts [--dist <index.js>] [--no-build]
 *
 * Why this harness exists at all — measured on the shipped pattern
 * (`process.stderr.write(preview); … process.exit(0)`) with a 300 KiB body:
 *     stderr → FILE   549 709 bytes   (correct)
 *     stderr → PIPE    65 536 bytes   (88.1 % silently lost, tail marker absent)
 * `process.exit` does not wait for an asynchronous write, and stderr IS
 * asynchronous when it is a pipe. `--dry-run` exists to be READ BEFORE APPLYING,
 * so a silently truncated preview is a decision surface that lies: an operator
 * sees a document that ends where the buffer ended and concludes the body is
 * shorter than it is (dry-run-preview-not-real-output).
 *
 * ⛤ The stdout echo of set-body is ~120 bytes of JSON and can never truncate,
 * which is why this stayed invisible: the obvious channel is safe and the
 * truncating one is the diagnostic channel.
 *
 * Axes (the expected preview is COMPUTED HERE, before any run, from the fixture
 * plus the frozen clock — not read back from the subject):
 *   S1 a >64 KiB `--dry-run` preview arrives COMPLETE through a stderr PIPE
 *      (delivered bytes === expected bytes, tail marker and END line present)
 *   S2 the same preview arrives complete through a FILE redirect (control:
 *      isolates "pipe handling" from "rebuilding the document at all", and
 *      proves the expectation itself is right)
 *   S3 `--dry-run` leaves the file byte-identical and still exits 0 (control:
 *      the fix must not turn a preview into a write)
 *   S4 the real WRITE path through a pipe is unaffected — stdout echo parses,
 *      changed:true, bodyBytes correct, the file on disk is complete (control:
 *      a mutant that broke writing would redden this too)
 *   S5 a small preview still arrives complete (guards against a fix that only
 *      works above the buffer threshold)
 *   S6 the no-change path ("ℹ no change" on stderr) arrives and exits 0
 *      (control: the other stderr writer on the success path)
 *
 * Prints `✅ S<n>` / `❌ S<n>` per axis and `PASS=<n> FAIL=<n>`; exit 1 on failure.
 */
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { prepareBundleOrExit, runAxes } from "./helpers/pipe-harness-guards.js";

// fileURLToPath, not new URL().pathname — the latter is not percent-decoded, so a
// tree path containing a space would resolve wrongly.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PKG = path.resolve(HERE, "../..");
const TREE = path.resolve(CLI_PKG, "../..");

// `[--dist <index.js>] [--no-build]`, the rebuild, and the refusal to measure a
// bundle older than what it was built from all live in the shared guard module
// (issue #4464) — before it, `--no-build` checked only that the file existed, so
// a stale bundle was measured in silence (harness-invocation-surface §A8).
const DIST = prepareBundleOrExit(process.argv.slice(2), CLI_PKG);

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

// ---- fixture vault ---------------------------------------------------------
const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pipe-"));
const REL_DIR = "assetspaces/kitelev/exoas-my/tasks";
fs.mkdirSync(path.join(vault, REL_DIR), { recursive: true });

const BIG_UID = "b1b1b1b1-0000-4000-8000-000000000001";
const SMALL_UID = "5a5a5a5a-0000-4000-8000-000000000002";
const SAME_UID = "5a1e5a1e-0000-4000-8000-000000000003";
const bigRel = `${REL_DIR}/${BIG_UID}.md`;
const smallRel = `${REL_DIR}/${SMALL_UID}.md`;
const sameRel = `${REL_DIR}/${SAME_UID}.md`;

/**
 * 300 KiB of Cyrillic prose — comfortably past the 64 KiB pipe buffer where the
 * truncation appears, and multi-byte so a byte/char confusion cannot hide in it.
 * The tail carries a unique marker so "complete" is checked by CONTENT, not only
 * by length.
 */
const TAIL_MARKER = "==ХВОСТ-ДОЕХАЛ==";
const bigBody =
  "Наули — практика, и эта строка повторяется много раз, чтобы предпросмотр вышел за буфер пайпа.\n".repeat(
    3500,
  ) + `${TAIL_MARKER}\n`;
const smallBody = "Короткое тело.\n";

// A frozen clock makes the rebuilt document — and therefore the expected preview
// — deterministic, so the expectation is COMPUTED, never read back from the run.
const FROZEN_ISO = "2026-01-02T03:04:05Z";
const FROZEN_STAMP = "2026-01-02T03:04:05"; // UTC rendering of the instant above
const OLD_STAMP = "2020-01-01T00:00:00";

const fmFor = (uid: string, stamp: string): string =>
  `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: "Pipe fixture"\nexo__Asset_updatedAt: ${stamp}\n---`;

fs.writeFileSync(
  path.join(vault, bigRel),
  `${fmFor(BIG_UID, OLD_STAMP)}\nстарое тело\n`,
);
fs.writeFileSync(
  path.join(vault, smallRel),
  `${fmFor(SMALL_UID, OLD_STAMP)}\nстарое тело\n`,
);
// S6's fixture already carries EXACTLY the body it will be handed, so the run is
// a byte-identical no-op and takes the `!changed` branch.
fs.writeFileSync(
  path.join(vault, sameRel),
  `${fmFor(SAME_UID, OLD_STAMP)}\n${smallBody}`,
);

const bigBodyFile = path.join(vault, "big-body.md");
const smallBodyFile = path.join(vault, "small-body.md");
fs.writeFileSync(bigBodyFile, bigBody);
fs.writeFileSync(smallBodyFile, smallBody);

/** The preview set-body must emit, rebuilt here from the fixture + frozen clock. */
const previewFor = (uid: string, body: string): string =>
  `--- DRY RUN PREVIEW ---\n${fmFor(uid, FROZEN_STAMP)}\n${body}\n--- END PREVIEW ---\n`;

const expectedBigPreview = previewFor(BIG_UID, bigBody);
const expectedSmallPreview = previewFor(SMALL_UID, smallBody);
const expectedBigBytes = Buffer.byteLength(expectedBigPreview, "utf8");
const expectedSmallBytes = Buffer.byteLength(expectedSmallPreview, "utf8");

const dryRunArgs = (rel: string, bodyFile: string): string[] => [
  "set-body",
  rel,
  "--vault",
  vault,
  "--body-file",
  bodyFile,
  "--dry-run",
  "--skip-wikilink-validation",
  "--frozen-clock",
  FROZEN_ISO,
  "--timezone",
  "UTC",
];

/**
 * Run the CLI with stderr as a genuine PIPE (spawnSync captures through one) and
 * return the raw bytes. `maxBuffer` is raised so the harness itself cannot be the
 * thing that truncates — otherwise a green run would prove nothing.
 */
function runPiped(args: string[]): { rc: number; out: Buffer; err: Buffer } {
  const r = spawnSync(process.execPath, [DIST, ...args], {
    cwd: TREE,
    maxBuffer: 64 * 1024 * 1024,
    // ⛔ A timeout is load-bearing here, not hygiene: natural termination is exactly
    // the property this harness measures, so a subject that HANGS is the expected
    // failure mode — and without a timeout the harness hangs with it, which is
    // indistinguishable from "the axis does not differentiate"
    // (integration-test-revert-verify §A70/§A116). rc 124/null is reported as red.
    timeout: 120_000,
  });
  return {
    rc: r.status ?? -1,
    out: r.stdout ?? Buffer.alloc(0),
    err: r.stderr ?? Buffer.alloc(0),
  };
}

// tsx transpiles this harness to CJS, where top-level await is unavailable — S7 and
// the verdict live in an async IIFE so the summary still prints AFTER the last axis.
// The axes sit in their own function so the temp tree is removed from a
// `finally` (issue #4464): cleanup used to be the IIFE's last statement, so a
// throwing axis leaked the directory under os.tmpdir().
async function axes(): Promise<void> {
  // ---- S1: big preview through a stderr PIPE --------------------------------
  {
    const before = fs.readFileSync(path.join(vault, bigRel));
    const r = runPiped(dryRunArgs(bigRel, bigBodyFile));
    const got = r.err.length;
    const text = r.err.toString("utf-8");
    if (r.rc !== 0) bad("S1", `rc=${r.rc}; stderr tail=${text.slice(-300)}`);
    else if (got !== expectedBigBytes)
      bad(
        "S1",
        `pipe delivered ${got} of ${expectedBigBytes} bytes (${((100 * (expectedBigBytes - got)) / expectedBigBytes).toFixed(1)}% lost)`,
      );
    else if (!text.includes(TAIL_MARKER))
      bad("S1", "length matches but the tail marker is missing");
    else if (!text.endsWith("--- END PREVIEW ---\n"))
      bad("S1", "the preview does not end with the END PREVIEW line");
    else if (!before.equals(fs.readFileSync(path.join(vault, bigRel))))
      bad("S1", "--dry-run wrote the file");
    else ok("S1", `${got} bytes of preview through a stderr pipe, tail intact`);
  }

  // ---- S2: control — same preview through a FILE redirect -------------------
  {
    const errFile = path.join(vault, "big.err");
    const fd = fs.openSync(errFile, "w");
    const r = spawnSync(
      process.execPath,
      [DIST, ...dryRunArgs(bigRel, bigBodyFile)],
      { cwd: TREE, stdio: ["ignore", "ignore", fd], timeout: 120_000 },
    );
    fs.closeSync(fd);
    const delivered = fs.readFileSync(errFile);
    if (r.status !== 0) bad("S2", `rc=${r.status}`);
    else if (delivered.length !== expectedBigBytes)
      bad(
        "S2",
        `file got ${delivered.length} of ${expectedBigBytes} — the EXPECTATION is wrong, not the pipe`,
      );
    else if (!delivered.equals(Buffer.from(expectedBigPreview, "utf8")))
      bad(
        "S2",
        "byte length matches but the content differs from the expectation",
      );
    else
      ok("S2", `${delivered.length} bytes to a file, byte-identical (control)`);
  }

  // ---- S3: --dry-run is a preview, not a write ------------------------------
  {
    const before = fs.readFileSync(path.join(vault, bigRel));
    const r = runPiped(dryRunArgs(bigRel, bigBodyFile));
    const after = fs.readFileSync(path.join(vault, bigRel));
    const echo = r.out.toString("utf-8");
    if (r.rc !== 0) bad("S3", `rc=${r.rc}`);
    else if (!before.equals(after)) bad("S3", "--dry-run modified the asset");
    else if (!echo.includes('"changed":true'))
      bad(
        "S3",
        `stdout echo did not report the pending change: ${echo.trim().slice(0, 200)}`,
      );
    else
      ok(
        "S3",
        "file byte-identical after --dry-run, rc=0, echo reports changed:true",
      );
  }

  // ---- S4: control — the real WRITE path through a pipe ---------------------
  {
    const r = runPiped([
      "set-body",
      smallRel,
      "--vault",
      vault,
      "--body-file",
      bigBodyFile,
      "--skip-wikilink-validation",
      "--frozen-clock",
      FROZEN_ISO,
      "--timezone",
      "UTC",
    ]);
    const onDisk = fs.readFileSync(path.join(vault, smallRel), "utf-8");
    const wantDoc = `${fmFor(SMALL_UID, FROZEN_STAMP)}\n${bigBody}`;
    if (r.rc !== 0)
      bad("S4", `rc=${r.rc}; ${r.err.toString("utf-8").slice(-300)}`);
    else {
      try {
        const parsed = JSON.parse(r.out.toString("utf-8")) as {
          changed: boolean;
          bodyBytes: number;
        };
        if (parsed.changed !== true)
          bad("S4", "echo says changed:false on a real change");
        else if (parsed.bodyBytes !== Buffer.byteLength(bigBody, "utf8"))
          bad(
            "S4",
            `bodyBytes ${parsed.bodyBytes} != ${Buffer.byteLength(bigBody, "utf8")}`,
          );
        else if (onDisk !== wantDoc)
          bad(
            "S4",
            `written document differs (${Buffer.byteLength(onDisk, "utf8")} bytes on disk)`,
          );
        else
          ok(
            "S4",
            `write path intact: ${parsed.bodyBytes} bytes on disk (control)`,
          );
      } catch (e) {
        bad("S4", `stdout echo did not parse: ${(e as Error).message}`);
      }
    }
  }

  // ---- S5: small preview still complete -------------------------------------
  {
    const r = runPiped(dryRunArgs(smallRel, smallBodyFile));
    const got = r.err.length;
    if (r.rc !== 0) bad("S5", `rc=${r.rc}`);
    else if (got !== expectedSmallBytes)
      bad("S5", `small preview got ${got} of ${expectedSmallBytes}`);
    else ok("S5", `${got} bytes (below the buffer threshold)`);
  }

  // ---- S6: the no-change stderr notice arrives ------------------------------
  {
    const before = fs.readFileSync(path.join(vault, sameRel));
    const r = runPiped([
      "set-body",
      sameRel,
      "--vault",
      vault,
      "--body-file",
      smallBodyFile,
      "--skip-wikilink-validation",
      "--frozen-clock",
      FROZEN_ISO,
      "--timezone",
      "UTC",
    ]);
    const after = fs.readFileSync(path.join(vault, sameRel));
    const err = r.err.toString("utf-8");
    const echo = r.out.toString("utf-8");
    if (r.rc !== 0) bad("S6", `rc=${r.rc}`);
    else if (!err.includes("no change"))
      bad(
        "S6",
        `the no-change notice did not arrive: stderr=${JSON.stringify(err.slice(0, 200))}`,
      );
    else if (!echo.includes('"changed":false'))
      bad(
        "S6",
        `echo did not report changed:false: ${echo.trim().slice(0, 200)}`,
      );
    else if (!before.equals(after)) bad("S6", "a no-op rewrote the file");
    else ok("S6", "no-change notice delivered, file untouched, rc=0");
  }

  // ---- S7: a reader that LEAVES EARLY must not turn rc 0 into a crash --------
  // The other half of "no process.exit(0)": the exit used to terminate the process
  // synchronously, BEFORE the OS delivered the asynchronous EPIPE that a closed
  // reader causes. Dropping it (S1's fix) makes that EPIPE reachable, and with no
  // 'error' listener Node turns it into an uncaught exception — rc=1 plus a stack
  // trace, on the very scenario the fix exists for (`--dry-run | less`, quit with
  // `q`). Measured: origin/main rc=0 5/5; the exit-less fix WITHOUT the guard rc=1
  // 5/5. This axis is what keeps the truncation fix from trading one regression for
  // another; it reddens when guardStdioAgainstClosedReader is removed.
  {
    const rc = await new Promise<number | string>((done) => {
      const child = spawn(
        process.execPath,
        [DIST, ...dryRunArgs(bigRel, bigBodyFile)],
        { cwd: TREE, stdio: ["ignore", "ignore", "pipe"] },
      );
      let seen = 0;
      let stderrText = "";
      // ⛔ A timeout, not hygiene: if the subject hangs, the harness would hang with
      // it and that is indistinguishable from "the axis does not differentiate"
      // (integration-test-revert-verify §A70/§A116).
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        done("timeout");
      }, 120_000);
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
    if (rc === 0)
      ok("S7", "reader left after 200 bytes — rc=0, no EPIPE crash");
    else if (rc === "timeout")
      bad("S7", "the process hung after the reader left");
    else if (rc === "epipe-trace")
      bad("S7", "rc=0 but an EPIPE stack trace reached the user");
    else
      bad(
        "S7",
        `rc=${rc} — an early-closing reader crashes the command (origin/main returns 0 here)`,
      );
  }
}

void (async (): Promise<void> => {
  await runAxes([vault], axes);
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
