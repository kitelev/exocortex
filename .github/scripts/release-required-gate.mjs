#!/usr/bin/env node
/**
 * Release gate: decide from the REQUIRED-CHECK SET, not from the whole run's verdict (#4488).
 *
 * ⛔ Why `workflow_run.conclusion == 'success'` is the wrong predicate. `auto-release.yml` is
 * reachable only via `workflow_run`, and that event carries ONE field: the verdict of the whole
 * CI run. Any job that is NOT in branch protection's required set — a timed-out aggregator, a
 * flaky non-required check — drags that verdict to `cancelled`/`failure`, so the release is
 * silently not cut while every required check is green. MEASURED on merge `fb832b34` (#4188,
 * 2026-10-01): 14/14 required `success`, `e2e-tests` `cancelled` after 155 s against a
 * `timeout-minutes: 2` budget, CI run `cancelled`, `Auto Release` `skipped`, v17.7.25 never
 * published. The commit was not lost (the next release's `git log LAST_TAG..HEAD` swept it up),
 * but no release followed it.
 *
 * ⛔ Why the required set is DERIVED here and never written down. "All required checks are green"
 * needs the LIST of required contexts, and that list MOVES: it is 14 today and the repo's own
 * docs said 13 a fortnight ago. A hardcoded list would trade today's silent skip for a silent
 * WRONG release — a newly added required check simply would not be gated on. So the list is read
 * from the API at run time (decision-surface-must-derive-from-mechanism: generate, never author).
 *
 * ⛤ Which endpoint, and why this one — MEASURED, not assumed (probe run 36914576062 /
 * 36914746090, dispatched on a branch with the default job-scoped GITHUB_TOKEN):
 *
 *   GET /repos/{o}/{r}/branches/main/protection/required_status_checks  → 403 "Resource not
 *       accessible by integration"  (needs admin; GITHUB_TOKEN cannot be granted it — there is
 *       no `administration` key in a workflow's `permissions:`)
 *   GET /repos/{o}/{r}/branches/main/protection                        → 403, same
 *   GET /repos/{o}/{r}/branches/main                                   → 200, and its
 *       `.protection.required_status_checks.contexts` carries ALL 14 names
 *   GET /repos/{o}/{r}/rulesets                                        → 200 `[]` — protection
 *       lives in classic branch protection, so the branch object is the authoritative source
 *   GET /repos/{o}/{r}/commits/{sha}/status                            → `state: pending, n: 0`
 *       — there are no commit statuses at all in this repo; verdicts live in CHECK-RUNS
 *       (ci-watch-check-runs-not-rollup)
 *
 * ⇒ the branch object is the one source a release job can actually read. `contents: read` is
 * enough for it; `checks: read` covers the check-runs listing.
 *
 * ⛔ Fail-OPEN to the old predicate, never to a looser one. If the required set cannot be read
 * (403 / rate limit / transient), the gate falls back to `workflow_run.conclusion == 'success'`
 * and says so (`judged=false`, exit 2). That is safe BY CONSTRUCTION: "the whole run succeeded"
 * is strictly STRONGER than "every required check is green", so the fallback can never cut a
 * release the old gate would have refused — it only restores the old silent-skip class, which
 * the audit job then reports instead of swallowing (self-satisfying-metric-weak-verifier §A22:
 * a broken DATA SOURCE is fail-open, with its own name for the outcome).
 *
 * ⛔ An EMPTY required set is "no verdict", not "nothing to wait for". With `required = []` the
 * "no check is failing and none is missing" predicate is vacuously true, which would publish on
 * every run — the exact shape `ci-watch.py` had to guard after the protection API failed
 * transiently (self-satisfying-metric-weak-verifier §A7: a zero from a broken measurement is
 * indistinguishable from a clean one).
 *
 * Usage (CLI):  node .github/scripts/release-required-gate.mjs
 *   env: GITHUB_REPOSITORY, HEAD_SHA, WORKFLOW_CONCLUSION, GH_TOKEN, [GITHUB_OUTPUT],
 *        [GITHUB_STEP_SUMMARY], [DEFAULT_BRANCH=main]
 *   exit 0 = a verdict was reached from the required set (read `release=`)
 *   exit 2 = the required set could not be read; `release=` is the FALLBACK verdict
 */

