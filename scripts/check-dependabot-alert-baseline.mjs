#!/usr/bin/env node
/**
 * check-dependabot-alert-baseline — ratchet over the set of vulnerable package
 * NAMES reachable from every lockfile in the repo.
 *
 * ── WHY THIS EXISTS (task 689a7dc5, 2026-10-02) ────────────────────────────
 * Nine Dependabot alerts sat open for up to 25 days with ZERO open PRs, and
 * nothing in CI said a word. The reason is structural, not negligence:
 *
 *   · "0 open Dependabot PRs" and "0 open alerts" are DIFFERENT predicates.
 *     Dependabot opens no PR when the fix needs a major, when the path is
 *     transitive, or when the directory has no `dependabot.yml` entry at all —
 *     and `/packages/core` deliberately has none (PR #4143).
 *   · The release gate `npm-audit-exocortex` runs `--omit=dev
 *     --audit-level=high`. MEASURED on `d1c775d4`: those two filters do not
 *     overlap, and together they judged NONE of the nine. `--omit=dev` dropped
 *     js-yaml (the only high), `--audit-level=high` dropped moment. The gate
 *     was GREEN, correctly, while six alerts sat on a lockfile nothing even
 *     installs from.
 *
 * So the gate answers "does a production dep carry a high advisory TODAY" and
 * it must keep answering only that — raising its level would block releases on
 * a known-and-accepted moderate. This ratchet answers the OTHER question, the
 * one nobody asked: "did a NEW vulnerable package name appear anywhere in our
 * lock graph since we last looked?" A known debt stays silent; a new name goes
 * RED. That is the class the nine alerts belong to.
 *
 * ── WHY `npm audit` AND NOT THE DEPENDABOT API ─────────────────────────────
 * The REST endpoint `/repos/{o}/{r}/dependabot/alerts` is the better oracle —
 * it is literally the thing that was unobserved. It is NOT used here because a
 * workflow's default `GITHUB_TOKEN` carries no Dependabot-alerts permission
 * (the `permissions:` key has no such scope), so in CI it would 404 forever
 * and this check would be exit-2 on every run — a gate that cannot be red.
 * `npm audit` needs no token and reads EVERY lockfile, including one no job
 * installs from, which is exactly how the drift went unseen.
 *
 * ⛔ WHAT A GREEN VERDICT HERE DOES **NOT** MEAN. It means "npm reports no name
 * outside the baseline", NOT "there are no Dependabot alerts". The two read
 * DIFFERENT advisory databases over DIFFERENT inputs, and the divergence was
 * MEASURED, not feared: on `d1c775d4` GitHub had open alerts for
 * brace-expansion / browserslist / baseline-browser-mapping that `npm audit`
 * did not report AT ALL (they sat in `packages/core/package-lock.json`, whose
 * pins no job resolves). Known blind spots of this ratchet:
 *   · an advisory GitHub's database carries and npm's does not (or carries
 *     earlier — the GH Advisory Database is often days ahead);
 *   · an alert on a path that is not in any lockfile we sweep;
 *   · anything Dependabot reports about a manifest without a lockfile.
 * ⇒ The ORACLE for "are there open alerts" stays the alerts themselves
 * (`gh api repos/kitelev/exocortex/dependabot/alerts`). This ratchet is a
 * CHANGE detector over the lock graph, deliberately narrower, and it exists
 * because it needs no token and therefore can actually run on every push.
 *
 * ⚠ The UNITS also differ, which matters when comparing counts: `npm audit`
 * collapses several vulnerable ranges of one package into ONE entry (js-yaml
 * `3.0.0 - 3.15.1 || 4.0.0 - 4.3.1`), while Dependabot opens one alert PER
 * range. So 1 baselined key here == 2 open alerts there. Do not read a
 * smaller number as a smaller problem.
 *
 * ⚠ If the two diverge again, trust the alerts and widen the lock sweep —
 * do not relax the baseline.
 *
 * Usage:
 *   node scripts/check-dependabot-alert-baseline.mjs           # judge
 *   node scripts/check-dependabot-alert-baseline.mjs --update  # re-baseline
 *
 * Exit codes (shape borrowed from `scripts/check-spec-anchors.mjs`):
 *   0 — the vulnerable-name set is EXACTLY the baseline
 *   1 — a NEW name appeared, or a baselined name is gone (stale licence)
 *   2 — NOT JUDGED (no lockfiles found, nothing parsed, registry transient,
 *       unreadable baseline). Never silently green.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ⛤ ROOT and BASELINE are INJECTABLE, and that is a precondition of testability, not a
 * convenience: without it the revert-verify axes would sweep the real repo and rewrite the
 * real baseline (integration-test-revert-verify §A11/§A61 — a harness that cannot isolate its
 * channel either hits production or does not exist). The axes inject a throw-away git tree
 * plus `npm_config_registry` pointing at a local advisory stub, so the PRODUCTION path —
 * `git ls-files`, `npm audit`, the parse, the ratchet — is the thing under test; only the
 * tree, the baseline file and the advisory endpoint are stood in for.
 *
 * ⛔ Deliberately NOT injectable: the `npm audit` invocation itself. Replacing the whole
 * command would take the real resolution path out from under every axis and leave it
 * unexercised (self-authored-claim-loses-its-provenance §A59); standing in one level LOWER —
 * at the registry — keeps it exercised.
 */
