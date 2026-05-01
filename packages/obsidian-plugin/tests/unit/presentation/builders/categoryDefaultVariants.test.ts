import {
  categoryDefaultVariant,
  resolveDefaultVariantForCategory,
} from "../../../../src/presentation/builders/button-groups/categoryDefaultVariants";

describe("categoryDefaultVariant map (RFC-024 Phase 0)", () => {
  it("maps creation to primary", () => {
    expect(categoryDefaultVariant["creation"]).toBe("primary");
  });

  it("maps status/done to success", () => {
    expect(categoryDefaultVariant["status/done"]).toBe("success");
  });

  it("maps status/blocked to warning", () => {
    expect(categoryDefaultVariant["status/blocked"]).toBe("warning");
  });

  it("maps status/cancelled to danger", () => {
    expect(categoryDefaultVariant["status/cancelled"]).toBe("danger");
  });

  it("maps criticality to warning", () => {
    expect(categoryDefaultVariant["criticality"]).toBe("warning");
  });

  it("maps maintenance to muted", () => {
    expect(categoryDefaultVariant["maintenance"]).toBe("muted");
  });

  it("does not define status bare (falls through to secondary)", () => {
    expect(categoryDefaultVariant["status"]).toBeUndefined();
  });

  it("does not define planning (falls through to secondary)", () => {
    expect(categoryDefaultVariant["planning"]).toBeUndefined();
  });
});

describe("resolveDefaultVariantForCategory (RFC f1dc284a rename)", () => {
  it("returns secondary for undefined category", () => {
    expect(resolveDefaultVariantForCategory(undefined)).toBe("secondary");
  });

  it("returns secondary for empty string category", () => {
    expect(resolveDefaultVariantForCategory("")).toBe("secondary");
  });

  it("returns primary for creation category", () => {
    expect(resolveDefaultVariantForCategory("creation")).toBe("primary");
  });

  it("returns warning for criticality category", () => {
    expect(resolveDefaultVariantForCategory("criticality")).toBe("warning");
  });

  it("returns muted for maintenance category", () => {
    expect(resolveDefaultVariantForCategory("maintenance")).toBe("muted");
  });

  it("returns secondary for unknown category", () => {
    expect(resolveDefaultVariantForCategory("unknown-future-category")).toBe(
      "secondary",
    );
  });

  it("returns secondary for bare status category (sub-category required for color)", () => {
    expect(resolveDefaultVariantForCategory("status")).toBe("secondary");
  });

  it("returns secondary for planning category", () => {
    expect(resolveDefaultVariantForCategory("planning")).toBe("secondary");
  });
});
