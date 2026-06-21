/// <reference path="../rules.d.ts" />
export default {
  rules: {
    "no-obsidian-in-plugin-application": {
      description:
        "Plugin application layer should minimize obsidian runtime imports — prefer DI interfaces",
      severity: "warning",
      async check(ctx) {
        const appFiles = await ctx.glob(
          "packages/obsidian-plugin/src/application/**/*.ts",
        );

        for (const file of appFiles) {
          const hits = await ctx.grep(file, /from\s+['"]obsidian['"]/);
          for (const hit of hits) {
            const content = await ctx.readFile(hit.file);
            const line = content.split("\n")[hit.line - 1] || "";
            // Allow type-only imports (no runtime dependency)
            if (line.includes("import type")) continue;

            ctx.report.warning({
              message:
                "Plugin application layer imports obsidian runtime. Consider using DI interfaces.",
              file: hit.file,
              line: hit.line,
              fix: "Use interface from @kitelev/exocortex-core package or import type instead of runtime import",
            });
          }
        }
      },
    },

    "no-obsidian-in-plugin-domain": {
      description:
        "Plugin domain layer must not import obsidian runtime",
      severity: "warning",
      async check(ctx) {
        const domainFiles = await ctx.glob(
          "packages/obsidian-plugin/src/domain/**/*.ts",
        );

        for (const file of domainFiles) {
          const hits = await ctx.grep(file, /from\s+['"]obsidian['"]/);
          for (const hit of hits) {
            const content = await ctx.readFile(hit.file);
            const line = content.split("\n")[hit.line - 1] || "";
            if (line.includes("import type")) continue;

            ctx.report.warning({
              message:
                "Plugin domain layer imports obsidian runtime. Domain must be framework-agnostic.",
              file: hit.file,
              line: hit.line,
              fix: "Move obsidian dependency to infrastructure adapter. Domain must be pure.",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
