/**
 * Unit tests for `CliProfileResolver` (RFC 0a0791c1 Issue #3323).
 *
 * Uses an on-disk temp vault for each test — exercises the real file walk,
 * yaml parse, and translation chain that production CLI hits. Faster and
 * more realistic than mocking `fs-extra` (the adapter surface area is large
 * and stubs would diverge from real semantics, the exact failure mode
 * `test-fixture-realism.md` warns against).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  CliProfileResolver,
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  ASSET_SPACE_CLASS_UID,
  PROFILE_CLASS_UID,
  parseWikilinkArray,
  extractUidFromWikilink,
} from "../../../src/services/CliProfileResolver.js";

/** Fixed UIDs the fixtures reuse — readable in test names. */
const PROFILE_PERSONAL_UID = "11111111-1111-1111-1111-111111111111";
const PROFILE_WORK_UID = "22222222-2222-2222-2222-222222222222";
const PROFILE_BASE_UID = "33333333-3333-3333-3333-333333333333";
const PROFILE_CYCLE_A_UID = "44444444-4444-4444-4444-444444444444";
const PROFILE_CYCLE_B_UID = "55555555-5555-5555-5555-555555555555";

const AS_EXO_UID = TS_FLOOR_AS_UID_EXO;
const AS_EXOCMD_UID = TS_FLOOR_AS_UID_EXOCMD;
const AS_SHARED_UID = TS_FLOOR_AS_UID_SHARED_IDENTITIES;
const AS_EMS_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AS_KITELEV_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// A UID that matches no AssetSpace folder — used to exercise the `untranslated`
// diagnostic path.
const ONTOLOGY_KITELEV_UID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

interface AssetSpec {
  /** Path relative to vault root (e.g. `assetspaces/ems/<uid>.md`). */
  relPath: string;
  frontmatter: Record<string, unknown>;
}

async function makeVault(vaultRoot: string, assets: AssetSpec[]): Promise<void> {
  await fs.ensureDir(vaultRoot);
  for (const asset of assets) {
    const full = path.join(vaultRoot, asset.relPath);
    await fs.ensureDir(path.dirname(full));
    const yamlLines = Object.entries(asset.frontmatter).map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map((x) => `  - "${String(x).replace(/"/g, '\\"')}"`).join("\n")}`;
      }
      if (typeof v === "string") {
        return `${k}: "${v.replace(/"/g, '\\"')}"`;
      }
      return `${k}: ${v}`;
    });
    const body = `---\n${yamlLines.join("\n")}\n---\n\n# ${asset.frontmatter["exo__Asset_uid"] ?? ""}\n`;
    await fs.writeFile(full, body, "utf-8");
  }
}

function asAssetSpace(uid: string, folder: string): AssetSpec {
  return {
    relPath: `assetspaces/${folder}/${uid}.md`,
    frontmatter: {
      "exo__Asset_uid": uid,
      "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
    },
  };
}

function asProfile(
  uid: string,
  opts: {
    label?: string;
    includes?: string[];
    extends_?: string;
  } = {},
): AssetSpec {
  const fm: Record<string, unknown> = {
    "exo__Asset_uid": uid,
    "exo__Instance_class": [`[[${PROFILE_CLASS_UID}|exo__Profile]]`],
  };
  if (opts.label !== undefined) fm["exo__Asset_label"] = opts.label;
  // RFC 01a83de8 Phase 2 — _includes now AssetSpace UIDs; _extends → _imports.
  if (opts.includes !== undefined) {
    fm["exo__Profile_includes"] = opts.includes.map((u) => `[[${u}]]`);
  }
  if (opts.extends_ !== undefined) {
    fm["exo__Profile_imports"] = [`[[${opts.extends_}]]`];
  }
  return {
    relPath: `profiles/${uid}.md`,
    frontmatter: fm,
  };
}

