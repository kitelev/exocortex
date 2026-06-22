import type {
  FullConfig,
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

function resolveOutputPath(rootDir: string): string {
  const envOverride = process.env.EKA_GUI_REQ_EVIDENCE_OUTPUT;
  if (envOverride) return envOverride;
  // `outputDir: "test-results-eka-gui"` (playwright-eka-gui.config.ts) is the
  // Docker volume mount (-v $PWD/eka-gui-results:/app/.../test-results-eka-gui),
  // so writing here ensures the manifest is picked up as a CI artifact.
  return path.join(rootDir, "test-results-eka-gui", "req-evidence.json");
}

export default class ReqEvidenceReporter implements Reporter {
  private rootDir: string = process.cwd();
  private entries: ReqEvidenceEntry[] = [];

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir || process.cwd();
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
      const outPath = resolveOutputPath(this.rootDir);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf-8");
      console.log(
        `[req-evidence-reporter] ${manifest.totalReqScenarios} @req scenario(s) for ` +
          `${manifest.reqUids.length} requirement(s) → ${path.relative(this.rootDir, outPath)}`,
      );
    } catch (err) {
      console.warn("[req-evidence-reporter] manifest write failed:", err);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
