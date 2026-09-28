#!/usr/bin/env -S npx tsx
/**
 * req 9de09856 — the DELIVERED-BYTES half of `get-body`, through a REAL PIPE on the
 * BUILT bundle. The jest axes (G1-G11) mock `process.stdout.write` and
 * `process.exit`, so no pipe and no flush is ever exercised: they judge the
 * intermediate record, and the product of this command is the delivered effect
 * (integration-test-revert-verify §A66). A harness is the only form that can see
 * it, and it needs the CLI built — which the CLI jest job does not do — so it runs
 * locally and under the mutant driver, not in CI (same shape as
 * use-cache-4264-proc-chain.harness.ts).
 *
 *   npx tsx packages/cli/tests/integration/get-body-9de09856-pipe.harness.ts [--dist <index.js>] [--no-build]
 *
 * Why this harness exists at all — measured on the shipped pattern
 * (`process.stdout.write(body); process.exit(0)`) with the largest live asset
 * (424 964-byte body):
 *     to a FILE   → 424 964 bytes   (correct)
 *     to a PIPE   →  65 536 bytes   (84.6 % silently lost)
 *     --json to a PIPE → truncated, unparseable JSON
 * `process.exit` does not wait for an asynchronous write, and stdout IS
 * asynchronous when it is a pipe. The documented channel for this command is a
 * pipe (`get-body <p> | set-body <p> --body-file -`), and set-body WRITES what it
 * receives — so the truncation destroys the tail of the asset, which is the exact
 * silent loss the requirement exists to prevent.
 *
 * Axes:
 *   P1 a body well over the 64 KiB pipe buffer arrives COMPLETE through a pipe
 *      (delivered bytes === bodyBytes, and the tail is present)
 *   P2 the same body arrives complete through a FILE redirect (control: isolates
 *      "pipe handling" from "reading the body at all")
 *   P3 `--json` through a pipe is complete and PARSES, and its body field is
 *      byte-identical to the raw form
 *   P4 the round trip over a real pipe on a >64 KiB body is a no-op
 *      (`changed:false`) — the requirement's load-bearing claim, on the real
 *      channel and the real bytes
 *   P5 a small body still arrives complete (guards against a fix that only works
 *      above the buffer threshold)
 *   P6 a reader that LEAVES EARLY (`| head -c 200`, `| less` quit with `q`) still
 *      gets rc=0 and no EPIPE stack trace — the OTHER half of dropping
 *      process.exit(0), shipped in #4447
 *
 * Prints `✅ P<n>` / `❌ P<n>` per axis and `PASS=<n> FAIL=<n>`; exit 1 on failure.
 */
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// fileURLToPath, not new URL().pathname — the latter is not percent-decoded, so a
// tree path containing a space would resolve wrongly (round-2 review LOW).
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
const vault = fs.mkdtempSync(path.join(os.tmpdir(), "gb-pipe-"));
const REL_DIR = "assetspaces/kitelev/exoas-my/tasks";
fs.mkdirSync(path.join(vault, REL_DIR), { recursive: true });

const BIG_UID = "b1b1b1b1-0000-4000-8000-000000000001";
const SMALL_UID = "5a5a5a5a-0000-4000-8000-000000000002";
const bigRel = `${REL_DIR}/${BIG_UID}.md`;
const smallRel = `${REL_DIR}/${SMALL_UID}.md`;

/**
 * 300 KiB of Cyrillic prose — comfortably past the 64 KiB pipe buffer where the
 * truncation appears, and multi-byte so a byte/char confusion cannot hide in it.
 * The tail carries a unique marker so "complete" is checked by CONTENT, not only
 * by length.
 */
const TAIL_MARKER = "==ХВОСТ-ДОЕХАЛ==";
const bigBody =
  "Наули — практика, и эта строка повторяется много раз, чтобы тело вышло за буфер пайпа.\n".repeat(
    3500,
  ) + `${TAIL_MARKER}\n`;
const smallBody = "Короткое тело.\n";

const fmFor = (uid: string): string =>
  `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: "Pipe fixture"\nexo__Asset_updatedAt: 2020-01-01T00:00:00\n---\n`;
fs.writeFileSync(path.join(vault, bigRel), fmFor(BIG_UID) + bigBody);
fs.writeFileSync(path.join(vault, smallRel), fmFor(SMALL_UID) + smallBody);

const expectedBig = Buffer.byteLength(bigBody, "utf8");

/**
 * Run the CLI with stdout as a genuine PIPE (spawnSync captures through one) and
 * return the raw bytes. `maxBuffer` is raised so the harness itself cannot be the
 * thing that truncates — otherwise a green run would prove nothing.
 */
function runPiped(args: string[]): { rc: number; out: Buffer; err: string } {
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
    err: (r.stderr ?? Buffer.alloc(0)).toString("utf-8"),
  };
}

// ---- P1: big body through a PIPE ------------------------------------------
{
  const r = runPiped(["get-body", bigRel, "--vault", vault]);
  const got = r.out.length;
  if (r.rc !== 0) bad("P1", `rc=${r.rc}; stderr=${r.err.slice(-300)}`);
  else if (got !== expectedBig)
    bad(
      "P1",
      `pipe delivered ${got} of ${expectedBig} bytes (${((100 * (expectedBig - got)) / expectedBig).toFixed(1)}% lost)`,
    );
  else if (!r.out.toString("utf-8").includes(TAIL_MARKER))
    bad("P1", "length matches but the tail marker is missing");
  else ok("P1", `${got} bytes through a pipe, tail intact`);
}

