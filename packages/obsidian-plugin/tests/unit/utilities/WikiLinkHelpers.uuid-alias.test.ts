import { WikiLinkHelpers } from "@kitelev/exocortex-core";

describe("WikiLinkHelpers.normalize — UUID-alias wikilinks (issue #2764)", () => {
  it("should prefer alias when target is a UUID", () => {
    expect(
      WikiLinkHelpers.normalize(
        "[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]",
      ),
    ).toBe("ems__Area");
  });

  it("should handle uppercase UUID targets", () => {
    expect(
      WikiLinkHelpers.normalize(
        "[[82C74542-1B14-4217-B852-D84730484B25|ems__Project]]",
      ),
    ).toBe("ems__Project");
  });

  it("should fall back to UUID when alias is empty", () => {
    expect(
      WikiLinkHelpers.normalize(
        "[[82c74542-1b14-4217-b852-d84730484b25|]]",
      ),
    ).toBe("82c74542-1b14-4217-b852-d84730484b25");
  });

  it("should prefer target (not alias) when target is non-UUID", () => {
    // For non-UUID targets, the target is the canonical file basename
    // and the alias is display-only — keep the target.
    expect(WikiLinkHelpers.normalize("[[Some Note|Display Label]]")).toBe(
      "Some Note",
    );
  });

  it("should keep working for plain class wikilinks without alias", () => {
    expect(WikiLinkHelpers.normalize("[[ems__Area]]")).toBe("ems__Area");
  });

  it("should handle UUID-alias where alias contains spaces", () => {
    expect(
      WikiLinkHelpers.normalize(
        "[[82c74542-1b14-4217-b852-d84730484b25|Custom Class Name]]",
      ),
    ).toBe("Custom Class Name");
  });

  it("should not match a malformed UUID target", () => {
    // `not-a-uuid` fails the UUID regex, so the target wins (non-UUID branch).
    expect(WikiLinkHelpers.normalize("[[not-a-uuid|alias]]")).toBe(
      "not-a-uuid",
    );
  });

  it("should treat a UUID target with multi-pipe alias as alias-wins", () => {
    expect(
      WikiLinkHelpers.normalize(
        "[[82c74542-1b14-4217-b852-d84730484b25|label|extra]]",
      ),
    ).toBe("label|extra");
  });

  it("should keep normalizing null and undefined to empty string", () => {
    expect(WikiLinkHelpers.normalize(null)).toBe("");
    expect(WikiLinkHelpers.normalize(undefined)).toBe("");
  });

  it("should keep normalizing empty bracket-only string to empty", () => {
    expect(WikiLinkHelpers.normalize("[[]]")).toBe("");
  });
});

describe("WikiLinkHelpers.equals — UUID-alias wikilinks (issue #2764)", () => {
  it("should equate UUID-alias form with plain form", () => {
    expect(
      WikiLinkHelpers.equals(
        "[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]",
        "[[ems__Area]]",
      ),
    ).toBe(true);
  });

  it("should equate UUID-alias form with bare class name", () => {
    expect(
      WikiLinkHelpers.equals(
        "[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]",
        "ems__Area",
      ),
    ).toBe(true);
  });
});

describe("WikiLinkHelpers.includes — UUID-alias wikilinks (issue #2764)", () => {
  it("should find UUID-alias form when searching for plain class", () => {
    expect(
      WikiLinkHelpers.includes(
        ["[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]"],
        "ems__Area",
      ),
    ).toBe(true);
  });
});
