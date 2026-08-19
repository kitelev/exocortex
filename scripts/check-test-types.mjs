#!/usr/bin/env node
/**
 * Ratchet: type-check `packages/**\/tests/**` and fail on any NEW error.
 *
 * ⛔ Why this exists — the second half of the hole that check-cli-types.mjs closed.
 * That script covered `packages/cli/src`, which was type-checked nowhere. Tests are
 * the other uncovered half, and they are LARGER: measured on origin/main 2026-08-19,
 * NO tsconfig in the repo includes `packages/**\/tests/**` —
 *   packages/core/tsconfig.json     include src/**\/*   exclude [..., "tests"]
 *   packages/cli/tsconfig.json      include src/**\/*   (tests not included)
 *   packages/obsidian-plugin/       has no package tsconfig at all
 *   tsconfig.json (root)            exclude packages/**\/tests/**\/*, packages/cli/**\/*
 * So no standalone `tsc` run covers the 975 test files.
 *
 * ⛔ What this gate is, precisely: a STRICTER SUPERSET program, not a reproduction of
 * what ts-jest checks. Do not claim equivalence — it is measurably false. ExocortexAPI
 * .test.ts carries 4 baselined diagnostics (TS2345 ×3, TS2554 ×1) and runs 28/28 GREEN;
 * CI is green on main today with all 2396 of them present. So a NEW pair here does NOT
 * imply a suite that fails at run time, and the failure text must not say it does — an
 * author who reads "your suite is broken" goes hunting a runtime failure that does not
 * exist, and concludes the gate is noise.
 *
 * The coverage the gate genuinely adds, in descending order of value:
 *   - packages/obsidian-plugin/tests/component/** (22 pairs) runs under Playwright CT
 *     (bundler transpile) — type-checked by NOTHING otherwise.
 *   - type-only imports of MOVED modules: ts-jest erases them without resolving, so the
 *     annotation degrades to `any` and the suite passes green while its type safety is
 *     fiction. 13 × TS2307 in the baseline are exactly this.
 *   - it makes "typecheck rc=0" in a PR report stop being a false guarantee when the
 *     PR's main artifact is a test file. Observed on PR #4082: the report said
 *     `typecheck core rc=0` while the test it shipped was type-checked by nothing; a
 *     round-2 review caught that, not a gate.
 * (A type error CAN also surface through jest as `● Test suite failed to run` + `Tests: 0`
 *  — a shape that reads as "nothing failed", rules/integration-test-revert-verify.md §A3
 *  — but that is a possible symptom, not the mechanism, and most of this debt is silent.)
 *
 * ⛤ Why a RATCHET, not turning the check on. Measured 2026-08-19 through THIS config
 * (tsconfig.tests.json, target ES2020, workspace deps built) — 433 (file, code) pairs /
 * 2396 diagnostics, wildly uneven by package:
 *   obsidian-plugin  326 pairs
 *   cli               69
 *   core              37   ← nearly clean despite holding the largest suite
 *   test-utils         1
 * An always-red gate gets ignored, which is worse than no gate (the rationale
 * check-cli-types.mjs already documents). The ratchet freezes the debt and makes it
 * impossible to GROW.
 *
 * ⚠ An earlier draft of this docstring quoted a DIFFERENT measurement here (per-package
 * configs, one tsc run each: core 2, cli 654, obsidian-plugin ~2475). Those numbers are
 * not wrong, they answer a different question — a separate program per package resolves
 * cross-package imports differently, so its counts do not transfer. Numbers in a gate's
 * docstring must say WHICH program produced them, or the next reader compares two scales
 * and "explains" the gap. The figures above are from the config this script actually runs.
 *
 * ⛤ Per-package baselines are NOT needed even though the debt is uneven: the baseline
 * is a set of (file, code) PAIRS, so a new error in core is a new pair regardless of
 * how many pairs obsidian-plugin holds. It cannot be absorbed by the large package's
 * count — that is exactly why the pair-set beats a counter.
 *
 * ⛔ src is compiled but NOT gated here. The program cannot resolve test imports
 * without it; `check:types` and check-cli-types.mjs own the src half. Diagnostics are
 * filtered to `/tests/` before anything is compared.
 *
 * Fail-loud in BOTH directions (same contract as check-cli-types.mjs):
 *   rc=1  a (file, code) pair NOT in the baseline appeared            → regression
 *   rc=1  a baselined pair grew (more instances)                      → still growth
 *   rc=1  a baselined pair is GONE / shrank                           → debt paid, update
 *   rc=2  the check could not run                                     → NOT "clean"
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "test-type-errors.baseline.json");
const CONFIG = "tsconfig.tests.json";
const UPDATE = process.argv.includes("--update");

/** `path/file.ts(12,34): error TS2339: msg` → { file, code } */
const LINE_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;
/** Only test files are ratcheted; src is present purely for import resolution. */
const isTestPath = (f) => f.replace(/\\/g, "/").includes("/tests/");

