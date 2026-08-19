import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "fs";
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
  let baselineFile: string;

  const runGuard = (extraEnv: Record<string, string>) =>
    spawnSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ANTIPATTERN_SCAN_DIR: scanDir,
        ANTIPATTERN_NONCANON_DIR: path.join(scanDir, "__no_such_dir__"),
        // ⛔ ISOLATION IS LOAD-BEARING, not cosmetic. These axes are about the POPULATION
        // floor, so the fixture corpus must contribute no pairs AND the baseline must
        // claim none. Pointing at the committed baseline would make its 56 pairs all
        // "shrank to 0" against this clean tmpdir — and the guard now exits 1 on a stale
        // baseline, so every green axis below would red for a reason it does not test.
        //
        // The four BASELINE_METHOD_EXISTS / _VACUOUS_LENGTH / _NONCANON_SERVICE_DIR /
        // _OVERMOCK variables that used to sit here were read by NOTHING once the totals
        // became derived from the TSV: a silent no-op wearing the shape of isolation.
        ANTIPATTERN_BASELINE_FILE: baselineFile,
        ...extraEnv,
      },
    });

  beforeEach(() => {
    scanDir = mkdtempSync(path.join(tmpdir(), "antipatterns-pop-"));
    baselineFile = path.join(scanDir, "baseline.tsv");
    writeFileSync(baselineFile, "# empty fixture baseline — no pairs claimed\n");
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
    // ⛤ Pinned on BEHAVIOUR, not on wording. The earlier form of this assertion named a
    // string ("ratchet BASELINE_METHOD_EXISTS down") that the rewrite deleted, so it
    // could no longer fail — while the invitation it guarded came back under new words
    // in the stale-baseline branch. What actually must hold is ORDERING: the population
    // floor exits before the pair comparison, so the shrink remedy is unreachable on a
    // broken scan. Move the floor below that comparison and these two lines go red.
    expect(out).not.toContain("ratchet the baseline down");
    expect(out).not.toContain("--update-baseline > scripts/test-antipattern-baseline.tsv");
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

  // ── The DERIVED floor (git ls-files) ────────────────────────────────────────────
  //
  // The proportional fallback exercised above accepts a large partial loss: measured on
  // the real corpus (core 375, obsidian-plugin 359, cli 160, req-audit 5, test-utils 3,
  // services 1) a half-floor of 451 lets ANY SINGLE package vanish — dropping
  // packages/core leaves 528. That is a repeat of the M5a rename this guard cites as its
  // own motivation, un-caught. git declares the TRACKED corpus while the counters grep
  // the WORKING TREE, so comparing them is a derivation across two artefacts, and it is
  // exact: measured 903 == 903 with identical file lists.
  //
  // ⛤ The fixture is a COPY of the guard inside a temp git repo, not the real script run
  // with a different cwd. The script does `ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd
  // "$ROOT"` at the top, so it always runs from ITS OWN repo root and the caller's cwd is
  // irrelevant BY CONSTRUCTION — which is also precisely why `git ls-files` resolves in
  // the real repository for a real run, and returns nothing for a tmpdir SCAN_DIR
  // (routing every case above into the fallback).
  describe("derived floor — git tracks the corpus", () => {
    let repoDir: string;

    const gitRun = (...args: string[]) =>
      spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });

    const runInRepo = () =>
      spawnSync("bash", [path.join(repoDir, "scripts/check-test-antipatterns.sh")], {
        encoding: "utf8",
        env: {
          ...process.env,
          ANTIPATTERN_SCAN_DIR: "corpus",
          ANTIPATTERN_NONCANON_DIR: "__no_such_dir__",
          // The copied guard resolves its baseline next to itself, and beforeEach writes an
          // empty one there. Without it the fixture's isolation would be ACCIDENTAL — it
          // would hold only while the corpus happens to carry no antipattern.
          // Deliberately generous: floor 0. If the derived branch did NOT fire, the
          // fallback would pass, so a RED below can only come from the derivation.
          BASELINE_SCANNED: "1",
        },
      });

    beforeEach(() => {
      repoDir = mkdtempSync(path.join(tmpdir(), "antipatterns-git-"));
      mkdirSync(path.join(repoDir, "scripts"), { recursive: true });
      mkdirSync(path.join(repoDir, "corpus"), { recursive: true });
      copyFileSync(
        path.join(repoRoot, "scripts/check-test-antipatterns.sh"),
        path.join(repoDir, "scripts/check-test-antipatterns.sh"),
      );
      writeFileSync(
        path.join(repoDir, "scripts/test-antipattern-baseline.tsv"),
        "# empty fixture baseline — no pairs claimed\n",
      );
      for (let i = 0; i < 3; i += 1) {
        writeFileSync(path.join(repoDir, `corpus/t${i}.test.ts`), "it('x', () => {});\n");
      }
      gitRun("init", "-q");
      gitRun("config", "user.email", "t@example.com");
      gitRun("config", "user.name", "t");
      gitRun("add", "-A");
      gitRun("commit", "-q", "-m", "corpus");
    });

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true });
    });

    it("PASSES (exit 0) when the working tree holds every file git tracks", () => {
      const r = runInRepo();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("scanned 3 test file(s)");
    });

    it("FAILS (exit 1) on a loss the proportional fallback would have accepted", () => {
      rmSync(path.join(repoDir, "corpus/t0.test.ts")); // tracked, gone from the tree
      const r = runInRepo();
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toContain("scanned 2 of the 3 test file(s)");
    });
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
