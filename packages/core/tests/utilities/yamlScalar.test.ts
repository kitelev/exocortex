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
 */
import * as yaml from "js-yaml";
import { serializeYamlScalar } from "../../src/utilities/yamlScalar";

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
