/// <reference path="../rules.d.ts" />

// MOBILE-003 — ban bare `Buffer` global references in core src.
//
// iOS WebKit has no Node `Buffer` global. MOBILE-001 covers module-eval
// Node builtin IMPORTS and MOBILE-002 covers runtime `process` access — a
// bare `Buffer` reference inside a method body slipped past both (Issue
// #3486: githubRepoReader base64 blob decode went hot on every mobile sync
// cycle with v16.81.x and threw `ReferenceError: Can't find variable:
// Buffer`, breaking the entire mobile ExoSync leg).
//
// Banned in packages/exocortex/src + packages/services/src (both bundled
// into the plugin transitively → mobile-reachable). Type positions are
// banned too — zero exist today, and a `: Buffer` type in platform-neutral
// code is a leaked Node contract that invites the next value usage.
// packages/obsidian-plugin/src is NOT scanned: it has legitimate
// desktop-only Buffer usage behind the lazy-node-modules boundary
// (GitSubmoduleOps exec types, SwitchCacheLayer tar cache).
//
// Use the platform-neutral helpers in src/utilities/base64.ts instead
// (atob/btoa + TextEncoder/TextDecoder — available in both Obsidian
// webviews and Node ≥16). Tests are not scanned: jest runs in Node, where
// Buffer is the natural oracle for output-equivalence assertions.

// Known heuristic limitations (line-based, same trade-off as MOBILE-001/002):
//  - a `//` sequence inside a string literal truncates the scanned line, so
//    a bare Buffer AFTER it on the same line is missed (false negative);
//  - string literals containing the bare word `Buffer` would be flagged
//    (false positive — none exist in scope);
//  - mid-line block comments (`/* Buffer */ code`) are not stripped.

// Bare global reference: `Buffer` not preceded by `.`/identifier chars
// (`vault.Buffer`, `fetchTarballBuffer` stay allowed) and not followed by
// identifier chars (`BufferSource`, `BufferEncoding` stay allowed).
const BARE_BUFFER_RE = /(?<![.\w$])Buffer(?![\w$])/;

function hasBareBufferReference(rawLine: string): boolean {
  // Drop trailing line comments so prose like `// the old Buffer path`
  // cannot flag a clean code line.
  const code = rawLine.replace(/\/\/.*$/, "");
  return BARE_BUFFER_RE.test(code);
}

export default {
  rules: {
    "no-bare-buffer-global": {
      description:
        "Bare `Buffer` references in core src throw ReferenceError on Obsidian mobile (Issue #3486)",
      severity: "error",
      async check(ctx) {
        // packages/services is bundled into the plugin transitively
        // (obsidian-plugin depends on @kitelev/exocortex-services), so its
        // src is mobile-reachable and scanned too.
        const files = [
          ...(await ctx.glob("packages/exocortex/src/**/*.{ts,tsx}")),
          ...(await ctx.glob("packages/services/src/**/*.{ts,tsx}")),
        ];
        for (const file of files) {
          const hits = await ctx.grep(file, /\bBuffer\b/);
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
            if (!hasBareBufferReference(line)) continue;

            ctx.report.violation({
              message:
                "Bare `Buffer` reference — iOS WebKit has no Node `Buffer` global, this throws ReferenceError at runtime on Obsidian mobile (Issue #3486).",
              file: hit.file,
              line: hit.line,
              fix: "Use the platform-neutral helpers in packages/exocortex/src/utilities/base64.ts (bytesToBase64 / base64ToBytes / base64ToUtf8 / utf8ToBase64).",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
