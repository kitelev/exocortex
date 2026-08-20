/// <reference path="../rules.d.ts" />

// CI-002 — a published package promising a Node it cannot actually run on.
//
// A package we publish declares `engines.node`. Its dependencies declare theirs.
// Nothing compares the two, so a routine dependency bump can raise what the code
// REQUIRES without touching what the manifest PROMISES — and the two drift.
//
// ⛤ MEASURED on 2026-08-21 (PR #4169, commander 14 → 15), read from the lockfile
// rather than from release notes:
//
//     packages/cli/node_modules/commander  15.0.0  engines: { node: '>=22.12.0' }
//     packages/cli/package.json                    engines: { node: '>=20.0.0'  }
//
// ⇒ the published package promised Node 20 and required 22.12.
//
// ⛔ CI cannot catch this BY CONSTRUCTION. It runs `node-version: "22"`, which
// resolves above 22.12, so the gap lives exactly where we do not test — at a
// consumer on Node 20. None of the required checks reads `engines` at all. The
// failure surfaces as somebody else's `SyntaxError`, in their install, days later.
//
// ── Relationship to CI-001 ───────────────────────────────────────────────────
// CI-001 compares a manifest against the CI ENVIRONMENT (container tag,
// `node-version:`). This is the third form of the same class — manifest against
// the MANIFESTS OF ITS DEPENDENCIES — and the data source differs
// (`package-lock.json`, not a workflow file), which is why it is a separate rule
// rather than a third pair inside CI-001.
//
// ── Two limits, both deliberate, both stated rather than implied ─────────────
//
//  1. DIRECT dependencies only. Transitive requirements are not ours to satisfy,
//     and their declarations are frequently absent or stale; including them would
//     bury the signal we can act on under noise we cannot.
//
//  2. LOWER BOUNDS only, not full range containment. `engines` may be a
//     disjunction (`20 || >=22`, `^12.17.0 || ^14.13 || >=16.0.0` — both live in
//     this lockfile today), and this rule compares the LOWEST version each side
//     admits. It therefore catches "the dependency needs a newer Node than we
//     promise", which is the shape that shipped. It does NOT catch a hole inside
//     a disjunction — e.g. we allow Node 21 while a dependency admits `20 || >=22`.
//     Closing that needs a real semver-range implementation; rule files may only
//     import `node:*`, so that would mean vendoring one. Named here so the next
//     reader knows the boundary is chosen, not overlooked.

interface Manifest {
  readonly name?: string;
  readonly private?: boolean;
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Record<string, string>;
}

interface LockEntry {
  readonly engines?: { readonly node?: string };
}

type Version = readonly [number, number, number];

/**
 * The lowest Node version a range admits.
 *
 * A disjunction is "any of", so its floor is the MINIMUM across branches — not
 * the first one written. Missing minor/patch count as 0 (`20` → 20.0.0), which
 * is what a bare major means.
 */
function lowestAdmitted(range: string | undefined): Version | null {
  if (!range) return null;
  let lowest: Version | null = null;
  for (const branch of range.split("||")) {
    const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(branch);
    if (!m) continue;
    const v: Version = [
      Number.parseInt(m[1] ?? "0", 10),
      Number.parseInt(m[2] ?? "0", 10),
      Number.parseInt(m[3] ?? "0", 10),
    ];
    if (lowest === null || compare(v, lowest) < 0) lowest = v;
  }
  return lowest;
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const show = (v: Version): string => v.join(".");

export default {
  rules: {
    "published-engines-not-weaker-than-deps": {
      description:
        "A published package's engines.node must not promise an older Node than its direct dependencies require — CI runs one version and cannot see the gap",
      severity: "error",
      async check(ctx) {
        const lock = JSON.parse(await ctx.readFile("package-lock.json")) as {
          packages?: Record<string, LockEntry>;
        };
        const lockPackages = lock.packages ?? {};

        // The ROOT manifest is included deliberately. It is a workspace root and
        // is not published — but that is only true because it says
        // `private: true`, and the rule should learn that from the FLAG rather
        // than from a glob that happens not to reach it. Measured when this was
        // added: the root declares 5 runtime dependencies (react, react-dom,
        // reflect-metadata, tsyringe, uuid) whose floors all sit below its own,
        // so including it costs nothing today and guards the day the flag goes.
        const manifests = [
          "package.json",
          ...(await ctx.glob("packages/*/package.json")),
        ];
        
        for (const manifestPath of manifests) {
          const manifest = JSON.parse(
            await ctx.readFile(manifestPath),
          ) as Manifest;
          if (manifest.private === true) continue; // not published — no consumer to mislead

          const ours = lowestAdmitted(manifest.engines?.node);
          if (ours === null) continue; // no promise made, nothing to contradict

          const packageDir = manifestPath.replace(/\/package\.json$/, "");

          for (const dep of Object.keys(manifest.dependencies ?? {})) {
            // npm hoists, so the dependency sits either beside the member or at
            // the root. Nearest wins, exactly as resolution does.
            const entry =
              lockPackages[`${packageDir}/node_modules/${dep}`] ??
              lockPackages[`node_modules/${dep}`];
            const theirs = lowestAdmitted(entry?.engines?.node);
            if (theirs === null) continue; // dependency states no requirement

            if (compare(theirs, ours) > 0) {
              ctx.report.violation({
                message: `${manifest.name ?? packageDir} promises engines.node ${manifest.engines?.node} (floor ${show(ours)}) but its dependency ${dep} requires ${entry?.engines?.node} (floor ${show(theirs)}). Installing this package on Node ${show(ours)} therefore satisfies our manifest and breaks on ${dep}. CI cannot see this: it runs a single Node version, above both floors.`,
                file: manifestPath,
                fix: `Raise engines.node in ${manifestPath} to >=${show(theirs)} to match ${dep}, or pin ${dep} back to a release that still supports Node ${show(ours)}.`,
              });
            }
          }
        }
      },
    },
  },
} satisfies RuleSet;
