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
 *
 * Req 7d76bbb4 (ticket 65ea50c4) — js-yaml 5.3.0 `PATTERN_NON_PRINTABLE`
 * positions OUTSIDE C0/DEL/C1: U+FFFE / U+FFFF and lone surrogate halves.
 * Measured: bare → "non-printable" throws (plain scalar); inside `"…"` the
 * raw unit loads (as C1), so N1c/N1e/N1g pin the `\uNNNN` FORM and N1g the
 * on-disk faithfulness (a raw lone half written as UTF-8 becomes U+FFFD).
 * Mutant matrix — copied from the driver output (mutants-65ea50c4.py, 2026-09-18):
 * M1 (needsYamlQuoting guard dead) → RED: ['N1a', 'N1b', 'N1g']
 * M2 (FFFE/FFFF branch unreachable → raw) → RED: ['N1c']
 * M3 (lone-surrogate branch unreachable → raw) → RED: ['N1c', 'N1e', 'N1g']
 * M4 (pair lookahead disabled → pair split) → RED: ['N1e']
 * M5 (regex high-surrogate lookahead dropped → pair quoted) → RED: ['N1d']
 * M6 (hex lower-case, both branches) → RED: ['N1c', 'N1e', 'N1g']
 * M7 (regex lone-LOW alternative dropped) → RED: ['N1b']
 * M8 (regex FFFE/FFFF alternative dropped) → RED: ['N1a']
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  decodeYamlQuotedScalar,
  needsYamlQuoting,
  quoteYamlString,
  scalarTypingForRange,
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

  describe("req 7d76bbb4-a4b3-4191-8dbe-cac8b8675978 — js-yaml non-printable positions outside C0/DEL/C1 (U+FFFE/U+FFFF, lone surrogates) quoted and \\uNNNN-escaped", () => {
    const REQ = "@req:7d76bbb4-a4b3-4191-8dbe-cac8b8675978";
    // Every unit built in code, never as a literal (a raw non-character or lone
    // surrogate in the source would be the defect under test — and a UTF-8 file
    // cannot even carry a lone half).
    const u = (code: number) => String.fromCharCode(code);
    const emoji = String.fromCodePoint(0x1f600); // valid pair D83D DE00
    const loadV = (line: string) =>
      (
        yaml.load(line, { schema: yaml.YAML11_SCHEMA }) as Record<
          string,
          unknown
        >
      ).v;

    it.each(["FFFE", "FFFF"])(
      `${REQ} N1a a value carrying non-character U+%s is emitted quoted, loads under YAML11 and round-trips byte-for-byte`,
      (hex) => {
        const s = `pad${u(parseInt(hex, 16))}char`;
        // Repro "before": bare non-character → js-yaml throws for the whole stream.
        expect(() => loadV(`v: ${s}`)).toThrow(/non-printable/);
        expect(needsYamlQuoting(s)).toBe(true);
        expect(serializeYamlScalar(s).startsWith('"')).toBe(true);
        expect(() => roundTrip(s)).not.toThrow();
        expect(roundTrip(s)).toBe(s);
      },
    );

    it.each([
      ["lone high U+D83D mid", `ab${u(0xd83d)}cd`],
      ["lone low U+DC00 mid", `ab${u(0xdc00)}cd`],
      ["lone low U+DFFF at start", `${u(0xdfff)}abcd`],
      ["lone high U+D800 at end", `abcd${u(0xd800)}`],
    ])(
      `${REQ} N1b a value carrying a %s surrogate is emitted quoted, loads under YAML11 and round-trips byte-for-byte`,
      (_name, s) => {
        expect(() => loadV(`v: ${s}`)).toThrow(/non-printable/);
        expect(needsYamlQuoting(s)).toBe(true);
        expect(serializeYamlScalar(s).startsWith('"')).toBe(true);
        expect(() => roundTrip(s)).not.toThrow();
        expect(roundTrip(s)).toBe(s);
      },
    );

    it(`${REQ} N1c quoteYamlString emits the upper-case \\uNNNN escape form, never the raw unit`, () => {
      expect(quoteYamlString(`a${u(0xfffe)}b`)).toBe('"a\\uFFFEb"');
      expect(quoteYamlString(`a${u(0xffff)}b`)).toBe('"a\\uFFFFb"');
      expect(quoteYamlString(`a${u(0xd83d)}b`)).toBe('"a\\uD83Db"');
      expect(quoteYamlString(`a${u(0xdc00)}b`)).toBe('"a\\uDC00b"');
      const out = quoteYamlString(`${u(0xdfff)}a${u(0xfffe)}b${u(0xd800)}`);
      expect(out).toBe('"\\uDFFFa\\uFFFEb\\uD800"');
      // No raw non-printable unit survives in the emitted text.
      expect(
        /[\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(
          out,
        ),
      ).toBe(false);
    });

    it.each([
      ["U+FFFD replacement", `a${u(0xfffd)}b`],
      ["a valid surrogate pair (emoji)", `a${emoji}b`],
      ["U+10FFFF (last astral)", `a${String.fromCodePoint(0x10ffff)}b`],
      ["a BOM inside the value", `a${u(0xfeff)}b`],
    ])(
      `${REQ} N1d %s is printable to the reader and keeps its bare on-disk form (no churn)`,
      (_name, s) => {
        expect(() => loadV(`v: ${s}`)).not.toThrow();
        expect(needsYamlQuoting(s)).toBe(false);
        expect(serializeYamlScalar(s)).toBe(s);
        expect(roundTrip(s)).toBe(s);
      },
    );

    it(`${REQ} N1e a valid pair next to a lone half is emitted raw as a pair — never split into two \\u escapes`, () => {
      const s = `${emoji}${u(0xd83d)}x${emoji}`;
      const out = quoteYamlString(s);
      expect(out).toBe(`"${emoji}\\uD83Dx${emoji}"`);
      expect(out.split("\\u").length - 1).toBe(1);
      expect(loadV(`v: ${out}`)).toBe(s);
    });

    it.each([
      ["U+FFFE", `a${u(0xfffe)}b`],
      ["lone high U+D83D", `a${u(0xd83d)}b`],
    ])(
      `${REQ} N1f decodeYamlQuotedScalar reads the \\uNNNN form back to the original %s (read-side counterpart)`,
      (_name, s) => {
        expect(decodeYamlQuotedScalar(quoteYamlString(s))).toBe(s);
      },
    );

    it(`${REQ} N1g on disk: the quoted line written as UTF-8 and read back yields the original lone half (a bare write would have turned it into U+FFFD)`, () => {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "yaml-scalar-65ea50c4-"),
      );
      try {
        const s = `ab${u(0xd83d)}cd`;
        const file = path.join(dir, "v.md");
        fs.writeFileSync(file, `v: ${serializeYamlScalar(s)}\n`, "utf8");
        const back = fs.readFileSync(file, "utf8");
        // The file itself carries no replacement character and no raw half.
        expect(back.includes(u(0xfffd))).toBe(false);
        expect(back).toBe('v: "ab\\uD83Dcd"\n');
        expect(loadV(back)).toBe(s);
        // Contrast (the pre-fix on-disk form): a bare write is lossy.
        const bareFile = path.join(dir, "bare.md");
        fs.writeFileSync(bareFile, `v: ${s}\n`, "utf8");
        expect(fs.readFileSync(bareFile, "utf8")).toBe(`v: ab${u(0xfffd)}cd\n`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
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

/**
 * Ticket 2227d660 — the DECLARED `exo__Property_range` types a canonical
 * scalar (the writers pass it as the third argument). Revert-verify: with the
 * range branches removed from `needsYamlQuoting` (pre-ticket state) R1–R6 go
 * RED; R10 / R14 are the negative controls (no range / non-string value =
 * byte-identical to before) and stay GREEN in both states.
 *
 * Parsed back through YAML11_SCHEMA — the production reader — because the
 * contract is the TYPE the reader yields, not the characters emitted.
 */
describe("ticket 2227d660 — declared exo__Property_range types the scalar @req:21ceea14-50dd-4cf8-bd3b-5a50b7c97105", () => {
  const INTEGER = ["xsd:integer"];
  const DECIMAL = ["xsd:decimal"];
  const BOOLEAN = ["xsd:boolean"];
  const STRING = ["xsd:string"];

  function roundTripRanged(
    value: string,
    range: readonly string[] | undefined,
    quoteAmbiguous = false,
  ): unknown {
    const line = `v: ${serializeYamlScalar(value, quoteAmbiguous, range)}`;
    return (
      yaml.load(line, { schema: yaml.YAML11_SCHEMA }) as Record<string, unknown>
    ).v;
  }

  it("R1 xsd:integer — a canonical NEGATIVE integer is emitted bare and reads back as that number (the leading `-` no longer forces quoting)", () => {
    expect(serializeYamlScalar("-1001234567890", false, INTEGER)).toBe(
      "-1001234567890",
    );
    expect(needsYamlQuoting("-1001234567890", false, INTEGER)).toBe(false);
    expect(roundTripRanged("-1001234567890", INTEGER)).toBe(-1001234567890);
  });

  it("R2 xsd:integer — the declaration wins over the string-semantic flag: a positive integer stays bare even with quoteAmbiguousScalars=true", () => {
    expect(serializeYamlScalar("123456789", true, INTEGER)).toBe("123456789");
    expect(roundTripRanged("123456789", INTEGER, true)).toBe(123456789);
    // Without the range the flag quotes it (#3750 MEDIUM-3) — the control that
    // proves R2 is the range, not a switched-off flag.
    expect(serializeYamlScalar("123456789", true)).toBe('"123456789"');
  });

  it("R3 xsd:decimal — a canonical negative fraction is emitted bare and reads back as a number", () => {
    expect(serializeYamlScalar("-1.5", false, DECIMAL)).toBe("-1.5");
    expect(roundTripRanged("-1.5", DECIMAL)).toBe(-1.5);
    expect(serializeYamlScalar("-7", false, ["xsd:double"])).toBe("-7");
  });

  it("R4 xsd:boolean — `true` / `false` are emitted bare even with quoteAmbiguousScalars=true and read back as booleans", () => {
    expect(serializeYamlScalar("true", true, BOOLEAN)).toBe("true");
    expect(serializeYamlScalar("false", true, BOOLEAN)).toBe("false");
    expect(roundTripRanged("false", BOOLEAN, true)).toBe(false);
    // Control: without the range the flag quotes the same value.
    expect(serializeYamlScalar("true", true)).toBe('"true"');
  });

  it("R5 xsd:string — a number / null / date-shaped value is QUOTED so it reads back as a string (a bare `42` would be tagged xsd:integer under the string range)", () => {
    expect(serializeYamlScalar("42", false, STRING)).toBe('"42"');
    expect(roundTripRanged("42", STRING)).toBe("42");
    expect(serializeYamlScalar("2026-01-15", false, STRING)).toBe(
      '"2026-01-15"',
    );
    expect(roundTripRanged("2026-01-15", STRING)).toBe("2026-01-15");
    expect(serializeYamlScalar("null", false, STRING)).toBe('"null"');
    expect(roundTripRanged("null", STRING)).toBe("null");
    // Control: the same values without a range keep today's bare form.
    expect(serializeYamlScalar("42")).toBe("42");
    expect(serializeYamlScalar("2026-01-15")).toBe("2026-01-15");
  });

  it("R6 xsd:string — a YAML boolean is deliberately NOT quoted (the converter already emits it as a plain string literal; 233 live bare booleans under xsd:string in exoas-flow, measured 2026-09-19)", () => {
    expect(serializeYamlScalar("true", false, STRING)).toBe("true");
    expect(serializeYamlScalar("false", false, STRING)).toBe("false");
    expect(roundTripRanged("true", STRING)).toBe(true);
    // The string-semantic SET still quotes a boolean-shaped label/alias
    // (#3750 MEDIUM-3 unchanged): the exclusion is scoped to the range rule.
    expect(serializeYamlScalar("true", true)).toBe('"true"');
  });

  it("R7 xsd:integer — a non-numeric value under a numeric range keeps the shape rule (a leading `-` is still quoted)", () => {
    expect(serializeYamlScalar("-abc", false, INTEGER)).toBe('"-abc"');
    expect(serializeYamlScalar("-1x", false, INTEGER)).toBe('"-1x"');
    expect(serializeYamlScalar("- 1", false, INTEGER)).toBe('"- 1"');
    // `Number("-1e3")` is a safe integer, but YAML 1.1 reads a bare `-1e3` as
    // a STRING: the LEXICAL gate, not the numeric one, must reject it.
    expect(serializeYamlScalar("-1e3", false, INTEGER)).toBe('"-1e3"');
  });

  it("R8 xsd:integer — an integer beyond Number.MAX_SAFE_INTEGER keeps the shape rule (bare, js-yaml would read 12345678901234567890 as 12345678901234567000)", () => {
    expect(serializeYamlScalar("-12345678901234567890", false, INTEGER)).toBe(
      '"-12345678901234567890"',
    );
    // The largest safe magnitude is still bare.
    expect(serializeYamlScalar("-9007199254740991", false, INTEGER)).toBe(
      "-9007199254740991",
    );
    expect(serializeYamlScalar("-9007199254740992", false, INTEGER)).toBe(
      '"-9007199254740992"',
    );
  });

  it("R9 xsd:integer — a NON-canonical lexical (leading zero, underscore, base prefix) keeps the shape rule: `-010` stays quoted (bare, YAML 1.1 reads 010 as octal 8)", () => {
    expect(serializeYamlScalar("-010", false, INTEGER)).toBe('"-010"');
    expect(serializeYamlScalar("-007", false, INTEGER)).toBe('"-007"');
    expect(serializeYamlScalar("-1_000", false, INTEGER)).toBe('"-1_000"');
    expect(serializeYamlScalar("-0x1F", false, INTEGER)).toBe('"-0x1F"');
    // `-0` and `0` are canonical.
    expect(serializeYamlScalar("-0", false, INTEGER)).toBe("-0");
    expect(serializeYamlScalar("0", false, INTEGER)).toBe("0");
    // Decimal family: the integer part follows the same canon.
    expect(serializeYamlScalar("-01.5", false, DECIMAL)).toBe('"-01.5"');
  });

  it("R10 no declared range — byte-identical to the pre-ticket behaviour (negative quoted, positive bare)", () => {
    expect(serializeYamlScalar("-1001234567890")).toBe('"-1001234567890"');
    expect(serializeYamlScalar("-1001234567890", false, undefined)).toBe(
      '"-1001234567890"',
    );
    expect(serializeYamlScalar("123456789")).toBe("123456789");
    expect(needsYamlQuoting("-1.5")).toBe(true);
  });

  it("R11 a range that is not exactly ONE XSD datatype (class ref, two values, empty, foreign CURIE) gives no typing — shape rule as before", () => {
    expect(
      serializeYamlScalar("-5", false, [
        "[[40a0741c-bd20-45b9-860f-42e2e866226c]]",
      ]),
    ).toBe('"-5"');
    expect(serializeYamlScalar("-5", false, ["ems__Effort"])).toBe('"-5"');
    expect(
      serializeYamlScalar("-5", false, ["xsd:integer", "xsd:string"]),
    ).toBe('"-5"');
    expect(serializeYamlScalar("-5", false, [])).toBe('"-5"');
    expect(serializeYamlScalar("-5", false, ["ex:integer"])).toBe('"-5"');
    expect(
      serializeYamlScalar("42", false, ["xsd:string", "xsd:integer"]),
    ).toBe("42");
  });

  it("R12 scalarTypingForRange — CURIE and full-IRI forms of every family; non-scalar datatypes and non-datatype ranges give undefined", () => {
    expect(scalarTypingForRange(["xsd:integer"])).toBe("integer");
    expect(scalarTypingForRange(["xsd:long"])).toBe("integer");
    expect(scalarTypingForRange(["xsd:nonNegativeInteger"])).toBe("integer");
    expect(
      scalarTypingForRange(["http://www.w3.org/2001/XMLSchema#integer"]),
    ).toBe("integer");
    expect(scalarTypingForRange(["xsd:decimal"])).toBe("decimal");
    expect(scalarTypingForRange(["xsd:float"])).toBe("decimal");
    expect(scalarTypingForRange(["xsd:double"])).toBe("decimal");
    expect(scalarTypingForRange(["xsd:boolean"])).toBe("boolean");
    expect(scalarTypingForRange(["xsd:string"])).toBe("string");
    expect(
      scalarTypingForRange(["http://www.w3.org/2001/XMLSchema#string"]),
    ).toBe("string");
    expect(scalarTypingForRange([" xsd:integer "])).toBe("integer");
    expect(scalarTypingForRange(["xsd:dateTime"])).toBeUndefined();
    expect(scalarTypingForRange(["xsd:date"])).toBeUndefined();
    expect(scalarTypingForRange(["xsd:anyURI"])).toBeUndefined();
    expect(scalarTypingForRange(["xsd:gYear"])).toBeUndefined();
    expect(scalarTypingForRange(["ex:integer"])).toBeUndefined();
    expect(
      scalarTypingForRange(["[[40a0741c-bd20-45b9-860f-42e2e866226c]]"]),
    ).toBeUndefined();
    expect(
      scalarTypingForRange(["xsd:integer", "xsd:integer"]),
    ).toBeUndefined();
    expect(scalarTypingForRange([])).toBeUndefined();
    expect(scalarTypingForRange(undefined)).toBeUndefined();
  });

  // LOW-3 (review #4282): every member of both numeric families, not a sample —
  // the 13 integer-derived names + the 3 fractional ones are the keys of the
  // validator's DECIMAL_TAG_LEXICAL table minus gYear (which the writer treats
  // as a date, not a number). Dropping any single member from
  // xsdNumericFamily's sets must red exactly its row here.
  it.each([
    ["integer", "integer"],
    ["long", "integer"],
    ["int", "integer"],
    ["short", "integer"],
    ["byte", "integer"],
    ["nonNegativeInteger", "integer"],
    ["unsignedLong", "integer"],
    ["unsignedInt", "integer"],
    ["unsignedShort", "integer"],
    ["unsignedByte", "integer"],
    ["positiveInteger", "integer"],
    ["nonPositiveInteger", "integer"],
    ["negativeInteger", "integer"],
    ["decimal", "decimal"],
    ["float", "decimal"],
    ["double", "decimal"],
  ] as const)(
    "R12t scalarTypingForRange — xsd:%s (CURIE and full IRI) types as %s",
    (local, family) => {
      expect(scalarTypingForRange([`xsd:${local}`])).toBe(family);
      expect(
        scalarTypingForRange([`http://www.w3.org/2001/XMLSchema#${local}`]),
      ).toBe(family);
    },
  );

  it("R13 xsd:decimal — an exponent form is not canonical (YAML 1.1 reads `1.5e3` as a STRING): `-1.5e3` keeps the shape rule", () => {
    expect(serializeYamlScalar("-1.5e3", false, DECIMAL)).toBe('"-1.5e3"');
    expect(serializeYamlScalar("-.5", false, DECIMAL)).toBe('"-.5"');
    expect(serializeYamlScalar("-1.", false, DECIMAL)).toBe('"-1."');
  });

  it("R14 a non-string value (the --input JSON number / boolean door) is never affected by the range — emitted bare as before", () => {
    expect(serializeYamlScalar(-5, false, STRING)).toBe("-5");
    expect(serializeYamlScalar(true, false, STRING)).toBe("true");
    expect(serializeYamlScalar(-5, false, INTEGER)).toBe("-5");
  });
});
