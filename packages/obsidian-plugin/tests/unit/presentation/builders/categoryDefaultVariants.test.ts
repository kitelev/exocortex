import {
  categoryDefaultVariant,
  resolveVariantForGroup,
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

describe("resolveVariantForGroup (RFC-024 Phase 0)", () => {
  it("returns secondary for undefined group", () => {
    expect(resolveVariantForGroup(undefined)).toBe("secondary");
  });

  it("returns secondary for empty string group", () => {
    expect(resolveVariantForGroup("")).toBe("secondary");
  });

  it("returns primary for creation group", () => {
    expect(resolveVariantForGroup("creation")).toBe("primary");
  });

  it("returns warning for criticality group", () => {
    expect(resolveVariantForGroup("criticality")).toBe("warning");
  });

  it("returns muted for maintenance group", () => {
    expect(resolveVariantForGroup("maintenance")).toBe("muted");
  });

  it("returns secondary for unknown group", () => {
    expect(resolveVariantForGroup("unknown-future-category")).toBe("secondary");
  });

  it("returns secondary for bare status group (sub-category required for color)", () => {
    expect(resolveVariantForGroup("status")).toBe("secondary");
  });

  it("returns secondary for planning group", () => {
    expect(resolveVariantForGroup("planning")).toBe("secondary");
  });
});
