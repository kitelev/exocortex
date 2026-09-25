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

  // req a2c868e9 — several conditional rules for ONE property.
  //
  // These axes are deliberately unit-level. The duplicate-override defect (the
  // second one below) has NO observable product effect: applyInheritanceRuleStep
  // opens with `if (properties[rule.targetPropertyName] !== undefined) continue`,
  // so a duplicated entry is swallowed by that guard and the write is idempotent.
  // The list's cleanliness is therefore the only thing an axis can assert here.
  // The LOST-RULE defect does have a product effect and is pinned end-to-end in
  // create-action-parent.integration.test.ts.
  const condRule = (
    targetPropertyName: string,
    targetClassCondition: string,
    priority = 50,
  ): InheritanceRuleResolved => ({
    ...baseRule(targetPropertyName, priority),
    targetClassCondition,
  });

  it("@req:a2c868e9-47d3-4109-a5bc-3d8c4d1ff2bb [U1] keeps EVERY grounding rule for one property — they are distinct conditional rules, not a conflict", () => {
    const universal = [condRule("ems__Effort_parent", "ems__Project")];
    const grounding = [
      condRule("ems__Effort_parent", "ems__Project"),
      condRule("ems__Effort_parent", "ems__Task"),
    ];
    expect(
      mergeInheritanceRules(universal, grounding).map(
        (r) => r.targetClassCondition,
      ),
    ).toEqual(["ems__Project", "ems__Task"]);
  });

  it("@req:a2c868e9-47d3-4109-a5bc-3d8c4d1ff2bb [U2] emits the grounding override EXACTLY ONCE when several universal rules target that property", () => {
    const universal = [
      condRule("ems__Effort_parent", "ems__Project"),
      condRule("ems__Effort_parent", "ems__Task"),
    ];
    const grounding = [condRule("ems__Effort_parent", "ems__Project")];
    const merged = mergeInheritanceRules(universal, grounding);
    expect(merged).toHaveLength(1);
    expect(merged[0].targetClassCondition).toBe("ems__Project");
  });

  it("@req:a2c868e9-47d3-4109-a5bc-3d8c4d1ff2bb [U3] splices the grounding rules at the position of the FIRST universal rule they shadow", () => {
    // Two shadowed universal rules SEPARATED by a non-shadowed one: without the
    // separator, splicing at the FIRST vs the LAST shadowed position yields the
    // same list, and the axis cannot tell the two implementations apart.
    const universal = [
      baseRule("exo__Asset_prototype", 100),
      condRule("ems__Effort_parent", "ems__Project"),
      baseRule("ems__Effort_area", 40),
      condRule("ems__Effort_parent", "ems__Task"),
    ];
    const grounding = [condRule("ems__Effort_parent", "ems__Task")];
    expect(
      mergeInheritanceRules(universal, grounding).map(
        (r) => r.targetPropertyName,
      ),
    ).toEqual([
      "exo__Asset_prototype",
      "ems__Effort_parent",
      "ems__Effort_area",
    ]);
  });
});
