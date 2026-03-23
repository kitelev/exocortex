/// <reference path="../rules.d.ts" />
export default {
  rules: {
    "no-class-components": {
      description:
        "React components must be functional — no class components except ErrorBoundary",
      severity: "error",
      async check(ctx) {
        const hits = await ctx.grepFiles(
          /class\s+\w+\s+extends\s+(React\.)?(Component|PureComponent)/,
          "packages/obsidian-plugin/src/presentation/**/*.tsx",
        );
        for (const hit of hits) {
          if (hit.file.includes("ErrorBoundary")) continue;

          ctx.report.violation({
            message:
              "Class component detected. Use functional component with hooks instead.",
            file: hit.file,
            line: hit.line,
            fix: "Convert to functional component: const MyComponent: React.FC<Props> = (props) => { ... }",
          });
        }
      },
    },
  },
} satisfies RuleSet;
