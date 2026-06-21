import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { toAdrRecord, loadAdrs } from "../lib/adrs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ADRS_DIR = resolve(REPO_ROOT, ".archgate/adrs");

test("toAdrRecord parses ADR frontmatter + body", () => {
  const rec = toAdrRecord(
    "ARCH-008-clean-architecture.md",
    `---\nid: ARCH-008\ntitle: Clean Architecture\ndomain: architecture\nrules: true\n---\n# Clean Architecture\n\n## Context\n\ntext\n`,
  );
  assert.equal(rec.id, "ARCH-008");
  assert.equal(rec.title, "Clean Architecture");
  assert.equal(rec.domain, "architecture");
  assert.equal(rec.rules, true);
  assert.match(rec.body, /## Context/);
});

test("toAdrRecord falls back to filename stem when frontmatter missing fields", () => {
  const rec = toAdrRecord("FOO-001-thing.md", `body only`);
  assert.equal(rec.id, "FOO-001-thing");
  assert.equal(rec.title, "FOO-001-thing");
  assert.equal(rec.rules, false);
});

const hasAdrs = existsSync(ADRS_DIR);
test(
  "loadAdrs reads .archgate/adrs (.md only, not .rules.ts)",
  { skip: hasAdrs ? false : ".archgate/adrs not present" },
  async () => {
    const adrs = await loadAdrs(ADRS_DIR);
    assert.ok(adrs.length >= 15, `expected >=15 ADRs, got ${adrs.length}`);
    assert.ok(
      adrs.every((a) => a.id && a.title),
      "every ADR must have id + title",
    );
    // Sorted by id, numeric-aware.
    const ids = adrs.map((a) => a.id);
    assert.deepEqual(ids, [...ids].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })));
    // The known machine-enforced ADR carries rules:true.
    const clean = adrs.find((a) => a.id === "ARCH-008");
    if (clean) assert.equal(clean.rules, true);
  },
);
