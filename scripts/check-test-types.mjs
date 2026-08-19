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
 * So all 975 test files are type-checked ONLY by ts-jest at run time.
 *
 * That is not equivalent, and the difference is the point: a type error in a test
 * surfaces as `● Test suite failed to run` + `Tests: 0` — a shape that reads as
 * "nothing failed" (see rules/integration-test-revert-verify.md §A3). It also makes
 * "typecheck rc=0" in a PR report a FALSE guarantee whenever the PR's main artifact
 * is a test file. Observed on PR #4082: the report said `typecheck core rc=0` while
 * the test file it shipped was type-checked by nothing; a round-2 review caught it,
 * not a gate.
 *
 * ⛤ Why a RATCHET, not turning the check on: the debt is ~3.1K diagnostics across
 * ~386 files, wildly uneven by package (measured 2026-08-19, workspace deps built):
 *   core            379 test files →     2   ← nearly clean despite being the largest suite
 *   services          1              →     9
 *   test-utils        3              →     9
 *   cli             161              →   654
 *   obsidian-plugin ~431             → ~2475
 * An always-red gate gets ignored, which is worse than no gate (the rationale
 * check-cli-types.mjs already documents). The ratchet freezes the debt and makes it
 * impossible to GROW.
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

function runTsc() {
  try {
    execFileSync("npx", ["tsc", "--noEmit", "-p", CONFIG], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
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
function assertRunIsMeaningful() {
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
  const WORKSPACE_BARE = /Cannot find module '@kitelev\/exocortex-(core|services)'/;
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
  `check-test-types: ${diagnostics} diagnostic(s) in ${found.size} (file, code) pair(s) ` +
    `across test files; baseline has ${known.size}`,
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
    "\n   Nothing else type-checks test files — ts-jest only reports them at run time,\n" +
      "   where the failure looks like 'Test suite failed to run / Tests: 0'. Fix the\n" +
      "   error — do NOT add it to the baseline. The baseline freezes the EXISTING debt,\n" +
      "   it is not a place to put new debt (that is how a ratchet becomes a licence).",
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
