#!/usr/bin/env node
// D1 shard drift guard (CI Path 2, task e0f6e6fd).
// Asserts that the 6 playwright.shard-N.config.ts files, via
// playwright-shard-assignments.json, cover every *.spec.ts on disk
// exactly once — no missing, no extra, no duplicates. Exits 1 on drift.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const PLUGIN_DIR = path.join(repoRoot, "packages", "obsidian-plugin");
const ASSIGNMENTS_PATH = path.join(PLUGIN_DIR, "playwright-shard-assignments.json");
const SPECS_DIR = path.join(PLUGIN_DIR, "tests", "e2e", "specs");
const SHARD_COUNT = 6;

function fail(msg) {
  console.error(`[shard-drift] ❌ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(ASSIGNMENTS_PATH)) {
  fail(`Missing assignments file: ${ASSIGNMENTS_PATH}`);
}
if (!fs.existsSync(SPECS_DIR)) {
  fail(`Missing specs dir: ${SPECS_DIR}`);
}

const data = JSON.parse(fs.readFileSync(ASSIGNMENTS_PATH, "utf8"));
if (!data || !Array.isArray(data.shards)) {
  fail(`${ASSIGNMENTS_PATH} must export { shards: string[][] }`);
}
const shards = data.shards;
if (shards.length !== SHARD_COUNT) {
  fail(`Expected ${SHARD_COUNT} shards, got ${shards.length}`);
}
for (let i = 0; i < SHARD_COUNT; i++) {
  const cfg = path.join(PLUGIN_DIR, `playwright.shard-${i + 1}.config.ts`);
  if (!fs.existsSync(cfg)) {
    fail(`Missing shard config: ${cfg}`);
  }
  if (!Array.isArray(shards[i])) {
    fail(`shards[${i}] is not an array`);
  }
  if (shards[i].length === 0) {
    fail(`shards[${i}] is empty — each shard must have ≥1 spec`);
  }
}

const assignments = shards.flat();
const assignmentsSet = new Set(assignments);
if (assignmentsSet.size !== assignments.length) {
  const counts = new Map();
  for (const a of assignments) counts.set(a, (counts.get(a) ?? 0) + 1);
  const dupes = [...counts].filter(([, c]) => c > 1).map(([f]) => f);
  fail(`Duplicate spec assignments across shards: ${dupes.join(", ")}`);
}

const filesOnDisk = fs
  .readdirSync(SPECS_DIR)
  .filter((f) => f.endsWith(".spec.ts"))
  .sort();
const onDiskSet = new Set(filesOnDisk);

const missing = filesOnDisk.filter((f) => !assignmentsSet.has(f));
if (missing.length > 0) {
  fail(
    `Spec files on disk NOT assigned to any shard (add to playwright-shard-assignments.json):\n  ${missing.join("\n  ")}`,
  );
}

const extra = assignments.filter((a) => !onDiskSet.has(a));
if (extra.length > 0) {
  fail(
    `Shard assignments reference files that don't exist on disk:\n  ${extra.join("\n  ")}`,
  );
}

console.log(
  `[shard-drift] ✅ ${filesOnDisk.length} *.spec.ts files balanced across ${SHARD_COUNT} shards, no drift.`,
);
for (let i = 0; i < shards.length; i++) {
  console.log(`  shard ${i + 1} (${shards[i].length}): ${shards[i].join(", ")}`);
}
