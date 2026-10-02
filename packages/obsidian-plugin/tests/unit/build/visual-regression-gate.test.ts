import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

/**
 * The required `test-component` job can red on a visual regression (issue #4506).
 *
 * The visual half of that job could not fail. MEASURED on GitHub Actions
 * run 37001499564 / job 110820036210 (head_sha 1bc3ee46, = `origin/main` HEAD) and on
 * the 11 first-parent merges before it — 12 of 12 runs:
 *
 *   Running 20 tests using 2 workers
 *     20 failed
 *   ##[error]Process completed with exit code 1.
 *
 * …and `test-component` was `completed/success` in every one of the twelve. Three
 * independent mechanisms stacked up to produce that, and only the first was in the issue:
 *
 *   1. `continue-on-error: true` on the step — so exit 1 did not reach the job verdict.
 *      ⛤ Note the step's own API `conclusion` is `success` under that flag, so a sweep
 *      over `steps[].conclusion` cannot see the redness either; the verdict only exists
 *      in the step's log.
 *   2. The snapshot probe `if ! ls <glob> 2>/dev/null | head -1` keyed the branch choice
 *      on a PIPELINE's exit status, which is its LAST command's — `head` always exits 0,
 *      so `!` made the condition ALWAYS false. The baseline-GENERATING branch (the one
 *      carrying `|| true`) was dead code; every run took the `else` branch. The issue
 *      assumed the opposite ("the generating branch already has `|| true`, the flag is
 *      only needed by the branch it harms") — that premise was false by mechanism.
 *   3. No `*-chromium-linux.png` baseline existed in the repo (0 files), so the `else`
 *      branch had nothing to compare against: Playwright wrote `actual` for all 20 and
 *      reported each as a failure. The job even uploaded them as the
 *      `linux-visual-snapshots` artifact, which nobody ever committed.
 *
 * Because of (3), removing only the flag would have turned `main` red and blocked every
 * merge — so the three are not separable, and this PR lands them together: baselines
 * committed from that artifact, the broken probe removed, the flag removed.
 *
 * ⛤ Why the axes go past "the flag is gone". That single predicate is satisfied by a
 * step that still cannot fail, in three directions this repo has already taken:
 *   • V2 is the probe. A pipeline-keyed condition reads as a working feature-detect and
 *     silently pins the branch; it is the mechanism that hid (3) for months. Judged
 *     structurally (no pipe inside the `if`), not by matching the old text.
 *   • V3 is the `|| true` half. `continue-on-error` and `|| true` swallow the same exit
 *     code at different layers; an axis on the YAML key alone leaves the shell half open.
 *   • V4/V5 are the INPUT half of the gate: a step that runs 20 tests against no baseline
 *     reds forever, so the committed baselines are part of the contract, per executing
 *     spec file and not merely "at least one PNG somewhere".
 *   • V6 is the input canary. Every predicate above is vacuously green if the parse
 *     silently stopped finding the job or the step (a rename, a restructure), so the
 *     scan has to assert it found its subject.
 *   • V7 is the positive control: the predicates must RED on the historical shapes. A
 *     clean sweep is otherwise indistinguishable from a dead one.
 *
 * The step is read through a YAML parser, never line-wise: `continue-on-error` can be
 * authored on a continuation line or in flow style, and a line-anchored grep would then
 * return a false verdict on a defective file.
 *
 * Issue #4506. Bug-fix / CI-config change — no `@req:` binding (RFC 0003 exempts bug
 * fixes), consistent with the sibling guard axes in this directory.
 */
