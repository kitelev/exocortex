#!/usr/bin/env node
/* eslint-disable no-console */
// Merges per-shard coverage-final.json files into a single obsidian-plugin
// coverage report. Used by the sharded test-coverage GHA job (Phase 2 CI speedup).
//
// Usage:
//   node scripts/merge-coverage.js <shard-inputs-dir> <output-coverage-dir>
//
// <shard-inputs-dir> contains subdirectories like `coverage-shard-1/`, each
// holding a `coverage-final.json` produced by `jest --coverage --shard=X/N`.
// <output-coverage-dir> is the final `packages/obsidian-plugin/coverage/`
// path expected by the coverage-reports artifact consumer.
//
// Outputs: lcov.info, coverage-summary.json, coverage-final.json, lcov-report/.

const fs = require("fs");
const path = require("path");
const libCoverage = require("istanbul-lib-coverage");
const libReport = require("istanbul-lib-report");
const reports = require("istanbul-reports");

function walkJsonFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === "coverage-final.json") {
        out.push(full);
      }
    }
  }
  return out;
}

function main() {
  const [, , inputsDirArg, outputDirArg] = process.argv;
  if (!inputsDirArg || !outputDirArg) {
    console.error(
      "Usage: node scripts/merge-coverage.js <inputs-dir> <output-dir>",
    );
    process.exit(2);
  }
  const inputsDir = path.resolve(inputsDirArg);
  const outputDir = path.resolve(outputDirArg);
  const files = walkJsonFiles(inputsDir);
  if (files.length === 0) {
    console.error(`No coverage-final.json files found under ${inputsDir}`);
    process.exit(1);
  }
  console.log(`Merging ${files.length} coverage-final.json file(s):`);
  const map = libCoverage.createCoverageMap({});
  for (const f of files) {
    console.log(`  - ${path.relative(inputsDir, f)}`);
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    map.merge(raw);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "coverage-final.json"),
    JSON.stringify(map.toJSON()),
  );
  const context = libReport.createContext({
    dir: outputDir,
    coverageMap: map,
    defaultSummarizer: "nested",
  });
  for (const reporter of ["lcov", "json-summary", "text-summary"]) {
    reports.create(reporter, {}).execute(context);
  }
  console.log(`Merged coverage written to ${outputDir}`);
}

main();
