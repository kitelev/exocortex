#!/usr/bin/env node
/**
 * Ratchet: type-check `packages/cli` and fail on any NEW error.
 *
 * ⛔ Why a separate script instead of just adding cli to `check:types`: the root
 * `tsconfig.json` `exclude` lists `packages/cli/**\/*`, and the package builds with
 * esbuild (`build: build:bundle`), which transpiles WITHOUT checking types. Its
 * own `build:tsc` script is invoked by nothing in CI. So `packages/cli/src` is
 * type-checked NOWHERE, and 24 errors have accumulated there unseen.
 *
 * That gap has already cost real defects. PR #4070 shipped a `BlankNode.value`
 * read through TWO review rounds — the compiler had flagged it as TS2339 the
 * whole time, and nobody saw it because nothing runs the compiler on this
 * package. The same read is still live on main in `cache/tripleSerialization.ts`,
 * where it serialises blank nodes without their id.
 *
 * ⛤ Why a RATCHET rather than turning the check on: 24 pre-existing errors would
 * red every PR from day one, and a gate that is always red gets ignored — the
 * failure mode is worse than no gate. The ratchet lets the debt sit while making
 * it impossible to GROW.
 *
 * ⛔ The baseline is a SET OF (file, code) PAIRS, deliberately not a count.
 * "24 errors" cannot distinguish "the same 24" from "one fixed, one introduced" —
 * a counter is satisfied by a swap, which is precisely the regression this is
 * meant to catch. Line numbers are excluded on purpose: any edit above shifts
 * them, so keying on them would make the baseline churn on unrelated changes.
 *
 * Fail-loud in BOTH directions:
 *   rc=1  a (file, code) pair NOT in the baseline appeared            → regression
 *   rc=1  a baselined pair is GONE                                    → debt paid, update the baseline
 *   rc=2  the check could not run (tsc missing, config unreadable)    → not "clean"
 *
 * The second direction matters as much as the first: a baseline nobody prunes
 * silently stops describing the code, and then it is licence rather than a
 * ratchet. `--update` rewrites it.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "cli-type-errors.baseline.json");
const UPDATE = process.argv.includes("--update");

/** `path/file.ts(12,34): error TS2339: msg` → { file, code } */
const LINE_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;

/**
 * ⛤ `--listFiles` turns the scope proof POSITIVE, and that is why it is here.
 *
 * Both guards below derive "did this run examine packages/cli?" from the DIAGNOSTICS.
 * That is negative evidence: it only works while errors exist. One state breaks it, and
 * it is the state we are working toward — the 18 baselined pairs get FIXED, tsc exits 0,
 * `found` is empty, and the zero-diagnostics guard fires rc=2 forever. The reward for
 * paying down the debt would be a permanently red gate whose obvious "fix" (`--update`)
 * writes an EMPTY baseline and disarms it — the exact disarm this file's own docstring
 * warns about, reached from the success path instead of the failure path.
 *
 * `--listFiles` names every file in the program regardless of whether any error exists,
 * so "N files under packages/cli/src were compiled" is an assertion about the RUN, not
 * about its findings. Ported from scripts/check-test-types.mjs (#4084), where the same
 * hole was found by review; see issue #4087.
 */
