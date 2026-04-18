/**
 * Contract test for `exocmd__CommandBindingStyle` schema (RFC-024 §4 Phase 2).
 *
 * Enforces the two-way binding between ontology-side property aliases
 * (frontmatter keys written to the vault) and TS-side enum unions that
 * the plugin compares against at runtime. Divergence = silent coerce-to-
 * fallback at runtime, which is exactly what the RFC's non-breaking-schema
 * invariant (§3) forbids.
 */

import {
  CommandBindingProperty,
  CommandBindingStyleProperty,
} from "../../../../src/domain/constants/CommandProperty";
import {
  type CommandVariant,
  type LabelClass,
  type StyleSource,
  COMMAND_VARIANT_VALUES,
  LABEL_CLASS_VALUES,
  STYLE_SOURCE_VALUES,
  isCommandVariant,
  isLabelClass,
  isStyleSource,
} from "../../../../src/domain/constants/CommandBindingStyleEnums";

describe("CommandBindingStyleProperty — ontology property aliases", () => {
  it("has exactly the 7 RFC-024 §4 Phase 2 properties", () => {
    const keys = Object.keys(CommandBindingStyleProperty).sort();
    expect(keys).toEqual([
      "ARIA_LABEL",
      "KEYBOARD_SHORTCUT",
      "LABEL_CLASS",
      "SHOW_ICON",
      "SOURCE",
      "TOOLTIP",
      "VARIANT",
    ]);
  });

  it("aliases follow exocmd__CommandBindingStyle_* naming", () => {
    for (const alias of Object.values(CommandBindingStyleProperty)) {
      expect(alias).toMatch(/^exocmd__CommandBindingStyle_[a-z][A-Za-z]+$/);
    }
  });

  it("aliases are all distinct", () => {
    const values = Object.values(CommandBindingStyleProperty);
    expect(new Set(values).size).toBe(values.length);
  });

  it("field-for-field RFC §4 mapping is preserved", () => {
    expect(CommandBindingStyleProperty.VARIANT).toBe(
      "exocmd__CommandBindingStyle_variant",
    );
    expect(CommandBindingStyleProperty.SHOW_ICON).toBe(
      "exocmd__CommandBindingStyle_showIcon",
    );
    expect(CommandBindingStyleProperty.LABEL_CLASS).toBe(
      "exocmd__CommandBindingStyle_labelClass",
    );
    expect(CommandBindingStyleProperty.ARIA_LABEL).toBe(
      "exocmd__CommandBindingStyle_ariaLabel",
    );
    expect(CommandBindingStyleProperty.TOOLTIP).toBe(
      "exocmd__CommandBindingStyle_tooltip",
    );
    expect(CommandBindingStyleProperty.KEYBOARD_SHORTCUT).toBe(
      "exocmd__CommandBindingStyle_keyboardShortcut",
    );
    expect(CommandBindingStyleProperty.SOURCE).toBe(
      "exocmd__CommandBindingStyle_source",
    );
  });
});

describe("CommandBindingProperty — style wiring", () => {
  it("exposes STYLE wikilink reference (RFC-024 §4 Phase 2)", () => {
    expect(CommandBindingProperty.STYLE).toBe("exocmd__CommandBinding_style");
  });

  it("exposes VARIANT inline shorthand (RFC-024 §4 Phase 2)", () => {
    expect(CommandBindingProperty.VARIANT).toBe(
      "exocmd__CommandBinding_variant",
    );
  });
});

describe("CommandVariant union ↔ whitelist", () => {
  it("whitelist enumerates exactly the 6 union members", () => {
    expect([...COMMAND_VARIANT_VALUES].sort()).toEqual([
      "danger",
      "muted",
      "primary",
      "secondary",
      "success",
      "warning",
    ]);
  });

  it.each(COMMAND_VARIANT_VALUES)("isCommandVariant accepts '%s'", (value) => {
    expect(isCommandVariant(value)).toBe(true);
    // Compile-time assignability — if this errored the union drifted from whitelist
    const variant: CommandVariant = value;
    expect(variant).toBe(value);
  });

  it.each(["Primary", "PRIMARY", " primary", "primary ", "info", "", null, 1])(
    "isCommandVariant rejects invalid input %p",
    (value) => {
      expect(isCommandVariant(value)).toBe(false);
    },
  );

  it("whitelist is frozen (non-breaking schema invariant)", () => {
    expect(Object.isFrozen(COMMAND_VARIANT_VALUES)).toBe(true);
  });
});

describe("LabelClass union ↔ whitelist", () => {
  it("whitelist enumerates exactly the 4 RFC §4 union members", () => {
    expect([...LABEL_CLASS_VALUES].sort()).toEqual([
      "bold",
      "compact",
      "muted",
      "uppercase",
    ]);
  });

  it.each(LABEL_CLASS_VALUES)("isLabelClass accepts '%s'", (value) => {
    expect(isLabelClass(value)).toBe(true);
    const labelClass: LabelClass = value;
    expect(labelClass).toBe(value);
  });

  it.each(["Bold", "italic", "", null, undefined])(
    "isLabelClass rejects invalid input %p",
    (value) => {
      expect(isLabelClass(value)).toBe(false);
    },
  );

  it("whitelist is frozen", () => {
    expect(Object.isFrozen(LABEL_CLASS_VALUES)).toBe(true);
  });
});

describe("StyleSource union ↔ whitelist", () => {
  it("whitelist enumerates vendor+user", () => {
    expect([...STYLE_SOURCE_VALUES].sort()).toEqual(["user", "vendor"]);
  });

  it.each(STYLE_SOURCE_VALUES)("isStyleSource accepts '%s'", (value) => {
    expect(isStyleSource(value)).toBe(true);
    const src: StyleSource = value;
    expect(src).toBe(value);
  });

  it.each(["User", "system", "default", "", null])(
    "isStyleSource rejects invalid input %p",
    (value) => {
      expect(isStyleSource(value)).toBe(false);
    },
  );

  it("whitelist is frozen", () => {
    expect(Object.isFrozen(STYLE_SOURCE_VALUES)).toBe(true);
  });
});

describe("Schema ↔ union field alignment", () => {
  /**
   * Every enum-valued Style property has a matching TS union. Divergence
   * (a property without a union or a union without a property) means the
   * plugin's runtime coercion cannot round-trip through the ontology.
   */
  it("VARIANT property pairs with CommandVariant union", () => {
    expect(CommandBindingStyleProperty.VARIANT.endsWith("_variant")).toBe(true);
    expect(COMMAND_VARIANT_VALUES.length).toBeGreaterThan(0);
  });

  it("LABEL_CLASS property pairs with LabelClass union", () => {
    expect(
      CommandBindingStyleProperty.LABEL_CLASS.endsWith("_labelClass"),
    ).toBe(true);
    expect(LABEL_CLASS_VALUES.length).toBeGreaterThan(0);
  });

  it("SOURCE property pairs with StyleSource union", () => {
    expect(CommandBindingStyleProperty.SOURCE.endsWith("_source")).toBe(true);
    expect(STYLE_SOURCE_VALUES.length).toBeGreaterThan(0);
  });

  it("CommandBinding.VARIANT shorthand literal type matches CommandVariant", () => {
    // The inline shorthand property accepts exactly the CommandVariant whitelist.
    for (const v of COMMAND_VARIANT_VALUES) {
      expect(isCommandVariant(v)).toBe(true);
    }
  });
});
