import { readFileSync } from "fs";
import * as path from "path";

/**
 * MOBILE-005 — the line matchers of the archgate rule, tested directly.
 * @req:50b54def-5a44-4a49-b288-529d22aad5d9
 *
 * The rule itself is verified by running the archgate binary (a rule that
 * merely REGISTERS raises `check passed` by one without proving it can fire —
 * see ci-lint-job-is-not-just-eslint §A2). These axes cover the layer that
 * prove-by-running does NOT: whether each matcher discriminates the shapes it
 * claims to.
 *
 * ⛔ This is not theoretical. The first draft of the `.at(` matcher was
 *
 *     /(?<![.\w$])[\w$\])]\s*\.\s*at\s*\(/
 *
 * and it matched NOTHING on `[key].at(0)`. The lookbehind applies before the
 * `]`, where the preceding character is `y` — a word char — so it failed. The
 * `Object.hasOwn` half fired correctly, the binary said `1 failed`, and the
 * guard would have shipped enforcing HALF of its stated ban with a green
 * revert-verify. Only a per-matcher mutant exposed it.
 *
 * ⛤ These axes read the matchers OUT OF the rule file rather than restating
 * them. A copy here would drift from the rule silently and then assert about
 * itself.
 */
describe("archgate MOBILE-005 — line matchers", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const rulePath = path.join(
    repoRoot,
    ".archgate/adrs/MOBILE-005-no-silent-es2022-runtime-api.rules.ts"
  );

  const source = readFileSync(rulePath, "utf-8");

  /** Extract a `line:` regex literal that follows the given label marker. */
  function lineMatcherFor(labelFragment: string): RegExp {
    const idx = source.indexOf(labelFragment);
    if (idx < 0) {
      throw new Error(`label fragment not found in rule file: ${labelFragment}`);
    }
    // The `line:` literal precedes the label within the same entry.
    const head = source.slice(0, idx);
    const matches = [...head.matchAll(/line:\s*(\/(?:[^/\\\n]|\\.)+\/)[a-z]*,/g)];
    const last = matches[matches.length - 1];
    if (!last) {
      throw new Error(`no line: matcher found before ${labelFragment}`);
    }
    // eslint-disable-next-line no-eval
    return eval(last[1]) as RegExp;
  }

  describe("Object.hasOwn", () => {
    const re = lineMatcherFor("label: \"`Object.hasOwn`\"");

    it("matches the call form", () => {
      expect(re.test("  return Object.hasOwn(source, key);")).toBe(true);
    });

    it("matches with incidental whitespace", () => {
      expect(re.test("return Object . hasOwn (o, k);")).toBe(true);
    });

    it("does NOT match a mere mention without the call", () => {
      // The four live occurrences in core src are all of this shape.
      expect(re.test("the sanctioned replacement for Object.hasOwn is")).toBe(false);
    });
  });

  describe(".at()", () => {
    const re = lineMatcherFor("label: \"`.at()`\"");

    it("matches an identifier receiver", () => {
      expect(re.test("const last = arr.at(-1);")).toBe(true);
    });

    it("matches a bracket-expression receiver — the shape the first draft MISSED", () => {
      // Regression axis for the drafting defect described in the docblock.
      expect(re.test("return [key].at(0) !== undefined;")).toBe(true);
    });

    it("matches a call-expression receiver", () => {
      expect(re.test("const c = getList().at(2);")).toBe(true);
    });

    it("does NOT match a property named at without a call", () => {
      expect(re.test("const when = event.at;")).toBe(false);
    });

    it("does NOT match a double dot", () => {
      // Guards the one thing the lookbehind is actually for.
      expect(re.test("const x = a..at(0);")).toBe(false);
    });
  });

  describe("scope of the ban", () => {
    it("does NOT list findLast — tsc already refuses it under both lib settings", () => {
      // Measured: `--lib ES2020` and `--lib ES2020,ES2022` BOTH emit TS2550 for
      // findLast. Banning it here would duplicate the compiler and imply a
      // coverage this rule does not provide for the cases tsc misses.
      expect(source).not.toMatch(/grep:\s*\/[^/]*findLast/);
    });

    it("scans core and services src, and NOT the plugin package", () => {
      expect(source).toContain("packages/core/src/**");
      expect(source).toContain("packages/services/src/**");
      expect(source).not.toContain("packages/obsidian-plugin/src/**");
    });
  });
});