/**
 * ⛤ `--listFiles` is what makes the scope proof POSITIVE, and that is the whole point.
 *
 * Deriving "did the run examine the tests?" from the DIAGNOSTICS is negative evidence:
 * it works only while errors exist. Two states break it, and both end in the same trap —
 * the stale-baseline branch tells the operator to run `--update`, and obeying that writes
 * an EMPTY baseline that greens the gate forever (check-cli-types.mjs calls this "the tool
 * talked the operator into disarming it"; reproduced here on a stubbed tsc, probes E→F→G):
 *
 *   (1) the config breaks in a way that yields a POSITION-LESS error (TS18003 "No inputs
 *       were found", TS5058 "The specified path does not exist") → nothing parses at all;
 *   (2) the debt is fully PAID → tsc exits 0 → no diagnostics at all. The reward for
 *       fixing every error would be a silently disarmed gate.
 *
 * `--listFiles` names every file in the program regardless of whether any error exists,
 * so "N test files were compiled" is an assertion about the RUN, not about its findings.
 * That is the same discipline this script already applies to diagnostics ("report the
 * INPUT SIZE beside the findings" — a bare 0 is indistinguishable from a dead run).
 */
function runTsc() {
  const args = ["tsc", "--noEmit", "--listFiles", "-p", CONFIG];
  // --listFiles adds one line per file in the program (lib.d.ts + node_modules types
  // included), so the default 1 MB stdout buffer is not enough.
  const opts = { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 };
  try {
    // rc=0 — no diagnostics. NOT "nothing to check": the file listing still arrives, and
    // it is the only thing that distinguishes "clean" from "compiled nothing".
    return String(execFileSync("npx", args, opts) ?? "");
  } catch (err) {
    const out = String(err.stdout ?? "");
    if (out.trim().length === 0) {
      console.error(
        "❌ check-test-types: tsc produced no output — the check did not run.\n" +
          `   ${String(err.stderr ?? err).slice(0, 400)}`,
      );
      process.exit(2);
    }
    return out;
  }
}

const raw = runTsc();

/**
 * Files tsc actually put in the program (from --listFiles). A listing line is a bare path;
 * a diagnostic line carries `(line,col): error TSxxxx`. Filter to the repo's own tests.
 */
const compiledTestFiles = raw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !LINE_RE.test(l) && /\.tsx?$/.test(l))
  .filter((l) => isTestPath(l) && !l.includes("/node_modules/"));
const all = new Map(); // "file|code" -> count, EVERY diagnostic (src included)
const found = new Map(); // "file|code" -> count, tests only
let diagnostics = 0;
for (const line of raw.split("\n")) {
  const m = LINE_RE.exec(line.trim());
  if (!m) continue;
  const key = `${m[1]}|${m[4]}`;
  all.set(key, (all.get(key) ?? 0) + 1);
  if (!isTestPath(m[1])) continue;
  diagnostics += 1;
  found.set(key, (found.get(key) ?? 0) + 1);
}

/**
 * Refuse to conclude anything from a run that did not actually compile the tests.
 *
 * ⛔ REFINEMENT over check-cli-types.mjs, measured 2026-08-19: that script treats
 * "diagnostic without a file position" as the signature of a config failure. That is
 * NECESSARY BUT NOT SUFFICIENT — `TS5069` (declarationMap without declaration) is a
 * config error that ABORTS the run while printing a perfectly positioned diagnostic:
 *
 *   tsconfig.m-core-both.json(3,68): error TS5069: Option 'declarationMap' cannot be …
 *
 * It parses, it has a line and a column, and it sails past a position-based guard —
 * leaving `found` empty and the run looking like "no test errors". The only signal
 * that survives is SCOPE: a real run names files under packages/**\/tests/.
 */
/** Below this many compiled test files the run is not describing this repo. ~975 exist. */
const MIN_COMPILED_TEST_FILES = 200;

