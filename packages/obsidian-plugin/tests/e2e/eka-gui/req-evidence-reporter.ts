import type {
  FullConfig,
  FullProject,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import * as fs from "fs";
import * as path from "path";

/**
 * EKA GUI-in-CI **req-evidence** reporter (al-gui-ci-runner — dedup of
 * `eka-gui-e2e` into the ui-acceptance auto-runner).
 *
 * The dedup model (design-doc gui-ci-runner-design-2026-06-22): a `req__Requirement`
 * is bound to an eka-gui scenario by a `@req:<uid>` token in the test title. When
 * the suite runs on native-amd64 CI it auto-produces the evidence for those reqs:
 * this reporter writes a machine-readable manifest mapping each `@req:<uid>` →
 * {scenario, status, spec, duration}, AND the Playwright `screenshot` artifact
 * (DOM snapshot) is captured per scenario. The manifest + screenshots are uploaded
 * as the `eka-gui-req-evidence` CI artifact (retained on success too), so a passing
 * acceptance run leaves a durable, auto-attributed evidence trail — no hand-written
 * committed attestation needed (that path stays for genuinely-manual ui-acceptance).
 *
 * The `requirements audit` checker recognises the `@req` binding itself (a tag in a
 * `tests/e2e/eka-gui/` spec = the AUTOMATED ui-acceptance sub-mode); this reporter
 * produces the corroborating artifact. It NEVER throws / fails the run — evidence
 * production must not gate the suite.
 */

const REQ_UID_RE =
  /@req:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

interface ReqEvidenceEntry {
  /** The requirement uid the scenario verifies (lower-cased). */
  reqUid: string;
  /** The full scenario title (carries the `@req:` token + human description). */
  scenario: string;
  /** Pass/fail/skipped of the GUI acceptance run. */
  status: TestResult["status"];
  durationMs: number;
  /** Spec file (repo-relative) the scenario lives in. */
  spec: string;
}

interface ReqEvidenceManifest {
  generatedAt: string;
  runner: "eka-gui-e2e";
  totalReqScenarios: number;
  passed: number;
  failed: number;
  /** Distinct requirement uids auto-verified by this run. */
  reqUids: string[];
  entries: ReqEvidenceEntry[];
}

/** Extract every `@req:<uid>` token from a scenario title (lower-cased). */
export function extractReqUids(title: string): string[] {
  const uids: string[] = [];
  REQ_UID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REQ_UID_RE.exec(title)) !== null) uids.push(m[1].toLowerCase());
  return uids;
}

/**
 * The subset of `FullConfig` the output-path resolution reads. Declared
 * structurally so a unit test can exercise the resolution without building a
 * whole `FullConfig`; a real `FullConfig` satisfies it.
 */
export type ReqEvidenceOutputConfig = Pick<FullConfig, "rootDir"> & {
  configFile?: string;
  projects: readonly Pick<FullProject, "outputDir">[];
};

export function resolveOutputPath(config: ReqEvidenceOutputConfig): string {
  const envOverride = process.env.EKA_GUI_REQ_EVIDENCE_OUTPUT;
  if (envOverride) return envOverride;
  // ⛔ NOT `config.rootDir`: Playwright sets it to the resolved `testDir`
  // (`rootDir: pathResolve(configDir, userConfig.testDir) || configDir`), i.e.
  // `./tests/e2e/eka-gui` here — so writing there put the manifest at
  // packages/obsidian-plugin/tests/e2e/eka-gui/test-results-eka-gui/ — outside
  // the Docker volume mount AND outside the `upload-artifact` path, i.e. it
  // never reached the eka-gui-req-evidence artifact.
  //
  // `outputDir: "test-results-eka-gui"` (playwright-eka-gui.config.ts) is
  // resolved by Playwright against the CONFIG directory and surfaced already
  // absolute on each project. That resolved directory IS the mount
  // (-v $PWD/eka-gui-results:/app/packages/obsidian-plugin/test-results-eka-gui)
  // and the uploaded path, so writing there is what puts the manifest in the
  // CI artifact.
  //
  // `projects[0]` is unambiguous here, and that is a property of the config, not
  // a guess: playwright-eka-gui.config.ts declares NO `projects` array, and
  // Playwright then synthesises exactly one project from the top level
  // (`projectConfigs = cliOverrides.projects || userConfig.projects || [{...userConfig}]`
  // in playwright/lib/common/config.js, v1.56). If this suite ever grows a real
  // `projects` array with differing outputDirs, revisit — the first project's
  // directory would then be pinned for every scenario.
  const projectOutputDir = config.projects[0]?.outputDir;
  if (projectOutputDir) return path.join(projectOutputDir, "req-evidence.json");
  // Defensive fallback (a loaded config always has ≥1 project): the config
  // directory, which is what `outputDir` would have been resolved against.
  const base = config.configFile
    ? path.dirname(config.configFile)
    : config.rootDir;
  return path.join(base, "test-results-eka-gui", "req-evidence.json");
}

export default class ReqEvidenceReporter implements Reporter {
  private rootDir: string = process.cwd();
  private outPath: string = path.join(process.cwd(), "req-evidence.json");
  private entries: ReqEvidenceEntry[] = [];

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir || process.cwd();
    this.outPath = resolveOutputPath(config);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    try {
      const uids = extractReqUids(test.title);
      for (const reqUid of uids) {
        this.entries.push({
          reqUid,
          scenario: test.title,
          status: result.status,
          durationMs: result.duration,
          spec: path.relative(this.rootDir, test.location.file),
        });
      }
    } catch {
      // never let evidence collection break the suite
    }
  }

  onEnd(): void {
    try {
      const manifest: ReqEvidenceManifest = {
        generatedAt: new Date().toISOString(),
        runner: "eka-gui-e2e",
        totalReqScenarios: this.entries.length,
        passed: this.entries.filter((e) => e.status === "passed").length,
        failed: this.entries.filter((e) => e.status === "failed").length,
        reqUids: [...new Set(this.entries.map((e) => e.reqUid))].sort(),
        entries: this.entries,
      };
      const outPath = this.outPath;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf-8");
      console.log(
        `[req-evidence-reporter] ${manifest.totalReqScenarios} @req scenario(s) for ` +
          `${manifest.reqUids.length} requirement(s) → ${path.relative(process.cwd(), outPath)}`,
      );
    } catch (err) {
      console.warn("[req-evidence-reporter] manifest write failed:", err);
    }
  }

  printsToStdio(): boolean {
    // onEnd prints a one-line summary to stdout — report that honestly.
    return true;
  }
}
