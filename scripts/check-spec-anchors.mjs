#!/usr/bin/env node
/**
 * Ratchet: every mutant-driver spec's `from` anchor must still occur EXACTLY ONCE in
 * its subject as that subject reads NOW. Fails on any NEW dead anchor.
 *
 * ⛔ Why this needs a repo-side gate at all. The 229 `*.spec.json` under `packages/`
 * are the revert-verify layer: each mutant names a `from` string in its subject, and
 * `~/.claude/bin/mutant-driver.py` guts it to prove the declared axes can go RED. An
 * anchor that no longer occurs makes the driver refuse the mutation (`rc=2`) — the axes
 * it guarded keep passing while nothing proves they would fail. No jest `testMatch`
 * covers `*.spec.json`, so no required check sees this; the only detector was the
 * author-side sweep `~/.claude/bin/spec-anchor-sweep.py`, and that one judges ONLY the
 * subjects the branch touched.
 *
 * That scope is precisely the hole. #4352 redefined `TBOX_FORM` in
 * `packages/cli/src/cache/CacheManager.ts`; the anchor it retired lived in a FOREIGN
 * spec (`cache-manifest-delta-4263.spec.json :: M4_tbox_guard_removed`), so the author's
 * own sweep never looked at it. MEASURED over the whole lifetime of the spec corpus
 * (2026-09-18 — the first commit carrying a `.spec.json` — through 2026-09-29,
 * 125 commits of `origin/main`): >=1 dead anchor on **61%** of commits across **8**
 * episodes. Seven lasted 2-3 commits — the author-side sweep catches those, because the
 * spec and the subject move together. The eighth was the foreign one: **68 consecutive
 * commits**, i.e. 54% of the corpus's entire life, ended only because an unrelated PR
 * happened to re-anchor it. A full-corpus sweep is the only shape that sees it.
 *
 * ⛤ Cost, measured before choosing CI over an out-of-repo cron: **0.09 s** for 229 specs /
 * 897 mutants / 118 distinct subjects. The sweep COUNTS SUBSTRINGS — it does not run a
 * single mutant — so the intuitive objection ("229 specs × a harness run") does not apply.
 * At that price the gate belongs in the already-required `lint` job, next to the six
 * sibling ratchets, where the finding reaches the PR AUTHOR rather than an operator's
 * inbox a day later.
 *
 * ⛔ A RATCHET BY NAMES, not `broken > 0`. The sweep judges all 229 specs; a PR author
 * answers only for the subjects their diff touched. "Any dead anchor ⇒ red" asserts more
 * than their change (integration-test-revert-verify §A126) and would stop the first
 * uninvolved PR behind someone else's debt. So the verdict is the DELTA against a
 * baseline of dead-anchor KEYS.
 *
 * ⛔ The baseline is a SET OF `spec :: mutant` KEYS, deliberately not a count. "3 dead"
 * cannot distinguish "the same 3" from "one repaired, one introduced" — a counter is
 * satisfied by a swap, which is exactly the regression this exists to catch. The
 * occurrence count (0, 2, …) is PRINTED but not part of the key: it changes whenever the
 * subject is edited, so keying on it would churn the baseline on unrelated changes.
 *
 * MEASURED at introduction (origin/main@88a8c4e0): dead anchors **0**, so the baseline
 * starts EMPTY — the ratchet begins at zero debt and any dead anchor is a regression.
 *
 * Fail-loud in BOTH directions:
 *   rc=1  a `spec :: mutant` key NOT in the baseline is dead              → regression
 *   rc=1  a baselined key is alive again                                  → debt paid, prune the baseline
 *   rc=2  the sweep could not judge (no spec parsed / submodule subject
 *         absent / the self-check failed)                                 → NOT "clean"
 *
 * The second direction matters as much as the first: a baseline nobody prunes silently
 * stops describing the corpus, and then it is a licence rather than a ratchet
 * (self-satisfying-metric-weak-verifier §A2). `--update` rewrites it.
 *
 * ⛤ The self-check is not optional ceremony. The verdict this gate publishes most often
 * is a ZERO, and a zero from a broken sweep is indistinguishable from a clean corpus
 * (self-satisfying-metric-weak-verifier §A7). So every run first proves the classifier
 * discriminates, on an anchor taken from the live corpus: the real string must read as
 * live, the same string with a sentinel spliced in must read as dead (count 0), and a
 * doubled subject must read as dead (count 2). A failure there is rc=2, never rc=0.
 *
 * Usage: node scripts/check-spec-anchors.mjs [--update]
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "spec-anchors.baseline.json");
const UPDATE = process.argv.includes("--update");

/**
 * Specs carry their subject machine-independently, as this literal prefix. Kept
 * byte-identical to `~/.claude/bin/spec-anchor-sweep.py` and to `mutant-driver.py`'s
 * callers: a spec whose subject neither starts with it nor lies under the repo root is
 * invisible to every tool that reads it, which is itself a finding (see below).
 */
