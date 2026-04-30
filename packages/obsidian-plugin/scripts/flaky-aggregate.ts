#!/usr/bin/env tsx
/**
 * flaky-aggregate.ts — RFC Phase 3.4 / T4.1
 *
 * Aggregates flaky-reporter.json artifacts across the last N main-branch CI
 * runs and emits a single structured JSON consumable by the upcoming
 * FLAKY_DASHBOARD renderer (Phase 3.4 §Output).
 *
 * Two execution modes:
 *  - online (default): uses `gh` CLI to list runs and download artifacts
 *  - offline (--input): reads already-downloaded artifact tree
 *
 * Run from monorepo root:
 *   npx tsx packages/obsidian-plugin/scripts/flaky-aggregate.ts --limit 30
 *   npx tsx packages/obsidian-plugin/scripts/flaky-aggregate.ts --input ./artifacts --dry-run
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ARTIFACT_GLOB = "flaky*";
const FLAKY_FILE_PATTERN = /flaky-report.*\.json$/i;

export interface FlakyTestEntry {
  file: string;
  title: string;
  retryCount: number;
  duration: number;
  source: string;
  shard?: string;
  project?: string;
}

export interface RawFlakyReport {
  timestamp?: string;
  totalFlaky?: number;
  tests?: Array<Record<string, unknown>>;
  summary?: {
    totalTests?: number;
    totalSuites?: number;
    flakyPercentage?: number;
  };
}

export interface RunMeta {
  runId: number;
  createdAt: string;
  conclusion: string;
  headSha: string;
}

export interface AggregateInput {
  runs: Array<{
    meta: RunMeta;
    reports: Array<{ source: string; report: RawFlakyReport }>;
  }>;
}

export interface AggregateOutput {
  generatedAt: string;
  schemaVersion: 1;
  rollingWindow: {
    requestedSize: number;
    actualSize: number;
    runIds: number[];
  };
  summary: {
    totalRuns: number;
    runsWithFlaky: number;
    totalFlakyOccurrences: number;
    averageFlakyPerRun: number;
    rerunRatePercent: number;
  };
  perSpec: Array<{
    file: string;
    title: string;
    occurrences: number;
    rerunRate: number;
    sources: string[];
  }>;
  perShard: Record<string, { runs: number; flaky: number }>;
  perRun: Array<{
    runId: number;
    createdAt: string;
    conclusion: string;
    headSha: string;
    totalFlaky: number;
    sources: string[];
  }>;
}

export interface CliOptions {
  repo: string;
  workflow: string;
  branch: string;
  limit: number;
  output: string;
  input?: string;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    repo: "kitelev/exocortex",
    workflow: "ci.yml",
    branch: "main",
    limit: 30,
    output: "packages/obsidian-plugin/docs/FLAKY_DASHBOARD.json",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--repo":
        opts.repo = next();
        break;
      case "--workflow":
        opts.workflow = next();
        break;
      case "--branch":
        opts.branch = next();
        break;
      case "--limit":
        opts.limit = Number(next());
        break;
      case "--output":
      case "-o":
        opts.output = next();
        break;
      case "--input":
      case "-i":
        opts.input = next();
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown flag: ${arg}`);
        }
    }
  }
  if (!Number.isFinite(opts.limit) || opts.limit <= 0) {
    throw new Error(`--limit must be a positive integer, got: ${opts.limit}`);
  }
  return opts;
}

function printUsage(): void {
  console.log(`Usage: flaky-aggregate.ts [options]

Options:
  --repo <slug>        owner/repo (default: kitelev/exocortex)
  --workflow <file>    workflow filename (default: ci.yml)
  --branch <name>      branch to scan (default: main)
  --limit <N>          rolling window size (default: 30)
  --output, -o <path>  output JSON path
  --input, -i <dir>    offline mode: read artifacts from directory
  --dry-run            skip downloads, print plan
  --help, -h           show this help
`);
}

function gh(args: string[]): string {
  const proc = spawnSync("gh", args, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(
      `gh ${args.join(" ")} failed (exit ${proc.status}): ${proc.stderr}`,
    );
  }
  return proc.stdout;
}

export function listRuns(
  repo: string,
  workflow: string,
  branch: string,
  limit: number,
): RunMeta[] {
  const json = gh([
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    workflow,
    "--branch",
    branch,
    "--limit",
    String(limit),
    "--json",
    "databaseId,createdAt,conclusion,headSha,status",
  ]);
  const raw = JSON.parse(json) as Array<{
    databaseId: number;
    createdAt: string;
    conclusion: string | null;
    headSha: string;
    status: string;
  }>;
  return raw
    .filter((r) => r.status === "completed")
    .map((r) => ({
      runId: r.databaseId,
      createdAt: r.createdAt,
      conclusion: r.conclusion ?? "unknown",
      headSha: r.headSha,
    }));
}

export function downloadFlakyArtifacts(
  repo: string,
  runId: number,
  destDir: string,
): void {
  fs.mkdirSync(destDir, { recursive: true });
  // -p restricts artifacts by name pattern; some runs have none — exit 1 OK.
  const proc = spawnSync(
    "gh",
    [
      "run",
      "download",
      String(runId),
      "--repo",
      repo,
      "-p",
      ARTIFACT_GLOB,
      "-D",
      destDir,
    ],
    { encoding: "utf-8" },
  );
  // gh exits non-zero when nothing matches — treat as zero-flaky run.
  if (proc.status !== 0 && !/no artifacts/i.test(proc.stderr ?? "")) {
    // Don't throw — best-effort; warn so caller can debug.
    console.warn(
      `[warn] gh run download ${runId} returned ${proc.status}: ${proc.stderr?.trim()}`,
    );
  }
}

export function readReportsFromDir(
  rootDir: string,
): Array<{ source: string; report: RawFlakyReport }> {
  if (!fs.existsSync(rootDir)) return [];
  const out: Array<{ source: string; report: RawFlakyReport }> = [];
  for (const entry of walk(rootDir)) {
    if (!FLAKY_FILE_PATTERN.test(path.basename(entry))) continue;
    try {
      const text = fs.readFileSync(entry, "utf-8");
      const report = JSON.parse(text) as RawFlakyReport;
      const source = path
        .relative(rootDir, entry)
        .replace(/\\/g, "/")
        .replace(/\.json$/i, "");
      out.push({ source, report });
    } catch (err) {
      console.warn(`[warn] skipping unreadable report ${entry}: ${err}`);
    }
  }
  return out;
}

function* walk(dir: string): Generator<string> {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile()) yield full;
  }
}

export function normalizeTest(
  raw: Record<string, unknown>,
  source: string,
): FlakyTestEntry {
  const file = String(raw.file ?? "");
  const title = String(raw.title ?? raw.name ?? "");
  const retryCount = Number(raw.retryCount ?? 0);
  const duration = Number(raw.duration ?? 0);
  const project = typeof raw.project === "string" ? raw.project : undefined;
  const shard = extractShardFromSource(source);
  return {
    file,
    title,
    retryCount: Number.isFinite(retryCount) ? retryCount : 0,
    duration: Number.isFinite(duration) ? duration : 0,
    source,
    shard,
    project,
  };
}

function extractShardFromSource(source: string): string | undefined {
  const m = source.match(/shard[-_]?(\d+)/i);
  return m ? `shard-${m[1]}` : undefined;
}

export function aggregate(input: AggregateInput, requestedSize: number): AggregateOutput {
  const perSpecMap = new Map<
    string,
    { file: string; title: string; occurrences: number; sources: Set<string> }
  >();
  const perShard = new Map<string, { runs: number; flaky: number }>();
  const perRun: AggregateOutput["perRun"] = [];
  let runsWithFlaky = 0;
  let totalFlakyOccurrences = 0;

  for (const run of input.runs) {
    const sources = new Set<string>();
    let runFlaky = 0;
    const shardsTouched = new Set<string>();

    for (const { source, report } of run.reports) {
      sources.add(source);
      const tests = (report.tests ?? []).map((t) => normalizeTest(t, source));
      const shard = extractShardFromSource(source);
      if (shard) shardsTouched.add(shard);
      for (const t of tests) {
        const key = `${t.file}::${t.title}`;
        const existing = perSpecMap.get(key);
        if (existing) {
          existing.occurrences++;
          existing.sources.add(t.source);
        } else {
          perSpecMap.set(key, {
            file: t.file,
            title: t.title,
            occurrences: 1,
            sources: new Set([t.source]),
          });
        }
      }
      runFlaky += tests.length;
    }

    for (const shard of shardsTouched) {
      const entry = perShard.get(shard) ?? { runs: 0, flaky: 0 };
      entry.runs++;
      perShard.set(shard, entry);
    }
    // Record flaky counts per shard touched in this run
    for (const { source, report } of run.reports) {
      const shard = extractShardFromSource(source);
      if (!shard) continue;
      const entry = perShard.get(shard) ?? { runs: 0, flaky: 0 };
      entry.flaky += (report.tests ?? []).length;
      perShard.set(shard, entry);
    }

    if (runFlaky > 0) runsWithFlaky++;
    totalFlakyOccurrences += runFlaky;
    perRun.push({
      runId: run.meta.runId,
      createdAt: run.meta.createdAt,
      conclusion: run.meta.conclusion,
      headSha: run.meta.headSha,
      totalFlaky: runFlaky,
      sources: Array.from(sources).sort(),
    });
  }

  const totalRuns = input.runs.length;
  const perSpec = Array.from(perSpecMap.values())
    .map((s) => ({
      file: s.file,
      title: s.title,
      occurrences: s.occurrences,
      rerunRate:
        totalRuns > 0 ? Number(((s.occurrences / totalRuns) * 100).toFixed(2)) : 0,
      sources: Array.from(s.sources).sort(),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.file.localeCompare(b.file));

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    rollingWindow: {
      requestedSize,
      actualSize: totalRuns,
      runIds: input.runs.map((r) => r.meta.runId),
    },
    summary: {
      totalRuns,
      runsWithFlaky,
      totalFlakyOccurrences,
      averageFlakyPerRun:
        totalRuns > 0
          ? Number((totalFlakyOccurrences / totalRuns).toFixed(2))
          : 0,
      rerunRatePercent:
        totalRuns > 0
          ? Number(((runsWithFlaky / totalRuns) * 100).toFixed(2))
          : 0,
    },
    perSpec,
    perShard: Object.fromEntries(
      Array.from(perShard.entries()).sort(([a], [b]) => a.localeCompare(b)),
    ),
    perRun: perRun.sort((a, b) => b.runId - a.runId),
  };
}

function collectRuns(opts: CliOptions): AggregateInput {
  if (opts.input) {
    return collectFromInputDir(opts.input);
  }
  return collectFromGitHub(opts);
}

function collectFromInputDir(rootDir: string): AggregateInput {
  // Layout: <rootDir>/<runId>/<artifact-dir>/*.json
  // Or:     <rootDir>/<artifact-dir>/*.json (single run)
  const entries = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  const numericChildren = entries.filter((e) => /^\d+$/.test(e.name));
  if (numericChildren.length > 0) {
    return {
      runs: numericChildren.map((e) => {
        const dir = path.join(rootDir, e.name);
        const stat = fs.statSync(dir);
        return {
          meta: {
            runId: Number(e.name),
            createdAt: stat.mtime.toISOString(),
            conclusion: "unknown",
            headSha: "",
          },
          reports: readReportsFromDir(dir),
        };
      }),
    };
  }
  // Treat entire rootDir as one synthetic run
  const stat = fs.statSync(rootDir);
  return {
    runs: [
      {
        meta: {
          runId: 0,
          createdAt: stat.mtime.toISOString(),
          conclusion: "unknown",
          headSha: "",
        },
        reports: readReportsFromDir(rootDir),
      },
    ],
  };
}

function collectFromGitHub(opts: CliOptions): AggregateInput {
  const runs = listRuns(opts.repo, opts.workflow, opts.branch, opts.limit);
  if (opts.dryRun) {
    console.log(
      `[dry-run] would download flaky artifacts for ${runs.length} runs`,
    );
    return { runs: runs.map((meta) => ({ meta, reports: [] })) };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flaky-agg-"));
  try {
    return {
      runs: runs.map((meta) => {
        const runDir = path.join(tmp, String(meta.runId));
        downloadFlakyArtifacts(opts.repo, meta.runId, runDir);
        return { meta, reports: readReportsFromDir(runDir) };
      }),
    };
  } finally {
    // Best-effort cleanup; skip on dry-run
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function runCli(argv: string[]): void {
  const opts = parseArgs(argv);
  const input = collectRuns(opts);
  const output = aggregate(input, opts.limit);
  const outPath = path.resolve(opts.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
  const { totalRuns, runsWithFlaky, rerunRatePercent } = output.summary;
  console.log(
    `flaky-aggregate: wrote ${outPath} (${totalRuns} runs, ${runsWithFlaky} with flaky, rerunRate=${rerunRatePercent}%)`,
  );
}

function isInvokedAsScript(): boolean {
  const entry = process.argv[1] ?? "";
  return /flaky-aggregate\.[mc]?[tj]s$/.test(entry);
}

if (isInvokedAsScript()) {
  try {
    runCli(process.argv.slice(2));
  } catch (err) {
    console.error(`flaky-aggregate failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
