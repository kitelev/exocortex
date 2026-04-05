import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, "../..");
const monorepoRoot = path.resolve(cliRoot, "../..");

describe("CLI npm publish verification (#2601)", () => {
  const cliPkgPath = path.join(cliRoot, "package.json");
  const workflowPath = path.resolve(
    monorepoRoot,
    ".github/workflows/npm-publish-cli.yml",
  );

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

  it("should have npm-publish-cli workflow", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it("workflow should trigger on release event", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("on:");
    expect(workflow).toContain("release:");
    expect(workflow).toContain("types: [published]");
  });

  it("workflow should publish @kitelev/exocortex-cli", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("npm publish --access public");
    expect(workflow).toContain("@kitelev/exocortex-cli");
  });
});
