/**
 * blockVisibility — coercion + visibility precedence (override > Layout default
 * > built-in VL#3). Covers req a38ac95b assertions (d) precedence, (e)
 * coercion, (f) VL#3 no-config default.
 *
 * @req:a38ac95b-b347-42e4-8522-f481ab422337
 *
 * revert-verify: removing the `coerceVisibilityOverride !== undefined` short-
 * circuit in `resolveBlockVisibility` (so override never wins) turns the
 * precedence tests RED while the built-in/VL#3 tests stay GREEN; restoring →
 * all GREEN.
 */

import {
  BUILTIN_DAILY_EFFORTS_VISIBILITY,
  DAILY_EFFORTS_OVERRIDE_KEYS,
  coerceVisibilityOverride,
  resolveBlockVisibility,
  resolveDailyEffortVisibility,
} from "../../../src/domain/layout/blockVisibility";

describe("coerceVisibilityOverride (req a38ac95b — coercion)", () => {
  test.each([
    [true, true],
    [false, false],
    ["true", true],
    ["false", false],
    ["TRUE", true],
    ["  False  ", false],
  ])("coerces %p → %p", (input, expected) => {
    expect(coerceVisibilityOverride(input)).toBe(expected);
  });

  test.each([
    [undefined],
    [null],
    [""],
    ["yes"],
    ["1"],
    [1],
    [0],
    [{}],
    [[]],
  ])("treats %p as not-set (undefined)", (input) => {
    expect(coerceVisibilityOverride(input)).toBeUndefined();
  });
});

describe("resolveBlockVisibility (req a38ac95b — precedence)", () => {
  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 frontmatter override wins over Layout default and built-in", () => {
    // override=false beats layoutDefault=true beats builtin=true
    expect(resolveBlockVisibility(false, true, true)).toBe(false);
    // override="true" beats layoutDefault=false beats builtin=false
    expect(resolveBlockVisibility("true", false, false)).toBe(true);
  });

  test("Layout default wins when override is not set", () => {
    expect(resolveBlockVisibility(undefined, false, true)).toBe(false);
    expect(resolveBlockVisibility(null, true, false)).toBe(true);
    // a non-coercible string override falls through to the layout default
    expect(resolveBlockVisibility("maybe", false, true)).toBe(false);
  });

  test("built-in wins when neither override nor Layout default is set", () => {
    expect(resolveBlockVisibility(undefined, undefined, true)).toBe(true);
    expect(resolveBlockVisibility(undefined, undefined, false)).toBe(false);
  });
});

describe("BUILTIN_DAILY_EFFORTS_VISIBILITY (req a38ac95b — VL#3 default)", () => {
  test("Actions shown, Tasks shown, Projects hidden out of the box", () => {
    expect(BUILTIN_DAILY_EFFORTS_VISIBILITY.actions).toBe(true);
    expect(BUILTIN_DAILY_EFFORTS_VISIBILITY.tasks).toBe(true);
    expect(BUILTIN_DAILY_EFFORTS_VISIBILITY.projects).toBe(false);
  });
});

describe("resolveDailyEffortVisibility (req a38ac95b — daily merge)", () => {
  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 no config anywhere → VL#3 default (Actions+Tasks shown, Projects hidden)", () => {
    // null frontmatter, undefined layout default → built-in VL#3
    expect(resolveDailyEffortVisibility("actions", null, undefined)).toBe(true);
    expect(resolveDailyEffortVisibility("tasks", null, undefined)).toBe(true);
    expect(resolveDailyEffortVisibility("projects", null, undefined)).toBe(false);
  });

  test("Layout default overrides VL#3 when frontmatter is silent", () => {
    // Layout asset declares Projects visible=true → shown despite VL#3 false
    expect(resolveDailyEffortVisibility("projects", {}, true)).toBe(true);
    // Layout asset declares Tasks visible=false → hidden despite VL#3 true
    expect(resolveDailyEffortVisibility("tasks", {}, false)).toBe(false);
  });

  test("frontmatter override beats Layout default and VL#3", () => {
    const fm = {
      [DAILY_EFFORTS_OVERRIDE_KEYS.projects]: true, // show projects
      [DAILY_EFFORTS_OVERRIDE_KEYS.tasks]: "false", // hide tasks (string)
    };
    expect(resolveDailyEffortVisibility("projects", fm, false)).toBe(true);
    expect(resolveDailyEffortVisibility("tasks", fm, true)).toBe(false);
  });

  test("partial key set — unset partitions fall through, not collapse", () => {
    // Only Projects overridden; Actions/Tasks keep their layout/built-in default
    const fm = { [DAILY_EFFORTS_OVERRIDE_KEYS.projects]: true };
    expect(resolveDailyEffortVisibility("projects", fm, undefined)).toBe(true);
    expect(resolveDailyEffortVisibility("actions", fm, undefined)).toBe(true); // VL#3
    expect(resolveDailyEffortVisibility("tasks", fm, undefined)).toBe(true); // VL#3
  });

  test("null override value falls through to layout default / built-in", () => {
    const fm = { [DAILY_EFFORTS_OVERRIDE_KEYS.actions]: null };
    expect(resolveDailyEffortVisibility("actions", fm, false)).toBe(false);
  });
});
