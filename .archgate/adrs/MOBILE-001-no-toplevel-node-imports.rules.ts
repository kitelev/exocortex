/// <reference path="../rules.d.ts" />

// MOBILE-001 — ban top-level Node builtin VALUE imports in plugin src.
//
// Obsidian mobile has no Node runtime; the bundle is CJS with builtins
// external, so a top-level `import ... from "node:fs"` becomes a
// module-eval-level `require("node:fs")` that crashes plugin load on iOS
// (Issue #3464, shipped in v16.51.0). `import type` is allowed (erased at
// compile time). Desktop-only code must go through the lazy accessors in
// `src/infrastructure/adapters/lazyNodeModules.ts`.
//
// NOTE: an eslint no-restricted-imports rule covers the same ground but is
// bypassable with `/* eslint-disable */` comments — which is exactly how the
// v16.51.0 regression shipped. This rule ignores eslint-disable comments.

// Bare builtin specifiers (the `node:`-prefix variant is matched separately).
const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

/**
 * Extract the module specifier targeted by an import/export-from line, or
 * null if the line is not an import/export-from statement fragment.
 * Handles `from "x"`, side-effect `import "x"`, and `require("x")` is NOT
 * matched here (lazyNodeModules.ts is the sanctioned require location).
 */
function importedSpecifier(line: string): string | null {
  const fromMatch = line.match(/\bfrom\s+["']([^"']+)["']/);
  if (fromMatch) return fromMatch[1];
  const sideEffectMatch = line.match(/^\s*import\s+["']([^"']+)["']/);
  if (sideEffectMatch) return sideEffectMatch[1];
  return null;
}

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  // Strip subpath (`fs/promises` → `fs`).
  const root = specifier.split("/")[0];
  return NODE_BUILTINS.has(root);
}

/**
 * Walk UP from the hit line to the line that opens the statement, so
 * multi-line imports (`import type {\n ...\n} from "node:fs"`) are judged by
 * their `import type` head, not by the closing-brace line the grep hit.
 */
function statementHead(lines: string[], hitLineIdx: number): string {
  for (let i = hitLineIdx; i >= 0; i--) {
    const line = lines[i];
    if (/^\s*(import|export)\b/.test(line)) return line;
    // Statement boundary without an import/export head — give up, treat the
    // hit line itself as the head (conservative: will NOT be type-exempt).
    if (i < hitLineIdx && /;\s*$/.test(line)) break;
  }
  return lines[hitLineIdx];
}

export default {
  rules: {
    "no-toplevel-node-imports-in-plugin": {
      description:
        "Top-level Node builtin value imports in plugin src crash plugin load on Obsidian mobile (Issue #3464)",
      severity: "error",
      async check(ctx) {
        const files = await ctx.glob(
          "packages/obsidian-plugin/src/**/*.{ts,tsx}",
        );
        for (const file of files) {
          const hits = await ctx.grep(file, /\bfrom\s+["'][^"']+["']|^\s*import\s+["'][^"']+["']/);
          if (hits.length === 0) continue;
          const content = await ctx.readFile(file);
          const lines = content.split("\n");
          for (const hit of hits) {
            const line = lines[hit.line - 1] || "";
            // Skip comment lines (doc comments routinely QUOTE the banned
            // form when explaining this very rule, e.g. lazyNodeModules.ts).
            const trimmed = line.trimStart();
            if (
              trimmed.startsWith("*") ||
              trimmed.startsWith("//") ||
              trimmed.startsWith("/*")
            ) {
              continue;
            }
            const spec = importedSpecifier(line);
            if (spec === null || !isNodeBuiltin(spec)) continue;
            const head = statementHead(lines, hit.line - 1);
            // Type-only imports/exports are erased at compile time — allowed.
            if (/^\s*import\s+type\b/.test(head)) continue;
            if (/^\s*export\s+type\b/.test(head)) continue;

            ctx.report.violation({
              message:
                `Top-level Node builtin import ("${spec}") in plugin src — compiles to a module-eval require() that crashes plugin load on Obsidian mobile (Issue #3464). eslint-disable does NOT exempt this.`,
              file: hit.file,
              line: hit.line,
              fix: "Use the lazy accessors in src/infrastructure/adapters/lazyNodeModules.ts inside a mobile-guarded method, or `import type` if only types are needed.",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
