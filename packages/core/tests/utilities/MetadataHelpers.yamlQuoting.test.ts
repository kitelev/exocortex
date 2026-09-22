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
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`No frontmatter block in: ${content}`);
  return parseFrontmatterAsReader(content);
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

/**
 * Ticket 2227d660 — the optional `declaredRangeOf` lookup types each scalar by
 * its declared `exo__Property_range`. Revert-verify: with the lookup ignored
 * (`declaredRangeOf?.(key)` → `undefined`) G1 goes RED; G2 is the control
 * (no lookup = byte-identical to the shape rule) and stays GREEN.
 */
describe("MetadataHelpers.buildFileContent — declared-range typing (ticket 2227d660) @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", () => {
  const rangeOf = (key: string): readonly string[] | undefined =>
    ({
      ems__Reminder_chatId: ["xsd:integer"],
      ems__Reminder_text: ["xsd:string"],
      ems__Reminder_ids: ["xsd:integer"],
    })[key];

  it("G1 with the lookup: a canonical negative under xsd:integer is bare (reads as a number), a number under xsd:string is quoted (reads as a string); array items follow the same rule", () => {
    const content = MetadataHelpers.buildFileContent(
      {
        exo__Asset_label: "Reminder",
        ems__Reminder_chatId: "-1001234567890",
        ems__Reminder_text: "42",
        ems__Reminder_ids: ["-5", "-6"],
        exo__Asset_relates: ["-7"],
      },
      undefined,
      rangeOf,
    );
    expect(content).toContain("ems__Reminder_chatId: -1001234567890\n");
    expect(content).toContain('ems__Reminder_text: "42"\n');
    // Array items of a mapped key follow the same rule…
    expect(content).toContain("ems__Reminder_ids:\n  - -5\n  - -6\n");
    // …and a key the lookup does not know keeps the shape rule (leading `-` quoted).
    expect(content).toContain('exo__Asset_relates:\n  - "-7"\n');
    const parsed = parseFrontmatter(content);
    expect(parsed.ems__Reminder_chatId).toBe(-1001234567890);
    expect(parsed.ems__Reminder_text).toBe("42");
  });

  it("G2 without the lookup: the pre-ticket shape rule (negative quoted, number bare) is byte-identical", () => {
    const content = MetadataHelpers.buildFileContent({
      exo__Asset_label: "Reminder",
      ems__Reminder_chatId: "-1001234567890",
      ems__Reminder_text: "42",
    });
    expect(content).toContain('ems__Reminder_chatId: "-1001234567890"\n');
    expect(content).toContain("ems__Reminder_text: 42\n");
  });

  /**
   * Ticket 8185c9dd (review #4282 LOW-1) — the lookup is made with the key the
   * caller SUPPLIED, not the emitted canonical key: `exo__Asset_pinned` is
   * emitted as the bare `pinned:` (UNPREFIXED_ASSET_FIELDS) but its def is
   * labelled `exo__Asset_pinned`, the key `set-property` resolves by. Revert-
   * verify: with `declaredRangeOf?.(key)` (canonical key) G3 goes RED.
   */
  it("G3 a whitelisted bare-emitted key (`exo__Asset_pinned` → `pinned:`) resolves its range by the SUPPLIED key — the same key set-property resolves by", () => {
    const seen: string[] = [];
    const lookup = (key: string): readonly string[] | undefined => {
      seen.push(key);
      return key === "exo__Asset_pinned" ? ["xsd:integer"] : undefined;
    };
    const content = MetadataHelpers.buildFileContent(
      { exo__Asset_label: "Pinned", exo__Asset_pinned: "-1" },
      undefined,
      lookup,
    );
    // Emitted bare under the canonical key, typed by the def's range.
    expect(content).toContain("pinned: -1\n");
    expect(parseFrontmatter(content).pinned).toBe(-1);
    // The lookup saw the supplied key, never the canonical one.
    expect(seen).toContain("exo__Asset_pinned");
    expect(seen).not.toContain("pinned");
    // Control — the same value supplied under the BARE key resolves nothing
    // in either writer (no def is labelled `pinned`) → shape rule, quoted.
    const bare = MetadataHelpers.buildFileContent(
      { exo__Asset_label: "Pinned", pinned: "-1" },
      undefined,
      lookup,
    );
    expect(bare).toContain('pinned: "-1"\n');
  });
});
