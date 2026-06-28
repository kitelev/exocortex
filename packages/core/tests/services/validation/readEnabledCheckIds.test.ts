import {
  readEnabledCheckIds,
  CHECK_ID_UID_UNIQUENESS,
  CHECK_ID_SHACL,
  type VaultAssetRecord,
} from "../../../src/index";

function asset(fm: Record<string, unknown>): VaultAssetRecord {
  return { path: "x.md", frontmatter: fm };
}

describe("readEnabledCheckIds (RFC f402002b — shared enabled-set reader)", () => {
  it("returns the check-ids whose setting__Setting_value is truthy (true or \"true\")", () => {
    const enabled = readEnabledCheckIds([
      asset({ setting__Setting_key: `[[${CHECK_ID_UID_UNIQUENESS}]]`, setting__Setting_value: true }),
      asset({ setting__Setting_key: `[[${CHECK_ID_SHACL}]]`, setting__Setting_value: "true" }),
    ]);
    expect(enabled.sort()).toEqual([CHECK_ID_UID_UNIQUENESS, CHECK_ID_SHACL].sort());
  });

  it("excludes settings whose value is falsy", () => {
    const enabled = readEnabledCheckIds([
      asset({ setting__Setting_key: `[[${CHECK_ID_UID_UNIQUENESS}]]`, setting__Setting_value: false }),
      asset({ setting__Setting_key: `[[${CHECK_ID_SHACL}]]`, setting__Setting_value: "no" }),
    ]);
    expect(enabled).toEqual([]);
  });

  it("ignores unknown check-ids and assets with no setting__Setting_key (no leakage)", () => {
    const enabled = readEnabledCheckIds([
      asset({ setting__Setting_key: "[[not-a-check-id]]", setting__Setting_value: true }),
      asset({ exo__Asset_label: "unrelated asset" }),
      asset({ setting__Setting_key: `[[${CHECK_ID_UID_UNIQUENESS}]]`, setting__Setting_value: true }),
    ]);
    expect(enabled).toEqual([CHECK_ID_UID_UNIQUENESS]);
  });

  it("de-duplicates a check-id enabled by more than one setting", () => {
    const enabled = readEnabledCheckIds([
      asset({ setting__Setting_key: `[[${CHECK_ID_UID_UNIQUENESS}]]`, setting__Setting_value: true }),
      asset({ setting__Setting_key: `[[${CHECK_ID_UID_UNIQUENESS}]]`, setting__Setting_value: true }),
    ]);
    expect(enabled).toEqual([CHECK_ID_UID_UNIQUENESS]);
  });

  it("returns an empty set for an empty vault", () => {
    expect(readEnabledCheckIds([])).toEqual([]);
  });
});