import { appendFileSync } from "node:fs";

/**
 * Conclusions that satisfy a required context. `skipped` and `neutral` count as satisfied
 * because branch protection treats them that way (a docs-only run skips heavy jobs and still
 * merges) — the same set `~/.claude/lib/ci-watch.py` applies.
 */
export const PASS_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/**
 * ⛔ Deliberately NOT a FAIL list. `ci-watch.py` enumerates failures because it is a WATCHER:
 * an unknown conclusion there means "keep waiting", which is harmless. This is a GATE with no
 * later poll, so an unknown conclusion must mean "do not release" rather than "treat as green".
 * Anything completed and outside PASS_CONCLUSIONS therefore blocks (fail-closed on the unknown).
 */
export function classify(run) {
  const conclusion = run?.conclusion ?? null;
  if (conclusion === null) return "pending";
  return PASS_CONCLUSIONS.has(conclusion) ? "pass" : "fail";
}

/**
 * Collapse several check-runs sharing a name down to the most recent one.
 *
 * The listing is requested with `filter=latest`, which GitHub documents as one run per name —
 * but a gate must not rest on a signature it cannot verify, and a stale RED shadowing a
 * re-run GREEN would block releases silently. Keyed on `started_at` (then `id`, monotonic) so
 * the choice does not depend on the order the API happened to return.
 */
export function latestByName(checkRuns) {
  const by = new Map();
  for (const run of checkRuns) {
    if (!run || typeof run.name !== "string") continue;
    const prev = by.get(run.name);
    if (!prev) {
      by.set(run.name, run);
      continue;
    }
    const a = `${run.started_at ?? ""}#${String(run.id ?? 0).padStart(20, "0")}`;
    const b = `${prev.started_at ?? ""}#${String(prev.id ?? 0).padStart(20, "0")}`;
    if (a > b) by.set(run.name, run);
  }
  return by;
}

/**
 * The whole decision, as a pure function — so the axes drive THIS, not a reimplementation.
 *
 * @param {object}   args
 * @param {string[]|null} args.requiredContexts  null ⇒ the set could not be read
 * @param {object[]} args.checkRuns
 * @param {string|null} args.workflowConclusion  the `workflow_run.conclusion` fallback input
 */
export function decide({ requiredContexts, checkRuns, workflowConclusion }) {
  const fallback = () => ({
    release: workflowConclusion === "success",
    judged: false,
    reason:
      "required-set-unavailable — fell back to workflow_run.conclusion" +
      `=${workflowConclusion ?? "<none>"} (strictly STRONGER than the required-set predicate, ` +
      "so this cannot cut a release the old gate refused; it does restore the silent-skip class)",
    requiredN: Array.isArray(requiredContexts) ? requiredContexts.length : 0,
    greenN: 0,
    missing: [],
    failing: [],
  });

  if (!Array.isArray(requiredContexts) || requiredContexts.length === 0)
    return fallback();

  const latest = latestByName(Array.isArray(checkRuns) ? checkRuns : []);

  // ⛔ Canary on the OTHER input: an empty check-run listing with a non-empty required set
  // means every context reads as "missing", which is indistinguishable from a transport
  // failure. Judge nothing rather than publish a verdict built on an empty measurement.
  if (latest.size === 0) {
    const f = fallback();
    f.reason =
      "check-runs listing empty while the required set is not — the measurement, not the " +
      "commit, is at fault; " +
      f.reason;
    return f;
  }

  const missing = [];
  const failing = [];
  let greenN = 0;
  for (const context of requiredContexts) {
    const run = latest.get(context);
    if (!run) {
      missing.push(context);
      continue;
    }
    const state = classify(run);
    if (state === "pass") greenN += 1;
    else if (state === "fail") failing.push(`${context}=${run.conclusion}`);
    else missing.push(`${context}=pending`);
  }

  const release = failing.length === 0 && missing.length === 0;
  return {
    release,
    judged: true,
    reason: release
      ? `every one of ${requiredContexts.length} required context(s) is satisfied`
      : `required not satisfied — failing=[${failing.join(", ")}] missing=[${missing.join(", ")}]`,
    requiredN: requiredContexts.length,
    greenN,
    missing,
    failing,
  };
}

