/**
 * `.gitignore:77` declares `packages/<pkg>/dist/` ignored, yet 18 files under
 * `packages/cli/dist/` were tracked — force-added at some point and then frozen. They
 * were last written on 2026-06-22 while `packages/cli/src` kept moving, so the tracked
 * bundle drifted two months behind source.
 *
 * ⛔ Why that is a trap rather than clutter: `git checkout -- packages/cli/dist/index.js`
 * — the natural way to discard a build artefact after a local probe — RESTORES the stale
 * bundle, and the next `node packages/cli/dist/index.js …` silently runs old code. It was
 * observed answering `unknown command 'resolve-buttons'` for a command that has existed
 * for weeks; the message reads as "the CLI lacks this", not "you are running an artefact
 * older than the feature".
 *
 * The direction of the damage is what makes it worth a guard: a stale artefact can turn a
 * CORRECT fix into a failing probe, and — worse — a BROKEN one into a passing probe,
 * because the bundle predates the change under test.
 *
 * Revert-verify: `git add -f packages/cli/dist/index.js` → RED; unstage → GREEN.
 
 * ⛤ The glob is written `packages/<pkg>/dist` above ON PURPOSE: the literal form
 * contains the sequence that closes a block comment, so spelling it out here would
 * terminate this docstring two lines in and turn the prose into syntax errors. The
 * assertion below uses the real glob.
*/
import { describe, it, expect } from "@jest/globals";
import { execFileSync } from "child_process";
import * as path from "path";

describe("repo hygiene — no build artefact is tracked against .gitignore", () => {
  it("git tracks no files under packages/*/dist", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const tracked = execFileSync(
      "git",
      // ⛔ The trailing `/*` is load-bearing. A git pathspec `packages/*/dist` matches a
      // path ENDING at `dist`, not the files beneath it — so the earlier form returned 0
      // even with `packages/cli/dist/index.js` staged, and the guard passed while the
      // artefact was tracked. Measured: `packages/*/dist` → 0, `packages/*/dist/*` → 1.
      ["ls-files", "--", "packages/*/dist/*"],
      { cwd: repoRoot, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);

    // Canary: `git ls-files` must be able to answer at all — an empty repo listing
    // would make the assertion below vacuously true and the guard silently dead.
    const anyTracked = execFileSync("git", ["ls-files", "--", "packages"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(anyTracked.length).toBeGreaterThan(100);

    expect(tracked).toEqual([]);
  });
});
