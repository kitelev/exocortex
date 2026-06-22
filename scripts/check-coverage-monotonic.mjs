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

import { readFileSync } from "fs";
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
    `✅ coverage-monotonic guard OK — ${summary.length} threshold(s) at or above baseline (no downward drift).`,
  );
}

main();
