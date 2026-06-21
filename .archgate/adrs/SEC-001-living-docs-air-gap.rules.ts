/// <reference path="../rules.d.ts" />

/**
 * SEC-001: Living-Docs build is PAT-less (fail-closed by absence).
 *
 * The Living-Documentation build workflow must inject NO credential that grants
 * access to any private repo. Concretely: no `secrets.*` reference other than the
 * default repo-scoped `GITHUB_TOKEN`, and no `token:` / `ssh-key:` override on the
 * checkout that could widen access beyond it. This makes the PAT-less air-gap
 * (RFC 0004 §5) a REQUIRED, inspectable CI gate — the guarantee is verified, not
 * assumed.
 */

const WORKFLOW = ".github/workflows/living-docs.yml";

// Matches a `${{ secrets.NAME }}` reference; captures NAME.
const SECRET_RE = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/g;
// Matches a `token:` / `ssh-key:` key at the start of a (possibly indented) line.
const CHECKOUT_OVERRIDE_RE = /^\s*(token|ssh-key)\s*:/;

export default {
  rules: {
    "living-docs-pat-less-air-gap": {
      description:
        "The Living-Docs build workflow must reference no secret beyond the default GITHUB_TOKEN, and must not override the checkout credential (PAT-less air-gap, RFC 0004 §5).",
      severity: "error",
      async check(ctx) {
        const exists = (await ctx.glob(WORKFLOW)).length > 0;
        if (!exists) return; // workflow absent → nothing to enforce

        const content = await ctx.readFile(WORKFLOW);
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // 1. Any `secrets.X` other than the default GITHUB_TOKEN.
          SECRET_RE.lastIndex = 0;
          let m;
          while ((m = SECRET_RE.exec(line)) !== null) {
            if (m[1] !== "GITHUB_TOKEN") {
              ctx.report.violation({
                message: `Living-Docs workflow references secrets.${m[1]} — only the default GITHUB_TOKEN is allowed. A credential granting private-repo access breaks the PAT-less air-gap (RFC 0004 §5).`,
                file: WORKFLOW,
                line: i + 1,
                fix: "Remove the secret. The PAT-less build IS the privacy guarantee — fail-closed by absence.",
              });
            }
          }

          // 2. A `token:` / `ssh-key:` override on the checkout widens access.
          if (CHECKOUT_OVERRIDE_RE.test(line)) {
            ctx.report.violation({
              message: `Living-Docs workflow overrides the checkout credential ('${line.trim()}') — this can widen access beyond the repo-scoped GITHUB_TOKEN and break the air-gap.`,
              file: WORKFLOW,
              line: i + 1,
              fix: "Remove the token:/ssh-key: override. checkout must use only the default GITHUB_TOKEN.",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
