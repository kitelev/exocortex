/// <reference path="../rules.d.ts" />
export default {
  rules: {
    "property-naming-convention": {
      description:
        "Frontmatter property constants must use approved namespace prefixes (exo__, ems__, ims__, ztlk__, ptms__, lit__, inbox__, req__)",
      severity: "warning",
      async check(ctx) {
        // Check domain constants files for property definitions
        const constantFiles = await ctx.glob(
          "packages/exocortex/src/domain/**/constants*.ts",
        );
        const modelFiles = await ctx.glob(
          "packages/exocortex/src/domain/**/models/**/*.ts",
        );
        const allFiles = [...constantFiles, ...modelFiles];

        const approvedPrefixes = [
          "exo__",
          "ems__",
          "ims__",
          "ztlk__",
          "ptms__",
          "lit__",
          "inbox__",
          // RFC 0003 (requirements management, A13): the `req` namespace is the
          // canonical home for functional requirement constants. Added proactively
          // so `req__*` domain constants (e.g. a future homoiconic req renderer)
          // never trip this warning. No `req__` domain constants exist yet.
          "req__",
        ];

        for (const file of allFiles) {
          // Look for string literals that look like property names with double underscore
          // but DON'T use an approved prefix
          const hits = await ctx.grep(
            file,
            /['"][a-z]+__[A-Z][a-zA-Z]+_[a-zA-Z]+['"]/,
          );

          for (const hit of hits) {
            const hasApprovedPrefix = approvedPrefixes.some((prefix) =>
              hit.content.includes(prefix),
            );

            if (!hasApprovedPrefix) {
              ctx.report.warning({
                message: `Property uses non-standard namespace prefix: ${hit.content.trim()}`,
                file: hit.file,
                line: hit.line,
                fix: `Use approved namespaces: exo__, ems__, ims__, ztlk__, ptms__, lit__, inbox__, req__`,
              });
            }
          }
        }
      },
    },
  },
} satisfies RuleSet;
