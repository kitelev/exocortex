/**
 * Issue #4464 — the two driver-reliability defects the four out-of-jest
 * `*-pipe.harness.ts` files shared: `--no-build` accepted a bundle older than
 * the sources it was built from, and cleanup of the temp tree was the last
 * statement of the IIFE rather than a `finally`.
 *
 * The harnesses themselves cannot run here — they need a built bundle and real
 * pipes, which is the whole reason they live outside jest (the CLI jest job does
 * not build `dist`). Their GUARDS can and do: `helpers/pipe-harness-guards.ts`
 * is plain fs/argv logic, so this suite is CI-gated even though its four callers
 * are not. That asymmetry is the point — before #4464 nothing about the drivers
 * was covered by any gate at all.
 *
 * Axes:
 *   G1  `--no-build` REFUSES when the bundle predates its inputs, naming both
 *       sides (the defect: it only checked existence, so a stale bundle was
 *       measured silently — harness-invocation-surface §A8)
 *   G2  `--no-build` still PROCEEDS when the bundle is newer than every input.
 *       Control for G1: a guard that refused always would redden here, so G1 is
 *       a statement about staleness rather than about `--no-build` at all.
 *   G2b a missing bundle keeps its own distinct refusal (`no bundle at …`), so
 *       the staleness check did not swallow the pre-existing existence check.
 *   G3  cleanup runs when the body THROWS, and the error still propagates —
 *       both halves, because a `finally` that swallowed would turn a crash into
 *       `PASS=…` + rc=0.
 *   G4  every `*-pipe.harness.ts` obtains its bundle through
 *       `prepareBundleOrExit` — the wiring half of G1/G2
 *   G5  every `*-pipe.harness.ts` runs its axis body through `runAxes` — the
 *       wiring half of G3
 *   G6  no `*-pipe.harness.ts` removes a temp tree on its own any more, which is
 *       what says the cleanup moved rather than got duplicated
 *
 * Mutants: `pipe-harness-guards-4464.spec.json` (subject = the helper) locks
 * G1 and G3; `pipe-harness-guards-4464.wiring.spec.json` (subject = the
 * create-batch harness) locks G4 and G5.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  PipeHarnessBundleError,
  bundleInputRoots,
  prepareBundle,
  runAxes,
} from "./helpers/pipe-harness-guards.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A synthetic `cliPkg` with one source file and one bundle, mtimes we choose. */
interface Tree {
  root: string;
  cliPkg: string;
  dist: string;
  src: string;
  srcFile: string;
}

function makeTree(): Tree {
  const root = fs.mkdtempSync(join(os.tmpdir(), "pipe-guards-"));
  const cliPkg = join(root, "packages/cli");
  const src = join(cliPkg, "src");
  const distDir = join(cliPkg, "dist");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });
  const srcFile = join(src, "index.ts");
  const dist = join(distDir, "index.js");
  fs.writeFileSync(srcFile, "export const x = 1;\n");
  fs.writeFileSync(dist, "// bundle\n");
  return { root, cliPkg, dist, src, srcFile };
}

/** Absolute seconds, so the two mtimes can never collide on a coarse filesystem. */
function setMtime(file: string, epochSeconds: number): void {
  fs.utimesSync(file, epochSeconds, epochSeconds);
}

const NEVER_BUILD = {
  build: (): { status: number | null; stderr: string } => {
    throw new Error("the build runner must not be reached under --no-build");
  },
};

describe("#4464 — pipe-harness driver guards", () => {
  let tree: Tree;

  beforeEach(() => {
    tree = makeTree();
  });

  afterEach(() => {
    fs.rmSync(tree.root, { recursive: true, force: true });
  });

  it("G1: --no-build refuses a bundle that predates its inputs, naming both sides", () => {
    setMtime(tree.dist, 1_700_000_000);
    setMtime(tree.srcFile, 1_700_000_600);

    let thrown: unknown;
    try {
      prepareBundle(["--no-build", "--dist", tree.dist], tree.cliPkg, {
        ...NEVER_BUILD,
        inputRoots: [tree.src],
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(PipeHarnessBundleError);
    const message = (thrown as Error).message;
    expect(message).toContain("dist older than src");
    expect(message).toContain(tree.dist);
    expect(message).toContain(tree.srcFile);
    expect(message).toContain("drop --no-build or rebuild");
  });

  it("G2: --no-build proceeds when the bundle is newer than every input", () => {
    setMtime(tree.srcFile, 1_700_000_000);
    setMtime(tree.dist, 1_700_000_600);

    expect(
      prepareBundle(["--no-build", "--dist", tree.dist], tree.cliPkg, {
        ...NEVER_BUILD,
        inputRoots: [tree.src],
      }),
    ).toBe(tree.dist);
  });

  it("G2b: a missing bundle keeps its own refusal, distinct from staleness", () => {
    const absent = join(tree.cliPkg, "dist/not-built.js");

    let thrown: unknown;
    try {
      prepareBundle(["--no-build", "--dist", absent], tree.cliPkg, {
        ...NEVER_BUILD,
        inputRoots: [tree.src],
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(PipeHarnessBundleError);
    expect((thrown as Error).message).toBe(`no bundle at ${absent}`);
  });

  it("G3: runAxes cleans up when the body throws and still propagates the error", async () => {
    const scratch = fs.mkdtempSync(join(os.tmpdir(), "pipe-guards-scratch-"));
    fs.writeFileSync(join(scratch, "leaked.txt"), "x");

    await expect(
      runAxes([scratch], async () => {
        throw new Error("axis exploded");
      }),
    ).rejects.toThrow("axis exploded");

    expect(fs.existsSync(scratch)).toBe(false);
  });

  // ---- wiring: the four drivers actually go through the guards ---------------
  const harnesses = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith("-pipe.harness.ts"))
    .sort();

  it("G4: every *-pipe.harness.ts obtains its bundle through prepareBundleOrExit", () => {
    // Canary: an empty sweep would make G4/G5/G6 vacuously green.
    expect(harnesses.length).toBeGreaterThanOrEqual(4);
    const missing = harnesses.filter(
      (f) =>
        !fs
          .readFileSync(join(__dirname, f), "utf-8")
          .includes("prepareBundleOrExit("),
    );
    expect(missing).toEqual([]);
  });

  it("G5: every *-pipe.harness.ts runs its axis body through runAxes", () => {
    expect(harnesses.length).toBeGreaterThanOrEqual(4);
    const missing = harnesses.filter(
      (f) => !fs.readFileSync(join(__dirname, f), "utf-8").includes("runAxes("),
    );
    expect(missing).toEqual([]);
  });

  it("G6: no *-pipe.harness.ts removes its temp tree on its own", () => {
    expect(harnesses.length).toBeGreaterThanOrEqual(4);
    const offenders = harnesses.filter((f) =>
      fs.readFileSync(join(__dirname, f), "utf-8").includes("fs.rmSync("),
    );
    expect(offenders).toEqual([]);
  });

  it("G7: the default input roots are the trees esbuild actually inlines", () => {
    const cliPkg = resolve(__dirname, "../..");
    const roots = bundleInputRoots(cliPkg);
    expect(roots).toEqual([
      join(cliPkg, "src"),
      resolve(cliPkg, "../core/dist"),
      resolve(cliPkg, "../services/dist"),
    ]);
  });
});
