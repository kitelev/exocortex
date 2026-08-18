/**
 * Unit tests — UniversalDefaultTemplateResolver (RFC 727572d2 Phase C).
 *
 * Covers:
 * - mergePropertyDefaults: Grounding overrides Universal by propertyName
 * - mergeInheritanceRules: Grounding overrides Universal by targetPropertyName
 * - Order preservation: overridden entries stay in Universal position
 *
 * ⛔ The "loader lifecycle" block that used to open this file is GONE with the
 * loader itself (#4083). It specified «IF a loader is registered, it is used»
 * and was green for the entire life of the feature — while no host registered
 * one, so the branch it covered returned null on every production call. A test
 * whose premise production never satisfies is not coverage; deleting the branch
 * deletes its test with it. Singleton resolution is exercised where it actually
 * happens: CommandResolver.universalDefaultTemplate.test.ts.
 */

import type {
  InheritanceRuleResolved,
  PropertyDefaultResolved,
} from "../../../src/domain/models/CommandDefinition";
import {
  mergeInheritanceRules,
  mergePropertyDefaults,
} from "../../../src/services/UniversalDefaultTemplateResolver";

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
