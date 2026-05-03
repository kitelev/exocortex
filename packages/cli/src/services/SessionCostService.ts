import { readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface FindSessionResult {
  sessionFile: string | null;
  warning: string | null;
}

const CLAUDE_PROJECTS_DIR = path.join(homedir(), ".claude", "projects");
const COST_WARNING_THRESHOLD_USD = 1.0;

// Claude Sonnet 4.x pricing per 1M tokens
const PRICE_INPUT_PER_M = 15.0;
const PRICE_OUTPUT_PER_M = 75.0;
const PRICE_CACHE_READ_PER_M = 1.5;

export function computeCostFromUsage(usage: UsageSummary): number {
  return (
    (usage.inputTokens * PRICE_INPUT_PER_M) / 1e6 +
    (usage.outputTokens * PRICE_OUTPUT_PER_M) / 1e6 +
    (usage.cacheReadTokens * PRICE_CACHE_READ_PER_M) / 1e6
  );
}

function parseUsageFromJsonl(
  filePath: string,
  taskUuid: string,
): UsageSummary | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  // Check if this session references our task UUID
  if (!content.includes(taskUuid)) {
    return null;
  }

  const summary: UsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  };

  let hasUsage = false;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (entry["type"] !== "assistant") continue;
    const msg = entry["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const usage = msg["usage"] as Record<string, unknown> | undefined;
    if (!usage) continue;

    summary.inputTokens += Number(usage["input_tokens"] ?? 0);
    summary.outputTokens += Number(usage["output_tokens"] ?? 0);
    summary.cacheReadTokens += Number(usage["cache_read_input_tokens"] ?? 0);
    hasUsage = true;
  }

  if (!hasUsage) return null;
  summary.costUsd = computeCostFromUsage(summary);
  return summary;
}

/**
 * Finds the session.jsonl file for a given task UUID.
 * Scans ~/.claude/projects/ for files modified after spawnTimestamp.
 * Prefers files containing the task UUID.
 */
export function findSessionFile(
  taskUuid: string,
  spawnTimestamp: number,
  claudeProjectsDir: string = CLAUDE_PROJECTS_DIR,
): FindSessionResult {
  let candidates: Array<{ file: string; mtime: number }> = [];

  try {
    const projectDirs = readdirSync(claudeProjectsDir);
    for (const projectDir of projectDirs) {
      const projectPath = path.join(claudeProjectsDir, projectDir);
      let files: string[];
      try {
        files = readdirSync(projectPath);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(projectPath, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs >= spawnTimestamp) {
            candidates.push({ file: filePath, mtime: stat.mtimeMs });
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    return { sessionFile: null, warning: "cannot scan claude projects dir" };
  }

  if (candidates.length === 0) {
    return {
      sessionFile: null,
      warning: `no session.jsonl found after spawn time for task ${taskUuid}`,
    };
  }

  // Sort newest first
  candidates.sort((a, b) => b.mtime - a.mtime);

  // Prefer the file containing the task UUID
  for (const { file } of candidates) {
    try {
      const content = readFileSync(file, "utf8");
      if (content.includes(taskUuid)) {
        return { sessionFile: file, warning: null };
      }
    } catch {
      continue;
    }
  }

  // Fallback: newest file
  return { sessionFile: candidates[0].file, warning: null };
}

export interface SessionCostResult {
  costUsd: number;
  warning: string | null;
}

/**
 * Reads session.jsonl for the given task, computes cost in USD.
 * Returns { costUsd: 0, warning } on any parse error (defensive).
 */
export function computeSessionCost(
  taskUuid: string,
  spawnTimestamp: number,
  logFn: (msg: string) => void = console.error,
  claudeProjectsDir: string = CLAUDE_PROJECTS_DIR,
): SessionCostResult {
  const { sessionFile, warning: findWarning } = findSessionFile(
    taskUuid,
    spawnTimestamp,
    claudeProjectsDir,
  );

  if (!sessionFile) {
    const msg = `[ai-task] cost tracking: ${findWarning ?? "session file not found"} (task=${taskUuid})`;
    logFn(msg);
    return { costUsd: 0, warning: msg };
  }

  const usage = parseUsageFromJsonl(sessionFile, taskUuid);
  if (!usage) {
    const msg = `[ai-task] cost tracking: failed to parse usage from ${sessionFile} (task=${taskUuid}), cost=0`;
    logFn(msg);
    return { costUsd: 0, warning: msg };
  }

  if (usage.costUsd > COST_WARNING_THRESHOLD_USD) {
    logFn(
      `[ai-task] WARNING: task ${taskUuid} cost $${usage.costUsd.toFixed(4)} exceeds threshold $${COST_WARNING_THRESHOLD_USD.toFixed(2)}`,
    );
  }

  return { costUsd: usage.costUsd, warning: null };
}
