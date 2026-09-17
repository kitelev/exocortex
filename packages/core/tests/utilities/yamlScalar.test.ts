/**
 * Issue #3750 — hardening `serializeYamlScalar` (follow-up to #3748).
 *
 * Every assertion parses the emitted scalar with a REAL YAML parser (js-yaml,
 * the same family Obsidian metadataCache uses) in a `key: value` mapping
 * context — the exact shape the frontmatter serializers emit.
 *
 * Revert-verify (empirically confirmed FAILS pre-fix / PASSES post-fix):
 *  - MEDIUM-2: revert the `isCompleteDoubleQuotedScalar` tightening (passthrough
 *    ANY `"…"`), and the `"a" and "b"` case throws in js-yaml.
 *  - MEDIUM-3: remove the `looksLikeNonStringScalar` check, and `123`/`true`/
 *    `2026-01-15` round-trip to number/boolean/Date (not string).
 *  - LOW-4: revert the control-char escaping, and `\x07` throws
 *    ("non-printable characters") in js-yaml.
 *
 * Req 389d4e14 (ticket 71f1ca37) — the C1 range U+0080–U+009F joins the
 * control class. Measured on js-yaml 5.3.0 / YAML11_SCHEMA: a bare C1 other
 * than NEL (U+0085) throws "non-printable characters"; NEL loads bare, so
 * C1c is the uniform-class control, not a repro. Mutant matrix — copied from
 * the driver output (mutants-71f1ca37.py, 2026-09-18):
 *   M1 (drop `\u007f-\u009f` from YAML_CONTROL_CHARS)  → RED: ['C1a', 'C1c']
 *   M2 (drop the 0x80–0x9F branch of quoteYamlString)  → RED: ['C1b', 'C1c']
 * C1a stays GREEN under M2 because js-yaml also loads a RAW C1 byte inside
 * `"…"` (double guard: C1b/C1c pin the `\xNN` FORM, C1a the round-trip).
 */
import * as yaml from "js-yaml";
import {
  needsYamlQuoting,
  quoteYamlString,
  serializeYamlScalar,
} from "../../src/utilities/yamlScalar";

/** Emit a scalar, parse it back in a real `key: value` mapping. */
function roundTrip(value: unknown, quoteAmbiguous = false): unknown {
  const line = `v: ${serializeYamlScalar(value, quoteAmbiguous)}`;
  // js-yaml 5 made CORE_SCHEMA the default (dates → strings). The production
  // read path (parseYamlFrontmatter) asks for YAML11_SCHEMA to keep js-yaml 4's
  // dual typing — bare date → Date, quoted → string — so this round-trip must
  // parse the same way, otherwise it checks a parser the product never uses.
  const parsed = yaml.load(line, { schema: yaml.YAML11_SCHEMA }) as Record<
    string,
    unknown
  >;
  return parsed.v;
}