describe("CliProfileResolver", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "exocortex-cli-profile-test-"),
    );
  });

  afterEach(async () => {
    if (tmpRoot && (await fs.pathExists(tmpRoot))) {
      await fs.remove(tmpRoot);
    }
  });

  describe("resolveFilter — outcome shapes", () => {
    it("returns no-profile when profileUid is null", async () => {
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(null);
      expect(out.outcome).toBe("no-profile");
    });

    it("returns no-profile when profileUid is undefined", async () => {
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(undefined);
      expect(out.outcome).toBe("no-profile");
    });

    it("returns no-profile when profileUid is empty string", async () => {
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter("");
      expect(out.outcome).toBe("no-profile");
    });

    it("returns missing-profile when UID is not found in vault", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter("nonexistent-uid");
      expect(out.outcome).toBe("missing-profile");
      if (out.outcome === "missing-profile") {
        expect(out.profileUid).toBe("nonexistent-uid");
      }
    });
  });

  describe("resolveFilter — engaged paths", () => {
    it("engages with the SDK-floor {exo} only when profile has empty includes (floor={exo}: no shared-identities, no exocmd)", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asProfile(PROFILE_BASE_UID, { label: "base" }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_BASE_UID);
      expect(out.outcome).toBe("engaged");
      if (out.outcome === "engaged") {
        expect(out.result.effective.has(AS_EXO_UID)).toBe(true);
        // floor={exo}: shared-identities + exocmd are present as vault folders
        // but NOT force-injected into the effective set (no longer floor).
        expect(out.result.effective.has(AS_SHARED_UID)).toBe(false);
        expect(out.result.effective.has(AS_EXOCMD_UID)).toBe(false);
        expect(out.result.effective.size).toBe(1); // SDK floor = {exo}
      }
    });

    it("resolves declared AS UIDs against the folder map (RFC 01a83de8 Phase 2)", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asAssetSpace(AS_EMS_UID, "ems"),
        asProfile(PROFILE_PERSONAL_UID, {
          // `_includes` declares the AssetSpace UID directly. The former
          // Ontology→AS translation (via containsOntology) was removed in
          // Phase 3 T3b-cleanup.
          includes: [AS_EMS_UID],
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
      expect(out.outcome).toBe("engaged");
      if (out.outcome === "engaged") {
        // Declared AS UID resolved directly against the folder map.
        expect(out.result.effective.has(AS_EMS_UID)).toBe(true);
        // SDK-floor {exo} present; shared-identities + exocmd NOT auto-injected
        // (floor={exo}).
        expect(out.result.effective.has(AS_EXO_UID)).toBe(true);
        expect(out.result.effective.has(AS_SHARED_UID)).toBe(false);
        expect(out.result.effective.has(AS_EXOCMD_UID)).toBe(false);
        // declared set surfaced for diagnostics
        expect(out.result.declaredOntologies.has(AS_EMS_UID)).toBe(true);
        // No untranslated entries
        expect(out.result.untranslated.length).toBe(0);
      }
    });

    it("passes through declared UIDs that are already AS UIDs (future-proof: profile may declare AS directly)", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asAssetSpace(AS_EMS_UID, "ems"), // No containsOntology declared
        asProfile(PROFILE_PERSONAL_UID, {
          includes: [AS_EMS_UID], // Profile points directly at AS UID
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
      expect(out.outcome).toBe("engaged");
      if (out.outcome === "engaged") {
        expect(out.result.effective.has(AS_EMS_UID)).toBe(true);
      }
    });

    it("records untranslated UIDs when a declared UID matches no AssetSpace folder", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asAssetSpace(AS_EMS_UID, "ems"),
        asProfile(PROFILE_PERSONAL_UID, {
          // AS_EMS resolves to a folder; ONTOLOGY_KITELEV matches no AssetSpace.
          includes: [AS_EMS_UID, ONTOLOGY_KITELEV_UID],
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
      expect(out.outcome).toBe("engaged");
      if (out.outcome === "engaged") {
        expect(out.result.untranslated).toContain(ONTOLOGY_KITELEV_UID);
        expect(out.result.untranslated).not.toContain(AS_EMS_UID);
        expect(out.result.effective.has(AS_EMS_UID)).toBe(true);
      }
    });

    it("walks _imports chain recursively, merging parent + child includes", async () => {
      // RFC 01a83de8 Phase 2 — base provides kitelev via _includes (was overlay);
      // child inherits it through the _imports chain.
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asAssetSpace(AS_EMS_UID, "ems"),
        asAssetSpace(AS_KITELEV_UID, "kitelev"),
        asProfile(PROFILE_BASE_UID, {
          includes: [AS_KITELEV_UID], // base library AssetSpace
        }),
        asProfile(PROFILE_PERSONAL_UID, {
          includes: [AS_EMS_UID],
          extends_: PROFILE_BASE_UID,
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
      expect(out.outcome).toBe("engaged");
      if (out.outcome === "engaged") {
        expect(out.result.effective.has(AS_EMS_UID)).toBe(true); // child includes
        expect(out.result.effective.has(AS_KITELEV_UID)).toBe(true); // parent includes
        expect(out.result.declaredOntologies.has(AS_KITELEV_UID)).toBe(true);
      }
    });

    it("includes leaf-profile _includes directly in the effective set", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asAssetSpace(AS_KITELEV_UID, "kitelev"),
        asProfile(PROFILE_PERSONAL_UID, {
          includes: [AS_KITELEV_UID],
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
      expect(out.outcome).toBe("engaged");
      if (out.outcome === "engaged") {
        expect(out.result.effective.has(AS_KITELEV_UID)).toBe(true);
      }
    });
  });

  describe("resolveFilter — cycle and depth guards", () => {
    it("tolerates cycles via visited-set guard", async () => {
      // A → B → A — must not infinite-loop, must complete
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asProfile(PROFILE_CYCLE_A_UID, {
          extends_: PROFILE_CYCLE_B_UID,
        }),
        asProfile(PROFILE_CYCLE_B_UID, {
          extends_: PROFILE_CYCLE_A_UID,
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_CYCLE_A_UID);
      // Either engaged with TS-floor only, or degraded — but must NOT hang and
      // must NOT throw.
      expect(["engaged", "degraded"]).toContain(out.outcome);
    });

    it("throws on chain longer than maxExtendsDepth — surfaced via error outcome", async () => {
      // Build a 7-deep chain (max default is 5)
      const chain: string[] = [];
      for (let i = 0; i < 7; i++) {
        chain.push(`9${i}9${i}9${i}9${i}-9${i}9${i}-9${i}9${i}-9${i}9${i}-9${i}9${i}9${i}9${i}9${i}9${i}`);
      }
      const assets: AssetSpec[] = [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
      ];
      for (let i = 0; i < chain.length; i++) {
        assets.push(
          asProfile(chain[i], {
            extends_: i < chain.length - 1 ? chain[i + 1] : undefined,
          }),
        );
      }
      await makeVault(tmpRoot, assets);
      const resolver = new CliProfileResolver({
        vaultPath: tmpRoot,
        maxExtendsDepth: 5,
      });
      const out = await resolver.resolveFilter(chain[0]);
      expect(out.outcome).toBe("error");
      if (out.outcome === "error") {
        expect(out.reason).toMatch(/max depth/i);
      }
    });
  });

  describe("resolveFilter — degraded path", () => {
    it("returns degraded when effective set has zero AS-folder overlap (R15 self-brick mitigation)", async () => {
      // No AssetSpace files exist at all in this vault, but a profile does
      await makeVault(tmpRoot, [
        asProfile(PROFILE_PERSONAL_UID, {
          includes: ["some-random-ontology-uid"],
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
      expect(out.outcome).toBe("degraded");
      if (out.outcome === "degraded") {
        expect(out.reason).toMatch(/zero AssetSpace folder overlap/i);
      }
    });
  });

  describe("resolveFilter — folderMap construction", () => {
    it("builds folderMap with correct vault-relative folder keys", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asAssetSpace(AS_EMS_UID, "ems"),
        asProfile(PROFILE_PERSONAL_UID, {
          includes: [AS_EMS_UID],
        }),
      ]);
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
      expect(out.outcome).toBe("engaged");
      if (out.outcome === "engaged") {
        expect(out.result.folderMap.get("assetspaces/exo")).toBe(AS_EXO_UID);
        expect(out.result.folderMap.get("assetspaces/ems")).toBe(AS_EMS_UID);
        expect(out.result.folderMap.get("assetspaces/exocmd")).toBe(
          AS_EXOCMD_UID,
        );
        expect(out.result.folderMap.get("assetspaces/shared-identities")).toBe(
          AS_SHARED_UID,
        );
      }
    });
  });

  describe("resolveFilter — multi-vault (--also)", () => {
    it("scans primary + alsoVaultPaths to build folderMap and find profiles", async () => {
      const secondaryRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "exocortex-cli-profile-secondary-"),
      );
      try {
        await makeVault(tmpRoot, [
          asAssetSpace(AS_EXO_UID, "exo"),
          asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        ]);
        await makeVault(secondaryRoot, [
          asAssetSpace(AS_SHARED_UID, "shared-identities"),
          asAssetSpace(AS_EMS_UID, "ems"),
          asProfile(PROFILE_PERSONAL_UID, {
            includes: [AS_EMS_UID],
          }),
        ]);
        const resolver = new CliProfileResolver({
          vaultPath: tmpRoot,
          alsoVaultPaths: [secondaryRoot],
        });
        const out = await resolver.resolveFilter(PROFILE_PERSONAL_UID);
        expect(out.outcome).toBe("engaged");
        if (out.outcome === "engaged") {
          expect(out.result.effective.has(AS_EMS_UID)).toBe(true);
          expect(out.result.folderMap.size).toBeGreaterThanOrEqual(4);
        }
      } finally {
        await fs.remove(secondaryRoot);
      }
    });

    it("tolerates non-existent --also vault paths with warn", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asProfile(PROFILE_BASE_UID),
      ]);
      const warnings: string[] = [];
      const resolver = new CliProfileResolver({
        vaultPath: tmpRoot,
        alsoVaultPaths: ["/tmp/this-path-definitely-does-not-exist-test"],
        warn: (m) => warnings.push(m),
      });
      const out = await resolver.resolveFilter(PROFILE_BASE_UID);
      expect(out.outcome).toBe("engaged");
      expect(warnings.some((w) => w.includes("does not exist"))).toBe(true);
    });
  });

  describe("malformed input tolerance", () => {
    it("skips files without frontmatter without throwing", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asProfile(PROFILE_BASE_UID),
      ]);
      // Drop a plain markdown file (no frontmatter)
      await fs.ensureDir(path.join(tmpRoot, "03 Knowledge"));
      await fs.writeFile(
        path.join(tmpRoot, "03 Knowledge", "scratch.md"),
        "# scratch\n\nnothing structured here\n",
        "utf-8",
      );
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_BASE_UID);
      expect(out.outcome).toBe("engaged");
    });

    it("skips files with broken yaml without throwing", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asProfile(PROFILE_BASE_UID),
      ]);
      // Drop a file with malformed YAML frontmatter
      await fs.ensureDir(path.join(tmpRoot, "junk"));
      await fs.writeFile(
        path.join(tmpRoot, "junk", "broken.md"),
        "---\nthis is: \"not: valid:\n  yaml here\n---\n",
        "utf-8",
      );
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(PROFILE_BASE_UID);
      expect(out.outcome).toBe("engaged");
    });

    it("skips hidden directories (.obsidian, .exocortex, .git)", async () => {
      await makeVault(tmpRoot, [
        asAssetSpace(AS_EXO_UID, "exo"),
        asAssetSpace(AS_EXOCMD_UID, "exocmd"),
        asAssetSpace(AS_SHARED_UID, "shared-identities"),
        asProfile(PROFILE_BASE_UID),
      ]);
      // Add a profile-shaped file inside .obsidian — it must NOT be discovered
      const stowawayUid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      await fs.ensureDir(path.join(tmpRoot, ".obsidian"));
      await fs.writeFile(
        path.join(tmpRoot, ".obsidian", `${stowawayUid}.md`),
        `---\nexo__Asset_uid: "${stowawayUid}"\nexo__Instance_class:\n  - "[[${PROFILE_CLASS_UID}|exo__Profile]]"\n---\n`,
        "utf-8",
      );
      const resolver = new CliProfileResolver({ vaultPath: tmpRoot });
      const out = await resolver.resolveFilter(stowawayUid);
      expect(out.outcome).toBe("missing-profile");
    });
  });
});

