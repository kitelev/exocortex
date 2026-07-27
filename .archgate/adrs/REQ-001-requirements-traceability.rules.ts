/// <reference path="../rules.d.ts" />

/**
 * REQ-001: Requirements traceability — statically-resolvable `@req` bindings.
 *
 * Whole-tree, repo-expressible invariants (archgate has no vault-graph access)
 * that fail BEFORE the graph-aware `requirements-trace` CI job runs:
 *
 * 1. `well-formed-req-tags` (warning): any `@req:<token>` in a test title whose
 *    token *starts like a UUID* (hex/dash) must be a complete 8-4-4-4-12 UUID —
 *    catches truncated/mistyped tags that can never resolve. Conservative: the
 *    candidate matcher requires `@req:` to be IMMEDIATELY followed by a hex char,
 *    so template interpolations (`@req:${uid}`) and doc placeholders (`@req:<uid>`)
 *    are never flagged here.
 *
 * 2. `no-template-literal-only-req-binding` (error): a requirement bound ONLY via
 *    a template literal — `it(`… @req:${UID}`)` — is invisible to the static
 *    `requirements-trace` scanner (which binds solely on literal `@req:<uuid>`
 *    tokens). If that requirement is later activated, `requirements-trace` reds
 *    for EVERY PR + blocks Auto Release. The fix (a literal token in a comment or
 *    title) is cheap; the guard makes it mandatory. See #3949/#3951 (the incident
 *    this rule prevents) and #3953 (this rule).
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

// A requirement bound via a TEMPLATE LITERAL in a test title:
//   it(`… @req:${UID} …`)  /  describe(`… @req:${uid}`)  /  test(`… @req:${x}`)
// The signature is `it(`/`describe(`/`test(` IMMEDIATELY followed (after optional
// whitespace) by an opening backtick, then `@req:${` before the first closing
// backtick. This interpolation is NOT statically resolvable, so the graph-aware
// `requirements-trace` CI job never sees the binding.
//
// ⚠️ It deliberately does NOT match a fixture STRING like `it("@req:${UID}…")` —
// there the backtick comes BEFORE `it`, so `it(` is followed by `"`, not a
// backtick (e.g. requirements-audit.integration.test.ts builds such fixtures and
// must stay unflagged).
const TEMPLATE_REQ_BINDING = /\b(?:it|describe|test)\s*\(\s*`[^`]*@req:\$\{/;
// A statically-resolvable literal `@req:<full-uuid>` token — exactly what the
// `requirements-trace` scanner binds on. May live in a comment OR a title.
const LITERAL_REQ_TOKEN =
  /@req:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

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

    "no-template-literal-only-req-binding": {
      description:
        "A requirement bound ONLY via a template literal — it(`… @req:${UID}`) — is invisible to requirements-trace's static scanner (it binds solely on literal @req:<uuid> tokens). Activating such a requirement reds requirements-trace for EVERY PR and blocks Auto Release until fixed. The file must also carry a literal @req:<full-uuid> token.",
      severity: "error",
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
          // A real binding via a template-literal test title.
          const bindingHits = await ctx.grep(file, TEMPLATE_REQ_BINDING);
          if (bindingHits.length === 0) continue;
          // Any statically-resolvable literal token in the file (comment OR
          // title) is what requirements-trace binds on — then the template
          // form is harmless.
          const literalHits = await ctx.grep(file, LITERAL_REQ_TOKEN);
          if (literalHits.length > 0) continue;

          const first = bindingHits[0];
          ctx.report.violation({
            message:
              "Requirement bound only via a template literal (it(`… @req:${…}`)) — invisible to requirements-trace's static scanner; add a literal @req:<full-uuid> token (a comment next to the const, or a literal title) so the binding survives activation.",
            file: first.file,
            line: first.line,
            fix: "Add a literal token, e.g. `// @req:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` next to the interpolated const.",
          });
        }
      },
    },
  },
} satisfies RuleSet;
