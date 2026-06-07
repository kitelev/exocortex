import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  SDK_FLOOR_ASSETSPACE_UIDS,
  PLUGIN_UI_FLOOR_ASSETSPACE_UIDS,
  TsFloorViolationError,
  assertTsFloor,
} from "../../../src/domain/profile/TsFloorGuard";

describe("TsFloorGuard — floor tiers (RFC 01a83de8 §3.4 / EV8)", () => {
  describe("floor membership", () => {
    it("SDK floor = exo + shared-identities, NO exocmd", () => {
      expect(SDK_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXO)).toBe(true);
      expect(
        SDK_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_SHARED_IDENTITIES),
      ).toBe(true);
      // The core of issue #3426 — exocmd is NOT in the SDK floor.
      expect(SDK_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXOCMD)).toBe(false);
      expect(SDK_FLOOR_ASSETSPACE_UIDS.size).toBe(2);
    });

    it("plugin-UI floor = SDK floor + exocmd", () => {
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXO)).toBe(true);
      expect(
        PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_SHARED_IDENTITIES),
      ).toBe(true);
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXOCMD)).toBe(
        true,
      );
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.size).toBe(3);
    });

    it("plugin-UI floor is a strict superset of the SDK floor", () => {
      for (const uid of SDK_FLOOR_ASSETSPACE_UIDS) {
        expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(uid)).toBe(true);
      }
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.size).toBeGreaterThan(
        SDK_FLOOR_ASSETSPACE_UIDS.size,
      );
    });
  });

  describe("assertTsFloor — R24 guard", () => {
    it("passes when the declared set contains every SDK-floor UID", () => {
      const declared = new Set([
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ]);
      expect(() =>
        assertTsFloor(declared, SDK_FLOOR_ASSETSPACE_UIDS),
      ).not.toThrow();
    });

    it("CLI/headless: a vault WITHOUT exocmd passes the SDK floor (issue #3426)", () => {
      // The exact regression the issue targets — a profile omitting exocmd must
      // NOT be refused at the CLI/SDK level.
      const declaredNoExocmd = new Set([
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ]);
      expect(() =>
        assertTsFloor(declaredNoExocmd, SDK_FLOOR_ASSETSPACE_UIDS),
      ).not.toThrow();
    });

    it("plugin-UI: the same exocmd-less set is REFUSED against the plugin floor", () => {
      const declaredNoExocmd = new Set([
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ]);
      expect(() =>
        assertTsFloor(declaredNoExocmd, PLUGIN_UI_FLOOR_ASSETSPACE_UIDS),
      ).toThrow(TsFloorViolationError);
    });

    it("throws TsFloorViolationError naming the missing floor UID", () => {
      const declaredMissingExo = new Set([TS_FLOOR_AS_UID_SHARED_IDENTITIES]);
      expect(() =>
        assertTsFloor(declaredMissingExo, SDK_FLOOR_ASSETSPACE_UIDS),
      ).toThrow(/49fd2e56/);
      try {
        assertTsFloor(declaredMissingExo, SDK_FLOOR_ASSETSPACE_UIDS);
      } catch (e) {
        expect(e).toBeInstanceOf(TsFloorViolationError);
        expect((e as Error).name).toBe("TsFloorViolationError");
      }
    });

    it("plugin floor refuses a set missing exocmd, naming exocmd UID", () => {
      const declared = new Set([
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ]);
      expect(() =>
        assertTsFloor(declared, PLUGIN_UI_FLOOR_ASSETSPACE_UIDS),
      ).toThrow(/c9c65b0f/);
    });
  });
});