describe("parseWikilinkArray", () => {
  it("returns [] for null/undefined/empty inputs", () => {
    expect(parseWikilinkArray(null)).toEqual([]);
    expect(parseWikilinkArray(undefined)).toEqual([]);
    expect(parseWikilinkArray([])).toEqual([]);
  });

  it("wraps a single string into an array", () => {
    expect(parseWikilinkArray("[[abc]]")).toEqual(["abc"]);
  });

  it("strips wikilink brackets and aliases", () => {
    expect(
      parseWikilinkArray(["[[uid-1|alias]]", "[[uid-2]]", "raw-uid"]),
    ).toEqual(["uid-1", "uid-2", "raw-uid"]);
  });

  it("drops non-string entries", () => {
    expect(parseWikilinkArray(["[[ok]]", 42, null, undefined, "[[also-ok]]"])).toEqual([
      "ok",
      "also-ok",
    ]);
  });

  it("drops empty entries after trimming", () => {
    expect(parseWikilinkArray(["[[]]", "  ", "[[real]]"])).toEqual(["real"]);
  });
});

describe("extractUidFromWikilink", () => {
  it("returns null for empty string after stripping", () => {
    expect(extractUidFromWikilink("[[]]")).toBeNull();
    expect(extractUidFromWikilink("  ")).toBeNull();
    expect(extractUidFromWikilink("|")).toBeNull();
  });

  it("strips alias", () => {
    expect(extractUidFromWikilink("[[uid|alias]]")).toBe("uid");
  });

  it("returns trimmed inner string when not wrapped in brackets", () => {
    expect(extractUidFromWikilink(" raw-uid ")).toBe("raw-uid");
  });
});
