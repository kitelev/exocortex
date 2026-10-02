#!/usr/bin/env node
/**
 * Guard: eslint findings over EVERY lintable `packages/<p>/src`, ratcheted over a
 * baseline of (file, rule) pairs.
 *
 * ⛔ WHY THIS EXISTS, AND WHY THE ISSUE THAT ASKED FOR IT UNDERSTATED THE DEFECT.
 * Issue #4497 reported that the required check `lint` pointed eslint at ONE
 * package (`packages/obsidian-plugin/src`) out of six that carry TypeScript, so
 * `core` / `services` / `cli` / `req-audit` / `test-utils` were never linted in
 * CI. That is true. It is also not the load-bearing half.
 *
 * The load-bearing half is that the `Lint` step carried `continue-on-error: true`
 * (added 2025-10-02 by fa5251f8, whose subject is "fix(ci): allow lint WARNINGS
 * to not fail CI"). A step with that flag cannot fail its job — so the required
 * check `lint` was green at ANY number of eslint errors, including in the one
 * package it did point at. Measured on origin/main@204898e1, before this change:
 *
 *     npm run lint   →  rc=1,  ✖ 206 problems (56 errors, 150 warnings)
 *     required check `lint`     →  green
 *
 * ⛤ And the flag was never needed for its stated purpose. eslint's exit code is
 * 0 when only WARNINGS are present and 1 when any ERROR is (verified both ways
 * on this tree: a warnings-only file exits 0, a file with one error exits 1), so
 * "allow lint warnings to not fail CI" was already true without it. For a year
 * the flag therefore suppressed nothing it was asked to suppress and everything
 * it was not. Widening the path list while that flag stood would have shipped a
 * measurer with no consequence — a gate with no red outcome at all.
 *
 * So this guard replaces the flagged step rather than joining it: it is the only
 * eslint step in the `lint` job, and it has no `continue-on-error`.
 *
 * ⛤ The author's INTENT from fa5251f8 is preserved, only its mechanism changed:
 * this ratchet gates on eslint ERRORS (severity 2) and reports warnings without
 * gating. Warnings are already blocked where they are cheapest to fix — the
 * `lint-staged` pre-commit hook runs `eslint --fix --max-warnings=0` on the
 * files a commit touches.
 *
 * ⛔ A RATCHET, not an invariant, because the debt is real and pre-existing.
 * Measured at introduction (origin/main@204898e1, 735 src files):
 *
 *     package           files  fatal  errors  warnings  (file,rule)
 *     obsidian-plugin     292      0      56       150           31
 *     core                298      0      25         5           14
 *     test-utils           15      0      26         8            4
 *     req-audit             4      0       8         6            2
 *     services              3      0       0         0            0
 *     cli                 122    122       0         0            — (not lintable, see below)
 *
 * Enforcing zero outright would red every PR from day one, and a gate that is
 * always red gets ignored. The ratchet freezes the 115 existing errors while
 * making it impossible to GROW them.
 *
 * ⛔ SCOPE IS DERIVED, NOT LISTED. A hand-written package list is the defect
 * #4497 reported, one indirection up: it goes stale the moment a package is
 * added, and silently. Scope here is the conjunction of two facts read off the
 * tree at run time:
 *   1. `packages/<p>/src` exists on disk;
 *   2. `<p>` is not excluded from `tsconfig.eslint.json`, the TS project that
 *      `eslint.config.mjs` hands to the type-aware rules.
 *
 * (2) is load-bearing and is why `packages/cli` is absent above. That config
 * excludes `packages/cli/**\/*`, so @typescript-eslint/parser cannot place a cli
 * file in any project and every one of its 122 files comes back as a FATAL parse
 * error — "The file was not found in any of the provided project(s)". Those are
 * not findings and must never reach a baseline: 122 keys that assert nothing
 * would read as coverage. That exclusion is also the ORIGINAL reason cli sits
 * outside the `lint-staged` eslint glob (commit 809e24e9, 2026-04-05: "exclude
 * packages/cli from ESLint rule (CLI is excluded from root tsconfig, causing
 * pre-commit failures)"), and it still holds — it merely moved from the root
 * tsconfig to the eslint-only one.
 *
 * ⛤ The exclusion cannot rot, because nothing here hard-codes it. Add cli to
 * `tsconfig.eslint.json` and it enters the sweep on the next run, its findings
 * arrive as NEW pairs, and the gate says so out loud. Conversely a fatal message
 * in an IN-scope package is rc=2, never a silent skip: either a package is
 * judged, or the run refuses to call itself clean.
 *
 * ⛔ The baseline keys on (file, rule) PAIRS WITH COUNTS, not on a total.
 * "115 errors" cannot tell "the same 115" from "one fixed, one introduced" — a
 * counter is satisfied by a swap, which is the regression this exists to catch.
 * Counts are compared too, so a SECOND instance of an already-baselined pair is
 * a finding (the same hole `check-cli-types.mjs` had to close once it noticed
 * nothing read its `count` field). Line numbers are excluded on purpose: any
 * edit above shifts them and the baseline would churn on unrelated changes.
 *
 * Fail-loud in BOTH directions:
 *   rc=0  the findings match the baseline exactly
 *   rc=1  a (file, rule) pair NOT in the baseline appeared        → regression
 *   rc=1  a baselined pair grew, shrank or is GONE                → update the baseline
 *   rc=1  a NEW lintable package entered the sweep                → review, then --update
 *   rc=2  the run cannot be trusted: no packages in scope, an in-scope package
 *         with zero linted files, a fatal parse error in scope, an unreadable
 *         baseline, or a sweep NARROWER than the baseline describes
 *
 * ⛤ rc=2 fails the job here, unlike the dependabot-alert ratchet where rc=2
 * fails OPEN. That one depends on a remote advisory endpoint, so a flaky third
 * party must not cost a release. This one reads the local tree with a local
 * eslint: there is no transient to absolve, and "I could not judge" is a real
 * defect in the check.
 *
 * Usage:
 *   node scripts/check-eslint-debt.mjs            # the gate (what CI runs)
 *   node scripts/check-eslint-debt.mjs --report    # full eslint output, always rc=0
 *   node scripts/check-eslint-debt.mjs --update    # rewrite the baseline
 *
 * Fixture injection: `ESLINT_DEBT_ROOT=<dir>` reads the package tree, the eslint
 * config, the TS project and the baseline from `<dir>` instead of the repo root.
 * The production path and the fixture path are the SAME code — the env var moves
 * the root, it does not switch strategy.
 */

