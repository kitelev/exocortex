/**
 * @req:948f50ab-9950-41e9-86d6-178e92191724
 *
 * Generic Settings Distribution engine (RFC f402002b, M2.1): export → mutate →
 * import round-trip + allowlist-by-construction + tolerant coercion. The engine
 * is exercised through its public contract; the round-trip renders real asset
 * markdown and re-parses it (production-shape: the import reads exactly what the
 * export wrote), not handcrafted frontmatter.
 */
import * as yaml from "js-yaml";
import {
  exportSettings,
  importSettings,
  type ImportableSettingAsset,
  type SettingKeySpec,
  type SettingsSource,
} from "../../../../src/services/settings";

const CLASS_UID = "11111111-1111-1111-1111-111111111111";
const ONTOLOGY_UID = "22222222-2222-2222-2222-222222222222";

const KEYS: SettingKeySpec[] = [
  {
    field: "flagA",
    keyUid: "aaaaaaaa-0000-0000-0000-000000000001",
    keyLabel: "domain__SettingKeyFlagA",
    datatype: "boolean",
    settingUid: "55555555-0000-0000-0000-000000000001",
  },
  {
    field: "name",
    keyUid: "bbbbbbbb-0000-0000-0000-000000000002",
    keyLabel: "domain__SettingKeyName",
    datatype: "string",
    settingUid: "55555555-0000-0000-0000-000000000002",
  },
  {
    field: "folders",
    keyUid: "cccccccc-0000-0000-0000-000000000003",
    keyLabel: "domain__SettingKeyFolders",
    datatype: "stringList",
    settingUid: "55555555-0000-0000-0000-000000000003",
  },
];

/** Fake source with mutable live values + an undeclared (secret) field. */
function makeSource(live: Record<string, unknown>): SettingsSource {
  return {
    settingClassUid: CLASS_UID,
    declaredKeys: () => KEYS,
    readLiveValue: (k) => live[k.field],
    writeLiveValue: async (k, v) => {
      live[k.field] = v;
    },
  };
}

/** Parse a rendered setting asset's frontmatter (mirrors a warm reader). */
function parseAsset(content: string, path: string): ImportableSettingAsset {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`no frontmatter in ${path}`);
  const frontmatter = yaml.load(m[1]) as Record<string, unknown>;
  return { path, frontmatter };
}

