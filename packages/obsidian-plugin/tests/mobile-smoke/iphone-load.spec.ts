/**
 * iPhone mobile-load E2E smoke (Issue #3464).
 *
 * Module-evals the BUILT plugin bundle (main.js) inside a real WebKit page
 * with iPhone emulation. WebKit is the engine family of Obsidian iOS
 * (WKWebView); the page has NO Node runtime, and the injected `require`
 * shim throws for every module Obsidian mobile does not provide (Node
 * builtins, electron, ...). Only `obsidian` / `@codemirror/*` / `@lezer/*`
 * resolve — to inert stubs, exactly mirroring what Obsidian mobile injects.
 *
 * If module-eval completes and a plugin class is exported, the bundle can
 * LOAD on an iPhone. The v16.51.0 regression (top-level
 * `import ... from "node:child_process"` in GitSubmoduleOps → module-eval
 * `require("node:child_process")` → «Failed to load plugin» on iOS) fails
 * this spec. Empirically verified: revert→fail / restore→pass.
 *
 * Companion gates: archgate MOBILE-001 (source level, PR-time) and
 * scripts/assert-mobile-loadable.mjs (Node VM eval, release build).
 * This spec adds the real-WebKit-engine layer on top.
 */
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";

const BUNDLE_PATH = path.resolve(__dirname, "..", "..", "main.js");

interface MobileEvalResult {
  ok: boolean;
  error: string | null;
  exportedType: string;
  intercepted: string[];
  nodeRequireAttempts: string[];
}

test.describe("iPhone mobile-load smoke (@mobile-load)", () => {
  test("built main.js module-evals in WebKit without Node and exports the plugin class", async ({
    page,
  }) => {
    expect(
      existsSync(BUNDLE_PATH),
      `Built bundle not found at ${BUNDLE_PATH} — run \`npm run build\` first (CI builds it via setup-node-pnpm run-build).`,
    ).toBe(true);
    const code = readFileSync(BUNDLE_PATH, "utf8");

    await page.goto("about:blank");

    const result = await page.evaluate<MobileEvalResult, { code: string }>(
      ({ code: bundleCode }) => {
        const intercepted: string[] = [];
        const nodeRequireAttempts: string[] = [];

        // Inert universal stub: callable, constructible, every property
        // access returns another stub — enough for `class X extends
        // obsidian.Plugin` and top-level destructuring at module-eval.
        function makeStub(name: string): unknown {
          const fn = function stub(): void {
            /* noop */
          };
          return new Proxy(fn, {
            get(target, prop): unknown {
              if (prop === "prototype") {
                return (target as { prototype: unknown }).prototype;
              }
              if (prop === Symbol.toPrimitive) {
                return () => `[stub ${name}]`;
              }
              return makeStub(`${name}.${String(prop)}`);
            },
            construct(): object {
              return {};
            },
            apply(): unknown {
              return makeStub(`${name}()`);
            },
          });
        }

        // Mirrors Obsidian mobile's module surface: obsidian + CodeMirror
        // packages resolve; EVERYTHING else (node:*, bare builtins,
        // electron) is absent → throw, like the iOS WKWebView would.
        const requireShim = (id: string): unknown => {
          intercepted.push(id);
          if (
            id === "obsidian" ||
            id.startsWith("@codemirror/") ||
            id.startsWith("@lezer/")
          ) {
            return makeStub(id);
          }
          if (id.startsWith("node:")) nodeRequireAttempts.push(id);
          throw new Error(
            `[iphone-sim] Cannot find module '${id}' (no Node runtime on Obsidian mobile)`,
          );
        };

        const moduleObj: { exports: Record<string, unknown> } = {
          exports: {},
        };
        try {
          // CJS module-eval, exactly how Obsidian loads plugin main.js.
          const evaluate = new Function(
            "module",
            "exports",
            "require",
            bundleCode,
          );
          evaluate(moduleObj, moduleObj.exports, requireShim);
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            exportedType: "n/a",
            intercepted,
            nodeRequireAttempts,
          };
        }
        const exported =
          (moduleObj.exports as { default?: unknown }).default ??
          moduleObj.exports;
        return {
          ok: typeof exported === "function",
          error: null,
          exportedType: typeof exported,
          intercepted,
          nodeRequireAttempts,
        };
      },
      { code },
    );

    expect(
      result.error,
      `Bundle failed module-eval under iPhone simulation (Issue #3464 regression class). ` +
        `Node require attempts: [${result.nodeRequireAttempts.join(", ")}]`,
    ).toBeNull();
    expect(
      result.nodeRequireAttempts,
      "module-eval attempted Node builtin require(s) — even if swallowed, this is a mobile-load risk",
    ).toEqual([]);
    expect(
      result.ok,
      `module-eval completed but exported '${result.exportedType}' instead of the plugin class`,
    ).toBe(true);
  });
});
