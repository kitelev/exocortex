/**
 * Issue #4350 — the CLI keeps ONE literal copy of the core namespace-prefix
 * grammar (`utils/namespacePrefix.ts`), because many CLI suites mock
 * `@kitelev/exocortex-core` without `Namespace`. This suite imports the REAL
 * core and fails the moment the copy and the original disagree — in text (P1)
 * or in verdict (P2) — and pins the SPARQL prefix auto-declaration that rides on
 * the copy (Q1, Q2, Q3).
 */
import { describe, it, expect } from "@jest/globals";
import { Namespace, SPARQLParser } from "@kitelev/exocortex-core";
import { PREFIX_PATTERN_SOURCE, PREFIX_RE } from "../../../src/utils/namespacePrefix.js";
import { injectExocortexPrefixes } from "../../../src/utils/QueryPrefixInjector.js";

describe("namespace-prefix grammar — CLI copy ≡ core (issue #4350)", () => {
  it("[P1] the CLI copy is the core pattern, character for character", () => {
    expect(PREFIX_PATTERN_SOURCE).toBe(Namespace.PREFIX_PATTERN_SOURCE);
  });

  it("[P2] the CLI copy returns the core verdict on every edge of the grammar", () => {
    const candidates = [
      "ems", "aiKnow", "tbank-nessy", "device-work-macbook", "a-b", "my-tBox2",
      "-lead", "trail-", "dou--ble", "Has-Dash", "9-digit", "-", "a_b-c", "", "a b",
    ];
    for (const p of candidates) {
      expect([p, PREFIX_RE.test(p)]).toEqual([p, Namespace.isValidPrefix(p)]);
    }
  });
});

describe("injectExocortexPrefixes — hyphenated prefixes (issue #4350)", () => {
  it("[Q1] auto-declares a hyphenated prefix used in the query body, not just its tail", () => {
    const result = injectExocortexPrefixes(
      "SELECT ?s ?o WHERE { ?s device-work-macbook:Exercise_chapter ?o }",
    );
    expect(result).toContain(
      "PREFIX device-work-macbook: <https://exocortex.my/ontology/device-work-macbook#>",
    );
    // Pre-fix the scan matched only the tail after the last hyphen.
    expect(result).not.toMatch(/PREFIX macbook:/);
  });

  it("[Q2] does not re-declare a hyphenated prefix the query already declares", () => {
    const query =
      "PREFIX tbank-nessy: <https://example.org/nessy#>\nSELECT ?s WHERE { ?s tbank-nessy:LessonLearned_text ?o }";
    const result = injectExocortexPrefixes(query);
    expect((result.match(/PREFIX tbank-nessy:/g) || []).length).toBe(1);
  });

  it("[Q3] a minus glued to a variable does not fold the variable into the prefix", () => {
    // Review finding on #4352: once `-` is legal inside a prefix, the scan read
    // `?n-aiKnow:w` as the prefix `n-aiKnow` and left `aiKnow` undeclared, so the
    // query stopped parsing. `aiKnow` is NOT in the static prefix set — it is
    // exactly the auto-declared case. The glued form is its ONLY use in the
    // query: a second, free-standing `aiKnow:` would declare it on its own and
    // the parse assertion below would pass with the bug in place.
    const result = injectExocortexPrefixes(
      "SELECT ?n WHERE { ?s ?p ?n . FILTER(?n-aiKnow:w > 0) }",
    );
    expect(result).toContain("PREFIX aiKnow: <https://exocortex.my/ontology/aiKnow#>");
    expect(result).not.toMatch(/PREFIX n-aiKnow:/);
    expect(() => new SPARQLParser().parse(result)).not.toThrow();
  });
});
