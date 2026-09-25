import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

/**
 * Issue #4350 — a namespace prefix may carry INTERNAL hyphens
 * (`device-work-macbook`, `tbank-nessy`). Before the fix the prefix grammar was
 * `[a-z][a-zA-Z0-9]*`, `fromPropertyKey` returned null for such a key, and the
 * converter dropped the key without a trace.
 *
 * The three entry points (`forPrefix`, `fromPropertyKey`, `fromTermIRI`) are
 * pinned separately because each carried its own literal copy of the old
 * grammar — a fix in one of them alone leaves the other two rejecting, which is
 * exactly the forward/inverse drift the class docstring warns about.
 */
describe("Namespace — hyphenated prefixes (issue #4350)", () => {
  it("[N1] fromPropertyKey parses a hyphenated prefix and mints its term IRI", () => {
    const parsed = Namespace.fromPropertyKey("device-work-macbook__Exercise_chapter");
    expect(parsed).not.toBeNull();
    expect(parsed!.namespace.prefix).toBe("device-work-macbook");
    expect(parsed!.localName).toBe("Exercise_chapter");
    expect(parsed!.namespace.term(parsed!.localName).value).toBe(
      "https://exocortex.my/ontology/device-work-macbook#Exercise_chapter",
    );
  });

  it("[N2] forPrefix accepts hyphen-separated runs and rejects every other hyphen placement", () => {
    for (const ok of ["tbank-nessy", "device-work-macbook", "a-b", "exo-ims", "my-tBox2"]) {
      expect(Namespace.forPrefix(ok)?.iri.value).toBe(
        `https://exocortex.my/ontology/${ok}#`,
      );
    }
    for (const bad of ["-lead", "trail-", "dou--ble", "Has-Dash", "9-digit", "-", "a_b-c"]) {
      expect(Namespace.forPrefix(bad)).toBeNull();
      expect(Namespace.isValidPrefix(bad)).toBe(false);
    }
  });

  it("[N3] fromTermIRI inverts a hyphenated term IRI back to prefix + local name", () => {
    const term = Namespace.fromTermIRI(
      "https://exocortex.my/ontology/tbank-nessy#LessonLearned",
    );
    expect(term).not.toBeNull();
    expect(term!.namespace.prefix).toBe("tbank-nessy");
    expect(term!.localName).toBe("LessonLearned");
  });

  it("[N4] the key grammar and the prefix grammar agree (one rule, not two copies)", () => {
    // A key parses iff the text before its FIRST `__` is a valid prefix.
    const keys = [
      "device-work-macbook__Exercise_chapter",
      "ems__Effort_status",
      "aiKnow__Memory",
      "trail-__x",
      "-lead__x",
      "dou--ble__x",
      "Upper__x",
      "mcp__claude-in-chrome__navigate",
    ];
    for (const key of keys) {
      const prefix = key.slice(0, key.indexOf("__"));
      expect(Namespace.fromPropertyKey(key) !== null).toBe(Namespace.isValidPrefix(prefix));
    }
  });

  it("[N5] canary: unhyphenated keys keep their canonical singleton and ad-hoc form", () => {
    expect(Namespace.fromPropertyKey("ems__Effort_status")!.namespace).toBe(Namespace.EMS);
    // `mcp__claude-in-chrome__navigate` stays prefix `mcp` — the prefix can never
    // swallow a `__`, so a hyphen inside the LOCAL part changes nothing.
    const mcp = Namespace.fromPropertyKey("mcp__claude-in-chrome__navigate");
    expect(mcp!.namespace.prefix).toBe("mcp");
    expect(mcp!.localName).toBe("claude-in-chrome__navigate");
  });
});