function assertRunIsMeaningful() {
  // ⛤ POSITIVE scope proof, from --listFiles. Holds whether or not any error exists, so
  // it survives both a broken config (nothing compiled) and a fully-paid debt (rc=0).
  if (compiledTestFiles.length < MIN_COMPILED_TEST_FILES) {
    console.error(
      `❌ check-test-types: tsc compiled ${compiledTestFiles.length} file(s) under\n` +
        `   packages/**/tests/ — expected at least ${MIN_COMPILED_TEST_FILES}. The run is\n` +
        "   NOT describing this repository's tests, so it has no verdict to give.\n" +
        "   ⛔ Do NOT run --update to make this go away. --update would write a baseline\n" +
        "   derived from this same empty run — i.e. an empty baseline — and every later\n" +
        "   run would exit 0 green while compiling nothing. Fix the invocation instead.\n" +
        "   Likely causes: unparseable/renamed tsconfig, an `include` that matches nothing,\n" +
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

  // Kept as a second, cheaper signal with its own message: the program DID include tests,
  // yet every diagnostic names something else. Subsumed by the floor above in practice,
  // but it names a different failure and costs nothing.
  const compiledFiles = new Set([...all.keys()].map((k) => k.split("|")[0]));
  const testFiles = [...compiledFiles].filter(isTestPath);

  if (compiledFiles.size > 0 && testFiles.length === 0) {
    console.error(
      "❌ check-test-types: tsc emitted diagnostics but NONE of them name a file under\n" +
        "   packages/**/tests/ — the run did not compile the tests.\n" +
        "   ⛔ A config error can carry a file position (it points at the tsconfig), so\n" +
        "   'the output parsed' is NOT evidence the check ran. Scope is.\n" +
        "   tsc said:\n" +
        raw
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(0, 5)
          .map((l) => `      ${l.trim()}`)
          .join("\n"),
    );
    process.exit(2);
  }

  // ⛔ TS2307 is TWO different things here, and conflating them is the trap.
  //
  //  (a) ENVIRONMENT — the workspace deps are not built, so `@kitelev/exocortex-core`
  //      resolves to `dist/index.d.ts` which does not exist yet. Measured: before
  //      building core+services the cli control showed 174 diagnostics (64 × TS2307
  //      + cascade); after building, 24 — exactly the debt check-cli-types.mjs
  //      baselines. This is "the check did not run" → rc=2.
  //
  //  (b) REAL DEBT — a test imports a module that MOVED and was never updated. This
  //      is the most valuable thing this gate finds, so it must be BASELINED, never
  //      rc=2. Measured example: `ILogger` moved from
  //      packages/obsidian-plugin/src/infrastructure/logging/ to
  //      packages/core/src/interfaces/, yet 4+ test files still import the old path
  //      — AND THEY PASS. The import is type-only (`jest.Mocked<ILogger>`), so
  //      ts-jest erases it without resolving; the annotation silently degrades to
  //      `any` and the suite's type safety is fiction. Nothing but this gate sees it.
  //
  // Discriminator: (a) is a BARE workspace-package specifier; (b) is a relative path
  // or a deep subpath. Only (a) aborts the run.
  // ⛤ Matches ANY bare @kitelev/exocortex-* specifier, not a hardcoded two-name list: a
  // future workspace package that needs building would otherwise be diagnosed as "fix the
  // error" instead of "build the dep". The trailing quote is load-bearing — it keeps DEEP
  // SUBPATHS (`@kitelev/exocortex-core/domain/errors`) out, so those stay real debt (b).
  const WORKSPACE_BARE = /Cannot find module '@kitelev\/exocortex-[a-z-]+'/;
  const envUnresolved = raw.split("\n").filter((l) => WORKSPACE_BARE.test(l));
  const unresolved = envUnresolved.length > 0 ? [...new Set(envUnresolved)] : [];
  if (unresolved.length > 0) {
    console.error(
      `❌ check-test-types: the workspace packages are not built (${unresolved.length} bare\n` +
        "   @kitelev/exocortex-* import(s) unresolved), so this run describes a resolution\n" +
        "   cascade rather than the tests' type health. Build them first:\n" +
        "      npm run build -w @kitelev/exocortex-core\n" +
        "      npm run build -w @kitelev/exocortex-services\n" +
        "   (~3.5s combined; the CI step does this.)\n" +
        unresolved
          .slice(0, 3)
          .map((l) => `      ${l.trim()}`)
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

  // ⛤ Print the SHAPE of what was just frozen, not only its size. The generated baseline
  // is the most reviewable artifact in a PR like this, and nothing else surfaces its
  // distribution — so a config artifact hides in it as a plain "N pairs". Concretely:
  // the first draft of this gate inherited target ES6 and baked in 70 × TS1378
  // ("top-level await requires es2017+"), 14% of the baseline, 100% of it in one package.
  // A per-code histogram makes that anomaly announce itself; a total never can.
  const byCode = new Map();
  const byPkg = new Map();
  for (const e of entries) {
    byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
    const pkg = /^packages\/([^/]+)\//.exec(e.file.replace(/\\/g, "/"))?.[1] ?? "?";
    byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + 1);
  }
  const fmt = (m) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
  console.log(`   by package: ${fmt(byPkg).join(", ")}`);
  console.log(`   by code:    ${fmt(byCode).slice(0, 10).join(", ")}${byCode.size > 10 ? `, … (${byCode.size} codes)` : ""}`);
  const [topCode, topN] = [...byCode.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (topN && topN / entries.length >= 0.1) {
    console.log(
      `   ⚠ ${topCode} is ${Math.round((topN / entries.length) * 100)}% of the baseline — ` +
        "check it is real debt and not a config artifact before committing.",
    );
  }
  console.log(
    `✅ baseline written: ${entries.length} (file, code) pair(s), ${diagnostics} diagnostic(s)`,
  );
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch (err) {
  console.error(`❌ check-test-types: cannot read ${BASELINE}: ${String(err)}`);
  process.exit(2);
}
if (!Array.isArray(baseline?.entries)) {
  console.error(
    `❌ check-test-types: ${BASELINE} parsed but has no \`entries\` array — the\n` +
      "   baseline is unusable, so the check cannot run (rc=2, not a finding).",
  );
  process.exit(2);
}

const known = new Set(baseline.entries.map((e) => `${e.file}|${e.code}`));
const baseCount = new Map(baseline.entries.map((e) => [`${e.file}|${e.code}`, e.count ?? 0]));

const newPairs = [...found.keys()].filter((k) => !known.has(k)).sort();
const gonePairs = [...known].filter((k) => !found.has(k)).sort();
const grown = [...found.entries()]
  .filter(([key, count]) => known.has(key) && count > (baseCount.get(key) ?? 0))
  .sort();
const shrunk = [...found.entries()]
  .filter(([key, count]) => known.has(key) && count < (baseCount.get(key) ?? 0))
  .sort();

// Report the INPUT SIZE beside the findings: "0 new" is indistinguishable from
// "tsc emitted nothing at all" without it.
console.log(
  `check-test-types: compiled ${compiledTestFiles.length} test file(s); ` +
    `${diagnostics} diagnostic(s) in ${found.size} (file, code) pair(s) ` +
    `across them; baseline has ${known.size}`,
);

if (newPairs.length > 0) {
  console.error(`\n❌ NEW type error(s) in test files — ${newPairs.length} pair(s):\n`);
  for (const key of newPairs) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}`);
    for (const line of raw.split("\n")) {
      if (line.includes(file) && line.includes(code)) console.error(`      ${line.trim()}`);
    }
  }
  console.error(
    "\n   Fix the error — do NOT add it to the baseline. The baseline freezes the EXISTING\n" +
      "   debt; it is not a place to put new debt (that is how a ratchet becomes a licence).\n" +
      "\n" +
      "   ⚠ This gate is a STRICTER SUPERSET of what ts-jest checks, so a red here does NOT\n" +
      "   mean your suite fails at run time — it may well pass. Measured: ExocortexAPI.test.ts\n" +
      "   carries 4 baselined diagnostics and runs 28/28 green. Do not go hunting a runtime\n" +
      "   failure; the compiler is telling you something jest is not configured to tell you.\n" +
      "   That gap is the point — packages/obsidian-plugin/tests/component/** runs under\n" +
      "   Playwright CT (bundler transpile), where nothing type-checks it at all.",
  );
  process.exit(1);
}

if (grown.length > 0) {
  console.error(`\n❌ ${grown.length} baselined pair(s) grew — new instances of known debt:\n`);
  for (const [key, count] of grown) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}: ${baseCount.get(key)} → ${count}`);
  }
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
  for (const [key, count] of shrunk) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}: ${baseCount.get(key)} → ${count}  (partly fixed)`);
  }
  console.error("\n   Run: node scripts/check-test-types.mjs --update");
  process.exit(1);
}

console.log("✅ no new type errors in test files");