describe("SettingsDistributionEngine", () => {
  it("exports exactly one asset per declared key (allowlist-by-construction — undeclared 'secret' is never read/exported)", () => {
    const live = {
      flagA: true,
      name: "alice",
      folders: ["a/", "b/"],
      secret: "ghp_should_never_export", // undeclared — must be invisible to export
    };
    const assets = exportSettings(makeSource(live), {
      ontologyUid: ONTOLOGY_UID,
      nowIso: "2026-06-28T00:00:00",
    });

    // Exactly the 3 declared keys — nothing else, in declared order.
    expect(assets.map((a) => a.field)).toEqual(["flagA", "name", "folders"]);
    expect(assets.map((a) => a.fileName)).toEqual([
      "55555555-0000-0000-0000-000000000001.md",
      "55555555-0000-0000-0000-000000000002.md",
      "55555555-0000-0000-0000-000000000003.md",
    ]);
    // The undeclared secret never appears in any exported asset.
    for (const a of assets) {
      expect(a.content).not.toContain("ghp_should_never_export");
      expect(a.content).toContain('exo__Instance_class:\n  - "[[' + CLASS_UID);
      expect(a.content).toContain('exo__Asset_isDefinedBy: "[[' + ONTOLOGY_UID);
    }
  });

  it("round-trips: export → mutate live → import restores the exported snapshot", async () => {
    const live: Record<string, unknown> = {
      flagA: true,
      name: "alice",
      folders: ["docs/", "src/"],
    };
    const exported = exportSettings(makeSource(live), {
      ontologyUid: ONTOLOGY_UID,
      nowIso: "2026-06-28T00:00:00",
    });
    const assets = exported.map((a) => parseAsset(a.content, a.fileName));

    // User changes everything after the export.
    live.flagA = false;
    live.name = "bob";
    live.folders = ["changed/"];

    const result = await importSettings(makeSource(live), assets);

    expect([...result.applied].sort()).toEqual(["flagA", "folders", "name"]);
    expect(result.skipped).toHaveLength(0);
    expect(live.flagA).toBe(true);
    expect(live.name).toBe("alice");
    expect(live.folders).toEqual(["docs/", "src/"]);
  });

  it("import SKIPS an asset whose key is not in the allowlist (unknown-key) — its value is never written", async () => {
    const live: Record<string, unknown> = { flagA: false };
    const rogue: ImportableSettingAsset = {
      path: "rogue.md",
      frontmatter: {
        "exo__Instance_class": [`[[${CLASS_UID}]]`],
        "setting__Setting_key": "[[deadbeef-0000-0000-0000-000000000099]]", // undeclared
        "setting__Setting_value": true,
      },
    };
    const result = await importSettings(makeSource(live), [rogue]);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        path: "rogue.md",
        reason: "unknown-key",
        detail: "deadbeef-0000-0000-0000-000000000099",
      },
    ]);
    expect(live.flagA).toBe(false); // untouched
  });

  it("import matches by key LABEL too and reads the LEGACY exo__Setting_* predicates (dual-read)", async () => {
    const live: Record<string, unknown> = { name: "old" };
    const legacy: ImportableSettingAsset = {
      path: "legacy.md",
      frontmatter: {
        "exo__Instance_class": [`[[${CLASS_UID}]]`],
        "exo__Setting_key": "[[domain__SettingKeyName]]", // legacy predicate + label-form
        "exo__Setting_value": "from-legacy-asset",
      },
    };
    const result = await importSettings(makeSource(live), [legacy]);

    expect(result.applied).toEqual(["name"]);
    expect(live.name).toBe("from-legacy-asset");
  });

  it("import SKIPS a partial/non-string stringList (never silently wipes a live list); a legitimately empty [] round-trips", async () => {
    const live: Record<string, unknown> = { folders: ["keep/"] };
    const partial: ImportableSettingAsset = {
      path: "partial.md",
      frontmatter: {
        "setting__Setting_key": "[[cccccccc-0000-0000-0000-000000000003]]",
        "setting__Setting_value": ["ok/", 42], // one non-string element
      },
    };
    const r1 = await importSettings(makeSource(live), [partial]);
    expect(r1.applied).toHaveLength(0);
    expect(r1.skipped[0]).toMatchObject({ path: "partial.md", reason: "uncoercible" });
    expect(live.folders).toEqual(["keep/"]); // untouched — no silent wipe

    const empty: ImportableSettingAsset = {
      path: "empty.md",
      frontmatter: {
        "setting__Setting_key": "[[cccccccc-0000-0000-0000-000000000003]]",
        "setting__Setting_value": [],
      },
    };
    const r2 = await importSettings(makeSource(live), [empty]);
    expect(r2.applied).toEqual(["folders"]);
    expect(live.folders).toEqual([]); // explicit empty list applies
  });

  it("import SKIPS an uncoercible value (boolean key carrying a non-bool) — never writes a bad value", async () => {
    const live: Record<string, unknown> = { flagA: true };
    const bad: ImportableSettingAsset = {
      path: "bad.md",
      frontmatter: {
        "setting__Setting_key": "[[aaaaaaaa-0000-0000-0000-000000000001]]",
        "setting__Setting_value": "maybe", // not true/false
      },
    };
    const result = await importSettings(makeSource(live), [bad]);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({
      path: "bad.md",
      reason: "uncoercible",
    });
    expect(live.flagA).toBe(true); // untouched
  });
});