function runTsc() {
  const args = ["tsc", "--noEmit", "--listFiles", "-p", "packages/cli/tsconfig.json"];
  // --listFiles prints one line per file in the program (lib.d.ts + node_modules types
  // included). MEASURED for THIS package 2026-08-19: 104,288 bytes — 10x UNDER Node's
  // 1 MB default, so the buffer is headroom for growth here, not a present necessity.
  // ⚠ The comment ported from scripts/check-test-types.mjs said "the default is not
  // enough"; that is true THERE (measured 1,089,745 bytes, 4% over the default) and was
  // carried into a context where it does not hold. Restated so the next person tuning
  // this number reads a measurement of this package rather than of its sibling.
  const opts = {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  };
  try {
    // rc=0 — no diagnostics. NOT "nothing to check": the file listing still arrives, and
    // it is the only thing that distinguishes "clean" from "compiled nothing".
    return String(execFileSync("npx", args, opts) ?? "");
  } catch (err) {
    // tsc exits non-zero WHEN IT FINDS ERRORS — that is the normal path here.
    // Distinguish that from "tsc could not run at all": the former still prints
    // parseable diagnostics on stdout, the latter does not.
    // ⛔ maxBuffer overflow is NOT a normal error run, and it must be keyed on err.code —
    // NOT on whether stdout looks empty or short.
    //
    // Measured on Node v24.14.0 (14,830 bytes through a 512-byte maxBuffer):
    // `err.code === "ENOBUFS"` and `err.stdout.length === 14830` — the capture came back
    // COMPLETE, because a single pipe read delivered it all before the limit was noticed.
    // A larger overflow arriving in many chunks truncates instead. So the two overflow
    // shapes are opposite (partial data vs complete data carrying only a flag), and the
    // emptiness test below distinguishes NEITHER: the pre-fix code returned this capture
    // and reported a verdict on 114 files from a run Node had already rejected.
    // Keying on the code covers both shapes; keying on the payload covers neither.
    if (err.code === "ENOBUFS") {
      console.error(
        "❌ check-cli-types: tsc output exceeded maxBuffer — the capture is truncated and\n" +
          "   any verdict drawn from it would be partial. Raise maxBuffer in runTsc().",
      );
      process.exit(2);
    }
    const out = String(err.stdout ?? "");
    if (out.trim().length === 0) {
      console.error(
        "❌ check-cli-types: tsc produced no output — the check did not run.\n" +
          `   ${String(err.stderr ?? err).slice(0, 400)}`,
      );
      process.exit(2);
    }
    return out;
  }
}

const raw = runTsc();

/**
 * Files tsc actually put in the program (from --listFiles). A listing line is a bare
 * path; a diagnostic line carries `(line,col): error TSxxxx`. Narrow to this package's
 * own sources — node_modules and lib.d.ts say nothing about whether cli was compiled.
 */
const compiledSrcFiles = raw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !LINE_RE.test(l) && /\.tsx?$/.test(l))
  .filter((l) => {
    const p = l.replace(/\\/g, "/");
    return p.includes("/packages/cli/src/") && !p.includes("/node_modules/");
  });

/**
 * How many `.ts`/`.tsx` files exist on disk under packages/cli/src — the floor is DERIVED
 * from this, never hardcoded.
 *
 * ⛤ Why derivation is exact here rather than approximate: the package's tsconfig declares
 * `include: ["src/**\/*"]` and an `exclude` of only `node_modules`/`dist` (neither under
 * src), so every source file is a ROOT of the program and MUST appear in --listFiles.
 * Measured 2026-08-19: 114 on disk == 114 listed, 0 `.d.ts`, 0 test files. Any shortfall
 * is therefore a real collapse of the program, not slack in the model.
 *
 * ⛔ A CONSTANT floor cannot express that. The first draft of this guard used 40 against a
 * measured 114, and review proved on a stubbed tsc that `45 files + 0 diagnostics` yields
 * output BYTE-IDENTICAL to `114 + 0` — "the baseline is stale … Run --update". Obeying
 * that writes an empty baseline while 69 of 114 files have dropped out of the program.
 * The floor must move WITH the package, which also removes the false rc=2 a legitimate
 * shrink would otherwise produce.
 */
function countSourceFilesOnDisk(dir) {
  let n = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // missing/renamed dir — the caller treats 0 as "the deriver is broken"
  }
  for (const e of entries) {
    if (e.name === "node_modules") continue;
    if (e.isDirectory()) n += countSourceFilesOnDisk(join(dir, e.name));
    // ⛤ NO .d.ts exclusion, deliberately: the listing filter above accepts any `.tsx?`,
    // and a declaration file under src IS a program root under `include: src/**\/*`.
    // Excluding it here would count it on one side only and make the floor leniently
    // wrong by exactly the number of such files. Both sides must count the same set.
    else if (/\.tsx?$/.test(e.name)) n += 1;
  }
  return n;
}

const EXPECTED_SRC_FILES = countSourceFilesOnDisk(join(ROOT, "packages", "cli", "src"));

