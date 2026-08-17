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

/**
 * Refuse to draw any conclusion from a run that did not actually examine
 * packages/cli. Called from BOTH the read path and `--update` — the writer needs
 * it more, because a bad baseline is silent forever while a bad read is loud once.
 */
function assertRunIsMeaningful(found, raw) {
  // ⛔ Zero parsed diagnostics is NOT "the code is clean": tsc reports config
  // failures WITHOUT a file position (`TS5058: The specified path does not
  // exist`, `TS18003: No inputs were found`), and the line parser drops those,
  // leaving `found` empty. Review measured the consequence: a missing
  // packages/cli/tsconfig.json fell through to the stale-baseline branch, which
  // printed "run --update" — and obeying that instruction wrote an EMPTY
  // baseline, leaving the gate green forever. The tool talked the operator into
  // disarming it.
  //
  // ⚠ An earlier draft rejected a position-less-error guard as "redundant with
  // the scope guard, it never fired either". That was wrong, and measurably so:
  // the two cover DISJOINT breakages. Invalid JSON / bad `extends` → tsc falls
  // back to defaults and compiles the tree → SCOPE fires. Missing tsconfig /
  // empty `include` → nothing is compiled at all → only THIS fires. Rejecting it
  // on "it didn't fire in my one experiment" generalised from a single case.
  if (found.size === 0) {
    console.error(
      "❌ check-cli-types: zero diagnostics parsed — the check did not examine\n" +
        "   packages/cli. tsc prints config failures without a file position, so an\n" +
        "   empty result means 'could not run', NOT 'nothing to report'.\n" +
        "   ⛔ Do NOT run --update to make this go away: that writes an empty\n" +
        "   baseline and disables the gate permanently. Fix the invocation.\n" +
        (raw.trim().length > 0
          ? "   tsc said:\n" +
            raw
              .split("\n")
              .filter((l) => l.trim().length > 0)
              .slice(0, 5)
              .map((l) => `      ${l.trim()}`)
              .join("\n")
          : "   (tsc produced no output at all)"),
    );
    process.exit(2);
  }

  // ⛔ Imports not resolving means the run describes a resolution cascade, not
  // the package's type health. packages/cli/tsconfig.json declares `paths` for
  // @kitelev/exocortex-{core,services}, but they are DEAD — it inherits
  // `baseUrl: "."` from the root config, so `../core/src` resolves relative to
  // the REPO ROOT, outside the repo. Resolution falls through to node_modules →
  // `types: dist/index.d.ts`, absent until the package is built. This is not
  // hypothetical: the first CI run of this ratchet reported 174 diagnostics /
  // 95 pairs, ~79 of them "NEW", for exactly this reason.
  const unresolved = [...found.keys()].filter((k) => k.endsWith("|TS2307"));
  if (unresolved.length > 0) {
    console.error(
      `❌ check-cli-types: ${unresolved.length} file(s) cannot resolve their imports (TS2307).\n` +
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

assertRunIsMeaningful(found, raw);

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
  console.error("\n   Run: node scripts/check-cli-types.mjs --update");
  process.exit(1);
}

console.log("✅ no new type errors in packages/cli");
