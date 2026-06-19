/**
 * RFC 0002 §3.4 — profile-choice factory parsing tests.
 *
 * Production-shape: every input mirrors a real Obsidian frontmatter value
 * (string vs string[], boolean vs `"true"`, `[[uid]]` vs `[[uid|alias]]`).
 * The factory is the single place the picker reads the description /
 * recommended flag / locality from RDF (Homoiconicity — nothing hardcoded).
 */

import {
  buildProfileChoice,
  parseProfileRecommended,
  parseProfileDescription,
  extractIncludeUids,
} from "../../src/infrastructure/adapters/profileChoiceFactory";

describe("parseProfileRecommended", () => {
  it("true for boolean true", () => {
    expect(parseProfileRecommended(true)).toBe(true);
  });
  it('true for the string "true" (YAML may stringify)', () => {
    expect(parseProfileRecommended("true")).toBe(true);
    expect(parseProfileRecommended(" TRUE ")).toBe(true);
  });
  it("false for boolean false / string false / absent / other types", () => {
    expect(parseProfileRecommended(false)).toBe(false);
    expect(parseProfileRecommended("false")).toBe(false);
    expect(parseProfileRecommended(undefined)).toBe(false);
    expect(parseProfileRecommended(null)).toBe(false);
    expect(parseProfileRecommended(1)).toBe(false);
  });
});

describe("parseProfileDescription", () => {
  it("returns the trimmed string when present", () => {
    expect(parseProfileDescription("  A safe starting point  ")).toBe(
      "A safe starting point",
    );
  });
  it("returns undefined for blank / non-string", () => {
    expect(parseProfileDescription("   ")).toBeUndefined();
    expect(parseProfileDescription(undefined)).toBeUndefined();
    expect(parseProfileDescription(42)).toBeUndefined();
  });
});

describe("extractIncludeUids", () => {
  it("strips wikilink wrappers from a single string", () => {
    expect(extractIncludeUids("[[uid-1]]")).toEqual(["uid-1"]);
  });
  it("strips wrappers + alias from an array", () => {
    expect(
      extractIncludeUids(["[[uid-1]]", "[[uid-2|exoas-ems]]", "uid-3"]),
    ).toEqual(["uid-1", "uid-2", "uid-3"]);
  });
  it("empty for undefined / null / non-strings", () => {
    expect(extractIncludeUids(undefined)).toEqual([]);
    expect(extractIncludeUids(null)).toEqual([]);
    expect(extractIncludeUids([123, {}])).toEqual([]);
  });
});

describe("buildProfileChoice", () => {
  const PRESENT = new Set(["as-a", "as-b"]);

  it("returns null when the asset has no uid (cannot be applied)", () => {
    expect(
      buildProfileChoice({ exo__Asset_label: "x" }, "base", null, PRESENT),
    ).toBeNull();
  });

  it("maps label, active flag, description and recommended from RDF", () => {
    const fm = {
      exo__Asset_uid: "p1",
      exo__Asset_label: "$$starter",
      exo__Profile_description: "A safe starting point for new users.",
      exo__Profile_recommended: true,
      exo__Profile_includes: ["[[as-a]]"],
    };
    const choice = buildProfileChoice(fm, "base", "p1", PRESENT);
    expect(choice).toEqual({
      uid: "p1",
      label: "$$starter",
      isActive: true,
      description: "A safe starting point for new users.",
      isRecommended: true,
      isLocallyRelevant: true,
    });
  });

  it("falls back to basename when label absent; no description/badge by default", () => {
    const choice = buildProfileChoice(
      { exo__Asset_uid: "p2", exo__Profile_includes: "[[as-a]]" },
      "fallback-base",
      null,
      PRESENT,
    );
    expect(choice?.label).toBe("fallback-base");
    expect(choice?.description).toBeUndefined();
    expect(choice?.isRecommended).toBe(false);
    expect(choice?.isActive).toBe(false);
  });

  // ── P7b locality — the core scoping gate ──────────────────────────────────
  it("locally relevant when EVERY included AssetSpace resolves on disk", () => {
    const choice = buildProfileChoice(
      { exo__Asset_uid: "p3", exo__Profile_includes: ["[[as-a]]", "[[as-b]]"] },
      "b",
      null,
      PRESENT,
    );
    expect(choice?.isLocallyRelevant).toBe(true);
  });

  it("NOT relevant when an included AssetSpace is absent (cross-tester profile)", () => {
    const choice = buildProfileChoice(
      {
        exo__Asset_uid: "p4",
        exo__Asset_label: "$$mudriy-tbank",
        // exoas-mudriy not on this disk
        exo__Profile_includes: ["[[as-a]]", "[[as-mudriy]]"],
      },
      "b",
      null,
      PRESENT,
    );
    expect(choice?.isLocallyRelevant).toBe(false);
  });

  it("empty includes ⇒ vacuously relevant (minimum-load profile)", () => {
    const choice = buildProfileChoice(
      { exo__Asset_uid: "p5" },
      "b",
      null,
      PRESENT,
    );
    expect(choice?.isLocallyRelevant).toBe(true);
  });
});
