import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

const GITHUB_REPO = "kitelev/exocortex";
const GITHUB_API = "https://api.github.com";

const isMainBranch = () => {
  try {
    const branch = execSync("git branch --show-current", {
      encoding: "utf-8",
    }).trim();
    return branch === "main";
  } catch {
    return false;
  }
};

function githubApiRequest(endpoint: string): any {
  const response = execSync(
    `curl -s -H "Accept: application/vnd.github.v3+json" ${GITHUB_API}${endpoint}`,
    { encoding: "utf-8" },
  );
  return JSON.parse(response);
}

function downloadReleaseAsset(tagName: string, assetName: string): string {
  return execSync(
    `curl -sL -H "Accept: application/octet-stream" https://github.com/${GITHUB_REPO}/releases/download/${tagName}/${assetName}`,
    { encoding: "utf-8" },
  );
}

function getLatestReleaseWithAssets(): any {
  const releases = githubApiRequest(
    `/repos/${GITHUB_REPO}/releases?per_page=20`,
  );
  const releaseWithAssets = releases.find(
    (r: any) => !r.draft && !r.prerelease && r.assets && r.assets.length > 0,
  );

  if (!releaseWithAssets) {
    throw new Error(
      "No valid release with assets found in the last 20 releases",
    );
  }

  return releaseWithAssets;
}

test.describe("BRAT Installation Compatibility", () => {
  test("should have no draft releases that could confuse BRAT", async ({}, testInfo) => {
    test.skip(!isMainBranch(), "Skipping BRAT tests on non-main branches");

    const releases = githubApiRequest(
      `/repos/${GITHUB_REPO}/releases?per_page=100`,
    );
    const draftReleases = releases.filter((r: any) => r.draft === true);

    expect(draftReleases).toHaveLength(0);
  });

  test("should have latest release with correct version in manifest.json", async () => {
    test.skip(!isMainBranch(), "Skipping BRAT tests on non-main branches");

    const latestRelease = getLatestReleaseWithAssets();

    expect(latestRelease.draft).toBe(false);
    expect(latestRelease.prerelease).toBe(false);

    const manifestContent = downloadReleaseAsset(
      latestRelease.tag_name,
      "manifest.json",
    );
    const manifest = JSON.parse(manifestContent);
    const expectedVersion = latestRelease.tag_name.replace(/^v/, "");

    expect(manifest.version).toBe(expectedVersion);
    expect(manifest.version).not.toBe("0.0.0-dev");
    expect(manifest.id).toBe("exocortex");
    expect(manifest.name).toBe("Exocortex");
  });

  test("should have all required release assets for BRAT installation", async () => {
    test.skip(!isMainBranch(), "Skipping BRAT tests on non-main branches");

    const latestRelease = getLatestReleaseWithAssets();

    const assetNames = latestRelease.assets.map((a: any) => a.name);

    expect(assetNames).toContain("main.js");
    expect(assetNames).toContain("manifest.json");
    expect(assetNames).toContain("styles.css");
  });

  test("should have manifest.json with minAppVersion for compatibility", async () => {
    test.skip(!isMainBranch(), "Skipping BRAT tests on non-main branches");

    const latestRelease = getLatestReleaseWithAssets();

    const manifestContent = downloadReleaseAsset(
      latestRelease.tag_name,
      "manifest.json",
    );
    const manifest = JSON.parse(manifestContent);

    expect(manifest.minAppVersion).toBeDefined();
    expect(manifest.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("should have consistent version across manifest.json and git tag", async () => {
    test.skip(!isMainBranch(), "Skipping BRAT tests on non-main branches");

    const latestRelease = getLatestReleaseWithAssets();

    const gitTagVersion = latestRelease.tag_name.replace(/^v/, "");

    const manifestContent = downloadReleaseAsset(
      latestRelease.tag_name,
      "manifest.json",
    );
    const manifest = JSON.parse(manifestContent);

    expect(manifest.version).toBe(gitTagVersion);
  });

  test("should have main.js file in latest release", async () => {
    test.skip(!isMainBranch(), "Skipping BRAT tests on non-main branches");

    const latestRelease = getLatestReleaseWithAssets();

    const mainJsContent = downloadReleaseAsset(
      latestRelease.tag_name,
      "main.js",
    );
    const sizeInBytes = Buffer.byteLength(mainJsContent, "utf-8");

    expect(sizeInBytes).toBeGreaterThan(1000);
  });
});
