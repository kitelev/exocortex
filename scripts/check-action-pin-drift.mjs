#!/usr/bin/env node
/**
 * Guard: every pinned GitHub Action must resolve to ONE version across all of
 * `.github/` — workflows AND nested composite actions.
 *
 * ⛔ Why this needs a machine guard rather than Dependabot: Dependabot's
 * `github-actions` ecosystem DOES NOT scan nested composite actions. Our
 * `.github/dependabot.yml` declares one `github-actions` entry with
 * `directory: "/"`, and that surface is `.github/workflows/*.yml` — NOT
 * `.github/actions/<name>/action.yml`. So a pin living in a composite action can
 * never receive a bump PR, and the drift it accumulates is signalled by
 * nothing: no job fails, no bot complains, the pin just silently ages.
 *
 * That is not hypothetical — it is what issue #4487 measured. On 2026-10-01
 * PR #4190 bumped `actions/setup-node` 4 → 7 across 8 workflow files and
 * PR #4189 bumped `actions/checkout` to v7 across 10, while
 * `.github/actions/setup-node-pnpm/action.yml` stayed on `setup-node@v4` +
 * `cache@v4`. That composite action is `uses:`-d 13 times in ci.yml, so the
 * stale pins sat on the hot path of essentially every required check
 * (typecheck, lint, test-component, test-coverage, parity-gate,
 * requirements-trace, e2e-shard). The same class had already been written down
 * one level up, in dependabot.yml's own comment: "Дрейф уже наблюдаем:
 * actions/checkout@v4 и @v6 сосуществуют в одном репо."
 *
 * ⛤ The invariant is checked here rather than by widening Dependabot's
 * `directory:` on purpose. A config entry only extends the scanning surface of
 * a third-party tool — it cannot be verified from this repo, it goes stale
 * when that tool's behaviour changes, and a silently-ignored entry is worse
 * than no entry because it reads as coverage. This guard instead asserts the
 * PROPERTY we actually want ("one version per action, everywhere under
 * .github") and is falsifiable here, in CI, by a revert-verify.
 *
 * ⛔ Deliberately NOT a ratchet over a baseline, unlike the other lint guards.
 * Measured on origin/main@93752880 at introduction: 17 release units, 89 pin
 * occurrences, 14 yaml files — and EXACTLY 2 units drifting, both of them the
 * two pins in `setup-node-pnpm/action.yml` that this change fixes. With zero
 * grandfathered debt the guard can enforce the invariant outright, so there is
 * no baseline file to let a NEW drift hide behind. If a genuine need for two
 * concurrent versions ever appears, the red is the correct signal to make that
 * an explicit, reviewed decision — ⛔ there is no env escape hatch, because an
 * escape makes a bypass indistinguishable from compliance.
 *
 * ⛤ WHY IT PARSES `uses:` KEYS AND NOT SUBSTRINGS. The naive predicate — grep
 * the tree for `actions/setup-node@` and demand a single distinct line — looks
 * equivalent and is not: it also matches PROSE. Three live examples in this
 * repo today: two present-tense lines in setup-node-pnpm/README.md (which this
 * change updates, since they describe the action and became false when the pin
 * moved) and `ci.yml`'s comment "Aggregator previously ran
 * `actions/setup-node@v4`" — which is PAST TENSE and TRUE. A substring guard
 * would force that historical statement to be falsified to go green, i.e. it
 * would red on correct content. The discriminator is the tense of the claim,
 * which no regex can read; so the guard reads the `uses:` KEY — the only place
 * a version is actually in effect.
 *
 * ⛤ Comment immunity is carried by the ANCHOR, not by a comment filter. `uses:`
 * must sit at the start of the line (after optional indentation and an optional
 * YAML sequence dash), so a `#` in the first non-space position cannot match by
 * construction — which covers both a prose note and a commented-out step. An
 * earlier revision also filtered `line.trimStart().startsWith("#")`; its mutant
 * reddened NOTHING, because no comment line can reach the regex in the first
 * place. It was removed rather than kept as belt-and-braces: a redundant check
 * reads like the thing that provides the property, and the next person to relax
 * the anchor would trust it. The mutant that proves this axis therefore strips
 * the anchor (M3 in check-action-pin-drift.spec.json).
 *
 * ⛤ Grouping is by `owner/repo`, the RELEASE unit, not by the full action path.
 * `github/codeql-action/{init,analyze,upload-sarif}` are three action paths out
 * of one repo with one release train; pinning them to different versions is
 * the same defect as pinning setup-node twice. Grouping by full path would
 * call that clean.
 *
 * Exit codes:
 *   0 — one version per release unit (prints the scanned counts)
 *   1 — at least one release unit pinned to >1 version (prints every occurrence)
 *   2 — BROKEN: the measurement itself did not happen (no yaml files, or files
 *       but zero pins). ⛔ Zero findings over zero input is NOT a clean bill of
 *       health, and reporting it as one is how a dead check passes forever.
 *
 * Fixture injection: `ACTION_PIN_ROOT=<dir>` scans `<dir>/.github` instead of
 * the repo root. The production path and the fixture path are the SAME code —
 * the env var moves the root, it does not switch enumeration strategy.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.env.ACTION_PIN_ROOT || process.cwd();
const GITHUB_DIR = path.join(ROOT, ".github");

// A `uses:` key, optionally the first entry of a YAML sequence, with an
// optional quote. The value stops at whitespace or `#` so a trailing comment
// (`uses: actions/foo@v1 # pinned deliberately`) does not leak into the ref.
const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/;

/**
 * Recursive walk collecting `*.yml` / `*.yaml`.
 *
 * ⛔ Classification is via statSync, NOT Dirent.isDirectory()/isFile(): for a
 * SYMLINK both Dirent predicates return false, so a symlinked subtree would be
 * skipped silently and the guard would report a clean sweep over a smaller tree
 * than it claims. statSync follows the link; a dangling one throws ENOENT and a
 * link loop throws ELOOP, both of which are skipped rather than crashing.
 */
