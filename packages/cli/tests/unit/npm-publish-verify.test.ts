import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, "../..");
const monorepoRoot = path.resolve(cliRoot, "../..");
const workflowsDir = path.resolve(monorepoRoot, ".github/workflows");

/** Minimum npm that can exchange a GitHub OIDC token for a publish token. */
const MIN_TRUSTED_PUBLISHING_NPM: [number, number, number] = [11, 5, 1];

function atLeast(
  v: [number, number, number],
  min: [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

describe("CLI npm publish verification (#2601)", () => {
  const cliPkgPath = path.join(cliRoot, "package.json");
  // The CLI reaches npm through trusted publishing (OIDC). npm binds the
  // trusted publisher to the workflow FILE NAME, so this file is the only one
  // that can publish — see the comment above its "Publish CLI to npm" step.
  const workflowPath = path.join(workflowsDir, "auto-release.yml");

  let pkg: Record<string, unknown>;

  beforeAll(() => {
    pkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf8"));
  });

  it("should have correct scoped package name", () => {
    expect(pkg.name).toBe("@kitelev/exocortex-cli");
  });

  it("should have main entry point", () => {
    expect(pkg.main).toBe("dist/index.js");
  });

  it("should have bin entry for CLI executable", () => {
    const bin = pkg.bin as Record<string, string>;
    expect(bin["exocortex-cli"]).toBe("./dist/index.js");
  });

  it("should have build script", () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.build).toBeDefined();
  });

  it("should have prepublishOnly script that cleans and builds", () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.prepublishOnly).toContain("clean");
    expect(scripts.prepublishOnly).toContain("build");
  });

  it("should have the auto-release workflow", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it("workflow should publish @kitelev/exocortex-cli", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("cd packages/cli");
    expect(workflow).toContain("npm publish --access public");
    expect(workflow).toContain("@kitelev/exocortex-cli");
  });

  // A second publishing workflow cannot use the trusted publisher (it is bound
  // to auto-release.yml) and would need a long-lived token again — the
  // expired NPM_TOKEN is exactly what left v17.21.2 / v17.21.3 off npm.
  it("auto-release.yml is the only workflow that runs npm publish", () => {
    const publishers = fs
      .readdirSync(workflowsDir)
      .filter((f) => /\.ya?ml$/.test(f))
      // Any non-comment line: covers both `run: npm publish …` and a
      // multi-line `run: |` block.
      .filter((f) =>
        /^(?!\s*#).*\bnpm publish\b/m.test(
          fs.readFileSync(path.join(workflowsDir, f), "utf8"),
        ),
      )
      .sort();
    expect(publishers).toEqual(["auto-release.yml"]);
  });

  it("does not publish with an npm token", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    // Anchored on the FORM of a secret reference / env key: the comments in
    // the workflow name both NPM_TOKEN and NODE_AUTH_TOKEN in prose.
    expect(workflow).not.toMatch(/secrets\.NPM_TOKEN\b/);
    expect(workflow).not.toMatch(/^\s*NODE_AUTH_TOKEN\s*:/m);
  });

  it("grants the id-token permission the OIDC exchange needs", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    expect(workflow).toMatch(/^\s*id-token:\s*write\b/m);
  });

  it("upgrades npm to a trusted-publishing version before publishing", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const upgrade = /npm install -g npm@(\d+)\.(\d+)\.(\d+)\b/.exec(workflow);
    expect(upgrade).not.toBeNull();
    const version = [
      Number(upgrade![1]),
      Number(upgrade![2]),
      Number(upgrade![3]),
    ] as [number, number, number];
    expect(atLeast(version, MIN_TRUSTED_PUBLISHING_NPM)).toBe(true);
    expect(upgrade!.index).toBeLessThan(
      workflow.indexOf("npm publish --access public"),
    );
  });
});
