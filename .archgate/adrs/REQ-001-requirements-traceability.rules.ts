/// <reference path="../rules.d.ts" />

/**
 * REQ-001: Requirements traceability — well-formed `@req` tags.
 *
 * Whole-tree, repo-expressible invariant (archgate has no vault-graph access):
 * any `@req:<token>` in a test title whose token *starts like a UUID* (hex/dash)
 * must be a complete 8-4-4-4-12 UUID. Catches the realistic copy-paste failure —
 * a truncated/mistyped tag that can never resolve — at the syntax layer, before
 * the graph-aware `requirements-trace` CI job runs.
 *
 * Conservative by construction: the candidate matcher requires `@req:` to be
 * IMMEDIATELY followed by a hex char, so template interpolations (`@req:${uid}`)
 * and doc placeholders (`@req:<uid>`) are never flagged — the checker's own
 * tests and the authoring guide stay clean.
 */

const TEST_GLOBS = [
  "packages/**/*.test.ts",
  "packages/**/*.test.tsx",
  "packages/**/*.spec.ts",
  "packages/**/*.spec.tsx",
];

// A `@req:` tag whose suffix begins with a hex char (so `@req:${` / `@req:<`
// are excluded). The greedy hex/dash run captures the whole malformed token.
const TAG_CANDIDATE = /@req:([0-9a-fA-F][0-9a-fA-F-]*)/g;
// Strict 8-4-4-4-12 UUID.
const FULL_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default {
  rules: {
    "well-formed-req-tags": {
      description:
        "@req:<uid> tags in test titles must be well-formed UUIDs (truncated/mistyped tags never resolve)",
      severity: "warning",
      async check(ctx) {
        const seen = new Set<string>();
        const files: string[] = [];
        for (const pattern of TEST_GLOBS) {
          for (const f of await ctx.glob(pattern)) {
            if (!seen.has(f)) {
              seen.add(f);
              files.push(f);
            }
          }
        }

        for (const file of files) {
          // Only read files that actually contain a hex-leading candidate.
          const hits = await ctx.grep(file, /@req:[0-9a-fA-F]/);
          for (const hit of hits) {
            TAG_CANDIDATE.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = TAG_CANDIDATE.exec(hit.content)) !== null) {
              if (!FULL_UUID.test(m[1])) {
                ctx.report.warning({
                  message: `Malformed @req tag (not a well-formed UUID): @req:${m[1]}`,
                  file: hit.file,
                  line: hit.line,
                  fix: "Use the full requirement UID: @req:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
                });
              }
            }
          }
        }
      },
    },
  },
} satisfies RuleSet;
