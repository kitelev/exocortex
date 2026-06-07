import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  SDK_FLOOR_ASSETSPACE_UIDS,
  PLUGIN_UI_FLOOR_ASSETSPACE_UIDS,
  TsFloorViolationError,
  assertTsFloor,
} from "../../../src/domain/profile/TsFloorGuard";

// floor={exo} (RFC 5aa2a73a): shared-identities + exocmd removed from the floor.
// exocmd is an OPTIONAL UI-command library (read-only/SPARQL-only vault works
// without it); cross-cutting TBox relocated to home ontologies, so
// shared-identities is no longer load-bearing for the floor.
const EMS = "f0f674da-a31b-47e1-b0e8-f984b018bf75"; // any non-floor AssetSpace

describe("TsFloorGuard — floor = {exo}", () => {
  describe("floor membership", () => {
    it("SDK floor = {exo} only (no shared-identities, no exocmd)", () => {
      expect(SDK_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXO)).toBe(true);
      expect(
        SDK_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_SHARED_IDENTITIES),
      ).toBe(false);
      expect(SDK_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXOCMD)).toBe(false);
      expect(SDK_FLOOR_ASSETSPACE_UIDS.size).toBe(1);
    });

    it("plugin-UI floor = {exo} only (exocmd is optional)", () => {
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXO)).toBe(true);
      expect(
        PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_SHARED_IDENTITIES),
      ).toBe(false);
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(TS_FLOOR_AS_UID_EXOCMD)).toBe(
        false,
      );
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.size).toBe(1);
    });

    it("plugin-UI floor equals the SDK floor (both = {exo})", () => {
      expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.size).toBe(
        SDK_FLOOR_ASSETSPACE_UIDS.size,
      );
      for (const uid of SDK_FLOOR_ASSETSPACE_UIDS) {
        expect(PLUGIN_UI_FLOOR_ASSETSPACE_UIDS.has(uid)).toBe(true);
      }
    });
  });

  describe("assertTsFloor — R24 guard", () => {
    it("minimal starter profile [exo, ems] passes both floors (no shared-identities, no exocmd)", () => {
      const declared = new Set([TS_FLOOR_AS_UID_EXO, EMS]);
      expect(() =>
        assertTsFloor(declared, SDK_FLOOR_ASSETSPACE_UIDS),
      ).not.toThrow();
      expect(() =>
        assertTsFloor(declared, PLUGIN_UI_FLOOR_ASSETSPACE_UIDS),
      ).not.toThrow();
    });

    it("read-only profile [exo] alone passes (SPARQL-only vault, no UI commands)", () => {
      const declared = new Set([TS_FLOOR_AS_UID_EXO]);
      expect(() =>
        assertTsFloor(declared, PLUGIN_UI_FLOOR_ASSETSPACE_UIDS),
      ).not.toThrow();
    });

    it("a vault WITHOUT exocmd is NOT refused (exocmd is optional)", () => {
      const declaredNoExocmd = new Set([TS_FLOOR_AS_UID_EXO, EMS]);
      expect(() =>
        assertTsFloor(declaredNoExocmd, PLUGIN_UI_FLOOR_ASSETSPACE_UIDS),
      ).not.toThrow();
    });

    it("exo is still mandatory — a profile omitting exo is refused, naming the exo UID", () => {
      const declaredMissingExo = new Set([EMS]);
      expect(() =>
        assertTsFloor(declaredMissingExo, SDK_FLOOR_ASSETSPACE_UIDS),
      ).toThrow(/49fd2e56/);
      try {
        assertTsFloor(declaredMissingExo, PLUGIN_UI_FLOOR_ASSETSPACE_UIDS);
      } catch (e) {
        expect(e).toBeInstanceOf(TsFloorViolationError);
        expect((e as Error).name).toBe("TsFloorViolationError");
      }
    });
  });
});