import { ESLint } from "eslint";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const ROOT = process.env.ESLINT_DEBT_ROOT
  ? resolve(process.env.ESLINT_DEBT_ROOT)
  : REPO;
const BASELINE = join(ROOT, "scripts", "eslint-debt.baseline.json");
const UPDATE = process.argv.includes("--update");
const REPORT = process.argv.includes("--report");

const TS_PROJECT = join(ROOT, "tsconfig.eslint.json");

/** Repo-relative, forward-slash path — the baseline's key space. */
const rel = (p) => relative(ROOT, p).split(/[\\/]/).join("/");

/**
 * `exclude` globs of the eslint-only TS project.
 *
 * ⛔ Unreadable or missing is rc=2, not an empty list: an empty list would widen
 * the sweep to packages the parser cannot place in a project, and every one of
 * their files would come back fatal — a cascade whose cause is this read.
 */
function tsProjectExcludes() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(TS_PROJECT, "utf8"));
  } catch (err) {
    console.error(
      `❌ check-eslint-debt: BROKEN — cannot read ${rel(TS_PROJECT)}: ${String(err)}\n` +
        "   That file decides which packages the type-aware rules can judge, so\n" +
        "   without it the scope of this run is unknown (rc=2, not a finding).",
    );
    process.exit(2);
  }
  return Array.isArray(parsed?.exclude) ? parsed.exclude : [];
}

/**
 * Packages carrying a `src/`, split by whether eslint can judge them.
 *
 * ⛔ Classification is via statSync, NOT Dirent.isDirectory(): for a SYMLINK
 * both Dirent predicates return false, so a symlinked package would be skipped
 * silently and the guard would claim a clean sweep over a smaller tree than it
 * names. statSync follows the link; a dangling one throws and is skipped.
 */
function derivePackages() {
  const excludes = tsProjectExcludes();
  const pkgRoot = join(ROOT, "packages");
  let names;
  try {
    names = readdirSync(pkgRoot);
  } catch (err) {
    console.error(
      `❌ check-eslint-debt: BROKEN — cannot read ${rel(pkgRoot)}: ${String(err)}`,
    );
    process.exit(2);
  }
  const inScope = [];
  const notLintable = [];
  for (const name of names.sort()) {
    const src = join(pkgRoot, name, "src");
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue; // no src/, or unreadable
    }
    const excludedBy = excludes.find((g) =>
      g.split(/[\\/]/).join("/").startsWith(`packages/${name}/`),
    );
    if (excludedBy) notLintable.push({ name, excludedBy });
    else inScope.push(name);
  }
  return { inScope, notLintable };
}

