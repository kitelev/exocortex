import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * `test-component` receives the visual specs it is supposed to judge (issue #4512).
 *
 * This is the INPUT half of the visual gate, and a different mechanism from #4506.
 * #4506 was verdict suppression: the step ran its tests and its exit code was swallowed.
 * Here the step could not be wrong about its result because it never got the subject —
 * `playwright-ct.config.ts` carried
 *
 *   testIgnore: process.env.CI ? ["**\/visual\/**"] : [],
 *
 * and that pattern matches a path SEGMENT, so it dropped the whole
 * `tests/component/visual/` subdirectory under CI. MEASURED: in run 37001499564 /
 * job 110820036210 (head_sha 1bc3ee46) the substring `tests/component/visual/` appears
 * ZERO times in the step's log; the 20 tests that did run are the top-level
 * `tests/component/*.visual.spec.tsx`, which have no `visual/` segment and were therefore
 * never affected. Two filters, two different subjects — which is also why "20 failing in
 * CI" (#4506) and "40 not in CI" (#4512) were both true at once.
 *
 * ⛤ Why the subject is read through the TypeScript PARSER and never line-wise.
 * `testIgnore` can be authored on a continuation line, split across an array literal, or
 * hidden behind a ternary — all of which a line-anchored grep reads as absent, returning a
 * false GREEN on a defective config (self-satisfying-metric-weak-verifier §A102). The
 * mutant spec carries exactly that shape (M2) to keep this honest, not merely asserted.
 *
 * ⛤ Why T1 alone is not enough. With the key removed, the collected pattern set is empty
 * and T1 is satisfied by construction — the same shape as a scan that silently stopped
 * finding its subject. T2 is therefore the canary of COVERAGE: it judges that the parse
 * reached a real `defineConfig` object and that both halves of the spec population are on
 * disk as non-empty files (§A58 — a canary that only counts names is green on empty
 * files). T3 is the positive control: the predicates must RED on the historical shape,
 * otherwise a clean sweep is indistinguishable from a dead one.
 *
 * Issue #4512. CI-config change — no `@req:` binding (RFC 0003 exempts it), consistent
 * with the sibling guard axes in this directory.
 */
describe("test-component receives the visual specs it judges (#4512)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const configPath = path.join(
    repoRoot,
    "packages/obsidian-plugin/playwright-ct.config.ts",
  );
  const componentTestDir = path.join(
    repoRoot,
    "packages/obsidian-plugin/tests/component",
  );

  // ---- parsing (pure, so T3 can exercise it over literals) ---------------------------

  /**
   * The object literal passed to `defineConfig(...)` in a Playwright config, as the
   * TypeScript parser sees it. `undefined` when the shape is not found at all — which is
   * what T2 exists to reject.
   */
  const parseConfigObject = (
    source: string,
  ): ts.ObjectLiteralExpression | undefined => {
    const sf = ts.createSourceFile(
      "playwright-ct.config.ts",
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );
    let found: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node): void => {
      if (
        !found &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "defineConfig" &&
        node.arguments.length > 0 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        found = node.arguments[0];
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    return found;
  };

  /** Top-level property names of the config object — T2's sibling-key canary. */
  const configKeys = (obj: ts.ObjectLiteralExpression): string[] =>
    obj.properties
      .map((p) =>
        p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
          ? p.name.text
          : undefined,
      )
      .filter((n): n is string => n !== undefined);

  /**
   * EVERY string literal anywhere inside the `testIgnore` initializer.
   *
   * Collected from the whole subtree on purpose: the authored form is not fixed (ternary on
   * `process.env.CI`, a bare array, a spread, a nested conditional), and a predicate that
   * only understood one of those shapes would be green on the others.
   */
  const collectTestIgnorePatterns = (source: string): string[] => {
    const obj = parseConfigObject(source);
    if (!obj) return [];
    const prop = obj.properties.find(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
        p.name.text === "testIgnore",
    );
    if (!prop || !ts.isPropertyAssignment(prop)) return [];
    const patterns: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        patterns.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(prop.initializer);
    return patterns;
  };

  /**
   * Does a Playwright `testIgnore` glob exclude this path?
   *
   * Translated here rather than taken from `minimatch`/`picomatch`: both are only
   * TRANSITIVE dependencies of this repo, so an axis keyed on them would break on an
   * unrelated dedupe (verify-before-assert §A18). T3 exercises the translator in both
   * directions so it cannot rot into "always false".
   */
  const globExcludesPath = (pattern: string, relPath: string): boolean => {
    let re = "";
    for (let i = 0; i < pattern.length; i += 1) {
      const c = pattern[i];
      if (c === "*") {
        if (pattern[i + 1] === "*") {
          re += ".*";
          i += 1;
          // `**/` should also match zero directories: `**/visual/**` vs `visual/x`.
          if (pattern[i + 1] === "/") i += 1;
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else {
        re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }
    return new RegExp(`^${re}$`).test(relPath);
  };

  /** Every visual spec on disk, RECURSIVELY, as a path relative to `tests/component`. */
  const visualSpecsOnDisk = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string, rel: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "__snapshots__") continue;
        const abs = path.join(dir, entry);
        // statSync FOLLOWS symlinks; Dirent predicates silently skip a symlinked subtree
        // (harness-invocation-surface §A10).
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        const next = rel ? `${rel}/${entry}` : entry;
        if (st.isDirectory()) walk(abs, next);
        else if (st.isFile() && entry.endsWith(".visual.spec.tsx"))
          out.push(next);
      }
    };
    walk(componentTestDir, "");
    return out.sort();
  };

  const source = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";

  // ---- axes --------------------------------------------------------------------------

  it("T1 no testIgnore pattern excludes the visual/ subdirectory", () => {
    const patterns = collectTestIgnorePatterns(source);
    const nested = visualSpecsOnDisk().filter((s) => s.includes("/"));
    const excluded = nested.flatMap((spec) =>
      patterns
        .filter((p) => globExcludesPath(p, spec))
        .map((p) => `${p} excludes ${spec}`),
    );
    expect(excluded).toEqual([]);
  });

  it("T2 the scan found its subject — config object, and both spec halves on disk", () => {
    expect(existsSync(configPath)).toBe(true);
    const obj = parseConfigObject(source);
    expect(obj).toBeDefined();
    // Sibling keys the parse must have reached; their absence means the shape moved and
    // every pattern-level verdict above is about nothing.
    expect(configKeys(obj as ts.ObjectLiteralExpression)).toEqual(
      expect.arrayContaining(["testDir", "snapshotPathTemplate"]),
    );

    const specs = visualSpecsOnDisk();
    const nested = specs.filter((s) => s.includes("/"));
    const topLevel = specs.filter((s) => !s.includes("/"));
    expect(nested.length).toBeGreaterThan(0);
    expect(topLevel.length).toBeGreaterThan(0);
    // Judge the SIZE of each named carrier, not merely that it was listed: content
    // predicates are vacuously green on an existing-but-empty file (§A58).
    const empty = specs.filter(
      (s) => statSync(path.join(componentTestDir, s)).size === 0,
    );
    expect(empty).toEqual([]);
  });

  it("T3 positive control — the predicates red on the historical shapes", () => {
    // The exact shape this issue removed.
    const historical = [
      "export default defineConfig({",
      '  testDir: "./tests/component",',
      '  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",',
      '  testIgnore: process.env.CI ? ["**/visual/**"] : [],',
      "});",
    ].join("\n");
    expect(collectTestIgnorePatterns(historical)).toEqual(["**/visual/**"]);
    expect(
      globExcludesPath("**/visual/**", "visual/PropertyFields.visual.spec.tsx"),
    ).toBe(true);

    // ⛤ The form a line-anchored grep would miss: key and value on separate lines. The
    // parser must still see it — this is why the axis is not a grep.
    const continuationLine = [
      "export default defineConfig({",
      '  testDir: "./tests/component",',
      '  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",',
      "  testIgnore:",
      "    process.env.CI",
      '      ? ["**/visual/**"]',
      "      : [],",
      "});",
    ].join("\n");
    expect(collectTestIgnorePatterns(continuationLine)).toEqual([
      "**/visual/**",
    ]);

    // …and the translator must NOT fire on unrelated excludes, or T1 would be red on a
    // healthy config and the axis would be read as noise.
    expect(
      globExcludesPath("**/e2e/**", "visual/PropertyFields.visual.spec.tsx"),
    ).toBe(false);
    expect(
      globExcludesPath(
        "**/*.skip.spec.tsx",
        "visual/PropertyFields.visual.spec.tsx",
      ),
    ).toBe(false);
    // A single `*` must not cross a path separator.
    expect(
      globExcludesPath("*.visual.spec.tsx", "visual/x.visual.spec.tsx"),
    ).toBe(false);
    expect(globExcludesPath("*.visual.spec.tsx", "x.visual.spec.tsx")).toBe(
      true,
    );

    // A config with no `testIgnore` at all yields no patterns — the shipped state. Stated
    // here so the empty set is a measured outcome rather than an untested assumption.
    expect(
      collectTestIgnorePatterns(
        'export default defineConfig({ testDir: "./x", snapshotPathTemplate: "y" });',
      ),
    ).toEqual([]);
    // And an unparseable / renamed shape yields no object — what T2 rejects.
    expect(
      parseConfigObject("export default somethingElse({ a: 1 });"),
    ).toBeUndefined();
  });
});