/* ────────────────────────────── Audit mode: the class detector ───────────────────────────── */

/**
 * The SECOND acceptance item of #4488, and the one that does not depend on which fix was
 * chosen: "`Auto Release` with a `skipped` verdict while the required set is green must not pass
 * unnoticed." A `skipped` run is not `failure`, so it never shows up in a sweep of red runs —
 * the defect's whole character is that nothing is red anywhere.
 *
 * ⛔ This is NOT an optional garnish on the gate above. Two distinct mechanisms of this same
 * observable were found in ONE window (this one, and a red non-required `npm-audit-exocortex`,
 * #4489). A third will be found the same way — silently — unless something reports it. So the
 * detector keys on the OUTCOME ("required green, yet nothing was released") rather than on the
 * mechanism, and a correctly shipped gate does not make it redundant: it makes it quiet.
 *
 * ⛤ Shape borrowed from `scripts/check-spec-anchors.mjs`: a verdict that distinguishes
 * "clean" from "could not judge", never collapsing the second into the first.
 *
 * @returns {{rc: 0|1, verdict: string, message: string}}
 *   rc 1 ⇒ the audit job goes RED, which is the entire point: `skipped` is invisible, `failure`
 *   is not.
 */
export function auditVerdict({
  gateJudged,
  gateRelease,
  gateReason,
  autoReleaseResult,
  hasCommits,
  tagExists,
}) {
  // ⛔ A broken DATA SOURCE (protection API 403 / rate limit) is fail-open, but it must carry its
  // OWN name — collapsing it into "clean" is what makes a monitor's silence unreadable
  // (self-satisfying-metric-weak-verifier §A22). It cannot go RED either: the gate then has no
  // required set, so "was the required set green?" is a question nobody answered, and a red run
  // on every transient 403 would train the reader to ignore this job.
  if (gateJudged !== true) {
    return {
      rc: 0,
      verdict: "UNJUDGED",
      message:
        "the required set could not be read, so whether the release SHOULD have been cut is " +
        `not established — the gate fell back to the run verdict. Gate said: ${gateReason}`,
    };
  }

  if (gateRelease !== true) {
    return {
      rc: 0,
      verdict: "NO-RELEASE-EXPECTED",
      message: `required set not satisfied, so not releasing is correct. ${gateReason}`,
    };
  }

  // From here the required set IS green and the gate DID ask for a release.
  if (autoReleaseResult !== "success") {
    return {
      rc: 1,
      verdict: "SILENT-SKIP",
      message:
        `the required set is green and the gate asked for a release, yet the release job ` +
        `ended as '${autoReleaseResult}'. This is the #4488 class: nothing is red, nothing is ` +
        "published. Read that job's log; if the gate itself is wrong, that is the regression.",
    };
  }

  // The job succeeded — but succeeding is not releasing. Both of these are LEGITIMATE reasons
  // for a green job to publish nothing, and they must be told apart from "it published nothing
  // and nobody noticed" (activity-signal-is-not-progress).
  if (hasCommits === false) {
    return {
      rc: 0,
      verdict: "NOTHING-TO-RELEASE",
      message:
        "no commits since the last tag — a green run that correctly publishes nothing.",
    };
  }
  if (tagExists === true) {
    return {
      rc: 0,
      verdict: "ALREADY-RELEASED",
      message:
        "the computed tag already exists — already published, nothing to do.",
    };
  }

  return {
    rc: 0,
    verdict: "RELEASED",
    message:
      "required set green, commits present, tag fresh — the release ran.",
  };
}

function boolEnv(name) {
  const v = process.env[name];
  if (v === "true") return true;
  if (v === "false") return false;
  return null; // absent / empty ⇒ unknown, which the verdict function must not read as `false`
}

