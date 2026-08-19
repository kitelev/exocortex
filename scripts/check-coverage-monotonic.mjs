#!/usr/bin/env node
//
// check-coverage-monotonic.mjs — ratchet guard: jest coverage thresholds may
// only GROW, never silently drop.
//
// Source: test-quality audit 2026-06-22, recommendation P5.1. The audit (§
// coverage) flagged that the obsidian-plugin branch threshold had drifted DOWN
// (64 -> 63) and statements down (76 -> 75.5) "due to marginal failure" — a
// soft smell: a threshold lowered to make a red build pass is a coverage
// regression hidden as a config tweak.
//
// Mechanism: scripts/coverage-thresholds-baseline.json records the high-water
// mark for every jest.config.js coverageThreshold.global metric. This guard
// reads each config's CURRENT thresholds and FAILS (exit 1) if any metric is
// BELOW its baseline. Thresholds may rise freely (ratchet the baseline number
// UP — allowed). LOWERING is only possible by editing the baseline number down
// — a conscious, reviewed act that, under everything-req-first (RFC 0003), must
// carry a req__Requirement justification. So a coverage threshold can never
// silently drift down: the config must stay >= baseline, and moving the
// baseline down is the explicit withdrawal.
//
// Wired into the required `lint` CI job (alongside check-test-antipatterns.sh).
//
// Usage:
//   node scripts/check-coverage-monotonic.mjs            # CI gate
//
// Testability (the @req binding test drives the guard against a fixture):
//   COVERAGE_BASELINE  — path to the baseline JSON (default: <root>/scripts/coverage-thresholds-baseline.json)
//   COVERAGE_ROOT      — root that config paths in the baseline resolve against (default: repo root)

import { readdirSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const baselinePath =
  process.env.COVERAGE_BASELINE ??
  resolve(SCRIPT_DIR, "coverage-thresholds-baseline.json");
const configRoot = process.env.COVERAGE_ROOT ?? REPO_ROOT;

/**
 * Extract the coverageThreshold.global metric numbers from a jest config's
 * source text. Regex-based (the config is a JS module that may import other
 * modules, so importing it is unsafe — mirrors the esbuild-config text-assert
 * precedent). The `global` block contains only `metric: number` pairs and no
 * nested braces, so a non-greedy `{...}` capture is robust.
 *
 * @param {string} text jest.config.js source
 * @returns {Record<string, number>} e.g. { branches: 95, functions: 95, ... }
 */
function extractThresholds(text) {
  const ctIdx = text.indexOf("coverageThreshold");
  if (ctIdx === -1) return {};
  const fromCt = text.slice(ctIdx);
  const globalMatch = fromCt.match(/global\s*:\s*\{([^}]*)\}/);
  if (!globalMatch) return {};
  const body = globalMatch[1];
  /** @type {Record<string, number>} */
  const out = {};
  const pairRe = /(\w+)\s*:\s*([\d.]+)/g;
  let m;
  while ((m = pairRe.exec(body)) !== null) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

function loadBaseline(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  // Support both the wrapped shape ({_comment, thresholds:{...}}) and a bare map.
  return parsed.thresholds ?? parsed;
}

/**
 * Every `packages/<pkg>/jest*.config.{js,cjs,mjs,ts}` whose `coverageThreshold.global`
 * block actually parses — the independent oracle for "is the baseline complete?".
 *
 * ⛔ The scope is stated precisely because an earlier draft of this comment claimed
 * "every jest config that declares a coverageThreshold", and that was literally false:
 * the enumeration was `packages/*\/jest.config.js` alone. Review probed six carriers that
 * genuinely declare thresholds and every one exited 0 — `jest.ui.config.js`,
 * `jest.config.mjs`, `jest.config.ts`, a `package.json` `jest` key, a nested
 * `config/jest.config.js`, and thresholds carried by a shared preset. The first of those
 * is NOT hypothetical: packages/obsidian-plugin/jest.ui.config.js exists today, in the
 * very package this baseline gates. It carries no threshold yet.
 *
 * ⚠ Two carriers remain out of reach of a text scan and are named rather than pretended
 * away: a `jest` key inside package.json, and thresholds inherited from a preset. Both
 * fail in the SILENT direction, which is why the limit is written here.
 *
 * ⛔ Without this the guard proves only "the configs I happen to track did not regress",
 * never "every config that carries thresholds is tracked". Those are different claims,
 * and the gap between them is silent: a new package that gains a coverageThreshold is
 * simply absent from the baseline, the loop never visits it, and the success line just
 * prints a smaller count that nobody has an expected value for. Three packages
 * (req-audit, services, test-utils) have jest configs WITHOUT thresholds today — the
 * day any of them gains one, that is exactly this hole.
 */
function findConfigsWithThresholds(packagesDir) {
  const out = [];
  let pkgs;
  try {
    pkgs = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return out; // caller treats an empty result as "the deriver is broken"
  }
  for (const p of pkgs) {
    if (!p.isDirectory()) continue;
    let entries;
    try {
      entries = readdirSync(resolve(packagesDir, p.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.isFile() || !/^jest.*\.config\.(js|cjs|mjs|ts)$/.test(f.name)) continue;
      let text;
      try {
        text = readFileSync(resolve(packagesDir, p.name, f.name), "utf8");
      } catch {
        continue;
      }
      // ⛤ STRUCTURAL, not a substring. `.includes("coverageThreshold")` matched the word
      // in a COMMENT — probed: a config saying "// no coverageThreshold here on purpose"
      // exited 1, reddening a REQUIRED check, and the remedy it printed ("add it at its
      // current values") would have written a `{}` entry that looks tracked and tracks
      // nothing. Reusing extractThresholds also collapses two predicates into one, so
      // "what counts as declaring" can never drift from "what gets compared".
      if (Object.keys(extractThresholds(text)).length > 0) {
        out.push(`packages/${p.name}/${f.name}`);
      }
    }
  }
  return out;
}

function main() {
  let baseline;
  try {
    baseline = loadBaseline(baselinePath);
  } catch (e) {
    console.error(
      `❌ coverage-monotonic guard: could not read baseline ${baselinePath}: ${e.message}`,
    );
    process.exit(1);
  }

  // ⛤ POSITIVE scope proof, BEFORE the per-entry loop. The loop below iterates
  // Object.entries(baseline); an empty baseline therefore never enters it, collects no
  // violation, and prints "✅ … 0 threshold(s)" with rc=0 — the gate satisfied by an
  // empty input. Both halves are checked: the baseline must be non-empty, and it must
  // cover every config that actually declares thresholds.
  const declaring = findConfigsWithThresholds(resolve(configRoot, "packages"));
  if (declaring.length === 0) {
    console.error(
      "❌ coverage-monotonic guard: found no jest config declaring a coverageThreshold\n" +
        `   under ${resolve(configRoot, "packages")}. The expected set cannot be derived,\n` +
        "   so this run has nothing to check the baseline against — the packages directory\n" +
        "   is missing or renamed. Fix that; do NOT trim the baseline to match.",
    );
    process.exit(1);
  }
  const untracked = declaring.filter((c) => !(c in baseline));
  if (untracked.length > 0) {
    console.error(
      `❌ coverage-monotonic guard: ${untracked.length} jest config(s) declare a\n` +
        "   coverageThreshold but are NOT in the baseline, so their thresholds could drop\n" +
        "   to zero unnoticed:",
    );
    for (const c of untracked) console.error(`   ${c}`);
    console.error(
      "\n   Add them to scripts/coverage-thresholds-baseline.json at their CURRENT values.",
    );
    process.exit(1);
  }

  const violations = [];
  const summary = [];

  for (const [configRel, baseMetrics] of Object.entries(baseline)) {
    const configAbs = resolve(configRoot, configRel);
    let current;
    try {
      current = extractThresholds(readFileSync(configAbs, "utf8"));
    } catch (e) {
      violations.push(
        `${configRel}: cannot read config (${e.message}) — a tracked jest config must exist`,
      );
      continue;
    }
    for (const [metric, baseVal] of Object.entries(baseMetrics)) {
      const cur = current[metric];
      if (cur === undefined) {
        violations.push(
          `${configRel} ${metric}: threshold REMOVED (baseline ${baseVal}) — a tracked coverage threshold may not be deleted`,
        );
        continue;
      }
      if (cur < baseVal) {
        violations.push(
          `${configRel} ${metric}: ${cur} < baseline ${baseVal} — coverage threshold lowered`,
        );
      } else {
        summary.push(`${configRel} ${metric}=${cur} (>=${baseVal})`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `❌ coverage-monotonic guard: ${violations.length} threshold(s) below baseline (coverage regression):`,
    );
    for (const v of violations) console.error(`   ${v}`);
    console.error(
      "\n   Coverage thresholds may only GROW. To raise a threshold, ratchet the",
    );
    console.error(
      "   number UP in scripts/coverage-thresholds-baseline.json (allowed).",
    );
    console.error(
      "   LOWERING a baseline number is a coverage regression that requires an",
    );
    console.error(
      "   explicit req__Requirement justification (RFC 0003 everything-req-first).",
    );
    process.exit(1);
  }

  console.log(
    `✅ coverage-monotonic guard OK — ${summary.length} threshold(s) across ` +
      `${declaring.length} config(s) at or above baseline (no downward drift).`,
  );
}

main();
