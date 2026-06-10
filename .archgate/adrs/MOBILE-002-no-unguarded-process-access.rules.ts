/// <reference path="../rules.d.ts" />

// MOBILE-002 — ban unguarded `process` member access in core + plugin src.
//
// iOS WebKit has no Node `process` global. Any live runtime access to
// `process.*` that is not guarded with `typeof process !== "undefined"`
// throws `ReferenceError: Can't find variable: process` on Obsidian mobile
// (Issue #3469: the lazy-loader convert path hit it and no command buttons
// rendered on assets). Sibling of MOBILE-001, which covers module-eval-level
// Node builtin IMPORTS; this rule covers runtime GLOBAL access.
//
// Allowed forms:
//  - lines containing `typeof process` — the in-repo guard idiom. Keep the
//    guard on the SAME line as the access, e.g.
//      const env = typeof process !== "undefined" ? process.env : undefined;
//    then read vars from the local alias on following lines.
//  - `process.env.NODE_ENV` — esbuild define-substitutes it with a string
//    literal at build time (esbuild.config.mjs `define` blocks, both prod
//    and dev configs), so the bundle never touches the real global.
//  - comment lines.
//
// Known heuristic limitations (line-based, same trade-off as MOBILE-001):
//  - a `//` sequence inside a string literal truncates the scanned line;
//  - bare `process` references without member access (e.g. `foo(process)`)
//    are not matched — none exist in src and the idiom is unusual;
//  - block-style guards (`if (typeof process...) { process.x }`) on
//    SEPARATE lines are flagged — restructure to the same-line alias form.

// Live member access: `process.<ident>` or `process[`, where `process` is
// not itself a property access (`vault.process(...)` stays allowed; spread
// `...process.env` is stripped to a plain access before matching).
// `process?.env` / `process!.env` are matched too: optional chaining guards
// `.env`, NOT the unresolved bare identifier — it throws the exact same
// ReferenceError on iOS, and it is the nearest-neighbour mutation a
// developer reaches for when this rule flags their line.
const ACCESS_RE = /(?<![.\w$])process\s*[?!]?\s*(?:\.\s*[A-Za-z_$]|\[)/;

function hasUnguardedAccess(rawLine: string): boolean {
  // Drop trailing line comments so prose like `// reads process.env` cannot
  // flag a clean code line.
  const code = rawLine.replace(/\/\/.*$/, "");
  // Same-line guard idiom — allowed.
  if (/typeof\s+process\b/.test(code)) return false;
  // Spread punctuation would hide the access from the lookbehind — flatten.
  const flattened = code.replace(/\.\.\./g, " ");
  // esbuild-defined NODE_ENV accesses never reach the real global. The \b
  // keeps longer identifiers (NODE_ENVIRONMENT) flagged — esbuild's define
  // substitutes the exact `process.env.NODE_ENV` form only.
  const stripped = flattened.replace(/process\.env\??\.NODE_ENV\b/g, "");
  return ACCESS_RE.test(stripped);
}

export default {
  rules: {
    "no-unguarded-process-access": {
      description:
        "Unguarded `process.*` access in core/plugin src throws ReferenceError on Obsidian mobile (Issue #3469)",
      severity: "error",
      async check(ctx) {
        // packages/services is bundled into the plugin transitively
        // (obsidian-plugin depends on @kitelev/exocortex-services), so its
        // src is mobile-reachable and scanned too.
        const files = [
          ...(await ctx.glob("packages/exocortex/src/**/*.{ts,tsx}")),
          ...(await ctx.glob("packages/obsidian-plugin/src/**/*.{ts,tsx}")),
          ...(await ctx.glob("packages/services/src/**/*.{ts,tsx}")),
        ];
        for (const file of files) {
          const hits = await ctx.grep(file, /\bprocess\s*[?!]?\s*[.[]/);
          if (hits.length === 0) continue;
          const content = await ctx.readFile(file);
          const lines = content.split("\n");
          for (const hit of hits) {
            const line = lines[hit.line - 1] || "";
            const trimmed = line.trimStart();
            if (
              trimmed.startsWith("*") ||
              trimmed.startsWith("//") ||
              trimmed.startsWith("/*")
            ) {
              continue;
            }
            if (!hasUnguardedAccess(line)) continue;

            ctx.report.violation({
              message:
                "Unguarded `process` access — iOS WebKit has no Node `process` global, this throws ReferenceError at runtime on Obsidian mobile (Issue #3469).",
              file: hit.file,
              line: hit.line,
              fix: 'Alias the global on one line — `const env = typeof process !== "undefined" ? process.env : undefined;` — and read from the alias. `process.env.NODE_ENV` is exempt (esbuild define).',
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
