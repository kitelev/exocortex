/**
 * Driver-reliability guards shared by the four out-of-jest `*-pipe.harness.ts`
 * files — `get-body` (#4449), `set-body` (#4443), the three `--dry-run` verbs
 * (#4451) and `create-batch` (#4462). Issue #4464.
 *
 * Those harnesses measure the BUILT bundle through real pipes, which is why they
 * live outside jest at all. That gives them two failure modes of their own, and
 * both were live in all four copies before this module existed:
 *
 * 1. `--no-build` checked only that `dist/index.js` EXISTS. A bundle older than
 *    the sources it was built from therefore passed silently, and the harness
 *    reported on a pre-change revision as if it were the tree it was pointed at
 *    (harness-invocation-surface §A8). The author of #4456 hit exactly that on a
 *    clean tree: red axes that said nothing about the code under them. The
 *    refusal here is deliberately NOT a silent rebuild — `--no-build` exists to
 *    skip the ~10 s bundle step, so honouring it and refusing is truthful, while
 *    rebuilding behind the caller's back would change what the flag means.
 * 2. Cleanup of the temp vault/scratch tree ran as the last statement of the
 *    async IIFE, so any throw before it leaked a directory under `os.tmpdir()`
 *    (LOW from the #4462 review). `runAxes` puts it in `finally` and — just as
 *    deliberately — does NOT swallow the error: the rejection still reaches the
 *    runtime, so rc and the message survive.
 *
 * ⛤ Shared rather than copied four times, for the reason `helpers/exit-assertions.ts`
 * gives about itself: four pasted copies are four places to drift. The stronger
 * half is that the guard becomes structural — a harness has no other way to reach
 * a bundle path than `prepareBundleOrExit`, so it cannot skip the staleness check
 * by omission. The axes in `pipe-harness-guards-4464.integration.test.ts` lock
 * both the behaviour (G1–G3) and that wiring (G4–G6).
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Refusal to run against a bundle that cannot be trusted. Distinct from a plain
 * `Error` so `prepareBundleOrExit` can turn OUR refusals into the harness's
 * `❌ BUILD — …` line while letting a genuine programming error crash loudly.
 */
export class PipeHarnessBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipeHarnessBundleError";
  }
}

export interface PrepareBundleOptions {
  /**
   * Roots whose newest file the bundle must not predate. Defaults to
   * {@link bundleInputRoots}; the axes inject a synthetic tree instead.
   */
  inputRoots?: string[];
  /** Build runner, injected so the axes never spawn a real `npm run build`. */
  build?: (tree: string) => { status: number | null; stderr: string };
}

/**
 * The newest file anywhere under `root`, or `null` when `root` does not exist.
 *
 * ⛔ Classification is by `statSync` (which FOLLOWS a symlink), not by the
 * `Dirent` kind: a `Dirent` for a symlink answers `false` to BOTH `isDirectory`
 * and `isFile` (measured), so a dirent-kind walk skips symlinked trees in
 * silence — a workspace laid out with a symlinked `src` would report "not stale"
 * however old the bundle was, which is the very defect this module exists to
 * close. The two failure modes that buys are both absorbed deliberately:
 * a dangling symlink makes `statSync` throw ENOENT, and a symlink LOOP makes
 * `readdirSync` throw ELOOP (measured: at depth 15 on APFS) — the walk skips
 * the entry or the directory rather than taking the harness down with it.
 * The `statSync` guard doubles as the TOCTOU guard: a file listed by
 * `readdirSync` and removed before its `statSync` (a concurrent build under
 * `dist/`) is skipped, not fatal.
 */
export function newestFileUnder(
  root: string,
): { file: string; mtimeMs: number } | null {
  let newest: { file: string; mtimeMs: number } | null = null;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // vanished mid-walk, not a directory, or a symlink loop (ELOOP)
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue; // removed between readdir and stat, or a dangling symlink
      }
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (!st.isFile()) continue;
      if (newest === null || st.mtimeMs > newest.mtimeMs) {
        newest = { file: p, mtimeMs: st.mtimeMs };
      }
    }
  };
  if (!fs.existsSync(root)) return null;
  walk(root);
  return newest;
}

