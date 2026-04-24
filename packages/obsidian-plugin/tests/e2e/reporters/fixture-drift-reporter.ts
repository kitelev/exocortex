import type {
  FullConfig,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import * as fs from "fs";
import * as path from "path";
import {
  diffSnapshots,
  snapshotVault,
  type VaultDrift,
  type VaultSnapshot,
} from "../utils/vault-hash";

interface DriftEntry {
  spec: string;
  test: string;
  status: TestResult["status"];
  durationMs: number;
  drifted: boolean;
  drift: VaultDrift;
  beforeTakenAt: string;
  afterTakenAt: string;
}

interface DriftReport {
  generatedAt: string;
  vaultPath: string;
  totalTests: number;
  totalDrifted: number;
  entries: DriftEntry[];
}

const DEFAULT_VAULT_REL =
  "packages/obsidian-plugin/tests/e2e/test-vault";

function resolveVaultPath(configRootDir: string): string | null {
  const envOverride = process.env.FIXTURE_DRIFT_VAULT_PATH;
  if (envOverride && fs.existsSync(envOverride)) return envOverride;

  const candidateRoots = [
    configRootDir,
    path.resolve(configRootDir, ".."),
    path.resolve(configRootDir, "..", ".."),
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ];
  for (const root of candidateRoots) {
    const candidate = path.join(root, DEFAULT_VAULT_REL);
    if (fs.existsSync(candidate)) return candidate;
    const direct = path.join(root, "tests/e2e/test-vault");
    if (fs.existsSync(direct)) return direct;
  }
  return null;
}

function resolveOutputPath(configRootDir: string): string {
  const envOverride = process.env.FIXTURE_DRIFT_OUTPUT;
  if (envOverride) return envOverride;
  // test-results/ is Playwright's outputDir and is the volume mount in Docker CI
  // (-v $PWD/test-results-e2e:/app/test-results) so writing here ensures artifact pickup.
  const dir = path.join(configRootDir, "test-results");
  return path.join(dir, "fixture-drift.json");
}

export default class FixtureDriftReporter implements Reporter {
  private vaultPath: string | null = null;
  private rootDir: string = process.cwd();
  private beforeByTestId = new Map<string, VaultSnapshot>();
  private entries: DriftEntry[] = [];
  private disabled = false;

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir || process.cwd();
    this.vaultPath = resolveVaultPath(this.rootDir);
    if (!this.vaultPath) {
      this.disabled = true;
      console.warn(
        "[fixture-drift-reporter] vault path not resolved — reporter disabled",
      );
    }
  }

  onTestBegin(test: TestCase): void {
    if (this.disabled || !this.vaultPath) return;
    try {
      const snapshot = snapshotVault(this.vaultPath);
      this.beforeByTestId.set(test.id, snapshot);
    } catch (err) {
      console.warn(
        `[fixture-drift-reporter] snapshot-before failed for ${test.title}:`,
        err,
      );
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this.disabled || !this.vaultPath) return;
    const before = this.beforeByTestId.get(test.id);
    this.beforeByTestId.delete(test.id);
    if (!before) return;
    try {
      const after = snapshotVault(this.vaultPath);
      const drift = diffSnapshots(before, after);
      this.entries.push({
        spec: path.relative(this.rootDir, test.location.file),
        test: test.title,
        status: result.status,
        durationMs: result.duration,
        drifted: drift.totalChanged > 0,
        drift,
        beforeTakenAt: before.takenAt,
        afterTakenAt: after.takenAt,
      });
    } catch (err) {
      console.warn(
        `[fixture-drift-reporter] snapshot-after failed for ${test.title}:`,
        err,
      );
    }
  }

  onEnd(): void {
    if (this.disabled || !this.vaultPath) return;
    const report: DriftReport = {
      generatedAt: new Date().toISOString(),
      vaultPath: this.vaultPath,
      totalTests: this.entries.length,
      totalDrifted: this.entries.filter((e) => e.drifted).length,
      entries: this.entries,
    };
    const outPath = resolveOutputPath(this.rootDir);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    // Warn-only console summary; does NOT fail the run (Phase 2.2 step 1 = detection only).
    if (report.totalDrifted > 0) {
      console.warn(
        `[fixture-drift-reporter] ${report.totalDrifted}/${report.totalTests} test(s) left fixture in drifted state — see ${path.relative(this.rootDir, outPath)}`,
      );
    } else {
      console.log(
        `[fixture-drift-reporter] 0/${report.totalTests} fixture drift — report: ${path.relative(this.rootDir, outPath)}`,
      );
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
