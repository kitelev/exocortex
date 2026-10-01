/**
 * #4405 — what the property editor writes must read back as what was typed.
 *
 * `FrontmatterService.updateProperty` writes its argument VERBATIM (its
 * contract is "already-formatted YAML"), and `formatPropertyValue` used to
 * hand it raw `String(value)`. So YAML-significant text silently changed
 * meaning between save and load: `PR #42 merged` came back as `PR`, because
 * ` #` opens a comment, and `#4263: …` came back as `null`.
 *
 * The axes below round-trip through the REAL parser rather than asserting on
 * the quoting shape. Asserting `toBe('"PR #42 merged"')` would pin one
 * serialiser's style and still not prove the value survives; parsing it back
 * proves exactly the property the user cares about, and stays true if the
 * serialiser ever changes how it quotes.
 */

import * as yaml from "js-yaml";
import { formatPropertyValue } from "../../../src/domain/property-editor/formatPropertyValue";

/** Write one property the way the editor does, then read the file back. */
function roundTrip(typed: unknown): unknown {
  const doc = `k: ${formatPropertyValue(typed)}\n`;
  const parsed = yaml.load(doc) as Record<string, unknown> | null;
  return parsed?.k;
}

describe("#4405 formatPropertyValue — typed text survives the YAML round-trip", () => {
  // Each shape is YAML-significant for a DIFFERENT reason, so they are listed
  // one per row instead of folded into one assert: a single `each` failure
  // names the grammar rule that broke.
  it.each([
    ["comment opener mid-value", "PR #42 merged"],
    ["comment opener at start", "#4263: parser drops the tail"],
    ["mapping separator inside text", "Meeting: Q3 planning"],
    ["flow sequence opener", "[draft] not a list"],
    ["flow mapping opener", "{pending} not a map"],
    ["anchor sigil", "&ref is not an anchor"],
    ["alias sigil", "*star is not an alias"],
    ["tag sigil", "!important is not a tag"],
    ["block scalar sigil", "| pipe at the start"],
    ["folded scalar sigil", "> quoted prose"],
    ["directive sigil", "%YAML is not a directive"],
    ["reserved at-sign", "@mention"],
    ["reserved backtick", "`tick"],
    ["block sequence dash", "- not a list item"],
  ])("A1 %s round-trips byte for byte", (_why, typed) => {
    expect(roundTrip(typed)).toBe(typed);
  });

  it("A2 plain text is still emitted BARE — the fix quotes only what the grammar needs", () => {
    // Control for A1: without this, "quote everything" would pass every row
    // above while changing every file the user already has.
    expect(formatPropertyValue("just some text")).toBe("just some text");
    expect(formatPropertyValue("2026-09-26")).toBe("2026-09-26");
    expect(roundTrip("just some text")).toBe("just some text");
  });

  it("A3 non-strings keep their bare YAML form", () => {
    expect(formatPropertyValue(true)).toBe("true");
    expect(formatPropertyValue(42)).toBe("42");
    expect(roundTrip(true)).toBe(true);
    expect(roundTrip(42)).toBe(42);
  });

  it("A4 list items get the same treatment — an unquoted item loses its tail too", () => {
    const doc = `k:${formatPropertyValue(["PR #42 merged", "plain item"])}\n`;
    const parsed = yaml.load(doc) as Record<string, unknown>;
    expect(parsed.k).toEqual(["PR #42 merged", "plain item"]);
  });

  it("A5 an emptied field still writes nothing — clearing a textbox is not typing `\"\"`", () => {
    // The ONE deliberate departure from the serialiser, which would emit `""`.
    // `null`/`undefined` already meant "no value" here; an empty string is the
    // same user gesture (a cleared field) and must keep the same result, or
    // #4405 would silently change what clearing a property does.
    expect(formatPropertyValue("")).toBe("");
    expect(formatPropertyValue(null)).toBe("");
  });

  it("A6 a value that arrives ALREADY quoted is not quoted a second time", () => {
    // The editor's own relation paths pre-wrap through
    // `quoteRelationValueForYaml`, so this function is handed `"[[uid]]"`.
    // Re-quoting would write `"\"[[uid]]\""` and the wikilink would read back
    // as text — i.e. the fix would break the very path it runs on most.
    expect(formatPropertyValue('"[[some-uid]]"')).toBe('"[[some-uid]]"');
    expect(roundTrip('"[[some-uid]]"')).toBe("[[some-uid]]");
  });
});
