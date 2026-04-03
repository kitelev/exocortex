/// <reference path="../rules.d.ts" />

// Files excluded from security checks (SPARQL 1.1 spec compliance, graph positioning)
const EXCLUDED_PATTERNS = [
  "sparql/filters/BuiltInFunctions.ts", // SPARQL RAND(), MD5(), SHA1() — W3C spec-mandated
  "sparql/filters/functions/", // Decomposed SPARQL function modules — same W3C spec compliance
  "memory/CompactGraphStore.ts", // Random initial positions for graph node layout
];

function isExcluded(filePath: string): boolean {
  return EXCLUDED_PATTERNS.some((pattern) => filePath.includes(pattern));
}

export default {
  rules: {
    "no-math-random": {
      description:
        "Math.random() is not cryptographically secure — use crypto.randomUUID() or crypto.randomBytes()",
      severity: "error",
      async check(ctx) {
        const hits = await ctx.grepFiles(
          /Math\.random\s*\(/,
          "packages/*/src/**/*.ts",
        );
        for (const hit of hits) {
          if (isExcluded(hit.file)) continue;

          // Allow clearly documented fallbacks (check surrounding 5 lines for suppression comments)
          const content = await ctx.readFile(hit.file);
          const lines = content.split("\n");
          const contextStart = Math.max(0, hit.line - 5);
          const contextEnd = Math.min(lines.length, hit.line);
          const context = lines.slice(contextStart, contextEnd).join("\n");
          if (
            context.includes("Last resort fallback") ||
            context.includes("not cryptographically secure") ||
            context.includes("// nosec") ||
            context.includes("SECURITY CONTEXT")
          ) {
            continue;
          }

          ctx.report.violation({
            message:
              "Math.random() is not cryptographically secure for ID/token generation",
            file: hit.file,
            line: hit.line,
            fix: "Use crypto.randomUUID() for IDs or crypto.randomBytes() for tokens",
          });
        }
      },
    },

    "no-weak-hash": {
      description:
        "MD5 and SHA1 are cryptographically broken — use SHA-256 or SHA-512",
      severity: "error",
      async check(ctx) {
        const patterns = [
          {
            pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/,
            algo: "MD5",
          },
          {
            pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/,
            algo: "SHA1",
          },
        ];

        for (const { pattern, algo } of patterns) {
          const hits = await ctx.grepFiles(pattern, "packages/*/src/**/*.ts");
          for (const hit of hits) {
            if (isExcluded(hit.file)) continue;

            ctx.report.violation({
              message: `${algo} is cryptographically broken`,
              file: hit.file,
              line: hit.line,
              fix: "Use createHash('sha256') or createHash('sha512') instead",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
