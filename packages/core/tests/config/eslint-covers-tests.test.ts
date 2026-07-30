// eslint-disable-next-line import/no-nodejs-modules -- config-inspection test reads repo files off disk (Node-only, never bundled into the plugin)
import * as fs from "fs";
// eslint-disable-next-line import/no-nodejs-modules -- see above
import * as path from "path";
import * as ts from "typescript";

/**
 * Regression lock for task d7f89d46.
 *
 * Type-aware @typescript-eslint rules require every linted file to belong to
 * the TS project named by `parserOptions.project` in eslint.config.mjs. The
 * build tsconfig.json excludes `packages/**\/tests/**\/*`, so pointing eslint
 * at it made `eslint packages/core/tests/**` fail with
 * "The file was not found in any of the provided project(s)" — the entire
 * core test corpus was un-lintable.
 *
 * The fix wires eslint at a dedicated `tsconfig.eslint.json` that re-includes
 * tests. This test asserts the *actually-wired* project (read from
 * eslint.config.mjs) resolves core test files into its program.
 *
 * Revert-verify:
 *  - Repoint eslint.config.mjs `project` back to './tsconfig.json'  → RED.
 *  - Re-add `packages/**\/tests/**\/*` to tsconfig.eslint.json exclude → RED.
 */
describe("eslint type-aware project covers packages/core/tests/** (d7f89d46)", () => {
  function findRepoRoot(): string {
    let dir = __dirname;
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(dir, "eslint.config.mjs"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      "repo root (eslint.config.mjs) not found from " + __dirname,
    );
  }

  function eslintProjectPath(repoRoot: string): string {
    const cfg = fs.readFileSync(
      path.join(repoRoot, "eslint.config.mjs"),
      "utf8",
    );
    const match = cfg.match(/project:\s*["']([^"']+)["']/);
    if (match === null) {
      throw new Error("parserOptions.project not found in eslint.config.mjs");
    }
    return path.resolve(repoRoot, match[1]);
  }

  function resolveProjectFiles(tsconfigPath: string): string[] {
    // Arrow-wrap ts.sys members so the host does not carry unbound method
    // references (@typescript-eslint/unbound-method).
    const host: ts.ParseConfigFileHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      readDirectory: (rootDir, extensions, excludes, includes, depth) =>
        ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth),
      fileExists: (file) => ts.sys.fileExists(file),
      readFile: (file) => ts.sys.readFile(file),
      getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
      onUnRecoverableConfigFileDiagnostic: () => {
        /* swallow — assertions below cover the failure */
      },
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, host);
    return parsed?.fileNames ?? [];
  }

  it("resolves core test files into the wired eslint TS project", () => {
    const repoRoot = findRepoRoot();
    const projectPath = eslintProjectPath(repoRoot);
    const files = resolveProjectFiles(projectPath);

    const coreTests = files.filter(
      (f) => f.includes("/packages/core/tests/") && f.endsWith(".test.ts"),
    );

    expect(coreTests.length).toBeGreaterThan(0);
  });
});
