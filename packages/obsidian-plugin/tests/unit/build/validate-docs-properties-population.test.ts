import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * validate-docs-properties.js — POPULATION floor (issue #4090).
 *
 * The gate reports `Found N unique property names in docs/` then `(M missing)`. With an
 * empty or unrecognised corpus that reads `Found 0 … (0 missing)` and exits 0 — the gate
 * satisfied by an empty input, printed in the voice of a clean result.
 *
 * The two floors are DERIVED rather than assigned, which is why no magic number appears
 * below: splitting "files scanned" from "properties recognised" is itself the oracle.
 *   filesScanned === 0            → the CORPUS is gone
 *   filesScanned > 0, props === 0 → the EXTRACTOR is broken — N files were parsed and
 *                                   nothing was recognised, which a file count alone
 *                                   could never distinguish from a clean corpus.
 *
 * The script resolves its paths from `__dirname`, so the fixture is a temp root holding a
 * copy of it. That is the only way to vary the corpus without touching the real docs/.
 */
describe("validate-docs-properties.js — population floor (#4090)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const realScript = path.join(repoRoot, "scripts/validate-docs-properties.js");

  let fixtureRoot: string;
  let scriptCopy: string;

  const runGate = () =>
    spawnSync("node", [scriptCopy], { cwd: fixtureRoot, encoding: "utf8" });

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "docs-props-"));
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true });
    mkdirSync(path.join(fixtureRoot, "packages"), { recursive: true });
    scriptCopy = path.join(fixtureRoot, "scripts/validate-docs-properties.js");
    copyFileSync(realScript, scriptCopy);
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("FAILS (exit 1) when docs/ holds no .md at all, instead of reporting 0 missing", () => {
    const r = runGate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no .md files");
  });

  it("FAILS (exit 1) when files ARE scanned but nothing is recognised — the extractor, not the corpus", () => {
    writeFileSync(
      path.join(fixtureRoot, "docs/prose.md"),
      "# Title\n\nPlain prose with no property mentions at all.\n",
    );
    writeFileSync(
      path.join(fixtureRoot, "docs/more.md"),
      "Another file, still nothing that looks like a property name.\n",
    );
    const r = runGate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("scanned 2 .md file(s)");
    // The message must name the EXTRACTOR — pointing at the corpus would send the reader
    // to check a directory that is demonstrably fine.
    expect(r.stderr).toContain("EXTRACTOR failing");
  });

  it("PASSES (exit 0) and prints BOTH numbers when the corpus is real (revert-verify GREEN)", () => {
    // A property that genuinely exists in the fixture's packages/ source.
    mkdirSync(path.join(fixtureRoot, "packages/foo/src"), { recursive: true });
    writeFileSync(
      path.join(fixtureRoot, "packages/foo/src/a.ts"),
      'export const KEY = "ems__Effort_status";\n',
    );
    writeFileSync(
      path.join(fixtureRoot, "docs/schema.md"),
      "```yaml\nems__Effort_status: doing\n```\n",
    );
    const r = runGate();
    expect(r.status).toBe(0);
    // Coverage printed alongside findings: "N properties in M files", not N alone.
    expect(r.stdout).toMatch(/Found \d+ unique property names in \d+ docs\/ file\(s\)/);
  });
});
