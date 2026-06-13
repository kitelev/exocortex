import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  SDK_FLOOR_ASSETSPACE_UIDS,
  PLUGIN_UI_FLOOR_ASSETSPACE_UIDS,
  SDK_FLOOR,
  PLUGIN_UI_FLOOR,
  TsFloorViolationError,
  assertTsFloor,
  assertTsFloorReconciled,
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

  // ── Reconciled floor (issue #3511, EKA Alpha central registry) ──
  // The EKA registry mints a DISTINCT descriptor UID for the same $exo
  // AssetSpace (git-url + namespace stable). assertTsFloorReconciled accepts
  // either the legacy UID OR the namespace as satisfying the floor.
  const EKA_EXO_UID = "e5c47526-e72f-42e3-8535-3d243dd2db94"; // EKA exoas-exo, namespace "exo"

  describe("SDK_FLOOR / PLUGIN_UI_FLOOR reconcilable identities", () => {
    it("SDK_FLOOR = [{exo}] anchored by legacy UID + namespace", () => {
      expect(SDK_FLOOR).toHaveLength(1);
      expect(SDK_FLOOR[0]).toEqual({ uid: TS_FLOOR_AS_UID_EXO, namespace: "exo" });
    });

    it("PLUGIN_UI_FLOOR equals SDK_FLOOR (both [{exo}])", () => {
      expect(PLUGIN_UI_FLOOR).toBe(SDK_FLOOR);
    });
  });

  describe("assertTsFloorReconciled — UID OR namespace satisfies the floor", () => {
    it("legacy vault: declared set contains the floor UID (no namespace) → passes", () => {
      // Pre-EKA self-describing vault — the floor descriptor's UID is declared.
      const declaredAsUids = new Set([TS_FLOOR_AS_UID_EXO, EMS]);
      const declaredNamespaces = new Set<string>(); // legacy fixtures omit namespace
      expect(() =>
        assertTsFloorReconciled(declaredAsUids, declaredNamespaces, SDK_FLOOR),
      ).not.toThrow();
    });

    it("EKA vault: declared set has a DIFFERENT UID but namespace 'exo' → passes", () => {
      // Central-registry descriptor — UID differs from the legacy floor UID, but
      // its namespace is "exo", so the floor is satisfied.
      const declaredAsUids = new Set([EKA_EXO_UID]);
      const declaredNamespaces = new Set(["exo"]);
      expect(() =>
        assertTsFloorReconciled(declaredAsUids, declaredNamespaces, SDK_FLOOR),
      ).not.toThrow();
    });

    it("neither floor UID nor floor namespace declared → refuses, naming exo", () => {
      const declaredAsUids = new Set([EMS]);
      const declaredNamespaces = new Set(["ems"]);
      expect(() =>
        assertTsFloorReconciled(declaredAsUids, declaredNamespaces, SDK_FLOOR),
      ).toThrow(/exo \(49fd2e56/);
      try {
        assertTsFloorReconciled(declaredAsUids, declaredNamespaces, PLUGIN_UI_FLOOR);
      } catch (e) {
        expect(e).toBeInstanceOf(TsFloorViolationError);
      }
    });
  });
});