// ---- P2: control — same body through a FILE redirect ----------------------
{
  const outFile = path.join(vault, "big.out");
  const fd = fs.openSync(outFile, "w");
  const r = spawnSync(process.execPath, [DIST, "get-body", bigRel, "--vault", vault], {
    cwd: TREE,
    stdio: ["ignore", fd, "pipe"],
    timeout: 120_000,
  });
  fs.closeSync(fd);
  const got = fs.statSync(outFile).size;
  if (r.status !== 0) bad("P2", `rc=${r.status}`);
  else if (got !== expectedBig) bad("P2", `file got ${got} of ${expectedBig}`);
  else ok("P2", `${got} bytes to a file (control)`);
}

// ---- P3: --json through a PIPE parses and matches the raw form ------------
{
  const r = runPiped(["get-body", bigRel, "--vault", vault, "--json"]);
  if (r.rc !== 0) bad("P3", `rc=${r.rc}`);
  else {
    try {
      const parsed = JSON.parse(r.out.toString("utf-8")) as {
        bodyBytes: number;
        body: string;
      };
      if (parsed.bodyBytes !== expectedBig)
        bad("P3", `bodyBytes ${parsed.bodyBytes} != ${expectedBig}`);
      else if (parsed.body !== bigBody)
        bad("P3", "parsed body differs from the fixture body");
      else ok("P3", `--json complete and parseable (${parsed.bodyBytes} bytes)`);
    } catch (e) {
      bad("P3", `--json did not parse through a pipe: ${(e as Error).message}`);
    }
  }
}

// ---- P4: round trip over a real pipe on a >64 KiB body --------------------
{
  const got = runPiped(["get-body", bigRel, "--vault", vault]);
  const bodyFile = path.join(vault, "rt-body.md");
  fs.writeFileSync(bodyFile, got.out);
  const before = fs.readFileSync(path.join(vault, bigRel));
  const back = runPiped([
    "set-body",
    bigRel,
    "--vault",
    vault,
    "--body-file",
    bodyFile,
    "--skip-wikilink-validation",
  ]);
  const after = fs.readFileSync(path.join(vault, bigRel));
  const echo = back.out.toString("utf-8");
  if (back.rc !== 0) bad("P4", `set-body rc=${back.rc}; ${back.err.slice(-300)}`);
  else if (!echo.includes('"changed":false'))
    bad("P4", `round trip modified the asset: ${echo.trim().slice(0, 200)}`);
  else if (!before.equals(after)) bad("P4", "file changed although changed:false");
  else ok("P4", "round trip over a real pipe is a no-op on a 300 KiB body");
}

// ---- P5: small body still complete ----------------------------------------
{
  const r = runPiped(["get-body", smallRel, "--vault", vault]);
  const want = Buffer.byteLength(smallBody, "utf8");
  if (r.rc !== 0) bad("P5", `rc=${r.rc}`);
  else if (r.out.length !== want)
    bad("P5", `small body got ${r.out.length} of ${want}`);
  else ok("P5", `${want} bytes (below the buffer threshold)`);
}

// tsx transpiles this harness to CJS, where top-level await is unavailable — P6 and
// the verdict live in an async IIFE so the summary still prints AFTER the last axis.
void (async (): Promise<void> => {
  // ---- P6: a reader that LEAVES EARLY must not turn rc 0 into a crash --------
  // The other half of "no process.exit(0)" (#4447; #4434 landed only the first).
  // The exit used to terminate the process synchronously, BEFORE the OS delivered
  // the asynchronous EPIPE that a closed reader causes. Without it AND without
  // guardStdioAgainstClosedReader(), that EPIPE is an unhandled 'error' event on
  // stdout — an uncaught exception: rc=1 plus a stack trace, on the very channel
  // this command documents (`get-body <p> | head -c 200`). Measured on the built
  // bundle, 549 528-byte body: reader-to-EOF rc=0 (549 528 B); reader leaving after
  // 200 B WITHOUT the guard rc=1 + "Error: write EPIPE" 5/5; the already-guarded
  // sibling `set-body --dry-run` on the same invocation rc=0 3/3 (canary: the probe
  // itself is sound, the guard is the differentiator). This axis reddens when the
  // guard call is removed.
  {
    const rc = await new Promise<number | string>((done) => {
      const child = spawn(
        process.execPath,
        [DIST, "get-body", bigRel, "--vault", vault],
        { cwd: TREE, stdio: ["ignore", "pipe", "pipe"] },
      );
      let seen = 0;
      let stderrText = "";
      // ⛔ A timeout, not hygiene: natural termination is exactly what this harness
      // measures, so a subject that HANGS is an expected failure mode — and without
      // a timeout the harness hangs with it, which is indistinguishable from "the
      // axis does not differentiate" (integration-test-revert-verify §A70/§A116).
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
        done("timeout");
      }, 120_000);
      child.stderr.on("data", (chunk: Buffer) => {
        stderrText += chunk.toString("utf-8");
      });
      child.stdout.on("data", (chunk: Buffer) => {
        seen += chunk.length;
        // Leave once a prefix has been read — exactly what `| head -c 200` or a
        // reader quitting `less` does to the writer still mid-body.
        if (seen >= 200) child.stdout.destroy();
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
    if (rc === 0) ok("P6", "reader left after 200 bytes — rc=0, no EPIPE crash");
    else if (rc === "timeout") bad("P6", "the process hung after the reader left");
    else if (rc === "epipe-trace")
      bad("P6", "rc=0 but an EPIPE stack trace reached the user");
    else
      bad(
        "P6",
        `rc=${rc} — an early-closing reader crashes the command (the guard is what keeps it 0)`,
      );
  }

  fs.rmSync(vault, { recursive: true, force: true });
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
