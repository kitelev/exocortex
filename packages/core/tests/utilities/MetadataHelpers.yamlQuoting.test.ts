/**
 * Issue #3750 MEDIUM-1 — `MetadataHelpers.buildFileContent` is the SECOND
 * new-asset serializer (used by Concept / Area / Class / Session / Supervision
 * creation + DefaultWorkflows). It emitted scalars + array items verbatim
 * (`${String(value)}`) — the same latent #3748 bug fixed for the
 * `create_instance` path (`FrontmatterService.createFrontmatter`).
 *
 * This mirrors `FrontmatterService.yamlQuoting.test.ts`: it exercises the real
 * `buildFileContent` serializer and parses the produced frontmatter with a REAL
 * YAML parser (js-yaml), asserting both that it LOADS and that the value
 * round-trips.
 *
 * Revert-verify (empirically confirmed FAILS pre-fix / PASSES post-fix): with
 * the `serializeYamlScalar` wiring reverted to `${String(value)}`, the
 * colon-space scalar + array-item cases throw "bad indentation of a mapping
 * entry" in js-yaml.
 */
import * as yaml from "js-yaml";
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`No frontmatter block in: ${content}`);
  return yaml.load(match[1]) as Record<string, unknown>;
}

describe("MetadataHelpers.buildFileContent — YAML-safe scalar quoting (#3750)", () => {
  it("colon-space label produces valid YAML and round-trips (scalar + aliases array)", () => {
    const label = "ZZ probe: colon-space inside label";
    const content = MetadataHelpers.buildFileContent({
      exo__Asset_label: label,
      aliases: [label],
    });

    // Pre-fix: verbatim emission of a colon-space scalar throws here.
    const parsed = parseFrontmatter(content);

    expect(parsed.exo__Asset_label).toBe(label);
    expect(parsed.aliases).toEqual([label]);
  });

  it("plain label without special chars is NOT gratuitously quoted (no regression)", () => {
    const content = MetadataHelpers.buildFileContent({
      exo__Asset_label: "Plain Concept Label",
      ims__Concept_definition: "a normal definition",
    });

    expect(content).toContain("exo__Asset_label: Plain Concept Label");
    expect(content).toContain("ims__Concept_definition: a normal definition");
    expect(content).not.toContain('"Plain Concept Label"');
  });

  it("pre-quoted wikilink values pass through verbatim (not double-quoted)", () => {
    const content = MetadataHelpers.buildFileContent({
      exo__Instance_class: ['"[[concept__Concept]]"'],
      ims__Concept_broader: '"[[Parent Concept]]"',
    });

    expect(content).toContain('  - "[[concept__Concept]]"');
    expect(content).toContain('ims__Concept_broader: "[[Parent Concept]]"');
    expect(content).not.toContain('\\"[[');

    const parsed = parseFrontmatter(content);
    expect(parsed.exo__Instance_class).toEqual(["[[concept__Concept]]"]);
    expect(parsed.ims__Concept_broader).toBe("[[Parent Concept]]");
  });

  it("scalar-looking LABEL/aliases round-trip as strings, not number/bool/date", () => {
    const content = MetadataHelpers.buildFileContent({
      exo__Asset_label: "2026-01-15",
      aliases: ["123", "true"],
    });
    const parsed = parseFrontmatter(content);

    expect(parsed.exo__Asset_label).toBe("2026-01-15");
    expect(typeof parsed.exo__Asset_label).toBe("string");
    expect(parsed.aliases).toEqual(["123", "true"]);
  });

  it("scalar-looking NON-label property keeps its native type (timestamp/numeric props not over-quoted)", () => {
    // #3750 MEDIUM-3 is gated to label/aliases: a date-only value on a
    // timestamp property must stay bare (coerces to a Date), not become a
    // quoted string.
    const content = MetadataHelpers.buildFileContent({
      exo__Asset_label: "Plain",
      ems__Effort_plannedStartTimestamp: "2026-05-23",
    });

    expect(content).toContain(
      "ems__Effort_plannedStartTimestamp: 2026-05-23",
    );
    expect(content).not.toContain('"2026-05-23"');
  });

  it("array item with colon-space stays valid YAML and round-trips", () => {
    const item = "alias: with colon";
    const content = MetadataHelpers.buildFileContent({
      exo__Asset_label: "Plain",
      aliases: [item, "plain alias"],
    });
    const parsed = parseFrontmatter(content);

    expect(parsed.aliases).toEqual([item, "plain alias"]);
  });
});