const ROOT = process.env.DEPENDABOT_RATCHET_ROOT
  ? resolve(process.env.DEPENDABOT_RATCHET_ROOT)
  : dirname(HERE);
const BASELINE = process.env.DEPENDABOT_RATCHET_BASELINE
  ? resolve(process.env.DEPENDABOT_RATCHET_BASELINE)
  : join(HERE, "dependabot-alerts.baseline.json");
const UPDATE = process.argv.includes("--update");

/**
 * ⛔ Transient registry failures must NOT read as "no vulnerabilities". The
 * marker list is the same one `ci.yml`'s audit step retries on (ticket
 * 60958576): npm retired the `/quick` advisory endpoint, so a maintenance
 * window surfaces as a hard failure rather than a fallback.
 */
const TRANSIENT =
  /audit endpoint returned an error|npm warn audit [45][0-9][0-9] |Bad Request|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i;

function die(code, lines) {
  for (const l of lines) console.error(l);
  process.exit(code);
}

/**
 * Lockfiles are ENUMERATED from git, never listed literally: a lockfile added
 * tomorrow must enter the sweep by construction. Listing them by hand is how
 * `packages/core/package-lock.json` stayed outside every observer for months
 * (hook-matcher-vs-declared-surface §A4 — the sweep's reach must be wider than
 * the names you happen to remember).
 */