export function auditMain() {
  const result = auditVerdict({
    gateJudged: boolEnv("GATE_JUDGED"),
    gateRelease: boolEnv("GATE_RELEASE"),
    gateReason: process.env.GATE_REASON || "<no reason reported>",
    autoReleaseResult: process.env.AR_RESULT || "<absent>",
    hasCommits: boolEnv("AR_HAS_COMMITS"),
    tagExists: boolEnv("AR_TAG_EXISTS"),
  });

  /* Positive proof of scope: print every input, so a verdict can be re-derived from the log. */
  console.log(
    "release-audit inputs: " +
      `gate.judged=${process.env.GATE_JUDGED ?? "<absent>"} ` +
      `gate.release=${process.env.GATE_RELEASE ?? "<absent>"} ` +
      `auto-release.result=${process.env.AR_RESULT ?? "<absent>"} ` +
      `has_commits=${process.env.AR_HAS_COMMITS ?? "<absent>"} ` +
      `tag_exists=${process.env.AR_TAG_EXISTS ?? "<absent>"}`,
  );
  const line = `release-audit: ${result.verdict} — ${result.message}`;
  if (result.rc === 0) console.log(`✅ ${line}`);
  else console.error(`::error::${line}`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(
      summary,
      `### Release audit (#4488)\n\n**${result.verdict}** — ${result.message}\n`,
    );
  }
  return result.rc;
}

/* ────────────────────────────── I/O side (exercised by the axes via a fetch stub) ────────── */

/**
 * ⛤ The base URL comes from `GITHUB_API_URL`, which GitHub Actions sets on every runner (it
 * exists for GHES, where api.github.com is the wrong host). Reading it is platform conformance,
 * not a test seam — and it is what lets the axes drive THIS function against a local server, so
 * the header and paging behaviour below are covered on the real path rather than stubbed away
 * (integration-test-revert-verify §A59: a seam that routes the production branch around the axes
 * leaves it unproven).
 */
const API_BASE = (
  process.env.GITHUB_API_URL || "https://api.github.com"
).replace(/\/+$/, "");

/**
 * ⚠ Stale answers are real, and the guard against them is one header.
 *
 * MEASURED 2026-10-01: an Actions *listing* URL
 * (`/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=40`) served a window stale by
 * 12 days — `newest=2026-09-19` while runs from `2026-10-01` existed — and `Cache-Control:
 * no-cache` returned the fresh one. The cache key includes the FULL URL: the same URL with a
 * different `per_page` was already answering fresh at that moment.
 *
 * ⛔ The RATE is not measured, and the obvious protocol cannot measure it: fetching one URL twice
 * (plain, then no-cache) warms the cache with the FIRST request, so the state that produces the
 * divergence is destroyed by the act of looking — 25 pairs across three endpoints gave 0
 * divergences, which is a property of that protocol, not of the world.
 *
 * ⛤ The header is set anyway, and the reason is the COST ASYMMETRY rather than a measured rate:
 * it costs nothing — no token, no latency beyond the request itself, no configuration — while the
 * damage is a FALSE VERDICT ABOUT A RELEASE, which whoever reads it takes for a fact about the
 * world. An unmeasured rate would be a reason to withhold a guard that cost something; it is not
 * a reason to withhold a free one.
 *
 * ⛔ And "the gate only reads POINTWISE endpoints, and it is fail-closed on absent data" does NOT
 * cover this on its own — that argument was weighed and found too weak to stand alone. Fail-closed
 * handles a stale answer that comes back EMPTY (`judged=false` ⇒ fall back to the old predicate).
 * It does nothing about a stale answer that comes back NON-EMPTY but OLD: a `/branches/main` reply
 * listing yesterday's 13 contexts instead of today's 14 would let a release through without gating
 * on the new required check — a silently WRONG release, the very trade this fix exists to avoid.
 */
