/**
 * Unit tests — UniversalDefaultTemplateResolver (RFC 727572d2 Phase C).
 *
 * Covers:
 * - registerUniversalDefaultLoader / loadUniversalDefault lifecycle
 * - Loader returning null → cached null, no double-invoke
 * - Loader throwing → warn-once + null fallback
 * - mergePropertyDefaults: Grounding overrides Universal by propertyName
 * - mergeInheritanceRules: Grounding overrides Universal by targetPropertyName
 * - Order preservation: overridden entries stay in Universal position
 */

import type {
  InheritanceRuleResolved,
  PropertyDefaultResolved,
} from "../../../src/domain/models/CommandDefinition";
import {
  clearUniversalDefault,
  clearUniversalDefaultLoader,
  loadUniversalDefault,
  mergeInheritanceRules,
  mergePropertyDefaults,
  registerUniversalDefaultLoader,
} from "../../../src/services/UniversalDefaultTemplateResolver";

describe("UniversalDefaultTemplateResolver — loader lifecycle", () => {
  beforeEach(() => {
    clearUniversalDefaultLoader();
  });

  it("returns null when no loader registered", async () => {
    const result = await loadUniversalDefault();
    expect(result).toBeNull();
  });

  it("caches loader result across calls", async () => {
    const loader = jest.fn(() => ({
      propertyDefaults: [],
      inheritanceRules: [],
    }));
    registerUniversalDefaultLoader(loader);
    await loadUniversalDefault();
    await loadUniversalDefault();
    await loadUniversalDefault();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("clearUniversalDefault invalidates cache", async () => {
    const loader = jest.fn(() => ({
      propertyDefaults: [],
      inheritanceRules: [],
    }));
    registerUniversalDefaultLoader(loader);
    await loadUniversalDefault();
    clearUniversalDefault();
    await loadUniversalDefault();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("loader throwing → null fallback + warn once", async () => {
    const loader = jest.fn(() => {
      throw new Error("simulated load failure");
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    registerUniversalDefaultLoader(loader);
    const result = await loadUniversalDefault();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("loader returning null → returns null (no error)", async () => {
    registerUniversalDefaultLoader(() => null);
    const result = await loadUniversalDefault();
    expect(result).toBeNull();
  });

  it("async loader is awaited", async () => {
    registerUniversalDefaultLoader(async () => ({
      propertyDefaults: [{ propertyName: "x", value: "v" }],
      inheritanceRules: [],
    }));
    const result = await loadUniversalDefault();
    expect(result?.propertyDefaults).toEqual([
      { propertyName: "x", value: "v" },
    ]);
  });
});

describe("mergePropertyDefaults", () => {
  it("appends Grounding entries that don't conflict with Universal", () => {
    const universal: PropertyDefaultResolved[] = [
      { propertyName: "exo__Asset_uid", value: "$rand" },
    ];
    const grounding: PropertyDefaultResolved[] = [
      { propertyName: "ems__Effort_status", value: "[[Draft]]" },
    ];
    expect(mergePropertyDefaults(universal, grounding)).toEqual([
      { propertyName: "exo__Asset_uid", value: "$rand" },
      { propertyName: "ems__Effort_status", value: "[[Draft]]" },
    ]);
  });

  it("Grounding entry overrides Universal entry of same propertyName", () => {
    const universal: PropertyDefaultResolved[] = [
      { propertyName: "exo__Asset_label", value: "$userInputLabel" },
      { propertyName: "exo__Asset_uid", value: "$rand" },
    ];
    const grounding: PropertyDefaultResolved[] = [
      { propertyName: "exo__Asset_label", value: "Override" },
    ];
    const merged = mergePropertyDefaults(universal, grounding);
    expect(merged).toEqual([
      { propertyName: "exo__Asset_label", value: "Override" },
      { propertyName: "exo__Asset_uid", value: "$rand" },
    ]);
  });

  it("empty inputs handled gracefully", () => {
    expect(mergePropertyDefaults([], [])).toEqual([]);
    expect(
      mergePropertyDefaults(
        [{ propertyName: "x", value: "u" }],
        [],
      ),
    ).toEqual([{ propertyName: "x", value: "u" }]);
    expect(
      mergePropertyDefaults(
        [],
        [{ propertyName: "x", value: "g" }],
      ),
    ).toEqual([{ propertyName: "x", value: "g" }]);
  });
});

describe("mergeInheritanceRules", () => {
  const baseRule = (
    targetPropertyName: string,
    priority: number,
  ): InheritanceRuleResolved => ({
    sourcePropertyName: "exo__Asset_uid",
    targetPropertyName,
    targetClassCondition: undefined,
    targetClassExclusion: [],
    priority,
  });

  it("appends non-conflicting Grounding entries", () => {
    const merged = mergeInheritanceRules(
      [baseRule("exo__Asset_prototype", 100)],
      [baseRule("ems__Effort_area", 50)],
    );
    expect(merged.map((r) => r.targetPropertyName)).toEqual([
      "exo__Asset_prototype",
      "ems__Effort_area",
    ]);
  });

  it("Grounding overrides Universal by targetPropertyName", () => {
    const universal = [baseRule("exo__Asset_prototype", 100)];
    const grounding = [baseRule("exo__Asset_prototype", 200)];
    const merged = mergeInheritanceRules(universal, grounding);
    expect(merged).toHaveLength(1);
    expect(merged[0].priority).toBe(200);
  });
});
