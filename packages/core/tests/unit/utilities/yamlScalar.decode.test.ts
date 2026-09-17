/**
 * `decodeYamlQuotedScalar` — the inverse of `quoteYamlString` (ticket 4f226028).
 *
 * `FrontmatterService.parseObject` is a textual reader, so every `$target.<prop>`
 * read and every `property_append` dedup sees the RAW scalar text. This suite
 * locks the decoder against the escaper it inverts and against the real js-yaml
 * reading of the same text, so "decode(quote(x)) === x" cannot drift from what
 * a YAML parser would make of `quote(x)`.
 *
 * @req:f7790000-3779-4bbb-8bbb-000000000002
 */
import * as yaml from "js-yaml";
import {
  decodeYamlQuotedScalar,
  quoteYamlString,
} from "../../../src/utilities/yamlScalar";

describe("decodeYamlQuotedScalar (ticket 4f226028)", () => {
  it.each([
    ["plain", "Plain label"],
    ["interior double quotes", 'Label with "inner" quotes'],
    ["colon-space + quoted wikilink", 'Key: value (x: "[[y]]", z)'],
    ["backslash", "Note #42 about \\ backslash"],
    ["backslash before quote", 'a \\" b'],
    ["newline / tab / CR", "line1\nline2\ttab\rcr"],
    ["control chars", "bell\x07 nul\x00 del\x7f"],
    ["unicode", "Осознал, что делаю шелуху — 2026"],
    ["empty", ""],
  ])(
    "D1 round-trips quoteYamlString: %s",
    (_name, value) => {
      const quoted = quoteYamlString(value);
      expect(decodeYamlQuotedScalar(quoted)).toBe(value);
      // …and agrees with what a REAL YAML parser reads from the same text.
      expect(yaml.load(`k: ${quoted}`)).toEqual({ k: value });
    },
  );

  it("D2 decodes a `\\uNNNN` escape (accepted by js-yaml, never emitted by the escaper)", () => {
    expect(decodeYamlQuotedScalar('"caf\\u00e9"')).toBe("café");
  });

  it("D3 decodes a complete single-quoted scalar (`''` → `'`)", () => {
    expect(decodeYamlQuotedScalar("'it''s'")).toBe("it's");
    expect(yaml.load("k: 'it''s'")).toEqual({ k: "it's" });
  });

  it.each([
    ["plain scalar", "Plain label"],
    ["quoted wikilink is a COMPLETE scalar → unwrapped", '"[[uid]]"'],
    ["incomplete double-quoted run stays verbatim", '"a" and "b"'],
    ["lone interior single quote stays verbatim", "'a'b'"],
    ["one character", '"'],
  ])(
    "D4 non-quoted / incomplete input: %s",
    (_name, raw) => {
      const expected = raw === '"[[uid]]"' ? "[[uid]]" : raw;
      expect(decodeYamlQuotedScalar(raw)).toBe(expected);
    },
  );
});
