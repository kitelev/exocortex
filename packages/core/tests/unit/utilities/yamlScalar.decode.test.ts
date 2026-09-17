/**
 * `decodeYamlQuotedScalar` — the read-side counterpart of `quoteYamlString`
 * (ticket 4f226028).
 *
 * `FrontmatterService.parseObject` is a textual reader, so every `$target.<prop>`
 * read and every `property_append` dedup sees the RAW scalar text. This suite
 * locks the decoder against BOTH writers of that text — `quoteYamlString`
 * (D1) and js-yaml `dump`, which the object-path adapters use and which emits
 * the full YAML 1.2 §5.7 escape set (D5, PR #4250 review MEDIUM) — and checks
 * every decode against the real js-yaml reading of the same line, so "what the
 * decoder returns" cannot drift from "what a YAML parser reads".
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
  ])("D1 round-trips quoteYamlString: %s", (_name, value) => {
    const quoted = quoteYamlString(value);
    expect(decodeYamlQuotedScalar(quoted)).toBe(value);
    // …and agrees with what a REAL YAML parser reads from the same text.
    expect(yaml.load(`k: ${quoted}`)).toEqual({ k: value });
  });

  it("D2 decodes a `\\uNNNN` escape (accepted by js-yaml, never emitted by the escaper)", () => {
    expect(decodeYamlQuotedScalar('"caf\\u00e9"')).toBe("café");
  });

  it("D3 decodes a complete single-quoted scalar (`''` → `'`)", () => {
    expect(decodeYamlQuotedScalar("'it''s'")).toBe("it's");
    expect(yaml.load("k: 'it''s'")).toEqual({ k: "it's" });
  });

  it("D4a a pre-wrapped complete double-quoted wikilink is unwrapped", () => {
    expect(decodeYamlQuotedScalar('"[[uid]]"')).toBe("[[uid]]");
  });

  it.each([
    ["plain scalar", "Plain label"],
    ["incomplete double-quoted run", '"a" and "b"'],
    ["lone interior single quote", "'a'b'"],
    ["one character", '"'],
    ["escape js-yaml rejects (unknown \\q)", '"a\\qb"'],
    ["escape js-yaml rejects (malformed \\xZZ)", '"\\xZZ"'],
  ])(
    "D4 verbatim (byte-lossless) for non-quoted / incomplete / unparseable input: %s",
    (_name, raw) => {
      expect(decodeYamlQuotedScalar(raw)).toBe(raw);
    },
  );

  // PR #4250 review MEDIUM — the text on disk is also written by js-yaml
  // `dump` (object-path adapters), which emits the full YAML 1.2 §5.7 named
  // escapes for non-printables. Independent oracle: dump a value with the real
  // js-yaml, feed the RAW dumped scalar to the decoder, expect the value back.
  it.each([
    ["NBSP (dump writes \\_)", "foo\u00a0bar"],
    ["NEL U+0085 (\\N)", "a\u0085b"],
    ["LS U+2028 (\\L)", "a\u2028b"],
    ["PS U+2029 (\\P)", "a\u2029b"],
    ["NUL / BEL / BS / ESC / FF / VT", "\u0000\u0007\u0008\u001b\u000c\u000b"],
    ["astral non-printable (\\UNNNNNNNN)", "x\u{e0001}y"],
    ["DEL", "a\u007fb"],
    ["emoji + surrogate pair", "ok \u{1f600} 😀"],
  ])("D5 decodes what js-yaml dump wrote: %s", (_name, value) => {
    const raw = yaml
      .dump({ k: value }, { lineWidth: -1 })
      .replace(/^k: /, "")
      .replace(/\n$/, "");
    // Whatever form dump chose (a quoted run with named escapes for the
    // non-printables, plain text for the printable astral ones), the decode
    // equals the value AND the real parser's reading of the same line.
    expect(decodeYamlQuotedScalar(raw)).toBe(value);
    expect(yaml.load(`k: ${raw}`)).toEqual({ k: value });
  });

  it("D5a the NBSP oracle really exercises a §5.7 named escape (`\\_`), not a plain scalar", () => {
    const raw = yaml.dump({ k: "foo\u00a0bar" }, { lineWidth: -1 });
    expect(raw).toBe('k: "foo\\_bar"\n');
    expect(decodeYamlQuotedScalar('"foo\\_bar"')).toBe("foo\u00a0bar");
  });
});