const found = new Map(); // "file|code" -> count
let diagnostics = 0;
for (const line of raw.split("\n")) {
  const m = LINE_RE.exec(line.trim());
  if (!m) continue;
  diagnostics += 1;
  const key = `${m[1]}|${m[4]}`;
  found.set(key, (found.get(key) ?? 0) + 1);
}

/**
 * Refuse to draw any conclusion from a run that did not actually examine
 * packages/cli. Called from BOTH the read path and `--update` — the writer needs
 * it more, because a bad baseline is silent forever while a bad read is loud once.
 */
function assertRunIsMeaningful() {
  // ⛔ The DERIVER itself can be the broken thing, and then a floor derived from it is
  // zero — i.e. the guard would disarm exactly when the package went missing. Never take
  // the expected input size from a source that may be broken without checking it first.
  if (EXPECTED_SRC_FILES === 0) {
    console.error(
      "❌ check-cli-types: found 0 source files on disk under packages/cli/src, so the\n" +
        "   expected program size cannot be derived and this run has no floor to check\n" +
        "   against. The package directory is missing or renamed — fix that, do NOT run\n" +
        "   --update (it would write a baseline from an unbounded run).",
    );
    process.exit(2);
  }

  // ⛤ POSITIVE scope proof, from --listFiles. Holds whether or not any diagnostic
  // exists, so unlike the guard below it survives the debt being fully paid.
  if (compiledSrcFiles.length < EXPECTED_SRC_FILES) {
    console.error(
      `❌ check-cli-types: tsc compiled ${compiledSrcFiles.length} of the ${EXPECTED_SRC_FILES}\n` +
        "   source file(s) that exist on disk under packages/cli/src. The run is NOT\n" +
        "   describing this package, so it has no verdict to give.\n" +
        "   ⛔ Do NOT run --update to make this go away: it would write a baseline derived\n" +
        "   from this same empty run — an empty baseline — and every later run would exit 0\n" +
        "   green while compiling nothing. Fix the invocation instead.\n" +
        "   Likely causes: unparseable/renamed tsconfig, an `include` matching nothing,\n" +
        "   a bad `extends`, or tsc not resolving at all.\n" +
        (raw.trim().length > 0
          ? "   tsc said:\n" +
            raw
              .split("\n")
              .filter((l) => l.trim().length > 0 && !/\.tsx?$/.test(l.trim()))
              .slice(0, 5)
              .map((l) => `      ${l.trim()}`)
              .join("\n")
          : "   (tsc produced no output at all)"),
    );
    process.exit(2);
  }

  // ⛤ The zero-diagnostics guard that used to live here has been REMOVED, and the
  // reason matters more than the removal.
  //
  // Its docstring was right that a position-less-error guard and the SCOPE guard cover
  // DISJOINT breakages — both are negative evidence, derived from the diagnostics, and
  // neither implies the other. What neither of them could cover is the SUCCESS path:
  // when the 18 baselined pairs are finally fixed, tsc exits 0, `found` is empty, and
  // the zero-guard fired rc=2 — permanently, with the only obvious remedy (`--update`)
  // writing an empty baseline. Measured 2026-08-19 on a stubbed tsc (114 files listed,
  // zero diagnostics): rc=2 "the check did not examine packages/cli", which is false —
  // it examined all 114 and found nothing.
  //
  // ⛔ This is a deliberate TRADE, not a subsumption — an earlier draft of this comment
  // claimed the floor "subsumes its real cases", and that claim was false. What the floor
  // covers: nothing compiled, or fewer files compiled than exist on disk. What NO floor can
  // cover: files compiled but not CHECKED — `"noCheck": true` is available on the TypeScript
  // version in use (5.9.3), and under it the listing is complete while every diagnostic
  // disappears, which is indistinguishable from a clean run. The zero-diagnostics guard did
  // refuse that input, at the price of refusing the success path too. Refusing success
  // permanently is the worse failure, so it is accepted knowingly.

  // ⛔ TS2307 is TWO different things, and this guard used to conflate them.
  //   (a) ENVIRONMENT — a BARE `@kitelev/exocortex-*` specifier unresolved ⇒ the workspace
  //       deps are not built ⇒ the run is a resolution cascade ⇒ rc=2, as described below.
  //   (b) REAL DEBT — a RELATIVE or deep-subpath import of a module that MOVED. That is the
  //       most valuable thing a type gate finds, and it must be BASELINED, never rc=2.
  // Treating (b) as (a) tells the author "build the deps" when there is nothing to build,
  // and hides the finding. Discriminator: the trailing quote keeps deep subpaths
  // (`@kitelev/exocortex-core/domain/errors`) OUT of the environment bucket.
  // ⛔ Match on the MESSAGE, not on the error code. An earlier draft required
  // `|TS2307`, and review proved that the same bare specifier reported as TS2792
  // ("Cannot find module … Did you mean to set 'moduleResolution'…") then fell through to
  // rc=1 and would be FROZEN INTO THE BASELINE by --update — an environment failure
  // recorded as permanent debt. The discriminator that matters lives in the regex (the
  // trailing quote keeps deep subpaths out), so dropping the code test loses nothing and
  // covers every code TypeScript may pick. Identical to scripts/check-test-types.mjs.
  const WORKSPACE_BARE = /Cannot find module '@kitelev\/exocortex-[a-z-]+'/;
  const envLines = raw.split("\n").filter((l) => WORKSPACE_BARE.test(l));
  if (envLines.length > 0) {
    console.error(
      `❌ check-cli-types: ${envLines.length} unresolved bare workspace import(s).\n` +
        "   The workspace dependencies are not built, so this run says nothing about\n" +
        "   the cli package's own type health. Build them first:\n" +
        "      npm run build -w @kitelev/exocortex-core\n" +
        "      npm run build -w @kitelev/exocortex-services\n" +
        "   (~3.5s combined; the CI step does this.)",
    );
    process.exit(2);
  }

  // A correctly configured run touches ONLY packages/cli. Anything outside means
  // a different compilation than the one being ratcheted.
  //
  // Measured, because the obvious assumption is wrong: corrupting
  // packages/cli/tsconfig.json does NOT make tsc fail loudly. It ignores the
  // file, falls back to defaults, compiles the whole tree and emits hundreds of
  // well-formed diagnostics from node_modules, exiting 2 — the same code it
  // returns for ordinary errors. Scope is the signal; the exit code is not.
  const outside = [...found.keys()]
    .map((k) => k.split("|")[0])
    .filter((f) => !f.replace(/\\/g, "/").includes("packages/cli/"));
  if (outside.length > 0) {
    console.error(
      `❌ check-cli-types: ${outside.length} diagnostic file(s) lie OUTSIDE packages/cli —\n` +
        "   tsc compiled a different file set than intended, so this run says nothing\n" +
        "   about the cli package. Usually a broken/ignored packages/cli/tsconfig.json\n" +
        "   (tsc silently falls back to defaults rather than failing); a SYNTAX error\n" +
        "   inside a workspace .d.ts does it too, since parse errors escape\n" +
        "   skipLibCheck. Examples:\n" +
        outside
          .slice(0, 3)
          .map((f) => `      ${f}`)
          .join("\n"),
    );
    process.exit(2);
  }
}

