import { describe, it, expect, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  extractReqUids,
  resolveOutputPath,
  type ReqEvidenceOutputConfig,
} from "../e2e/eka-gui/req-evidence-reporter";

// al-gui-ci-runner — the eka-gui req-evidence reporter binds an eka-gui scenario
// to a requirement by a `@req:<uid>` token in the test title (the AUTOMATED
// ui-acceptance sub-mode). This pins the title→uid extraction the manifest +
// the `requirements audit` checker both rely on.
//
// NB: the test inputs build the tag prefix from parts (`TAG`) so this file does
// NOT contain a literal contiguous `@req:<uuid>` — otherwise `requirements audit`
// (`--tests .`) would scan THIS file and treat the fixture uids as dangling tags.
const TAG = "@" + "req:";

describe("eka-gui req-evidence reporter — extractReqUids", () => {
  it("extracts a @req:<uid> token from a scenario title (lower-cased)", () => {
    expect(
      extractReqUids(
        `scenario 9 — Create Instance (flagship) ${TAG}ACE6DF4F-B2C7-4DCB-AFB6-BDA8B20E7DA0`,
      ),
    ).toEqual(["ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0"]);
  });

  it("extracts multiple @req tags from one title", () => {
    expect(
      extractReqUids(
        `${TAG}11111111-1111-4111-8111-111111111111 and ${TAG}22222222-2222-4222-8222-222222222222`,
      ),
    ).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("returns [] for a title with no @req tag", () => {
    expect(extractReqUids("scenario 2 — Create Task on ems__Area")).toEqual([]);
  });

  it("ignores a malformed (non-UUID) @req token", () => {
    expect(extractReqUids(`${TAG}not-a-uuid`)).toEqual([]);
  });
});

// The manifest is the machine-readable ui-acceptance evidence, and it only
// counts if it reaches the `eka-gui-req-evidence` CI artifact. The artifact is
// Playwright's resolved `outputDir` (= the Docker volume mount = the
// upload-artifact path). Writing to `config.rootDir` instead put the manifest
// under tests/e2e/eka-gui/ — Playwright derives rootDir from `testDir`, NOT from
// the config directory — so it never reached the artifact at all.
describe("eka-gui req-evidence reporter — resolveOutputPath", () => {
  // Playwright surfaces `outputDir` already resolved (absolute) on each project.
  const PROJECT_OUTPUT_DIR =
    "/repo/packages/obsidian-plugin/test-results-eka-gui";
  // …whereas rootDir is derived from `testDir`, which is much deeper.
  const ROOT_DIR = "/repo/packages/obsidian-plugin/tests/e2e/eka-gui";
  const CONFIG_FILE =
    "/repo/packages/obsidian-plugin/playwright-eka-gui.config.ts";

  const fullConfig: ReqEvidenceOutputConfig = {
    rootDir: ROOT_DIR,
    configFile: CONFIG_FILE,
    projects: [{ outputDir: PROJECT_OUTPUT_DIR }],
  };

  afterEach(() => {
    delete process.env.EKA_GUI_REQ_EVIDENCE_OUTPUT;
  });

  it("writes into the project outputDir (the CI artifact), NOT under rootDir", () => {
    const out = resolveOutputPath(fullConfig);
    expect(out).toBe(path.join(PROJECT_OUTPUT_DIR, "req-evidence.json"));
    // The regression this pins: rootDir is testDir, so a rootDir-based path
    // lands outside the artifact.
    expect(out.startsWith(ROOT_DIR)).toBe(false);
  });

  it("honours the EKA_GUI_REQ_EVIDENCE_OUTPUT override", () => {
    process.env.EKA_GUI_REQ_EVIDENCE_OUTPUT = "/tmp/custom/evidence.json";
    expect(resolveOutputPath(fullConfig)).toBe("/tmp/custom/evidence.json");
  });

  it("falls back to the CONFIG directory (not rootDir) when no project is present", () => {
    const out = resolveOutputPath({
      rootDir: ROOT_DIR,
      configFile: CONFIG_FILE,
      projects: [],
    });
    expect(out).toBe(
      path.join(
        path.dirname(CONFIG_FILE),
        "test-results-eka-gui",
        "req-evidence.json",
      ),
    );
  });
});

// Coupling axis: the fix only holds while Playwright's `outputDir`, the Docker
// volume mount and the uploaded path name the SAME directory. Changing one of
// the three silently re-opens the defect (manifest written somewhere the
// artifact does not collect), and no unit test of the reporter alone can see it.
describe("eka-gui req-evidence — outputDir ↔ Docker mount ↔ artifact coupling", () => {
  // __dirname = packages/obsidian-plugin/tests/unit
  const repoRoot = path.resolve(__dirname, "../../../..");
  const readRepoFile = (rel: string): string =>
    fs.readFileSync(path.join(repoRoot, rel), "utf-8");

  it("playwright outputDir, the docker -v target and upload-artifact agree", () => {
    const pwConfig = readRepoFile(
      "packages/obsidian-plugin/playwright-eka-gui.config.ts",
    );
    const workflow = readRepoFile(".github/workflows/eka-gui-e2e.yml");

    const outputDir = /outputDir:\s*"([^"]+)"/.exec(pwConfig)?.[1];
    expect(outputDir).toBe("test-results-eka-gui");

    // The mount target is the config dir + outputDir, inside the image's /app.
    expect(workflow).toContain(
      `:/app/packages/obsidian-plugin/${outputDir as string}`,
    );
    // …and the host side of that mount is what upload-artifact publishes.
    const hostDir = /-v "\$PWD\/([^:]+):/.exec(workflow)?.[1];
    expect(hostDir).toBe("eka-gui-results");
    expect(workflow).toContain(`path: ${hostDir as string}`);
  });
});
