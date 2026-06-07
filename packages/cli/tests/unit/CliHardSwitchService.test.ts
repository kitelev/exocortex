/**
 * @jest-environment node
 *
 * Focused unit tests for CliHardSwitchService helpers not exercised by the
 * integration suite (SSH→HTTPS URL normalisation; namespace-less descriptor
 * scan).
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  CliHardSwitchService,
  toHttpsGitHubUrl,
} from "../../src/services/CliHardSwitchService";
import { ASSET_SPACE_CLASS_UID } from "../../src/services/CliFocusProfileResolver";

describe("toHttpsGitHubUrl", () => {
  it("passes through canonical HTTPS form", () => {
    expect(toHttpsGitHubUrl("https://github.com/kitelev/exoas-exo")).toBe(
      "https://github.com/kitelev/exoas-exo",
    );
  });

  it("normalises SSH scp-like form to HTTPS", () => {
    expect(toHttpsGitHubUrl("git@github.com:kitelev/exoas-testlib.git")).toBe(
      "https://github.com/kitelev/exoas-testlib",
    );
  });

  it("strips a .git suffix", () => {
    expect(toHttpsGitHubUrl("https://github.com/kitelev/exoas-ems.git")).toBe(
      "https://github.com/kitelev/exoas-ems",
    );
  });

  it("returns the input unchanged when un-parseable", () => {
    expect(toHttpsGitHubUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("CliHardSwitchService.scanVault", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "exo-cli-hs-scan-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("scans a namespace-less registry descriptor (label falls back to folder segment)", () => {
    const uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const dir = path.join(root, "assetspaces", "_registry");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${uid}.md`),
      `---\n` +
        `exo__Asset_uid: ${uid}\n` +
        `exo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\n` +
        `exo__AssetSpace_source: "https://github.com/kitelev/exoas-testlib"\n` +
        `---\n`,
    );
    const svc = new CliHardSwitchService({ vaultPath: root });
    const { infos } = svc.scanVault();
    expect(infos).toHaveLength(1);
    expect(infos[0].uid).toBe(uid);
    // derivePath(_source) drives the mount folder, NOT the descriptor location.
    expect(infos[0].folderName).toBe("assetspaces/kitelev/exoas-testlib");
    // namespace absent → label falls back to last folder segment.
    expect(infos[0].label).toBe("exoas-testlib");
  });

  it("ignores descriptors without a git source", () => {
    const uid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const dir = path.join(root, "assetspaces", "_registry");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${uid}.md`),
      `---\nexo__Asset_uid: ${uid}\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\n---\n`,
    );
    const svc = new CliHardSwitchService({ vaultPath: root });
    expect(svc.scanVault().infos).toHaveLength(0);
  });
});