describe("serializeYamlScalar (#3750)", () => {
  describe("MEDIUM-2 — `\"`-wrapped passthrough tightening", () => {
    it("re-quotes `\"a\" and \"b\"` (not a complete scalar) so it round-trips as the literal string", () => {
      const input = '"a" and "b"';
      // Pre-fix this emitted bare → js-yaml throws. Post-fix it is quoted.
      expect(() => roundTrip(input)).not.toThrow();
      expect(roundTrip(input)).toBe(input);
    });

    it("re-quotes `\"` (closing quote escaped → incomplete scalar)", () => {
      const input = '"\\"';
      expect(() => roundTrip(input)).not.toThrow();
      expect(roundTrip(input)).toBe(input);
    });

    it("passes a complete pre-quoted wikilink through verbatim (no regression)", () => {
      const input = '"[[1b20a8f0-uid]]"';
      // Production wikilinks arrive pre-wrapped; must NOT be double-quoted.
      expect(serializeYamlScalar(input)).toBe(input);
      expect(roundTrip(input)).toBe("[[1b20a8f0-uid]]");
    });

    it("passes a complete pre-quoted plain label through (DefaultWorkflows `\"${name}\"` — no regression)", () => {
      // DefaultWorkflows.ts pre-wraps labels as `"My Workflow"`. A complete
      // double-quoted scalar passes through (the prompt Part-2 spec). NB: this
      // also means a user-literal `"test"` round-trips to `test`, not `"test"`
      // — the two are byte-identical and the production passthrough wins.
      expect(serializeYamlScalar('"My Workflow"')).toBe('"My Workflow"');
      expect(roundTrip('"My Workflow"')).toBe("My Workflow");
    });
  });

  describe("MEDIUM-3 — scalar-looking strings quoted to round-trip as strings", () => {
    const coercibleStrings = [
      "123",
      "12_000",
      "0x1A",
      "0o17",
      "-17",
      "true",
      "True",
      "TRUE",
      "false",
      "FALSE",
      "null",
      "Null",
      "~",
      "1.5",
      ".inf",
      "-.inf",
      ".nan",
      "2e3",
      "2026-01-15",
    ];

    it.each(coercibleStrings)(
      "for a string-semantic property quotes %p so a real YAML parser keeps it a string",
      (s) => {
        const result = roundTrip(s, true); // quoteAmbiguousScalars (label/aliases)
        expect(typeof result).toBe("string");
        expect(result).toBe(s);
      },
    );

    // Subset that is quoted ONLY by MEDIUM-3 (not by a universal leading
    // indicator like `-`). `-17` / `-.inf` start with `-` and are always quoted.
    const coercibleNonIndicator = coercibleStrings.filter(
      (s) => !/^[-+]/.test(s),
    );

    it.each(coercibleNonIndicator)(
      "for a non-string-semantic property leaves %p bare (timestamp/numeric props keep native type)",
      (s) => {
        // Default (quoteAmbiguousScalars=false) — e.g. plannedStartTimestamp.
        expect(serializeYamlScalar(s)).toBe(s);
      },
    );

    it("does NOT quote datetime timestamps even for a string-semantic property", () => {
      const datetime = "2025-10-24T14:30:45";
      // Datetime is excluded from MEDIUM-3 (semantic-date format).
      expect(serializeYamlScalar(datetime, true)).toBe(datetime);
      expect(roundTrip(datetime, true)).toBeInstanceOf(Date);
    });
  });

  describe("LOW-4 — control characters escaped, never emitted bare", () => {
    const controlStrings = [
      "bell\x07here",
      "back\x08space",
      "form\x0cfeed",
      "vert\x0btab",
      "nul\x00byte",
      "del\x7fchar",
    ];

    it.each(controlStrings)(
      "escapes control chars in %j so js-yaml loads and round-trips it",
      (s) => {
        expect(() => roundTrip(s)).not.toThrow();
        expect(roundTrip(s)).toBe(s);
      },
    );
  });

  describe("req 389d4e14 — C1 control characters (U+0080–U+009F) quoted and \\xNN-escaped", () => {
    const REQ = "@req:389d4e14-7ee9-499a-bbc3-9ee6367104f0";
    // Bytes built in code, never as literals (a raw C1 in the source would be
    // the very defect under test).
    const c1 = (code: number) => String.fromCharCode(code);

    it.each(["0080", "008D", "009F"])(
      `${REQ} C1a a value carrying U+%s is emitted quoted, loads under YAML11 and round-trips byte-for-byte`,
      (hex) => {
        const s = `pad${c1(parseInt(hex, 16))}char`;
        // Repro "before": bare C1 → js-yaml throws "non-printable characters".
        expect(() =>
          yaml.load(`v: ${s}`, { schema: yaml.YAML11_SCHEMA }),
        ).toThrow(/non-printable/);
        expect(needsYamlQuoting(s)).toBe(true);
        expect(serializeYamlScalar(s).startsWith('"')).toBe(true);
        expect(() => roundTrip(s)).not.toThrow();
        expect(roundTrip(s)).toBe(s);
      },
    );

    it(`${REQ} C1b quoteYamlString emits the \\xNN escape form, never the raw C1 byte`, () => {
      expect(quoteYamlString(`a${c1(0x80)}b`)).toBe('"a\\x80b"');
      expect(quoteYamlString(`a${c1(0x9f)}b`)).toBe('"a\\x9Fb"');
      const out = quoteYamlString(`a${c1(0x85)}b${c1(0x8d)}c`);
      expect(out).toBe('"a\\x85b\\x8Dc"');
      // eslint-disable-next-line no-control-regex -- the C1 class IS the assertion
      expect(/[\u0080-\u009f]/.test(out)).toBe(false);
    });

    it(`${REQ} C1c NEL (U+0085) is quoted with its class even though YAML11 reads it bare (uniform control class)`, () => {
      const s = `ab${c1(0x85)}cd`;
      // NEL is the ONE C1 the reader accepts bare — this axis is the control
      // that the class is quoted uniformly, not a defect repro.
      expect(() =>
        yaml.load(`v: ${s}`, { schema: yaml.YAML11_SCHEMA }),
      ).not.toThrow();
      expect(needsYamlQuoting(s)).toBe(true);
      expect(serializeYamlScalar(s)).toBe('"ab\\x85cd"');
      expect(roundTrip(s)).toBe(s);
    });

    it.each(["Plain Task Label", "Ünïcödé — тест ✓", "a/b/c path"])(
      `${REQ} C1d a printable value %p keeps its bare on-disk form (no churn)`,
      (s) => {
        expect(needsYamlQuoting(s)).toBe(false);
        expect(serializeYamlScalar(s)).toBe(s);
        expect(roundTrip(s)).toBe(s);
      },
    );
  });

  describe("no gratuitous quoting / native types preserved", () => {
    it.each(["Plain Task Label", "draft", "concept name", "a/b/c path"])(
      "leaves plain string %p bare",
      (s) => {
        expect(serializeYamlScalar(s)).toBe(s);
        expect(roundTrip(s)).toBe(s);
      },
    );

    it("emits boolean / number values unquoted (YAML-native)", () => {
      expect(serializeYamlScalar(true)).toBe("true");
      expect(serializeYamlScalar(42)).toBe("42");
      expect(roundTrip(true)).toBe(true);
      expect(roundTrip(42)).toBe(42);
    });

    it("still quotes the #3748 colon-space and leading-indicator cases", () => {
      expect(roundTrip("ZZ probe: colon-space")).toBe("ZZ probe: colon-space");
      expect(roundTrip("!important")).toBe("!important");
      expect(roundTrip("#hashtag")).toBe("#hashtag");
      expect(roundTrip("")).toBe("");
    });
  });
});