/** Recursive walk collecting `*.ts` / `*.tsx`. statSync for the same reason. */
function collectTs(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectTs(full, out);
    else if (st.isFile() && /\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const { inScope, notLintable } = derivePackages();

if (inScope.length === 0) {
  console.error(
    "❌ check-eslint-debt: BROKEN — no packages/*/src survived scope derivation,\n" +
      "   so nothing was measured. This is not a pass.",
  );
  process.exit(2);
}

// ⛔ `warnIgnored: false` suppresses the per-file "ignored by config" warnings,
// and `isPathIgnored` makes the ignore DECISION come from eslint.config.mjs
// rather than from this walker. Two owners of one predicate drift; one does not.
const eslint = new ESLint({
  cwd: ROOT,
  warnIgnored: false,
  errorOnUnmatchedPattern: false,
});

/** @type {Map<string, string[]>} package → absolute file paths actually linted */
const filesByPkg = new Map();
for (const pkg of inScope) {
  const found = collectTs(join(ROOT, "packages", pkg, "src"), []);
  const kept = [];
  for (const f of found) {
    if (!(await eslint.isPathIgnored(f))) kept.push(f);
  }
  filesByPkg.set(pkg, kept);
}

// Population floor: a package whose src/ exists but yields zero judged files is
// rc=2, not "clean". Paths visited is not the same statement as content judged.
const empty = inScope.filter((p) => filesByPkg.get(p).length === 0);
if (empty.length > 0) {
  console.error(
    `❌ check-eslint-debt: BROKEN — ${empty.length} in-scope package(s) linted ZERO files: ` +
      `${empty.join(", ")}.\n` +
      "   packages/<p>/src exists, so either the walker stopped matching or the\n" +
      "   eslint config now ignores the whole package. Zero findings over zero\n" +
      "   input is not a clean bill of health.",
  );
  process.exit(2);
}

const allFiles = inScope.flatMap((p) => filesByPkg.get(p));
const results = await eslint.lintFiles(allFiles);

// ── Fatals: the run did not judge what it claims to ───────────────────────────
const fatals = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.fatal) fatals.push({ file: rel(r.filePath), message: m.message });
  }
}
if (fatals.length > 0) {
  console.error(
    `❌ check-eslint-debt: BROKEN — ${fatals.length} fatal parse error(s) inside the\n` +
      "   derived scope, so those files were not judged at all. The usual cause is a\n" +
      "   package that eslint.config.mjs lints but tsconfig.eslint.json does not\n" +
      "   include: @typescript-eslint/parser then refuses every file in it.\n" +
      "   Fix it by adding the package to tsconfig.eslint.json's project, or by\n" +
      "   excluding it there (which also removes it from this sweep, out loud).\n",
  );
  for (const f of fatals.slice(0, 5)) {
    console.error(`   ${f.file}`);
    console.error(`      ${f.message.split("\n")[0]}`);
  }
  if (fatals.length > 5) {
    console.error(`   … and ${fatals.length - 5} more`);
  }
  process.exit(2);
}

// ── Findings ──────────────────────────────────────────────────────────────────
const found = new Map(); // "file|rule" → count
let errorCount = 0;
let warningCount = 0;
for (const r of results) {
  for (const m of r.messages) {
    if (m.severity === 1) {
      warningCount++;
      continue;
    }
    errorCount++;
    const key = `${rel(r.filePath)}|${m.ruleId ?? "(no-rule)"}`;
    found.set(key, (found.get(key) ?? 0) + 1);
  }
}

const scopeLine =
  `check-eslint-debt: linted ${allFiles.length} file(s) across ${inScope.length} package(s) ` +
  `[${inScope.join(", ")}]; ${errorCount} error(s) in ${found.size} (file, rule) pair(s); ` +
  `${warningCount} warning(s) (reported, not gated)`;

if (REPORT) {
  const formatter = await eslint.loadFormatter("stylish");
  const text = await formatter.format(results);
  if (text.trim()) console.log(text);
  console.log(scopeLine);
  if (notLintable.length > 0) {
    for (const n of notLintable) {
      console.log(
        `   ⛤ packages/${n.name}/src is NOT linted: tsconfig.eslint.json excludes "${n.excludedBy}", ` +
          "so the type-aware parser cannot judge it.",
      );
    }
  }
  process.exit(0);
}

const entriesOf = () =>
  [...found.entries()]
    .map(([key, count]) => {
      const i = key.lastIndexOf("|");
      return { file: key.slice(0, i), rule: key.slice(i + 1), count };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));

if (UPDATE) {
  const entries = entriesOf();
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        _doc:
          "Frozen eslint ERROR debt for every lintable packages/<p>/src (issue #4497). " +
          "Keys are (file, rule) pairs with counts; `scope` is the derived package list. " +
          "⛔ Fix a new finding — do NOT add it here. See scripts/check-eslint-debt.mjs.",
        scope: inScope,
        entries,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    `✅ baseline written: ${entries.length} (file, rule) pair(s), ${errorCount} error(s), ` +
      `scope [${inScope.join(", ")}]`,
  );
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch (err) {
  console.error(
    `❌ check-eslint-debt: BROKEN — cannot read ${rel(BASELINE)}: ${String(err)}`,
  );
  process.exit(2);
}
if (!Array.isArray(baseline?.entries) || !Array.isArray(baseline?.scope)) {
  console.error(
    `❌ check-eslint-debt: BROKEN — ${rel(BASELINE)} parsed but lacks an \`entries\`\n` +
      "   or `scope` array, so the baseline is unusable (rc=2, not a finding).",
  );
  process.exit(2);
}

