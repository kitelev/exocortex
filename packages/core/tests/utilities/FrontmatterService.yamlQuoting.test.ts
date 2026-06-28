/**
 * Issue #3748 — `create_instance` / `apply create-task` must emit VALID YAML
 * frontmatter even when a string scalar (notably `exo__Asset_label` and
 * `aliases` items) contains `: ` (colon-space) or other YAML indicators.
 *
 * Production chokepoint: `GroundingExecutor.executeCreateInstance` builds the
 * `properties` object (including `exo__Asset_label = userInput.label` verbatim
 * and `aliases = [label]`) then calls `FrontmatterService.createFrontmatter`
 * (GroundingExecutor.ts:1092). These tests exercise that exact serializer and
 * parse the result with a REAL YAML parser (js-yaml), asserting both that it
 * loads and that the value round-trips to the original literal.
 *
 * Revert-verify: with the quote fix reverted (serializeValue emitting
 * `${property}: ${String(value)}` verbatim) the colon-label / aliases cases
 * FAIL (js-yaml throws "bad indentation of a mapping entry"). With the fix they
 * PASS. Empirically verified FAILS pre-fix / PASSES post-fix.
 */
import * as yaml from "js-yaml";
import { FrontmatterService } from "../../src/utilities/FrontmatterService";

function parseFrontmatter(created: string): Record<string, unknown> {
  const match = created.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`No frontmatter block in: ${created}`);
  return yaml.load(match[1]) as Record<string, unknown>;
}

describe("FrontmatterService — YAML-safe scalar quoting (#3748)", () => {
  const service = new FrontmatterService();

  it("colon-space label produces valid YAML and round-trips (scalar + aliases)", () => {
    const label = "ZZ probe: colon-space inside label";
    const created = service.createFrontmatter("", {
      exo__Asset_label: label,
      aliases: [label],
    });

    // Must not throw — this is the regression: verbatim emission throws here.
    const parsed = parseFrontmatter(created);

    expect(parsed.exo__Asset_label).toBe(label);
    expect(parsed.aliases).toEqual([label]);
  });

  it("plain label without special chars is NOT gratuitously quoted (no regression)", () => {
    const created = service.createFrontmatter("", {
      exo__Asset_label: "Plain Task Label",
      status: "draft",
    });

    expect(created).toContain("exo__Asset_label: Plain Task Label");
    expect(created).toContain("status: draft");
    // No quotes added around bare values.
    expect(created).not.toContain('"Plain Task Label"');
  });

  it("pre-quoted wikilink values pass through verbatim (not double-quoted)", () => {
    const created = service.createFrontmatter("", {
      exo__Instance_class: '"[[1b20a8f0]]"',
      aliases: ['"[[SomeLabel]]"'],
    });

    expect(created).toContain('exo__Instance_class: "[[1b20a8f0]]"');
    expect(created).toContain('  - "[[SomeLabel]]"');
    expect(created).not.toContain('\\"[[');

    const parsed = parseFrontmatter(created);
    expect(parsed.exo__Instance_class).toBe("[[1b20a8f0]]");
    expect(parsed.aliases).toEqual(["[[SomeLabel]]"]);
  });

  it("edge cases: leading indicator, surrounding spaces, embedded quote, empty", () => {
    const cases: Record<string, string> = {
      leadingBang: "!important reminder",
      leadingAt: "@mention thing",
      leadingHash: "#hashtag note",
      surroundingSpaces: "  padded label  ",
      embeddedQuoteWithColon: 'He said: "go"',
      empty: "",
    };

    const created = service.createFrontmatter("", { ...cases });
    const parsed = parseFrontmatter(created);

    for (const [key, value] of Object.entries(cases)) {
      expect(parsed[key]).toBe(value);
    }
  });

  it("booleans and numbers stay unquoted (YAML-native types preserved)", () => {
    const created = service.createFrontmatter("", {
      archived: true,
      draft: false,
      priority: 1,
      effort: 42,
    });

    expect(created).toContain("archived: true");
    expect(created).toContain("draft: false");
    expect(created).toContain("priority: 1");
    expect(created).toContain("effort: 42");

    const parsed = parseFrontmatter(created);
    expect(parsed.archived).toBe(true);
    expect(parsed.priority).toBe(1);
  });
});
