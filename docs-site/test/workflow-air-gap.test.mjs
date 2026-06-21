import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * RFC 0004 §5 — the PAT-less air-gap, proved as a unit test. This mirrors the
 * archgate rule SEC-001 (the required-gate enforcement) so the invariant is also
 * checked inside the docs-site test suite (which the living-docs workflow runs).
 *
 * The guarantee: the build workflow injects no credential granting access to any
 * private repo — therefore the private graph is absent and cannot be leaked.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW = resolve(REPO_ROOT, ".github/workflows/living-docs.yml");

const hasWorkflow = existsSync(WORKFLOW);

test(
  "living-docs.yml references no secret beyond the default GITHUB_TOKEN (PAT-less)",
  { skip: hasWorkflow ? false : "workflow not present" },
  () => {
    const yaml = readFileSync(WORKFLOW, "utf-8");
    const offenders = [];
    const re = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(yaml)) !== null) {
      if (m[1] !== "GITHUB_TOKEN") offenders.push(m[1]);
    }
    assert.deepEqual(
      offenders,
      [],
      `living-docs.yml must inject no secret beyond GITHUB_TOKEN; found: ${offenders.join(", ")}`,
    );
  },
);

test(
  "living-docs.yml does not override the checkout credential (token:/ssh-key:)",
  { skip: hasWorkflow ? false : "workflow not present" },
  () => {
    const yaml = readFileSync(WORKFLOW, "utf-8");
    const overrides = yaml
      .split("\n")
      .filter((l) => /^\s*(token|ssh-key)\s*:/.test(l));
    assert.deepEqual(
      overrides,
      [],
      `checkout must use only the default GITHUB_TOKEN; found override(s): ${overrides.join(" | ")}`,
    );
  },
);

test(
  "living-docs.yml has no Pages deploy step (MVP-3 is build-only, no publish)",
  { skip: hasWorkflow ? false : "workflow not present" },
  () => {
    const yaml = readFileSync(WORKFLOW, "utf-8");
    assert.doesNotMatch(
      yaml,
      /actions\/deploy-pages|deploy-pages@|actions\/upload-pages-artifact/,
      "MVP-3 must not deploy to GitHub Pages — that is MVP-4 (explicit human confirm).",
    );
  },
);

test(
  "living-docs.yml grants only read permissions (no write/pages — no deploy)",
  { skip: hasWorkflow ? false : "workflow not present" },
  () => {
    const yaml = readFileSync(WORKFLOW, "utf-8");
    assert.match(yaml, /permissions:\s*\n\s*contents:\s*read/);
    assert.doesNotMatch(yaml, /pages:\s*write/);
    assert.doesNotMatch(yaml, /id-token:\s*write/);
  },
);
