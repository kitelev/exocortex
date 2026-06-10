import { PropertyPathExecutor } from "../../../../../src/infrastructure/sparql/executors/PropertyPathExecutor";

/**
 * Issue #3469: iOS WebKit has no Node `process` global.
 * `PropertyPathExecutor.isStrictModeEnabled()` read
 * `process.env?.EXOCORTEX_SPARQL_STRICT` — the optional chaining guards
 * `.env` being undefined but NOT the bare `process` identifier itself, so
 * the first strict-mode check on mobile threw
 * `ReferenceError: Can't find variable: process`.
 *
 * Empirically verified per
 * ~/dotfiles/.claude/rules/integration-test-revert-verify.md:
 * FAILS (ReferenceError) without the `typeof process` guard, PASSES with it.
 */
describe("PropertyPathExecutor.isStrictModeEnabled without process global (Issue #3469)", () => {
  it("returns false instead of throwing when the process global is absent (iOS runtime)", () => {
    const saved = globalThis.process;
    let result: boolean;
    try {
      delete (globalThis as { process?: unknown }).process;
      result = PropertyPathExecutor.isStrictModeEnabled();
    } finally {
      (globalThis as { process?: unknown }).process = saved;
    }
    expect(result).toBe(false);
  });

  // Desktop semantics must be preserved: with process present the env
  // variable keeps working exactly as before (Issue #3282 contract).
  it.each(["1", "true", "yes", "TRUE", " Yes "])(
    "still honours EXOCORTEX_SPARQL_STRICT=%s when process exists",
    (value) => {
      const savedEnv = process.env.EXOCORTEX_SPARQL_STRICT;
      try {
        process.env.EXOCORTEX_SPARQL_STRICT = value;
        expect(PropertyPathExecutor.isStrictModeEnabled()).toBe(true);
      } finally {
        if (savedEnv === undefined) {
          delete process.env.EXOCORTEX_SPARQL_STRICT;
        } else {
          process.env.EXOCORTEX_SPARQL_STRICT = savedEnv;
        }
      }
    },
  );

  it("still returns false for unset/falsy EXOCORTEX_SPARQL_STRICT when process exists", () => {
    const savedEnv = process.env.EXOCORTEX_SPARQL_STRICT;
    try {
      delete process.env.EXOCORTEX_SPARQL_STRICT;
      expect(PropertyPathExecutor.isStrictModeEnabled()).toBe(false);
      process.env.EXOCORTEX_SPARQL_STRICT = "0";
      expect(PropertyPathExecutor.isStrictModeEnabled()).toBe(false);
    } finally {
      if (savedEnv === undefined) {
        delete process.env.EXOCORTEX_SPARQL_STRICT;
      } else {
        process.env.EXOCORTEX_SPARQL_STRICT = savedEnv;
      }
    }
  });
});