const PLACEHOLDER = "<ABSOLUTE PATH TO YOUR exocortex CHECKOUT>/";

/** Submodule paths from .gitmodules — their blobs are NOT this repo's. */
function submodulePrefixes() {
  let raw;
  try {
    raw = readFileSync(join(ROOT, ".gitmodules"), "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((l) => /^\s*path\s*=\s*(.+?)\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => m[1].replace(/\/*$/, "") + "/");
}

/** Every *.spec.json under packages/ (the corpus; verified repo-wide — none live elsewhere). */
function specFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".git")
          continue;
        walk(join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith(".spec.json")) {
        out.push(join(dir, e.name));
      }
    }
  };
  walk(join(ROOT, "packages"));
  return out.sort();
}

/**
 * Non-overlapping occurrences of `needle` in `hay` — the same semantics as Python's
 * `str.count`, which is what spec-anchor-sweep.py and mutant-driver.py apply. An empty
 * needle counts as 0 here: a mutant with no `from` cannot anchor, and Python's answer
 * (len+1) would read as "many" rather than as the defect it is.
 */
function countAnchor(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

const SUBMODULES = submodulePrefixes();
const specs = specFiles();
const srcCache = new Map();

function subjectSource(rel) {
  if (!srcCache.has(rel)) {
    const abs = join(ROOT, rel);
    let src = null;
    try {
      if (statSync(abs).isFile()) src = readFileSync(abs, "utf8");
    } catch {
      src = null;
    }
    srcCache.set(rel, src);
  }
  return srcCache.get(rel);
}

const findings = []; // { key, why }
const unjudged = []; // submodule subject absent ⇒ the checkout, not the corpus, is at fault
const live = []; // { rel, from } — material for the self-check
let parsed = 0;
let mutants = 0;
const subjects = new Set();

for (const abs of specs) {
  const specRel = relative(ROOT, abs);
  let spec;
  try {
    spec = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    findings.push({
      key: `${specRel} :: <parse>`,
      why: String(err.message ?? err).slice(0, 120),
    });
    continue;
  }
  /**
   * ⛔ `JSON.parse` succeeding does not make the result an object: the literal `null`
   * parses fine and then `spec.subject` throws an uncaught TypeError, which aborts the
   * sweep mid-corpus — every spec after it goes unreported, and the stack trace does not
   * even name the offending file. Fail as a FINDING, keyed and named, and keep sweeping.
   * (Review r1 LOW, reproduced: `echo null > x.spec.json`.)
   */
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    findings.push({
      key: `${specRel} :: <spec>`,
      why: `not a JSON object: ${Array.isArray(spec) ? "array" : String(spec)}`,
    });
    continue;
  }
  parsed += 1;
  const subject = String(spec.subject ?? "");
  let rel = null;
  if (subject.includes(PLACEHOLDER)) rel = subject.split(PLACEHOLDER)[1];
  else if (subject.startsWith(ROOT + "/")) rel = subject.slice(ROOT.length + 1);
  /**
   * ⛔ A prefix match is not containment. `<PLACEHOLDER>/../../tmp/x` starts with the
   * placeholder and still walks out of the repo, so the resolved path is read and judged
   * as a legitimate subject — making this file's own header claim ("a subject that
   * neither starts with the placeholder nor lies under the repo root is invisible")
   * FALSE for exactly the shape that looks resolvable. Normalise and verify, so the
   * invariant is a property of the mechanism rather than of the comment
   * (decision-surface-must-derive-from-mechanism). Review r1 MEDIUM, reproduced in both
   * the placeholder and the ROOT-literal form.
   */
  if (rel !== null && !resolve(ROOT, rel).startsWith(ROOT + "/")) {
    findings.push({
      key: `${specRel} :: <subject>`,
      why: `escapes the repo: ${rel.slice(0, 80)}`,
    });
    continue;
  }
  if (rel === null) {
    // Not a missing file — a subject no tool can resolve, on ANY machine. The spec is
    // invisible forever while the driver still reports a verdict about it.
    findings.push({
      key: `${specRel} :: <subject>`,
      why: `unresolvable: ${(subject || "<none>").slice(0, 80)}`,
    });
    continue;
  }
  subjects.add(rel);
  const src = subjectSource(rel);
  if (src === null) {
    if (SUBMODULES.some((p) => rel.startsWith(p))) {
      // ⛔ "not judged", NOT a dead anchor: the lint job must check out submodules for
      // these 12 specs (28 mutants) to be judged at all, and a silent skip here would
      // make the gate quietly narrower than it claims.
      unjudged.push({
        key: `${specRel} :: <submodule>`,
        why: `not checked out: ${rel}`,
      });
      continue;
    }
    findings.push({ key: `${specRel} :: <subject>`, why: `missing: ${rel}` });
    continue;
  }
  for (const [name, m] of Object.entries(spec.mutants ?? {})) {
    mutants += 1;
    const from = Array.isArray(m) ? m[0] : (m?.from ?? "");
    const n = countAnchor(src, from);
    if (n === 1) live.push({ rel, from });
    else findings.push({ key: `${specRel} :: ${name}`, why: `count ${n}` });
  }
}