describe("test-component can red on a visual regression (#4506)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");
  const snapshotRoot = path.join(
    repoRoot,
    "packages/obsidian-plugin/tests/component/__snapshots__",
  );
  const componentTestDir = path.join(
    repoRoot,
    "packages/obsidian-plugin/tests/component",
  );

  type Step = {
    name?: string;
    run?: string;
    uses?: string;
    "continue-on-error"?: unknown;
  };
  type Job = { steps?: Step[]; "continue-on-error"?: unknown };

  /** The job's steps, as the YAML parser sees them. */
  const testComponentSteps: Step[] = (() => {
    const doc = yaml.load(readFileSync(ciPath, "utf8")) as {
      jobs?: Record<string, Job>;
    };
    return doc?.jobs?.["test-component"]?.steps ?? [];
  })();

  // ---- predicates (pure, so V7 can exercise them on fixtures) ------------------------

  /** A step that runs the visual-regression Playwright selection. */
  const runsVisualRegression = (s: Step): boolean =>
    typeof s.run === "string" &&
    s.run.includes("playwright test") &&
    /--grep\s+visual\b/.test(s.run);

  /** `continue-on-error` present at all — any value, including the string "false". */
  const carriesContinueOnError = (s: Step): boolean =>
    s["continue-on-error"] !== undefined;

  /**
   * A conditional whose truth is keyed on a PIPELINE's exit status. `cmd | head` exits
   * with `head`'s status, so such a condition is pinned regardless of `cmd`.
   */
  const probesViaPipelineStatus = (script: string): boolean =>
    script
      .split("\n")
      .some(
        (line) =>
          /^\s*(?:el)?if\b/.test(line) &&
          line.includes("|") &&
          !line.includes("||"),
      );

  /** The shell half of swallowing a non-zero exit. */
  const swallowsExitInShell = (script: string): boolean =>
    /\|\|\s*(?:true|:)\s*$/m.test(script);

  /** Spec files Playwright will actually run in CI under `--grep visual`. */
  const executingVisualSpecs = (): string[] => {
    // `testIgnore: ["**/visual/**"]` under CI drops the `visual/` SUBDIRECTORY; the
    // top-level `*.visual.spec.tsx` files have no `visual/` path segment and do run.
    // Measured in the run above: the only spec paths present in the step's log are the
    // two top-level ones, and `tests/component/visual/` appears zero times.
    return readdirSync(componentTestDir)
      .filter((f) => f.endsWith(".visual.spec.tsx"))
      .sort();
  };

  // ---- axes --------------------------------------------------------------------------

  it("V6 the scan found its subject — the job, its steps, and the visual step", () => {
    expect(existsSync(ciPath)).toBe(true);
    expect(testComponentSteps.length).toBeGreaterThan(3);
    expect(testComponentSteps.filter(runsVisualRegression)).toHaveLength(1);
  });

  it("V1 the visual-regression step carries no continue-on-error", () => {
    const offenders = testComponentSteps
      .filter(runsVisualRegression)
      .filter(carriesContinueOnError)
      .map((s) => s.name ?? "<unnamed>");
    expect(offenders).toEqual([]);
  });

  it("V2 its snapshot probe is not keyed on a pipeline's exit status", () => {
    const offenders = testComponentSteps
      .filter(runsVisualRegression)
      .filter((s) => probesViaPipelineStatus(s.run as string))
      .map((s) => s.name ?? "<unnamed>");
    expect(offenders).toEqual([]);
  });

  it("V3 it does not swallow the Playwright exit code in the shell", () => {
    const offenders = testComponentSteps
      .filter(runsVisualRegression)
      .filter((s) => swallowsExitInShell(s.run as string))
      .map((s) => s.name ?? "<unnamed>");
    expect(offenders).toEqual([]);
  });

  it("V4 every executing visual spec has committed Linux baselines", () => {
    const specs = executingVisualSpecs();
    expect(specs.length).toBeGreaterThan(0);
    const withoutBaseline = specs.filter((spec) => {
      const dir = path.join(snapshotRoot, `${spec}-snapshots`);
      if (!existsSync(dir)) return true;
      return !readdirSync(dir).some((f) => f.endsWith("-chromium-linux.png"));
    });
    expect(withoutBaseline).toEqual([]);
  });

  it("V5 each Linux baseline is a non-empty PNG", () => {
    const pngs: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const abs = path.join(dir, entry);
        // statSync FOLLOWS symlinks; Dirent predicates would silently skip a symlinked
        // subtree (harness-invocation-surface §A10).
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(abs);
        else if (st.isFile() && entry.endsWith("-chromium-linux.png"))
          pngs.push(abs);
      }
    };
    walk(snapshotRoot);
    expect(pngs.length).toBeGreaterThan(0);
    const broken = pngs.filter((p) => {
      const buf = readFileSync(p);
      // PNG magic — a truncated / placeholder file would pass a size check alone.
      return (
        buf.length < 1024 ||
        buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      );
    });
    expect(broken).toEqual([]);
  });

  it("V7 positive control — the predicates red on the historical shapes", () => {
    const historicalRun = [
      'export NODE_OPTIONS="--max-old-space-size=4096"',
      "# Check if Linux snapshots exist, if not generate them",
      "if ! ls packages/obsidian-plugin/tests/component/__snapshots__/**/*-linux.png 2>/dev/null | head -1; then",
      '  echo "Linux snapshots not found, generating baseline snapshots..."',
      "  npx playwright test -c packages/obsidian-plugin/playwright-ct.config.ts --grep visual --update-snapshots || true",
      "else",
      '  echo "Running visual regression tests against existing snapshots..."',
      "  npx playwright test -c packages/obsidian-plugin/playwright-ct.config.ts --grep visual",
      "fi",
    ].join("\n");
    const historicalStep: Step = {
      name: "Run visual regression tests (update snapshots if missing)",
      run: historicalRun,
      "continue-on-error": true,
    };

    // It IS the step this suite judges…
    expect(runsVisualRegression(historicalStep)).toBe(true);
    // …and each predicate rejects it, one per axis.
    expect(carriesContinueOnError(historicalStep)).toBe(true); // V1
    expect(probesViaPipelineStatus(historicalRun)).toBe(true); // V2
    expect(swallowsExitInShell(historicalRun)).toBe(true); // V3

    // ⛔ Deliberately NOT asserting the shipped step here. That is V1/V2/V3's job, and
    // duplicating it made this axis red under EVERY mutant — i.e. non-addressed, so a
    // mutant's red set stopped identifying which property it broke
    // (integration-test-revert-verify §A43). This axis judges the PREDICATES, over
    // literals, and therefore has no mutant in the sibling spec by construction.

    // A `continue-on-error: false` must still be rejected by V1 — the axis judges the
    // key's PRESENCE, so a later "documented false" cannot reintroduce the shape.
    expect(
      carriesContinueOnError({ run: "x", "continue-on-error": false }),
    ).toBe(true);
    // And V2 must not fire on a legitimate `||` (it is not a pipe).
    expect(probesViaPipelineStatus('if [ -n "$A" ] || [ -n "$B" ]; then')).toBe(
      false,
    );
  });
});
