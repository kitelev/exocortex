import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * check-test-antipatterns.sh — POPULATION floor (issue #4090).
 *
 * Every counter in that guard is `grep … | wc -l`, so the size of the scanned corpus is
 * a silent multiplier on all four of them. Point the scan at an empty directory and the
 * guard used to print
 *
 *   ✅ test anti-pattern guard OK — method-exists=0/55, vacuous-length=0/21, …
 *   ℹ️  method-exists dropped to 0 (baseline 55) — ratchet BASELINE_METHOD_EXISTS down…
 *
 * and exit 0. Two failures compound there: `0/55` READS AS AN ACHIEVEMENT rather than as
 * "nothing was read", and the guard then invites the operator to ratchet the baselines to
 * zero — after which it is green forever. The disarm arrives through the SUCCESS path, so
 * reading red builds carefully could never have caught it.
 *
 * These axes lock the two floors. Without them the floors can be deleted and nothing goes
 * red — which is the state the guard was in before #4090.
 */
describe("check-test-antipatterns.sh — population floor (#4090)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const scriptPath = path.join(repoRoot, "scripts/check-test-antipatterns.sh");

  let scanDir: string;

  const runGuard = (extraEnv: Record<string, string>) =>
    spawnSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ANTIPATTERN_SCAN_DIR: scanDir,
        ANTIPATTERN_NONCANON_DIR: path.join(scanDir, "__no_such_dir__"),
        BASELINE_METHOD_EXISTS: "999",
        BASELINE_VACUOUS_LENGTH: "999",
        BASELINE_NONCANON_SERVICE_DIR: "999",
        BASELINE_OVERMOCK: "0",
        ...extraEnv,
      },
    });

  beforeEach(() => {
    scanDir = mkdtempSync(path.join(tmpdir(), "antipatterns-pop-"));
  });

  afterEach(() => {
    rmSync(scanDir, { recursive: true, force: true });
  });

  const addTests = (n: number) => {
    for (let i = 0; i < n; i += 1) {
      writeFileSync(path.join(scanDir, `f${i}.test.ts`), "it('x', () => {});\n");
    }
  };

  it("FAILS (exit 1) when the scan reads NO test files, instead of passing with 0/N", () => {
    const r = runGuard({ BASELINE_SCANNED: "901" });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("scanned 0 test files");
  });

  it("refuses to suggest --update-baseline on an empty scan (that would write 0 and disarm it)", () => {
    const r = runGuard({ BASELINE_SCANNED: "901" });
    const out = r.stdout + r.stderr;
    expect(out).toContain("Do NOT run --update-baseline");
    // The pre-fix invitation must NOT appear: it is the sentence that turned a broken
    // scan into a permanent green.
    expect(out).not.toContain("ratchet BASELINE_METHOD_EXISTS down");
  });

  it("FAILS (exit 1) on a PARTIAL collapse — the counters shrink proportionally and look clean", () => {
    addTests(3);
    const r = runGuard({ BASELINE_SCANNED: "100" }); // floor 50, scanned 3
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("less than half");
  });

  it("PASSES (exit 0) when the corpus matches its recorded size (revert-verify GREEN)", () => {
    addTests(3);
    const r = runGuard({ BASELINE_SCANNED: "3" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("scanned 3 test file(s)");
  });

  it("prints the corpus size on the SUCCESS path — it is the only figure with no expected value", () => {
    addTests(4);
    const r = runGuard({ BASELINE_SCANNED: "4" });
    expect(r.status).toBe(0);
    // Ordered before the four ratios: a reader who stops at the first number must see
    // the input size, not a ratio whose denominator is a committed constant.
    expect(r.stdout).toMatch(/scanned 4 test file\(s\).*method-exists=/);
  });
});
