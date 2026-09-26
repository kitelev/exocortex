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
 * ⛔ ESLint runs as a SUBPROCESS here, not through its Node API. Two reasons,
 * the first measured the hard way:
 *  - `eslint.config.mjs` is ESM, so the API loads it by dynamic import, which
 *    inside jest needs `--experimental-vm-modules`. The local one-suite command
 *    passes that flag and the CI script does not, so an API-based version was
 *    green locally and red in CI on every axis. The subprocess has no such
 *    dependency on how jest was invoked.
 *  - It is also the more faithful path: lint-staged shells out to `eslint --fix`
 *    exactly like this.
 *
 * The probe files are real files in real directories, created and removed around
 * the single ESLint call. An invented path would NOT do: type-aware linting
 * resolves it against the tsconfig project and yields a `ruleId: null` parse
 * error instead of running any rule, so "no rewrite" would be true for the wrong
 * reason — which is exactly how the first version of these axes was vacuous.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/** One timer call — the smallest input the rule is documented to rewrite. */
const SOURCE = "export function zzProbe(): void {\n  setTimeout(() => {}, 1);\n}\n";

/** Directories whose package config decides the verdict, one probe each. */
const ZONES: Array<{ why: string; dir: string }> = [
  { why: "core — storage-agnostic, testEnvironment node", dir: "packages/core/src" },
  {
    why: "services — shared grounding factories, testEnvironment node",
    dir: "packages/services/src",
  },
  {
    why: "test-utils — test infrastructure, testEnvironment node",
    dir: "packages/test-utils/src",
  },
  {
    why: "plugin transport adapters — CLI-parity / mobile REST, exercised headless",
    dir: "packages/obsidian-plugin/src/infrastructure/adapters",
  },
];
const RENDERER_DIR = "packages/obsidian-plugin/src/presentation";

interface LintResult {
  filePath: string;
  output?: string;
  messages: Array<{ ruleId: string | null; message: string }>;
}

/** Probe name carries a run-unique token so a parallel run cannot collide. */
const TOKEN = `zz-timer-scope-${process.pid}-${Date.now()}`;

let results: Map<string, LintResult>;

beforeAll(() => {
  const written: string[] = [];
  try {
    for (const dir of [...ZONES.map((z) => z.dir), RENDERER_DIR]) {
      const p = path.join(REPO_ROOT, dir, `${TOKEN}.ts`);
      fs.writeFileSync(p, SOURCE);
      written.push(p);
    }
    // ⛔ `--fix-dry-run`: report what `--fix` WOULD write, touching nothing.
    const raw = execFileSync(
      "npx",
      ["eslint", "--fix-dry-run", "--format", "json", ...written],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    results = new Map(
      (JSON.parse(raw) as LintResult[]).map((r) => [
        path.relative(REPO_ROOT, r.filePath),
        r,
      ]),
    );
  } finally {
    for (const p of written) fs.rmSync(p, { force: true });
  }
}, 120_000);

/** The canary: linting actually ran, so a missing output means "rule off". */
function resultFor(dir: string): LintResult {
  const key = path.join(dir, `${TOKEN}.ts`);
  const res = results.get(key);
  expect(res).toBeDefined();
  // A rule-less message is a config/parse failure, never a rule verdict — the
  // exact shape that made the first version of these axes vacuous.
  expect((res as LintResult).messages.filter((m) => m.ruleId === null)).toEqual([]);
  return res as LintResult;
}

describe("#4417 prefer-window-timers is scoped to code that HAS a window", () => {
  // Each headless package is a row of its own rather than one folded assert:
  // they are separate `testEnvironment: 'node'` declarations, so a single
  // failure names the package whose scope regressed.
  it.each(ZONES.map((z) => [z.why, z.dir] as const))(
    "A1 %s keeps its bare setTimeout",
    (_why, dir) => {
      expect(resultFor(dir).output).toBeUndefined();
    },
  );

  it("A2 renderer code is STILL rewritten — the rule keeps its teeth where a window exists", () => {
    // Control for A1. Without this, turning the rule off repo-wide would pass
    // every row above while removing the protection the rule exists for.
    const res = resultFor(RENDERER_DIR);
    expect(res.output).toBeDefined();
    expect(res.output).toContain("window.setTimeout");
  });

  it("A3 every plugin module exercised by a headless suite sits inside the off-scope", () => {
    // The scope says "all ten @jest-environment node suites exercise
    // infrastructure/adapters and nothing else". That was measured once; this
    // axis keeps it true. A new headless suite importing, say, a presentation
    // module reddens here instead of reintroducing the defect months later.
    const testsRoot = path.join(REPO_ROOT, "packages/obsidian-plugin/tests");

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory()
          ? walk(p)
          : p.endsWith(".ts") || p.endsWith(".tsx")
            ? [p]
            : [];
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
    const block =
      /files:\s*\[([^\]]*)\][^}]*?'obsidianmd\/prefer-window-timers':\s*'off'/s.exec(
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