/* ── Positive scope proof: say what was judged, not only what was found. ─────────── */
console.log(
  `check-spec-anchors: specs on disk ${specs.length} · parsed ${parsed} · ` +
    `subjects ${subjects.size} · mutants judged ${mutants} · dead ${findings.length} · ` +
    `unjudged ${unjudged.length}`,
);

if (specs.length === 0 || parsed === 0) {
  console.error(
    "❌ check-spec-anchors: no spec parsed under packages/ — the sweep judged nothing.\n" +
      "   A zero here would be a broken sweep, not a clean corpus.",
  );
  process.exit(2);
}

/* ── Self-check (canary): prove the classifier discriminates, on live corpus material. ── */
if (live.length === 0) {
  console.error(
    "❌ check-spec-anchors: not one live anchor in the whole corpus — the classifier\n" +
      "   cannot be shown to discriminate, so this run is 'not judged'.",
  );
  process.exit(2);
}
{
  const { rel, from } = live[0];
  const src = subjectSource(rel);
  const SENTINEL = "__check_spec_anchors_canary__";
  const broken =
    from.slice(0, Math.max(1, Math.floor(from.length / 2))) + SENTINEL;
  const ok =
    countAnchor(src, from) === 1 &&
    countAnchor(src, broken) === 0 &&
    countAnchor(src + src, from) === 2;
  if (!ok) {
    console.error(
      "❌ check-spec-anchors: self-check failed — the classifier did not separate\n" +
        `   live / absent / duplicated on ${rel}. Verdict withheld.`,
    );
    process.exit(2);
  }
}

if (unjudged.length > 0) {
  console.error(
    `❌ check-spec-anchors: ${unjudged.length} spec(s) could not be judged because their\n` +
      "   subject lives in a submodule that is not checked out. Add `submodules: recursive`\n" +
      "   to this job's checkout — a narrower sweep must not pass as a clean one.",
  );
  for (const u of unjudged) console.error(`   ~ ${u.key} — ${u.why}`);
  process.exit(2);
}

