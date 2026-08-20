/// <reference path="../rules.d.ts" />

// CI-001 — a version pinned in TWO places, bumped in ONE.
//
// Dependabot reads MANIFESTS. It does not read the ENVIRONMENT, because the
// environment is written inline in a workflow: a container tag, a
// `node-version:`. So a bump lands on one side and the two drift — silently,
// because nothing in the repo compares them.
//
// ⛤ MEASURED, twice within one hour on 2026-08-20, and the two failure shapes
// are OPPOSITE — which is why a single rule covers both:
//
//   pair        manifest                   environment                    symptom
//   ─────────── ────────────────────────── ────────────────────────────── ──────────────────────
//   Playwright  @playwright/test 1.57→1.62 container mcr…playwright:v1.57 322 failed, every one
//                                          (3 occurrences in ci.yml)      "Executable doesn't
//                                                                          exist at …
//                                                                          chromium_headless_shell-1234"
//   Node        @types/node 20→26          node-version: "22" (×8), 20    NOTHING. CI is green —
//                                                                          it compiles, it does not
//                                                                          run. `new URLPattern(…)`
//                                                                          (a Node-24 global) errors
//                                                                          under types 22 and is
//                                                                          clean under 26, so the
//                                                                          ReferenceError waits for
//                                                                          the first caller.
//
// The second shape is the reason this rule exists at all: a green CI is not
// evidence for the Node pair, and cannot be. Only a comparison of the two
// declarations is.
//
// ⛔ THE PREDICATES ARE NOT SYMMETRIC, and that asymmetry is measured, not
// stylistic:
//
//   • Playwright — EXACT equality. The browsers live in the image, and the
//     harness asks for the revision its npm version expects. 1.62 npm against a
//     1.57 image produced 322 identical failures. (A milder predicate was
//     considered and rejected: main carried @playwright/test ^1.56.1 against a
//     v1.57.0 image and was green, so SOME skew is tolerated — but the tolerated
//     width is undocumented upstream, and "it happened to work at 1 minor" is
//     not a contract. Equality is the only line that does not require guessing
//     where the tolerance ends.)
//
//   • Node — types major ≤ MINIMUM node-version, not equality. Types describe a
//     runtime; describing LESS than the runtime is safe (you simply cannot type
//     an API you have), describing MORE is the hole. Minimum, not maximum,
//     because the oldest workflow is where the code breaks first.
//
// Known limitations (line-based, same trade-off as MOBILE-001/002/003/005):
//  - `node-version:` inside a comment or a string would be read as a
//    declaration (no such case exists today — measured);
//  - a matrix `node-version: [20, 22]` is NOT parsed; the regex reads a single
//    scalar. If a matrix is introduced, this rule silently sees only what the
//    scalar regex matches — worth a follow-up, and stated here rather than
//    pretended away;
//  - the manifest side reads the ROOT package.json only. Workspace members
//    declaring their own @types/node are not compared (they are kept in step by
//    the root today — measured: all five carry the same specifier).

interface WorkflowHit {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

const NODE_VERSION_RE = /node-version:\s*["']?(\d+)(?:\.[\d.]+)?["']?/;
const PLAYWRIGHT_IMAGE_RE = /mcr\.microsoft\.com\/playwright:v([0-9]+\.[0-9]+\.[0-9]+)/;

/** Strip a semver range prefix: "^1.62.1" → "1.62.1", "~22.20.1" → "22.20.1". */
function baseVersion(specifier: string): string {
  return specifier.replace(/^[\^~>=<\s]+/, "").trim();
}

function majorOf(version: string): number {
  return Number.parseInt(version.split(".")[0] ?? "", 10);
}

async function collect(
  ctx: RuleContext,
  files: readonly string[],
  re: RegExp,
): Promise<WorkflowHit[]> {
  const out: WorkflowHit[] = [];
  for (const file of files) {
    const content = await ctx.readFile(file);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i] ?? "";
      if (raw.trimStart().startsWith("#")) continue;
      const m = re.exec(raw);
      if (m && m[1]) out.push({ file, line: i + 1, value: m[1] });
    }
  }
  return out;
}

export default {
  rules: {
    "manifest-environment-version-parity": {
      description:
        "A version declared in both a manifest and the CI environment (container tag, node-version) must not drift — Dependabot bumps the manifest and cannot see the environment",
      severity: "error",
      async check(ctx) {
        const workflows = await ctx.glob(".github/workflows/*.yml");
        const manifest = JSON.parse(await ctx.readFile("package.json")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...manifest.dependencies, ...manifest.devDependencies };

        // ── pair 1: @playwright/test ↔ container image tag ────────────────────
        const pwSpec = deps["@playwright/test"];
        const images = await collect(ctx, workflows, PLAYWRIGHT_IMAGE_RE);
        if (pwSpec && images.length > 0) {
          const want = baseVersion(pwSpec);
          for (const hit of images) {
            if (hit.value === want) continue;
            ctx.report.violation({
              message: `Playwright version drift: package.json declares @playwright/test ${pwSpec} (→ ${want}), this container image pins v${hit.value}. The browsers come from the IMAGE, so the harness will ask for a revision the image does not ship and every browser test fails with "Executable doesn't exist at /ms-playwright/…".`,
              file: hit.file,
              line: hit.line,
              fix: `Bump the image tag to mcr.microsoft.com/playwright:v${want}-jammy in EVERY occurrence (there are ${images.length} in this repo), or lower the npm version to match.`,
            });
          }
        }

        // ── pair 2: @types/node major ↔ minimum node-version ──────────────────
        const typesSpec = deps["@types/node"];
        const nodeVersions = await collect(ctx, workflows, NODE_VERSION_RE);
        if (typesSpec && nodeVersions.length > 0) {
          const typesMajor = majorOf(baseVersion(typesSpec));
          let lowest = nodeVersions[0]!;
          for (const hit of nodeVersions) {
            if (Number.parseInt(hit.value, 10) < Number.parseInt(lowest.value, 10)) {
              lowest = hit;
            }
          }
          const lowestMajor = Number.parseInt(lowest.value, 10);
          if (Number.isFinite(typesMajor) && typesMajor > lowestMajor) {
            ctx.report.violation({
              message: `Node types outrun the runtime: package.json declares @types/node ${typesSpec} (major ${typesMajor}) while this workflow runs Node ${lowestMajor} — the LOWEST in the repo. tsc will then accept APIs that do not exist at run time (measured: \`new URLPattern(...)\`, a Node-24 global, errors under @types/node@22 and compiles clean under 26), and CI stays green because it compiles rather than runs.`,
              file: lowest.file,
              line: lowest.line,
              fix: `Raise this workflow's node-version to ${typesMajor} (and keep the others in step), or lower @types/node to major ${lowestMajor}. Types describing LESS than the runtime is safe; describing more is the hole.`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
