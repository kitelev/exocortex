import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  toRequirementRecord,
  loadRequirements,
  requirementStats,
} from "../lib/requirements.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REQS_DIR = resolve(REPO_ROOT, "packages/exoas-exo-reqs/exo-reqs");

const SAMPLE = `---
exo__Asset_uid: aaaa1111-bbbb-2222-cccc-333344445555
exo__Instance_class:
  - "[[uid|req__Requirement]]"
exo__Asset_label: "req(exo): sample requirement"
req__Requirement_status: "[[uid|req__RequirementStatusApproved]]"
req__Requirement_priority: "[[uid|req__RequirementPriorityP0]]"
req__Requirement_bindingClass:
  - "[[uid|req__RequirementBindingClassIntegration]]"
req__Requirement_verifiedBy:
  - "some.test.ts::scenario"
req__Requirement_covers:
  - "the thing it covers"
---
## Statement (Gherkin)

\`\`\`gherkin
Given x
When y
Then z
\`\`\`
`;

test("toRequirementRecord parses a requirement asset", () => {
  const rec = toRequirementRecord("aaaa1111.md", SAMPLE);
  assert.ok(rec);
  assert.equal(rec.uid, "aaaa1111-bbbb-2222-cccc-333344445555");
  assert.equal(rec.status, "Approved");
  assert.equal(rec.priority, "P0");
  assert.deepEqual(rec.bindingClasses, ["integration"]);
  assert.deepEqual(rec.verifiedBy, ["some.test.ts::scenario"]);
  assert.equal(rec.covered, true);
  assert.match(rec.body, /Given x/);
});

test("toRequirementRecord returns null for a non-requirement asset (no status)", () => {
  const rec = toRequirementRecord(
    "anchor.md",
    `---\nexo__Asset_label: "$exo-reqs"\n---\nanchor`,
  );
  assert.equal(rec, null);
});

test("toRequirementRecord marks uncovered when verifiedBy is empty", () => {
  const rec = toRequirementRecord(
    "x.md",
    `---\nexo__Asset_label: "r"\nreq__Requirement_status: "[[u|req__RequirementStatusDraft]]"\n---\nb`,
  );
  assert.equal(rec.covered, false);
  assert.equal(rec.status, "Draft");
});

// Integration: read the real exoas-exo-reqs submodule fixtures.
const hasSubmodule = existsSync(REQS_DIR);
test(
  "loadRequirements reads the exoas-exo-reqs submodule (27 requirements; the $exo-reqs anchor is excluded)",
  { skip: hasSubmodule ? false : "submodule not checked out" },
  async () => {
    const reqs = await loadRequirements(REQS_DIR);
    // 28 .md files = 27 req__Requirement instances + 1 assetspace anchor
    // ($exo-reqs, which carries no req__Requirement_status and is correctly excluded).
    assert.equal(reqs.length, 27, "expected 27 functional requirements (anchor excluded)");
    assert.ok(
      reqs.every((r) => r.status !== null),
      "every requirement must carry a parseable status",
    );
    assert.ok(
      reqs.every((r) => r.uid && r.label),
      "every requirement must have uid + label",
    );
    // P0 requirements must sort first (priority sort).
    const firstP = reqs[0].priority;
    assert.ok(firstP === "P0" || firstP === null || firstP === "P1");
  },
);

test(
  "requirementStats aggregates coverage + status over the real fixtures",
  { skip: hasSubmodule ? false : "submodule not checked out" },
  async () => {
    const reqs = await loadRequirements(REQS_DIR);
    const stats = requirementStats(reqs);
    assert.equal(stats.total, 27);
    assert.ok(stats.coverage >= 0 && stats.coverage <= 1);
    assert.equal(
      Object.values(stats.byStatus).reduce((a, b) => a + b, 0),
      27,
    );
  },
);
