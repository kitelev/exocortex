/// <reference path="../rules.d.ts" />

// MOBILE-005 — ban the ES2022 runtime APIs that the COMPILER LETS THROUGH.
//
// packages/core/tsconfig.json sets "target": "ES2020" with
// "lib": ["ES2020", "ES2022"]. The lib entry types APIs the target does not
// downlevel, so an author "simplifying"
//   Object.prototype.hasOwnProperty.call(o, k)  →  Object.hasOwn(o, k)
// gets a green build AND green CI, and ships a TypeError on any runtime below
// Safari / iOS 15.4. The plugin builds with isDesktopOnly: false, so that
// runtime is in scope. Until now this was defended by a docstring and nothing
// else (Issue #4064; five point-fixes of the surrounding class had already
// shipped: #4052, #4058, #4060, #4062, #4063).
//
// ⛤ SCOPE OF THE BAN IS MEASURED, NOT ASSUMED. Each candidate was run through
// tsc under both lib settings; only the ones the compiler MISSES are banned:
//
//   API                  --lib ES2020    --lib ES2020,ES2022 (the repo)
//   Object.hasOwn        TS2550 error    (no error)          ← banned
//   .at()                (no error)      (no error)          ← banned
//   .findLast()          TS2550 error    TS2550 error        ← NOT banned
//
// `findLast` is deliberately absent: tsc already owns it, and banning it here
// would imply a coverage this rule does not provide for the cases tsc misses.
// A guard that duplicates the compiler reads as broader than it is.
//
// Scanned: packages/core/src + packages/services/src — both are bundled into
// the plugin transitively, so both are mobile-reachable. packages/obsidian-plugin/src
// is NOT scanned, mirroring MOBILE-003: it has legitimate desktop-only usage
// behind the lazy-node-modules boundary.
//
// Sanctioned replacements:
//   Object.hasOwn(o, k)  →  Object.prototype.hasOwnProperty.call(o, k)
//                           (or the `ownProperty` helper in
//                            packages/core/src/domain/display-name/keyPathResolver.ts)
//   arr.at(-1)           →  arr[arr.length - 1]
//   arr.at(i) / str.at(i) →  arr[i] / str[i]  (or .charAt for strings)

// Known heuristic limitations (line-based, same trade-off as MOBILE-001/002/003):
//  - a `//` sequence inside a string literal truncates the scanned line, so a
//    banned call AFTER it on the same line is missed (false negative);
//  - a string literal containing `Object.hasOwn` would be flagged (false
//    positive — none exist in scope; the four live mentions are all docstrings
//    warning against it, and those are skipped as comments);
//  - mid-line block comments (`/* Object.hasOwn */ code`) are not stripped;
//  - `.at(` is matched on the call shape, so a user-defined method literally
//    named `at` on a domain object would be flagged. None exist today (measured:
//    zero `.at(` occurrences in either scanned package), and a domain method
//    named `at` in platform-neutral code is itself worth a second look.

interface BannedApi {
  readonly grep: RegExp;
  readonly line: RegExp;
  readonly label: string;
  readonly fix: string;
}

const BANNED: readonly BannedApi[] = [
  {
    // `Object.hasOwn(` — the method, not the word in prose.
    grep: /Object\.hasOwn/,
    line: /\bObject\s*\.\s*hasOwn\s*\(/,
    label: "`Object.hasOwn`",
    fix: "Use `Object.prototype.hasOwnProperty.call(source, key)` — or the `ownProperty` helper in packages/core/src/domain/display-name/keyPathResolver.ts, which already wraps it.",
  },
  {
    // `.at(` — Array.prototype.at / String.prototype.at (ES2022).
    //
    // ⛔ The lookbehind sits immediately BEFORE THE DOT, not before the whole
    // member expression. An earlier draft used `(?<![.\w$])[\w$\])]\s*\.\s*at\(`
    // and matched NOTHING on `[key].at(0)`: the lookbehind then applies before
    // the `]`, where the preceding char is `y` — a word char — so it failed.
    // The axis was written before the regex and caught it; without that mutant
    // the guard would have shipped enforcing only half of its stated ban.
    grep: /\.at\(/,
    line: /(?<!\.)\.\s*at\s*\(/,
    label: "`.at()`",
    fix: "Use index access — `arr[arr.length - 1]` for `.at(-1)`, `arr[i]` / `str[i]` otherwise.",
  },
];

function isCommentLine(rawLine: string): boolean {
  const trimmed = rawLine.trimStart();
  return (
    trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")
  );
}

function stripTrailingComment(rawLine: string): string {
  // Drop trailing line comments so prose like `// not Object.hasOwn` on the
  // same line as clean code cannot flag it.
  return rawLine.replace(/\/\/.*$/, "");
}

export default {
  rules: {
    "no-silent-es2022-runtime-api": {
      description:
        "ES2022 runtime APIs that tsc accepts under target ES2020 throw on Obsidian mobile below Safari/iOS 15.4 (Issue #4064)",
      severity: "error",
      async check(ctx) {
        const files = [
          ...(await ctx.glob("packages/core/src/**/*.{ts,tsx}")),
          ...(await ctx.glob("packages/services/src/**/*.{ts,tsx}")),
        ];

        for (const file of files) {
          for (const api of BANNED) {
            const hits = await ctx.grep(file, api.grep);
            if (hits.length === 0) continue;

            const content = await ctx.readFile(file);
            const lines = content.split("\n");

            for (const hit of hits) {
              const raw = lines[hit.line - 1] || "";
              if (isCommentLine(raw)) continue;
              if (!api.line.test(stripTrailingComment(raw))) continue;

              ctx.report.violation({
                message: `${api.label} is an ES2022 runtime API — it type-checks here only because tsconfig lists lib ES2022 while target is ES2020, and it throws a TypeError on Obsidian mobile below Safari/iOS 15.4 (Issue #4064).`,
                file: hit.file,
                line: hit.line,
                fix: api.fix,
              });
            }
          }
        }
      },
    },
  },
} satisfies RuleSet;
