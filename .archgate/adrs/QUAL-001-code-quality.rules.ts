/// <reference path="../rules.d.ts" />

// Files where console usage is expected/acceptable
const CONSOLE_EXCLUDED = [
  "benchmarks/", // Performance benchmarks
  "LoggingService.ts", // Logging infrastructure
  "ApplicationErrorHandler.ts", // Error boundary
  "TypeRegistry.ts", // DI container registration
];

export default {
  rules: {
    "injectable-services": {
      description:
        "Service classes in core package should use @injectable() for DI",
      severity: "warning",
      async check(ctx) {
        const serviceFiles = await ctx.glob(
          "packages/exocortex/src/services/*.ts",
        );

        // Static utility classes that intentionally don't use DI
        const DI_EXCLUDED = ["LoggingService.ts"];

        for (const file of serviceFiles) {
          // Skip index/barrel files and intentionally non-DI classes
          if (file.endsWith("index.ts")) continue;
          if (DI_EXCLUDED.some((exc) => file.endsWith(exc))) continue;

          const content = await ctx.readFile(file);

          // Check if file has a class definition
          const hasClass = /export\s+class\s+\w+/.test(content);
          if (!hasClass) continue;

          // Check if it has @injectable()
          const hasInjectable = /@injectable\(\)/.test(content);
          if (!hasInjectable) {
            const classMatch = content.match(
              /export\s+class\s+(\w+)/,
            );
            const className = classMatch ? classMatch[1] : "Unknown";

            ctx.report.warning({
              message: `Service class ${className} is missing @injectable() decorator`,
              file,
              line: 1,
              fix: `Add @injectable() decorator from tsyringe: import { injectable } from 'tsyringe'; @injectable() export class ${className}`,
            });
          }
        }
      },
    },

    "no-console-in-core-services": {
      description:
        "Core services should use ILogger, not direct console.* calls",
      severity: "warning",
      async check(ctx) {
        const coreFiles = await ctx.glob(
          "packages/exocortex/src/services/**/*.ts",
        );

        for (const file of coreFiles) {
          if (CONSOLE_EXCLUDED.some((exc) => file.includes(exc))) continue;

          const hits = await ctx.grep(
            file,
            /console\.(log|warn|error|info|debug)\(/,
          );
          for (const hit of hits) {
            // Skip console calls inside JSDoc/comment blocks (code examples)
            const trimmed = hit.content.trim();
            if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;

            ctx.report.warning({
              message: "Core service uses console.* instead of ILogger",
              file: hit.file,
              line: hit.line,
              fix: "Inject ILogger via DI and use this.logger.info/warn/error()",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
