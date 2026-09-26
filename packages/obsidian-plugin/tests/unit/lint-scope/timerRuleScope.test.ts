/**
 * @jest-environment node
 *
 * #4417 — `obsidianmd/prefer-window-timers` must keep its teeth in renderer code
 * and stay out of code that runs without a window.
 *
 * The rule is a WARNING, but `--fix` applies warnings too and `lint-staged` runs
 * `--fix` on every commit, so it silently rewrote `setTimeout` →
 * `window.setTimeout` in headless-capable modules. The commit then came back
 * reverted with a failure pointing nowhere near the cause ("GitHub request
 * failed: window is not defined"), because lint-staged restores the tree and the
 * rewritten file is gone before anyone can look at it.
 *
 * These axes assert the ACTUAL autofix through the real ESLint API rather than
 * reading the config: `calculateConfigForFile` would tell us what severity is
 * configured, which is one inference away from what `--fix` does to the file.
 * `lintText` runs the same code path lint-staged runs, and writes nothing to
 * disk, so no fixture files are created or cleaned up.
 */

import { ESLint } from "eslint";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/** One timer call — the smallest input the rule is documented to rewrite. */
const SOURCE = "export function t(): void {\n  setTimeout(() => {}, 1);\n}\n";

/**
 * Run the autofix exactly as `lint-staged` would, for a file AT THIS PATH.
 * Returns the fixed text, or null when the fixer left the source alone.
 *
 * ⛔ `relPath` must be a file that EXISTS. Type-aware linting resolves the path
 * against the ESLint tsconfig project, and an invented path (`zz-probe.ts`)
 * produces a `ruleId: null`, severity-2 parser error instead of running any
 * rule — so the fixer leaves the text alone and "no rewrite" becomes true for
 * the wrong reason. The first version of these axes did exactly that: three of
 * them were green while measuring nothing (caught by the A2 control, which was
 * red for the same reason). {@link assertLinted} keeps that from recurring.
 */
async function autofix(relPath: string): Promise<{
  output: string | null;
  configErrors: string[];
}> {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`fixture path does not exist: ${relPath}`);
  }
  const eslint = new ESLint({ cwd: REPO_ROOT, fix: true });
  const [result] = await eslint.lintText(SOURCE, {
    filePath: abs,
    warnIgnored: false,
  });
  return {
    output: result?.output ?? null,
    // A rule-less error is a config/parse failure, never a rule verdict.
    configErrors: (result?.messages ?? [])
      .filter((m) => m.ruleId === null)
      .map((m) => m.message),
  };
}

/** The canary: linting actually ran, so a null output means "rule off". */
function assertLinted(res: { configErrors: string[] }): void {
  expect(res.configErrors).toEqual([]);
}

describe("#4417 prefer-window-timers is scoped to code that HAS a window", () => {
  // Each headless package is listed on its own row rather than folded into one
  // assert: they are separate `testEnvironment: 'node'` declarations, so a
  // single failure names the package whose scope regressed.
  it.each([
    [
      "core — storage-agnostic, testEnvironment node",
      "packages/core/src/services/GroundingExecutor.ts",
    ],
    [
      "services — shared grounding factories, testEnvironment node",
      "packages/services/src/prototype-subtree-instantiator.ts",
    ],
    [
      "test-utils — test infrastructure, testEnvironment node",
      "packages/test-utils/src/types.ts",
    ],
    [
      "plugin transport adapters — CLI-parity / mobile REST, exercised headless",
      "packages/obsidian-plugin/src/infrastructure/adapters/GitHubRestClient.ts",
    ],
  ])("A1 %s keeps its bare setTimeout", async (_why, relPath) => {
    const res = await autofix(relPath);
    assertLinted(res);
    expect(res.output).toBeNull();
  });

  it("A2 renderer code is STILL rewritten — the rule keeps its teeth where a window exists", async () => {
    // Control for A1. Without this, turning the rule off repo-wide would pass
    // every row above while removing the protection the rule exists for.
    const res = await autofix(
      "packages/obsidian-plugin/src/presentation/body/BodyLinkPatch.ts",
    );
    assertLinted(res);
    expect(res.output).not.toBeNull();
    expect(res.output).toContain("window.setTimeout");
  });

  it("A3 every plugin module exercised by a headless suite sits inside the off-scope", () => {
    // The scope above says "all ten @jest-environment node suites exercise
    // infrastructure/adapters and nothing else". That was measured once; this
    // axis keeps it true. A new headless suite importing, say, a presentation
    // module reddens here instead of reintroducing the defect months later.
    const testsRoot = path.join(REPO_ROOT, "packages/obsidian-plugin/tests");

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
      });

    const headlessSuites = walk(testsRoot).filter((p) =>
      /@jest-environment\s+node/.test(fs.readFileSync(p, "utf8")),
    );
    // Canary: a zero here would make the assertion below vacuously true, and a
    // rename of the pragma is exactly how that would happen silently.
    expect(headlessSuites.length).toBeGreaterThan(0);

    // The off-scope is READ FROM THE CONFIG, not restated here. Restating it
    // would let the two drift: narrowing the config would leave this axis green
    // while the headless suites started being linted again.
    const config = fs.readFileSync(path.join(REPO_ROOT, "eslint.config.mjs"), "utf8");
    const block = /files:\s*\[([^\]]*)\][^}]*?'obsidianmd\/prefer-window-timers':\s*'off'/s.exec(
      config,
    );
    expect(block).not.toBeNull();
    const pluginGlobs = [...(block as RegExpExecArray)[1].matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      // Any plugin-rooted glob counts, not just `…/src/…`: a broader scope
      // (`packages/obsidian-plugin/**`) is a different decision, not an absent
      // one, and this axis must not report it as "no glob found".
      .filter((g) => g.startsWith("packages/obsidian-plugin/"))
      .map((g) =>
        g
          .replace("packages/obsidian-plugin/src/", "")
          .replace("packages/obsidian-plugin/", "")
          .replace(/\*+$/, ""),
      );
    // Canary: no plugin glob means every plugin module is in scope, and the
    // loop below would report every import — a red for the wrong reason.
    expect(pluginGlobs.length).toBeGreaterThan(0);

    const OFF_SCOPE = new RegExp(
      `^(?:${pluginGlobs.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    );
    const offenders: string[] = [];
    for (const suite of headlessSuites) {
      const src = fs.readFileSync(suite, "utf8");
      for (const m of src.matchAll(/["'](?:@plugin\/|[./]+(?:src)\/)([^"']+)["']/g)) {
        const mod = m[1];
        if (!OFF_SCOPE.test(mod)) {
          offenders.push(`${path.relative(REPO_ROOT, suite)} → ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
