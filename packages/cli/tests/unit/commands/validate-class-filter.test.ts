import { describe, it, expect } from "@jest/globals";
import { frontmatterMatchesClass } from "../../../src/commands/validate-schema.js";

describe("CLI v16 — validate schema --class filter (RFC 8e83442b T1.4)", () => {
  it("frontmatterMatchesClass returns false for null frontmatter", () => {
    expect(frontmatterMatchesClass(null, "ems__Task")).toBe(false);
  });

  it("matches a single string wikilink class", () => {
    const fm = { exo__Instance_class: "[[ems__Task]]" };
    expect(frontmatterMatchesClass(fm, "ems__Task")).toBe(true);
  });

  it("matches one class in an array", () => {
    const fm = { exo__Instance_class: ["[[ems__Project]]", "[[ems__Task]]"] };
    expect(frontmatterMatchesClass(fm, "ems__Task")).toBe(true);
  });

  it("does not match a different class", () => {
    const fm = { exo__Instance_class: "[[ems__Project]]" };
    expect(frontmatterMatchesClass(fm, "ems__Task")).toBe(false);
  });

  it("handles alias suffix in wikilink", () => {
    const fm = { exo__Instance_class: "[[ems__Task|Task]]" };
    expect(frontmatterMatchesClass(fm, "ems__Task")).toBe(true);
  });

  it("returns false when exo__Instance_class is missing", () => {
    const fm = { exo__Asset_label: "x" };
    expect(frontmatterMatchesClass(fm, "ems__Task")).toBe(false);
  });
});
