#!/usr/bin/env node
// Aggregate cold-start telemetry JSONL files (one per CI shard, possibly across
// multiple CI runs) into a single distribution summary for RFC 32a64ed9 §3.1
// (Phase 3.1, T1.2 — "Run 50× cold start; collect distribution").
//
// Usage:
//   node aggregate-cold-start-distribution.mjs <input-dir> <output-prefix>
//
// <input-dir>      — directory containing one or more *.jsonl files
// <output-prefix>  — without extension; writes <prefix>.json + <prefix>.md
//
// JSONL record schema (one record per step) is documented in
// docs/cold-start-telemetry-schema.md.
import * as fs from "node:fs";
import * as path from "node:path";

const STEPS = [
  "docker_pull",
  "container_start",
  "xvfb_ready",
  "obsidian_spawn",
  "plugin_load",
  "vault_index",
  "first_interaction",
];

function percentile(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function readJsonl(file) {
  const out = [];
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return out;
}

function main() {
  const [, , inputDir, outputPrefix] = process.argv;
  if (!inputDir || !outputPrefix) {
    console.error("Usage: aggregate-cold-start-distribution.mjs <input-dir> <output-prefix>");
    process.exit(1);
  }

  const files = fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".jsonl"))
    .map((d) => path.join(inputDir, d.name));

  const buckets = Object.fromEntries(STEPS.map((s) => [s, []]));
  const perFile = [];
  for (const f of files) {
    const records = readJsonl(f);
    perFile.push({ file: path.basename(f), records: records.length });
    for (const r of records) {
      if (!STEPS.includes(r.step)) continue;
      if (typeof r.ms !== "number" || !Number.isFinite(r.ms)) continue;
      buckets[r.step].push(r.ms);
    }
  }

  const stats = {};
  for (const step of STEPS) {
    const samples = buckets[step];
    if (samples.length === 0) {
      stats[step] = { count: 0, p50: null, p95: null, p99: null, p99_p50_ratio: null };
      continue;
    }
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);
    stats[step] = {
      count: samples.length,
      min: Math.min(...samples),
      max: Math.max(...samples),
      p50: Math.round(p50),
      p95: Math.round(p95),
      p99: Math.round(p99),
      p99_p50_ratio: p50 > 0 ? +(p99 / p50).toFixed(2) : null,
    };
  }

  const result = {
    generated_at: new Date().toISOString(),
    rfc: "32a64ed9-9a74-4e0c-bb26-e455605aa384",
    phase: "3.1",
    task: "T1.2",
    inputs: perFile,
    total_records: perFile.reduce((a, b) => a + b.records, 0),
    stats,
  };

  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(`${outputPrefix}.json`, JSON.stringify(result, null, 2));

  const lines = [];
  lines.push("# T1.2 — Cold-Start Distribution (RFC 32a64ed9 §3.1)");
  lines.push("");
  lines.push(`- **Generated:** ${result.generated_at}`);
  lines.push(`- **Total records:** ${result.total_records}`);
  lines.push(`- **Inputs (${perFile.length} files):**`);
  for (const f of perFile) lines.push(`  - \`${f.file}\` — ${f.records} records`);
  lines.push("");
  lines.push("## Per-step distribution");
  lines.push("");
  lines.push("| Step | N | min ms | P50 ms | P95 ms | P99 ms | max ms | P99/P50 |");
  lines.push("|------|---|-------:|-------:|-------:|-------:|-------:|--------:|");
  for (const step of STEPS) {
    const s = stats[step];
    if (s.count === 0) {
      lines.push(`| \`${step}\` | 0 | n/a | n/a | n/a | n/a | n/a | n/a |`);
    } else {
      lines.push(
        `| \`${step}\` | ${s.count} | ${s.min} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} | ${s.p99_p50_ratio} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push(
    "Per RFC 32a64ed9 §3.1: a high P99/P50 ratio per step is a signal of environmental sensitivity.",
  );
  lines.push(
    "Steps with P99/P50 ≥ 2.0 are candidates for Phase 3.2 (per-spec retry) and Phase 3.5 (X11/Xvfb investigation).",
  );
  lines.push(
    "Steps with low ratio (~1.0–1.3) reflect deterministic execution and need no environmental remediation.",
  );

  fs.writeFileSync(`${outputPrefix}.md`, lines.join("\n") + "\n");
  console.log(`Wrote ${outputPrefix}.json and ${outputPrefix}.md`);
  for (const step of STEPS) {
    const s = stats[step];
    console.log(
      `  ${step}: count=${s.count}` +
        (s.count > 0
          ? ` p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms ratio=${s.p99_p50_ratio}`
          : " (no samples)"),
    );
  }
}

main();