function findLockfiles() {
  const out = execFileSync("git", ["ls-files", "-z", "*package-lock.json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return out.split("\0").filter((p) => p.endsWith("package-lock.json")).sort();
}

/** Run `npm audit --json` in `dir`. Returns {ok, report} or {ok:false, transient, raw}. */
function auditDir(dir) {
  let raw = "";
  try {
    raw = execFileSync("npm", ["audit", "--json"], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // `npm audit` exits 1 when advisories exist — that is a RESULT, not a failure.
    raw = String(err.stdout ?? "");
    const errText = String(err.stderr ?? "") + raw;
    if (!raw.trim() || TRANSIENT.test(errText)) {
      return { ok: false, transient: TRANSIENT.test(errText), raw: errText.slice(0, 400) };
    }
  }
  try {
    return { ok: true, report: JSON.parse(raw) };
  } catch {
    return { ok: false, transient: false, raw: raw.slice(0, 400) };
  }
}

/**
 * A key is `<lockdir>::<package>::<GHSA>`.
 *
 * ⛔ Only packages carrying their OWN advisory are counted. `npm audit` also
 * lists CARRIERS — a package that merely depends on a vulnerable one (here:
 * `obsidian` for moment, `eslint-plugin-obsidianmd` for its own chain). Those
 * have no GHSA of their own, and counting them would make the baseline churn
 * every time an unrelated dependency re-points. Measured: with carriers
 * included the root lock reports 4 names, with them excluded 2 — and 2 is what
 * Dependabot reports for the same lock.
 */
function keysFromReport(lockPath, report) {
  const dir = dirname(lockPath) === "." ? "<root>" : dirname(lockPath);
  const keys = new Map(); // key -> human reason
  const vulns = report?.vulnerabilities ?? {};
  for (const [name, info] of Object.entries(vulns)) {
    for (const via of info.via ?? []) {
      if (typeof via !== "object" || !via.url) continue;
      const ghsa = String(via.url).replace(/\/+$/, "").split("/").pop();
      if (!/^GHSA-/.test(ghsa)) continue;
      const key = `${dir}::${name}::${ghsa}`;
      keys.set(
        key,
        `${via.severity ?? info.severity ?? "?"} · ${String(via.title ?? "").slice(0, 72)}`,
      );
    }
  }
  return keys;
}

// ── sweep ──────────────────────────────────────────────────────────────────
const locks = findLockfiles();
if (locks.length === 0) {
  die(2, [
    "⛔ check-dependabot-alert-baseline: `git ls-files` matched NO lockfile.",
    "   Zero lockfiles means the sweep judged nothing — that is 'not judged',",
    "   not 'nothing vulnerable'.",
  ]);
}

const found = new Map();
let parsed = 0;
const failures = [];
for (const lock of locks) {
  const dir = join(ROOT, dirname(lock));
  if (!existsSync(join(dir, "package.json"))) {
    failures.push(`${lock} — no package.json beside it; npm audit cannot run`);
    continue;
  }
  const res = auditDir(dir);
  if (!res.ok) {
    failures.push(`${lock} — ${res.transient ? "TRANSIENT registry error" : "unparsable output"}: ${res.raw}`);
    continue;
  }
  parsed += 1;
  for (const [k, why] of keysFromReport(lock, res.report)) found.set(k, why);
}

/**
 * ⚠ Report the SIZE OF THE INPUT next to the finding count. "0 findings over 3
 * lockfiles" and "0 findings because nothing parsed" are different facts and
 * must not print the same (self-satisfying-metric-weak-verifier §A9).
 */
console.log(
  `check-dependabot-alert-baseline: lockfiles ${locks.length} · audited ${parsed} · ` +
    `failed ${failures.length} · vulnerable keys ${found.size}`,
);
for (const l of locks) console.log(`   · lockfile in sweep: ${l}`);

if (parsed === 0) {
  die(2, [
    "",
    "⛔ check-dependabot-alert-baseline: not a single lockfile was audited.",
    "   Without a parsed report there is nothing to ratchet — 'not judged'.",
    ...failures.map((f) => `   ⛔ ${f}`),
  ]);
}

if (failures.some((f) => f.includes("TRANSIENT"))) {
  die(2, [
    "",
    "⛔ check-dependabot-alert-baseline: the advisory endpoint failed for at least",
    "   one lockfile, so the sweep is INCOMPLETE. A partial sweep cannot be green:",
    "   a new name could be hiding in the lockfile that did not answer.",
    ...failures.map((f) => `   ⛔ ${f}`),
    "   Re-run the job (gh run rerun <run-id> --failed).",
  ]);
}
for (const f of failures) console.log(`   ⚠ non-transient skip: ${f}`);

const keys = [...found.keys()].sort();

// ── --update: name what is being grandfathered, never just count ───────────
if (UPDATE) {
  let previous = [];
  try {
    const raw = JSON.parse(readFileSync(BASELINE, "utf8"));
    if (Array.isArray(raw)) previous = raw;
  } catch {
    previous = [];
  }
  const prevSet = new Set(previous);
  const added = keys.filter((k) => !prevSet.has(k));
  const dropped = previous.filter((k) => !keys.includes(k)).sort();
  writeFileSync(BASELINE, JSON.stringify(keys, null, 2) + "\n");
  console.log(
    `✅ baseline rewritten: ${keys.length} key(s) → ${relative(ROOT, BASELINE)} ` +
      `(+${added.length} grandfathered, -${dropped.length} pruned)`,
  );
  for (const k of added)
    console.log(`   + GRANDFATHERED (justify this in the PR): ${k} — ${found.get(k)}`);
  for (const k of dropped) console.log(`   - pruned (no longer reported): ${k}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  if (!Array.isArray(baseline)) throw new Error("baseline is not an array");
} catch (err) {
  die(2, [
    `⛔ check-dependabot-alert-baseline: baseline unreadable (${String(err.message ?? err).slice(0, 120)}).`,
    "   Without it there is nothing to ratchet against — 'not judged'.",
  ]);
}

const baseSet = new Set(baseline);
const regressions = keys.filter((k) => !baseSet.has(k));
const stale = baseline.filter((k) => !found.has(k)).sort();

for (const k of keys.filter((k) => baseSet.has(k)))
  console.log(`   · baselined (not blocking): ${k} — ${found.get(k)}`);

if (regressions.length > 0) {
  console.error(
    `\n❌ check-dependabot-alert-baseline: ${regressions.length} NEW vulnerable package`,
    `\n   name(s) in the lock graph. Nothing else in CI reports this: the release gate`,
    `\n   only asks about production deps at high+, so a new dev-scope or moderate`,
    `\n   advisory is invisible to it by design.`,
  );
  for (const k of regressions) console.error(`   ⛔ ${k} — ${found.get(k)}`);
  console.error(
    "\n   Fix: bump it, or (if the path is not exploitable) record WHY in the PR and\n" +
      "   grandfather it: node scripts/check-dependabot-alert-baseline.mjs --update\n" +
      "   ⛔ 'dev-only' is not a reason by itself — dev code still runs in CI. Say what\n" +
      "   bounds the damage (dist grep showing 0 occurrences, a timeout, a missing input).",
  );
}

/**
 * ⛔ Fail-loud in BOTH directions. A baselined key that stopped being reported is
 * good news that must not stay implicit: left in place it turns the baseline from
 * a description of the debt into a standing licence (aggregate-hides-dead-stream
 * §A2 — the composition is the verdict, not the count).
 */
if (stale.length > 0) {
  console.error(
    `\n❌ check-dependabot-alert-baseline: ${stale.length} baselined key(s) are no longer`,
    "\n   reported. Prune them, or the baseline stops describing the lock graph:",
    "\n     node scripts/check-dependabot-alert-baseline.mjs --update",
  );
  for (const k of stale) console.error(`   ⛔ stale baseline entry: ${k}`);
}

if (regressions.length > 0 || stale.length > 0) process.exit(1);

/**
 * ⛔ The green line states what was MEASURED. With a non-empty baseline some
 * advisories ARE live, and saying "no vulnerabilities" would be a signature the
 * mechanism does not support (decision-surface-must-derive-from-mechanism).
 */
console.log(
  keys.length === 0
    ? `✅ check-dependabot-alert-baseline: ${parsed} lockfile(s) audited, no advisory ` +
        `reported; baseline is empty — no debt to grandfather.`
    : `✅ check-dependabot-alert-baseline: ${parsed} lockfile(s) audited; the ${keys.length} ` +
        `reported key(s) are exactly the baselined ones — no new name, nothing stale.`,
);

/**
 * ⛔ The scope line is printed on EVERY run, green included. The limitation has to live
 * where the verdict is READ (the job log), not only in this file's header — nobody opens
 * the source of a job that passed, and a bare ✅ would be taken as "no open alerts".
 */
console.log(
  "   ⚠ scope: this is `npm audit` over the repo's lockfiles — NOT the Dependabot alert\n" +
    "     list. Green means 'no vulnerable NAME outside the baseline', not 'no open alerts':\n" +
    "     the GH Advisory Database can carry an advisory npm does not, and one npm entry can\n" +
    "     cover several alerts (one per vulnerable range). Oracle for alerts:\n" +
    "     gh api repos/kitelev/exocortex/dependabot/alerts --paginate",
);