/**
 * What esbuild actually reads when it bundles the CLI, which is NOT the same as
 * "the workspace sources".
 *
 * `packages/cli/esbuild.config.mjs` marks only Node built-ins external, so the
 * workspace dependencies ARE inlined — but through their package `main`, which
 * is `dist/index.js` for both `@kitelev/exocortex-core` and
 * `@kitelev/exocortex-services` (a bundle attempt with those `dist/` trees
 * absent fails outright with `Could not resolve "@kitelev/exocortex-core"`).
 *
 * ⛔ Their `src/` is therefore deliberately absent from this list. An unbuilt
 * edit under `packages/core/src` never reaches the CLI bundle whether or not
 * `--no-build` was passed — the harness's own build step is
 * `npm run build -w @kitelev/exocortex-cli`, which does not rebuild core either.
 * Refusing on it would be a false refusal against a bundle that IS current with
 * respect to everything it was built from; rebuilding core is a root
 * `npm run build` concern, outside what this flag can promise.
 */
export function bundleInputRoots(cliPkg: string): string[] {
  const tree = path.resolve(cliPkg, "../..");
  return [
    path.join(cliPkg, "src"),
    path.join(tree, "packages/core/dist"),
    path.join(tree, "packages/services/dist"),
  ];
}

/**
 * `null` when `dist` is at least as new as every file under every existing root,
 * otherwise a one-line reason naming the offending file and both timestamps.
 */
export function distStalenessReason(
  dist: string,
  inputRoots: string[],
): string | null {
  const distMtimeMs = fs.statSync(dist).mtimeMs;
  let newest: { file: string; mtimeMs: number } | null = null;
  for (const root of inputRoots) {
    const candidate = newestFileUnder(root);
    if (candidate === null) continue;
    if (newest === null || candidate.mtimeMs > newest.mtimeMs)
      newest = candidate;
  }
  if (newest === null || newest.mtimeMs <= distMtimeMs) return null;
  const iso = (ms: number): string => new Date(ms).toISOString();
  return (
    `dist older than src — ${dist} (${iso(distMtimeMs)}) predates ` +
    `${newest.file} (${iso(newest.mtimeMs)}); drop --no-build or rebuild`
  );
}

function npmBuildCli(tree: string): { status: number | null; stderr: string } {
  const r = spawnSync("npm", ["run", "build", "-w", "@kitelev/exocortex-cli"], {
    cwd: tree,
    encoding: "utf-8",
  });
  return { status: r.status, stderr: r.stderr || "" };
}

/**
 * Resolve `[--dist <index.js>] [--no-build]` into a bundle path that is safe to
 * measure, building first unless told not to.
 *
 * Throws {@link PipeHarnessBundleError} — never exits — so the axes can observe
 * every refusal. `prepareBundleOrExit` is the thin caller that turns a refusal
 * into the harness's historical `❌ BUILD — …` + rc=1.
 */
export function prepareBundle(
  argv: string[],
  cliPkg: string,
  options: PrepareBundleOptions = {},
): string {
  const distFlag = argv.indexOf("--dist");
  const dist =
    distFlag >= 0
      ? path.resolve(argv[distFlag + 1])
      : path.join(cliPkg, "dist/index.js");
  const noBuild = argv.includes("--no-build");

  if (!noBuild) {
    const r = (options.build ?? npmBuildCli)(path.resolve(cliPkg, "../.."));
    if (r.status !== 0) {
      throw new PipeHarnessBundleError(
        `rc=${r.status}\n${r.stderr.slice(-2000)}`,
      );
    }
  }
  if (!fs.existsSync(dist)) {
    throw new PipeHarnessBundleError(`no bundle at ${dist}`);
  }
  if (noBuild) {
    const stale = distStalenessReason(
      dist,
      options.inputRoots ?? bundleInputRoots(cliPkg),
    );
    if (stale !== null) throw new PipeHarnessBundleError(stale);
  }
  return dist;
}

/** {@link prepareBundle}, reporting a refusal the way the harnesses always have. */
export function prepareBundleOrExit(
  argv: string[],
  cliPkg: string,
  options: PrepareBundleOptions = {},
): string {
  try {
    return prepareBundle(argv, cliPkg, options);
  } catch (e) {
    if (!(e instanceof PipeHarnessBundleError)) throw e;
    console.log(`❌ BUILD — ${e.message}`);
    process.exit(1);
  }
}

/**
 * Run a harness's axis body with its temp trees removed afterwards WHATEVER the
 * outcome.
 *
 * ⛔ The rejection is deliberately not caught: a harness that swallowed it would
 * print `PASS=…` and exit 0 on a crash, which is the failure mode these drivers
 * exist to make visible.
 */
export async function runAxes<T>(
  cleanupPaths: string[],
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } finally {
    for (const p of cleanupPaths) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  }
}
