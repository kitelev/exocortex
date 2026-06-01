/**
 * Unit tests for the shared `resolveProfileFilter` CLI helper
 * (RFC 0a0791c1 Issue #3323).
 *
 * Focus: outcome → return-shape contract + text-mode banner emission.
 * The underlying resolver is exercised via real fs in
 * `CliFocusProfileResolver.test.ts` — here we verify the presentation glue
 * is wired correctly across each outcome branch.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { resolveProfileFilter } from "../../../src/utils/resolveProfileFilter.js";
import {
  ASSET_SPACE_CLASS_UID,
  FOCUS_PROFILE_CLASS_UID,
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../../src/services/CliFocusProfileResolver.js";

const PROFILE_UID = "11111111-1111-1111-1111-111111111111";
const AS_EMS_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

async function makeMinimalVault(root: string, withProfile: boolean): Promise<void> {
  await fs.ensureDir(path.join(root, "assetspaces", "exo"));
  await fs.ensureDir(path.join(root, "assetspaces", "exocmd"));
  await fs.ensureDir(path.join(root, "assetspaces", "shared-identities"));
  await fs.ensureDir(path.join(root, "assetspaces", "ems"));
  await fs.ensureDir(path.join(root, "profiles"));

  const write = (rel: string, fm: Record<string, unknown>) => {
    const yamlLines = Object.entries(fm).map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map((x) => `  - "${String(x).replace(/"/g, '\\"')}"`).join("\n")}`;
      }
      if (typeof v === "string") {
        return `${k}: "${v.replace(/"/g, '\\"')}"`;
      }
      return `${k}: ${v}`;
    });
    return fs.writeFile(
      path.join(root, rel),
      `---\n${yamlLines.join("\n")}\n---\n`,
      "utf-8",
    );
  };

  await write(`assetspaces/exo/${TS_FLOOR_AS_UID_EXO}.md`, {
    "exo__Asset_uid": TS_FLOOR_AS_UID_EXO,
    "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
  });
  await write(`assetspaces/exocmd/${TS_FLOOR_AS_UID_EXOCMD}.md`, {
    "exo__Asset_uid": TS_FLOOR_AS_UID_EXOCMD,
    "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
  });
  await write(
    `assetspaces/shared-identities/${TS_FLOOR_AS_UID_SHARED_IDENTITIES}.md`,
    {
      "exo__Asset_uid": TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    },
  );
  await write(`assetspaces/ems/${AS_EMS_UID}.md`, {
    "exo__Asset_uid": AS_EMS_UID,
    "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
  });

  if (withProfile) {
    await write(`profiles/${PROFILE_UID}.md`, {
      "exo__Asset_uid": PROFILE_UID,
      "exo__Instance_class": [`[[${FOCUS_PROFILE_CLASS_UID}]]`],
      "exo__FocusProfile_includes": [`[[${AS_EMS_UID}]]`],
    });
  }
}

describe("resolveProfileFilter", () => {
  let tmpRoot: string;
  let logs: string[];
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "exocortex-cli-resolve-filter-test-"),
    );
    logs = [];
    originalLog = console.log;
    originalWarn = console.warn;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    console.warn = originalWarn;
    if (tmpRoot && (await fs.pathExists(tmpRoot))) {
      await fs.remove(tmpRoot);
    }
  });

  it("returns null when profileUid is undefined", async () => {
    await makeMinimalVault(tmpRoot, true);
    const result = await resolveProfileFilter({
      profileUid: undefined,
      primaryVaultPath: tmpRoot,
      outputFormat: "text",
    });
    expect(result).toBeNull();
    expect(logs).toEqual([]); // no banner when no profile
  });

  it("returns null when profileUid is empty string", async () => {
    await makeMinimalVault(tmpRoot, true);
    const result = await resolveProfileFilter({
      profileUid: "",
      primaryVaultPath: tmpRoot,
      outputFormat: "text",
    });
    expect(result).toBeNull();
  });

  it("returns filter and prints engagement banner in text mode", async () => {
    await makeMinimalVault(tmpRoot, true);
    const result = await resolveProfileFilter({
      profileUid: PROFILE_UID,
      primaryVaultPath: tmpRoot,
      outputFormat: "text",
    });
    expect(result).not.toBeNull();
    expect(result!.effective.has(AS_EMS_UID)).toBe(true);
    expect(result!.effective.has(TS_FLOOR_AS_UID_EXO)).toBe(true);
    expect(logs.some((l) => l.includes("engaged"))).toBe(true);
  });

  it("stays quiet in json mode even on engaged outcome", async () => {
    await makeMinimalVault(tmpRoot, true);
    const result = await resolveProfileFilter({
      profileUid: PROFILE_UID,
      primaryVaultPath: tmpRoot,
      outputFormat: "json",
    });
    expect(result).not.toBeNull();
    expect(logs).toEqual([]); // banner suppressed in json mode
  });

  it("returns null and prints missing-profile banner when UID is unknown", async () => {
    await makeMinimalVault(tmpRoot, false);
    const result = await resolveProfileFilter({
      profileUid: "definitely-not-here",
      primaryVaultPath: tmpRoot,
      outputFormat: "text",
    });
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("not found"))).toBe(true);
  });

  it("returns null and prints degraded banner when effective set has zero overlap", async () => {
    // Vault has no AssetSpaces — TS-floor is set but has no matching folders
    await fs.ensureDir(path.join(tmpRoot, "profiles"));
    await fs.writeFile(
      path.join(tmpRoot, "profiles", `${PROFILE_UID}.md`),
      `---\nexo__Asset_uid: "${PROFILE_UID}"\nexo__Instance_class:\n  - "[[${FOCUS_PROFILE_CLASS_UID}]]"\n---\n`,
      "utf-8",
    );
    const result = await resolveProfileFilter({
      profileUid: PROFILE_UID,
      primaryVaultPath: tmpRoot,
      outputFormat: "text",
    });
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes("zero AssetSpace folder overlap"))).toBe(true);
  });
});
