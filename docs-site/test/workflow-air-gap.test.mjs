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
  "living-docs.yml deploy is gated to push/dispatch — a pull_request never publishes (MVP-4)",
  { skip: hasWorkflow ? false : "workflow not present" },
  () => {
    const yaml = readFileSync(WORKFLOW, "utf-8");
    // The deploy job must be conditioned off pull_request events: PRs build +
    // test only, they never publish.
    assert.match(
      yaml,
      /if:\s*\$\{\{\s*github\.event_name\s*==\s*'push'\s*\|\|\s*github\.event_name\s*==\s*'workflow_dispatch'\s*\}\}/,
      "the deploy job must run only on push-to-main or workflow_dispatch, never on a PR",
    );
  },
);

test(
  "the build is read-only PAT-less; deploy uses repo-scoped deploy-pages (no cross-repo PAT) (MVP-4)",
  { skip: hasWorkflow ? false : "workflow not present" },
  () => {
    const yaml = readFileSync(WORKFLOW, "utf-8");
    // The default + build permissions are read-only — the air-gap build cannot write.
    assert.match(yaml, /permissions:\s*\n\s*contents:\s*read/);
    // `pages: write` must NOT be the top-level default; it is granted only inside
    // the deploy job (repo-scoped, for THIS repo's Pages — not a cross-repo PAT).
    assert.doesNotMatch(yaml, /^permissions:\s*\n\s*pages:\s*write/m);
    // Deploy uses the standard GitHub Pages action (repo-scoped GITHUB_TOKEN).
    assert.match(yaml, /actions\/deploy-pages@/);
  },
);
