/**
 * @req:948f50ab-9950-41e9-86d6-178e92191724
 *
 * Production-shape binding of the generic Settings Distribution engine to the
 * exocortex domain: ExocortexSettingsSource over the REAL VAULT_SETTINGS_REGISTRY
 * (24 keys). Asserts the allowlist-by-construction guarantee holds against the
 * real allowlist/denylist (no NON_HOMOICONIZABLE field is exportable) and that a
 * full round-trip restores the snapshot.
 */
import {
  exportSettings,
  importSettings,
  type ImportableSettingAsset,
} from "@kitelev/exocortex-core";
import { ExocortexSettingsSource } from "@plugin/infrastructure/adapters/ExocortexSettingsSource";
import {
  NON_HOMOICONIZABLE_FIELDS,
  VAULT_SETTINGS_REGISTRY,
} from "@plugin/domain/settings/VaultSettingsRegistry";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

function parseAsset(content: string, path: string): ImportableSettingAsset {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`no frontmatter in ${path}`);
  return { path, frontmatter: parseFrontmatterAsReader(content) as Record<string, unknown> };
}

describe("ExocortexSettingsSource (production-shape over the real registry)", () => {
  it("exports exactly the registry's declared keys — and NEVER a NON_HOMOICONIZABLE field (allowlist-by-construction)", () => {
    // The live keyspace carries every denylisted field too — they must remain
    // invisible to export.
    const live: Record<string, unknown> = {
      pat: "ghp_secret",
      logChannels: { info: { notice: false } },
      activeProfileUid: "deadbeef",
      settingsHomoiconizationEnabled: true,
    };
    for (const d of VAULT_SETTINGS_REGISTRY) live[d.field] = false;

    const source = new ExocortexSettingsSource({
      getSettings: () => live,
      applyLive: async () => {
        /* not used by export */
      },
    });
    const assets = exportSettings(source, {
      ontologyUid: "ont-uid",
      nowIso: "2026-06-28T00:00:00",
    });

    // One asset per registry key, nothing more.
    expect(assets).toHaveLength(VAULT_SETTINGS_REGISTRY.length);
    expect(new Set(assets.map((a) => a.field))).toEqual(
      new Set(VAULT_SETTINGS_REGISTRY.map((d) => d.field)),
    );
    // No denylisted field is the subject of any exported asset, and no secret
    // value leaks into any asset content.
    const exportedFields = new Set(assets.map((a) => a.field));
    for (const denied of NON_HOMOICONIZABLE_FIELDS) {
      expect(exportedFields.has(denied)).toBe(false);
    }
    for (const a of assets) {
      expect(a.content).not.toContain("ghp_secret");
    }
  });

  it("round-trips real settings: export → user changes everything → import restores the snapshot", async () => {
    const live: Record<string, unknown> = {};
    for (const d of VAULT_SETTINGS_REGISTRY) {
      live[d.field] =
        d.datatype === "boolean"
          ? true
          : d.datatype === "stringList"
            ? [`${d.field}/`]
            : `value-${d.field}`;
    }
    const snapshot = { ...live };

    const exportSource = new ExocortexSettingsSource({
      getSettings: () => live,
      applyLive: async () => undefined,
    });
    const exported = exportSettings(exportSource, {
      ontologyUid: "ont-uid",
      nowIso: "2026-06-28T00:00:00",
    });
    const assets = exported.map((a) => parseAsset(a.content, a.fileName));

    // User flips every value after export.
    for (const d of VAULT_SETTINGS_REGISTRY) {
      live[d.field] =
        d.datatype === "boolean"
          ? false
          : d.datatype === "stringList"
            ? []
            : "changed";
    }

    const importSource = new ExocortexSettingsSource({
      getSettings: () => live,
      applyLive: async (field, value) => {
        live[field] = value;
      },
    });
    const result = await importSettings(importSource, assets);

    expect(result.applied).toHaveLength(VAULT_SETTINGS_REGISTRY.length);
    expect(result.skipped).toHaveLength(0);
    for (const d of VAULT_SETTINGS_REGISTRY) {
      expect(live[d.field]).toEqual(snapshot[d.field]);
    }
  });
});
