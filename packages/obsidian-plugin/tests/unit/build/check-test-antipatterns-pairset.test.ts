import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * check-test-antipatterns.sh — (category, file, count) PAIR SET, not a total (#4090).
 *
 * ⛔ A TOTAL is satisfied by a SWAP. `method-exists=55/55` is green whether those 55
 * occurrences are the grandfathered ones or 54 old plus one somebody just added: the
 * ratchet cannot tell, because subtraction is commutative and the number is all it has.
 * Both sibling ratchets in this repo (check-cli-types.mjs, check-test-types.mjs) key on a
 * SET of (file, code) pairs for exactly that reason; this guard was the last one still
 * comparing totals.
 *
 * The load-bearing axis is the first one below: same total, different composition. Under
 * the old comparison it exited 0.
 */
describe("check-test-antipatterns.sh — pair-set baseline (#4090)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const scriptPath = path.join(repoRoot, "scripts/check-test-antipatterns.sh");

  let root: string;
  let corpus: string;
  let baselinePath: string;

  // ⛤ Assembled from parts on purpose. Written literally, this line would BE the banned
  // form in this file's own source, and the guard — which greps source text, not intent —
  // would flag its own fixture as a new occurrence. That is the guard working correctly;
  // the wrong fix would be to grandfather this file into the baseline, which would
  // legitimise the very pattern the ratchet exists to ban.
  const METHOD_EXISTS = "expect(typeof x).toBe(" + '"function"' + ");\n";

  const run = (args: string[] = []) =>
    spawnSync("bash", [scriptPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ANTIPATTERN_SCAN_DIR: corpus,
        ANTIPATTERN_NONCANON_DIR: path.join(root, "__none__"),
        ANTIPATTERN_BASELINE_FILE: baselinePath,
        // Fixture corpus lives in a tmpdir, so git tracks nothing there and the
        // population guard falls back to this recorded size.
        BASELINE_SCANNED: "2",
      },
    });

  const writeFiles = (a: number, b: number) => {
    writeFileSync(
      path.join(corpus, "a.test.ts"),
      METHOD_EXISTS.repeat(a) + 'it("real", () => {});\n',
    );
    writeFileSync(
      path.join(corpus, "b.test.ts"),
      METHOD_EXISTS.repeat(b) + 'it("real", () => {});\n',
    );
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "antipattern-pairset-"));
    corpus = path.join(root, "corpus");
    mkdirSync(corpus, { recursive: true });
    baselinePath = path.join(root, "baseline.tsv");
    writeFiles(2, 0);
    writeFileSync(
      baselinePath,
      `# fixture\nmethod-exists\t${path.join(corpus, "a.test.ts")}\t2\n`,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("PASSES (exit 0) when the composition matches the baseline", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("method-exists=2/2");
  });

  // THE axis. A total cannot see this; a set names the file that moved.
  it("FAILS (exit 1) on a SWAP — same total, different composition", () => {
    writeFiles(1, 1); // total still 2
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("method-exists asserts ADDED");
    expect(r.stdout).toContain("b.test.ts");
    expect(r.stdout).toContain("0 -> 1");
  });

  it("FAILS (exit 1) when an EXISTING file grows", () => {
    writeFiles(3, 0);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("2 -> 3");
  });

  it("PASSES (exit 0) with a nudge when the debt SHRINKS", () => {
    writeFiles(1, 0);
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Debt shrank");
    expect(r.stdout).toContain("2 -> 1");
  });

  // The regenerated baseline must be what the guard would then accept — otherwise the
  // sanctioned remedy leaves the tree red, and the operator learns to distrust it.
  it("--update-baseline emits a baseline the guard accepts unchanged", () => {
    writeFiles(1, 1);
    const regenerated = run(["--update-baseline"]);
    expect(regenerated.status).toBe(0);
    writeFileSync(baselinePath, regenerated.stdout);
    const after = run();
    expect(after.status).toBe(0);
  });
});