function collectYaml(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // dangling symlink / unreadable
    }
    if (st.isDirectory()) {
      collectYaml(full, out);
    } else if (st.isFile() && /\.ya?ml$/i.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const files = collectYaml(GITHUB_DIR, []).sort();

if (files.length === 0) {
  console.error(
    `❌ check-action-pin-drift: BROKEN — found no *.yml/*.yaml under ${GITHUB_DIR}, ` +
      `so nothing was measured. The guard did not run; this is not a pass.`,
  );
  process.exit(2);
}

/** @type {Map<string, Array<{file: string, line: number, version: string}>>} */
const units = new Map();
let pinCount = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = USES.exec(line);
    if (!m) continue;
    const ref = m[1];
    // Local composite actions carry no version (they move with the commit) and
    // container images are not Actions releases — neither is subject to this
    // invariant. ⛤ Of these three prefixes only `docker://` is load-bearing
    // here, and only for the DIGEST-pinned form: `./x` and `docker://img:tag`
    // have no `@` and are already dropped by the version check below, whereas
    // `docker://ghcr.io/o/img@sha256:…` does carry one and would otherwise be
    // grouped as release unit `ghcr.io/o` pinned to a "version" of `sha256:…`
    // — two digests of the same image would then red a correct tree.
    if (
      ref.startsWith("./") ||
      ref.startsWith("../") ||
      ref.startsWith("docker://")
    )
      continue;
    const at = ref.lastIndexOf("@");
    if (at <= 0) continue;
    const action = ref.slice(0, at);
    const version = ref.slice(at + 1);
    const parts = action.split("/");
    const unit = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : action;
    if (!units.has(unit)) units.set(unit, []);
    units.get(unit).push({ file: rel, line: i + 1, version });
    pinCount++;
  }
}

if (pinCount === 0) {
  console.error(
    `❌ check-action-pin-drift: BROKEN — scanned ${files.length} yaml file(s) under ` +
      `${GITHUB_DIR} and matched 0 action pin(s). A repo with workflows always has ` +
      `pins, so this means the parser stopped matching, not that the tree is clean.`,
  );
  process.exit(2);
}

const drifting = [...units.entries()]
  .filter(([, occ]) => new Set(occ.map((o) => o.version)).size > 1)
  .sort(([a], [b]) => a.localeCompare(b));

if (drifting.length > 0) {
  console.error(
    `❌ check-action-pin-drift: ${drifting.length} action(s) pinned to more than one version ` +
      `(scanned ${files.length} file(s), ${pinCount} pin(s), ${units.size} release unit(s)).\n`,
  );
  for (const [unit, occ] of drifting) {
    const versions = [...new Set(occ.map((o) => o.version))].sort();
    console.error(
      `  ${unit} is pinned to ${versions.length} versions (${versions.join(", ")}):`,
    );
    for (const o of occ.sort(
      (x, y) => x.file.localeCompare(y.file) || x.line - y.line,
    )) {
      console.error(`    ${o.version.padEnd(8)} ${o.file}:${o.line}`);
    }
    console.error("");
  }
  console.error(
    `Bump every occurrence to the same version in ONE change. ⛔ Note that pins under\n` +
      `.github/actions/*/action.yml get no Dependabot PR (its github-actions ecosystem\n` +
      `scans .github/workflows only), so those are the ones that drift — see #4487.`,
  );
  process.exit(1);
}

console.log(
  `✅ check-action-pin-drift guard OK — ${units.size} release unit(s), ${pinCount} pin(s) ` +
    `across ${files.length} yaml file(s) under .github, one version each.`,
);
