/// <reference path="../rules.d.ts" />

/**
 * DOC-001: Documentation Consistency
 *
 * Detects phantom references in .md files — paths, classes, and exports
 * that are documented but don't exist in the codebase.
 */

// Key documentation files to scan
const DOC_FILES = [
  "README.md",
  "ARCHITECTURE.md",
  "VISION.md",
];

// Paths that are intentionally external or planned
const PATH_ALLOWLIST = [
  "docs/", // docs may reference planned features
  "http", // URLs
  ".github/", // CI configs always exist
];

export default {
  rules: {
    "no-phantom-source-paths": {
      description:
        "Documentation must not reference source file paths that don't exist",
      severity: "warning",
      async check(ctx) {
        for (const docFile of DOC_FILES) {
          const exists = (await ctx.glob(docFile)).length > 0;
          if (!exists) continue;

          const content = await ctx.readFile(docFile);
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Match patterns like `packages/*/src/**/*.ts` or `src/path/File.ts`
            const pathMatches = line.match(
              /(?:packages\/[\w-]+\/(?:src|tests)\/[\w/./-]+\.tsx?)/g,
            );
            if (!pathMatches) continue;

            for (const refPath of pathMatches) {
              // Skip if in code block comment or allowlisted
              if (PATH_ALLOWLIST.some((a) => refPath.includes(a))) continue;
              // Skip glob patterns with wildcards
              if (refPath.includes("*")) continue;

              const found = await ctx.glob(refPath);
              if (found.length === 0) {
                ctx.report.warning({
                  message: `Documentation references non-existent path: ${refPath}`,
                  file: docFile,
                  line: i + 1,
                  fix: `Verify the path exists or update the reference. File may have been moved or deleted.`,
                });
              }
            }
          }
        }
      },
    },

    "no-stale-package-description": {
      description:
        "README package table must list all workspace packages",
      severity: "warning",
      async check(ctx) {
        const readmeFiles = await ctx.glob("README.md");
        if (readmeFiles.length === 0) return;

        const readme = await ctx.readFile("README.md");

        // Find all actual workspace packages
        const packageDirs = await ctx.glob("packages/*/package.json");
        const packageNames = packageDirs.map((p) => {
          const parts = p.split("/");
          return parts[parts.indexOf("packages") + 1];
        });

        // Check each package is mentioned in README
        for (const pkg of packageNames) {
          // Search for package name in various forms
          const patterns = [
            pkg, // e.g. "exocortex", "cli", "obsidian-plugin"
            `packages/${pkg}`, // e.g. "packages/cli"
          ];

          const found = patterns.some((p) => readme.includes(p));
          if (!found) {
            ctx.report.warning({
              message: `Package "${pkg}" exists in packages/ but is not mentioned in README.md`,
              file: "README.md",
              line: 1,
              fix: `Add package to the Packages table in README.md`,
            });
          }
        }
      },
    },

    "no-coming-soon-without-issue": {
      description:
        'Features marked "coming soon" should have a linked GitHub issue',
      severity: "warning",
      async check(ctx) {
        for (const docFile of DOC_FILES) {
          const exists = (await ctx.glob(docFile)).length > 0;
          if (!exists) continue;

          const content = await ctx.readFile(docFile);
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            if (
              line.includes("coming soon") ||
              line.includes("coming shortly")
            ) {
              // Check if there's a GitHub issue reference nearby (within 3 lines)
              const context = lines
                .slice(Math.max(0, i - 1), i + 3)
                .join(" ");
              const hasIssueRef =
                /#\d+/.test(context) || /github\.com.*issues/.test(context);

              if (!hasIssueRef) {
                ctx.report.warning({
                  message: `"Coming soon" without linked issue — use "planned" instead or link to a GitHub issue`,
                  file: docFile,
                  line: i + 1,
                  fix: `Replace "coming soon" with "planned" or add a GitHub issue reference: (#123)`,
                });
              }
            }
          }
        }
      },
    },
  },
};
