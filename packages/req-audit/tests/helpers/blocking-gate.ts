import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";

/**
 * Drivers for the REAL blocking "Active-requirement gate" step of
 * `.github/workflows/ci.yml`.
 *
 * Shared by every suite that binds the gate's behaviour (the `99e06488`
 * population floor and the `bba7bd2b` per-assetspace corpus floor). Extracting
 * (rather than duplicating) is what makes these tests exercise the SHIPPED
 * gate: a hand-kept copy would stay green after the step is edited or deleted.
 */

/** Walk up from cwd until the repo root (the one carrying the CI workflow). */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".github", "workflows", "ci.yml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not locate .github/workflows/ci.yml walking up from ${process.cwd()}`,
  );
}

/** The shipped `ci.yml`, read from the repo root. */
export function readWorkflow(): string {
  return readFileSync(
    resolve(repoRoot(), ".github", "workflows", "ci.yml"),
    "utf-8",
  );
}

/**
 * Extract the `node -e '<js>'` body of the BLOCKING "Active-requirement gate"
 * step out of the workflow.
 */
export function extractGateScript(): string {
  const yaml = readWorkflow();
  const step =
    /- name: Active-requirement gate[\s\S]*?\n(\s+)run: \|\n([\s\S]*?)(?=\n\s+- name: )/.exec(
      yaml,
    );
  if (step === null) {
    throw new Error(
      "the blocking 'Active-requirement gate' step is gone from ci.yml",
    );
  }
  const pad = step[1].length + 2;
  const body = step[2]
    .split("\n")
    .map((line) => (line.length >= pad ? line.slice(pad) : line))
    .join("\n");
  const js = /node -e '([\s\S]*)'\s*$/.exec(body.trim());
  if (js === null) {
    throw new Error("the gate step is no longer a `node -e '...'` invocation");
  }
  return js[1];
}

/**
 * Run the REAL blocking gate over a report; returns its exit code + output.
 *
 * Driven through `bash -e -c "node -e '<js>'"` — the SAME surface the workflow
 * uses (`run: |` executes under `bash -e`, and the payload is single-quoted).
 * Handing the payload to `execFile("node", ["-e", js])` instead would pass it as
 * an argv element, i.e. through a DIFFERENT interpretation layer than production:
 * a lone apostrophe added to any message would terminate the shell string and
 * break CI while an argv-based test stayed green.
 */
export function runBlockingGate(report: unknown): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const runnerTemp = join(tmpdir(), `req-gate-${Date.now()}-${Math.random()}`);
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(
    join(runnerTemp, "req-report.json"),
    JSON.stringify(report),
    "utf-8",
  );
  try {
    const stdout = execFileSync(
      "bash",
      ["-e", "-c", `node -e '${extractGateScript()}'`],
      {
        env: { ...process.env, RUNNER_TEMP: runnerTemp },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? -1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
}
