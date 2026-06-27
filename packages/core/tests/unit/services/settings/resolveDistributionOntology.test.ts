/**
 * @req:de812abe-4982-4813-abf4-c8c26d341de0
 *
 * Distribution-ontology meta-setting reader (RFC f402002b, M2.2 — §5):
 * resolve the recorded AssetSpace UID from a floor `setting__Setting`
 * meta-instance, null on absence / blank / key-mismatch, dual-read of the
 * canonical and legacy setting predicates. Fixtures are warm-metadataCache-shape
 * frontmatter objects (the same shape the plugin / CLI readers surface).
 */
import {
  EXOCORTEX_DISTRIBUTION_ONTOLOGY_KEY_UID,
  resolveDistributionOntology,
  type ImportableSettingAsset,
} from "../../../../src/services/settings";

const KEY_UID = EXOCORTEX_DISTRIBUTION_ONTOLOGY_KEY_UID;
const TARGET_AS_UID = "8dca2799-3c3c-4ea0-aa0a-c039c779417c";

/** A floor meta-setting asset (canonical predicates), value = target AssetSpace UID. */
function metaAsset(value: unknown, path = "exoas-exo/setting/meta.md"): ImportableSettingAsset {
  return {
    path,
    frontmatter: {
      "exo__Instance_class": "[[88b938af-... ]]",
      "setting__Setting_key": `[[${KEY_UID}]]`,
      "setting__Setting_value": value,
    },
  };
}

/** An unrelated setting asset (a different key). */
function otherAsset(): ImportableSettingAsset {
  return {
    path: "exoas-exo/setting/other.md",
    frontmatter: {
      "setting__Setting_key": "[[cccccccc-0000-0000-0000-000000000099]]",
      "setting__Setting_value": "not-the-target",
    },
  };
}

describe("resolveDistributionOntology", () => {
  it("returns the recorded AssetSpace UID from the matching floor meta-setting", () => {
    const assets = [otherAsset(), metaAsset(TARGET_AS_UID)];
    expect(resolveDistributionOntology(assets, KEY_UID)).toBe(TARGET_AS_UID);
  });

  it("returns null when no meta-setting for the key is present (caller picks)", () => {
    const assets = [otherAsset()];
    expect(resolveDistributionOntology(assets, KEY_UID)).toBeNull();
    expect(resolveDistributionOntology([], KEY_UID)).toBeNull();
  });

  it("returns null when the meta-setting's value is blank / whitespace-only", () => {
    expect(resolveDistributionOntology([metaAsset("")], KEY_UID)).toBeNull();
    expect(resolveDistributionOntology([metaAsset("   ")], KEY_UID)).toBeNull();
  });

  it("does not match an asset carrying a different setting key", () => {
    // otherAsset has a different key — must NOT be returned even though it has a value.
    expect(resolveDistributionOntology([otherAsset()], KEY_UID)).toBeNull();
  });

  it("trims surrounding whitespace from the recorded UID", () => {
    expect(resolveDistributionOntology([metaAsset(`  ${TARGET_AS_UID}  `)], KEY_UID)).toBe(
      TARGET_AS_UID,
    );
  });

  it("dual-reads a legacy-authored meta-setting (exo__Setting_key / exo__Setting_value)", () => {
    const legacy: ImportableSettingAsset = {
      path: "exoas-exo/setting/legacy.md",
      frontmatter: {
        "exo__Setting_key": `[[${KEY_UID}]]`,
        "exo__Setting_value": TARGET_AS_UID,
      },
    };
    expect(resolveDistributionOntology([legacy], KEY_UID)).toBe(TARGET_AS_UID);
  });

  it("returns the first non-blank match in array order", () => {
    const assets = [metaAsset("", "a.md"), metaAsset(TARGET_AS_UID, "b.md")];
    expect(resolveDistributionOntology(assets, KEY_UID)).toBe(TARGET_AS_UID);
  });
});