console.log(scopeLine);
console.log(
  `   baseline: ${baseline.entries.length} pair(s), scope [${baseline.scope.join(", ")}]`,
);
for (const n of notLintable) {
  console.log(
    `   ⛤ packages/${n.name}/src is NOT linted: tsconfig.eslint.json excludes "${n.excludedBy}".`,
  );
}

// ── Scope drift, judged BEFORE the findings ───────────────────────────────────
// ⛔ A sweep narrower than the baseline describes says nothing about the packages
// it dropped, so it is rc=2 rather than a finding. Wider is a finding: a new
// lintable package arrived and its debt must be reviewed, not absorbed.
const lost = baseline.scope.filter((p) => !inScope.includes(p));
if (lost.length > 0) {
  console.error(
    `\n❌ check-eslint-debt: BROKEN — the sweep covered FEWER packages than the baseline\n` +
      `   describes. Missing: ${lost.join(", ")}.\n` +
      "   Either packages/<p>/src disappeared or tsconfig.eslint.json now excludes it.\n" +
      "   This run says nothing about those packages, so it is not a pass. If the\n" +
      "   narrowing is intended, say so in the change and re-run with --update.",
  );
  process.exit(2);
}
const gained = inScope.filter((p) => !baseline.scope.includes(p));

const known = new Set(baseline.entries.map((e) => `${e.file}|${e.rule}`));
const baseCount = new Map(
  baseline.entries.map((e) => [`${e.file}|${e.rule}`, e.count ?? 0]),
);
const newPairs = [...found.keys()].filter((k) => !known.has(k)).sort();
const gonePairs = [...known].filter((k) => !found.has(k)).sort();
const grown = [...found.entries()]
  .filter(([k, c]) => known.has(k) && c > (baseCount.get(k) ?? 0))
  .sort();
const shrunk = [...found.entries()]
  .filter(([k, c]) => known.has(k) && c < (baseCount.get(k) ?? 0))
  .sort();

const show = (key) => {
  const i = key.lastIndexOf("|");
  return `${key.slice(0, i)} — ${key.slice(i + 1)}`;
};

let bad = false;

if (gained.length > 0) {
  console.error(
    `\n❌ NEW lintable package(s) entered the sweep: ${gained.join(", ")}.\n` +
      "   Review their findings below, fix what should be fixed, and only then\n" +
      "   re-run with --update so the remainder is frozen deliberately.",
  );
  bad = true;
}

if (newPairs.length > 0) {
  console.error(
    `\n❌ NEW eslint error(s) — ${newPairs.length} (file, rule) pair(s):\n`,
  );
  for (const key of newPairs) console.error(`   ${show(key)}`);
  console.error(
    "\n   Fix the error — do NOT add it to the baseline. The baseline freezes the\n" +
      "   debt that existed when this gate was introduced; absorbing new debt is how\n" +
      "   a ratchet becomes a licence. A deliberate exception goes in eslint.config.mjs\n" +
      "   or on an `eslint-disable-next-line` carrying its reason.",
  );
  bad = true;
}

if (grown.length > 0) {
  console.error(
    `\n❌ ${grown.length} baselined pair(s) GREW — new instances of known debt:\n`,
  );
  for (const [key, count] of grown) {
    console.error(`   ${show(key)}: ${baseCount.get(key)} → ${count}`);
  }
  bad = true;
}

if (gonePairs.length > 0 || shrunk.length > 0) {
  console.error(
    `\n❌ the baseline is STALE — ${gonePairs.length} pair(s) no longer occur and ` +
      `${shrunk.length} shrank.\n` +
      "   Debt was paid; re-run with --update and commit the smaller baseline. A\n" +
      "   baseline nobody prunes stops describing the code and becomes licence.\n",
  );
  for (const key of gonePairs.slice(0, 10)) console.error(`   gone:   ${show(key)}`);
  for (const [key, count] of shrunk.slice(0, 10)) {
    console.error(`   shrank: ${show(key)}: ${baseCount.get(key)} → ${count}`);
  }
  bad = true;
}

if (bad) process.exit(1);

console.log(
  `✅ check-eslint-debt OK — ${found.size} (file, rule) pair(s) match the baseline; ` +
    "no new eslint errors.",
);