assertRunIsMeaningful();

if (UPDATE) {
  const entries = [...found.entries()]
    .map(([key, count]) => {
      const [file, code] = key.split("|");
      return { file, code, count };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
  writeFileSync(BASELINE, JSON.stringify({ entries }, null, 2) + "\n", "utf8");
  console.log(
    `✅ baseline written: ${entries.length} (file, code) pair(s), ${diagnostics} diagnostic(s)`,
  );
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch (err) {
  console.error(`❌ check-cli-types: cannot read ${BASELINE}: ${String(err)}`);
  process.exit(2);
}

if (!Array.isArray(baseline?.entries)) {
  console.error(
    `❌ check-cli-types: ${BASELINE} parsed but has no \`entries\` array — the\n` +
      "   baseline is unusable, so the check cannot run (rc=2, not a finding).",
  );
  process.exit(2);
}

const known = new Set(baseline.entries.map((e) => `${e.file}|${e.code}`));
// ⛔ Compare COUNTS per pair, not just the key set. The file has always stored
// `count`; nothing read it, so a SECOND instance of an already-baselined pair
// was absorbed silently — measured: adding one more unused local to a file that
// already carries TS6133 took the run from 24 to 25 diagnostics and stayed
// green. Realistic today: sparql-query.ts holds TS6133 ×3 and
// exosync-quarantine.ts holds TS2554 ×3, so a 4th/6th instance would vanish.
const baseCount = new Map(baseline.entries.map((e) => [`${e.file}|${e.code}`, e.count ?? 0]));
const grown = [...found.entries()]
  .filter(([key, count]) => known.has(key) && count > (baseCount.get(key) ?? 0))
  .sort();

// ⛔ "Did the check actually run?" is decided by the SCOPE of what tsc compiled,
// not by its exit code and not by whether the output parses.
//
// Measured, because the obvious assumptions are both wrong: corrupting
// packages/cli/tsconfig.json does NOT make tsc fail with a config error and does
// NOT produce unparseable output. tsc ignores the broken file, falls back to
// defaults, and compiles the whole tree — emitting hundreds of perfectly
// well-formed diagnostics from node_modules (`TS18028` etc.). Exit code is 2,
// which is also what it returns for ordinary errors, so that is no signal
// either. Earlier drafts of this guard therefore reported the breakage as
// "18 baselined errors no longer occur" (blessing an empty result) and then as
// "NEW type errors" — a true statement with a false diagnosis.
//
// A run configured correctly touches ONLY packages/cli. Anything outside it
// means we are looking at a different compilation than the one being ratcheted.
const newPairs = [...found.keys()].filter((k) => !known.has(k)).sort();
const gonePairs = [...known].filter((k) => !found.has(k)).sort();
const shrunk = [...found.entries()]
  .filter(([key, count]) => known.has(key) && count < (baseCount.get(key) ?? 0))
  .sort();

// Report the INPUT SIZE beside the findings: "0 new" is indistinguishable from
// "tsc emitted nothing at all" without it.
console.log(
  `check-cli-types: compiled ${compiledSrcFiles.length} src file(s); ` +
    `${diagnostics} diagnostic(s) in ${found.size} (file, code) pair(s); ` +
    `baseline has ${known.size}`,
);

if (newPairs.length > 0) {
  console.error(`\n❌ NEW type error(s) in packages/cli — ${newPairs.length} pair(s):\n`);
  for (const key of newPairs) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}`);
    for (const line of raw.split("\n")) {
      if (line.includes(file) && line.includes(code)) {
        console.error(`      ${line.trim()}`);
      }
    }
  }
  console.error(
    "\n   packages/cli is excluded from the root tsconfig and built with esbuild,\n" +
      "   so nothing else type-checks it. Fix the error — do NOT add it to the\n" +
      "   baseline. The baseline exists to freeze the EXISTING debt, not to absorb\n" +
      "   new debt (that is how a ratchet becomes a licence).",
  );
  process.exit(1);
}

if (grown.length > 0) {
  console.error(`\n❌ ${grown.length} baselined pair(s) grew — new instances of known debt:\n`);
  for (const [key, count] of grown) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}: ${baseCount.get(key)} → ${count}`);
  }
  console.error(
    "\n   The baseline freezes the debt at its measured size; adding to an existing\n" +
      "   pair is still adding. Fix the new instance.",
  );
  process.exit(1);
}

if (gonePairs.length > 0 || shrunk.length > 0) {
  console.error(
    `\n❌ ${gonePairs.length + shrunk.length} baselined entr(y/ies) no longer match — the baseline is stale:\n`,
  );
  for (const key of gonePairs) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}  (fixed — thank you)`);
  }
  // ⛔ `shrunk` was counted in the total above but never printed, so a PARTIALLY fixed
  // pair produced a number with no matching line and the reader could not tell which
  // entry it referred to. Ported from scripts/check-test-types.mjs (#4084 / #4087).
  for (const [key, count] of shrunk) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}: ${baseCount.get(key)} → ${count}  (partly fixed)`);
  }
  console.error("\n   Run: node scripts/check-cli-types.mjs --update");
  process.exit(1);
}

console.log("✅ no new type errors in packages/cli");