/* ── Ratchet against the baseline of dead-anchor keys. ───────────────────────────── */
const deadKeys = findings.map((f) => f.key).sort();
const whyByKey = new Map(findings.map((f) => [f.key, f.why]));
if (UPDATE) {
  /**
   * ⛔ `--update` is the disarm path, so it must NAME what it grandfathers. Printing only
   * a count makes "one key I am deliberately deferring" and "two keys, one of which is
   * somebody else's break I never looked at" produce identical output, and the JSON diff
   * — bare strings with no reason field — does not distinguish them either. The delta is
   * printed per key so the PR's own CI log carries it even if the diff is skimmed.
   * (Review r1 MEDIUM; the opposite direction was already guarded — a baselined key that
   * comes back to life fails loud.)
   */
  let previous = [];
  try {
    const raw = JSON.parse(readFileSync(BASELINE, "utf8"));
    if (Array.isArray(raw)) previous = raw;
  } catch {
    previous = [];
  }
  const prevSet = new Set(previous);
  const added = deadKeys.filter((k) => !prevSet.has(k));
  const dropped = previous.filter((k) => !deadKeys.includes(k)).sort();
  writeFileSync(BASELINE, JSON.stringify(deadKeys, null, 2) + "\n");
  console.log(
    `✅ baseline rewritten: ${deadKeys.length} key(s) → ${relative(ROOT, BASELINE)} ` +
      `(+${added.length} grandfathered, -${dropped.length} pruned)`,
  );
  for (const k of added)
    console.log(
      `   + GRANDFATHERED (justify this in the PR): ${k} — ${whyByKey.get(k)}`,
    );
  for (const k of dropped) console.log(`   - pruned (no longer dead): ${k}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  if (!Array.isArray(baseline)) throw new Error("baseline is not an array");
} catch (err) {
  console.error(
    `❌ check-spec-anchors: baseline unreadable (${String(err.message ?? err).slice(0, 120)}).\n` +
      "   Without it there is nothing to ratchet against — this is 'not judged'.",
  );
  process.exit(2);
}

const baseSet = new Set(baseline);
const regressions = deadKeys.filter((k) => !baseSet.has(k));
const repaired = baseline.filter((k) => !whyByKey.has(k)).sort();

for (const k of deadKeys.filter((k) => baseSet.has(k))) {
  console.log(`   · baselined (not blocking): ${k} — ${whyByKey.get(k)}`);
}

if (regressions.length > 0) {
  console.error(
    `\n❌ check-spec-anchors: ${regressions.length} NEW dead anchor(s). The axes they guard\n` +
      "   have no revert-verify: mutant-driver.py refuses the mutation, so nothing proves\n" +
      "   those tests would fail if the behaviour were removed.",
  );
  for (const k of regressions) console.error(`   ⛔ ${k} — ${whyByKey.get(k)}`);
  console.error(
    "\n   Fix: re-anchor the mutant's `from` on the CURRENT text of its subject, and\n" +
      "   anchor it on a FORM that survives the next edit rather than on today's literal\n" +
      "   value (integration-test-revert-verify §A69); say why in the mutant's `_note`.\n" +
      "   Then prove it: python3 -I ~/.claude/bin/mutant-driver.py <spec> --only '<mutant>'",
  );
}

if (repaired.length > 0) {
  console.error(
    `\n❌ check-spec-anchors: ${repaired.length} baselined key(s) are no longer dead.\n` +
      "   Good news that must not stay implicit — prune them, or the baseline stops\n" +
      "   describing the corpus and becomes a licence:\n" +
      "     node scripts/check-spec-anchors.mjs --update",
  );
  for (const k of repaired) console.error(`   ⛔ stale baseline entry: ${k}`);
}

if (regressions.length > 0 || repaired.length > 0) process.exit(1);

/**
 * ⛔ The green line states what was MEASURED, not "all good": with a non-empty baseline
 * some anchors ARE dead, and claiming "every anchor occurs exactly once" would be a
 * signature the mechanism does not support
 * (decision-surface-must-derive-from-mechanism).
 */
console.log(
  deadKeys.length === 0
    ? `✅ check-spec-anchors: every anchor of ${mutants} mutant(s) occurs exactly once; ` +
        `baseline is empty (0 key(s)) — no debt to grandfather.`
    : `✅ check-spec-anchors: ${mutants} mutant(s) judged; the ${deadKeys.length} dead ` +
        `key(s) are exactly the baselined ones — no new regression, nothing repaired.`,
);
