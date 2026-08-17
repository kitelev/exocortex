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
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "cli-type-errors.baseline.json");
const UPDATE = process.argv.includes("--update");

/** `path/file.ts(12,34): error TS2339: msg` → { file, code } */
const LINE_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;

function runTsc() {
  try {
    execFileSync(
      "npx",
      ["tsc", "--noEmit", "-p", "packages/cli/tsconfig.json"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return ""; // exit 0 → no diagnostics
  } catch (err) {
    // tsc exits non-zero WHEN IT FINDS ERRORS — that is the normal path here.
    // Distinguish that from "tsc could not run at all": the former still prints
    // parseable diagnostics on stdout, the latter does not.
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
const found = new Map(); // "file|code" -> count
let diagnostics = 0;
for (const line of raw.split("\n")) {
  const m = LINE_RE.exec(line.trim());
  if (!m) continue;
  diagnostics += 1;
  const key = `${m[1]}|${m[4]}`;
  found.set(key, (found.get(key) ?? 0) + 1);
}

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

const known = new Set(baseline.entries.map((e) => `${e.file}|${e.code}`));

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
// ⛔ SECOND way the run can be meaningless, and it is the one that actually
// happened in CI on the first attempt: the workspace dependencies are not built.
// `packages/cli/tsconfig.json` declares `paths` for @kitelev/exocortex-{core,
// services}, but they are DEAD — it inherits `baseUrl: "."` from the root config,
// so `../core/src` resolves relative to the REPO ROOT, i.e. outside the repo.
// Resolution therefore falls through to node_modules → `types: dist/index.d.ts`,
// which does not exist until the package is built. Result: 174 diagnostics in 95
// pairs instead of 24 in 18, almost all of them a TS2307 cascade — and the
// ratchet dutifully reported them as "79 NEW type errors".
//
// ⚠ This also invalidated my first baseline: it was captured on a machine where
// node_modules symlinked to a SIBLING worktree that happened to have a built
// core. A baseline is only meaningful if it is captured under the same
// conditions the gate runs in.
const unresolved = [...found.keys()].filter((k) => k.endsWith("|TS2307"));
if (unresolved.length > 0) {
  console.error(
    `❌ check-cli-types: ${unresolved.length} file(s) cannot resolve their imports (TS2307).\n` +
      "   The workspace dependencies are not built, so this run says nothing about\n" +
      "   the cli package's own type health — the errors you would see are a\n" +
      "   resolution cascade, not real findings. Build them first:\n" +
      "      npm run build -w @kitelev/exocortex-core\n" +
      "      npm run build -w @kitelev/exocortex-services\n" +
      "   (~3.6s combined; the CI step does this.)",
  );
  process.exit(2);
}

const outside = [...found.keys()]
  .map((k) => k.split("|")[0])
  .filter((f) => !f.replace(/\\/g, "/").includes("packages/cli/"));
if (outside.length > 0) {
  console.error(
    `❌ check-cli-types: ${outside.length} diagnostic file(s) lie OUTSIDE packages/cli —\n` +
      "   tsc compiled a different file set than intended, so this run says nothing\n" +
      "   about the cli package. Usually a broken/ignored packages/cli/tsconfig.json\n" +
      "   (tsc silently falls back to defaults rather than failing). Examples:\n" +
      outside
        .slice(0, 3)
        .map((f) => `      ${f}`)
        .join("\n"),
  );
  process.exit(2);
}

const newPairs = [...found.keys()].filter((k) => !known.has(k)).sort();
const gonePairs = [...known].filter((k) => !found.has(k)).sort();

// Report the INPUT SIZE beside the findings: "0 new" is indistinguishable from
// "tsc emitted nothing at all" without it.
console.log(
  `check-cli-types: ${diagnostics} diagnostic(s) in ${found.size} (file, code) pair(s); ` +
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

if (gonePairs.length > 0) {
  console.error(
    `\n❌ ${gonePairs.length} baselined error(s) no longer occur — the baseline is stale:\n`,
  );
  for (const key of gonePairs) {
    const [file, code] = key.split("|");
    console.error(`   ${file} — ${code}  (fixed — thank you)`);
  }
  console.error("\n   Run: node scripts/check-cli-types.mjs --update");
  process.exit(1);
}

console.log("✅ no new type errors in packages/cli");
