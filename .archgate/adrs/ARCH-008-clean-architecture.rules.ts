/// <reference path="../rules.d.ts" />
export default {
  rules: {
    "no-domain-outer-imports": {
      description:
        "Domain layer must not import from application, infrastructure, or presentation layers",
      severity: "error",
      async check(ctx) {
        const domainFiles = await ctx.glob(
          "packages/exocortex/src/domain/**/*.ts",
        );
        const forbidden = [
          { pattern: /from\s+['"].*\/application\//, layer: "application" },
          {
            pattern: /from\s+['"].*\/infrastructure\//,
            layer: "infrastructure",
          },
          { pattern: /from\s+['"].*\/presentation\//, layer: "presentation" },
          { pattern: /from\s+['"]obsidian/, layer: "obsidian (framework)" },
          { pattern: /from\s+['"]@plugin\//, layer: "obsidian-plugin" },
        ];

        for (const file of domainFiles) {
          for (const { pattern, layer } of forbidden) {
            const hits = await ctx.grep(file, pattern);
            for (const hit of hits) {
              ctx.report.violation({
                message: `Domain layer imports from ${layer}. Dependency Rule: inner layers must not depend on outer layers.`,
                file: hit.file,
                line: hit.line,
                fix: `Remove this import. Use a DI interface defined in domain layer instead.`,
              });
            }
          }
        }
      },
    },

    "no-application-presentation-imports": {
      description:
        "Application layer must not import from presentation layer",
      severity: "error",
      async check(ctx) {
        const appFiles = await ctx.glob(
          "packages/exocortex/src/application/**/*.ts",
        );
        const forbidden = [
          { pattern: /from\s+['"].*\/presentation\//, layer: "presentation" },
          { pattern: /from\s+['"]obsidian/, layer: "obsidian (framework)" },
          { pattern: /from\s+['"]@plugin\//, layer: "obsidian-plugin" },
        ];

        for (const file of appFiles) {
          for (const { pattern, layer } of forbidden) {
            const hits = await ctx.grep(file, pattern);
            for (const hit of hits) {
              ctx.report.violation({
                message: `Application layer imports from ${layer}. Application should only depend on Domain.`,
                file: hit.file,
                line: hit.line,
                fix: `Move this dependency to an infrastructure adapter or use DI.`,
              });
            }
          }
        }
      },
    },

    "no-core-consumer-imports": {
      description:
        "Core package must not import from consumer packages (obsidian-plugin, cli)",
      severity: "error",
      async check(ctx) {
        const coreFiles = await ctx.glob("packages/exocortex/src/**/*.ts");
        const forbidden = [
          {
            pattern: /from\s+['"]@plugin\//,
            pkg: "obsidian-plugin (@plugin/)",
          },
          {
            pattern: /from\s+['"].*obsidian-plugin\//,
            pkg: "obsidian-plugin (path)",
          },
          { pattern: /from\s+['"].*\/cli\//, pkg: "cli" },
          { pattern: /from\s+['"]obsidian['"]/, pkg: "obsidian (framework)" },
        ];

        for (const file of coreFiles) {
          for (const { pattern, pkg } of forbidden) {
            const hits = await ctx.grep(file, pattern);
            for (const hit of hits) {
              ctx.report.violation({
                message: `Core package imports from ${pkg}. Core must be framework-agnostic.`,
                file: hit.file,
                line: hit.line,
                fix: `Core (packages/exocortex) must never depend on consumer packages. Define interfaces in core, implement in consumers.`,
              });
            }
          }
        }
      },
    },

    "no-domain-side-effects": {
      description:
        "Domain layer must be pure — no console, fetch, or fs calls",
      severity: "warning",
      async check(ctx) {
        const domainFiles = await ctx.glob(
          "packages/exocortex/src/domain/**/*.ts",
        );
        const sideEffects = [
          {
            pattern: /console\.(log|warn|error|info|debug)\(/,
            effect: "console.*",
          },
          { pattern: /\bfetch\s*\(/, effect: "fetch()" },
          {
            pattern: /require\s*\(\s*['"]fs['"]\s*\)/,
            effect: "require('fs')",
          },
          {
            pattern: /from\s+['"]fs['"]/,
            effect: "import from 'fs'",
          },
        ];

        for (const file of domainFiles) {
          for (const { pattern, effect } of sideEffects) {
            const hits = await ctx.grep(file, pattern);
            for (const hit of hits) {
              ctx.report.warning({
                message: `Side effect in domain layer: ${effect}. Domain should contain only pure business logic.`,
                file: hit.file,
                line: hit.line,
                fix: `Move side effects to infrastructure layer. Use DI for logging/IO.`,
              });
            }
          }
        }
      },
    },
  },
} satisfies RuleSet;
