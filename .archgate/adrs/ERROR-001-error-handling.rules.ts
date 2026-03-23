/// <reference path="../rules.d.ts" />
export default {
  rules: {
    "no-empty-catch": {
      description:
        "Catch blocks must not be completely empty — log, rethrow, or handle explicitly",
      severity: "warning",
      async check(ctx) {
        // Only check production source, not tests or benchmarks
        const patterns = [
          "packages/*/src/**/*.ts",
          "packages/*/src/**/*.tsx",
        ];

        for (const pattern of patterns) {
          const hits = await ctx.grepFiles(
            /catch\s*(\([^)]*\))?\s*\{\s*\}/,
            pattern,
          );
          for (const hit of hits) {
            // Skip test files
            if (hit.file.includes("/tests/") || hit.file.includes(".test.") || hit.file.includes(".spec.")) continue;

            ctx.report.warning({
              message: "Empty catch block — errors should be logged, rethrown, or explicitly handled",
              file: hit.file,
              line: hit.line,
              fix: "Add: logger.error(...), throw, or return fallback value",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
