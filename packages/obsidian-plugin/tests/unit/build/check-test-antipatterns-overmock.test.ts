import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * Over-mock pass-through ratchet guard — revert-verify binding.
 *
 * Test-quality audit 2026-06-22, recommendation P2. `scripts/check-test-antipatterns.sh`
 * was extended with a 4th ratchet: it FAILS when a NEW test file wholesale-mocks
 * a central internal collaborator (`@kitelev/exocortex-core`/`-services`, or a
 * relative mock of `/services/`, `/adapters/`, `/infrastructure/`,
 * `VaultRDFIndexer`) AND asserts ONLY delegation (`toHaveBeenCalled*`) with NO
 * output-value assertion anywhere in the file. That is the pure pass-through
 * service-wrapper shape (the deleted-and-lifted `SPARQLQueryService.test.ts`),
 * which verifies a call was forwarded but never exercises real behaviour — the
 * Testing-Trophy shift (P3) wants such tests written as `*.integration.test.ts`
 * driving the real collaborator instead. Baseline is 0 (no pure pass-through
 * over-mock file exists today), so the guard bans introducing one.
 *
 * This test drives the REAL guard script against a fixture corpus (via the
 * `ANTIPATTERN_SCAN_DIR` + `BASELINE_*` env overrides) and asserts the
 * RED-without / GREEN-with revert-verify contract:
 *   • a fixture over-mock pass-through file present  → exit 1 (count 1 > baseline 0)
 *   • the over-mock file removed                     → exit 0
 *   • a file that mocks the same collaborator but ALSO asserts output is NOT
 *     flagged (the output-assertion exclusion has teeth).
 *
 * @req:427530e2-6365-48ae-9bfc-513180333ecd
 */
describe("check-test-antipatterns.sh — over-mock pass-through ratchet (P2, @req:427530e2)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const scriptPath = path.join(repoRoot, "scripts/check-test-antipatterns.sh");

  // High baselines for the unrelated ratchets so ONLY the over-mock check can
  // drive the verdict against the fixture; over-mock baseline pinned at 0.
  const isolatingEnv = {
    // ⛤ The fixture corpus is a handful of files, so the POPULATION baseline is sized to
    // it exactly as the four debt baselines above are. The fixture lives in a tmpdir, so
    // `git ls-files` returns nothing for it and the guard falls back to this recorded
    // number — which is precisely the case the fallback exists for.
    //
    // ⛔ An earlier version of this comment claimed the alternative was rejected because
    // it "would make the floor disarmable by an env var". That reason is false in this
    // very file: BASELINE_SCANNED IS an env var, and "1" makes the fallback floor 0. The
    // real reason stands and is narrower — layer 1 (`scanned == 0`) reads no baseline at
    // all and therefore STAYS ARMED here, whereas skipping the floor whenever
    // ANTIPATTERN_SCAN_DIR is set would have disarmed BOTH layers.
    //
    // "1" is right rather than 0: beforeEach calls writeCleanFile() unconditionally, so
    // every case in this suite writes at least one file.
    BASELINE_SCANNED: "1",
  };

  let scanDir: string;

  let baselinePath: string;

  const runGuard = (extraEnv: Record<string, string>) =>
    spawnSync("bash", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...isolatingEnv,
        // ⛤ Assigned HERE, not in isolatingEnv: that object is a module-level const
        // evaluated at import time, before beforeEach runs, so referencing baselinePath
        // there throws a TDZ ReferenceError and the whole SUITE fails to run — which
        // jest reports as "Tests: 0 total", i.e. as if there were nothing to run rather
        // than as a failure.
        //
        // The four per-category totals are no longer env vars: the verdict now comes from
        // a (category, file, count) PAIR SET, and a total is satisfied by a SWAP. The
        // fixture therefore needs its OWN baseline file — pointing at the committed one
        // would make every fixture file a NEW pair and red every case, including the ones
        // that assert the guard stays quiet.
        ANTIPATTERN_BASELINE_FILE: baselinePath,
        ANTIPATTERN_SCAN_DIR: scanDir,
        ANTIPATTERN_NONCANON_DIR: path.join(scanDir, "__no_such_dir__"),
        ...extraEnv,
      },
    });

  const writeCleanFile = () => {
    // Mocks the same central collaborator wholesale, but asserts OUTPUT — so it
    // is NOT a pure pass-through and must NOT be flagged.
    writeFileSync(
      path.join(scanDir, "pkg/tests/clean.test.ts"),
      [
        'jest.mock("@kitelev/exocortex-core", () => ({ Foo: jest.fn() }));',
        'it("does real work", () => {',
        "  expect(result).toEqual({ a: 1 });",
        "  expect(mock.bar).toHaveBeenCalled();",
        "});",
        "",
      ].join("\n"),
    );
  };

  const writeOverMockFile = () => {
    writeFileSync(
      path.join(scanDir, "pkg/tests/overmock.test.ts"),
      [
        'jest.mock("@kitelev/exocortex-core", () => ({ Indexer: jest.fn() }));',
        'it("delegates initialize", () => {',
        "  service.initialize();",
        "  expect(mockIndexer.initialize).toHaveBeenCalled();",
        "  expect(mockIndexer.refresh).toHaveBeenCalledTimes(1);",
        "});",
        "",
      ].join("\n"),
    );
  };

  beforeEach(() => {
    scanDir = mkdtempSync(path.join(tmpdir(), "antipattern-overmock-"));
    mkdirSync(path.join(scanDir, "pkg/tests"), { recursive: true });
    // Empty pair-set baseline: this suite asserts what the guard does with files it has
    // never seen, so "never seen" has to be the starting state.
    baselinePath = path.join(scanDir, "baseline.tsv");
    writeFileSync(baselinePath, "# fixture baseline — intentionally empty\n");
    writeCleanFile();
  });

  afterEach(() => {
    rmSync(scanDir, { recursive: true, force: true });
  });

  it("FAILS (exit 1) when a NEW over-mock pass-through file is present", () => {
    writeOverMockFile();
    const r = runGuard({});
    expect(r.status).toBe(1);
    // The message names the FILE and its transition now, because the verdict comes from
    // a pair set: "increased" was a claim about a total, which a swap keeps constant.
    expect(r.stdout).toContain("over-mock pass-through service-wrapper(s) ADDED");
    expect(r.stdout).toContain("0 -> 1");
    expect(r.stdout).toContain("overmock.test.ts");
  });

  it("PASSES (exit 0) once the over-mock file is removed (revert-verify GREEN)", () => {
    // Only the clean file remains (mocks core + asserts output) → not flagged.
    const r = runGuard({});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("over-mock=0/0");
  });

  it("does NOT flag a wholesale-mock file that also asserts output", () => {
    // The clean fixture mocks @kitelev/exocortex-core AND has toHaveBeenCalled,
    // but it also asserts an output value (toEqual) — so it is real behaviour
    // verification, not pure pass-through. Guard must stay green.
    const r = runGuard({});
    expect(r.status).toBe(0);
  });
});