async function api(path, token, { tries = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          // See this function's header: free, and the damage it guards against is a false
          // verdict about a release.
          "Cache-Control": "no-cache",
        },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} on ${path}`);
      } else {
        return { ok: true, body: await res.json(), headers: res.headers };
      }
    } catch (err) {
      lastErr = err;
    }
    const backoff = Number(process.env.GATE_RETRY_BACKOFF_MS ?? 1500);
    if (attempt < tries)
      await new Promise((r) => setTimeout(r, backoff * attempt));
  }
  return { ok: false, error: String(lastErr?.message ?? lastErr) };
}

/** `.protection.required_status_checks.contexts` of the default branch, or null. */
export async function fetchRequiredContexts(repo, branch, token) {
  const res = await api(
    `/repos/${repo}/branches/${encodeURIComponent(branch)}`,
    token,
  );
  if (!res.ok) return { contexts: null, error: res.error };
  const contexts = res.body?.protection?.required_status_checks?.contexts;
  if (!Array.isArray(contexts)) {
    return {
      contexts: null,
      error:
        "branch object carries no .protection.required_status_checks.contexts " +
        `(protection.enabled=${res.body?.protection?.enabled ?? "<absent>"})`,
    };
  }
  return { contexts, error: null };
}

/**
 * Every check-run of a commit. Pages explicitly: a required context falling off page 1 would
 * read as "missing" and block the release quietly, which is the same silence this gate exists
 * to remove.
 */
export async function fetchCheckRuns(repo, sha, token) {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await api(
      `/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`,
      token,
    );
    if (!res.ok) return { checkRuns: null, error: res.error };
    const batch = res.body?.check_runs;
    if (!Array.isArray(batch))
      return { checkRuns: null, error: "check_runs absent in response" };
    out.push(...batch);
    const total = Number(res.body?.total_count ?? out.length);
    if (out.length >= total || batch.length === 0) break;
  }
  return { checkRuns: out, error: null };
}

function emit(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  console.log(`  ${name}=${value}`);
}

export async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.HEAD_SHA;
  const branch = process.env.DEFAULT_BRANCH || "main";
  const token = process.env.GH_TOKEN;
  const workflowConclusion = process.env.WORKFLOW_CONCLUSION || null;

  if (!repo || !sha || !token) {
    console.error(
      "❌ release-required-gate: GITHUB_REPOSITORY, HEAD_SHA and GH_TOKEN are required.",
    );
    return 2;
  }

  const req = await fetchRequiredContexts(repo, branch, token);
  const runs = req.contexts
    ? await fetchCheckRuns(repo, sha, token)
    : { checkRuns: [] };

  const verdict = decide({
    requiredContexts: req.contexts,
    checkRuns: runs.checkRuns ?? [],
    workflowConclusion,
  });

  /* Positive proof of SCOPE: say what was judged, not only what was found. */
  console.log(
    `release-required-gate: sha=${sha.slice(0, 8)} branch=${branch} ` +
      `required=${verdict.requiredN} satisfied=${verdict.greenN} ` +
      `check-runs=${(runs.checkRuns ?? []).length} ` +
      `workflow_run.conclusion=${workflowConclusion ?? "<none>"} judged=${verdict.judged}`,
  );
  if (req.error) console.log(`  required-set error: ${req.error}`);
  if (runs.error) console.log(`  check-runs error: ${runs.error}`);
  console.log(`  verdict: release=${verdict.release} — ${verdict.reason}`);

  emit("release", String(verdict.release));
  emit("judged", String(verdict.judged));
  emit("reason", verdict.reason.replace(/\n/g, " "));
  emit("required_n", String(verdict.requiredN));
  emit("green_n", String(verdict.greenN));

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(
      summary,
      `### Release gate (required-set, #4488)\n\n` +
        `- sha: \`${sha.slice(0, 8)}\`\n` +
        `- required contexts: **${verdict.requiredN}**, satisfied: **${verdict.greenN}**\n` +
        `- \`workflow_run.conclusion\`: \`${workflowConclusion ?? "<none>"}\`\n` +
        `- judged from the required set: **${verdict.judged}**\n` +
        `- verdict: **release=${verdict.release}** — ${verdict.reason}\n`,
    );
  }

  // exit 2 = no verdict from the required set (the printed `release` is the fallback).
  return verdict.judged ? 0 : 2;
}

// `process.argv[1]` ends with this file only when run as a script, never when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--audit")) {
    process.exit(auditMain());
  } else {
    main().then(
      (code) => process.exit(code),
      (err) => {
        console.error(`❌ release-required-gate: ${err?.stack ?? err}`);
        process.exit(2);
      },
    );
  }
}
